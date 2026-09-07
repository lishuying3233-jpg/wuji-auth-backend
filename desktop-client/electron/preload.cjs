const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bitpost', {
  api: 'http://127.0.0.1:8765',
  pickFiles: (defaultPath) => ipcRenderer.invoke('pick-files', defaultPath),
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  listMediaFolder: (folderPath) => ipcRenderer.invoke('list-media-folder', folderPath),
  getMediaFolder: () => ipcRenderer.invoke('get-media-folder'),
  clearMediaFolder: () => ipcRenderer.invoke('clear-media-folder'),
  authGetId: () => ipcRenderer.invoke('auth-get-id'),
  authCheck: () => ipcRenderer.invoke('auth-check'),
  authVerify: (code) => ipcRenderer.invoke('auth-verify', code),
  authGetSubscription: (code) => ipcRenderer.invoke('auth-get-subscription', code),
  paymentGetAddresses: () => ipcRenderer.invoke('payment-get-addresses'),
  paymentCreateOrder: (data) => ipcRenderer.invoke('payment-create-order', data),
  paymentGetOrderStatus: (orderId) => ipcRenderer.invoke('payment-get-order-status', orderId),
  onAuthStateChanged: (callback) => {
    const listener = (_, state) => callback(state);
    ipcRenderer.on('auth-state-changed', listener);
    return () => ipcRenderer.removeListener('auth-state-changed', listener);
  },
  filePreview: (filePath) => ipcRenderer.invoke('file-preview', filePath),
  onWorkerLog: (callback) => ipcRenderer.on('worker-log', (_, message) => callback(message)),
  checkForUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  onUpdateStatus: (callback) => {
    const listener = (_, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
  request: (path, options = {}) => ipcRenderer.invoke('api-request', path, options)
});
