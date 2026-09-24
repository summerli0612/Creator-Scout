# -*- coding: utf-8 -*-
"""本轮局部修复集成验证；仅使用隔离浏览器、演示数据与本机临时 HTTP 服务。
运行：python -X utf8 tests/verify-local-fix.py
截图不是 Figma 通过证明：实时 Figma MCP 当前不可用，相关验收单独记为 BLOCKED。
"""
from pathlib import Path
import contextlib
import functools
import hashlib
import http.server
import json
import sys
import threading
import traceback
import xml.etree.ElementTree as ET
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots/20260924-popover-compact/regression-local'
EVIDENCE = ROOT / 'tests/evidence/20260924-local-fix'
SHOTS.mkdir(parents=True, exist_ok=True)
EVIDENCE.mkdir(parents=True, exist_ok=True)
RESULTS = []
ERRORS = []
TEAM = 'sp-team-northstar'
PERSONAL = 'sp-personal-lin'
LONG_TEXT = '\n'.join('第%d条：希望找到真实分享户外咖啡、便携装备与美国露营生活的 Instagram 达人。' % i for i in range(1, 41))


def check(name, ok, detail=None):
    item = {'name': name, 'pass': bool(ok)}
    if detail is not None:
        item['detail'] = detail
    RESULTS.append(item)
    print(('[PASS] ' if ok else '[FAIL] ') + name + ('' if ok or detail is None else ': ' + str(detail)), flush=True)
    return bool(ok)


def shot(page, name):
    page.screenshot(path=str(SHOTS / (name + '.png')), full_page=False)
    print('[SHOT] ' + name, flush=True)


def rect(page, selector):
    return page.locator(selector).evaluate('(e) => { const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom,client:e.clientWidth,scroll:e.scrollWidth}; }')


def in_view(page, selector):
    return page.locator(selector).evaluate('(e) => { const r=e.getBoundingClientRect(); return r.left>=0 && r.top>=0 && r.right<=innerWidth+0.1 && r.bottom<=innerHeight+0.1; }')


def open_pop(page, keyboard=False):
    if page.locator('.account-popover').count():
        page.keyboard.press('Escape')
    if keyboard:
        page.locator('#account-entry').focus()
        page.keyboard.press('Enter')
    else:
        page.locator('#account-entry').click()
    page.wait_for_selector('.account-popover')
    page.wait_for_timeout(150)


def switch(page, expected):
    if not page.locator('.account-popover').count():
        open_pop(page)
    page.locator('.switch-btn').click()
    page.wait_for_function('(expected) => __creatorScoutStore.getState().currentSpaceId === expected && !__creatorScoutStore.isSwitching() && !!document.querySelector(".account-popover")', arg=expected)


def height(page):
    return rect(page, '.composer textarea')['height']


def fresh(browser, url, width=1440, height=1024):
    ctx = browser.new_context(viewport={'width': width, 'height': height})
    page = ctx.new_page()
    page.on('pageerror', lambda e: ERRORS.append(str(e)))
    page.goto(url)
    page.wait_for_selector('.composer textarea')
    page.evaluate('() => document.fonts.ready')
    return ctx, page


def home_and_keyboard(browser, url):
    ctx, page = fresh(browser, url)
    check('首页：标题为用户确认文案', page.inner_text('.blank-title') == '你想找什么样的 Instagram 达人？')
    check('首页：辅助说明为用户确认文案', page.inner_text('.blank-sub') == '说说你的产品和目标市场，其他条件可以边聊边补充。')
    check('首页：示例仅为 placeholder', page.get_attribute('.composer textarea', 'placeholder') == '例如：我们做便携咖啡机，想找美国的户外类达人……' and page.input_value('textarea') == '')
    check('首页：空输入原生禁用发送按钮', page.locator('.btn-send').is_disabled() and not page.locator('.btn-send').evaluate("e=>e.classList.contains('is-ready')"))
    check('首页：三栏提示和首次发送说明无节点/占位', page.locator('.blank-hints,.blank-hints-label,.blank-note').count() == 0)
    check('1440：输入区在可视区域内', in_view(page, '.composer'))
    check('1440：未产生横向页面溢出', page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    shot(page, 'home-1440')
    open_pop(page)
    check('浮窗总宽度准确为 264px 含边框', abs(rect(page, '.account-popover')['width'] - 264) < .01)
    check('浮窗默认无常驻切换提示', not page.locator('.switch-hint').is_visible())
    for sel, label in [('.space-avatar', '头像'), ('.space-name', '名称'), ('.space-role', '身份')]:
        page.locator(sel).hover()
        check('仅按钮提示：悬停' + label + '不显示', not page.locator('.switch-hint').is_visible())
    page.locator('.switch-btn').hover()
    page.wait_for_selector('.switch-hint', state='visible')
    check('仅按钮提示：悬停切换按钮显示', page.locator('.switch-hint').is_visible())
    check('提示本身未越出可视区域', in_view(page, '.switch-hint'))
    shot(page, 'popover-264-hover')
    page.mouse.move(1000, 700)
    page.wait_for_selector('.switch-hint', state='hidden')
    check('仅按钮提示：离开后隐藏', not page.locator('.switch-hint').is_visible())
    shot(page, 'popover-264')
    page.keyboard.press('Escape')
    check('Esc 关闭浮窗并回到账户入口', page.locator('.account-popover').count() == 0 and page.evaluate("document.activeElement.id === 'account-entry'"))
    page.keyboard.press('Enter')
    check('键盘账户激活：焦点进入切换按钮', page.evaluate("document.activeElement.matches('.switch-btn')"))
    page.wait_for_selector('.switch-hint', state='visible')
    check('键盘聚焦按钮显示提示及可见焦点', page.locator('.switch-hint').is_visible() and page.locator('.switch-btn').evaluate("e => e.matches(':focus-visible') && getComputedStyle(e).outlineStyle !== 'none'"))
    ordered = page.locator('.account-popover button:not(:disabled)').evaluate_all("es=>es.map(e=>e.dataset.action+'|'+(e.dataset.name||''))")
    seen = []
    for _ in ordered:
        seen.append(page.evaluate("document.activeElement.dataset.action+'|'+(document.activeElement.dataset.name||'')"))
        page.keyboard.press('Tab')
    check('浮窗 Tab 按 DOM 视觉顺序遍历并循环', seen == ordered and page.evaluate("document.activeElement.matches('.switch-btn')"), {'seen': seen, 'expected': ordered})
    page.keyboard.press('Shift+Tab')
    check('浮窗 Shift+Tab 可反向循环到退出', page.evaluate("document.activeElement.matches('.pop-menu-item--logout')"))
    page.keyboard.press('Escape')
    open_pop(page)
    page.locator('.composer textarea').click()
    check('鼠标外部关闭不抢输入框焦点', page.locator('.account-popover').count() == 0 and page.evaluate("document.activeElement.matches('.composer textarea')"))
    page.fill('textarea', '取消退出后仍保留')
    for mode in ['mouse', 'escape']:
        open_pop(page, keyboard=True)
        page.locator('.pop-menu-item--logout').click()
        check('退出确认初始焦点有效：' + mode, page.evaluate("document.activeElement.dataset.modal === 'cancel'"))
        if mode == 'mouse':
            page.locator('[data-modal=cancel]').click()
        else:
            page.keyboard.press('Escape')
        check('退出取消焦点回到有效账户入口：' + mode, page.evaluate("document.activeElement.id === 'account-entry' && document.activeElement.isConnected"))
        check('退出取消未丢输入：' + mode, page.input_value('textarea') == '取消退出后仍保留')
    page.fill('textarea', '')
    page.set_viewport_size({'width': 1280, 'height': 800})
    check('1280：首页与输入操作无溢出', in_view(page, '.composer') and in_view(page, '.composer-actions') and page.evaluate('document.documentElement.scrollWidth <= innerWidth'))
    shot(page, 'home-1280')
    open_pop(page)
    check('1280：264px 浮窗不出屏', in_view(page, '.account-popover') and abs(rect(page, '.account-popover')['width']-264)<.01)
    shot(page, 'home-1280-popover')
    page.keyboard.press('Escape')
    ctx.close()


def long_names_and_states(browser, url):
    ctx, page = fresh(browser, url, 1280, 800)
    names = {'zh': '北极光创作者营销跨境品牌战略合作与内容研发工作室' * 3,
             'en': 'NorthlightInternationalCreatorPartnershipsAndMarketingStudio' * 3}
    keys = ['creator-default', 'personal-with-team', 'personal-no-team', 'team-member', 'team-admin']
    for lang, team_name in names.items():
        for key in keys:
            page.evaluate('''({key, teamName}) => {
              const fx=JSON.parse(JSON.stringify(Fixtures.popoverTestFixtures.find(f=>f.key===key)));
              fx.account.name='非常长的用户昵称用于验证单行省略与完整信息展示'.repeat(5);
              fx.account.email='very.long.creator.partnerships.alias+'.repeat(5)+'@international-brand.example.com';
              if(fx.team) fx.team.name=teamName;
              document.querySelector('#popover-root').innerHTML='<div class="account-popover">'+UI.popoverAccountHTML(UI.computePopoverModel(fx),{})+'</div>';
            }''', {'key': key, 'teamName': team_name})
            page.wait_for_timeout(150)
            prefix = lang + '/' + key
            check(prefix + '：总宽264且内容不撑开', abs(rect(page, '.account-popover')['width']-264)<.01 and page.locator('.account-popover').evaluate('e=>e.scrollWidth===e.clientWidth'))
            check(prefix + '：长昵称邮箱单行省略且保留全文 title', page.locator('.pop-name,.pop-email').evaluate_all("es=>es.every(e=>e.title===e.textContent && e.scrollWidth>e.clientWidth && getComputedStyle(e).textOverflow==='ellipsis' && getComputedStyle(e).whiteSpace==='nowrap')"))
            check(prefix + '：头像36及菜单行38准确且不被挤压', abs(rect(page, '.pop-avatar')['width']-36)<.01 and page.locator('.pop-menu-item').evaluate_all('es=>es.every(e=>e.getBoundingClientRect().height===38)'))
            if key == 'personal-no-team':
                check(prefix + '：空间区不存在且分隔线紧邻账号区', page.locator('.pop-space').count()==0 and abs(rect(page,'.pop-divider:nth-child(2)')['y']-rect(page,'.pop-account')['bottom'])<.01)
            else:
                check(prefix + '：切换按钮32、空间头像36且无内部越界', abs(rect(page,'.switch-btn')['width']-32)<.01 and page.locator('.space-avatar,.space-icon').evaluate('e=>e.getBoundingClientRect().width===36') and page.locator('.space-row').evaluate('e=>e.scrollWidth<=e.clientWidth'))
                if key.startswith('team-') or key=='creator-default':
                    check(prefix + '：团队长名称省略且 title 完整', page.locator('.space-name').evaluate('e=>e.title===e.textContent && e.scrollWidth>e.clientWidth'))
                    check(prefix + '：空间标签和身份未折行或挤压按钮', page.locator('.space-tags').evaluate("e=>{const a=e.children[0].getBoundingClientRect(),b=e.children[1].getBoundingClientRect(),s=document.querySelector('.switch-btn').getBoundingClientRect();return a.height===20 && b.height===18 && b.right<s.left && Math.abs((a.top+a.height/2)-(b.top+b.height/2))<1;}"))
            shot(page, 'long-' + lang + '-' + key)
    # 恢复产品实际浮窗，不留下调试状态。
    page.reload()
    for width, h in [(320, 420), (300, 300), (280, 240)]:
        page.set_viewport_size({'width': width, 'height': h})
        open_pop(page, keyboard=True)
        check('%dx%d：浮窗整体在窗口内' % (width,h), in_view(page, '.account-popover'))
        check('%dx%d：高度受限且可滚动' % (width,h), page.locator('.account-popover').evaluate("e=>e.scrollHeight>e.clientHeight && getComputedStyle(e).overflowY==='auto'"))
        page.locator('.pop-menu-item--logout').focus()
        check('%dx%d：键盘可滚动到退出项' % (width,h), in_view(page,'.pop-menu-item--logout'))
        shot(page, 'small-popover-%dx%d' % (width,h))
        page.keyboard.press('Escape')
    ctx.close()


def drafts_and_growing(browser, url):
    ctx, page = fresh(browser, url)
    original = page.evaluate('JSON.stringify(Fixtures.spaces)')
    page.fill('textarea', '旧版空白草稿 A')
    page.locator('[data-platform=instagram]').click()
    first = page.evaluate('__creatorScoutStore.getActiveDraftId()')
    check('主动新会话：输入为空且发送禁用', page.input_value('textarea')=='' and page.locator('.btn-send').is_disabled())
    check('主动新会话：旧版空白草稿仍保留', page.evaluate("__creatorScoutStore.getDraft('sp-team-northstar','__blank__')")=='旧版空白草稿 A')
    initial_blank = height(page)
    page.fill('textarea', LONG_TEXT)
    check('空白输入：长文增长至220px上限并内部滚动', height(page)==220 and page.locator('textarea').evaluate("e=>e.scrollHeight>e.clientHeight && getComputedStyle(e).overflowY==='auto'"), height(page))
    check('空白输入：附件链接发送不被覆盖', rect(page,'.composer-actions')['y'] >= rect(page,'textarea')['bottom'] and in_view(page,'.composer-actions'))
    shot(page, 'long-input-blank')
    switch(page, PERSONAL)
    check('初到个人空间为空白，无团队草稿串入', page.input_value('textarea')=='')
    page.fill('textarea', '个人空间输入 P')
    switch(page, TEAM)
    check('返回团队：恢复独立草稿ID及长输入', page.evaluate('__creatorScoutStore.getActiveDraftId()')==first and page.input_value('textarea')==LONG_TEXT)
    check('返回团队：恢复后自动重算220px', height(page)==220)
    page.evaluate('() => __creatorScoutStore.flushDrafts()')
    page.reload()
    page.wait_for_selector('textarea')
    check('刷新后恢复独立草稿ID及长输入高度', page.evaluate('__creatorScoutStore.getActiveDraftId()')==first and page.input_value('textarea')==LONG_TEXT and height(page)==220)
    page.fill('textarea', '短')
    check('空白输入：删除后回落原初始高度', height(page)==initial_blank, {'initial':initial_blank,'after':height(page)})
    page.fill('textarea', '第一份独立草稿 B')
    page.locator('[data-platform=instagram]').click()
    second = page.evaluate('__creatorScoutStore.getActiveDraftId()')
    check('再次主动新会话：新ID、空白输入、旧草稿不丢', second!=first and page.input_value('textarea')=='' and page.evaluate('(id)=>__creatorScoutStore.getDraft("sp-team-northstar",id)',first)=='第一份独立草稿 B')
    page.fill('textarea', '第二份独立草稿 C')
    switch(page, PERSONAL)
    check('个人空间返回恢复个人输入', page.input_value('textarea')=='个人空间输入 P')
    switch(page, TEAM)
    check('团队返回恢复最后活动草稿，不恢复最早草稿', page.input_value('textarea')=='第二份独立草稿 C' and page.evaluate('__creatorScoutStore.getActiveDraftId()')==second)
    check('未发送草稿未加入最近或创建项目，历史正文与绑定不变', page.evaluate('JSON.stringify(Fixtures.spaces)')==original)
    page.locator('[data-conv-id="conv-team-aurora"].nav-item').click()
    messages = page.inner_text('.chat-scroll')
    check('历史会话：标题只有一处项目名且无重复说明', page.inner_text('#topbar').count('Aurora Skincare')==1 and '关联项目：' not in page.inner_text('#topbar') and page.locator('.chat-footnote').count()==0)
    init_chat = height(page)
    page.fill('textarea', LONG_TEXT)
    check('历史输入：长文增长至180px上限', height(page)==180 and page.locator('textarea').evaluate('e=>e.scrollHeight>e.clientHeight'))
    check('历史输入：操作行在文字下且可见', rect(page,'.composer-actions')['y'] >= rect(page,'textarea')['bottom'] and in_view(page,'.composer-actions'))
    shot(page, 'long-input-history')
    switch(page, PERSONAL)
    switch(page, TEAM)
    check('历史会话空间往返：恢复会话、正文和长草稿高度', page.inner_text('.chat-scroll')==messages and page.input_value('textarea')==LONG_TEXT and height(page)==180)
    page.evaluate('() => __creatorScoutStore.flushDrafts()')
    page.reload()
    page.wait_for_selector('textarea')
    check('历史长草稿刷新恢复并重算高度', page.input_value('textarea')==LONG_TEXT and height(page)==180)
    page.fill('textarea', '短')
    check('历史输入：删除回落初始高度', height(page)==init_chat, {'initial':init_chat,'after':height(page)})
    page.fill('textarea', ' ' * 10)
    check('纯空白不激活发送', page.locator('.btn-send').is_disabled())
    page.evaluate("() => { Fixtures.spaces[0].projects[0].name='非常长的跨境品牌项目名称及多市场达人合作计划'.repeat(12); UI.renderTopbar(__creatorScoutStore); }")
    page.set_viewport_size({'width':1280,'height':800})
    check('历史长项目名：省略且保留完整 title', page.locator('.top-sub').evaluate('e=>e.title===e.textContent && e.scrollWidth>e.clientWidth'))
    check('历史长项目名：进入项目按钮保持148px且不出屏', rect(page,'.btn-enter-project')['width']==148 and in_view(page,'.btn-enter-project'))
    shot(page, 'history-long-project')
    page.locator('.btn-enter-project').click()
    check('进入项目仍只给未开放提示，不伪造工作区', '项目工作区暂未开放' in page.locator('.toast').last.inner_text())
    # 测试夹具的长项目名变更不落盘；关闭隔离上下文即可回到真实 fixtures。
    ctx.close()


def busy_focus(browser,url):
    ctx,page=fresh(browser,url)
    page.fill('textarea','切换时保留')
    page.evaluate('() => __creatorScoutStore.__setTransport((spaceId,seq)=>new Promise(resolve=>setTimeout(()=>resolve({spaceId,seq}),600)))')
    open_pop(page,keyboard=True)
    page.keyboard.press('Enter')
    page.wait_for_function('() => __creatorScoutStore.isSwitching()')
    page.mouse.move(1100,700)
    check('切换中：无需悬停仍有必要反馈', page.locator('.switch-hint.is-busy').is_visible())
    check('切换中：焦点在存活节点而非已删除按钮', page.evaluate("document.activeElement.isConnected && document.activeElement.matches('.account-popover')"))
    check('切换中：全部菜单与切换按钮锁定', page.locator('.account-popover button').evaluate_all('es=>es.every(e=>e.disabled)'))
    page.keyboard.press('Tab')
    check('切换中：Tab 不落入禁用或已删除节点',page.evaluate("document.activeElement.matches('.account-popover')"))
    page.wait_for_function('() => !__creatorScoutStore.isSwitching() && !!document.querySelector(".account-popover")')
    check('键盘切换成功：浮窗保留且焦点留在切换按钮',page.evaluate("document.activeElement.matches('.switch-btn')"))
    page.evaluate('() => __creatorScoutStore.__resetTransport()')
    switch(page,TEAM)
    check('切换往返后原输入保留',page.input_value('textarea')=='切换时保留')
    # 模拟切换期间点击外部：完成后不能再抢回焦点。
    page.evaluate('() => __creatorScoutStore.__setTransport((spaceId,seq)=>new Promise(resolve=>setTimeout(()=>resolve({spaceId,seq}),600)))')
    open_pop(page)
    page.locator('.switch-btn').click()
    page.locator('textarea').click()
    page.wait_for_function('() => !__creatorScoutStore.isSwitching()')
    check('鼠标外部关闭：异步切换完成也不抢账户焦点',page.evaluate("document.activeElement.matches('textarea') && document.activeElement.isConnected"))
    ctx.close()


def favicon_geometry_and_sizes(browser,url):
    ns={'s':'http://www.w3.org/2000/svg'}
    old=ET.parse(ROOT/'assets/icon-discovery-dark.svg').getroot()
    new=ET.parse(ROOT/'assets/favicon-discovery-20260924.svg').getroot()
    a=old.findall('s:path',ns); b=new.findall('s:path',ns)
    check('favicon：导出路径与 viewBox 完全不变，未重绘',old.attrib['viewBox']==new.attrib['viewBox'] and [p.attrib['d'] for p in a]==[p.attrib['d'] for p in b] and a[0].attrib['stroke-width']==b[0].attrib['stroke-width'])
    check('favicon：默认为深色C，发现点沿用规范色',b[0].attrib['stroke']=='#155E63' and b[1].attrib['fill']=='#8EE3D0')
    ctx,page=fresh(browser,url)
    check('favicon：独立新文件引用，不影响侧栏白色Logo',page.get_attribute('link[rel=icon]','href')=='assets/favicon-discovery-20260924.svg' and page.get_attribute('.sidebar-logo img','src')=='assets/logo-dark-horizontal.svg')
    for theme,bg,target in [('light','#FFFFFF',[21,94,99]),('dark','#101C21',[243,252,249])]:
        page.emulate_media(color_scheme=theme)
        page.set_content('<html><body style="margin:32px;background:'+bg+';color:'+('#172328' if theme=='light' else '#F3FCF9')+';font-family:Arial"><h2>Creator Scout favicon '+theme+' · original pixel sizes</h2><p>16 px</p><img id="i16" width="16" height="16" src="'+url.rsplit('/',1)[0]+'/assets/favicon-discovery-20260924.svg"><p>32 px</p><img id="i32" width="32" height="32" src="'+url.rsplit('/',1)[0]+'/assets/favicon-discovery-20260924.svg"></body></html>')
        page.wait_for_function('() => [...document.images].every(i=>i.complete && i.naturalWidth>0)')
        for size in [16,32]:
            colors=page.evaluate('''(size)=>{const im=document.querySelector('#i'+size),c=document.createElement('canvas');c.width=size;c.height=size;const x=c.getContext('2d');x.drawImage(im,0,0,size,size);const d=x.getImageData(0,0,size,size).data;let solid=[];for(let n=0;n<d.length;n+=4)if(d[n+3]>240)solid.push([d[n],d[n+1],d[n+2]]);return solid;}''',size)
            check('favicon：'+theme+' '+str(size)+'px实际栅格颜色正确',target in colors and [142,227,208] in colors,{'expected':target,'sample':colors[:5]})
        shot(page,'favicon-sizes-'+theme)
    ctx.close()


def scope_hashes():
    before=json.loads((EVIDENCE/'before-sha256.json').read_text(encoding='utf-8'))
    for path in ['智能挖掘_任务详情_v9_demo.html','creator-scout-home/js/fixtures.js','creator-scout-home/assets/logo-dark-horizontal.svg','creator-scout-home/assets/icon-discovery-dark.svg']:
        p=ROOT.parent/path
        check('范围保护：'+path+' SHA256不变',hashlib.sha256(p.read_bytes()).hexdigest()==before[path])


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass


def main():
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(QuietHandler,directory=str(ROOT)))
    thread=threading.Thread(target=server.serve_forever,daemon=True)
    thread.start()
    url='http://127.0.0.1:%d/index.html'%server.server_port
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            for fn in [home_and_keyboard,long_names_and_states,drafts_and_growing,busy_focus,favicon_geometry_and_sizes]:
                try:
                    fn(browser,url)
                except Exception:
                    detail=traceback.format_exc()
                    check(fn.__name__+' 执行完成',False,detail)
            browser.close()
        scope_hashes()
        check('浏览器无 JavaScript 运行时错误',not ERRORS,ERRORS)
    finally:
        server.shutdown()
        server.server_close()
    report={'results':RESULTS,'passed':sum(x['pass'] for x in RESULTS),'failed':sum(not x['pass'] for x in RESULTS),
            'blocked':['最新 Figma 306:74 结构/截图未能实时读取；不把本地历史几何值当作最新设计验收证据。','Figma 522:73 未能实时重新导出，favicon 复用已有导出矢量路径及本地已确认品牌色。'],
            'note':'favicon-sizes 截图是实际页面栅格检查，不能代替真实浏览器标签栏；标签栏另运行 verify-favicon-chrome.py。'}
    current_evidence = ROOT/'tests/evidence/20260924-popover-compact'
    current_evidence.mkdir(parents=True, exist_ok=True)
    (current_evidence/'local-fix-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print('\nTOTAL: %d passed, %d failed'%(report['passed'],report['failed']),flush=True)
    return 1 if report['failed'] else 0


if __name__=='__main__':
    sys.exit(main())
