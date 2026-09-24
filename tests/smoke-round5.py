# -*- coding: utf-8 -*-
"""本轮（对话布局 / 滚动 / 分屏 / 画像 V9 适配）冒烟验证。
用法:  python tests/smoke-round5.py
产出:  screenshots/ 下的截图 + 控制台结果。
"""
import sys
import pathlib
import traceback

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
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


DEMO_TEXT = "我们做便携咖啡机，想找美国户外类 Instagram 达人，这轮先找 100 个，需要邮箱。"


def seed_conversation(page):
    page.evaluate("() => localStorage.removeItem('creator_scout_home_v1')")
    page.reload()
    page.wait_for_selector(".composer textarea")
    page.fill(".composer textarea", DEMO_TEXT)
    page.click(".btn-send")
    page.wait_for_selector(".btn-view-portrait", timeout=15000)


def run():
    index_url = (ROOT / "index.html").resolve().as_uri()
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- 1440 基础布局 ----------
        print("\n== 1440×900 布局 ==")
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(index_url)
        page.wait_for_selector(".composer textarea")

        # 居中轴线：正文 820 上限，输入框与正文同一条中线
        geo = page.evaluate("""() => {
          const inner = document.querySelector('.blank-inner');
          const composer = document.querySelector('.composer');
          const r1 = inner.getBoundingClientRect(), r2 = composer.getBoundingClientRect();
          return { w: Math.round(r1.width), c1: Math.round(r1.left + r1.width/2), c2: Math.round(r2.left + r2.width/2) };
        }""")
        check("1440 空白会话正文限宽 820", geo["w"] == 820, str(geo))
        check("1440 输入与正文共用居中轴线", abs(geo["c1"] - geo["c2"]) <= 1, str(geo))
        shot(page, "round5-1440-blank.png")

        seed_conversation(page)
        scrollGeo = page.evaluate("""() => {
          const col = document.querySelector('.conversation-col').getBoundingClientRect();
          const sc = document.querySelector('.chat-scroll');
          const inner = document.querySelector('.chat-inner').getBoundingClientRect();
          const comp = document.querySelector('.composer-outer .composer').getBoundingClientRect();
          const card = document.querySelector('.msg-card--agent').getBoundingClientRect();
          return { colRight: Math.round(col.right), scRight: Math.round(sc.getBoundingClientRect().right),
                   innerW: Math.round(inner.width), c1: Math.round(inner.left+inner.width/2), c2: Math.round(comp.left+comp.width/2),
                   cardLeft: card.left, cardRight: card.right, innerLeft: inner.left, innerRight: inner.right,
                   compLeft: comp.left, compRight: comp.right,
                   scrollable: sc.scrollHeight > sc.clientHeight };
        }""")
        check("1440 滚动视口贴对话区右边缘", abs(scrollGeo["scRight"] - scrollGeo["colRight"]) <= 1, str(scrollGeo))
        check("1440 正文与输入框同一条中线（820）",
              scrollGeo["innerW"] == 820 and abs(scrollGeo["c1"] - scrollGeo["c2"]) <= 1, str(scrollGeo))
        check("1440 AI 卡片、正文列和输入框实际边界对齐",
              all(abs(scrollGeo[a] - scrollGeo[b]) <= 1 for a, b in
                  [("cardLeft", "innerLeft"), ("cardRight", "innerRight"),
                   ("cardLeft", "compLeft"), ("cardRight", "compRight")]), str(scrollGeo))
        shot(page, "round5-1440-conv.png")

        # ---------- 分屏三档宽度 ----------
        for w, h in [(1280, 800), (1440, 900), (1920, 1080)]:
            print("\n== %d×%d 分屏 ==" % (w, h))
            c = browser.new_context(viewport={"width": w, "height": h})
            pg = c.new_page()
            errs = []
            pg.on("pageerror", lambda e: errs.append(str(e)))
            pg.goto(index_url)
            seed_conversation(pg)
            normal = pg.evaluate("""() => {
              const box = s => document.querySelector(s).getBoundingClientRect();
              const card = box('.msg-card--agent'), inner = box('.chat-inner'), comp = box('.composer-outer .composer');
              const sc = box('.chat-scroll'), col = box('.conversation-col');
              return { cardL:card.left, cardR:card.right, innerL:inner.left, innerR:inner.right,
                       compL:comp.left, compR:comp.right, scR:sc.right, colR:col.right,
                       overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth };
            }""")
            check("%d 普通对话卡片/正文/输入边界" % w,
                  all(abs(normal[a]-normal[b]) <= 1 for a,b in
                      [("cardL","innerL"),("cardR","innerR"),("compL","innerL"),("compR","innerR"),
                       ("scR","colR")]) and normal["overflow"] <= 0, str(normal))
            pg.click(".btn-view-portrait")
            pg.wait_for_selector(".portrait-panel")
            pg.wait_for_timeout(250)
            m = pg.evaluate("""() => {
              const conv = document.querySelector('.conversation-col').getBoundingClientRect();
              const main = document.querySelector('.main-body').getBoundingClientRect();
              const pp = document.querySelector('.portrait-panel').getBoundingClientRect();
              const inner = document.querySelector('.chat-inner').getBoundingClientRect();
              const btn = document.querySelector('.pp-confirm').getBoundingClientRect();
              const close = document.querySelector('.pp-close').getBoundingClientRect();
              const comp = document.querySelector('#conversation-col .composer').getBoundingClientRect();
              const footown = { left: comp.left, right: comp.right, bottom: comp.bottom };
              return { convW: Math.round(conv.width), ppW: Math.round(pp.width), ppRight: Math.round(pp.right),
                       mainRight: main.right, mainLeft: main.left, convLeft: conv.left,
                       innerLeft: inner.left, innerRight: inner.right, compLeft: comp.left, compRight: comp.right,
                       btnVisible: btn.right <= innerWidth + 0.5 && btn.bottom <= innerHeight + 0.5 && btn.width > 0,
                       closeVisible: close.right <= innerWidth + 0.5 && close.top >= 0,
                       compIn: footown.right <= innerWidth + 0.5 && footown.left >= -0.5 && footown.bottom <= innerHeight + 0.5,
                       docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
                       ppScroll: (() => { const el = document.querySelector('.pp-scroll'); return el.scrollHeight >= el.clientHeight; })() };
            }""")
            check("%d 无横向溢出" % w, m["docOverflow"] <= 0, "overflow=%s" % m["docOverflow"])
            check("%d 分屏铺满且画像贴右边" % w,
                  abs(m["convLeft"]-m["mainLeft"]) <= 1 and abs(m["ppRight"]-m["mainRight"]) <= 1
                  and abs(m["convW"]-430) <= 1 and abs(m["convW"] + m["ppW"] - (m["mainRight"]-m["mainLeft"])) <= 1,
                  str(m))
            check("%d 左侧消息和输入共用边界" % w,
                  abs(m["innerLeft"]-m["compLeft"]) <= 1 and abs(m["innerRight"]-m["compRight"]) <= 1,
                  str(m))
            check("%d 底部确认按钮完整可见" % w, m["btnVisible"], str(m))
            check("%d 关闭按钮可见" % w, m["closeVisible"], str(m))
            check("%d 左侧输入区完整可用" % w, m["compIn"], str(m))
            check("%d 画像正文可独立滚动" % w, m["ppScroll"], str(m))
            if w == 1920:
                long_value = "户外实测、产品演示、受众反馈与真实使用场景；" * 12
                row = pg.locator('.pp-persona').first.locator('[data-frow$=":target"]')
                row.locator('[data-action="edit-field"]').first.click()
                row.locator('textarea.pp-field-edit').fill(long_value)
                row.locator('[data-action="commit-field"]').click()
                reading = row.locator('.pp-field-body')
                check("1920 长画像条件阅读态全文可见且不截断",
                      reading.inner_text() == long_value and reading.evaluate("""el => {
                        const s = getComputedStyle(el);
                        return s.overflow !== 'hidden' && el.scrollHeight <= el.clientHeight + 1;
                      }"""), reading.inner_text()[:50])
                reading.scroll_into_view_if_needed()
                shot(pg, "repair-20260925-long-portrait-1920.png")
            print("    对话列 %d / 画像 %d" % (m["convW"], m["ppW"]))
            shot(pg, "round5-%d-split.png" % w)
            check("%d 无 JS 运行时错误" % w, not errs, "; ".join(errs[:3]))
            c.close()

        print("\n================ 结果 ================")
        print("通过: %d  失败: %d" % (len(PASS), len(FAIL)))
        if FAIL:
            for f in FAIL:
                print("  - " + f)
        check("加载阶段无 JS 运行时错误", not errors, "; ".join(errors[:3]))
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
