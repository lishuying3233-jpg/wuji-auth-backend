from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import re
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from ..facebook_publisher import publish_to_facebook, FacebookPublishError, PUBLISHER_VERSION

# Electron 日志通道统一使用 UTF-8，避免 Windows 默认代码页导致中文乱码。
try:
    import sys
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    if hasattr(sys.stderr, 'reconfigure'):
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

BIT_BASE = os.getenv('BITBROWSER_BASE', 'http://127.0.0.1:54345').rstrip('/')
DATA_DIR = Path(__file__).resolve().parents[2] / 'data'
DATA_DIR.mkdir(exist_ok=True)
WORKS_FILE = DATA_DIR / 'facebook_works.json'
TASKS_FILE = DATA_DIR / 'task_records.json'

def load_works() -> list[dict[str, Any]]:
    try:
        value = json.loads(WORKS_FILE.read_text(encoding='utf-8'))
        return value if isinstance(value, list) else []
    except Exception:
        return []

def save_works(value: list[dict[str, Any]]) -> None:
    try:
        WORKS_FILE.write_text(json.dumps(value[-1000:], ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        pass

def load_tasks() -> dict[str, dict[str, Any]]:
    try:
        value = json.loads(TASKS_FILE.read_text(encoding='utf-8'))
        return value if isinstance(value, dict) else {}
    except Exception:
        return {}

def save_tasks(value: dict[str, dict[str, Any]]) -> None:
    try:
        TASKS_FILE.write_text(json.dumps(dict(list(value.items())[-1000:]), ensure_ascii=False, indent=2), encoding='utf-8')
    except Exception:
        pass

app = FastAPI(title='BitPost Worker', version='0.1.6')
logs = deque(maxlen=2000)
tasks: dict[str, dict[str, Any]] = load_tasks()
task_handles: dict[str, asyncio.Task] = {}
works: list[dict[str, Any]] = load_works()
scheduler_handle: asyncio.Task | None = None
PROFESSIONAL_CONTENT_URL = 'https://www.facebook.com/professional_dashboard/content/content_library/'
REELS_PROFILE_URL = 'https://www.facebook.com/reel/profile'
YOUR_REELS_RE = re.compile(r'你的\s*Reels|your\s+reels|vos\s+reels|tes\s+reels|tu\s+reels|내\s*Reels|내\s*릴스', re.I)


async def click_your_reels_tab(page) -> bool:
    # 先按照截图中的文字标签寻找可点击的父元素，而不是只点击内部文字节点。
    candidates = [
        page.get_by_text(YOUR_REELS_RE, exact=True).last,
        page.get_by_text(YOUR_REELS_RE, exact=False).last,
        page.locator('[role="tab"]:visible, [role="button"]:visible, a:visible, button:visible').filter(has_text=YOUR_REELS_RE).last,
    ]
    for candidate in candidates:
        try:
            if not await candidate.count() or not await candidate.is_visible(timeout=900):
                continue
            await candidate.scroll_into_view_if_needed()
            await candidate.click(timeout=3500, force=True)
            await page.wait_for_timeout(2200)
            return True
        except Exception:
            continue
    # Facebook 某些版本把标签渲染为普通 div，Playwright role 定位不到；此时触发真实 DOM click。
    try:
        clicked = await page.evaluate("""(pattern) => {
          const re = new RegExp(pattern, 'i');
          const nodes = Array.from(document.querySelectorAll('div,span,a,button'));
          const label = nodes.find(el => re.test((el.textContent || '').replace(/\\s+/g, ' ').trim()));
          if (!label) return false;
          const target = label.closest('[role=tab],[role=button],a,button') || label.parentElement || label;
          target.scrollIntoView({block:'center', inline:'center'});
          target.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
          target.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
          target.click();
          return true;
        }""", YOUR_REELS_RE.pattern)
        if clicked:
            await page.wait_for_timeout(2600)
            return True
    except Exception:
        pass
    return False


def is_specific_facebook_work_url(url: str) -> bool:
    value = str(url or '').lower()
    return 'facebook.com' in value and any(token in value for token in ('/posts/', '/videos/', '/reel/', 'story_fbid=', 'permalink.php'))


def is_insights_url(url: str) -> bool:
    value = str(url or '').lower()
    return 'facebook.com/content/insights/' in value and 'content_id=' in value


async def discover_reel_insights_url(work: dict[str, Any]) -> str:
    debug = await BitAdapter(BIT_BASE).open_profile(str(work.get('profile_id')))
    data = debug.get('data', {}) if isinstance(debug, dict) else {}
    raw_endpoint = data.get('http') or data.get('httpDebugAddress') or data.get('debugAddress') or data.get('ws') or data.get('wsDebugAddress')
    debug_http = await resolve_cdp_endpoint(raw_endpoint)
    if not debug_http:
        raise RuntimeError('无法取得 BitBrowser 窗口调试地址，无法自动进入 Reels')
    try:
        from playwright.async_api import async_playwright
    except Exception as exc:
        raise RuntimeError(f'运行环境缺少 Playwright：{exc}') from exc
    target = re.sub(r'\s+', ' ', str(work.get('text_summary') or '')).strip().lower()
    tokens = [item for item in re.findall(r'[\w\u4e00-\u9fff]{3,}', target)[:10] if item]
    async with async_playwright() as playwright:
        browser = await playwright.chromium.connect_over_cdp(debug_http)
        contexts = browser.contexts
        if not contexts:
            raise RuntimeError('BitBrowser 窗口没有可用浏览器上下文')
        context = contexts[0]
        pages = context.pages
        facebook_pages = [candidate for candidate in pages if 'facebook.com' in candidate.url.lower()]
        page = facebook_pages[-1] if facebook_pages else (pages[-1] if pages else await context.new_page())
        await page.bring_to_front()
        deadline = time.monotonic() + 90
        candidate_url = ''
        selected_your_reels = False
        direct_reel = str(work.get('reel_url') or '')
        if direct_reel:
            await page.goto(direct_reel, wait_until='domcontentloaded', timeout=30000)
            await page.wait_for_timeout(3000)
            work['discovery_page_url'] = page.url
            save_works(works)
            patterns = r'(查看成效分析|查看效果分析|成效分析|View insights|See insights|View performance|Voir les statistiques|Voir les insights|성과 보기|인사이트)'
            candidates = [
                page.get_by_role('button', name=re.compile(patterns, re.IGNORECASE)).last,
                page.get_by_role('link', name=re.compile(patterns, re.IGNORECASE)).last,
                page.get_by_text(re.compile(patterns, re.IGNORECASE), exact=False).last,
                page.locator('[aria-label], [title]').filter(has_text=re.compile(patterns, re.IGNORECASE)).last,
            ]
            for candidate in candidates:
                try:
                    if await candidate.count() and await candidate.is_visible(timeout=1200):
                        await candidate.scroll_into_view_if_needed()
                        await candidate.click(timeout=5000, force=True)
                        await page.wait_for_timeout(3000)
                        for opened_page in context.pages:
                            if is_insights_url(opened_page.url):
                                return opened_page.url
                        if is_insights_url(page.url):
                            return page.url
                except Exception:
                    continue
            raise RuntimeError('已打开发布后的 Reel，但详情页没有找到“查看成效分析”入口')
        while time.monotonic() < deadline:
            await page.goto(REELS_PROFILE_URL, wait_until='domcontentloaded', timeout=30000)
            await page.wait_for_timeout(2500)
            work['discovery_page_url'] = page.url
            save_works(works)
            if 'facebook.com/reel/profile' not in page.url.lower():
                await page.goto(REELS_PROFILE_URL, wait_until='domcontentloaded', timeout=30000)
                await page.wait_for_timeout(1500)
            if not selected_your_reels:
                selected_your_reels = await click_your_reels_tab(page)
                if selected_your_reels:
                    work['discovery_message'] = '已按页面标签进入你的 Reels 列表'
                    work['your_reels_selected_at'] = time.time()
                    save_works(works)
                else:
                    # 页面有时标签加载较慢，允许下一轮重新导航并重试。
                    await page.wait_for_timeout(1200)
                    continue
            anchors = page.locator('a[href*="/reel/"]:visible')
            count = await anchors.count()
            for index in range(min(count, 40)):
                anchor = anchors.nth(index)
                href = await anchor.get_attribute('href')
                if not href or '/reel/profile' in href:
                    continue
                if href.startswith('/'):
                    href = 'https://www.facebook.com' + href
                text = re.sub(r'\s+', ' ', await anchor.inner_text()).strip().lower()
                text += ' ' + (((await anchor.get_attribute('aria-label')) or '') + ' ' + ((await anchor.get_attribute('title')) or '')).lower()
                if target and target[:42] in text:
                    candidate_url = href
                    work['discovery_mode'] = 'caption_match'
                    break
                if tokens and sum(token in text for token in tokens) >= max(1, len(tokens) // 2):
                    candidate_url = href
                    work['discovery_mode'] = 'token_match'
                    break
            if candidate_url:
                await page.goto(candidate_url, wait_until='domcontentloaded', timeout=30000)
                await page.wait_for_timeout(2200)
                patterns = r'(查看成效分析|查看效果分析|成效分析|View insights|See insights|View performance|Voir les statistiques|성과 보기|인사이트)'
                button = page.get_by_role('button', name=re.compile(patterns, re.IGNORECASE)).first
                clicked = False
                if await button.count() and await button.is_visible(timeout=1200):
                    await button.click(timeout=5000, force=True)
                    clicked = True
                else:
                    link = page.get_by_text(re.compile(patterns, re.IGNORECASE), exact=False).first
                    if await link.count() and await link.is_visible(timeout=1200):
                        await link.click(timeout=5000, force=True)
                        clicked = True
                await page.wait_for_timeout(2500)
                for opened_page in contexts[0].pages:
                    if is_insights_url(opened_page.url):
                        return opened_page.url
                current = page.url
                if clicked and is_insights_url(current):
                    return current
                candidate_url = ''
            # 没有文案或关键词匹配时不点击任何作品，等待个人 Reels 网格更新后重试。
            await asyncio.sleep(5)
        raise RuntimeError('已进入你的 Reels，但 90 秒内没有按文案或关键词匹配到刚发布作品；已阻止误点推荐内容')


async def auto_collect_work(work: dict[str, Any], task_id: str = '', profile_id: str = '', wait_seconds: int = 30) -> bool:
    try:
        if task_id:
            emit('INFO', f'发布成功，等待 {wait_seconds} 秒后开始专业仪表板采集', task_id, profile_id)
        await asyncio.sleep(wait_seconds)
        saved_insights = str(work.get('insights_url') or work.get('url') or '')
        if work.get('account_mode') == 'professional' and not is_insights_url(saved_insights):
            work['url'] = 'https://www.facebook.com/professional_dashboard/'
            work['dashboard_home_url'] = work['url']
            work['collect_message'] = '专业账户发布成功，正在进入专业仪表板首页 Content 区域'
            if task_id:
                emit('INFO', '专业账户不再寻找 Reel 链接，直接进入专业仪表板首页', task_id, profile_id)
            save_works(works)
        elif not is_insights_url(saved_insights):
            if work.get('reel_url'):
                work['collect_message'] = '已捕获 Reel 链接，正在直接打开作品查找查看成效分析入口'
                if task_id:
                    emit('INFO', '已捕获 Reel 链接，正在进入直接成效分析路径', task_id, profile_id)
                work['discovery_page_url'] = str(work.get('reel_url'))
                save_works(works)
                discovered = await discover_reel_insights_url(work)
                work['url'] = discovered
                work['insights_url'] = discovered
                work['collect_message'] = '已找到 Insights 页面，正在采集指标'
                work['insights_discovered_at'] = time.time()
                save_works(works)
            else:
                work['collect_message'] = '未捕获直接作品链接，保留手动绑定，不再跳转推荐内容'
                if task_id:
                    emit('WARN', '普通账户没有捕获 Reel 链接，停止自动跳转并保留手动绑定', task_id, profile_id)
                work['collect_status'] = 'failed'
                save_works(works)
                raise RuntimeError('发布后没有捕获到 Reel 详情链接或 Insights 链接，请手动绑定作品链接')
        views, likes, comments = await collect_work_with_lifecycle(work)
        apply_metrics(work, views, likes, comments)
        if task_id:
            emit('INFO', f'专业仪表板采集完成：浏览量={work.get("views")}, 互动={work.get("interactions")}, 播放={work.get("plays")}, 覆盖={work.get("reach")}', task_id, profile_id)
        return True
    except Exception as exc:
        work['collect_status'] = 'failed'
        work['collect_message'] = f'自动采集失败：{exc}；可手动重试'
        save_works(works)
        if task_id:
            emit('ERROR', f'专业仪表板采集失败：{exc}', task_id, profile_id)
        return False


def register_work(task_id: str, profile: dict[str, Any], content: Content, result: dict[str, Any]) -> dict[str, Any]:
    now = time.time()
    work = {
        'id': uuid.uuid4().hex[:12],
        'platform': 'Facebook',
        'task_id': task_id,
        'profile_id': profile.get('id', ''),
        'window_seq': profile.get('seq', ''),
        'account_name': profile.get('name', profile.get('id', '未知账号')),
        'account_mode': result.get('account_mode', 'unknown'),
        'published_at': now,
        'url': result.get('insights_url') or result.get('reel_url') or result.get('url', ''),
        'reel_url': result.get('reel_url', ''),
        'insights_url': result.get('insights_url', ''),
        'content_id': result.get('content_id', ''),
        'text_summary': content.text.strip()[:180],
        'views': None,
        'likes': None,
        'comments': None,
        'interactions': None,
        'plays': None,
        'reach': None,
        'last_collected_at': None,
        'collect_status': 'not_collected',
        'collect_message': '暂未采集',
        'previous_views': None,
        'previous_likes': None,
        'previous_comments': None,
        'delta_views': None,
        'delta_likes': None,
        'delta_comments': None,
        'hourly_views': None,
        'hourly_likes': None,
        'hourly_comments': None,
        'history': []
    }
    works.append(work)
    save_works(works)
    return work


def emit(level: str, message: str, task_id: str | None = None, profile_id: str | None = None):
    item = {'time': time.strftime('%Y-%m-%d %H:%M:%S'), 'level': level, 'message': message, 'task_id': task_id, 'profile_id': profile_id}
    logs.append(item)
    if task_id and task_id in tasks:
        tasks[task_id]['updated_at'] = time.time()
        tasks[task_id]['last_message'] = message
    print(json.dumps(item, ensure_ascii=False), flush=True)


class Content(BaseModel):
    text: str = ''
    media: list[str] = Field(default_factory=list)


class MetricsRequest(BaseModel):
    views: int | None = Field(default=None, ge=0)
    likes: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)


class TaskRequest(BaseModel):
    profile_ids: list[str]
    content_by_profile: dict[str, Content] = Field(default_factory=dict)
    dry_run: bool = False
    collect_after_publish: bool = True
    concurrency: int = Field(default=2, ge=1, le=5)
    retry_limit: int = Field(default=2, ge=0, le=5)
    scheduled_at: float | None = Field(default=None, gt=0)
    schedule_type: str = Field(default='once', pattern='^(once|daily|weekly)$')
    schedule_weekdays: list[int] = Field(default_factory=list)


class BitAdapter:
    def __init__(self, base: str):
        self.base = base

    async def post(self, path: str, payload: dict[str, Any], retries: int = 2) -> dict[str, Any]:
        # BitBrowser 偶尔会在窗口列表较大或同时打开多个窗口时短暂不响应；
        # 连接超时和 5xx 只做有限退避重试，避免请求风暴。
        timeout = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)
        last_error: Exception | None = None
        for attempt in range(max(0, retries) + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    response = await client.post(self.base + path, json=payload)
                if response.status_code >= 500 and attempt < retries:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                if response.status_code >= 400:
                    raise RuntimeError(f'BitBrowser HTTP {response.status_code}：{response.text[:300]}')
                try:
                    data = response.json()
                except Exception as exc:
                    raise RuntimeError(f'BitBrowser 返回不是 JSON：{response.text[:200]}') from exc
                if isinstance(data, dict) and data.get('success') is False:
                    raise RuntimeError(data.get('msg', 'BitBrowser 请求失败'))
                return data
            except Exception as exc:
                last_error = exc
                if attempt < retries:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise RuntimeError(f'无法稳定访问 {self.base}{path}：{exc}') from exc
        raise RuntimeError(f'无法访问 {self.base}{path}：{last_error}')

    async def get(self, path: str, retries: int = 2) -> dict[str, Any]:
        timeout = httpx.Timeout(connect=5.0, read=20.0, write=10.0, pool=5.0)
        last_error: Exception | None = None
        for attempt in range(max(0, retries) + 1):
            try:
                async with httpx.AsyncClient(timeout=timeout, trust_env=False) as client:
                    response = await client.get(self.base + path)
                response.raise_for_status()
                return response.json()
            except Exception as exc:
                last_error = exc
                if attempt < retries:
                    await asyncio.sleep(0.8 * (attempt + 1))
                    continue
                raise RuntimeError(f'BitBrowser GET 请求失败：{self.base}{path}：{exc}') from exc
        raise RuntimeError(f'BitBrowser GET 请求失败：{self.base}{path}：{last_error}')

    async def list_groups(self):
        return await self.list_all('/group/list', page_size=100)

    async def list_profiles(self):
        return await self.list_all('/browser/list', page_size=100)

    async def list_all(self, path: str, page_size: int = 100):
        async def collect(start_page: int):
            items_out: list[dict[str, Any]] = []
            seen: set[str] = set()
            page = start_page
            total_hint = None
            # 保留足够分页空间，支持 1500+ 甚至更多窗口环境；total_hint 仍会提前结束请求。
            while page < start_page + 300:
                payload = await self.post(path, {'page': page, 'pageSize': page_size, 'sort': 'asc'})
                items = unwrap_list(payload)
                container = payload.get('data', payload) if isinstance(payload, dict) else {}
                if isinstance(container, dict):
                    total_hint = container.get('total') or container.get('count') or container.get('totalCount') or total_hint
                new_items = []
                for item in items:
                    if not isinstance(item, dict):
                        continue
                    key = str(item.get('id') or item.get('browserId') or item.get('code') or item.get('seq') or json.dumps(item, ensure_ascii=False, sort_keys=True))
                    if key not in seen:
                        seen.add(key)
                        new_items.append(item)
                items_out.extend(new_items)
                if not items or len(items) < page_size or (total_hint is not None and len(items_out) >= int(total_hint)):
                    break
                if page > start_page and not new_items:
                    break
                page += 1
            return items_out, page - start_page + 1

        # 官方文档规定 page 从 0 开始；部分旧版客户端在 page=0 时仍按第 1 页处理，
        # 因此当结果恰好达到上限时再用 1 起始策略补齐，并按 ID 去重。
        zero_items, zero_pages = await collect(0)
        one_items, one_pages = ([], 0)
        if len(zero_items) and len(zero_items) % page_size == 0:
            one_items, one_pages = await collect(1)
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for item in zero_items + one_items:
            key = str(item.get('id') or item.get('browserId') or item.get('code') or item.get('seq') or json.dumps(item, ensure_ascii=False, sort_keys=True))
            if key not in seen:
                seen.add(key)
                merged.append(item)
        return {'success': True, 'data': merged, 'pagination': {'pages': max(zero_pages, one_pages), 'total': len(merged), 'zero_based': zero_pages, 'one_based_fallback': one_pages}}

    async def open_profile(self, profile_id: str):
        # 打开窗口不是幂等读取操作，避免网络异常时重复提交打开请求。
        payload = await self.post('/browser/open', {'id': profile_id, 'queue': True}, retries=0)
        data = payload.get('data', {}) if isinstance(payload, dict) else {}
        if isinstance(data, dict) and any(data.get(key) for key in ('http', 'httpDebugAddress', 'debugAddress')):
            return payload
        # BitBrowser 可能先返回“打开中”，再异步创建 CDP 调试端口；这里等待最多 15 秒。
        for _ in range(15):
            await asyncio.sleep(1)
            ports = await self.opened_ports()
            port_data = ports.get('data', {}) if isinstance(ports, dict) else {}
            if isinstance(port_data, dict):
                item = port_data.get(profile_id) or port_data.get(str(profile_id))
                if isinstance(item, dict) and any(item.get(key) for key in ('http', 'httpDebugAddress', 'debugAddress')):
                    return {'success': True, 'data': item}
        return payload

    async def close_profile(self, profile_id: str):
        return await self.post('/browser/close', {'id': profile_id})

    async def opened_ports(self):
        try:
            return await self.post('/browser/port', {})
        except Exception:
            return {'data': {}}


def unwrap_list(payload: Any) -> list[dict[str, Any]]:
    data = payload
    if isinstance(data, dict):
        data = data.get('data', data)
    if isinstance(data, dict):
        for key in ('list', 'rows', 'records', 'items', 'data'):
            if isinstance(data.get(key), list):
                data = data[key]
                break
    return data if isinstance(data, list) else []


def normalize_profiles(payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = unwrap_list(payload)
    if not isinstance(data, list):
        return []
    result = []
    for p in data:
        result.append({
            'id': str(p.get('id') or p.get('browserId') or p.get('code') or ''),
            'seq': p.get('seq', ''),
            'name': str(p.get('name') or p.get('remark') or p.get('userName') or p.get('username') or p.get('code') or f'窗口-{p.get("seq", "未知")}').strip(),
            'groupId': str(p.get('groupId') or p.get('group_id') or ''),
            'status': p.get('status', 0),
            'opened': bool(p.get('opened', False)),
            'coreVersion': p.get('coreVersion') or p.get('version') or '未知'
        })
    # BitBrowser 接口常按与客户端列表相反的顺序返回窗口；统一反转后再交给前端。
    return list(reversed([p for p in result if p['id']]))


def window_label(profile: dict[str, Any]) -> str:
    pid = str(profile.get('id') or 'unknown')
    seq = str(profile.get('seq') or '未知序号')
    name = str(profile.get('name') or pid).strip()
    return f'窗口序号={seq} | 名称={name} | ID={pid}'


def is_transient_publish_error(exc: Exception) -> bool:
    text = str(exc).lower()
    markers = (
        'timeout', 'timed out', '超时', '连接失败', '连接被重置', '网络',
        'net::err_', 'err_internet_disconnected', 'err_connection',
        'target closed', 'browser has been closed', 'cdp', '调试地址'
    )
    return any(marker in text for marker in markers)


async def publish_one(task_id: str, profile: dict[str, Any], content: Content, dry_run: bool, retry_limit: int, collect_after_publish: bool = True):
    pid = profile['id']
    label = window_label(profile)
    def wemit(level: str, message: str):
        emit(level, f'[{label}] {message}', task_id, pid)
    if tasks.get(task_id, {}).get('cancel_requested'):
        return {'profile_id': pid, 'status': 'cancelled', 'reason': 'task-cancelled', 'text': content.text, 'media': list(content.media)}
    if not content.text.strip() and not content.media:
        wemit('WARN', '跳过：未配置文案和素材')
        return {'profile_id': pid, 'status': 'skipped', 'reason': 'empty-content', 'text': content.text, 'media': list(content.media)}
    # 最多只允许一次自动重试，防止网络异常时反复关闭并重启窗口。
    max_attempts = min(max(int(retry_limit or 0), 0), 1) + 1
    for attempt in range(max_attempts):
        try:
            if tasks.get(task_id, {}).get('cancel_requested'):
                return {'profile_id': pid, 'status': 'cancelled', 'reason': 'task-cancelled', 'text': content.text, 'media': list(content.media)}
            wemit('INFO', f'开始处理，第 {attempt + 1} 次尝试')
            for media in content.media:
                if not Path(media).exists():
                    raise RuntimeError(f'素材不存在：{media}')
                kind = mimetypes.guess_type(media)[0] or ''
                if not (kind.startswith('image/') or kind.startswith('video/')):
                    raise RuntimeError(f'不支持的素材格式：{media}')
            if dry_run:
                wemit('INFO', '演练模式：已完成素材和文案预检，未点击发布')
                return {'profile_id': pid, 'status': 'dry-run', 'text': content.text, 'media': list(content.media)}
            opened = await BitAdapter(BIT_BASE).open_profile(pid)
            task_record = tasks.get(task_id, {})
            opened_profiles = task_record.setdefault('opened_profiles', [])
            if pid not in opened_profiles:
                opened_profiles.append(pid)
            debug = opened.get('data', {}) if isinstance(opened, dict) else {}
            debug_http = debug.get('http') or debug.get('httpDebugAddress') or debug.get('debugAddress') or debug.get('ws') or debug.get('wsDebugAddress')
            debug_http = await resolve_cdp_endpoint(debug_http)
            if not debug_http:
                raise FacebookPublishError('BitBrowser 未返回 HTTP 调试地址，无法安全连接发布器')
            wemit('INFO', f'已打开 BitBrowser 窗口，正在连接发布器：version={PUBLISHER_VERSION}, coreVersion={debug.get("coreVersion", "unknown")}')
            try:
                result = await asyncio.wait_for(
                    publish_to_facebook(debug_http, content.text, content.media),
                    timeout=90,
                )
            except asyncio.TimeoutError as exc:
                raise RuntimeError('单窗口发帖超过 90 秒未完成，已安全结束该窗口任务') from exc
            if result.get('status') == 'published':
                wemit('INFO', 'Facebook 发布成功，已完成结果校验')
            else:
                wemit('WARN', '已提交 Facebook 发布，但未检测到明确成功提示，请人工复核页面')
            final_result = {'profile_id': pid, 'status': result.get('status', 'submitted-unverified'), 'url': result.get('url', ''), 'account_mode': result.get('account_mode', 'unknown'), 'text': content.text, 'media': list(content.media)}
            work = None
            if final_result['status'] in ('published', 'submitted-unverified'):
                work = register_work(task_id, profile, content, final_result)
                if final_result.get('account_mode') == 'professional' and collect_after_publish:
                    work['collect_status'] = 'collecting'
                    work['collect_message'] = '专业账户发布成功，30 秒后进入专业内容库采集'
                    wemit('INFO', '检测到账户为专业账户，开始同步等待并采集专业仪表板数据；任务不会提前结束')
                    collected = await auto_collect_work(work, task_id=task_id, profile_id=pid, wait_seconds=30)
                    save_works(works)
                    if not collected:
                        final_result['status'] = 'collection-failed'
                        final_result['reason'] = work.get('collect_message', '专业仪表板采集失败')
                else:
                    work['collect_status'] = 'skipped'
                    work['collect_message'] = '普通个人账户已发布，按设置跳过专业数据采集' if final_result.get('account_mode') != 'professional' else '本次任务已关闭发布后自动采集'
                    save_works(works)
                    if final_result.get('account_mode') == 'professional':
                        wemit('INFO', '本次任务已关闭发布后自动采集，专业账户发布完成后直接结束')
                    else:
                        wemit('INFO', '检测为普通个人账户，已完成发帖，跳过专业仪表板采集')
                wemit('INFO', f'已登记作品监测记录，发布路径：{final_result.get("account_mode", "unknown")}')
                final_result['work_id'] = work['id']
            return final_result
        except Exception as exc:
            wemit('ERROR', f'失败：{exc}')
            if attempt + 1 < max_attempts and not tasks.get(task_id, {}).get('cancel_requested'):
                transient = is_transient_publish_error(exc)
                if transient:
                    # 网络卡顿时保留当前窗口，不立即关闭；先退避等待，避免越重启越失去页面状态。
                    delay = min(8, 3 + attempt * 3)
                    wemit('WARN', f'检测为网络或 CDP 短暂异常，保留当前窗口，等待 {delay} 秒后仅重试一次')
                    await asyncio.sleep(delay)
                else:
                    # 只有明确的页面状态错误才关闭窗口后重试一次。
                    try:
                        await BitAdapter(BIT_BASE).close_profile(pid)
                        wemit('INFO', '本次尝试失败，已关闭并重置 BitBrowser 环境，准备进行最后一次尝试')
                    except Exception as close_exc:
                        wemit('WARN', f'重置 BitBrowser 环境失败：{close_exc}')
                    await asyncio.sleep(2)
    task_result = {'profile_id': pid, 'status': 'failed', 'text': content.text, 'media': list(content.media), 'reason': '发布失败'}
    return task_result


@app.get('/health')
async def health():
    return {'ok': True, 'bitbrowser_base': BIT_BASE}


@app.get('/bitbrowser/test')
async def test_bitbrowser():
    adapter = BitAdapter(BIT_BASE)
    result = {'ok': False, 'profiles': 0, 'groups': 0, 'base': BIT_BASE, 'checks': {}}
    try:
        profiles = await adapter.list_profiles()
        result['profiles'] = len(normalize_profiles(profiles)); result['profile_pagination'] = profiles.get('pagination', {}) if isinstance(profiles, dict) else {}; result['checks']['browser/list'] = 'ok'
    except Exception as exc:
        result['checks']['browser/list'] = str(exc)
    try:
        groups = await adapter.list_groups()
        result['groups'] = len(unwrap_list(groups)); result['group_pagination'] = groups.get('pagination', {}) if isinstance(groups, dict) else {}; result['checks']['group/list'] = 'ok'
    except Exception as exc:
        result['checks']['group/list'] = str(exc)
    result['ok'] = result['checks'].get('browser/list') == 'ok' and result['checks'].get('group/list') == 'ok'
    if not result['ok']:
        result['error'] = '；'.join(f'{k}: {v}' for k,v in result['checks'].items() if v != 'ok')
    return result


@app.get('/bitbrowser/groups')
async def groups():
    try:
        return await BitAdapter(BIT_BASE).list_groups()
    except Exception as exc:
        raise HTTPException(502, f'无法读取 BitBrowser 分组：{exc}')


@app.get('/bitbrowser/profiles')
async def profiles():
    try:
        payload = await BitAdapter(BIT_BASE).list_profiles()
        return {'items': normalize_profiles(payload), 'raw': payload}
    except Exception as exc:
        raise HTTPException(502, f'无法读取 BitBrowser 窗口：{exc}')


@app.get('/logs')
async def get_logs():
    return {'items': list(logs)}


@app.get('/works')
async def get_works():
    return {'items': list(reversed(works)), 'refresh_seconds': 600}


def normalize_cdp_endpoint(value: Any) -> str:
    endpoint = str(value or '').strip()
    # BitBrowser 某些版本会把协议重复包在一起，例如 http://ws://...
    if endpoint.startswith(('http://ws://', 'https://ws://')):
        endpoint = 'ws://' + endpoint.split('ws://', 1)[1]
    elif endpoint.startswith(('http://wss://', 'https://wss://')):
        endpoint = 'wss://' + endpoint.split('wss://', 1)[1]
    if endpoint.startswith('ws://') and '/devtools/' not in endpoint:
        return 'http://' + endpoint[5:]
    if endpoint.startswith('wss://') and '/devtools/' not in endpoint:
        return 'https://' + endpoint[6:]
    if endpoint and endpoint.isdigit():
        return f'http://127.0.0.1:{endpoint}'
    if ':' in endpoint and not endpoint.startswith(('http://', 'https://', 'ws://', 'wss://')):
        host, sep, port = endpoint.rpartition(':')
        if sep and port.isdigit() and host:
            return f'http://{endpoint}'
    return endpoint


async def resolve_cdp_endpoint(value: Any) -> str:
    endpoint = normalize_cdp_endpoint(value)
    if not endpoint:
        return ''
    if endpoint.startswith(('http://', 'https://')):
        base = endpoint.rstrip('/')
        try:
            async with httpx.AsyncClient(timeout=5, trust_env=False) as client:
                response = await client.get(f'{base}/json/version')
                if response.is_success:
                    payload = response.json()
                    websocket = payload.get('webSocketDebuggerUrl') or payload.get('webSocketUrl')
                    if websocket:
                        return str(websocket)
                fallback = await client.get(f'{base}/json')
                if fallback.is_success and isinstance(fallback.json(), list):
                    for item in fallback.json():
                        if isinstance(item, dict) and item.get('webSocketDebuggerUrl'):
                            return str(item['webSocketDebuggerUrl'])
        except Exception:
            pass
    return endpoint


def parse_metric_value(value: str) -> int | None:
    cleaned = value.strip().replace(',', '').replace(' ', '').upper()
    multiplier = 1
    if cleaned.endswith('K'):
        multiplier, cleaned = 1000, cleaned[:-1]
    elif cleaned.endswith('M'):
        multiplier, cleaned = 1000000, cleaned[:-1]
    elif cleaned.endswith('B'):
        multiplier, cleaned = 1000000000, cleaned[:-1]
    try:
        return int(float(cleaned) * multiplier)
    except ValueError:
        return None


def extract_metric(text: str, patterns: list[str]) -> int | None:
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return parse_metric_value(match.group(1))
    return None


async def collect_insights_metrics(page, work: dict[str, Any], insights_url: str) -> tuple[int | None, int | None, int | None]:
    await page.goto(insights_url, wait_until='domcontentloaded', timeout=30000)
    await page.wait_for_timeout(3200)
    body = re.sub(r'\s+', ' ', await page.locator('body').inner_text(timeout=10000)).strip()
    accessible = await page.locator('[aria-label], [title]').evaluate_all("els => els.map(e => [e.getAttribute('aria-label'), e.getAttribute('title'), (e.innerText || '').trim()].filter(Boolean).join(' ')).filter(Boolean).slice(0, 800)")
    metric_text = body + ' ' + re.sub(r'\s+', ' ', ' '.join(accessible))
    def labeled_value(labels: tuple[str, ...]) -> int | None:
        matches: list[int] = []
        for label in labels:
            pattern = rf'{re.escape(label)}[^0-9]{{0,80}}(\d[\d,.]*\s*[KMB万千]?)'
            for match in re.finditer(pattern, metric_text, re.IGNORECASE):
                parsed = parse_metric_value(match.group(1))
                if parsed is not None:
                    matches.append(parsed)
        return matches[-1] if matches else None
    views = labeled_value(('累计浏览量', '浏览量', 'views', 'vues', 'visualisations'))
    reach = labeled_value(('浏览人数', '观众人数', 'viewers', 'people reached', 'reach', 'portée'))
    interactions = labeled_value(('互动次数', 'interactions', 'engagement', 'engagements'))
    likes = labeled_value(('点赞数量', '点赞', 'likes', 'j’aime', 'mentions j’aime'))
    comments = labeled_value(('评论数量', '评论', 'comments', 'commentaires'))
    shares = labeled_value(('分享次数', '分享', 'shares', 'partages'))
    if interactions is None:
        parts = [value for value in (likes, comments, shares) if value is not None]
        interactions = sum(parts) if parts else None
    work['_pending_interactions'] = interactions
    work['_pending_reach'] = reach
    work['_pending_plays'] = views
    work['insights_source'] = insights_url
    if views is None and interactions is None and reach is None and likes is None and comments is None:
        lowered = metric_text.lower()
        if any(token in lowered for token in ('login to facebook', 'se connecter à facebook', '内容不可用', 'content isn')):
            raise RuntimeError('Insights 页面未登录或当前账号无权查看该作品数据')
        raise RuntimeError('已打开 Insights 页面，但没有识别到可读指标')
    return views, likes if likes is not None else interactions, comments


async def collect_professional_home_metrics(page, work: dict[str, Any]) -> tuple[int | None, int | None, int | None]:
    """从专业仪表板首页 Content 区域的指标卡片进入并读取作品成效；不点击 See all。"""
    await page.goto('https://www.facebook.com/professional_dashboard/', wait_until='domcontentloaded', timeout=30000)
    await page.wait_for_timeout(4000)
    # 首页 Content 卡片在部分账号上只是展示组件；先点击左侧真正的“内容”管理入口。
    nav_candidates = [
        page.locator('nav:visible, [role="navigation"]:visible, aside:visible').get_by_text(re.compile(r'^内容$|^Content$|^Contenu$|^콘텐츠$', re.I), exact=True).last,
        page.get_by_text(re.compile(r'^内容$|^Content$|^Contenu$|^콘텐츠$', re.I), exact=True).first,
    ]
    nav_clicked = False
    for nav_item in nav_candidates:
        try:
            if await nav_item.count() and await nav_item.is_visible(timeout=1000):
                await nav_item.click(timeout=4000, force=True)
                nav_clicked = True
                work['dashboard_navigation'] = 'content_menu'
                await page.wait_for_timeout(3500)
                break
        except Exception:
            continue
    if not nav_clicked:
        work['dashboard_navigation'] = 'content_menu_not_found'
    target = re.sub(r'\s+', ' ', str(work.get('text_summary') or '')).strip().lower()
    target_tokens = [token for token in re.findall(r'[\w\u4e00-\u9fff]{3,}', target)[:10] if token]
    body = re.sub(r'\s+', ' ', await page.locator('body').inner_text(timeout=10000)).strip()
    content_root = page.get_by_text(re.compile(r'^Content$|^内容$|^Contenu$|^콘텐츠$', re.I), exact=True).last
    roots = [content_root]
    try:
        if await content_root.count():
            roots.extend([content_root.locator('xpath=..'), content_root.locator('xpath=../..'), content_root.locator('xpath=../../..')])
    except Exception:
        pass
    matched_root = None
    for root in roots:
        try:
            text = re.sub(r'\s+', ' ', await root.inner_text(timeout=800)).lower()
            if target and (target[:40] in text or (target_tokens and sum(token in text for token in target_tokens) >= max(1, len(target_tokens)//2))):
                matched_root = root
                break
        except Exception:
            continue
    if matched_root is None:
        matched_root = page.locator('body')
    labels = re.compile(r'^(?:Views|浏览量|Vues|Visualisations|Average watch time|平均观看时长|Engagement|互动次数|Engagements?)$', re.I)
    clickable = matched_root.locator('[role="button"]:visible, a:visible, button:visible, [tabindex="0"]:visible')
    clicked = False
    for index in range(await clickable.count()):
        item = clickable.nth(index)
        try:
            text = re.sub(r'\s+', ' ', await item.inner_text(timeout=500)).strip()
            lowered = text.lower()
            if 'see all' in lowered or '查看全部' in lowered or 'voir tout' in lowered:
                continue
            if any(word.lower() in lowered for word in ('views', '浏览量', 'vues', 'engagement', '互动次数')) and (not target_tokens or sum(token in lowered for token in target_tokens) >= 1):
                await item.scroll_into_view_if_needed()
                await item.click(timeout=3500, force=True)
                clicked = True
                await page.wait_for_timeout(3000)
                break
        except Exception:
            continue
    if not clicked:
        try:
            clicked = await page.evaluate(r"""(payload) => {
              const norm = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
              const tokens = payload.tokens || [];
              const visible = el => { const b = el.getBoundingClientRect(); const s = getComputedStyle(el); return b.width > 30 && b.height > 30 && s.display !== 'none' && s.visibility !== 'hidden'; };
              const images = Array.from(document.querySelectorAll('img')).filter(visible);
              let best = null;
              for (const image of images) {
                let node = image;
                for (let depth = 0; node && depth < 8; depth += 1, node = node.parentElement) {
                  const text = norm(node.innerText || node.getAttribute('aria-label') || node.getAttribute('title'));
                  if (!text || /see all|查看全部|voir tout|全て見る/.test(text)) continue;
                  const metricHits = ['浏览量','平均观看时长','互动','views','average watch time','engagement','vues'].filter(x => text.includes(x)).length;
                  const tokenHits = tokens.filter(x => text.includes(x)).length;
                  const contentHint = /内容|content|contenu|콘텐츠/.test(text) ? 4 : 0;
                  const score = tokenHits * 20 + metricHits * 8 + contentHint - Math.min(text.length / 400, 5) - depth;
                  if (metricHits && (!best || score > best.score)) best = {node, score};
                }
              }
              if (!best) return false;
              best.node.scrollIntoView({block:'center', inline:'center'});
              best.node.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
              best.node.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
              best.node.click();
              return true;
            }""", {'tokens': target_tokens[:8]})
            if clicked:
                work['dashboard_card_click'] = 'content_thumbnail_or_card'
                save_works(works)
                await page.wait_for_timeout(3500)
        except Exception:
            pass
    if not clicked:
        try:
            clicked = await page.evaluate(r"""(payload) => {
              const normalize = value => (value || '').replace(/\s+/g, ' ').trim().toLowerCase();
              const targetTokens = payload.tokens || [];
              const labels = ['浏览量', '观看', '平均观看时长', '互动', 'views', 'engagement', 'average watch time', 'vues'];
              const visible = el => {
                const box = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                return box.width > 10 && box.height > 10 && style.display !== 'none' && style.visibility !== 'hidden';
              };
              const candidates = Array.from(document.querySelectorAll('div,span,a,button,[role=button],[tabindex="0"]'))
                .filter(visible)
                .map(el => ({el, text: normalize(el.innerText || el.getAttribute('aria-label') || el.getAttribute('title'))}))
                .filter(item => item.text && labels.some(label => item.text.includes(label)) && !/see all|查看全部|voir tout|전체 보기/.test(item.text));
              let best = null;
              for (const item of candidates) {
                let node = item.el;
                let depth = 0;
                while (node && depth < 6) {
                  const text = normalize(node.innerText || '');
                  const tokenHits = targetTokens.filter(token => text.includes(token)).length;
                  const contentHint = /内容|content|contenu|콘텐츠/.test(text) ? 3 : 0;
                  const metricHint = labels.filter(label => text.includes(label)).length;
                  const sizePenalty = Math.min(text.length / 500, 4);
                  const score = tokenHits * 10 + contentHint * 4 + metricHint * 2 - sizePenalty - depth;
                  if (!best || score > best.score) best = {el: node, score};
                  node = node.parentElement;
                  depth += 1;
                }
              }
              if (!best) return false;
              best.el.scrollIntoView({block:'center', inline:'center'});
              best.el.dispatchEvent(new MouseEvent('mousedown', {bubbles:true, cancelable:true, view:window}));
              best.el.dispatchEvent(new MouseEvent('mouseup', {bubbles:true, cancelable:true, view:window}));
              best.el.click();
              return true;
            }""", {'tokens': target_tokens[:8]})
            if clicked:
                work['dashboard_card_click'] = 'content_metric_card_dom_fallback'
                save_works(works)
                await page.wait_for_timeout(3500)
        except Exception:
            pass
    if clicked:
        for opened_page in page.context.pages:
            if is_insights_url(opened_page.url):
                return await collect_insights_metrics(opened_page, work, opened_page.url)
        if is_insights_url(page.url):
            return await collect_insights_metrics(page, work, page.url)
    accessible = await page.locator('[aria-label], [title]').evaluate_all("els => els.map(e => [e.getAttribute('aria-label'), e.getAttribute('title'), (e.innerText || '').trim()].filter(Boolean).join(' ')).filter(Boolean).slice(0, 800)")
    metric_text = body + ' ' + re.sub(r'\s+', ' ', ' '.join(accessible))
    views = extract_metric(metric_text, [r'(?:views|浏览量|vues|visualisations)[^0-9]{0,30}(\d[\d,.]*\s*[KMB]?)', r'(\d[\d,.]*\s*[KMB]?)\\s*(?:views|浏览量|vues)'])
    interactions = extract_metric(metric_text, [r'(?:engagement|互动次数|engagements)[^0-9]{0,30}(\d[\d,.]*\s*[KMB]?)', r'(\d[\d,.]*\s*[KMB]?)\\s*(?:engagement|互动次数)'])
    work['_pending_plays'] = views
    work['_pending_reach'] = None
    work['dashboard_source'] = 'https://www.facebook.com/professional_dashboard/'
    if views is None and interactions is None:
        raise RuntimeError('专业仪表板首页 Content 区域没有匹配到该作品，且未进入成效分析')
    return views, interactions, None


async def collect_professional_library_metrics(page, work: dict[str, Any]) -> tuple[int | None, int | None, int | None]:
    """从专业内容库目标作品行的三点菜单进入该帖子的独立成效分析页面。"""
    library_url = 'https://www.facebook.com/professional_dashboard/content/content_library'
    await page.goto(library_url, wait_until='domcontentloaded', timeout=30000)
    await page.wait_for_timeout(4500)
    target = re.sub(r'\s+', ' ', str(work.get('text_summary') or '')).strip().lower()
    tokens = [item for item in re.findall(r'[\w\u4e00-\u9fff]{2,}', target)[:10] if item]
    rows = page.locator('[role="row"]:visible, tr:visible')
    target_row = None
    for index in range(await rows.count()):
        row = rows.nth(index)
        try:
            text = re.sub(r'\s+', ' ', await row.inner_text(timeout=700)).strip().lower()
            if not text or '预览' in text and '浏览量' in text and index == 0:
                continue
            hits = sum(token in text for token in tokens)
            if target and (target[:40] in text or hits >= max(1, len(tokens)//2)):
                target_row = row
                work['library_match_mode'] = 'caption_or_token'
                break
        except Exception:
            continue
    if target_row is None:
        raise RuntimeError('内容库中没有按文案匹配到刚发布的作品行')
    # 你截图标记的是作品文案名称本身，不是右侧三点菜单；优先点击该名称链接/文本。
    name_candidates = [
        target_row.locator('a:visible').filter(has_text=re.compile(re.escape(target[:36]), re.I)).first if target else target_row.locator('a:visible').first,
        target_row.locator('[role="link"]:visible').first,
        target_row.get_by_text(re.compile(re.escape(target[:36]), re.I), exact=False).first if target else target_row.get_by_text(re.compile(r'.+'), exact=False).first,
    ]
    name_clicked = False
    for name in name_candidates:
        try:
            if await name.count() and await name.is_visible(timeout=1200):
                await name.scroll_into_view_if_needed()
                await name.click(timeout=5000, force=True)
                name_clicked = True
                work['library_name_click'] = 'caption_name'
                await page.wait_for_timeout(3500)
                break
        except Exception:
            continue
    if not name_clicked:
        raise RuntimeError('已匹配内容库作品行，但没有找到可点击的作品名称')
    work['library_insights_click'] = name_clicked
    for opened_page in page.context.pages:
        if is_insights_url(opened_page.url):
            work['insights_url'] = opened_page.url
            work['url'] = opened_page.url
            return await collect_insights_metrics(opened_page, work, opened_page.url)
    if is_insights_url(page.url):
        work['insights_url'] = page.url
        work['url'] = page.url
        return await collect_insights_metrics(page, work, page.url)
    raise RuntimeError('已点击作品名称，但没有进入帖子成效分析页面')


async def collect_professional_metrics(page, work: dict[str, Any]) -> tuple[int | None, int | None, int | None]:
    await page.goto(PROFESSIONAL_CONTENT_URL, wait_until='domcontentloaded', timeout=30000)
    await page.wait_for_timeout(3500)
    target = re.sub(r'\s+', ' ', str(work.get('text_summary') or '')).strip().lower()
    if target:
        try:
            candidates = page.locator('input[placeholder], input[aria-label], input[type="search"]')
            for index in range(await candidates.count()):
                field = candidates.nth(index)
                label = ((await field.get_attribute('placeholder')) or '') + ' ' + ((await field.get_attribute('aria-label')) or '')
                if any(word in label.lower() for word in ('搜索', 'search', 'recherche', 'rechercher', '검색')):
                    await field.fill(target[:80])
                    await field.press('Enter')
                    await page.wait_for_timeout(1800)
                    break
        except Exception:
            pass
    target_tokens = [token for token in re.findall(r'[\w\u4e00-\u9fff]{3,}', target)[:8] if token]
    headers = await page.locator('[role="columnheader"], th').all_inner_texts()
    header_text = [re.sub(r'\s+', ' ', item).strip().lower() for item in headers]
    aliases = {
        'views': ('浏览量', 'views', 'visualisations', 'vues', 'viewers'),
        'interactions': ('互动次数', 'interactions', 'engagement', 'engagements', 'interactions'),
        'comments': ('评论数', 'comments', 'commentaires', 'commentaire'),
        'plays': ('播放次数', 'plays', 'lectures', 'video views', 'watch'),
        'reach': ('传播量', 'reach', 'portée', 'people reached'),
    }
    indexes: dict[str, int] = {}
    for metric, words in aliases.items():
        for index, header in enumerate(header_text):
            if any(word in header for word in words):
                indexes[metric] = index
                break
    rows = page.locator('[role="row"], tr')
    count = await rows.count()
    target_cells = None
    for index in range(1, count):
        row = rows.nth(index)
        text = re.sub(r'\s+', ' ', await row.inner_text()).strip()
        lowered = text.lower()
        if target and (target[:40] in lowered or (target_tokens and sum(token in lowered for token in target_tokens) >= max(1, len(target_tokens) // 2))):
            cells = row.locator('[role="gridcell"], [role="cell"], td')
            if await cells.count() >= 2:
                target_cells = [re.sub(r'\s+', ' ', item).strip() for item in await cells.all_inner_texts()]
            break
    if not target_cells:
        raise RuntimeError('专业仪表板内容库中没有匹配到该作品，请确认作品链接和文案对应同一条内容')
    def cell_metric(metric: str) -> int | None:
        index = indexes.get(metric)
        if index is None or index >= len(target_cells):
            return None
        return parse_metric_value(target_cells[index])
    views = cell_metric('views')
    interactions = cell_metric('interactions')
    comments = cell_metric('comments')
    work['_pending_plays'] = cell_metric('plays')
    work['_pending_reach'] = cell_metric('reach')
    work['dashboard_source'] = PROFESSIONAL_CONTENT_URL
    if views is None and interactions is None and comments is None and work.get('_pending_plays') is None and work.get('_pending_reach') is None:
        raise RuntimeError('已进入专业仪表板，但匹配行没有可读统计数字')
    return views, interactions, comments


async def collect_facebook_metrics(work: dict[str, Any]) -> tuple[int | None, int | None, int | None]:
    if not work.get('url'):
        raise RuntimeError('请先绑定具体 Facebook 作品链接')
    debug = await BitAdapter(BIT_BASE).open_profile(str(work.get('profile_id')))
    data = debug.get('data', {}) if isinstance(debug, dict) else {}
    raw_endpoint = data.get('http') or data.get('httpDebugAddress') or data.get('debugAddress') or data.get('ws') or data.get('wsDebugAddress')
    work['cdp_raw_endpoint'] = str(raw_endpoint or '')
    debug_http = await resolve_cdp_endpoint(raw_endpoint)
    work['cdp_resolved_endpoint'] = debug_http
    save_works(works)
    if not debug_http:
        raise RuntimeError(f'无法取得该 BitBrowser 窗口的调试地址；原始返回字段：{list(data.keys())}')
    try:
        from playwright.async_api import async_playwright
    except Exception as exc:
        raise RuntimeError(f'运行环境缺少 Playwright：{exc}') from exc
    async with async_playwright() as playwright:
        try:
            browser = await playwright.chromium.connect_over_cdp(debug_http)
        except Exception as exc:
            raise RuntimeError(f'CDP 连接失败；原始地址={work.get("cdp_raw_endpoint", "")};解析地址={debug_http};错误={exc}') from exc
        try:
            contexts = browser.contexts
            if not contexts:
                raise RuntimeError('BitBrowser 窗口没有可用浏览器上下文')
            pages = contexts[0].pages
            page = pages[0] if pages else await contexts[0].new_page()
            await page.goto(work['url'], wait_until='domcontentloaded', timeout=30000)
            await page.wait_for_timeout(2500)
            body = await page.locator('body').inner_text(timeout=10000)
            # 某些 Facebook 版本把互动统计放在点击后才出现的浮层中，先尝试展开一次。
            try:
                import re as _re
                trigger = page.get_by_text(_re.compile(r'comments?|commentaires?|commentaire|评论|réactions?|点赞|赞', _re.IGNORECASE), exact=False).last
                if await trigger.is_visible(timeout=800):
                    await trigger.click(timeout=1800, force=True)
                    await page.wait_for_timeout(900)
                    body = await page.locator('body').inner_text(timeout=10000)
            except Exception:
                pass
            accessible = await page.locator('[aria-label], [title]').evaluate_all("els => els.map(e => [e.getAttribute('aria-label'), e.getAttribute('title'), (e.innerText || '').trim()].filter(Boolean).join(' ')).filter(Boolean).slice(0, 500)")
            buttons = await page.locator('[role=button], button').all_inner_texts()
            metric_text = body + '\\n' + '\\n'.join(accessible) + '\\n' + '\\n'.join(buttons)
            if '/content/insights/' in str(work.get('url') or '') or 'content_id=' in str(work.get('url') or ''):
                try:
                    return await collect_insights_metrics(page, work, str(work.get('url')))
                except Exception as insights_exc:
                    work['insights_message'] = str(insights_exc)
            if work.get('account_mode') == 'professional':
                try:
                    return await collect_professional_library_metrics(page, work)
                except Exception as library_exc:
                    work['dashboard_library_message'] = str(library_exc)
                try:
                    return await collect_professional_home_metrics(page, work)
                except Exception as home_exc:
                    work['dashboard_home_message'] = str(home_exc)
            views = extract_metric(metric_text, [r'(\d[\d,.]*\s*[KMB]?)\\s*(?:views|vues|visualisations|观看|次观看|人次|portée|reach)', r'(?:观看|浏览量|视觉isations|portée|reach)[^\\d]{0,30}(\d[\d,.]*\s*[KMB]?)'])
            likes = extract_metric(metric_text, [r'(\d[\d,.]*\s*[KMB]?)\\s*(?:likes?|j.?aime|mentions j.?aime|réactions?|réaction|赞|点赞)', r'(?:点赞|赞|réactions?|j.?aime)[^\\d]{0,30}(\d[\d,.]*\s*[KMB]?)'])
            comments = extract_metric(metric_text, [r'(\\d[\\d,.]*\\s*(?:K|M|B)?)\\s*(?:comments?|commentaires?|commentaire|评论)', r'(?:评论|commentaires?|commentaire)[^\\d]{0,30}(\d[\d,.]*\s*[KMB]?)'])
            if views is None and likes is None and comments is None:
                try:
                    return await collect_professional_metrics(page, work)
                except Exception as dashboard_exc:
                    work['dashboard_message'] = str(dashboard_exc)
                lowered = metric_text.lower()
                if any(token in lowered for token in ('content isn\'t available', 'content not available', 'contenu indisponible', '内容不可用', 'login to facebook', 'se connecter à facebook')):
                    raise RuntimeError('作品页面不可访问或内容不可用，请确认账号登录状态和作品权限')
                raise RuntimeError('已打开作品页面，但该页面当前没有公开可见的浏览、点赞或评论数字；请确认链接指向具体公开作品，或使用有权限查看互动数据的账号')
            return views, likes, comments
        finally:
            # 由 async_playwright 上下文结束连接，避免旧版 Playwright 不支持 browser.disconnect。
            pass


def apply_metrics(work: dict[str, Any], views: int | None, likes: int | None, comments: int | None) -> dict[str, Any]:
    now = time.time()
    previous = {key: work.get(key) for key in ('views', 'likes', 'comments', 'interactions', 'plays', 'reach')}
    for key in previous:
        work[f'previous_{key}'] = previous[key]
    professional_interactions = work.pop('_pending_interactions', None)
    professional_plays = work.pop('_pending_plays', None)
    professional_reach = work.pop('_pending_reach', None)
    values = {
        'views': views,
        'likes': likes,
        'comments': comments,
        'interactions': professional_interactions if professional_interactions is not None else (likes if likes is not None else previous['interactions']),
        'plays': professional_plays,
        'reach': professional_reach,
    }
    for key, value in values.items():
        work[key] = value if value is not None else previous[key]
    elapsed_hours = (now - float(work.get('last_collected_at') or now)) / 3600
    for key, value in values.items():
        old = previous[key]
        # Facebook 统计可能因刷新、权限或时间范围切换而回落；回落值不能当作增长量展示。
        delta = value - old if value is not None and old is not None and value >= old else None
        work[f'delta_{key}'] = delta
        work[f'hourly_{key}'] = round(delta / elapsed_hours, 2) if delta is not None and elapsed_hours >= 1 / 60 else None
    work['last_collected_at'] = now
    work['collect_status'] = 'collected'
    work['collect_message'] = '采集成功'
    history = work.setdefault('history', [])
    history.append({'at': now, **{key: values[key] for key in values}})
    work['history'] = history[-100:]
    save_works(works)
    return work


async def collect_work_with_lifecycle(work: dict[str, Any]):
    profile_id = str(work.get('profile_id') or '')
    adapter = BitAdapter(BIT_BASE)
    was_open = False
    if profile_id:
        try:
            ports = await adapter.opened_ports()
            raw = ports.get('data', {}) if isinstance(ports, dict) else {}
            if isinstance(raw, dict):
                was_open = profile_id in raw or any(str(key) == profile_id for key in raw.keys())
            elif isinstance(raw, list):
                was_open = any(str(item.get('id') or item.get('profile_id')) == profile_id for item in raw if isinstance(item, dict))
            if not was_open:
                emit('INFO', f'作品采集：环境 {profile_id} 原本关闭，正在自动打开')
        except Exception:
            was_open = False
    try:
        return await collect_facebook_metrics(work)
    finally:
        if profile_id and not was_open:
            try:
                await adapter.close_profile(profile_id)
                emit('INFO', f'作品采集完成：环境 {profile_id} 已关闭')
            except Exception as exc:
                emit('WARN', f'环境 {profile_id} 采集后关闭失败：{exc}')


@app.post('/works/{work_id}/collect')
async def collect_work(work_id: str):
    work = next((item for item in works if item.get('id') == work_id), None)
    if not work:
        raise HTTPException(404, '作品记录不存在')
    work['collect_status'] = 'collecting'
    work['collect_message'] = '正在打开 BitBrowser 窗口采集指标'
    work['last_collect_attempt_at'] = time.time()
    save_works(works)
    try:
        views, likes, comments = await collect_work_with_lifecycle(work)
        return apply_metrics(work, views, likes, comments)
    except Exception as exc:
        work['collect_status'] = 'failed'
        work['collect_message'] = f'采集失败：{exc}'
        save_works(works)
        raise HTTPException(502, work['collect_message'])


class DeleteWorksRequest(BaseModel):
    ids: list[str] = Field(default_factory=list)


@app.delete('/works/{work_id}')
async def delete_work(work_id: str):
    global works
    before = len(works)
    works = [item for item in works if item.get('id') != work_id]
    if len(works) == before:
        raise HTTPException(404, '作品监测记录不存在')
    save_works(works)
    return {'ok': True, 'deleted': 1, 'id': work_id}


@app.post('/works/delete-batch')
async def delete_works_batch(req: DeleteWorksRequest):
    global works
    ids = {str(item) for item in req.ids if str(item).strip()}
    before = len(works)
    works = [item for item in works if item.get('id') not in ids]
    deleted = before - len(works)
    if deleted:
        save_works(works)
    return {'ok': True, 'deleted': deleted, 'ids': list(ids)}


class WorkLinkRequest(BaseModel):
    url: str = Field(default='')


@app.post('/works/{work_id}/link')
async def update_work_link(work_id: str, req: WorkLinkRequest):
    work = next((item for item in works if item.get('id') == work_id), None)
    if not work:
        raise HTTPException(404, '作品记录不存在')
    value = req.url.strip()
    if value and not value.startswith(('http://', 'https://')):
        raise HTTPException(400, '作品链接必须以 http:// 或 https:// 开头')
    work['url'] = value
    work['link_status'] = 'bound' if value else 'missing'
    work['collect_message'] = '已绑定作品链接，等待采集' if value else '作品链接暂未绑定'
    save_works(works)
    return work


@app.post('/works/{work_id}/metrics')
async def update_work_metrics(work_id: str, req: MetricsRequest):
    work = next((item for item in works if item.get('id') == work_id), None)
    if not work:
        raise HTTPException(404, '作品记录不存在')
    if req.views is None and req.likes is None and req.comments is None:
        raise HTTPException(400, '至少填写一项指标')
    return apply_metrics(work, req.views, req.likes, req.comments)


@app.post('/works/refresh')
async def refresh_works():
    for work in works:
        if work.get('collect_status') != 'collected':
            work['collect_message'] = '暂未采集'
    save_works(works)
    return {'items': list(reversed(works)), 'refresh_seconds': 600}


@app.get('/tasks')
async def list_tasks():
    return {'items': list(reversed(list(tasks.values())))}

@app.get('/tasks/{task_id}')
async def get_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(404, '任务不存在')
    return task

async def launch_task(task_id: str) -> None:
    record = tasks.get(task_id)
    if not record or record.get('status') in ('completed', 'cancelled'):
        return
    existing = task_handles.get(task_id)
    if existing and not existing.done():
        return
    record['status'] = 'running'
    record['phase'] = 'queued'
    record['updated_at'] = time.time()
    save_tasks(tasks)
    req = TaskRequest.model_validate(record.get('request') or {})
    handle = asyncio.create_task(run_task(task_id, req), name=f'wuji-assistant-task-{task_id}')
    task_handles[task_id] = handle
    def cleanup(done: asyncio.Task) -> None:
        task_handles.pop(task_id, None)
        save_tasks(tasks)
    handle.add_done_callback(cleanup)

async def scheduler_loop() -> None:
    while True:
        now = time.time()
        for task_id, record in list(tasks.items()):
            if record.get('status') != 'scheduled':
                continue
            due = float(record.get('scheduled_at') or 0)
            weekdays = record.get('schedule_weekdays') or []
            if due > now or (record.get('schedule_type') == 'weekly' and weekdays and time.localtime(now).tm_wday not in weekdays):
                continue
            await launch_task(task_id)
            if record.get('schedule_type') == 'once':
                record['status'] = 'completed' if record.get('status') == 'scheduled' else record.get('status')
            else:
                step = 86400 if record.get('schedule_type') == 'daily' else 604800
                record['scheduled_at'] = due + step
                record['status'] = 'scheduled'
            save_tasks(tasks)
        await asyncio.sleep(5)

@app.on_event('startup')
async def start_scheduler():
    global scheduler_handle
    scheduler_handle = asyncio.create_task(scheduler_loop(), name='wuji-assistant-scheduler')


async def force_close_task_profiles(task: dict[str, Any]) -> None:
    profile_ids = list(dict.fromkeys(str(item) for item in task.get('opened_profiles', []) if item))
    if not profile_ids:
        return
    adapter = BitAdapter(BIT_BASE)
    results = await asyncio.gather(*(adapter.close_profile(pid) for pid in profile_ids), return_exceptions=True)
    for pid, result in zip(profile_ids, results):
        if isinstance(result, Exception):
            emit('WARN', f'强制停止后关闭窗口失败：{pid}：{result}', task.get('id'), pid)
        else:
            emit('INFO', f'强制停止：已关闭 BitBrowser 窗口 {pid}', task.get('id'), pid)
    task['opened_profiles'] = []


async def force_cancel_task(task: dict[str, Any]) -> None:
    task['cancel_requested'] = True
    task['phase'] = 'cancelling'
    handle = task_handles.get(str(task.get('id')))
    if handle and not handle.done():
        handle.cancel()
    await force_close_task_profiles(task)
    task['status'] = 'cancelled'
    task['phase'] = 'cancelled'
    task['updated_at'] = time.time()


@app.post('/tasks/cancel-all')
async def cancel_all_tasks():
    running = [task for task in tasks.values() if task.get('status') == 'running']
    await asyncio.gather(*(force_cancel_task(task) for task in running), return_exceptions=True)
    for task in running:
        emit('WARN', '已强制停止任务：任务队列、页面操作、等待和采集均已终止', task.get('id'))
    return {'ok': True, 'cancelled': len(running), 'task_ids': [task.get('id') for task in running], 'forced': True}


@app.post('/tasks/{task_id}/cancel')
async def cancel_task(task_id: str):
    task = tasks.get(task_id)
    if not task:
        raise HTTPException(404, '任务不存在')
    if task.get('status') == 'running':
        await force_cancel_task(task)
        emit('WARN', '已强制停止任务：任务队列、页面操作、等待和采集均已终止', task_id)
    return task


@app.post('/bitbrowser/profiles/{profile_id}/close')
async def close_profile(profile_id: str):
    try:
        return await BitAdapter(BIT_BASE).close_profile(profile_id)
    except Exception as exc:
        raise HTTPException(502, f'关闭 BitBrowser 窗口失败：{exc}')


@app.get('/stats')
async def stats():
    values = list(tasks.values())
    return {'total': len(values), 'running': sum(x['status'] == 'running' for x in values), 'success': sum(x['status'] == 'completed' for x in values), 'failed': sum(x['status'] == 'failed' for x in values)}


@app.post('/tasks')
async def create_task(req: TaskRequest):
    if not req.profile_ids:
        raise HTTPException(400, '至少选择一个窗口环境')
    if req.schedule_type != 'once' and not req.scheduled_at:
        raise HTTPException(400, '重复任务必须填写首次执行时间')
    if req.schedule_type == 'weekly' and not req.schedule_weekdays:
        raise HTTPException(400, '每周任务至少选择一个星期几')
    task_id = uuid.uuid4().hex[:12]
    now = time.time()
    initial_status = 'scheduled' if req.scheduled_at and req.scheduled_at > now else 'running'
    tasks[task_id] = {'id': task_id, 'status': initial_status, 'phase': 'scheduled' if initial_status == 'scheduled' else 'queued', 'created_at': now, 'updated_at': now, 'total': len(req.profile_ids), 'profile_ids': list(req.profile_ids), 'opened_profiles': [], 'results': [], 'last_message': '任务已创建' if initial_status == 'running' else '任务已排期', 'scheduled_at': req.scheduled_at, 'schedule_type': req.schedule_type, 'schedule_weekdays': req.schedule_weekdays, 'request': req.model_dump()}
    save_tasks(tasks)
    emit('INFO', f'任务已创建，共 {len(req.profile_ids)} 个窗口，状态：{initial_status}', task_id)
    if initial_status == 'running':
        await launch_task(task_id)
    return tasks[task_id]

@app.post('/tasks/{task_id}/retry')
async def retry_task(task_id: str):
    source = tasks.get(task_id)
    if not source:
        raise HTTPException(404, '任务不存在')
    req_data = source.get('request')
    if not req_data:
        raise HTTPException(400, '该历史任务没有可重发的文案和素材')
    req_data = dict(req_data)
    req_data['scheduled_at'] = None
    req_data['schedule_type'] = 'once'
    req_data['schedule_weekdays'] = []
    return await create_task(TaskRequest.model_validate(req_data))


async def run_task(task_id: str, req: TaskRequest):
    adapter = BitAdapter(BIT_BASE)
    tasks[task_id]['phase'] = 'loading-profiles'
    emit('INFO', '正在读取 BitBrowser 窗口列表……', task_id)
    try:
        profiles_payload = await asyncio.wait_for(adapter.list_profiles(), timeout=25)
        profiles = normalize_profiles(profiles_payload)
        if not profiles:
            raise RuntimeError('BitBrowser 返回窗口列表为空，请确认窗口环境已创建')
        emit('INFO', f'窗口列表读取完成，共 {len(profiles)} 个窗口', task_id)
    except Exception as exc:
        tasks[task_id]['status'] = 'failed'
        tasks[task_id]['phase'] = 'failed'
        emit('ERROR', f'无法读取窗口列表：{exc}', task_id)
        return
    tasks[task_id]['phase'] = 'prechecking'
    emit('INFO', '开始检查文案和素材……', task_id)
    by_id = {p['id']: p for p in profiles}
    sem = asyncio.Semaphore(req.concurrency)
    async def one(pid):
        async with sem:
            return await publish_one(task_id, by_id.get(pid, {'id': pid, 'name': pid}), req.content_by_profile.get(pid, Content()), req.dry_run, req.retry_limit, req.collect_after_publish)
    tasks[task_id]['phase'] = 'publishing'
    emit('INFO', f'开始执行 {len(req.profile_ids)} 个窗口任务……', task_id)
    results = await asyncio.gather(*(one(pid) for pid in req.profile_ids))
    tasks[task_id]['results'] = results
    tasks[task_id]['updated_at'] = time.time()
    save_tasks(tasks)
    if tasks[task_id].get('cancel_requested'):
        tasks[task_id]['status'] = 'cancelled'
        tasks[task_id]['phase'] = 'cancelled'
    else:
        tasks[task_id]['status'] = 'completed' if all(r['status'] in ('dry-run', 'opened-awaiting-publisher', 'published', 'submitted-unverified', 'skipped') for r in results) else 'failed'
    tasks[task_id]['phase'] = 'completed' if tasks[task_id]['status'] == 'completed' else 'failed'
    emit('INFO', f'任务结束：{tasks[task_id]["status"]}', task_id)
    tasks[task_id]['last_message'] = '任务执行完成' if tasks[task_id]['status'] == 'completed' else '任务失败，文案和素材已保留，可再次重发'
    save_tasks(tasks)
