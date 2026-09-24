# -*- coding: utf-8 -*-
"""布局对照：实测实现中的关键元素几何位置 vs Figma 节点数据。

期望值来源（Figma 实测，2026-09-24 最新一轮 MCP 复核）：
- 首页 306:74 最新稿：空白会话为官方 Instagram 渐变字形（40×40，y=235）+ 28px 标题 + 单行副标题；
  提示区与底部说明已从稿中移除。项目/最近分区双项目布局参照 311:73（项目 268/308、最近标签 375、最近项 400）
- 账户浮窗 540:73（创建者，324×459）；实现采用 326px border-box（=324 设计宽 + 2px 描边），
  内部坐标按浮窗外框原点（含描边）计
- 文本类标签（side-label / hint 标题）用 Range 量取文本盒，避免 padding 干扰
"""
import sys, pathlib, traceback
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = pathlib.Path(__file__).resolve().parent.parent
from playwright.sync_api import sync_playwright  # noqa: E402

EXPECT = [
    # (name, selector, mode, x, y, w, h)  mode: box=元素盒 / text=文本盒
    # 主区 210..1440（宽1230），会话列 820 在其中水平居中 → x=415（Figma：Main 相对 x=205）
    ("sidebar",        ".sidebar",                         "box",  0,   0,   210, 1024),
    ("logo",           ".sidebar-logo img",                "box",  16,  18,  170, 32),
    ("label-agents",   ".side-section--agents .side-label", "text", 20, 79,  None, 18),
    ("nav-instagram",  ".nav-item[data-platform='instagram']", "box", 12, 104, 186, 38),
    ("nav-tiktok",     ".nav-item[data-platform='tiktok']",     "box", 12, 144, 186, 38),
    ("nav-youtube",    ".nav-item[data-platform='youtube']",    "box", 12, 184, 186, 38),
    ("label-projects", ".side-section--projects .side-label",   "text", 20, 243, None, 18),
    ("nav-project1",   ".nav-item[data-project-id]",           "box", 12, 268, 186, 38),
    ("nav-project2",   ".nav-item[data-project-id]:nth-child(3)", "box", 12, 308, 186, 38),
    ("label-recents",  ".side-section--recents .side-label",    "text", 20, 375, None, 18),
    ("nav-recent1",    ".nav-item--recent",                    "box", 12, 400, 186, 48),
    ("recent1-title",  ".nav-item--recent .nav-title",         "text", 52, 405, None, 20),  # 项x12 + 项内40
    ("recent1-sub",    ".nav-item--recent .nav-sub",           "text", 52, 425, None, 18),
    ("account-entry",  ".account-entry",                       "box", 0,  948, 210, 76),
    ("entry-name",     ".entry-name",                          "text", 62, 963, None, 20),
    ("entry-space",    ".entry-space",                         "text", 62, 985, None, 18),
    ("topbar",         ".topbar",                              "box", 210, 0,   1230, 56),
    ("conv-col",       ".conversation-col",                    "box", 415, 56,  820, 968),
    # 空白会话（最新 306:74 复核）：标识 40×40 @ y=235；标题 28px/40 于 44 高框 y=294；
    # 副标题单行 26 高 y=350；输入框 y=394（820×164）；提示区与底部说明已按最新稿移除。
    ("blank-mark",     ".blank-mark",                          "box", 415 + 390, 56 + 235, 40, 40),
    ("blank-title-text", ".blank-title",                       "text", None, 56 + 296, None, 40),
    ("blank-sub",      ".blank-sub",                           "box", 415 + 60, 56 + 350, 700, 26),
    ("composer",       ".composer--blank",                     "box", 415, 56 + 394, 820, 164),
    ("btn-attach",     ".composer--blank .btn-ghost:not(.btn-link)", "box", 415 + 18, 56 + 502, 112, 38),
    ("btn-link",       ".composer--blank .btn-link",           "box", 415 + 140, 56 + 502, 108, 38),
    ("btn-send",       ".composer--blank .btn-send",           "box", 415 + 706, 56 + 502, 96, 36),
]

# 浮窗内部（相对浮窗外框原点）。
# 浮窗为用户已验收的定版方案（见 BOTTOM_ANCHOR_REPORT.md）：264px 含边框、菜单行 38、
# 头像 36、图标 18、底边距账户入口 8px（bottom:84 = 入口 76 + 8）；创建者态 264×389。
EXPECT_POPOVER = [
    ("pop-account",     ".pop-account",     "box", 9, 9, 246, 56),
    ("pop-space",       ".pop-space",       "box", 9, 65, 246, 60),
    ("pop-avatar",      ".pop-avatar",      "box", 17, 19, 36, 36),
    ("pop-name-text",   ".pop-name",        "text", 63, 16.5, None, 20),
    ("pop-team-avatar", ".space-avatar",    "box", 17, 77, 36, 36),
    ("pop-switch-btn",  ".switch-btn",      "box", 215, 79, 32, 32),
    ("pop-menu-row1",   ".pop-menu .pop-menu-item", "box", 9, 130, 246, 38),
    ("pop-menu-row2",   ".pop-menu .pop-menu-item:nth-child(2)", "box", 9, 168, 246, 38),
    ("pop-unread",      ".badge-unread",    "box", 219, 262, 23, 20),  # 通知行（账号功能组第 1 行）
]

BOX_JS = "e => { const r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }"
TEXT_JS = "e => { const r = document.createRange(); r.selectNodeContents(e); const b = r.getBoundingClientRect(); return [b.x, b.y, b.width, b.height]; }"


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 1024})
        page.goto((ROOT / "index.html").resolve().as_uri())
        page.wait_for_selector(".nav-item[data-project-id]")

        rows = []
        bad = 0

        def measure(entry, origin=(0, 0)):
            nonlocal bad
            name, sel, mode, ex, ey, ew, eh = entry
            js = BOX_JS if mode == "box" else TEXT_JS
            try:
                x, y, w, h = page.eval_on_selector(sel, js)
            except Exception:
                rows.append((name, "MISSING", sel))
                bad += 1
                return
            dx = dy = dw = dh = None
            if ex is not None: dx = round(x - (ex + origin[0]), 1)
            if ey is not None: dy = round(y - (ey + origin[1]), 1)
            if ew is not None: dw = round(w - ew, 1)
            if eh is not None: dh = round(h - eh, 1)
            ok = all(v is None or abs(v) <= 2 for v in (dx, dy, dw, dh))
            if not ok:
                bad += 1
            rows.append((name, "OK" if ok else "DIFF", f"Δx={dx} Δy={dy} Δw={dw} Δh={dh}"))

        for entry in EXPECT:
            measure(entry)

        # 顶栏右侧 meta（空白会话态「新会话」）右缘对齐 Figma 1200（顶栏右缘 1230 - 30）
        meta_right = page.eval_on_selector(".top-meta", "e => e.getBoundingClientRect().right")
        meta_ok = abs(meta_right - (210 + 1200)) <= 2  # 顶栏相对 1200 + 侧栏 210
        rows.append(("topbar-meta-right", "OK" if meta_ok else "DIFF", f"right={meta_right:.1f} 期望 1410（顶栏内 1200）"))
        if not meta_ok:
            bad += 1

        # 打开浮窗后量内部结构
        page.click("#account-entry")
        page.wait_for_selector(".account-popover")
        page.wait_for_timeout(300)  # 等待入场动画（0.12s，含 6px 位移）结束
        pop = page.eval_on_selector(".account-popover", BOX_JS)
        check_pop = (
            abs(pop[0] - 12) <= 2,
            abs(pop[1] - 551) <= 3,  # 1024 - 84(底边) - 389(创建者高)
            abs(pop[2] - 264) <= 2,
            abs(pop[3] - 389) <= 3,
        )
        print(f"  浮窗整体: x={pop[0]:.0f} y={pop[1]:.0f} w={pop[2]:.1f} h={pop[3]:.1f} (定版期望 264×389 @ (12,551))")
        if not all(check_pop):
            bad += 1
            rows.append(("popover-size", "DIFF", f"x={pop[0]:.0f} y={pop[1]:.0f} w={pop[2]:.1f} h={pop[3]:.1f} 期望 264×389 @ (12,551)"))
        else:
            rows.append(("popover-size", "OK", "264×389 @ (12,551)"))
        for entry in EXPECT_POPOVER:
            measure(entry, origin=(pop[0], pop[1]))

        for name, st, msg in rows:
            print(f"  [{st:8s}] {name:18s} {msg}")
        print(f"\n布局对照：{len(rows) - bad}/{len(rows)} 项在 ±2px 内")
        browser.close()
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc()
        sys.exit(2)
