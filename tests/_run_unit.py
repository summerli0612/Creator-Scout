# -*- coding: utf-8 -*-
"""在浏览器里跑 tests.html 单元测试并输出汇总。"""
import sys, pathlib
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass
ROOT = pathlib.Path(__file__).resolve().parent.parent
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context().new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto((ROOT / "tests" / "tests.html").resolve().as_uri())
    pg.wait_for_selector("#summary")
    pg.wait_for_function("() => !document.getElementById('summary').innerText.includes('运行中')", timeout=20000)
    print("汇总:", pg.inner_text("#summary"))
    fails = pg.evaluate("() => Array.from(document.querySelectorAll('.result-fail')).map(e => e.innerText)")
    for f in fails:
        print("FAIL:", f)
    if errs:
        print("PAGEERROR:", errs[:5])
    b.close()
    sys.exit(1 if fails or errs else 0)
