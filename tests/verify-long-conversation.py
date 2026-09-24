# -*- coding: utf-8 -*-
"""长对话专项：自动跟随、阅读保持、回到底部、面板开关保留位置、长链接、会话间位置记忆。

语义约定（与需求一致）：
- 用户主动发送 → 自己的消息必须进入视野（跟随到底部）
- 之后用户滚动回阅读历史 → 后续到达的 AI 回复不得拉走阅读位置
- 离开底部 → 出现圆形「回到底部」按钮；点击回到底部后按钮隐藏
"""
import sys
import pathlib
import traceback

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
SHOTS = ROOT / "screenshots"
SHOTS.mkdir(parents=True, exist_ok=True)

from playwright.sync_api import sync_playwright  # noqa: E402

PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (("  -- " + detail) if (detail and not cond) else ""))


def shot(page, name):
    page.screenshot(path=str(SHOTS / name), full_page=False)
    print("  [SHOT] " + name)


LONG_LINK = "https://example.com/very/long/path/creator-campaign-tracking?utm_source=instagram&utm_medium=bio&utm_campaign=portable-coffee-outdoor-2026-q4&content=long-link-wrap-check"

SCROLL_JS = "(ratio) => { const el = document.querySelector('.chat-scroll'); el.scrollTop = Math.round(el.scrollHeight * ratio); }"
POS_JS = "() => Math.round(document.querySelector('.chat-scroll').scrollTop)"
BOTTOM_JS = "() => { const el = document.querySelector('.chat-scroll'); return el.scrollHeight - el.scrollTop - el.clientHeight; }"
COUNT_JS = "() => document.querySelectorAll('.chat-scroll .msg-block').length"


def run():
    index_url = (ROOT / "index.html").resolve().as_uri()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(index_url)
        page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
        page.reload()
        page.wait_for_selector(".composer textarea")
        page.fill(".composer textarea", "我们做便携咖啡机，想找美国户外类 Instagram 达人。")
        page.click(".btn-send")
        page.wait_for_selector(".btn-view-portrait", timeout=15000)
        page.wait_for_timeout(300)
        conv_id = page.evaluate("() => { const n = document.querySelector('.nav-item.is-selected'); return n ? n.dataset.convId : null; }")

        def send(text):
            page.fill(".composer textarea", text)
            page.click(".btn-send")
            page.wait_for_timeout(1250)  # sendDelay 400 + modDelay 700 + 余量

        # ---- 20+ 条消息长对话 ----
        for i in range(11):
            send("补充第 %d 条：户外场景优先，粉丝 1 万以上。" % (i + 1))
        n = page.locator(".msg-block").count()
        check("长对话消息数 ≥ 24", n >= 24, str(n))

        vis = page.evaluate("""() => {
          const sc = document.querySelector('.chat-scroll');
          const blocks = sc.querySelectorAll('.msg-block');
          const last = blocks[blocks.length - 1].getBoundingClientRect();
          const box = sc.getBoundingClientRect();
          return { lastVisible: last.bottom <= box.bottom + 1 && last.top >= box.top - 1,
                   gap: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) };
        }""")
        check("新回复自动跟随到底部", vis["gap"] < 40 and vis["lastVisible"], str(vis))
        shot(page, "round5-long-follow.png")

        # ---- 用户主动发送：自己的消息必须进入视野 ----
        # 注意：发送是异步的（sendDelay 后才落消息），必须等用户消息真正渲染再断言。
        # 使用「改成 X」类修改指令：用户消息先落，AI 回复延迟 700ms 后才到达，
        # 这样才能真实检验「阅读历史时迟到的回复不拉走位置」。
        count_base = page.evaluate(COUNT_JS)
        page.fill(".composer textarea", "目标市场改成 美国")
        page.click(".btn-send")
        page.wait_for_function("(n) => document.querySelectorAll('.chat-scroll .msg-block').length > n",
                               arg=count_base, timeout=10000)
        page.wait_for_timeout(120)
        own = page.evaluate("""() => {
          const sc = document.querySelector('.chat-scroll');
          const blocks = sc.querySelectorAll('.msg-block');
          const last = blocks[blocks.length - 1].getBoundingClientRect();
          const box = sc.getBoundingClientRect();
          return { text: blocks[blocks.length - 1].innerText.slice(0, 24),
                   visible: last.bottom <= box.bottom + 1 && last.top >= box.top - 1,
                   gap: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) };
        }""")
        check("用户发送后最新消息进入视野", own["visible"] and own["gap"] < 40, str(own))

        # ---- 阅读历史：滚动离开底部后到达的 AI 回复不得拉走位置 ----
        count_before = page.evaluate(COUNT_JS)
        page.evaluate(SCROLL_JS, 0.4)
        page.wait_for_timeout(150)
        pos_before = page.evaluate(POS_JS)
        page.wait_for_function("(n) => document.querySelectorAll('.chat-scroll .msg-block').length > n",
                               arg=count_base + 1, timeout=10000)
        page.wait_for_timeout(400)
        count_after = page.evaluate(COUNT_JS)
        pos_after = page.evaluate(POS_JS)
        check("阅读历史时新回复不拉走位置",
              count_after > count_before and abs(pos_after - pos_before) <= 2,
              "count %s->%s, pos %s->%s" % (count_before, count_after, pos_before, pos_after))

        # ---- 离开底部出现回到底部按钮 ----
        diag = page.evaluate("""() => {
          const el = document.querySelector('.chat-scroll');
          const btn = document.querySelector('#conversation-col .jump-latest-btn');
          return { gap: Math.round(el.scrollHeight - el.scrollTop - el.clientHeight),
                   top: Math.round(el.scrollTop), h: el.scrollHeight, ch: el.clientHeight,
                   cls: btn ? btn.className : 'NO-BTN' };
        }""")
        btn_hidden = page.eval_on_selector(".jump-latest-btn", "e => e.classList.contains('is-hidden')")
        check("离开底部后显示回到底部按钮", not btn_hidden, str(diag))
        shot(page, "round5-long-reading.png")

        # ---- 回到底部 ----
        page.click(".jump-latest-btn")
        page.wait_for_timeout(250)
        gap_bottom = page.evaluate(BOTTOM_JS)
        btn_hidden2 = page.eval_on_selector(".jump-latest-btn", "e => e.classList.contains('is-hidden')")
        check("回到底部后按钮隐藏", gap_bottom < 40 and btn_hidden2, "gap=%s hidden=%s" % (gap_bottom, btn_hidden2))

        # ---- 长链接不撑破容器 ----
        send("参考这个链接 " + LONG_LINK)
        overflow = page.evaluate("""() => {
          const sc = document.querySelector('.chat-scroll');
          return { overflowX: sc.scrollWidth - sc.clientWidth,
                   doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        }""")
        check("长链接不产生横向溢出", overflow["overflowX"] <= 0 and overflow["doc"] <= 0, str(overflow))

        # ---- 打开/关闭画像：保留阅读位置与输入草稿 ----
        page.evaluate(SCROLL_JS, 0.45)
        page.wait_for_timeout(150)
        pos_mark = page.evaluate(POS_JS)
        draft_before = page.input_value(".composer textarea")
        # 用 JS 触发点击：避免 Playwright 为定位按钮而自动滚动容器，污染位置断言
        page.evaluate("() => document.querySelector('.btn-view-portrait').click()")
        page.wait_for_selector(".portrait-panel")
        page.wait_for_timeout(300)
        pos_in_split = page.evaluate(POS_JS)
        page.evaluate("() => document.querySelector('.pp-close').click()")
        page.wait_for_timeout(300)
        pos_closed = page.evaluate(POS_JS)
        draft_after = page.input_value(".composer textarea")
        check("打开画像保留阅读位置", abs(pos_in_split - pos_mark) <= 2,
              "%s -> %s" % (pos_mark, pos_in_split))
        check("关闭画像保留阅读位置", abs(pos_closed - pos_mark) <= 2,
              "%s -> %s" % (pos_mark, pos_closed))
        check("开关画像输入草稿保留", draft_before == draft_after, "%s / %s" % (draft_before, draft_after))

        # ---- 切换会话：各自记忆位置，新会话首次打开显示最新 ----
        page.evaluate(SCROLL_JS, 0.5)
        page.wait_for_timeout(150)
        pos_mark2 = page.evaluate(POS_JS)
        page.click(".nav-item[data-conv-id='conv-team-aurora']")
        page.wait_for_timeout(350)
        gap_aurora = page.evaluate(BOTTOM_JS)
        check("切换到其他会话显示最新内容", gap_aurora < 40, "gap=%s" % gap_aurora)
        page.click(".nav-item--recent")
        page.wait_for_timeout(350)
        pos_back = page.evaluate(POS_JS)
        check("切回会话恢复原阅读位置", abs(pos_back - pos_mark2) <= 2,
              "%s vs %s" % (pos_back, pos_mark2))

        check("长对话无 JS 运行时错误", not errors, "; ".join(errors[:3]))

        # ---- 刷新后消息不丢失（agent 纯文本回复曾被 sanitize 过滤）----
        cnt_before_reload = page.evaluate(COUNT_JS)
        page.reload()
        page.wait_for_selector(".composer textarea", timeout=15000)
        page.wait_for_timeout(600)
        page.evaluate("(id) => { const n = document.querySelector('.nav-item[data-conv-id=\"' + id + '\"]'); if (n && !n.classList.contains('is-selected')) n.click(); }", conv_id)
        page.wait_for_selector(".chat-scroll", timeout=15000)
        page.wait_for_timeout(400)
        cnt_after_reload = page.evaluate(COUNT_JS)
        check("刷新后消息不丢失", cnt_after_reload == cnt_before_reload,
              "%s -> %s" % (cnt_before_reload, cnt_after_reload))
        shot(page, "round5-long-final.png")
        page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
        browser.close()

    print("\n最终 通过: %d  失败: %d" % (len(PASS), len(FAIL)))
    if FAIL:
        sys.exit(1)


if __name__ == "__main__":
    try:
        run()
    except Exception:
        traceback.print_exc()
        sys.exit(2)
