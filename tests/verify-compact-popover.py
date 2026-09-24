# -*- coding: utf-8 -*-
"""264px 紧凑浮窗专项 + 既有输入/草稿/键盘回归。仅使用隔离本地浏览器。
python -X utf8 tests/verify-compact-popover.py
不读写V9、不接入真实服务；最新Figma首页视觉同步不在本轮范围。
"""
from pathlib import Path
import functools
import hashlib
import http.server
import importlib.util
import json
import sys
import threading
import traceback
import zipfile
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots/20260924-popover-compact'
EVIDENCE = ROOT / 'tests/evidence/20260924-popover-compact'
SHOTS.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('local_fix', ROOT / 'tests/verify-local-fix.py')
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)
legacy.SHOTS = SHOTS / 'regression-local'
legacy.SHOTS.mkdir(exist_ok=True)
check, rect, in_view = legacy.check, legacy.rect, legacy.in_view
MEASUREMENTS = []


def snap(page, name):
    page.screenshot(path=str(SHOTS / (name + '.png')))


def css(page, selector, prop):
    return page.locator(selector).first.evaluate('(e,p)=>getComputedStyle(e)[p]', prop)


def no_overlap(page, a, b):
    return page.evaluate('''([a,b])=>{const x=document.querySelector(a).getBoundingClientRect(),y=document.querySelector(b).getBoundingClientRect();return Math.min(x.right,y.right)<=Math.max(x.left,y.left)+.1 || Math.min(x.bottom,y.bottom)<=Math.max(x.top,y.top)+.1;}''', [a,b])


def compact_dimensions(browser, url):
    ctx, page = legacy.fresh(browser, url)
    for width,height in [(1440,1024),(1280,800)]:
        page.set_viewport_size({'width':width,'height':height})
        legacy.open_pop(page)
        page.mouse.move(1000,700)
        prefix = str(width)+': '
        box = rect(page,'.account-popover')
        MEASUREMENTS.append({'viewport':[width,height],'popover':box})
        check(prefix+'外框264×389含边框，无固定高度', box['width']==264 and box['height']==389 and css(page,'.account-popover','boxSizing')=='border-box')
        check(prefix+'昵称14px，菜单14/20/400', css(page,'.pop-name','fontSize')=='14px' and css(page,'.pop-menu-item','fontSize')=='14px' and css(page,'.pop-menu-item','lineHeight')=='20px' and css(page,'.pop-menu-item','fontWeight')=='400')
        check(prefix+'账号区56、空间区60',rect(page,'.pop-account')['height']==56 and rect(page,'.pop-space')['height']==60)
        check(prefix+'账号头像与空间头像均36，占位字均14',page.locator('.pop-avatar,.space-avatar').evaluate_all("es=>es.every(e=>e.getBoundingClientRect().width===36 && e.getBoundingClientRect().height===36 && getComputedStyle(e).fontSize==='14px')"))
        check(prefix+'账号/团队文字与头像左边缘分别对齐',rect(page,'.pop-name')['x']==rect(page,'.space-name')['x'] and rect(page,'.pop-avatar')['x']==rect(page,'.space-avatar')['x'])
        check(prefix+'账号与空间图文间距均10',css(page,'.pop-account','gap')=='10px' and css(page,'.space-row','gap')=='10px')
        check(prefix+'菜单行高38、图标18、间距10、圆角6',page.locator('.pop-menu-item').evaluate_all("es=>es.every(e=>e.getBoundingClientRect().height===38 && getComputedStyle(e).gap==='10px' && getComputedStyle(e).borderRadius==='6px' && e.querySelector('img').getBoundingClientRect().width===18)"))
        check(prefix+'外框padding8、圆角8、无投影',css(page,'.account-popover','padding')=='8px' and css(page,'.account-popover','borderRadius')=='8px' and css(page,'.account-popover','boxShadow')=='none')
        check(prefix+'菜单亮度/背景/边框颜色保留',css(page,'.pop-menu-item','color')=='rgb(232, 234, 240)' and css(page,'.account-popover','backgroundColor')=='rgb(27, 28, 34)' and css(page,'.account-popover','borderTopColor')=='rgb(52, 55, 65)')
        check(prefix+'空间名称字体栈与首页侧栏一致',css(page,'.space-name','fontFamily')==css(page,'.nav-label','fontFamily'))
        check(prefix+'邮箱12、身份12、标签11、切换按钮32保留',css(page,'.pop-email','fontSize')=='12px' and css(page,'.space-role','fontSize')=='12px' and css(page,'.tag-space','fontSize')=='11px' and rect(page,'.switch-btn')['width']==32)
        check(prefix+'整体不溢出，未做zoom/scale',in_view(page,'.account-popover') and box['client']==box['scroll'] and css(page,'.account-popover','zoom')=='1' and css(page,'.account-popover','transform')=='none')
        snap(page,'after-home-'+str(width))
        if width==1440:
            page.locator('.account-popover').screenshot(path=str(SHOTS/'after-popover.png'))
            cdp=ctx.new_cdp_session(page); cdp.send('DOM.enable'); cdp.send('CSS.enable')
            doc=cdp.send('DOM.getDocument')['root']['nodeId']; fonts={}
            for sel in ['.nav-label','.space-name','.pop-name','.pop-email']:
                node=cdp.send('DOM.querySelector',{'nodeId':doc,'selector':sel})['nodeId']
                fonts[sel]=cdp.send('CSS.getPlatformFontsForNode',{'nodeId':node})['fonts']
            (EVIDENCE/'actual-fonts.json').write_text(json.dumps(fonts,ensure_ascii=False,indent=2),encoding='utf-8')
            cdp.detach()
        page.keyboard.press('Escape')
    # 静态四态组件同尺度检查；仅隔离测试DOM，不提供用户可见角色开关。
    states=[('creator-default',389),('personal-with-team',351),('personal-no-team',329),('team-member',351),('team-admin',389)]
    for key,h in states:
        page.evaluate('''key=>{const f=Fixtures.popoverTestFixtures.find(f=>f.key===key);document.querySelector('#popover-root').innerHTML='<div class="account-popover">'+UI.popoverAccountHTML(UI.computePopoverModel(f),{})+'</div>';}''',key)
        page.wait_for_timeout(150)
        box=rect(page,'.account-popover')
        check(key+': 四态同宽264且高度按内容自然缩短',box['width']==264 and box['height']==h,box)
        MEASUREMENTS.append({'state':key,'width':box['width'],'height':box['height']})
        page.locator('.account-popover').screenshot(path=str(SHOTS/('state-'+key+'.png')))
    ctx.close()


def tooltip_placement(browser,url):
    ctx,page=legacy.fresh(browser,url)
    legacy.open_pop(page)
    page.hover('.switch-btn');page.wait_for_selector('.switch-hint',state='visible')
    check('提示独立在浮窗外，不属于滚动容器',page.locator('.switch-hint').evaluate("e=>!e.closest('.account-popover') && e.parentElement.id==='popover-root'"))
    check('宽窗口提示右置，外框间隔8px',rect(page,'.switch-hint')['x']-rect(page,'.account-popover')['right']==8 and page.get_attribute('.switch-hint','data-placement')=='right')
    check('提示不覆盖团队名称、标签、身份或浮窗',all(no_overlap(page,'.switch-hint',sel) for sel in ['.space-name','.space-tags','.space-role','.account-popover']))
    check('提示ARIA引用仍指向真实节点',page.locator('.switch-btn').evaluate("e=>document.getElementById(e.getAttribute('aria-describedby')).getAttribute('role')==='tooltip'"))
    snap(page,'after-tooltip-right')
    for sel in ['.space-avatar','.space-name','.space-role']:
        page.hover(sel);page.wait_for_selector('.switch-hint',state='hidden')
        check('悬停'+sel+'不显示提示',not page.locator('.switch-hint').is_visible())
    page.keyboard.press('Escape')
    # 右侧不够时，选择浮窗上方或下方；不覆盖任何信息。
    for width,height,expected in [(320,800,'top'),(320,420,'bottom'),(280,240,'bottom')]:
        page.set_viewport_size({'width':width,'height':height})
        legacy.open_pop(page,keyboard=True);page.wait_for_selector('.switch-hint',state='visible')
        prefix=str(width)+'x'+str(height)+': '
        check(prefix+'提示避让位置正确',page.get_attribute('.switch-hint','data-placement')==expected)
        check(prefix+'提示和浮窗都在可视窗口内',in_view(page,'.switch-hint') and in_view(page,'.account-popover'))
        check(prefix+'提示不遮挡浮窗任何内容',no_overlap(page,'.switch-hint','.account-popover'))
        snap(page,'tooltip-'+str(width)+'x'+str(height))
        page.keyboard.press('Escape')
        check(prefix+'关闭无残留提示、焦点回入口',page.locator('.switch-hint').count()==0 and page.evaluate("document.activeElement.id==='account-entry'"))
    page.set_viewport_size({'width':320,'height':420})
    legacy.open_pop(page,keyboard=True);page.wait_for_selector('.switch-hint',state='visible')
    page.locator('.pop-menu-item--logout').focus();page.wait_for_selector('.switch-hint',state='hidden')
    check('键盘滚动到底部后不会遗留旧提示',in_view(page,'.pop-menu-item--logout') and not page.locator('.switch-hint').is_visible())
    page.keyboard.press('Escape')
    # 切换中即使鼠标移开/列表滚动，必要反馈仍在浮窗外。
    page.set_viewport_size({'width':1280,'height':800})
    page.evaluate('() => __creatorScoutStore.__setTransport((spaceId,seq)=>new Promise(r=>setTimeout(()=>r({spaceId,seq}),700)))')
    legacy.open_pop(page,keyboard=True);page.keyboard.press('Enter');page.wait_for_selector('.switch-hint.is-busy',state='visible')
    page.mouse.move(1000,700)
    check('切换中外置反馈保留且不盖名字',page.locator('.switch-hint.is-busy').is_visible() and no_overlap(page,'.switch-hint','.account-popover'))
    page.wait_for_function('() => !__creatorScoutStore.isSwitching()')
    check('切换完成浮窗保留、忙碌提示恢复为普通按钮提示',page.locator('.account-popover').count()==1 and page.locator('.switch-hint.is-busy').count()==0 and page.locator('.switch-hint').count()==1)
    for _ in range(6):
        legacy.open_pop(page,keyboard=True);page.wait_for_selector('.switch-hint',state='visible')
        page.keyboard.press('Escape')
    check('重复打开/关闭没有重复节点',page.locator('.switch-hint').count()==0)
    ctx.close()


def scope_and_comparison():
    protected=json.loads((EVIDENCE/'protected-sha.json').read_text(encoding='utf8'))
    for path,digest in protected.items():
        check('范围保护: '+path,hashlib.sha256((ROOT.parent/path).read_bytes()).hexdigest()==digest)
    with zipfile.ZipFile(EVIDENCE/'before-source.zip') as z:
        before=z.read('css/styles.css').decode('utf8');after=(ROOT/'css/styles.css').read_text(encoding='utf8')
        check('主内容/侧栏CSS未改变，仅浮窗区变化',before.split(' * 账户浮窗')[0]==after.split(' * 账户浮窗')[0] and before.split(' * 轻提示（Toast）')[1]==after.split(' * 轻提示（Toast）')[1])
        changed=[name for name in z.namelist() if hashlib.sha256(z.read(name)).digest()!=hashlib.sha256((ROOT/name).read_bytes()).digest()]
        (EVIDENCE/'modified-tracked-by-backup.json').write_text(json.dumps(changed,ensure_ascii=False,indent=2),encoding='utf8')
    a=Image.open(SHOTS/'before-popover.png').convert('RGB');b=Image.open(SHOTS/'after-popover.png').convert('RGB')
    check('前后截图原始像素尺寸264×389，未缩放伪造',a.size==(280,459) and b.size==(264,389))
    out=Image.new('RGB',(632,531),'#0F1115');draw=ImageDraw.Draw(out)
    try: font=ImageFont.truetype('arial.ttf',17)
    except OSError: font=ImageFont.load_default()
    draw.text((24,16),'Before 280 x 459',font=font,fill='#E8EAF0');draw.text((344,16),'After 264 x 389',font=font,fill='#E8EAF0')
    out.paste(a,(24,48));out.paste(b,(344,48));out.save(SHOTS/'before-after-100pct.png')


def main():
    legacy.RESULTS.clear();legacy.ERRORS.clear()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(legacy.QuietHandler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url='http://127.0.0.1:%d/index.html'%server.server_port
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            for fn in [compact_dimensions,tooltip_placement,legacy.home_and_keyboard,legacy.long_names_and_states,legacy.drafts_and_growing,legacy.busy_focus]:
                try: fn(browser,url)
                except Exception: check(fn.__name__+'执行完成',False,traceback.format_exc())
            browser.close()
        scope_and_comparison()
        check('无JavaScript运行时错误',not legacy.ERRORS,legacy.ERRORS)
    finally:
        server.shutdown();server.server_close()
    report={'passed':sum(r['pass'] for r in legacy.RESULTS),'failed':sum(not r['pass'] for r in legacy.RESULTS),'results':legacy.RESULTS,'measurements':MEASUREMENTS,
            'scope':'264px紧凑浮窗；Figma首页视觉同步和真实服务不在本轮范围。'}
    (EVIDENCE/'compact-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print('\nTOTAL: %d passed, %d failed'%(report['passed'],report['failed']),flush=True)
    return 1 if report['failed'] else 0


if __name__=='__main__':
    sys.exit(main())
