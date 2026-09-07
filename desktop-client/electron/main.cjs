const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const crypto = require('crypto');
const { execSync } = require('child_process');
const axios = require('axios');
let autoUpdater;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (_) {
  autoUpdater = null;
}
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const { pathToFileURL } = require('url');
const { decideActivationState } = require('./auth-policy.cjs');

let mainWindow;
let worker;
let quitting = false;
let workerRestartCount = 0;
let workerRestartTimer = null;
let authMonitorTimer = null;
let authMonitorBusy = false;
let activationInvalidating = false;
let workerPausedForAuth = false;
let selectedMediaFolder = '';
function mediaFolderConfigPath() { return path.join(app.getPath('userData'), 'media-folder.json'); }
function loadMediaFolder() { try { const value = JSON.parse(fs.readFileSync(mediaFolderConfigPath(), 'utf8')); if (value && typeof value.path === 'string' && fs.existsSync(value.path) && fs.statSync(value.path).isDirectory()) selectedMediaFolder = path.normalize(value.path); } catch (_) {} }
function saveMediaFolder(folder) { selectedMediaFolder = path.normalize(folder); try { fs.mkdirSync(path.dirname(mediaFolderConfigPath()), { recursive: true }); fs.writeFileSync(mediaFolderConfigPath(), JSON.stringify({ path: selectedMediaFolder }, null, 2), 'utf8'); } catch (_) {} }
const isDev = !app.isPackaged;
let apiPort = Number(process.env.WUJI_API_PORT || 8765);
let API = `http://127.0.0.1:${apiPort}`;
let updateConfig = null;
const ACTIVATION_SALT = 'wuji_assistant_2026_auth_key';

function getMachineId() {
  try {
    let id = '';
    if (process.platform === 'win32') {
      try {
        id = execSync('wmic csproduct get uuid').toString().split('\n')[1].trim();
      } catch (_) {
        try {
          id = execSync('wmic diskdrive get serialnumber').toString().split('\n')[1].trim();
        } catch (__) {
          id = require('os').hostname();
        }
      }
    } else {
      id = require('os').hostname();
    }
    return crypto.createHash('sha256').update(id + ACTIVATION_SALT).digest('hex').toUpperCase().slice(0, 16);
  } catch (_) {
    return 'UNKNOWN-DEVICE-ID';
  }
}

function getExpectedActivationCode(machineId) {
  return crypto.createHash('sha256').update(machineId + ACTIVATION_SALT + 'LICENSE').digest('hex').toUpperCase().slice(0, 24);
}

function activationFilePath() {
  return path.join(app.getPath('userData'), '.license');
}

// 云端激活系统配置：生产桌面端必须使用稳定域名，不依赖开发预览地址。
const AUTH_SERVER_URL = 'https://wuji-auth-9gxch8hu.manus.space/api/trpc';
const AUTH_RECHECK_INTERVAL_MS = 15 * 1000;

function readStoredActivationCode() {
  try {
    const filePath = activationFilePath();
    if (!fs.existsSync(filePath)) return '';
    return fs.readFileSync(filePath, 'utf8').trim().toUpperCase();
  } catch (_) {
    return '';
  }
}

async function verifyStoredActivation() {
  const code = readStoredActivationCode();
  if (!code) return { valid: false, permanent: true, reason: '本机未找到激活记录' };

  try {
    const response = await axios.post(`${AUTH_SERVER_URL}/auth.verify?batch=1`, {
      "0": { json: { code, machineId: getMachineId() } }
    }, { timeout: 15000 });
    const result = response.data?.[0]?.result?.data?.json;
    if (!result || typeof result.success !== 'boolean') {
      return { valid: false, transient: true, reason: '云端返回格式异常' };
    }
    if (result.success) {
      return { valid: true, expiresAt: result.expiresAt || null };
    }
    return { valid: false, permanent: true, reason: result.message || '激活码已失效' };
  } catch (error) {
    return { valid: false, transient: true, reason: `云端暂时无法连接：${error?.message || '网络异常'}` };
  }
}

async function checkActivationStatus() {
  const result = await verifyStoredActivation();
  const decision = decideActivationState(result, Boolean(readStoredActivationCode()));
  return decision.allow;
}

async function invalidateActivation(reason = '授权已失效') {
  if (activationInvalidating) return;
  activationInvalidating = true;
  try {
    // 先暂停自动重启并终止本地 worker，保证界面可以立即锁定；取消请求作为补充清理。
    workerPausedForAuth = true;
    if (workerRestartTimer) {
      clearTimeout(workerRestartTimer);
      workerRestartTimer = null;
    }
    const cancelPromise = apiRequest('/tasks/cancel-all', { method: 'POST' }).catch(() => null);
    if (worker) {
      try { worker.kill(); } catch (_) {}
      worker = null;
    }
    try { fs.unlinkSync(activationFilePath()); } catch (_) {}
    mainWindow?.webContents.send('auth-state-changed', { active: false, reason });
    mainWindow?.webContents.send('worker-log', `[auth] ${reason}，已停止任务并返回激活页面`);
    await cancelPromise;
  } finally {
    activationInvalidating = false;
  }
}

function startActivationMonitor() {
  if (authMonitorTimer) clearInterval(authMonitorTimer);
  authMonitorTimer = setInterval(async () => {
    if (quitting || authMonitorBusy || activationInvalidating) return;
    const storedCode = readStoredActivationCode();
    if (!storedCode) return;
    authMonitorBusy = true;
    try {
      const result = await verifyStoredActivation();
      const decision = decideActivationState(result, Boolean(storedCode));
      if (decision.action === 'invalidate') await invalidateActivation(decision.reason);
    } finally {
      authMonitorBusy = false;
    }
  }, AUTH_RECHECK_INTERVAL_MS);
}

function setApiPort(port) {
  apiPort = Number(port);
  API = `http://127.0.0.1:${apiPort}`;
  process.env.WUJI_API_PORT = String(apiPort);
  process.env.WUJI_API_BASE = API;
}

function canUsePort(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '127.0.0.1');
  });
}

async function chooseApiPort() {
  const preferred = Number(process.env.WUJI_API_PORT || 8765);
  for (let port = preferred; port <= preferred + 30; port += 1) {
    if (await canUsePort(port)) {
      setApiPort(port);
      if (port !== preferred) mainWindow?.webContents.send('worker-log', `[worker] 8765 端口已被占用，已自动切换到 ${port}`);
      return port;
    }
  }
  throw new Error('没有可用的本地服务端口（已尝试 8765-8805）');
}

async function waitForApi(maxAttempts = 30) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      await apiRequest('/stats');
      return true;
    } catch (_) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  return false;
}

function loadUpdateConfig() {
  try {
    const configPath = path.join(app.getAppPath(), 'config', 'update.json');
    const value = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (!value || value.provider !== 'github' || !value.owner || value.owner.includes('YOUR_') || !value.repo) return null;
    return value;
  } catch (_) {
    return null;
  }
}

function sendUpdateStatus(status, payload = {}) {
  mainWindow?.webContents.send('update-status', { status, ...payload });
}

function configureAutoUpdater() {
  updateConfig = loadUpdateConfig();
  if (!autoUpdater) {
    mainWindow?.webContents.send('worker-log', '[update-error] 未安装 electron-updater，请在项目目录执行 npm install 后重启');
    return;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  if (!app.isPackaged || !updateConfig) return;
  try {
    autoUpdater.setFeedURL({ provider: 'github', owner: updateConfig.owner, repo: updateConfig.repo, private: Boolean(updateConfig.private) });
  } catch (error) {
    sendUpdateStatus('error', { message: `更新地址配置失败：${error.message}` });
  }
  autoUpdater.on('checking-for-update', () => sendUpdateStatus('checking'));
  autoUpdater.on('update-available', info => sendUpdateStatus('available', { version: info.version, releaseName: info.releaseName || '' }));
  autoUpdater.on('update-not-available', info => sendUpdateStatus('not-available', { version: info.version || app.getVersion() }));
  autoUpdater.on('download-progress', progress => sendUpdateStatus('downloading', { percent: Math.round(progress.percent), transferred: progress.transferred, total: progress.total }));
  autoUpdater.on('update-downloaded', info => sendUpdateStatus('downloaded', { version: info.version }));
  autoUpdater.on('error', error => sendUpdateStatus('error', { message: error?.message || String(error) }));
}

async function checkForUpdate() {
  if (!autoUpdater) return { status: 'missing-dependency', message: '缺少 electron-updater，请在项目目录执行 npm install 后重启。' };
  if (!app.isPackaged) return { status: 'dev', message: '开发模式不检查更新，请使用安装版测试。' };
  if (!updateConfig) return { status: 'not-configured', message: '尚未配置更新仓库，请先填写 config/update.json。' };
  try {
    await autoUpdater.checkForUpdates();
    return { status: 'checking' };
  } catch (error) {
    sendUpdateStatus('error', { message: error?.message || String(error) });
    return { status: 'error', message: error?.message || String(error) };
  }
}


function apiRequest(apiPath, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API}${apiPath}`);
    const body = options.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : null;
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: options.method || 'GET',
      headers: { 'Content-Type': 'application/json', ...(body ? { 'Content-Length': Buffer.byteLength(body) } : {}) },
      timeout: 15000
    }, (res) => {
      let raw = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        let data = {};
        try { data = raw ? JSON.parse(raw) : {}; } catch { reject(new Error(`本地服务返回格式错误：${raw.slice(0, 200)}`)); return; }
        if (res.statusCode < 200 || res.statusCode >= 300) { reject(new Error(data.detail || data.error || `请求失败：HTTP ${res.statusCode}`)); return; }
        resolve(data);
      });
    });
    req.on('timeout', () => req.destroy(new Error(`连接本地服务超时，请确认 ${API} 端口正在运行`)));
    req.on('error', err => reject(new Error(`无法连接本地服务 ${API}：${err.message}`)));
    if (body) req.write(body);
    req.end();
  });
}

function startWorker() {
  if (quitting || workerPausedForAuth) return;
  const projectRoot = path.join(__dirname, '..');
  const root = isDev ? projectRoot : process.resourcesPath;
  const script = path.join(root, 'python_worker', 'run.py');
  const embedded = path.join(root, 'runtime', 'python-embed', process.platform === 'win32' ? 'python.exe' : 'python3');
  const venv = path.join(projectRoot, '.venv', 'Scripts', 'python.exe');
  const candidates = isDev
    ? (process.platform === 'win32'
      ? [{ cmd: venv, args: ['-m', 'uvicorn', 'python_worker.app.server:app', '--host', '127.0.0.1', '--port', String(apiPort)] }, { cmd: 'py', args: ['-3', script] }, { cmd: 'python', args: [script] }]
      : [{ cmd: 'python3', args: [script] }, { cmd: 'python', args: [script] }])
    : [{ cmd: embedded, args: ['-m', 'uvicorn', 'python_worker.app.server:app', '--host', '127.0.0.1', '--port', String(apiPort)] }];
  const launch = (index = 0) => {
    if (quitting || workerPausedForAuth) return;
    if (index >= candidates.length) { mainWindow?.webContents.send('worker-log', isDev ? '[worker-error] 未找到 Python，请安装依赖或手动启动后端' : '[worker-error] 内置 Python runtime 启动失败，请重新安装 M7社媒助手'); return; }
    const item = candidates[index];
    worker = spawn(item.cmd, item.args, {
      cwd: root,
      windowsHide: true,
      env: { ...process.env, WUJI_API_PORT: String(apiPort), WUJI_API_BASE: API }
    });
    let spawned = false;
    worker.once('spawn', () => {
      spawned = true;
      mainWindow?.webContents.send('worker-log', `[worker] 已启动：${item.cmd}，服务地址 ${API}`);
    });
    worker.stdout.on('data', data => mainWindow?.webContents.send('worker-log', data.toString()));
    worker.stderr.on('data', data => mainWindow?.webContents.send('worker-log', `[worker-error] ${data}`));
    worker.once('error', () => { if (!spawned) launch(index + 1); });
    worker.once('exit', (code) => {
      if (quitting || workerPausedForAuth) return;
      if (code && !spawned) { launch(index + 1); return; }
      if (code && spawned) {
        workerRestartCount += 1;
        if (workerRestartCount > 5) {
          mainWindow?.webContents.send('worker-log', '[worker-error] 后端连续异常退出超过 5 次，已停止自动重启，请重新打开软件并检查杀毒软件或安装包完整性');
          return;
        }
        const delay = Math.min(15000, 1500 * workerRestartCount);
        mainWindow?.webContents.send('worker-log', `[worker-error] 后端进程已退出（${code}），${delay / 1000} 秒后进行第 ${workerRestartCount} 次受控重启`);
        workerRestartTimer = setTimeout(() => { if (!quitting && !workerPausedForAuth) launch(index); }, delay);
      }
    });
  };
  launch();
}

function createWindow() {
  const iconPath = isDev ? path.join(__dirname, '..', 'assets', 'icon.ico') : path.join(process.resourcesPath, 'assets', 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#f7fbff',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: false }
  });
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5173');
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  mainWindow.webContents.on('did-fail-load', (_, code, description) => mainWindow.webContents.send('worker-log', `[renderer-error] ${code}: ${description}`));
}

app.whenReady().then(async () => {
  loadMediaFolder();
  try {
    await chooseApiPort();
  } catch (error) {
    console.error(error);
  }
  configureAutoUpdater();
  ipcMain.handle('api-request', (_, apiPath, options) => apiRequest(apiPath, options || {}));
  ipcMain.handle('update-check', () => checkForUpdate());
  ipcMain.handle('update-download', async () => {
    if (!autoUpdater) return { status: 'missing-dependency', message: '缺少 electron-updater，请在项目目录执行 npm install 后重启。' };
    if (!app.isPackaged || !updateConfig) return { status: 'unavailable', message: '当前安装包尚未配置更新仓库。' };
    try {
      await autoUpdater.downloadUpdate();
      return { status: 'downloading' };
    } catch (error) {
      sendUpdateStatus('error', { message: error?.message || String(error) });
      return { status: 'error', message: error?.message || String(error) };
    }
  });
  ipcMain.handle('update-install', async () => {
    if (!autoUpdater) return { status: 'missing-dependency', message: '缺少 electron-updater，请在项目目录执行 npm install 后重启。' };
    if (!app.isPackaged) return { status: 'dev', message: '开发模式不能安装更新。' };
    try {
      const stats = await apiRequest('/stats');
      if (Number(stats?.running || 0) > 0) return { status: 'blocked', message: '当前仍有运行中的任务，请先停止或等待任务完成。' };
    } catch (_) {}
    autoUpdater.autoInstallOnAppQuit = true;
    setTimeout(() => autoUpdater.quitAndInstall(false, true), 120);
    return { status: 'installing' };
  });
  ipcMain.handle('pick-files', async (_, defaultPath) => { const requested = typeof defaultPath === 'string' && defaultPath.trim() ? defaultPath.trim() : selectedMediaFolder; const options = { properties: ['openFile', 'multiSelections'], filters: [{ name: '媒体文件', extensions: ['jpg', 'jpeg', 'png', 'gif', 'mp4', 'mov', 'webm', 'avi'] }] }; if (requested) { try { const candidate = path.normalize(requested); if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) { options.defaultPath = candidate; selectedMediaFolder = candidate; } } catch (_) {} } const r = await dialog.showOpenDialog(options); return r.canceled ? [] : r.filePaths; });
  ipcMain.handle('pick-folder', async () => { const r = await dialog.showOpenDialog({ properties: ['openDirectory'] }); if (r.canceled || !r.filePaths[0]) return ''; saveMediaFolder(r.filePaths[0]); return selectedMediaFolder; });
  ipcMain.handle('list-media-folder', async (_, folderPath) => { try { const root = path.normalize(String(folderPath || '')); if (!root || !fs.existsSync(root) || !fs.statSync(root).isDirectory()) return []; const allowed = new Set(['.jpg','.jpeg','.png','.gif','.webp','.mp4','.mov','.webm','.avi']); return fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isFile() && allowed.has(path.extname(entry.name).toLowerCase())).map(entry => path.join(root, entry.name)); } catch (_) { return []; } });
  ipcMain.handle('get-media-folder', () => selectedMediaFolder);
  ipcMain.handle('clear-media-folder', () => { selectedMediaFolder = ''; try { fs.unlinkSync(mediaFolderConfigPath()); } catch (_) {} return true; });
  ipcMain.handle('auth-get-id', () => getMachineId());
  ipcMain.handle('auth-check', async () => await checkActivationStatus());
  ipcMain.handle('auth-verify', async (_, code) => {
    const mid = getMachineId();
    try {
      // 遵循 tRPC 协议进行联网验证
      const response = await axios.post(`${AUTH_SERVER_URL}/auth.verify?batch=1`, {
        "0": { json: { code: code.trim().toUpperCase(), machineId: mid } }
      });
      const result = response.data?.[0]?.result?.data?.json;
      if (result?.success) {
        fs.writeFileSync(activationFilePath(), code.trim().toUpperCase(), 'utf8');
        if (workerPausedForAuth) {
          workerPausedForAuth = false;
          workerRestartCount = 0;
          startWorker();
        }
      }
      return result || { success: false, message: '验证接口返回异常' };
    } catch (e) {
      return { success: false, message: '联网验证失败：' + (e.message || '网络连接异常') };
    }
  });

  ipcMain.handle('auth-get-subscription', async (_, requestedCode) => {
    const mid = getMachineId();
    const activationCode = typeof requestedCode === 'string' && requestedCode.trim()
      ? requestedCode.trim().toUpperCase()
      : readStoredActivationCode();
    const subscriptionInput = { machineId: mid, ...(activationCode ? { activationCode } : {}) };
    try {
      console.log('[auth] subscription request', {
        activationSuffix: activationCode ? activationCode.slice(-4) : '(none)',
        machineSuffix: mid.slice(-4),
      });
      const response = await axios.get(`${AUTH_SERVER_URL}/payment.getSubscription?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: subscriptionInput } }))}`);
      const subscription = response.data?.[0]?.result?.data?.json || { active: false };
      console.log('[auth] subscription response', {
        active: subscription.active,
        durationDays: subscription.durationDays,
        planName: subscription.planName,
        expiresAt: subscription.expiresAt,
      });
      return subscription;
    } catch (e) {
      return { active: false, error: e.message };
    }
  });

  ipcMain.handle('payment-get-addresses', async () => {
    try {
      const response = await axios.get(`${AUTH_SERVER_URL}/payment.getAddresses?batch=1&input=${encodeURIComponent(JSON.stringify({"0":{"json":null}}))}`);
      return response.data?.[0]?.result?.data?.json || [];
    } catch (e) {
      return [];
    }
  });

  ipcMain.handle('payment-create-order', async (_, data) => {
    try {
      const response = await axios.post(`${AUTH_SERVER_URL}/payment.createOrder?batch=1`, {
        "0": { json: data }
      });
      return response.data?.[0]?.result?.data?.json || { success: false };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
  ipcMain.handle('payment-get-order-status', async (_, orderId) => {
    try {
      const response = await axios.get(`${AUTH_SERVER_URL}/payment.getOrderStatus?batch=1&input=${encodeURIComponent(JSON.stringify({"0":{"json":{"id":orderId}}}))}`);
      return response.data?.[0]?.result?.data?.json || null;
    } catch (e) {
      return null;
    }
  });
  ipcMain.handle('file-preview', (_, filePath) => {
    try {
      const stat = fs.statSync(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mime = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.mov':'video/quicktime','.webm':'video/webm','.avi':'video/x-msvideo'}[ext] || '';
      const isImage = mime.startsWith('image/');
      const isVideo = mime.startsWith('video/');
      const preview = isImage && stat.size <= 10 * 1024 * 1024 ? `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` : '';
      const previewUrl = isVideo && stat.size <= 30 * 1024 * 1024 ? `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}` : '';
      return { path: filePath, name: path.basename(filePath), size: stat.size, ext, isImage, isVideo, preview, previewUrl };
    } catch (error) { return { path: filePath, name: path.basename(filePath), size: 0, ext: path.extname(filePath), isImage: false, preview: '', error: error.message }; }
  });
  const initiallyActivated = await checkActivationStatus();
  workerPausedForAuth = !initiallyActivated;
  createWindow();
  if (initiallyActivated) {
    startWorker();
  } else {
    mainWindow?.webContents.send('worker-log', '[auth] 当前设备未通过云端授权，等待输入激活码');
  }
  startActivationMonitor();
  setTimeout(async () => {
    const ready = initiallyActivated ? await waitForApi() : true;
    if (!ready) mainWindow?.webContents.send('worker-log', `[worker-error] 后端在 ${API} 启动超时，请检查杀毒软件或安装包完整性`);
    if (app.isPackaged && updateConfig) setTimeout(() => checkForUpdate(), 8000);
  }, 150);
});

app.on('before-quit', () => { quitting = true; if (authMonitorTimer) clearInterval(authMonitorTimer); if (workerRestartTimer) clearTimeout(workerRestartTimer); if (worker) worker.kill(); });
app.on('window-all-closed', () => { if (workerRestartTimer) clearTimeout(workerRestartTimer); if (worker) worker.kill(); if (process.platform !== 'darwin') app.quit(); });
