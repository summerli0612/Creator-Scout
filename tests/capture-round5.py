# -*- coding: utf-8 -*-
"""本轮交付截图：长对话 / 长对话+分屏，1280 / 1440 / 1920 三档。
每档独立构建长对话（不复用快照），并断言：
无横向溢出、正文与输入框同一条居中轴线、画像关闭与确认按钮完整可见、
左侧输入区可用、对话与画像各自可独立滚动。
产出: screenshots/round5-long-<w>.png、screenshots/round5-long-split-<w>.png
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


DEMO_TEXT = "我们做便携咖啡机，想找美国户外类 Instagram 达人，这轮先找 100 个，需要邮箱。"
LONG_LINK = "https://example.com/very/long/path/creator-campaign-tracking?utm_source=instagram&utm_medium=bio&utm_campaign=portable-coffee-outdoor-2026-q4"


def build_long_conversation(pg):
    pg.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
    pg.reload()
    pg.wait_for_selector(".composer textarea")
    pg.fill(".composer textarea", DEMO_TEXT)
    pg.click(".btn-send")
    pg.wait_for_selector(".btn-view-portrait", timeout=15000)
    pg.wait_for_timeout(300)
    for i in range(9):
        pg.fill(".composer textarea", "补充第 %d 条：户外场景优先，粉丝 1 万以上，参考 " % (i + 1) + LONG_LINK)
        pg.click(".btn-send")
        pg.wait_for_timeout(1250)
    pg.evaluate("() => { const e = document.querySelector('.chat-scroll'); e.scrollTop = e.scrollHeight; }")
    pg.wait_for_timeout(200)


def run():
    index_url = (ROOT / "index.html").resolve().as_uri()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        for w, h in [(1280, 800), (1440, 900), (1920, 1080)]:
            print("\n== %d×%d 长对话 ==" % (w, h))
            c = browser.new_context(viewport={"width": w, "height": h})
            pg = c.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(index_url)
            pg.wait_for_selector(".composer textarea")
            build_long_conversation(pg)

            m = pg.evaluate("""() => {
              const sc = document.querySelector('.chat-scroll');
              const inner = document.querySelector('.chat-inner').getBoundingClientRect();
              const comp = document.querySelector('.composer-outer .composer').getBoundingClientRect();
              return { count: document.querySelectorAll('.msg-block').length,
                       overflowX: sc.scrollWidth - sc.clientWidth,
                       doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                       innerW: Math.round(inner.width),
                       axis: Math.round(inner.left + inner.width/2) - Math.round(comp.left + comp.width/2),
                       scrollable: sc.scrollHeight > sc.clientHeight,
                       compIn: comp.left >= -0.5 && comp.right <= innerWidth + 0.5 && comp.bottom <= innerHeight + 0.5 };
            }""")
            check("%d 长对话 ≥18 条且可滚动" % w, m["count"] >= 18 and m["scrollable"], str(m))
            check("%d 长对话无横向溢出" % w, m["overflowX"] <= 0 and m["doc"] <= 0, str(m))
            check("%d 长对话正文与输入框同一条中线" % w, abs(m["axis"]) <= 1, str(m))
            check("%d 长对话输入区完整可用" % w, m["compIn"], str(m))
            print("    消息 %d 条，正文宽 %d" % (m["count"], m["innerW"]))
            pg.screenshot(path=str(SHOTS / ("round5-long-%d.png" % w)))
            print("  [SHOT] round5-long-%d.png" % w)

            # ---- 分屏 ----
            pg.evaluate("() => document.querySelector('.btn-view-portrait').click()")
            pg.wait_for_selector(".portrait-panel")
            pg.wait_for_timeout(350)
            s = pg.evaluate("""() => {
              const conv = document.querySelector('.conversation-col').getBoundingClientRect();
              const pp = document.querySelector('.portrait-panel').getBoundingClientRect();
              const btn = document.querySelector('.pp-confirm').getBoundingClientRect();
              const close = document.querySelector('.pp-close').getBoundingClientRect();
              const comp = document.querySelector('#conversation-col .composer').getBoundingClientRect();
              const sc = document.querySelector('.chat-scroll');
              const ppScroll = document.querySelector('.pp-scroll');
              return { convW: Math.round(conv.width), ppW: Math.round(pp.width),
                       btnVisible: btn.width > 0 && btn.right <= innerWidth + 0.5 && btn.bottom <= innerHeight + 0.5 && btn.top >= 0,
                       closeVisible: close.width > 0 && close.right <= innerWidth + 0.5 && close.top >= 0,
                       compIn: comp.left >= -0.5 && comp.right <= innerWidth + 0.5 && comp.bottom <= innerHeight + 0.5,
                       chatScrollable: sc.scrollHeight > sc.clientHeight,
                       ppScrollable: ppScroll.scrollHeight >= ppScroll.clientHeight,
                       overflowX: sc.scrollWidth - sc.clientWidth,
                       doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
            }""")
            check("%d 分屏无横向溢出" % w, s["overflowX"] <= 0 and s["doc"] <= 0, str(s))
            check("%d 分屏确认按钮完整可见" % w, s["btnVisible"], str(s))
            check("%d 分屏关闭按钮可见" % w, s["closeVisible"], str(s))
            check("%d 分屏左侧输入完整可用" % w, s["compIn"], str(s))
            check("%d 分屏对话可滚动" % w, s["chatScrollable"], str(s))
            check("%d 分屏画像独立滚动" % w, s["ppScrollable"], str(s))
            print("    对话列 %d / 画像 %d" % (s["convW"], s["ppW"]))
            pg.screenshot(path=str(SHOTS / ("round5-long-split-%d.png" % w)))
            print("  [SHOT] round5-long-split-%d.png" % w)
            check("%d 无 JS 运行时错误" % w, not errs, "; ".join(errs[:3]))
            c.close()
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
