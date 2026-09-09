from __future__ import annotations

import asyncio
import re
from pathlib import Path
from typing import Any


PUBLISHER_VERSION = 'adaptive-v6-professional-reels'


class FacebookPublishError(RuntimeError):
    pass


# 支持带姓名后缀的多语言模糊匹配，例如 "What's on your mind, 윤?"
POST_ENTRY_RE = re.compile(
    r"创建帖子|发帖|分享你的新鲜事吧|你在想什么|"
    r"what[’']?s\s+on\s+your\s+mind|share\s+a\s+thought|create\s+post|post|"
    r"무슨\s*생각을\s*하고\s*계신가요|무슨\s*생각을\s*하고\s*있나요|무엇을\s*공유|게시물|게시|"
    r"quoi\s+de\s+neuf|partager\s+une\s+pensée|partagez\s+une\s+idée|à\s+quoi\s+pensez-vous|créer\s+une\s+publication|publier",
    re.I,
)

DIALOG_RE = re.compile(
    r"创建帖子|发帖|分享你的新鲜事吧|你在想什么|"
    r"what[’']?s on your mind|share\s+a\s+thought|create\s+post|"
    r"무슨 생각을 하고 계신가요|무슨 생각을 하고 있나요|무엇을\s*공유|게시물|"
    r"quoi de neuf|partager\s+une\s+pensée|partagez\s+une\s+idée|à quoi pensez-vous|créer\s+une\s+publication",
    re.I,
)

ADD_MEDIA_RE = re.compile(
    r"添加照片\s*(?:/|／|或)\s*视频|照片\s*(?:/|／|或)\s*视频|"
    r"add\s+photos?(?:\s*(?:/|or)\s*videos?)?|photos?\s*(?:/|or)\s*videos?|"
    r"사진\s*(?:/|또는|및)\s*동영상\s*추가|사진.*동영상|"
    r"ajouter\s+des\s+photos?(?:\s*(?:/|ou)\s*des\s+vidéos?)?|"
    r"photos?.*vidéos?",
    re.I,
)

PUBLISH_RE = re.compile(
    r"^(?:发帖|发布|post|publish|게시|게시물\s*게시|publier)$",
    re.I,
)

NEXT_RE = re.compile(r"^(?:下一页|下一步|next|continue|suivant|continuer|다음|계속)$", re.I)
PROFESSIONAL_MARKER_RE = re.compile(
    r"专业模式|专业主页|professional\s+(?:mode|dashboard)|professional\s+profile|"
    r"mode\s+professionnel|profil\s+professionnel|modo\s+profesional|"
    r"프로페셔널\s*모드|프로페셔널\s*대시보드|전문\s*프로필",
    re.I,
)


async def _visible(locator) -> bool:
    try:
        return await locator.count() > 0 and await locator.last.is_visible()
    except Exception:
        return False


async def _click_text(page, pattern: re.Pattern[str], timeout: int = 2500) -> bool:
    """Click only a visible candidate; role buttons are preferred, then text nodes."""
    from playwright.async_api import TimeoutError as PlaywrightTimeoutError

    candidates = [
        page.get_by_role('button', name=pattern).last,
        page.locator('[role="button"]:visible').filter(has_text=pattern).last,
        page.get_by_text(pattern, exact=False).last,
    ]
    for locator in candidates:
        try:
            await locator.wait_for(state='visible', timeout=timeout)
            if await locator.is_enabled():
                await locator.scroll_into_view_if_needed()
                await locator.click(timeout=timeout)
                return True
        except (PlaywrightTimeoutError, Exception):
            continue
    return False


async def _dialog_with_preview(page):
    """优先返回当前包含视频/图片预览的可见发帖对话框。"""
    dialogs = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
    for index in range(await dialogs.count() - 1, -1, -1):
        try:
            dialog = dialogs.nth(index)
            preview = dialog.locator('video, img[src^="blob:"], img[src*="scontent"], [aria-label*="remove" i], [aria-label*="supprimer" i]')
            if await preview.count():
                return dialog
        except Exception:
            continue
    return None


async def _post_dialog(page):
    """Return a visible post dialog; fall back to a visible modal containing an editor."""
    text_candidates = [
        page.locator('[role="dialog"]:visible').filter(has_text=DIALOG_RE).last,
        page.locator('[aria-modal="true"]:visible').filter(has_text=DIALOG_RE).last,
    ]
    for locator in text_candidates:
        try:
            if await locator.count() and await locator.is_visible():
                return locator
        except Exception:
            pass

    # 新版 Facebook 有时对话框标题没有出现在可访问文本中；
    # 此时用“可见模态 + 发帖编辑框”判断，聊天框通常不在 role=dialog 内。
    modal_candidates = [
        page.locator('[role="dialog"]:visible').last,
        page.locator('[aria-modal="true"]:visible').last,
    ]
    for locator in modal_candidates:
        try:
            if not await locator.count() or not await locator.is_visible():
                continue
            editor_count = await locator.locator('[contenteditable="true"], [role="textbox"], textarea').count()
            if editor_count:
                return locator
        except Exception:
            continue
    return None


async def _page_diagnostic(page) -> str:
    """生成不含正文内容的页面诊断，便于定位个别窗口的 Facebook 版本差异。"""
    try:
        title = (await page.title())[:120]
    except Exception:
        title = ''
    try:
        url = page.url
        body = (await page.locator('body').inner_text(timeout=2500)).replace('\\n', ' ').strip()[:260]
    except Exception:
        url, body = page.url, ''
    return f'url={url}; title={title}; body={body}'


async def _wait_page_ready(page, timeout: int = 12000) -> None:
    """等待 Facebook SPA 完成基本渲染；networkidle 不稳定，因此只等待 DOM 和入口候选。"""
    try:
        await page.wait_for_load_state('domcontentloaded', timeout=timeout)
    except Exception:
        pass
    try:
        await page.locator('body').wait_for(state='visible', timeout=min(timeout, 5000))
    except Exception:
        pass
    await page.wait_for_timeout(1200)


async def _has_page_post_entry(page) -> bool:
    """判断当前页面是否存在可用的主页/个人主页发帖入口，但不主动点击。"""
    if await _post_dialog(page) is not None:
        return True
    # 不同 Facebook 版本会把入口渲染成 button、role=button、链接、输入框或可编辑占位节点。
    candidates = [
        page.get_by_role('button', name=POST_ENTRY_RE),
        page.get_by_role('link', name=POST_ENTRY_RE),
        page.locator('[role="button"]:visible').filter(has_text=POST_ENTRY_RE),
        page.locator('button:visible, a:visible, input:visible, textarea:visible').filter(has_text=POST_ENTRY_RE),
    ]
    for locator in candidates:
        try:
            count = await locator.count()
            for index in range(min(count, 8) - 1, -1, -1):
                if await locator.nth(index).is_visible(timeout=700):
                    return True
        except Exception:
            continue
    # 个人主页和首页在部分语言版本中只暴露 placeholder，而不是按钮名称。
    try:
        placeholders = page.locator('[contenteditable="true"][aria-placeholder]:visible, [role="textbox"][aria-placeholder]:visible, input[placeholder]:visible, textarea[placeholder]:visible')
        for index in range(await placeholders.count() - 1, -1, -1):
            item = placeholders.nth(index)
            value = ' '.join([
                await item.get_attribute('aria-placeholder') or '',
                await item.get_attribute('placeholder') or '',
                await item.get_attribute('aria-label') or '',
            ]).strip()
            if value and POST_ENTRY_RE.search(value):
                return True
    except Exception:
        pass
    return False


async def _ensure_publish_page(page, timeout: int = 12000):
    """确保发布前位于可发帖的首页或个人主页；其他页面自动导航并重新加载入口。"""
    await _wait_page_ready(page, timeout)
    for attempt in range(2):
        if await _has_page_post_entry(page):
            return
        if attempt:
            try:
                await page.reload(wait_until='domcontentloaded', timeout=timeout)
                await _wait_page_ready(page, timeout)
            except Exception:
                pass
    destinations = (
        'https://www.facebook.com/me',
        'https://www.facebook.com/',
        'https://www.facebook.com/profile.php',
    )
    last_url = page.url
    diagnostics = []
    for destination in destinations:
        for attempt in range(2):
            try:
                await page.goto(destination, wait_until='domcontentloaded', timeout=timeout)
                await _wait_page_ready(page, timeout)
                if await _has_page_post_entry(page):
                    return
                diagnostics.append(await _page_diagnostic(page))
                if attempt == 0:
                    await page.wait_for_timeout(1800)
            except Exception as exc:
                diagnostics.append(f'{destination}: {exc}')
    detail = diagnostics[-1] if diagnostics else f'url={last_url}'
    raise FacebookPublishError(
        f"当前页面 {last_url} 没有可用发帖入口，已尝试个人主页、首页和 profile.php；页面诊断：{detail}"
    )


async def _click_current_page_post_entry(page, timeout: int = 4000) -> bool:
    """优先点击当前个人主页真实的发帖卡片，避免把入口误判后导航到首页。"""
    # 针对带姓名后缀的多语言首页布局进行通用识别
    # 不使用精确匹配，而是使用模糊匹配，确保能识别 "What's on your mind, Name?"
    universal_entry_re = re.compile(
        r"what[’']?s\s+on\s+your\s+mind|share\s+a\s+thought|你在想什么|分享你的新鲜事吧|"
        r"무슨\s*생각|quoi\s+de\s+neuf|partagez\s+une\s+idée|à\s+quoi\s+pensez-vous",
        re.I
    )
    
    candidates = [
        # 1. 明确的 aria-label 入口 (新版首页最稳定特征)
        page.locator('[aria-label]').filter(has_text=universal_entry_re).filter(has=page.locator('img, svg')).last,
        # 2. 包含占位文本的圆角输入区域
        page.locator('[role="button"]:visible').filter(has_text=universal_entry_re).last,
        # 3. 结构特征识别：头像旁边的圆角按钮 (语言无关)
        page.locator('img[src*="profile"], img[alt*="profile"]').locator('xpath=./following::[role="button"]:visible').first,
        # 4. 带有特定 data-pagelet 属性的容器
        page.locator('[data-pagelet*="Composer" i] [role="button"]:visible').last,
        # 5. 最后的保底文本匹配
        page.locator('[role="button"]:visible').filter(has_text=POST_ENTRY_RE).last,
    ]
    for locator in candidates:
        try:
            count = await locator.count()
            for index in range(min(count, 8) - 1, -1, -1):
                item = locator.nth(index)
                if not await item.is_visible(timeout=700):
                    continue
                await item.scroll_into_view_if_needed()
                try:
                    await item.click(timeout=2500)
                except Exception:
                    try:
                        await item.click(timeout=2500, force=True)
                    except Exception:
                        parent = item.locator('xpath=..')
                        await parent.click(timeout=2500, force=True)
                return True
        except Exception:
            continue
    return await _click_text(page, POST_ENTRY_RE, timeout=timeout)


async def _open_post_dialog(page, timeout: int = 4000):
    dialog = await _post_dialog(page)
    if dialog is not None:
        return dialog

    # 先使用当前页面的个人主页/首页真实入口；只有完全没有入口时才由上层导航回退。
    opened = await _click_current_page_post_entry(page, timeout=timeout)
    if not opened:
        raise FacebookPublishError(
            f'当前页面未能点击 Facebook 发帖入口；页面诊断：{await _page_diagnostic(page)}'
        )

    deadline_ms = timeout + 7000
    elapsed = 0
    while elapsed < deadline_ms:
        dialog = await _post_dialog(page)
        if dialog is not None:
            return dialog
        # 某些个人主页先创建无 role=dialog 的编辑区域，再补齐模态属性；
        # 这里只接受带发帖占位文本的编辑器，不能把聊天框或搜索框误当成发帖框。
        try:
            composer_editors = page.locator('[contenteditable="true"][aria-placeholder]:visible, [role="textbox"][aria-placeholder]:visible, textarea[placeholder]:visible')
            for index in range(await composer_editors.count() - 1, -1, -1):
                item = composer_editors.nth(index)
                label = ' '.join([
                    await item.get_attribute('aria-placeholder') or '',
                    await item.get_attribute('placeholder') or '',
                    await item.get_attribute('aria-label') or '',
                ])
                if re.search(r"what[’']?s\s+on\s+your\s+mind|share\s+a\s+thought|quoi\s+de\s+neuf|partagez\s+une\s+idée|你在想什么|分享你的新鲜事吧|무슨 생각", label, re.I):
                    modal_roots = page.locator('[role="dialog"]:visible, [aria-modal="true"]:visible')
                    if await modal_roots.count():
                        return modal_roots.last
                    # 专业/创作者个人主页有时使用内嵌式 Composer，不创建 dialog；
                    # 返回包含编辑器和操作按钮的完整 Composer 容器，而不是单独的输入节点。
                    composer_roots = page.locator('[data-pagelet*="Composer" i]:visible')
                    if await composer_roots.count():
                        return composer_roots.last
                    for ancestor_level in range(1, 6):
                        try:
                            ancestor = item.locator('xpath=' + '/..' * ancestor_level)
                            box = await ancestor.bounding_box()
                            if box and box['width'] >= 260 and box['height'] >= 90:
                                return ancestor
                        except Exception:
                            continue
                    return item
        except Exception:
            pass
        await page.wait_for_timeout(250)
        elapsed += 250
    raise FacebookPublishError(
        f'已点击当前页面发帖入口，但未出现发布对话框；页面诊断：{await _page_diagnostic(page)}'
    )


async def _find_editor(dialog, page=None):
    # 策略 1：Facebook 新版编辑框的 aria-placeholder，比动态 class 稳定。
    if page is not None:
        placeholder_re = re.compile(
            r"quoi\s+de\s+neuf|what[’']?s\s+on\s+your\s+mind|"
            r"你在想什么|分享你的新鲜事吧|무슨 생각을 하고",
            re.I,
        )
        placeholders = page.locator('[contenteditable="true"][aria-placeholder], [role="textbox"][aria-placeholder]')
        for index in range(await placeholders.count() - 1, -1, -1):
            try:
                item = placeholders.nth(index)
                value = await item.get_attribute('aria-placeholder') or ''
                if placeholder_re.search(value) and await item.is_visible(timeout=500):
                    return item
            except Exception:
                continue

    # 策略 2：当前 dialog 内的标准编辑框。
    candidates = [
        dialog.locator('[contenteditable="true"][role="textbox"]:visible').last,
        dialog.locator('[data-lexical-editor="true"]:visible').last,
        dialog.locator('[contenteditable="true"]:visible').last,
        dialog.locator('[role="textbox"]:visible').last,
        dialog.locator('textarea:visible').last,
    ]
    for locator in candidates:
        try:
            await locator.wait_for(state='visible', timeout=3000)
            box = await locator.bounding_box()
            if box and box['width'] >= 180 and box['height'] >= 24:
                return locator
        except Exception:
            continue

    # Facebook 新版页面先显示占位文案，必须先点击“Quoi de neuf / What's on your mind”等区域，
    # 点击后才会创建真正的 contenteditable 节点。
    activator_re = re.compile(
        r"quoi de neuf|what[’']?s on your mind|你在想什么|分享你的新鲜事吧|"
        r"分享照片、视频或文字|무슨 생각을 하고|무엇을 게시|publier",
        re.I,
    )
    activation_roots = [dialog]
    if page is not None:
        activation_roots.append(page)
    for root in activation_roots:
        try:
            activators = root.get_by_text(activator_re, exact=False)
            for index in range(min(await activators.count(), 5)):
                activator = activators.nth(index)
                if await activator.is_visible(timeout=500):
                    await activator.click(timeout=2500)
                    await dialog.page.wait_for_timeout(500)
                    for retry_locator in candidates:
                        try:
                            await retry_locator.wait_for(state='visible', timeout=2500)
                            box = await retry_locator.bounding_box()
                            if box and box['width'] >= 180 and box['height'] >= 24:
                                return retry_locator
                        except Exception:
                            continue
                    break
        except Exception:
            continue

    # 法语等页面有时把编辑区域渲染成无 role 的 contenteditable，
    # 或者编辑区域不属于标准 dialog 节点；回退到页面中央最大的可编辑区域。
    if page is not None:
        global_candidates = page.locator('[contenteditable="true"]:visible, [role="textbox"]:visible, textarea:visible')
        ranked = []
        preview_root = await _dialog_with_preview(page)
        preview_box = None
        if preview_root is not None:
            try:
                preview_locator = preview_root.locator('video, img[src^="blob:"], img[src*="scontent"]').last
                preview_box = await preview_locator.bounding_box()
            except Exception:
                preview_box = None
        for index in range(await global_candidates.count()):
            try:
                item = global_candidates.nth(index)
                box = await item.bounding_box()
                if not box or box['width'] < 180 or box['height'] < 24:
                    continue
                # 如果页面同时有多个 dialog，只接受位于视频预览正上方、
                # 且与预览水平重叠的编辑框，确保文案和素材属于同一个帖子。
                if preview_box is not None:
                    candidate_center = box['x'] + box['width'] / 2
                    preview_center = preview_box['x'] + preview_box['width'] / 2
                    horizontal_match = abs(candidate_center - preview_center) <= max(180, preview_box['width'] * 0.6)
                    above_preview = box['y'] < preview_box['y'] + 20
                    if not (horizontal_match and above_preview):
                        continue
                    distance = abs((preview_box['y']) - (box['y'] + box['height']))
                    ranked.append((distance, item))
                else:
                    ranked.append((box['width'] * box['height'] * -1, item))
            except Exception:
                continue
        if ranked:
            ranked.sort(key=lambda pair: pair[0])
            return ranked[0][1]

        # Facebook 法语页面会给编辑框保留 aria-placeholder，例如：
        # “Quoi de neuf, Eva Fontaine ?”；该属性比动态 class 更稳定。
        placeholder_re = re.compile(
            r"quoi\s+de\s+neuf|what[’']?s\s+on\s+your\s+mind|"
            r"你在想什么|分享你的新鲜事吧|무슨 생각을 하고",
            re.I,
        )
        # 使用属性正则定位，避免依赖 Facebook 每次变化的 class 名称。
        placeholder_candidates = page.locator('[aria-placeholder]')
        placeholder_ranked = []
        for index in range(await placeholder_candidates.count()):
            try:
                item = placeholder_candidates.nth(index)
                value = await item.get_attribute('aria-placeholder') or ''
                if not placeholder_re.search(value):
                    continue
                box = await item.bounding_box()
                if box and box['width'] >= 120 and box['height'] >= 20:
                    distance = abs((preview_box['y'] if preview_box else 0) - (box['y'] + box['height']))
                    placeholder_ranked.append((distance, item))
            except Exception:
                continue
        if placeholder_ranked:
            placeholder_ranked.sort(key=lambda pair: pair[0])
            return placeholder_ranked[0][1]
    raise FacebookPublishError('没有找到发布对话框内的文案编辑框，已阻止写入聊天框')


async def _editor_text(editor) -> str:
    try:
        value = await editor.input_value()
        if value:
            return value.strip()
    except Exception:
        pass
    try:
        return (await editor.inner_text()).strip()
    except Exception:
        return ''


async def _fill_and_verify_editor(editor, text: str) -> None:
    if not text:
        return
    expected = text.strip()
    await editor.scroll_into_view_if_needed()

    # 视频预览层可能覆盖编辑框的鼠标命中区域；不要使用 click，
    # 直接通过 DOM focus + input 事件写入 Lexical contenteditable。
    is_contenteditable = await editor.get_attribute('contenteditable')
    if is_contenteditable == 'true':
        await editor.evaluate(
            """(el, value) => {
                el.focus();
                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(el);
                selection.removeAllRanges();
                selection.addRange(range);
                el.textContent = value;
                el.dispatchEvent(new InputEvent('input', {
                    bubbles: true, inputType: 'insertText', data: value
                }));
                el.dispatchEvent(new Event('change', {bubbles: true}));
            }""",
            text,
        )
    else:
        try:
            await editor.fill(text, timeout=5000)
        except Exception:
            await editor.focus()
            await editor.press('Control+A')
            await editor.press('Backspace')
            await editor.press_sequentially(text, delay=1)

    await editor.page.wait_for_timeout(350)
    current = await _editor_text(editor)
    if expected in current or (current and current in expected):
        return

    # DOM 写入未被 React/Lexical 接收时，再尝试非鼠标键盘输入。
    try:
        await editor.focus()
        await editor.press('Control+A')
        await editor.press('Backspace')
        await editor.press_sequentially(text, delay=1)
    except Exception:
        pass
    await editor.page.wait_for_timeout(350)
    if expected not in await _editor_text(editor):
        raise FacebookPublishError('文案未成功写入发布对话框，已阻止点击发布')


async def _upload_media(dialog, media: list[str]):
    # 法语新版 Facebook 的上传栏标题是“Ajouter à votre publication”，
    # 不一定直接显示“照片/视频”，必须先点击上传区域或图片图标才会创建 file input。
    upload_area_re = re.compile(
        r"ajouter\s+à\s+votre\s+publication|添加到你的帖子|添加到帖子|"
        r"add\s+to\s+your\s+post|add\s+to\s+your\s+publication|"
        r"사진|동영상|photo|vidéo|video",
        re.I,
    )
    await _click_text(dialog, ADD_MEDIA_RE, timeout=1200)
    await _click_text(dialog, upload_area_re, timeout=1800)
    await dialog.page.wait_for_timeout(500)

    file_input = dialog.locator('input[type="file"]')
    if await file_input.count() == 0:
        # Facebook 图标有时只有 aria-label/title，没有可访问的按钮文本；
        # 扫描发帖对话框内的按钮属性，避免误点关闭、表情或隐私按钮。
        button_candidates = dialog.locator('button:visible, [role="button"]:visible, [aria-label]:visible')
        media_button_re = re.compile(r"photo|photos|image|picture|video|vidéo|photo/vidéo|图片|照片|视频|동영상", re.I)
        for index in range(await button_candidates.count()):
            try:
                button = button_candidates.nth(index)
                attrs = await button.evaluate("""el => [
                    el.getAttribute('aria-label'), el.getAttribute('title'),
                    el.getAttribute('data-tooltip-content'), el.innerText
                ].filter(Boolean).join(' ')""")
                if not media_button_re.search(attrs or ''):
                    continue
                await button.click(timeout=2500)
                await dialog.page.wait_for_timeout(700)
                file_input = dialog.locator('input[type="file"]')
                if await file_input.count():
                    break
            except Exception:
                continue

    if await file_input.count() == 0:
        # 某些 Facebook 版本把 input 挂在页面根节点而不是 dialog 内；
        # 只有在当前发帖 dialog 已打开时才使用页面级回退。
        page_inputs = dialog.page.locator('input[type="file"]')
        if await page_inputs.count():
            file_input = page_inputs

    if await file_input.count() == 0:
        raise FacebookPublishError(
            '没有找到发布对话框内的照片/视频上传控件；请确认已显示“Ajouter à votre publication”区域'
        )
    try:
        # 传给同一个发布对话框中的全部 file input，兼容图片和视频使用不同 input 的页面。
        uploaded = False
        for index in range(await file_input.count()):
            try:
                await file_input.nth(index).set_input_files(media, timeout=10000)
                uploaded = True
                break
            except Exception:
                continue
        if not uploaded:
            raise RuntimeError('所有照片/视频文件控件都拒绝了素材')
    except Exception as exc:
        raise FacebookPublishError(f'素材上传失败：{exc}') from exc

    # 等待 Facebook 生成视频/图片预览；上传后可能已经重建了新的 dialog，
    # 因此每轮都从页面重新寻找包含视频的当前窗口，而不是只检查旧 dialog。
    deadline = asyncio.get_running_loop().time() + 15
    preview_found = False
    active_dialog = dialog
    while asyncio.get_running_loop().time() < deadline:
        try:
            preview_dialog = await _dialog_with_preview(dialog.page)
            if preview_dialog is not None:
                active_dialog = preview_dialog
            preview = active_dialog.locator('video, img[src^="blob:"], img[src*="scontent"], [aria-label*="remove" i], [aria-label*="supprimer" i]')
            if await preview.count():
                preview_found = True
                break
            # 文件已经被浏览器控件接收，也可作为上传成功的中间状态。
            page_inputs = dialog.page.locator('input[type="file"]')
            for index in range(await page_inputs.count()):
                if await page_inputs.nth(index).evaluate("el => el.files && el.files.length"):
                    preview_found = True
                    break
            if preview_found:
                break
        except Exception:
            pass
        await dialog.page.wait_for_timeout(700)
    if not preview_found:
        raise FacebookPublishError('素材文件未确认进入 Facebook 发帖窗口，已阻止点击发布')
    return active_dialog


async def _detect_professional_account(page) -> bool:
    try:
        body = (await page.locator('body').inner_text(timeout=2500)).lower()
        if PROFESSIONAL_MARKER_RE.search(body):
            return True
        professional_links = page.locator('a[href*="professional_dashboard"], a[href*="professional_mode"], a[href*="/reel/profile"]')
        if await professional_links.count():
            return True
        dashboard_labels = page.get_by_text(re.compile(r'professional dashboard|专业主页|专业模式|프로페셔널', re.I), exact=False)
        return await dashboard_labels.count() > 0
    except Exception:
        return False


async def _click_next(root) -> bool:
    candidates = [
        root.get_by_role('button', name=NEXT_RE).last,
        root.locator('[role="button"]:visible').filter(has_text=NEXT_RE).last,
        root.locator('button:visible').filter(has_text=NEXT_RE).last,
    ]
    for locator in candidates:
        try:
            await locator.wait_for(state='visible', timeout=3000)
            if await locator.is_enabled():
                await locator.scroll_into_view_if_needed()
                await locator.click(timeout=4000)
                return True
        except Exception:
            continue
    return False


async def _publish_professional_reel(page, dialog, text: str, media: list[str]) -> dict[str, Any]:
    if media:
        dialog = await _upload_media(dialog, media)
        await page.wait_for_timeout(1000)
        refreshed = await _dialog_with_preview(page)
        if refreshed is not None:
            dialog = refreshed
    if text:
        editor = await _find_editor(dialog, page)
        await _fill_and_verify_editor(editor, text)
    if not await _click_next(dialog) and not await _click_next(page):
        raise FacebookPublishError('专业账户发帖窗口没有找到“下一页/下一步”按钮')
    await page.wait_for_timeout(1800)
    # 编辑 Reels 页面可能不再使用 role=dialog，第二步仍优先点击“下一页”。
    current_dialog = await _post_dialog(page)
    if current_dialog is not None and await _click_next(current_dialog):
        await page.wait_for_timeout(1600)
    else:
        await _click_next(page)
        await page.wait_for_timeout(1200)
    final_root = await _post_dialog(page) or page
    if not await _click_publish(final_root) and not await _click_publish(page):
        raise FacebookPublishError('专业账户 Reels 设置页面没有找到最终“发布”按钮')
    await page.wait_for_timeout(1800)
    return {'account_mode': 'professional', 'status': 'published' if await _has_publish_confirmation(page) else 'submitted-unverified', 'url': page.url}


async def _has_publish_confirmation(page) -> bool:
    confirmation = page.locator('text=/Published|已发布|Your post is now live|帖子已发布|게시됨|게시되었습니다|Publié|publication est publiée/i')
    try:
        return await confirmation.count() > 0
    except Exception:
        return False


async def _click_publish(dialog) -> bool:
    candidates = [
        dialog.get_by_role('button', name=PUBLISH_RE).last,
        dialog.locator('[role="button"]:visible').filter(has_text=PUBLISH_RE).last,
        dialog.locator('button:visible').filter(has_text=PUBLISH_RE).last,
    ]
    for locator in candidates:
        try:
            await locator.wait_for(state='visible', timeout=3500)
            if await locator.is_enabled():
                await locator.scroll_into_view_if_needed()
                await locator.click(timeout=3500)
                return True
        except Exception:
            continue
    return False


async def _dismiss_draft_prompt(page) -> None:
    """关闭 Facebook 离开发帖窗口时出现的保存草稿确认弹窗。"""
    draft_re = re.compile(
        r"enregistrer le brouillon|sauvegarder.*brouillon|save draft|"
        r"保存此发布草稿|保存草稿|게시물 저장|임시 저장",
        re.I,
    )
    discard_re = re.compile(
        r"supprimer le brouillon|supprimer|delete draft|discard draft|"
        r"删除草稿|放弃草稿|게시물 삭제|삭제",
        re.I,
    )
    prompt = page.locator('[role="dialog"]:visible').filter(has_text=draft_re).last
    try:
        if not await prompt.count() or not await prompt.is_visible(timeout=700):
            return
        discard = prompt.get_by_role('button', name=discard_re).last
        if await discard.count() and await discard.is_visible(timeout=700):
            await discard.click(timeout=2500)
            await page.wait_for_timeout(400)
            return
        discard = prompt.locator('[role="button"]:visible, button:visible').filter(has_text=discard_re).last
        if await discard.count() and await discard.is_visible(timeout=700):
            await discard.click(timeout=2500)
            await page.wait_for_timeout(400)
    except Exception:
        # 草稿弹窗清理失败不能覆盖已经完成的发布结果。
        return


def _normalize_publish_endpoint(value: str) -> str:
    endpoint = str(value or '').strip()
    if endpoint.startswith(('http://ws://', 'https://ws://')):
        endpoint = 'ws://' + endpoint.split('ws://', 1)[1]
    elif endpoint.startswith(('http://wss://', 'https://wss://')):
        endpoint = 'wss://' + endpoint.split('wss://', 1)[1]
    if endpoint.startswith('ws://') and '/devtools/' not in endpoint:
        return 'http://' + endpoint[5:]
    if endpoint.startswith('wss://') and '/devtools/' not in endpoint:
        return 'https://' + endpoint[6:]
    if endpoint.isdigit():
        return f'http://127.0.0.1:{endpoint}'
    if ':' in endpoint and not endpoint.startswith(('http://', 'https://', 'ws://', 'wss://')):
        host, sep, port = endpoint.rpartition(':')
        if sep and port.isdigit() and host:
            return f'http://{endpoint}'
    return endpoint


async def publish_to_facebook(debug_http: str, text: str, media: list[str], timeout_ms: int = 45000) -> dict[str, Any]:
    try:
        from playwright.async_api import async_playwright
    except ImportError as exc:
        raise FacebookPublishError('未安装 Playwright，请执行：python -m pip install playwright') from exc

    endpoint = _normalize_publish_endpoint(debug_http)
    for item in media:
        if not Path(item).is_file():
            raise FacebookPublishError(f'素材不存在：{item}')

    async with async_playwright() as p:
        browser = None
        last_error: Exception | None = None
        for _ in range(12):
            try:
                browser = await p.chromium.connect_over_cdp(endpoint)
                break
            except Exception as exc:
                last_error = exc
                await asyncio.sleep(1.25)
        if browser is None:
            raise FacebookPublishError(f'无法连接 BitBrowser 调试地址 {endpoint}：{last_error}') from last_error
        if not browser.contexts:
            raise FacebookPublishError('BitBrowser 已打开，但没有可用浏览器上下文')
        context = browser.contexts[0]
        page = next((candidate for candidate in context.pages if 'facebook.com' in candidate.url.lower()), None)
        if page is None:
            page = context.pages[0] if context.pages else await context.new_page()
        await page.bring_to_front()
        if 'facebook.com' not in page.url.lower():
            await page.goto('https://www.facebook.com/', wait_until='domcontentloaded', timeout=timeout_ms)
        await _wait_page_ready(page, min(timeout_ms, 12000))
        await _ensure_publish_page(page, timeout=min(timeout_ms, 12000))
        professional_account = await _detect_professional_account(page)

        try:
            dialog = await _open_post_dialog(page, timeout=4500)
        except FacebookPublishError as first_error:
            # 当前页面可能是个人主页但入口被 Facebook 的 SPA 层遮挡；只有确认当前点击没有生成编辑器时才导航回退。
            fallback_errors = [str(first_error)]
            for destination in ('https://www.facebook.com/me', 'https://www.facebook.com/'):
                try:
                    await page.goto(destination, wait_until='domcontentloaded', timeout=timeout_ms)
                    await _wait_page_ready(page, min(timeout_ms, 12000))
                    dialog = await _open_post_dialog(page, timeout=4500)
                    break
                except Exception as fallback_error:
                    fallback_errors.append(str(fallback_error))
            else:
                raise FacebookPublishError(f'当前页和自动回退页面均无法打开发布窗口：{fallback_errors[-1]}') from first_error
        if not professional_account:
            try:
                professional_account = await _detect_professional_account(dialog)
                next_candidates = dialog.get_by_role('button', name=NEXT_RE)
                if media and await next_candidates.count() and await next_candidates.last.is_visible(timeout=900):
                    professional_account = True
            except Exception:
                pass
        if professional_account:
            result = await _publish_professional_reel(page, dialog, text, media)
            result['publisher_version'] = PUBLISHER_VERSION
            await _dismiss_draft_prompt(page)
            return result

        # 普通个人账户沿用快速发帖流程；上传后重新绑定 dialog，避免 Facebook 重建窗口。
        if media:
            dialog = await _upload_media(dialog, media)
            await page.wait_for_timeout(1500)
            refreshed_dialog = await _dialog_with_preview(page)
            if refreshed_dialog is None:
                refreshed_dialog = await _post_dialog(page)
            if refreshed_dialog is not None:
                dialog = refreshed_dialog
        if text:
            editor = await _find_editor(dialog, page)
            await _fill_and_verify_editor(editor, text)
        if not await _click_publish(dialog):
            raise FacebookPublishError(
                '文案和素材已写入真正的发布对话框，但没有找到最终发布按钮；已阻止误点聊天框'
            )

        await page.wait_for_timeout(1200)
        verified = await _has_publish_confirmation(page)
        await _dismiss_draft_prompt(page)
        return {
            'account_mode': 'personal',
            'status': 'published' if verified else 'submitted-unverified',
            'url': page.url,
            'publisher_version': PUBLISHER_VERSION,
        }
