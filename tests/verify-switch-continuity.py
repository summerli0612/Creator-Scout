# -*- coding: utf-8 -*-
"""空间切换连续性：同节点、无重复渲染、位置/焦点及既有功能回归。隔离浏览器，不接真实服务。"""
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

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots/20260924-switch-continuity'
EVIDENCE = ROOT / 'tests/evidence/20260924-switch-continuity'
SHOTS.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('compact_regression', ROOT / 'tests/verify-compact-popover.py')
compact = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compact)
legacy = compact.legacy
compact.SHOTS = SHOTS / 'regression-scale'
compact.EVIDENCE = EVIDENCE / 'regression-scale'
legacy.SHOTS = SHOTS / 'regression-interaction'
for folder in [compact.SHOTS, compact.EVIDENCE, legacy.SHOTS]:
    folder.mkdir(parents=True, exist_ok=True)
check, rect, in_view = legacy.check, legacy.rect, legacy.in_view
TEAM, PERSONAL = legacy.TEAM, legacy.PERSONAL
MEASUREMENTS = []


def shot(page, name):
    page.screenshot(path=str(SHOTS / (name + '.png')))


def same_box(a, b):
    return all(abs(a[k] - b[k]) < .1 for k in ['x', 'y', 'width', 'height'])


def instrument(page):
    page.evaluate('''() => {
      window.audit={renders:{sidebar:0,top:0,conversation:0},animations:0,calls:0,
        pop:document.querySelector('.account-popover'),button:document.querySelector('.switch-btn'),
        account:document.querySelector('.pop-account'),row:document.querySelector('.space-row'),
        input:document.querySelector('textarea'),entry:document.querySelector('#account-entry'),
        side:document.querySelector('#sidebar-scroll').firstElementChild};
      [['renderSidebar','sidebar'],['renderTopbar','top'],['renderConversation','conversation']].forEach(([fn,key])=>{
        const original=UI[fn];UI[fn]=function(){audit.renders[key]++;return original.apply(this,arguments);};
      });
      audit.pop.addEventListener('animationstart',()=>audit.animations++);
      __creatorScoutStore.__setTransport((spaceId,seq)=>new Promise((resolve,reject)=>{
        audit.calls++;window.finishSwitch=()=>resolve({spaceId,seq});window.failSwitch=()=>reject(new Error('受控失败'));
      }));
    }''')


def begin(page, keyboard=False):
    page.evaluate('() => { window.finishSwitch=null;window.failSwitch=null; }')
    if keyboard:
        page.locator('.switch-btn').focus()
        page.keyboard.press('Enter')
    else:
        page.locator('.switch-btn').click()
    page.wait_for_function('() => __creatorScoutStore.isSwitching() && typeof finishSwitch === "function"')


def finish(page, failure=False):
    page.evaluate('() => failSwitch()' if failure else '() => finishSwitch()')
    page.wait_for_function('() => !__creatorScoutStore.isSwitching() && !document.querySelector(".account-popover[data-resizing]")')
    if failure:
        page.wait_for_selector('.toast-action')


def identity(page):
    return page.evaluate('''() => ({pop:audit.pop===document.querySelector('.account-popover'),
      button:audit.button===document.querySelector('.switch-btn'),account:audit.account===document.querySelector('.pop-account'),
      row:audit.row===document.querySelector('.space-row')})''')


def continuous_switch(browser, url):
    for width, height in [(1440,1024),(1280,800)]:
        ctx, page = legacy.fresh(browser, url, width, height)
        page.fill('textarea', '团队空间未发送内容必须保留')
        legacy.open_pop(page, keyboard=True)
        instrument(page)
        first_bottom = rect(page, '.account-popover')['bottom']
        for n, target in enumerate([PERSONAL, TEAM, PERSONAL, TEAM]):
            prefix = f'{width} 第{n+1}次：'
            before_renders = page.evaluate('JSON.stringify(audit.renders)')
            current_space = page.evaluate('__creatorScoutStore.getState().currentSpaceId')
            before_button = rect(page, '.switch-btn')
            page.evaluate('() => {audit.input=document.querySelector("textarea");audit.entry=document.querySelector("#account-entry");}')
            if width == 1440 and n == 0:
                shot(page, '01-before-team')
            begin(page, keyboard=True)
            check(prefix+'busy阶段浮窗/账号/切换按钮/空间行都是原节点', all(identity(page).values()))
            check(prefix+'busy阶段背景零重绘、输入与入口节点不变', page.evaluate('JSON.stringify(audit.renders)') == before_renders and page.evaluate('audit.input===document.querySelector("textarea") && audit.entry===document.querySelector("#account-entry")'))
            check(prefix+'忙碌时旧空间仍一致且禁用重复操作', page.evaluate('__creatorScoutStore.getState().currentSpaceId') == current_space and page.locator('.account-popover button').evaluate_all('es=>es.every(e=>e.disabled)'))
            calls = page.evaluate('audit.calls')
            page.evaluate('audit.button.dispatchEvent(new MouseEvent("click",{bubbles:true}))')
            check(prefix+'重复点击不发出第二次请求', page.evaluate('audit.calls') == calls)
            check(prefix+'切换未提交时按钮坐标稳定', same_box(before_button, rect(page,'.switch-btn')))
            if width == 1440 and n == 0:
                shot(page, '02-switching-team-to-personal')
            finish(page)
            expected = '个人空间' if target == PERSONAL else 'Northstar Studio'
            check(prefix+'成功浮窗原位保留且关键节点不变', all(identity(page).values()) and page.locator('.account-popover').is_visible())
            check(prefix+'成功背景各区域只更新一次', page.evaluate('audit.renders') == {'sidebar':n+1,'top':n+1,'conversation':n+1})
            check(prefix+'目标空间、侧栏项目、浮窗信息同步', page.evaluate('__creatorScoutStore.getState().currentSpaceId') == target and page.inner_text('.space-name') == expected and (('PetPal Essentials' if target==PERSONAL else 'Aurora Skincare') in page.inner_text('#sidebar-scroll')))
            check(prefix+'成功焦点在原切换按钮且账号信息不变', page.evaluate('document.activeElement===audit.button') and page.inner_text('.pop-name') == '林小满')
            box = rect(page, '.account-popover')
            check(prefix+'浮窗底边固定距入口8px，上边缘随自然高度变化', abs(box['bottom']-first_bottom)<.1 and abs(rect(page,'#account-entry')['y']-box['bottom']-8)<.1 and box['height']==(351 if target==PERSONAL else 389) and abs(rect(page,'.switch-btn')['y']-box['y']-79)<.1)
            check(prefix+'没有重播入场动画或弹成功toast',page.evaluate('audit.animations')==0 and page.locator('.toast').count()==0)
            check(prefix+'团队管理显隐与当前空间一致，不留空行',page.locator('.pop-menu-item[data-name="团队管理"]').count()==(0 if target==PERSONAL else 1) and page.locator('.pop-menu-item').count()==(5 if target==PERSONAL else 6))
            check(prefix+'无障碍状态包含成功目标',page.inner_text('#space-switch-status')=='已切换到'+expected)
            MEASUREMENTS.append({'viewport':[width,height],'target':target,'popover':rect(page,'.account-popover'),'button':rect(page,'.switch-btn'),'renders':page.evaluate('audit.renders')})
            if target==TEAM:
                check(prefix+'原团队草稿恢复',page.input_value('textarea')=='团队空间未发送内容必须保留')
            if width==1440 and n<2:
                shot(page,'03-after-personal-kept-open' if n==0 else '04-return-team-kept-open')
        page.keyboard.press('Tab')
        check(f'{width} 成功后Tab顺序可继续操作',page.evaluate('document.activeElement.dataset.name')=='用量与计费')
        page.keyboard.press('Escape')
        check(f'{width} Esc主动关闭并回账户入口',page.locator('.account-popover').count()==0 and page.evaluate('document.activeElement.id')=='account-entry')
        ctx.close()


def failure_and_retry(browser,url):
    ctx,page=legacy.fresh(browser,url)
    page.fill('textarea',legacy.LONG_TEXT)
    page.locator('textarea').evaluate('e=>{e.scrollTop=80;e.setSelectionRange(25,35);}')
    legacy.open_pop(page,keyboard=True)
    instrument(page)
    scroll=page.locator('textarea').evaluate('e=>e.scrollTop')
    position=rect(page,'.switch-btn')
    begin(page,keyboard=True)
    finish(page,failure=True)
    check('失败：浮窗/按钮/账号区保留同节点',all(identity(page).values()))
    check('失败：背景不重绘，长输入、滚动不丢',page.evaluate('audit.renders')=={'sidebar':0,'top':0,'conversation':0} and page.evaluate('audit.input===document.querySelector("textarea")') and page.input_value('textarea')==legacy.LONG_TEXT and page.locator('textarea').evaluate('e=>e.scrollTop')==scroll)
    check('失败：原空间/位置保留且焦点回切换按钮',page.evaluate('__creatorScoutStore.getState().currentSpaceId')==TEAM and same_box(position,rect(page,'.switch-btn')) and page.evaluate('document.activeElement===audit.button'))
    shot(page,'05-failed-kept-open')
    page.locator('.toast-action').click()
    page.wait_for_function('() => __creatorScoutStore.isSwitching() && audit.calls===2')
    check('重试点击属于浮窗操作，不触发外部关闭',all(identity(page).values()) and page.locator('.account-popover').is_visible())
    finish(page)
    check('重试成功仍保留同一浮窗/按钮，不残留失败提示',all(identity(page).values()) and page.locator('.toast').count()==0 and page.inner_text('.space-name')=='个人空间')
    check('重试成功背景仅更新一次、焦点留原按钮',page.evaluate('audit.renders')=={'sidebar':1,'top':1,'conversation':1} and page.evaluate('document.activeElement===audit.button'))
    # 当前目标菜单继续可用，不伪造真实服务。
    page.click('.pop-menu-item[data-name="用量与计费"]')
    check('切换后菜单可继续操作并保持当前空间',page.evaluate('__creatorScoutStore.getState().currentSpaceId')==PERSONAL and '暂未开放' in page.locator('.toast').last.inner_text())
    ctx.close()


def explicit_dismiss(browser,url):
    for method in ['outside','escape','account']:
        for failure in [False,True]:
            ctx,page=legacy.fresh(browser,url)
            page.fill('textarea','主动关闭也不丢的内容')
            legacy.open_pop(page,keyboard=True)
            instrument(page)
            begin(page,keyboard=True)
            if method=='outside':
                page.click('textarea')
            elif method=='escape':
                page.keyboard.press('Escape')
            else:
                page.click('#account-entry')
            prefix=method+('/失败' if failure else '/成功')+'：'
            check(prefix+'进行中可以主动关闭',page.locator('.account-popover').count()==0 and page.locator('.switch-hint').count()==0)
            finish(page,failure)
            expected_selector='textarea' if method=='outside' else '#account-entry'
            check(prefix+'结果回调不重开、不抢焦点',page.locator('.account-popover').count()==0 and page.locator('.switch-hint').count()==0 and page.locator(expected_selector).evaluate('e=>e===document.activeElement && e.isConnected'))
            check(prefix+'数据按结果提交且源空间草稿仍在',page.evaluate('__creatorScoutStore.getState().currentSpaceId')==(TEAM if failure else PERSONAL) and page.evaluate('__creatorScoutStore.getDraft("sp-team-northstar","__blank__")')=='主动关闭也不丢的内容')
            ctx.close()
    ctx,page=legacy.fresh(browser,url)
    legacy.open_pop(page,keyboard=True);instrument(page);begin(page,keyboard=True)
    page.keyboard.press('Escape');page.click('#account-entry')
    reopened=page.locator('.account-popover').element_handle()
    check('用户主动重新打开：展示同一个进行中的状态',page.locator('.account-popover').get_attribute('aria-busy')=='true' and page.locator('.switch-btn').is_disabled())
    finish(page)
    check('用户重新打开后：成功仍保留新打开的浮窗',page.evaluate('(node)=>node===document.querySelector(".account-popover")',reopened))
    ctx.close()


def small_and_personal_start(browser,url):
    for width,height in [(1280,800),(320,420),(280,240)]:
        ctx,page=legacy.fresh(browser,url,width,height)
        page.evaluate('(id)=>__creatorScoutStore.switchSpace(id)',PERSONAL)
        legacy.open_pop(page,keyboard=True);instrument(page)
        bottom=rect(page,'.account-popover')['bottom']
        prefix=f'{width}×{height} 从个人开始：'
        for target in [TEAM,PERSONAL,TEAM]:
            begin(page,keyboard=True);finish(page)
            check(prefix+target+' 底边贴入口8px且不出屏',abs(rect(page,'.account-popover')['bottom']-bottom)<.1 and abs(rect(page,'#account-entry')['y']-rect(page,'.account-popover')['bottom']-8)<.1 and in_view(page,'.account-popover'))
            check(prefix+target+' 提示可见且不盖浮窗',page.locator('.switch-hint').is_visible() and in_view(page,'.switch-hint') and compact.no_overlap(page,'.switch-hint','.account-popover'))
        if height<500:
            page.locator('.pop-menu-item--logout').focus()
            check(prefix+'键盘仍可滚动到最底项',in_view(page,'.pop-menu-item--logout'))
        shot(page,f'06-personal-start-{width}x{height}')
        # 打开期间改变窗口，不能丢失节点或掉到可视区外。
        page.set_viewport_size({'width':1280,'height':800})
        page.wait_for_timeout(60)
        check(prefix+'resize不重建浮窗且仍在屏内',all(identity(page).values()) and in_view(page,'.account-popover'))
        ctx.close()


def memory_tests(browser,url):
    page=browser.new_page()
    page.goto(url.replace('index.html','tests/tests.html'))
    page.wait_for_function('!document.querySelector("#summary").textContent.includes("运行中")')
    summary=page.inner_text('#summary')
    check('原浏览器内逻辑测试全部通过', '失败 0' in summary,summary)
    print('UNIT_SUMMARY '+summary,flush=True)
    page.close()


def scope_audit():
    for path,digest in json.loads((EVIDENCE/'protected-sha.json').read_text(encoding='utf8')).items():
        check('范围保护 '+path,hashlib.sha256((ROOT.parent/path).read_bytes()).hexdigest()==digest)
    with zipfile.ZipFile(EVIDENCE/'before-source.zip') as z:
        changed=[name for name in z.namelist() if hashlib.sha256(z.read(name)).digest()!=hashlib.sha256((ROOT/name).read_bytes()).digest()]
    (EVIDENCE/'modified-files.json').write_text(json.dumps(changed,indent=2,ensure_ascii=False),encoding='utf8')


def main():
    legacy.RESULTS.clear();legacy.ERRORS.clear()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(legacy.QuietHandler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
    url='http://127.0.0.1:%d/index.html'%server.server_port
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            for fn in [continuous_switch,failure_and_retry,explicit_dismiss,small_and_personal_start,memory_tests,
                       compact.compact_dimensions,compact.tooltip_placement,legacy.home_and_keyboard,
                       legacy.long_names_and_states,legacy.drafts_and_growing,legacy.busy_focus]:
                try: fn(browser,url)
                except Exception: check(fn.__name__+'执行完成',False,traceback.format_exc())
            browser.close()
        scope_audit();check('无JavaScript运行时错误',not legacy.ERRORS,legacy.ERRORS)
    finally:
        server.shutdown();server.server_close()
    report={'passed':sum(r['pass'] for r in legacy.RESULTS),'failed':sum(not r['pass'] for r in legacy.RESULTS),
            'results':legacy.RESULTS,'measurements':MEASUREMENTS,'scope':'已验收264px视觉保持，原位切换连续性；仅本地模拟。'}
    (EVIDENCE/'continuity-results.json').write_text(json.dumps(report,indent=2,ensure_ascii=False),encoding='utf8')
    print('\nTOTAL: %d passed, %d failed'%(report['passed'],report['failed']),flush=True)
    return 1 if report['failed'] else 0


if __name__=='__main__':
    sys.exit(main())
