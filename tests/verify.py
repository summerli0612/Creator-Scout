# -*- coding: utf-8 -*-
"""
Creator Scout 独立首页原型 · Playwright 端到端验证
用法:  python tests/verify.py   （在 creator-scout-home 目录下运行，或任意位置）
产出:  screenshots/ 下的运行截图 + 控制台测试结果
依赖:  playwright（本机 Python 环境已安装，含 chromium）
"""
import sys
import pathlib
import traceback

# Windows 控制台默认 GBK，输出含 ✅/❌ 等字符时强制 UTF-8
try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"  # 标准输出位置（README/报告/颜色审计均引用此处）
SHOTS.mkdir(parents=True, exist_ok=True)

from playwright.sync_api import sync_playwright  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (("  -- " + detail) if (detail and not cond) else ""))


def shot(page, name):
    page.screenshot(path=str(SHOTS / name), full_page=False)
    print("  [SHOT] " + name)


def run():
    index_url = (ROOT / "index.html").resolve().as_uri()
    tests_url = (ROOT / "tests" / "tests.html").resolve().as_uri()

    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ============ 1. 自动测试页 ============
        print("\n== tests/tests.html 自动测试 ==")
        page = browser.new_page(viewport={"width": 1440, "height": 1024})
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(tests_url)
        page.wait_for_function(
            "() => document.getElementById('summary') && !document.getElementById('summary').textContent.includes('运行中')",
            timeout=15000,
        )
        summary = page.inner_text("#summary")
        print("  " + summary)
        check("自动测试全部通过", "失败 0" in summary, summary)
        fail_items = page.eval_on_selector_all(
            ".result-item", "els => els.filter(e => e.querySelector('.result-fail')).map(e => e.innerText)"
        )
        for it in fail_items:
            print("    FAIL DETAIL: " + it.replace("\n", " | "))
        shot(page, "tests-page.png")
        check("测试页无 JS 运行时错误", not errors, "; ".join(errors[:3]))
        page.close()

        # ============ 2. 主页面（1440×1024） ============
        print("\n== index.html 主流程（1440×1024） ==")
        ctx = browser.new_context(viewport={"width": 1440, "height": 1024})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(index_url)

        # 默认团队空间首页
        page.wait_for_selector(".nav-item[data-project-id]")
        labels = page.eval_on_selector_all(".nav-item[data-project-id] .nav-label", "els => els.map(e => e.textContent)")
        check("默认团队空间显示团队项目", labels == ["Aurora Skincare", "TrailBrew Outdoor"], str(labels))
        recents = page.eval_on_selector_all(".nav-item--recent .nav-title", "els => els.map(e => e.textContent)")
        check("默认团队空间显示团队最近会话", recents == ["Aurora Skincare", "TrailBrew Outdoor"], str(recents))
        entry = page.inner_text("#sidebar-account")
        check("账户入口显示账号名与团队空间", "林小满" in entry and "Northstar Studio" in entry, entry.replace("\n", " / "))
        check("顶栏为新会话状态", "新会话" in page.inner_text("#topbar"))
        shot(page, "home-team-default-1440.png")

        # 账户浮窗：创建者默认态
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.wait_for_timeout(250)  # 等待入场动画结束
        pop_text = page.inner_text(".account-popover")
        for t in ["林小满", "xiaoman.lin@example.com", "Northstar Studio", "团队空间", "创建者",
                  "用量与计费", "团队管理", "业务邮箱", "通知", "个人设置", "退出登录"]:
            check("浮窗包含「%s」" % t, t in pop_text)
        check("浮窗不含「开启团队协作」", "开启团队协作" not in pop_text)
        check("浮窗未读徽标为 3", page.inner_text(".badge-unread").strip() == "3")
        check("浮窗总宽度 264（含边框）", abs(page.eval_on_selector(".account-popover", "e => e.getBoundingClientRect().width") - 264) < 0.01)
        shot(page, "popover-team-creator.png")

        # 切换按钮悬停提示（默认不显示，悬停才显示）
        check("悬停前提示不显示", not page.is_visible(".switch-hint"))
        page.hover(".switch-btn")
        page.wait_for_timeout(100)
        check("悬停后显示「切换空间」提示", page.is_visible(".switch-hint"))
        shot(page, "popover-switch-hover.png")

        # 在团队空白会话输入未发送内容（先关闭浮窗）
        page.click("#account-entry")  # 关闭浮窗
        page.wait_for_timeout(100)
        check("浮窗已关闭", page.locator(".account-popover").count() == 0)
        page.fill(".composer textarea", "团队空间的未发送输入ABC123")

        # Esc 关闭浮窗
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        check("Esc 关闭浮窗", page.locator(".account-popover").count() == 0)

        # 点击外部关闭浮窗
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".blank-title")
        page.wait_for_timeout(100)
        check("点击外部关闭浮窗", page.locator(".account-popover").count() == 0)

        # 输入内容仍保留（浮窗开关不影响）
        check("浮窗开关后输入保留", page.input_value(".composer textarea") == "团队空间的未发送输入ABC123")

        # 直接切换到个人空间：点击切换按钮即刻切换，无选择列表
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".switch-btn")
        page.wait_for_function(
            "() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].map(e=>e.textContent).join(',') === 'PetPal Essentials,HomeCafe Lab'",
            timeout=5000,
        )
        check("切换后显示个人空间项目", True)
        recents = page.eval_on_selector_all(".nav-item--recent .nav-title", "els => els.map(e => e.textContent)")
        check("切换后显示个人空间最近会话", recents == ["PetPal Essentials", "HomeCafe Lab"], str(recents))
        entry = page.inner_text("#sidebar-account")
        check("个人空间账户入口：账号不变、空间为个人空间", "林小满" in entry and "个人空间" in entry and "Northstar" not in entry, entry.replace("\n", " / "))
        check("切换后浮窗原位保留", page.locator(".account-popover").count() == 1)
        check("首次进入个人空间为空白会话", "新会话" in page.inner_text("#topbar") and page.input_value(".composer textarea") == "")
        shot(page, "home-personal-1440.png")

        # 个人空间浮窗原位保留：无需重新打开，无团队管理
        page.wait_for_selector(".account-popover")
        page.wait_for_timeout(250)  # 等待入场动画结束
        pop_text = page.inner_text(".account-popover")
        check("个人空间浮窗无团队管理", "团队管理" not in pop_text)
        check("个人空间浮窗无开启团队协作", "开启团队协作" not in pop_text)
        check("个人空间浮窗无创建者身份", "创建者" not in pop_text)
        check("个人空间浮窗有切换按钮", page.locator(".switch-btn").count() == 1)
        check("个人空间浮窗账号信息一致", "林小满" in pop_text and "xiaoman.lin@example.com" in pop_text)
        shot(page, "popover-personal.png")

        # 在个人空间打开最近会话，输入草稿，切回团队再切回，验证恢复
        page.click("#account-entry")  # 关闭浮窗
        page.wait_for_timeout(100)
        page.click(".nav-item[data-conv-id='conv-personal-homecafe']")
        page.wait_for_selector(".msg-bubble--user")
        check("打开会话显示历史消息", "磨豆机" in page.inner_text(".chat-scroll"))
        check("会话视图顶栏显示项目名与关联项目（对齐 Figma 05）",
              "HomeCafe Lab" in page.inner_text("#topbar") and "关联项目：HomeCafe Lab" in page.inner_text("#topbar"))
        page.fill(".composer textarea", "个人空间的会话草稿XYZ789")
        shot(page, "conversation-open.png")

        # 切回团队（直接切换）
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".switch-btn")
        page.wait_for_function(
            "() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].map(e=>e.textContent).join(',') === 'Aurora Skincare,TrailBrew Outdoor'",
            timeout=5000,
        )
        check("切回团队空间项目正确", True)
        # 团队空白会话草稿恢复
        check("团队空白会话草稿恢复", page.input_value(".composer textarea") == "团队空间的未发送输入ABC123",
              page.input_value(".composer textarea"))

        # 再次在同一浮窗切到个人空间，验证会话位置与草稿恢复
        page.wait_for_selector(".account-popover")
        page.click(".switch-btn")
        page.wait_for_function(
            "() => document.querySelector('.composer textarea') && document.querySelector('.composer textarea').value === '个人空间的会话草稿XYZ789'",
            timeout=5000,
        )
        check("再次进入个人空间恢复会话位置与草稿", True)
        check("会话历史仍在", page.locator(".msg-bubble--user").count() >= 1)

        # 刷新页面，验证草稿持久化
        page.reload()
        page.wait_for_selector(".composer textarea")
        check("刷新后会话位置恢复", page.locator(".msg-bubble--user").count() >= 1)
        check("刷新后草稿恢复", page.input_value(".composer textarea") == "个人空间的会话草稿XYZ789",
              page.input_value(".composer textarea"))

        # ---- 切换中锁定与「切换中…」反馈（通过测试注入口注入 800ms 慢传输） ----
        page.evaluate("() => window.__creatorScoutStore.__setTransport((t, seq) => new Promise(res => setTimeout(() => res({spaceId: t, seq}), 800)))")
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".switch-btn")
        page.wait_for_timeout(200)
        check("切换中提示显示「切换中…」", "切换中" in page.inner_text(".switch-hint"))
        check("切换中提示常显（不依赖悬停）", page.is_visible(".switch-hint.is-busy"))
        check("切换中切换按钮被锁定", page.locator(".switch-btn[disabled]").count() == 1)
        check("切换中菜单项被锁定", page.locator(".pop-menu-item").count() > 0 and page.locator(".pop-menu-item[disabled]").count() == page.locator(".pop-menu-item").count())
        # 切换中仍可主动关闭；完成回调不得重新打开
        page.click("#account-entry", force=True)
        page.wait_for_timeout(100)
        check("切换中账户入口允许主动关闭浮窗", page.locator(".account-popover").count() == 0)
        page.wait_for_function(
            "() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].map(e=>e.textContent).join(',') === 'Aurora Skincare,TrailBrew Outdoor'",
            timeout=5000,
        )
        check("慢传输切换最终成功", True)
        check("主动关闭后切换完成不重开", page.locator(".account-popover").count() == 0)
        page.evaluate("() => window.__creatorScoutStore.__resetTransport()")

        # ---- 切换失败：保留原空间与输入，toast 提供重试 ----
        page.evaluate("() => window.__creatorScoutStore.__setTransport(() => Promise.reject(new Error('模拟失败')))")
        page.fill(".composer textarea", "失败场景下不能丢的输入")
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".switch-btn")
        page.wait_for_selector(".toast")
        toast_text = page.inner_text(".toast")
        check("失败提示保留原空间与输入", "切换空间失败" in toast_text and "保留" in toast_text, toast_text)
        check("失败后仍在团队空间", page.eval_on_selector_all(".nav-item[data-project-id] .nav-label", "els => els.map(e => e.textContent)")[0] == "Aurora Skincare")
        check("失败后输入保留", page.input_value(".composer textarea") == "失败场景下不能丢的输入")
        page.wait_for_timeout(200)
        check("失败后浮窗仍打开（可重试）", page.locator(".account-popover").count() == 1)
        # 点击 toast 的「重试」：恢复传输后切换成功
        page.evaluate("() => window.__creatorScoutStore.__resetTransport()")
        page.click(".toast-action")
        page.wait_for_function(
            "() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].map(e=>e.textContent).join(',') === 'PetPal Essentials,HomeCafe Lab'",
            timeout=5000,
        )
        check("toast 重试后切换成功", True)
        # 重试前在团队空间（空白会话输入“失败场景下不能丢的输入”），重试目标为个人空间：
        # 目标空间恢复自己的会话位置与草稿；原空间输入按空间隔离保留
        check("重试后恢复目标空间（个人）自己的会话草稿", page.input_value(".composer textarea") == "个人空间的会话草稿XYZ789",
              page.input_value(".composer textarea"))
        check("重试后原空间（团队）输入按空间隔离保留",
              page.evaluate("() => window.__creatorScoutStore.getDraft('sp-team-northstar', '__blank__')") == "失败场景下不能丢的输入")
        # 重试成功后浮窗保留，直接切回团队
        page.wait_for_selector(".account-popover")
        page.click(".switch-btn")
        page.wait_for_function(
            "() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].map(e=>e.textContent).join(',') === 'Aurora Skincare,TrailBrew Outdoor'",
            timeout=5000,
        )

        # 未接入功能提示（不跳转、不伪造成功）—— 此时处于团队空间
        page.click(".nav-item[data-project-id='proj-team-aurora']")
        page.wait_for_selector(".toast")
        check("项目入口提示未开放", "项目工作区暂未开放" in page.inner_text(".toast"))
        page.wait_for_timeout(4000)

        # 输入草稿保留（00–05 发送行为在下一节完整验证）
        page.fill(".composer textarea", "尝试发送的内容")
        page.wait_for_timeout(150)
        check("输入草稿保留", page.input_value(".composer textarea") == "尝试发送的内容")

        # TikTok 入口
        page.click(".nav-item[data-platform='tiktok']")
        page.wait_for_selector(".toast")
        check("TikTok 提示未开放", "该功能暂未开放" in page.inner_text(".toast"))

        # 退出登录：取消不改状态
        page.wait_for_timeout(4000)
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".pop-menu-item--logout")
        page.wait_for_selector(".modal")
        check("退出登录有二次确认", "退出登录" in page.inner_text(".modal"))
        shot(page, "logout-confirm.png")
        page.click("[data-modal='cancel']")
        page.wait_for_timeout(200)
        check("取消退出后保持登录状态", page.locator("#app").is_visible() and page.locator(".modal").count() == 0)
        check("取消退出后输入仍在", page.input_value(".composer textarea") == "尝试发送的内容")

        # 确认退出 → 已退出页 → 重新进入
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.click(".pop-menu-item--logout")
        page.wait_for_selector(".modal")
        page.click("[data-modal='confirm']")
        page.wait_for_selector("#signed-out:not([hidden])")
        check("确认退出显示已退出页", "已退出本地演示登录" in page.inner_text("#signed-out"))
        check("退出说明不宣称真实注销", "不代表已注销任何真实服务会话" in page.inner_text("#signed-out"))
        page.click("#reenter-btn")
        page.wait_for_selector("#app:not([hidden])")
        check("重新进入恢复应用", page.locator("#app").is_visible())
        check("重新进入后数据仍在", page.input_value(".composer textarea") == "尝试发送的内容",
              page.input_value(".composer textarea"))
        # 清理演示状态（避免影响后续人工验收的默认态）
        page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
        page.close()
        ctx.close()
        check("主页面无 JS 运行时错误", not errors, "; ".join(errors[:3]))

        # ============ 2b. 00–05 完整流程 ============
        print("\n== 00–05 完整流程（本地模拟） ==")
        ctx3 = browser.new_context(viewport={"width": 1440, "height": 1024})
        page = ctx3.new_page()
        errors3 = []
        page.on("pageerror", lambda e: errors3.append(str(e)))
        page.goto(index_url)
        page.wait_for_selector(".composer textarea")
        page.evaluate("() => window.__creatorScoutSim.reset()")

        # 00C 发送失败：内容保留 + 原位重试
        page.evaluate("() => window.__creatorScoutSim.config.sendFail = 1")
        page.fill(".composer textarea", "我们做便携咖啡机，想找美国户外类 Instagram 达人，这次先找 100 个，粉丝 1 万到 10 万，要有邮箱。")
        page.click(".btn-send")
        page.wait_for_selector(".composer-error", timeout=5000)
        check("00C 发送失败就近提示", "发送失败" in page.inner_text(".composer-error-text"))
        check("00C 失败后输入保留", page.input_value(".composer textarea") != "")
        page.click(".composer-error-retry")
        check("00B 发送中按钮文案与锁定", "发送中" in page.inner_text(".btn-send") and page.eval_on_selector(".btn-send", "e => e.disabled"))
        page.wait_for_selector(".msg-card--agent", timeout=6000)

        # 01 解析中：会话已建、项目未建（00C 重试成功后创建的同一会话）
        page.wait_for_timeout(200)
        check("01 首次发送只新增会话不新增项目",
              page.locator(".nav-item--recent").count() == 3 and page.locator(".nav-item[data-project-id]").count() == 2)
        check("01 最近副标为解析中", page.inner_text(".nav-item--recent .nav-sub") == "解析中")
        check("01 顶栏材料解析中", page.inner_text(".top-meta") == "材料解析中")
        shot(page, "flow-01-parsing.png")

        # 02 解析完成：引导卡，用户未主动打开前不分屏
        page.wait_for_selector(".btn-view-portrait", timeout=8000)
        page.wait_for_timeout(200)
        check("02 引导卡出现", "我理解到的目标" in page.inner_text(".msg-card--agent"))
        check("02 未主动打开不分屏", page.locator(".portrait-panel").count() == 0)
        check("02 最近副标为草稿", page.inner_text(".nav-item--recent .nav-sub") == "草稿")
        check("02 内容聚焦三点（无流程说教）",
              "我理解到的目标" in page.inner_text(".msg-card--agent")
              and page.locator(".retained-line1").count() == 0)
        check("02 用户输入原样保留", "我们做便携咖啡机" in page.inner_text(".msg-bubble--user"))
        shot(page, "flow-02-guidance.png")

        def region_selected():
            return page.evaluate(
                "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
                " return s.getConversation(s.getState().currentSpaceId, c).portrait.region.selected; }")

        def edit_region_add(code):
            """进入地区编辑态 → 从下拉选择并添加 → 完成。"""
            page.click(".portrait-panel [data-action='edit-region']")
            page.wait_for_selector(".portrait-panel [data-role='region-picker']")
            page.select_option(".portrait-panel [data-role='region-picker']", code)
            page.click(".portrait-panel [data-action='add-region']")
            page.wait_for_timeout(150)
            page.click(".portrait-panel [data-action='commit-region']")
            page.wait_for_timeout(150)

        def edit_field(kp, value):
            """V9 原位编辑：输入保持临时值，点击完成才写入共享草稿。"""
            page.click(".portrait-panel [data-frow='%s'] [data-action='edit-field']" % kp)
            page.wait_for_selector(".portrait-panel [data-frow='%s'] [data-role='field-editor']" % kp)
            page.fill(".portrait-panel [data-frow='%s'] [data-role='field-editor']" % kp, value)
            page.click(".portrait-panel [data-frow='%s'] [data-action='commit-field']" % kp)
            page.wait_for_timeout(150)

        # 03 打开画像面板：分屏 + 字段编辑 + 对话修改共用草稿
        page.click(".btn-view-portrait")
        page.wait_for_selector(".portrait-panel", timeout=3000)
        page.wait_for_timeout(200)
        check("03 分屏布局(430+800)", abs(page.eval_on_selector(".conversation-col", "e => e.getBoundingClientRect().width") - 430) < 2
              and abs(page.eval_on_selector(".portrait-panel", "e => e.getBoundingClientRect().width") - 800) < 2)
        check("03 最近副标为等待画像确认", page.inner_text(".nav-item--recent .nav-sub") == "等待画像确认")
        check("03 顶栏项目草稿", "项目草稿" in page.inner_text(".top-meta"))
        check("03 平台只读无编辑入口",
              page.locator(".portrait-panel [data-frow='common:platform'] .pp-act").count() == 0
              and "Instagram" in page.inner_text(".portrait-panel [data-frow='common:platform']"))
        check("03 解析写入结构化地区(美国)", region_selected() == ["US"], str(region_selected()))
        edit_region_add("CA")
        check("03 手动添加地区写入同一份草稿", region_selected() == ["US", "CA"], str(region_selected()))
        page.click(".portrait-panel [data-action='edit-region']")
        page.wait_for_selector(".portrait-panel [data-role='region-picker']")
        check("03 已选地区在下拉中禁用（UI 防重复）", page.eval_on_selector(
            ".portrait-panel [data-role='region-picker'] option[value='CA']", "e => e.disabled"))
        page.evaluate("() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
                      " return s.addRegion(s.getState().currentSpaceId, c, 'CA'); }")
        page.wait_for_timeout(150)
        check("03 重复添加被拒绝", region_selected() == ["US", "CA"], str(region_selected()))
        page.click(".portrait-panel [data-action='commit-region']")
        shot(page, "flow-03-portrait.png")
        # 关闭再打开保留修改
        page.click(".pp-close")
        page.wait_for_timeout(200)
        check("03 关闭面板恢复完整对话", page.locator(".portrait-panel").count() == 0)
        page.click(".btn-view-portrait")
        page.wait_for_selector(".portrait-panel", timeout=3000)
        check("03 重开面板保留修改", region_selected() == ["US", "CA"], str(region_selected()))
        # 长文本编辑：多行输入写入共享草稿
        edit_field("common:coreValue", "轻量便携，可在露营与房车场景快速制作意式咖啡。\n第二行：长文本编辑不被单行截断。")
        check("03 长文本编辑写入草稿（多行保留）", "第二行" in page.evaluate(
            "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
            " return s.getConversation(s.getState().currentSpaceId, c).portrait.fields.coreValue; }"))
        check("03 完成后回到阅读态（自然换行）",
              page.locator(".portrait-panel [data-frow='common:coreValue'] [data-role='field-editor']").count() == 0)
        brand_before_cancel = page.evaluate(
            "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
            " return s.getConversation(s.getState().currentSpaceId, c).portrait.fields.brand; }")
        page.click(".portrait-panel [data-frow='common:brand'] [data-action='edit-field']")
        page.fill(".portrait-panel [data-frow='common:brand'] [data-role='field-editor']", "取消时不应保存")
        page.click(".portrait-panel [data-frow='common:brand'] [data-action='cancel-edit']")
        check("03 V9 取消字段编辑不改共享草稿", page.evaluate(
            "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
            " return s.getConversation(s.getState().currentSpaceId, c).portrait.fields.brand; }") == brand_before_cancel)

        # 对话修改：只改指定字段 + 冲突守卫（手动编辑晚于旧请求）
        page.fill(".composer textarea", "品牌改成 TrailChef")
        page.click(".btn-send")
        page.wait_for_timeout(100)
        edit_field("common:brand", "ManualBrand")  # 更新的手动修改
        page.wait_for_timeout(1900)
        vals = page.evaluate(
            "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
            " const p = s.getConversation(s.getState().currentSpaceId, c).portrait;"
            " return [p.fields.brand, p.region.selected]; }")
        check("07 旧响应不覆盖新修改（手动值保留）", vals[0] == "ManualBrand", str(vals))
        check("07 其他字段不受影响", vals[1] == ["US", "CA"], str(vals))
        last_reply = page.eval_on_selector_all(".msg-card--agent", "els => els.map(e => e.innerText)")[-1]
        check("07 冲突回复不声称成功", "未生效" in last_reply, last_reply)
        page.fill(".composer textarea", "目标市场改成德国")
        page.click(".btn-send")
        page.wait_for_timeout(1900)
        vals = page.evaluate(
            "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
            " const p = s.getConversation(s.getState().currentSpaceId, c).portrait;"
            " return [p.fields.brand, p.region.selected]; }")
        check("07 后发命令生效且只改指定字段", vals[0] == "ManualBrand" and vals[1] == ["DE"], str(vals))
        page.fill(".composer textarea", "目标市场改成火星")
        page.click(".btn-send")
        page.wait_for_timeout(1900)
        vals = page.evaluate(
            "() => { const s = window.__creatorScoutStore; const c = s.getActiveConversationId();"
            " return s.getConversation(s.getState().currentSpaceId, c).portrait.region.selected; }")
        check("07 无法识别的地区不伪装成选项也不清空", vals == ["DE"], str(vals))

        # 03A V9 编辑语义：地区修改先保留在临时列表，取消恢复已确认选择。
        page.click(".portrait-panel [data-action='edit-region']")
        page.wait_for_selector(".portrait-panel [data-role='region-picker']")
        n = page.locator(".portrait-panel .pp-chip").count()
        for _ in range(n):
            page.locator(".portrait-panel .pp-chip button").first.click()
            page.wait_for_timeout(120)
        check("03A 0 项时完成按钮禁用", page.eval_on_selector(
            ".portrait-panel [data-action='commit-region']", "e => e.disabled"))
        check("03A 地区临时编辑未写入草稿", region_selected() == ["DE"], str(region_selected()))
        page.click(".portrait-panel [data-action='cancel-edit']")
        check("03A 取消地区编辑保留原配置", region_selected() == ["DE"], str(region_selected()))
        edit_region_add("US")
        before_add = page.locator(".pp-persona[data-persona-id]").count()
        page.click(".pp-add-persona")
        page.wait_for_timeout(250)
        check("03A 新增画像先显示 V9 草稿卡", page.locator(".pp-draft-card").count() == 1
              and page.locator(".pp-persona[data-persona-id]").count() == before_add)
        check("03A 空目标达人不能完成添加", page.eval_on_selector(
            ".pp-draft-card [data-action='complete-add-persona']", "e => e.disabled"))
        check("03A 草稿卡编辑中不能确认画像", page.eval_on_selector(".pp-confirm", "e => e.disabled"))
        page.click(".pp-draft-card [data-action='cancel-add-persona']")
        check("03A 取消新增不留下空画像", page.locator(".pp-persona[data-persona-id]").count() == before_add)
        page.click(".pp-add-persona")
        page.fill(".pp-draft-card [data-key='target']", "分享户外旅行与便携咖啡内容的创作者")
        page.click(".pp-draft-card [data-action='complete-add-persona']")
        check("03A 完成添加才写入画像列表", page.locator(".pp-persona[data-persona-id]").count() == before_add + 1)
        page.locator(".pp-persona-delete").last.click()
        page.wait_for_timeout(150)
        n = page.locator(".pp-persona-delete").count()
        for i in range(n):
            page.locator(".pp-persona-delete").first.click()
            page.wait_for_timeout(150)
        check("03A 至少保留一张画像", page.locator(".pp-persona").count() == 1)

        # 04 命名弹窗：预填、名称为空、取消、失败重试
        page.click(".pp-confirm")
        page.wait_for_selector(".naming-modal", timeout=3000)
        check("04 预填建议名称", page.input_value(".nm-input") == "OutdoorBrew")
        page.fill(".nm-input", "")
        page.click(".nm-confirm")
        page.wait_for_timeout(200)
        check("04D 名称为空就近报错", page.inner_text(".nm-error") == "请输入项目名称")
        page.fill(".nm-input", "MyCoffee")
        page.click(".nm-cancel")  # 取消回 03，保留名称与画像
        page.wait_for_timeout(200)
        check("04 取消返回画像面板", page.locator(".portrait-panel").count() == 1 and page.locator(".naming-modal").count() == 0)
        page.click(".pp-confirm")
        page.wait_for_selector(".naming-modal", timeout=3000)
        check("04 重开弹窗保留用户名称", page.input_value(".nm-input") == "MyCoffee")
        page.evaluate("() => window.__creatorScoutSim.config.createFail = 1")
        page.click(".nm-confirm")
        page.wait_for_timeout(1600)
        check("04B 创建失败留在弹窗并提示", "创建失败" in page.inner_text(".nm-error") and page.locator(".naming-modal").count() == 1)
        shot(page, "flow-04b-create-failed.png")
        # 连续快速点击创建：提交中锁定，仅一个项目
        page.click(".nm-confirm")
        page.wait_for_timeout(100)
        locked = page.eval_on_selector(".nm-confirm", "e => e.disabled")
        page.wait_for_selector(".agent-title.is-created", timeout=8000)
        check("04 提交中锁定重复创建", locked)
        page.wait_for_timeout(300)

        # 05 创建成功：同步与恢复
        check("05 只新增一个项目", page.locator(".nav-item[data-project-id]").count() == 3)
        check("05 成功消息追加", "MyCoffee 项目已创建" in page.inner_text(".agent-title.is-created"))
        check("05 项目区出现新项目", page.evaluate("() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].some(e => e.textContent === 'MyCoffee')"))
        check("05 最近标题同步", page.inner_text(".nav-item--recent .nav-title") == "MyCoffee")
        check("05 最近副标为项目助手", page.inner_text(".nav-item--recent .nav-sub") == "项目助手")
        check("05 顶栏关联项目", page.inner_text(".top-meta") == "关联项目：MyCoffee")
        check("05 面板已关闭恢复完整对话", page.locator(".portrait-panel").count() == 0 and page.eval_on_selector("#portrait-panel-root", "e => e.hidden"))
        check("05 输入框仍可用", page.locator(".composer textarea").count() == 1)
        shot(page, "flow-05-created.png")

        # 刷新恢复：阶段、消息、绑定、画像草稿
        page.reload()
        page.wait_for_selector(".agent-title.is-created", timeout=6000)
        check("刷新后项目与会话绑定恢复",
              page.locator(".nav-item[data-project-id]").count() == 3 and page.inner_text(".top-meta") == "关联项目：MyCoffee")
        check("刷新后成功消息不重复", page.locator(".agent-title.is-created").count() == 1)
        # 最近返回：不重复追加消息
        msg_count = page.locator(".msg-block").count()
        page.click(".nav-item[data-conv-id='conv-team-aurora']")
        page.wait_for_timeout(200)
        page.click(".nav-item--recent")
        page.wait_for_timeout(200)
        check("最近返回不重复追加消息", page.locator(".msg-block").count() == msg_count)
        # 05 后查看画像（只读）
        page.click(".btn-view-portrait.is-secondary")
        page.wait_for_selector(".portrait-panel.is-view", timeout=3000)
        check("05 历史画像入口为只读查看", "画像已确认" in page.inner_text(".pp-footer-hint"))
        page.click(".pp-close")
        page.wait_for_timeout(150)

        # 空间隔离：个人空间不出现团队新会话与项目
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.wait_for_timeout(300)
        page.click(".switch-btn")
        page.wait_for_function(
            "() => [...document.querySelectorAll('.nav-item[data-project-id] .nav-label')].map(e=>e.textContent).join(',') === 'PetPal Essentials,HomeCafe Lab'",
            timeout=5000,
        )
        check("空间隔离：个人空间项目不含新项目", page.locator(".nav-item[data-project-id]").count() == 2)
        check("空间隔离：个人空间最近无新会话",
              page.evaluate("() => ![...document.querySelectorAll('.nav-item--recent .nav-title')].some(e => e.textContent === 'MyCoffee')"))
        page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
        page.close()
        ctx3.close()
        check("00–05 流程无 JS 运行时错误", not errors3, "; ".join(errors3[:3]))

        # ============ 3. 1280×800 适配 ============
        print("\n== 1280×800 适配 ==")
        ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx2.new_page()
        errors2 = []
        page.on("pageerror", lambda e: errors2.append(str(e)))
        page.goto(index_url)
        page.wait_for_selector(".nav-item[data-project-id]")
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.wait_for_timeout(250)
        box = page.eval_on_selector(".account-popover", "e => { const r = e.getBoundingClientRect(); return {top: r.top, left: r.left, bottom: r.bottom, right: r.right}; }")
        check("1280×800 浮窗不出屏（上）", box["top"] >= 0, str(box))
        check("1280×800 浮窗不出屏（左）", box["left"] >= 0)
        check("1280×800 浮窗不出屏（下）", box["bottom"] <= 800)
        check("1280×800 浮窗不出屏（右）", box["right"] <= 1280)
        shot(page, "home-team-1280-popover.png")
        # 本轮已删除三栏提示与底部说明，检查真实输入区与操作行。
        visible = page.eval_on_selector(".composer", "e => { const r = e.getBoundingClientRect(); return r.bottom <= 800 && r.top >= 0 && r.right <= 1280; }")
        check("1280×800 输入区及操作行不出屏", visible)

        # 1280×800 下 00–05 分屏：面板与弹窗操作可见、长内容可滚动
        page.fill(".composer textarea", "我们做便携咖啡机，想找美国户外类 Instagram 达人。")
        page.click(".btn-send")
        page.wait_for_selector(".btn-view-portrait", timeout=8000)
        page.click(".btn-view-portrait")
        page.wait_for_selector(".portrait-panel", timeout=3000)
        page.wait_for_timeout(200)
        pw = page.eval_on_selector(".portrait-panel", "e => Math.round(e.getBoundingClientRect().width)")
        check("1280×800 画像面板可见且收窄", 520 <= pw < 800, str(pw))
        scrollable = page.eval_on_selector(".pp-scroll", "e => e.scrollHeight >= e.clientHeight")
        check("1280×800 画像内容可滚动", scrollable)
        shot(page, "flow-1280-split.png")
        page.click(".pp-confirm")
        page.wait_for_selector(".naming-modal", timeout=3000)
        modal = page.eval_on_selector(".naming-modal", "e => { const r = e.getBoundingClientRect(); return r.left >= 0 && r.right <= 1280 && r.top >= 0 && r.bottom <= 800; }")
        check("1280×800 命名弹窗不出屏", modal)
        page.click(".nm-cancel")
        page.wait_for_timeout(150)

        # 输入聚焦只显示外层一圈 Mint（无内部 textarea 独立描边）
        page.click(".pp-close")
        page.wait_for_timeout(150)
        page.click(".composer textarea")
        page.wait_for_timeout(100)
        inner = page.eval_on_selector(".composer textarea:focus", "e => getComputedStyle(e).outlineStyle === 'none' && getComputedStyle(e).borderWidth === '0px'")
        outer = page.eval_on_selector(".composer:focus-within", "e => getComputedStyle(e).borderColor")
        check("输入聚焦仅外层一圈 Mint 边框", inner and outer == "rgb(85, 217, 180)", str(outer))
        page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")

        page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
        check("1280×800 无 JS 运行时错误", not errors2, "; ".join(errors2[:3]))
        page.close()
        ctx2.close()

        browser.close()

    print("\n================ 结果汇总 ================")
    print("通过: %d  失败: %d" % (len(PASS), len(FAIL)))
    if FAIL:
        print("失败项:")
        for f in FAIL:
            print("  - " + f)
        sys.exit(1)
    print("全部通过 ✅")


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        sys.exit(2)
