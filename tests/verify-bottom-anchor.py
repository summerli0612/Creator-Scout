# -*- coding: utf-8 -*-
"""账户浮窗底边8px + 150ms自然高度过渡；隔离浏览器，不接真实服务。
运行：python -X utf8 tests/verify-bottom-anchor.py
继承连续性/尺寸/长文案/草稿回归，仅覆盖最新授权的定位差异。
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

ROOT = Path(__file__).resolve().parent.parent
SHOTS = ROOT / 'screenshots/20260924-bottom-anchor'
EVIDENCE = ROOT / 'tests/evidence/20260924-bottom-anchor'
for folder in [SHOTS, EVIDENCE]:
    folder.mkdir(parents=True, exist_ok=True)
spec = importlib.util.spec_from_file_location('continuity', ROOT/'tests/verify-switch-continuity.py')
continuity = importlib.util.module_from_spec(spec)
spec.loader.exec_module(continuity)
legacy, compact = continuity.legacy, continuity.compact
continuity.SHOTS = SHOTS/'regression-continuity'
continuity.EVIDENCE = EVIDENCE
compact.SHOTS = SHOTS/'regression-scale'
compact.EVIDENCE = EVIDENCE/'scale'
legacy.SHOTS = SHOTS/'regression-interaction'
for folder in [continuity.SHOTS, compact.SHOTS, compact.EVIDENCE, legacy.SHOTS]:
    folder.mkdir(parents=True, exist_ok=True)
check, rect, in_view = legacy.check, legacy.rect, legacy.in_view
FRAMES = []

# 在每个实际浏览器绘制帧读取几何；不是只断言CSS样式字符串。
WATCH = r'''() => {
  window.frameAudit=[]; window.watchFrames=true;
  function sample(t) {
    const el=document.querySelector('.account-popover'), b=document.querySelector('.switch-btn');
    if(el && b) {
      const r=el.getBoundingClientRect(), q=b.getBoundingClientRect();
      const hint=document.querySelector('.switch-hint'), h=hint && !hint.hidden ? hint.getBoundingClientRect() : null;
      frameAudit.push({t,height:r.height,top:r.top,bottom:r.bottom,width:r.width,
        gap:document.querySelector('#account-entry').getBoundingClientRect().top-r.bottom,
        buttonX:q.x,buttonY:q.y,buttonWidth:q.width,buttonHeight:q.height,
        resizing:el.hasAttribute('data-resizing'),focus:document.activeElement===b,
        hintVisible:!!h,hintDy:h?(h.top+h.height/2)-(q.top+q.height/2):null,
        overlap:!!h && Math.min(h.right,r.right)>Math.max(h.left,r.left) && Math.min(h.bottom,r.bottom)>Math.max(h.top,r.top)});
    }
    if(watchFrames) requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}'''


def gap(page):
    return rect(page,'#account-entry')['y']-rect(page,'.account-popover')['bottom']


def settled(page):
    page.wait_for_function('!__creatorScoutStore.isSwitching() && !document.querySelector(".account-popover[data-resizing]")')


def capture(page,name):
    page.screenshot(path=str(SHOTS/(name+'.png')))


def bottom_and_frames(browser,url):
    for width,height in [(1440,1024),(1280,800)]:
        ctx,page=legacy.fresh(browser,url,width,height)
        legacy.open_pop(page,keyboard=True)
        continuity.instrument(page)
        check(f'{width} 团队打开时底部8px',abs(gap(page)-8)<.1)
        capture(page,f'team-{width}-gap8')
        for n,target in enumerate([legacy.PERSONAL,legacy.TEAM]):
            before=rect(page,'.account-popover')
            before_button=rect(page,'.switch-btn')
            continuity.begin(page,keyboard=True)
            page.evaluate(WATCH)
            page.evaluate('finishSwitch()')
            settled(page)
            page.wait_for_timeout(50)
            frames=page.evaluate('() => {watchFrames=false;return frameAudit;}')
            FRAMES.append({'viewport':[width,height],'target':target,'frames':frames})
            after=rect(page,'.account-popover')
            natural=351 if target==legacy.PERSONAL else 389
            prefix=f'{width}/{target}: '
            check(prefix+'切换成功保留同节点并恢复自然高度',all(continuity.identity(page).values()) and after['height']==natural)
            check(prefix+'全部过渡帧及结束都保持8px间距',bool(frames) and all(abs(f['gap']-8)<.1 for f in frames) and abs(gap(page)-8)<.1,frames)
            intermediate=[f for f in frames if 351.1<f['height']<388.9]
            check(prefix+'有多个真实中间高度帧，不是瞬跳',len(intermediate)>=3,[f['height'] for f in frames])
            differences=[frames[i+1]['height']-frames[i]['height'] for i in range(len(frames)-1)]
            check(prefix+'高度单向收放无超调',all(350.9<=f['height']<=389.1 for f in frames) and all(d<.1 if natural==351 else d>-.1 for d in differences))
            check(prefix+'宽度264、按钮32不缩放也不横跳',all(f['width']==264 and f['buttonWidth']==32 and f['buttonHeight']==32 and abs(f['buttonX']-before_button['x'])<.1 for f in frames))
            check(prefix+'按钮跟随上边缘移动38px',abs(rect(page,'.switch-btn')['y']-before_button['y']-(before['height']-natural))<.1)
            check(prefix+'键盘焦点一直留在切换按钮',all(f['focus'] for f in frames) and page.evaluate('document.activeElement===audit.button'))
            check(prefix+'外置提示逐帧跟随且不遮挡浮窗',all(f['hintVisible'] and abs(f['hintDy'])<=1 and not f['overlap'] for f in frames))
            check(prefix+'动画结束不残留固定高度或overflow覆盖',page.locator('.account-popover').evaluate("e=>!e.style.height && !e.style.overflowY && !e.hasAttribute('data-resizing')"))
            check(prefix+'没有重播入场动画或成功toast',page.evaluate('audit.animations===0') and page.locator('.toast').count()==0)
            capture(page,('personal' if natural==351 else 'team-return')+f'-{width}-gap8')
        # 重新打开个人空间不能沿用最大团队高度预留空隙。
        continuity.begin(page);continuity.finish(page)
        page.keyboard.press('Escape');legacy.open_pop(page)
        check(f'{width} 个人状态重新打开仍是8px且351高',abs(gap(page)-8)<.1 and rect(page,'.account-popover')['height']==351)
        ctx.close()


def interruption_and_motion(browser,url):
    for method in ['close','resize','reduce','tab','reverse']:
        ctx,page=legacy.fresh(browser,url)
        legacy.open_pop(page,keyboard=True);continuity.instrument(page);continuity.begin(page,keyboard=True)
        outcome=page.evaluate(r'''async (method)=>{
          finishSwitch();
          await new Promise(r=>setTimeout(r,35));
          const el=document.querySelector('.account-popover');
          const active=el.hasAttribute('data-resizing'), button=document.querySelector('.switch-btn');
          if(method==='close') document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          if(method==='resize') window.dispatchEvent(new Event('resize'));
          if(method==='tab') document.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true}));
          if(method==='reverse') {
            button.click();
            await new Promise(r=>setTimeout(r,10));
            finishSwitch();
          }
          return {wasAnimating:active};
        }''',method)
        check(method+'：验证发生于实际过渡中',outcome['wasAnimating'])
        if method=='reduce':
            page.emulate_media(reduced_motion='reduce')
        if method=='resize':
            page.set_viewport_size({'width':320,'height':420})
        page.wait_for_timeout(220);settled(page)
        if method=='close':
            check('过渡中Esc关闭：不重开、不遗留提示或焦点',page.locator('.account-popover').count()==0 and page.locator('.switch-hint').count()==0 and page.evaluate("document.activeElement.id==='account-entry'"))
            legacy.open_pop(page,keyboard=True)
            check('关闭中断后重新打开：当前个人空间自然高且8px',rect(page,'.account-popover')['height']==351 and abs(gap(page)-8)<.1)
        else:
            check(method+'：过渡结束同节点、8px间距、无临时样式',all(continuity.identity(page).values()) and abs(gap(page)-8)<.1 and page.locator('.account-popover').evaluate("e=>!e.style.height && !e.style.overflowY && !e.hasAttribute('data-resizing')"))
            check(method+'：窗口内控件仍可达',in_view(page,'.account-popover') and in_view(page,'.switch-btn'))
            if method=='reverse':
                check('过渡中反向切换：最终团队389px，无丢失或多余重绘',rect(page,'.account-popover')['height']==389 and page.evaluate('__creatorScoutStore.getState().currentSpaceId')==legacy.TEAM and page.evaluate('audit.renders')=={'sidebar':2,'top':2,'conversation':2})
            if method=='resize':
                page.locator('.pop-menu-item--logout').focus()
                check('过渡中缩小窗口后能滚动到退出',in_view(page,'.pop-menu-item--logout'))
        ctx.close()
    ctx,page=legacy.fresh(browser,url)
    page.emulate_media(reduced_motion='reduce')
    legacy.open_pop(page,keyboard=True);continuity.instrument(page);continuity.begin(page,keyboard=True)
    page.evaluate(WATCH);page.evaluate('finishSwitch()');settled(page);page.wait_for_timeout(50)
    frames=page.evaluate('() => {watchFrames=false;return frameAudit;}')
    check('减少动态效果：直接自然高度，无过渡仍贴8px',rect(page,'.account-popover')['height']==351 and abs(gap(page)-8)<.1 and all(not f['resizing'] for f in frames))
    ctx.close()


def small_limits(browser,url):
    for width,height in [(320,420),(280,240)]:
        ctx,page=legacy.fresh(browser,url,width,height)
        legacy.open_pop(page,keyboard=True);continuity.instrument(page)
        for target in [legacy.PERSONAL,legacy.TEAM]:
            continuity.begin(page,keyboard=True);continuity.finish(page)
            check(f'{width}/{target} 小窗口底部8px、上方不出屏',abs(gap(page)-8)<.1 and in_view(page,'.account-popover'))
            check(f'{width}/{target} 限高时仍滚动、不强做高度动画',page.locator('.account-popover').evaluate("e=>!e.style.height && getComputedStyle(e).overflowY==='auto' && e.scrollHeight>e.clientHeight"))
        page.locator('.pop-menu-item--logout').focus()
        check(f'{width} 键盘到退出入口可见',in_view(page,'.pop-menu-item--logout'))
        capture(page,f'small-{width}x{height}')
        ctx.close()


def scope():
    for path,old in json.loads((EVIDENCE/'protected-sha.json').read_text(encoding='utf8')).items():
        check('范围保护 '+path,hashlib.sha256((ROOT.parent/path).read_bytes()).hexdigest()==old)
    with zipfile.ZipFile(EVIDENCE/'before-source.zip') as z:
        # 视觉、渲染数据及UI结构均未变，运行代码只允许定位装配文件发生变化。
        for path in ['css/styles.css','js/ui.js']:
            check('运行范围保护 '+path,z.read(path)==(ROOT/path).read_bytes())
        changed=[p for p in z.namelist() if z.read(p)!=(ROOT/p).read_bytes()]
    (EVIDENCE/'modified-files.json').write_text(json.dumps(changed,ensure_ascii=False,indent=2),encoding='utf8')


def main():
    legacy.RESULTS.clear();legacy.ERRORS.clear()
    server=http.server.ThreadingHTTPServer(('127.0.0.1',0),functools.partial(legacy.QuietHandler,directory=str(ROOT)))
    threading.Thread(target=server.serve_forever,daemon=True).start()
    url=f'http://127.0.0.1:{server.server_port}/index.html'
    try:
        with sync_playwright() as p:
            browser=p.chromium.launch()
            for fn in [bottom_and_frames,interruption_and_motion,small_limits,
                       continuity.continuous_switch,continuity.failure_and_retry,continuity.explicit_dismiss,
                       continuity.small_and_personal_start,continuity.memory_tests,
                       compact.compact_dimensions,compact.tooltip_placement,
                       legacy.home_and_keyboard,legacy.long_names_and_states,legacy.drafts_and_growing,legacy.busy_focus]:
                try: fn(browser,url)
                except Exception: check(fn.__name__+'执行完成',False,traceback.format_exc())
            browser.close()
        scope();check('无JavaScript运行时错误',not legacy.ERRORS,legacy.ERRORS)
    finally:
        server.shutdown();server.server_close()
    report={'passed':sum(r['pass'] for r in legacy.RESULTS),'failed':sum(not r['pass'] for r in legacy.RESULTS),
            'results':legacy.RESULTS,'frames':FRAMES,'scope':'底边贴入口8px及150ms伸缩；非真实服务。',
            'source_sha':{s:hashlib.sha256((ROOT/s).read_bytes()).hexdigest() for s in ['js/app.js','js/ui.js','css/styles.css']}}
    (EVIDENCE/'bottom-anchor-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf8')
    print(f"\nTOTAL: {report['passed']} passed, {report['failed']} failed",flush=True)
    return 1 if report['failed'] else 0

if __name__=='__main__':
    sys.exit(main())
