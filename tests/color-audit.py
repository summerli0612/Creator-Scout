# -*- coding: utf-8 -*-
"""颜色对照：在实现截图中采样关键位置，与 Figma 设计值（Token）比对。

前置：先运行 tests/verify.py 生成最新截图。
位置按动画结束后的最终几何计算（浮窗 top = 1024 - 84 - 高度）。
"""
import sys, pathlib
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
from PIL import Image

SHOTS = pathlib.Path(__file__).resolve().parent.parent / "screenshots"


def sample(path, points, tol=6):
    im = Image.open(path).convert("RGB")
    ok, bad = 0, 0
    print(f"\n== {path.name} ==")
    for name, (x, y), expect in points:
        actual = im.getpixel((x, y))
        diff = max(abs(a - e) for a, e in zip(actual, expect))
        passed = diff <= tol
        ok += passed
        bad += (not passed)
        mark = "OK  " if passed else "FAIL"
        print(f"  [{mark}] {name:26s} 实测 RGB{actual} 期望 RGB{expect} (Δmax={diff})")
    return ok, bad


total_ok = total_bad = 0

# 首页（1440×1024，团队空间默认态；会话列居中 415..1235）
home = [
    ("侧栏背景 #14161B",        (105, 700),  (20, 22, 27)),
    ("选中导航底 #202A28",      (194, 123),  (32, 42, 40)),
    ("主画布 #0F1115",          (1300, 950), (15, 17, 21)),
    ("顶栏背景 #14161B",        (950, 28),   (20, 22, 27)),
    ("输入区背景 #1B1D23",      (900, 500),  (27, 29, 35)),
    ("账户头像底 #123F34",      (22, 975),   (18, 63, 52)),
    ("发送按钮禁用底 #2B2E35",  (1205, 577), (43, 46, 53)),
]
ok, bad = sample(SHOTS / "home-team-default-1440.png", home)
total_ok += ok; total_bad += bad

# 品牌标识：侧栏 Logo 图标（16..48 × 18..50）的环色与发现点
im = Image.open(SHOTS / "home-team-default-1440.png").convert("RGB")
logo = {"ring": 0, "mint": 0}
for yy in range(18, 50):
    for xx in range(16, 48):
        c = im.getpixel((xx, yy))
        if max(abs(c[0]-243), abs(c[1]-252), abs(c[2]-249)) <= 12: logo["ring"] += 1
        elif max(abs(c[0]-142), abs(c[1]-227), abs(c[2]-208)) <= 12: logo["mint"] += 1
logo_ok = logo["ring"] > 30 and logo["mint"] > 3
print(f"\n  品牌 Logo 图标采样：环色像素 {logo['ring']}，发现点像素 {logo['mint']}")
print(f"  [{'OK  ' if logo_ok else 'FAIL'}] Logo 环 #F3FCF9 与发现点 #8EE3D0 均存在（转轮廓 SVG 生效）")
total_ok += logo_ok; total_bad += (not logo_ok)

# 创建者浮窗（定版 264×389 @ (12,551)，见 BOTTOM_ANCHOR_REPORT.md；采样点避开文字/图标）
pop = [
    ("浮窗底 #1B1C22",          (250, 900),  (27, 28, 34)),
    ("账号头像底 #345F55",      (34, 575),   (52, 95, 85)),
    ("团队标识底 #26413D",      (34, 633),   (38, 65, 61)),
    ("团队空间标签底 #2A3432",  (78, 650),   (42, 52, 50)),
    ("切换按钮底 #292E33",      (231, 634),  (41, 46, 51)),
    ("未读徽标底 #29443B",      (251, 823),  (41, 68, 59)),
    ("分隔线 #343741",          (200, 676),  (52, 55, 65)),
]
ok, bad = sample(SHOTS / "popover-team-creator.png", pop)
total_ok += ok; total_bad += bad

# 个人空间浮窗（定版 264×351 @ (12,589)）
pop2 = [
    ("个人浮窗底 #1B1C22",      (252, 619),  (27, 28, 34)),
    ("个人空间标识底 #2D3440",  (34, 671),   (45, 52, 64)),
]
ok, bad = sample(SHOTS / "popover-personal.png", pop2)
total_ok += ok; total_bad += bad

print(f"\n颜色对照：{total_ok}/{total_ok + total_bad} 项通过")
sys.exit(1 if total_bad else 0)
