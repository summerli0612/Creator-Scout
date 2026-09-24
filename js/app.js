/*
 * Creator Scout 独立首页原型 · 应用装配（app）
 * 负责：事件接线、浮窗开关、空间切换调用、退出登录确认。
 * 交互规则要点：
 *   - 浮窗：点击账户入口开关；点击外部 / Esc 关闭；切换期间锁定重复操作。
 *   - 空间切换：点击浮窗切换按钮直接切换到另一空间（账号最多一个个人空间 +
 *     一个团队空间，二者互切，无需选择列表）；切换中锁定并显示「切换中…」；
 *     成功后原位保留浮窗；失败保留原空间与输入并提供重试。
 *   - 未接入功能：统一轻提示，保持当前页面，不伪造成功结果。
 *   - 退出登录：先二次确认；取消保持原状态；确认仅结束本地演示登录。
 */
(function (global) {
  'use strict';

  var Store = global.Store;
  var UI = global.UI;
  var SIM = global.SIM;
  var store = Store.create();
  var disposeSwitchHint = null;
  var switchErrorToast = null;
  var lastPageKey = null;
  var popoverResize = null;
  var reducedPopoverMotion = global.matchMedia('(prefers-reduced-motion: reduce)');

  // ---- 00–05 流程的界面状态（不持久化；数据都在 store） ----
  var flow = {
    panelOpen: false,        // 03 画像面板（可开性按当前会话阶段判定）
    panelErrors: {},         // 03A 就近校验错误 { key: message }
    expandMaterials: false,  // 02 材料紧凑行的展开状态
    namingModal: null,       // 04 命名弹窗句柄
    editing: null,           // 03 原位编辑的临时值，完成时写入共享草稿
    addDraft: null           // V9 新画像草稿卡，完成添加前不进入画像列表
  };

  // ---- 长对话阅读位置：按「空间 + 会话」分别记忆 ----
  var scrollMem = {
    key: null,          // 当前渲染出来的会话键
    positions: {},      // key → scrollTop
    anchors: {},        // key → { id, offset }，排版变化后保持可见消息位置
    counts: {},         // key → 上一次渲染的消息条数
    atBottom: {},       // key → 上次离开时是否在底部
    force: false        // 下一次渲染强制跟随到底部（用户主动发送 / 首次打开）
  };

  function conversationKey() {
    var state = store.getState();
    var conv = activeConversation();
    return conv ? state.currentSpaceId + '::' + conv.id : null;
  }

  function chatScrollEl() {
    return document.querySelector('#conversation-col .chat-scroll');
  }

  function isNearBottom(el) {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
  }

  function visibleMessageAnchor(el) {
    var viewportTop = el.getBoundingClientRect().top;
    var blocks = el.querySelectorAll('.msg-block[data-message-id]');
    for (var i = 0; i < blocks.length; i++) {
      var rect = blocks[i].getBoundingClientRect();
      if (rect.bottom > viewportTop + 1) {
        return { id: blocks[i].dataset.messageId, offset: rect.top - viewportTop };
      }
    }
    return null;
  }

  /** 渲染前记录当前会话的阅读位置与 DOM 消息数，供渲染后恢复。 */
  function captureScrollState() {
    var el = chatScrollEl();
    var key = scrollMem.key;
    if (!el || key == null) return;
    scrollMem.positions[key] = el.scrollTop;
    scrollMem.atBottom[key] = isNearBottom(el);
    scrollMem.counts[key] = el.querySelectorAll('.msg-block').length;
    scrollMem.anchors[key] = visibleMessageAnchor(el);
  }

  /**
   * 渲染后恢复阅读位置：
   * - 用户主动发送 / 首次打开：跟随到底部
   * - 原本在底部：新回复和分屏排版变化后仍跟随底部
   * - 阅读历史：用消息 ID 与视口偏移恢复，避免换行高度变化造成跳跃
   */
  function restoreScrollState() {
    var el = chatScrollEl();
    if (!el) return;
    var key = conversationKey();
    if (key == null) return;
    var domCount = el.querySelectorAll('.msg-block').length;
    var prevCount = scrollMem.counts[key];
    if (scrollMem.force || prevCount == null) {
      el.scrollTop = el.scrollHeight;
    } else if (scrollMem.atBottom[key]) {
      el.scrollTop = el.scrollHeight;
    } else {
      var anchor = scrollMem.anchors[key];
      var target = anchor && Array.prototype.find.call(el.querySelectorAll('.msg-block[data-message-id]'),
        function (block) { return block.dataset.messageId === anchor.id; });
      if (target) {
        el.scrollTop += target.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.offset;
      } else if (scrollMem.positions[key] != null) {
        el.scrollTop = scrollMem.positions[key];
      } else {
        el.scrollTop = el.scrollHeight;
      }
    }
    scrollMem.counts[key] = domCount;
    scrollMem.key = key;
    scrollMem.force = false;
    updateJumpButton();
  }

  function updateJumpButton() {
    var el = chatScrollEl();
    var btn = document.querySelector('#conversation-col .jump-latest-btn');
    if (!el || !btn) return;
    var hidden = el.scrollHeight - el.scrollTop - el.clientHeight <= 32;
    btn.classList.toggle('is-hidden', hidden);
  }

  function jumpToLatest() {
    var el = chatScrollEl();
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    updateJumpButton();
    var composer = document.querySelector('#conversation-col .composer textarea');
    if (composer) composer.focus({ preventScroll: true });
  }

  function attachScrollListener() {
    var el = chatScrollEl();
    if (!el) return;
    el.removeEventListener('scroll', onChatScroll);
    el.addEventListener('scroll', onChatScroll, { passive: true });
  }

  function onChatScroll() {
    var key = conversationKey();
    var el = chatScrollEl();
    if (!el || key == null) return;
    scrollMem.positions[key] = el.scrollTop;
    scrollMem.atBottom[key] = isNearBottom(el);
    scrollMem.anchors[key] = visibleMessageAnchor(el);
    updateJumpButton();
  }

  function activeConversation() {
    var spaceId = store.getState().currentSpaceId;
    var convId = store.getActiveConversationId(spaceId);
    return convId ? store.getConversation(spaceId, convId) : null;
  }

  function panelMode(conv) {
    if (!conv || !conv.portrait) return null;
    if (conv.stage === 'parsed') return 'edit';
    if (conv.stage === 'project_created') return 'view';
    return null;
  }

  function pageKey() {
    var state = store.getState();
    var conv = activeConversation();
    return JSON.stringify([
      state.signedOut, state.currentSpaceId, store.getActiveConversationId(), store.getActiveDraftId(),
      flow.panelOpen, flow.expandMaterials,
      conv ? [conv.stage, conv.title, conv.draftProjectName,
        conv.messages.map(function (m) { return m.id + (m.kind || ''); }).join('.'),
        conv.portrait ? (conv.portrait.region.selected || []).join('.') + '|' +
          conv.portrait.personas.map(function (p) { return p.id; }).join('.') : ''] : null,
      store.getProjects(state.currentSpaceId).length
    ]);
  }

  function announceSpace(message) {
    var status = document.getElementById('space-switch-status');
    if (!status) {
      status = document.createElement('div');
      status.id = 'space-switch-status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.setAttribute('aria-atomic', 'true');
      status.style.cssText = 'position:fixed;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;pointer-events:none;';
      document.body.appendChild(status);
    }
    status.textContent = message;
  }

  function popoverModel(spaceType) {
    return UI.computePopoverModel({ account: store.getAccount(), team: store.getTeam(),
      membershipRole: store.getMembershipRole(), currentSpaceType: spaceType || store.getCurrentSpace().type });
  }

  function cancelPopoverResize() {
    if (!popoverResize) return;
    var motion = popoverResize;
    popoverResize = null;
    if (motion.frame !== null) global.cancelAnimationFrame(motion.frame);
    motion.el.style.height = motion.height;
    motion.el.style.overflowY = motion.overflow;
    delete motion.el.dataset.resizing;
  }

  // 仅空间内容改变时短暂插值高度；底边不动，不缩放文字，结束恢复自然高度。
  function animatePopoverHeight(el, fromHeight) {
    cancelPopoverResize();
    var toHeight = el.offsetHeight;
    if (!el.isConnected || reducedPopoverMotion.matches || Math.abs(toHeight - fromHeight) < 0.5) return;
    // 限高滚动的窗口优先保证操作可达，不动画裁切其内容。
    if (el.scrollHeight > el.clientHeight + 1) return;
    var motion = { el: el, frame: null, height: el.style.height, overflow: el.style.overflowY,
      start: global.performance.now(), duration: 150 };
    popoverResize = motion;
    el.dataset.resizing = 'true';
    // 过渡中不出现瞬时滚动条，避免可用宽度变化把按钮横向挤动。
    el.style.overflowY = 'hidden';
    el.style.height = fromHeight + 'px';
    function tick(now) {
      if (popoverResize !== motion) return;
      if (!el.isConnected) { cancelPopoverResize(); return; }
      var progress = Math.min(1, Math.max(0, (now - motion.start) / motion.duration));
      var eased = 1 - Math.pow(1 - progress, 3);
      el.style.height = (fromHeight + (toHeight - fromHeight) * eased) + 'px';
      if (progress >= 1) cancelPopoverResize();
      // 提示跟随实际按钮坐标，不停在切换前的旧位置。
      if (disposeSwitchHint && disposeSwitchHint.update) disposeSwitchHint.update();
      if (popoverResize === motion) motion.frame = global.requestAnimationFrame(tick);
    }
    motion.frame = global.requestAnimationFrame(tick);
  }

  function onPopoverViewportChange() {
    cancelPopoverResize();
    positionPopover();
  }

  function positionPopover() {
    var el = document.querySelector('#popover-root .account-popover');
    if (!el) return;
    var viewport = global.visualViewport;
    var topEdge = (viewport ? viewport.offsetTop : 0) + 12;
    var viewportBottom = (viewport ? viewport.offsetTop + viewport.height : global.innerHeight) - 12;
    var entry = document.getElementById('account-entry');
    var bottomEdge = Math.min(viewportBottom, entry ? entry.getBoundingClientRect().top - 8 : viewportBottom);
    bottomEdge = Math.max(topEdge, bottomEdge);
    // 始终锚定账户入口上方8px；按当前内容收放上边缘，不为其他空间预留外部空隙。
    el.style.top = 'auto';
    el.style.bottom = (global.innerHeight - bottomEdge) + 'px';
    el.style.maxHeight = Math.max(0, bottomEdge - topEdge) + 'px';
    if (disposeSwitchHint && disposeSwitchHint.update) disposeSwitchHint.update();
  }


  function clearSwitchHint() {
    if (disposeSwitchHint) disposeSwitchHint();
    disposeSwitchHint = null;
  }


  var appState = {
    popoverOpen: false,
    popoverFocusKey: null
  };

  function focusAccountEntry() {
    var entry = document.getElementById('account-entry');
    if (entry) entry.focus({ preventScroll: true });
  }

  function popoverButtons(el) {
    return Array.prototype.slice.call(el.querySelectorAll('button:not(:disabled)'));
  }

  // 保存的是可重新解析的目标，不把已被 innerHTML 替换的 DOM 引用当成返回焦点。
  function capturePageFocus() {
    var el = document.activeElement;
    if (!el || !document.getElementById('app').contains(el)) return null;
    if (el.id === 'account-entry') return { kind: 'account' };
    if (el.matches('.nav-item')) return { kind: 'nav', platform: el.dataset.platform, conv: el.dataset.convId, project: el.dataset.projectId };
    if (el.matches('.composer textarea')) return { kind: 'input', start: el.selectionStart, end: el.selectionEnd,
      draft: el.closest('.composer').dataset.convId, space: el.closest('.composer').dataset.spaceId };
    if (el.matches('.btn-enter-project')) return { kind: 'enter-project' };
    if (el.closest('.composer') && el.matches('button')) return { kind: 'composer-button', action: el.dataset.action, name: el.dataset.name };
    // 画像面板：重绘（进入/退出编辑、增删画像）后回到同一行同一个操作
    if (el.closest('.portrait-panel')) {
      var rowEl = el.closest('.pp-field');
      if (rowEl) return { kind: 'pp-row', frow: rowEl.dataset.frow, editing: !!(el.closest('.pp-field-main') || {}).classList };
      var personaEl = el.closest('.pp-persona');
      return { kind: 'pp-persona', personaId: personaEl ? personaEl.dataset.personaId : null };
    }
    return null;
  }

  function restorePageFocus(saved) {
    if (!saved) return;
    var target = null;
    if (saved.kind === 'account') { focusAccountEntry(); return; }
    if (saved.kind === 'nav') {
      target = Array.prototype.slice.call(document.querySelectorAll('.nav-item')).filter(function (el) {
        return el.dataset.platform === saved.platform && el.dataset.convId === saved.conv && el.dataset.projectId === saved.project;
      })[0];
    } else if (saved.kind === 'input') target = document.querySelector('.composer textarea');
    else if (saved.kind === 'enter-project') target = document.querySelector('.btn-enter-project');
    else if (saved.kind === 'composer-button') {
      target = Array.prototype.slice.call(document.querySelectorAll('.composer button:not(:disabled)')).filter(function (el) {
        return el.dataset.action === saved.action && el.dataset.name === saved.name;
      })[0] || document.querySelector('.composer textarea');
    } else if (saved.kind === 'pp-row') {
      var ppRow = document.querySelector('.portrait-panel [data-frow="' + saved.frow + '"]');
      if (ppRow) target = ppRow.querySelector('[data-role="field-editor"], .pp-act, .pp-field-body') || null;
      else target = document.querySelector('.portrait-panel .pp-confirm, .portrait-panel .pp-close');
    } else if (saved.kind === 'pp-persona') {
      target = saved.personaId
        ? document.querySelector('.portrait-panel .pp-persona[data-persona-id="' + saved.personaId + '"] .pp-persona-name-text')
        : null;
      if (!target) target = document.querySelector('.portrait-panel .pp-add-persona, .portrait-panel .pp-close');
    }
    if (target) {
      target.focus({ preventScroll: true });
      if (saved.kind === 'input' && target.closest('.composer').dataset.convId === saved.draft && target.closest('.composer').dataset.spaceId === saved.space) {
        target.setSelectionRange(saved.start, saved.end);
      }
    }
  }

  // ---------------- 渲染 ----------------
  function renderAll() {
    var previousFocus = capturePageFocus();
    captureScrollState(); // 重绘前记住阅读位置，避免 DOM 重建后跳回顶部
    lastPageKey = pageKey();
    var state = store.getState();
    var app = document.getElementById('app');
    var signedOut = document.getElementById('signed-out');
    if (state.signedOut) {
      cancelPopoverResize();
      clearSwitchHint();
      app.hidden = true;
      signedOut.hidden = false;
      appState.popoverOpen = false;
      document.getElementById('popover-root').innerHTML = '';
      return;
    }
    app.hidden = false;
    signedOut.hidden = true;
    var conv = activeConversation();
    var mode = flow.panelOpen ? panelMode(conv) : null;
    var panelOpen = !!mode;
    document.querySelector('.main-body').classList.toggle('is-split', panelOpen);
    UI.renderSidebar(store, { panelOpen: panelOpen });
    UI.renderTopbar(store, { panelOpen: panelOpen });
    UI.renderConversation(store, { panelOpen: panelOpen, expandMaterials: flow.expandMaterials });
    renderPanel(conv, mode);
    restorePageFocus(previousFocus);
    attachScrollListener();
    restoreScrollState();
  }

  /** 03 画像面板：edit（创建前确认）/ view（创建后查看）；关闭时清空。 */
  function renderPanel(conv, mode) {
    var root = document.getElementById('portrait-panel-root');
    if (!mode || !conv) {
      root.hidden = true;
      root.innerHTML = '';
      flow.editing = editingForCurrentConv(null);
      flow.addDraft = null;
      return;
    }
    var scrollEl = root.querySelector('[data-role="pp-scroll"]');
    var keepTop = scrollEl ? scrollEl.scrollTop : 0;
    root.hidden = false;
    root.innerHTML = UI.renderPortraitPanel(store, conv, mode === 'edit' ? flow.panelErrors : {}, mode,
      mode === 'edit' ? editingForCurrentConv(flow.editing) : null,
      mode === 'edit' ? flow.addDraft : null);
    scrollEl = root.querySelector('[data-role="pp-scroll"]');
    if (scrollEl) scrollEl.scrollTop = keepTop; // 局部刷新保留画像正文滚动位置
    var active = mode === 'edit' ? flow.editing : null;
    if (active && active.kind === 'field') {
      var editor = root.querySelector('[data-frow="' + active.kp + '"] [data-role="field-editor"]');
      if (editor) editor.focus({ preventScroll: true });
    } else if (active && active.kind === 'name') {
      var nameEditor = root.querySelector('[data-role="name-editor"]');
      if (nameEditor) nameEditor.focus({ preventScroll: true });
    }
  }

  /** 编辑态只对当前会话有效：切换会话 / 关闭面板后立即失效，避免错位写入。 */
  function editingForCurrentConv(editing) {
    if (!editing) return null;
    var conv = activeConversation();
    if (!conv) return null;
    if (editing.convId && editing.convId !== conv.id) return null;
    return editing;
  }

  function startEditing(next) {
    var conv = activeConversation();
    if (!conv) return;
    if (next && (flow.editing || flow.addDraft)) return;
    flow.editing = next ? { convId: conv.id, kind: next.kind, kp: next.kp, personaId: next.personaId,
      temp: next.kind === 'region' ? conv.portrait.region.selected.slice() : null } : null;
    renderPanel(conv, 'edit');
  }

  function renderPopover() {
    var root = document.getElementById('popover-root');
    var entry = document.getElementById('account-entry');
    if (entry) entry.setAttribute('aria-expanded', appState.popoverOpen ? 'true' : 'false');
    if (!appState.popoverOpen) {
      cancelPopoverResize();
      clearSwitchHint();
      root.innerHTML = '';
      return;
    }
    var el = root.querySelector('.account-popover');
    var busy = store.isSwitching();
    if (!el) {
      el = document.createElement('div');
      el.className = 'account-popover';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', '账户菜单');
      el.tabIndex = -1;
      el.innerHTML = UI.popoverAccountHTML(popoverModel(), { switching: busy, hintId: 'space-switch-hint' });
      el.dataset.spaceId = store.getState().currentSpaceId;
      if (reducedPopoverMotion.matches) el.style.animation = 'none';
      root.appendChild(el);
      positionPopover();
      disposeSwitchHint = UI.attachSwitchHint(el, root);
    }
    var active = document.activeElement;
    var hadFocus = el.contains(active);
    var wasBusy = el.getAttribute('aria-busy') === 'true';
    var oldScroll = el.scrollTop;
    if (hadFocus && active.matches('button')) {
      appState.popoverFocusKey = { action: active.dataset.action, name: active.dataset.name };
    }
    var spaceChanged = el.dataset.spaceId !== store.getState().currentSpaceId;
    var previousHeight = el.getBoundingClientRect().height;
    if (spaceChanged) {
      cancelPopoverResize();
      UI.updatePopoverSpace(el, popoverModel());
      el.dataset.spaceId = store.getState().currentSpaceId;
    }
    // busy 只更新已有节点；切换起始/失败都不重绘背景，也不重播入场动画。
    if (busy && hadFocus && active.matches('button')) el.focus({ preventScroll: true });
    el.setAttribute('aria-busy', busy ? 'true' : 'false');
    Array.prototype.forEach.call(el.querySelectorAll('button'), function (button) { button.disabled = busy; });
    var hint = root.querySelector('.switch-hint');
    if (hint) {
      hint.classList.toggle('is-busy', busy);
      hint.setAttribute('role', busy ? 'status' : 'tooltip');
      hint.textContent = busy ? '切换中…' : '切换空间';
    }
    if (!busy && hadFocus && ((wasBusy && active === el) || !active.isConnected)) {
      var buttons = popoverButtons(el);
      var key = appState.popoverFocusKey;
      var target = key && buttons.filter(function (button) { return button.dataset.action === key.action && button.dataset.name === key.name; })[0];
      (target || buttons[0] || el).focus({ preventScroll: true });
    }
    el.scrollTop = oldScroll;
    positionPopover();
    if (spaceChanged) {
      animatePopoverHeight(el, previousHeight);
      if (disposeSwitchHint && disposeSwitchHint.update) disposeSwitchHint.update();
    }
  }

  function openPopover(fromKeyboard) {
    appState.popoverOpen = true;
    appState.popoverFocusKey = null;
    renderPopover();
    if (fromKeyboard) {
      var el = document.querySelector('.account-popover');
      (popoverButtons(el)[0] || el).focus();
    }
  }

  function closePopover(restoreFocus) {
    appState.popoverOpen = false;
    renderPopover();
    if (restoreFocus) focusAccountEntry();
  }

  // ---------------- 空间切换 ----------------
  function handleSwitchResult(result, targetSpaceId) {
    if (result.ok) {
      // 成功只宣布结果；不关闭、不重开浮窗，也不夺取外部焦点。
      announceSpace('已切换到' + store.getCurrentSpace().name);
      return;
    }
    if (result.stale) return; // 旧请求被更新的切换取代，不做任何界面变化
    // 失败：保留原空间与输入，提供重试
    switchErrorToast = UI.showToast('切换空间失败，已保留当前空间与输入。', {
      actionLabel: '重试',
      onAction: function () {
        var button = document.querySelector('#popover-root .switch-btn');
        if (appState.popoverOpen && button) button.focus({ preventScroll: true });
        else focusAccountEntry();
        requestSwitch(targetSpaceId);
      }
    });
  }

  function requestSwitch(targetSpaceId) {
    if (store.isSwitching()) return;
    if (switchErrorToast) { switchErrorToast.close(); switchErrorToast = null; }
    announceSpace('');
    store.switchSpace(targetSpaceId).then(function (result) {
      handleSwitchResult(result, targetSpaceId);
    });
  }

  // 另一空间 ID：账号最多一个个人空间 + 一个团队空间，切换按钮即在二者间互切
  function otherSpaceId() {
    var current = store.getState().currentSpaceId;
    var spaces = store.getSpaces();
    for (var i = 0; i < spaces.length; i++) {
      if (spaces[i].id !== current) return spaces[i].id;
    }
    return null;
  }

  // ---------------- 00–05：发送 / 解析 / 修改 / 画像 / 命名 / 创建 ----------------
  function currentComposer() {
    return document.querySelector('#conversation-col .composer');
  }

  function isValidUrl(v) {
    return /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/[^\s]*)?$/i.test(String(v || '').trim());
  }

  function humanSize(bytes) {
    if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
    if (bytes >= 1024) return Math.round(bytes / 1024) + ' KB';
    return bytes + ' B';
  }

  /** 00：发送（非空文字或至少一份材料；发送中锁定；失败保留并提供重试）。 */
  function handleSend() {
    var composer = currentComposer();
    if (!composer) return;
    var sendBtn = composer.querySelector('.btn-send');
    if (sendBtn.classList.contains('is-sending') || sendBtn.disabled) {
      if (sendBtn.disabled && !sendBtn.classList.contains('is-sending')) {
        UI.showToast('请先输入需求，或添加至少一份材料。');
      }
      return;
    }
    var spaceId = composer.dataset.spaceId;
    var draftId = composer.dataset.convId;
    var text = composer.querySelector('textarea').value;
    var materials = store.getMaterials(spaceId, draftId);
    if (!text.trim() && !materials.length) return;
    UI.clearComposerError(composer);
    UI.setComposerSending(composer, true);

    // 修改意图在点击发送的瞬间认领序号（用户动作顺序），先于任何传输延时；
    // 期间的手动编辑会获得更大序号，从而阻止旧响应覆盖。
    var pendingConvId = store.getActiveConversationId(spaceId);
    var pendingMod = null;
    var claimedSeq = 0;
    if (pendingConvId) {
      var pendingConv = store.getConversation(spaceId, pendingConvId);
      var pre = SIM.interpretModification(text);
      if (pre && pre.matched && pendingConv && pendingConv.portrait) {
        pendingMod = pre;
        claimedSeq = store.claimIntent(spaceId, pendingConvId);
      }
    }

    SIM.sendRequest().then(function (res) {
      if (currentComposer() !== composer || !composer.isConnected) return; // 视图已变化，丢弃本次结果
      if (!res.ok) {
        UI.setComposerSending(composer, false); // 00C：内容与材料保留，原位重试
        UI.showComposerError(composer, '发送失败：演示网络异常。内容与材料已保留。');
        return;
      }
      var convId = store.getActiveConversationId(spaceId);
      scrollMem.force = true; // 用户主动发送：最新消息进入视野
      if (!convId) {
        // 首次发送成功：创建会话（唯一入口），进入 01 解析中
        var preExtract = SIM.extract(text);
        var conv = store.createConversation(spaceId, draftId, text, materials, preExtract);
        startParse(spaceId, conv.id, text, null);
      } else {
        store.appendUserMessage(spaceId, convId, text, materials);
        store.setDraft(spaceId, convId, '');
        materials.forEach(function (m) { store.removeMaterial(spaceId, convId, m.id); });
        handleConversationSend(spaceId, convId, text, pendingMod, claimedSeq);
      }
    });
  }

  /** 01：解析（失败保留会话，可重新解析，不重复创建会话）。 */
  function startParse(spaceId, convId, userText, errorMsgId) {
    var conv = store.getConversation(spaceId, convId);
    if (!conv) return;
    var targetMsgId = errorMsgId;
    if (!targetMsgId) {
      for (var i = conv.messages.length - 1; i >= 0; i--) {
        if (conv.messages[i].role === 'agent' && conv.messages[i].kind === 'parsing') { targetMsgId = conv.messages[i].id; break; }
      }
    }
    if (!targetMsgId) return;
    SIM.parseRequest(userText).then(function (res) {
      var target = store.getConversation(spaceId, convId);
      if (!target) return;
      if (res.ok) store.applyParseResult(spaceId, convId, targetMsgId, res);
      else store.markParseError(spaceId, convId, targetMsgId);
    });
  }

  function retryParse() {
    var conv = activeConversation();
    if (!conv) return;
    var spaceId = conv.spaceId;
    var firstUser = null;
    var errorMsgId = null;
    conv.messages.forEach(function (m) {
      if (m.role === 'user' && !firstUser) firstUser = m;
      if (m.role === 'agent' && m.kind === 'parse-error') errorMsgId = m.id;
    });
    if (!errorMsgId || !firstUser) return;
    // 恢复为解析中卡片后重新解析
    store.replaceMessage(spaceId, conv.id, errorMsgId, { kind: 'parsing',
      title: '正在读取材料并整理你的需求',
      body: '已使用文字需求；材料已接收。本轮为演示流程，附件与链接内容不做真实解析。',
      statusLine: '✓ 需求已识别', note: '你可以继续补充信息。' });
    startParse(spaceId, conv.id, firstUser.text, errorMsgId);
  }

  /** 已有会话内的发送：明确支持的修改表达走模拟修改，其余给诚实演示回复。 */
  function handleConversationSend(spaceId, convId, text, preMod, claimedSeq) {
    var conv = store.getConversation(spaceId, convId);
    if (!conv) return;
    if (conv.stage === 'parsing') return; // 解析中的补充仅进入历史，不额外回复
    var mod = preMod || SIM.interpretModification(text);
    if (mod && mod.matched && conv.portrait) {
      var seq = claimedSeq || store.claimIntent(spaceId, convId);
      // 目标市场在发送瞬间解析成国家／地区代码；识别不了就不产生补丁内容
      var patchValue = mod.field === 'region' ? (SIM.matchRegion(mod.value) || []) : mod.value;
      var patch = { field: mod.field, value: patchValue, personaId: mod.personaId };
      if (mod.field === 'personaTarget' && conv.portrait.personas[0]) {
        patch.personaId = conv.portrait.personas[0].id; // 以稳定 ID 定位，不依赖数组位置
      }
      SIM.modRequest().then(function (res) {
        var target = store.getConversation(spaceId, convId);
        if (!target || !target.portrait) return; // 会话或草稿已不存在：不写入其他会话
        if (!res.ok) {
          store.appendAgentMessage(spaceId, convId, { kind: 'text',
            body: '修改请求未完成（演示模拟失败）。字段未改动，你可以直接在项目画像中编辑。' });
          return;
        }
        var result = store.applyCommandPatch(spaceId, convId, patch, seq);
        if (result.applied) {
          var display = mod.field === 'region' ? SIM.regionLabel(patchValue) : mod.value;
          store.appendAgentMessage(spaceId, convId, { kind: 'text',
            body: '已将' + (mod.field === 'personaTarget' ? '第 1 张画像的' : '') + mod.label +
              '改为「' + display + '」，其他内容保持不变。' });
        } else if (result.reason === 'unknown-region') {
          // 无法识别的输入不伪装成有效选项，也不清空已有选择
          store.appendAgentMessage(spaceId, convId, { kind: 'text',
            body: '没有识别到「' + mod.value + '」对应的国家／地区，目标市场未改动。' +
              (result.currentValue ? '当前为「' + result.currentValue + '」。' : '') +
              '你也可以在画像面板里从列表中选择。' });
        } else {
          // 旧响应不能覆盖更新的手动修改；回复只说明实际情况
          store.appendAgentMessage(spaceId, convId, { kind: 'text',
            body: '你后来已直接修改了' + mod.label + '，本次对话修改未生效；当前值为「' +
              (result.currentValue || '未填写') + '」。' });
        }
      });
      return;
    }
    if (mod && mod.looksLikeChange) {
      store.appendAgentMessage(spaceId, convId, { kind: 'text',
        body: '本轮演示仅支持「目标市场 / 品牌 / 目标达人」的“改成 X”修改。其他字段请直接在项目画像中编辑，修改会实时保存到同一份草稿。' });
      return;
    }
    store.appendAgentMessage(spaceId, convId, { kind: 'text',
      body: '已收到你的消息。本轮为演示流程，未接入真实 AI 回复；你的输入已保留在会话中。' });
  }

  /** 03 底部「确认画像并创建项目」：先校验，缺项就近提示并定位首个缺项；通过后仅打开 04。 */
  function portraitIssues(conv) {
    var errors = {};
    var order = [];
    var region = conv.portrait.region || { selected: [] };
    if (!region.selected.length) {
      errors['portrait.region'] = '至少选择 1 个国家／地区（启动必填）';
      order.push('portrait.region');
    }
    conv.portrait.personas.forEach(function (p, i) {
      if (!String(p.target || '').trim()) {
        var key = 'persona:' + p.id + ':target';
        errors[key] = '请填写目标达人（第 ' + (i + 1) + ' 张画像）';
        order.push(key);
      }
    });
    return { errors: errors, order: order };
  }

  function confirmPortrait() {
    var conv = activeConversation();
    if (!conv || !conv.portrait || conv.stage !== 'parsed') return;
    if (flow.editing || flow.addDraft) {
      UI.showToast('请先完成当前编辑。');
      return;
    }
    var result = portraitIssues(conv);
    if (result.order.length) {
      flow.panelErrors = result.errors;
      renderPanel(conv, 'edit');
      var firstRow = document.querySelector('.portrait-panel [data-frow="' + result.order[0] + '"]');
      if (firstRow) {
        firstRow.scrollIntoView({ block: 'center' });
        var act = firstRow.querySelector('.pp-act');
        if (act) act.focus({ preventScroll: true });
      }
      return;
    }
    flow.panelErrors = {};
    openNamingModal();
  }

  /** 04：命名弹窗；仅点击「创建项目」才真正创建。 */
  function openNamingModal() {
    var conv = activeConversation();
    if (!conv) return;
    var spaceId = conv.spaceId;
    var convId = conv.id;
    flow.namingModal = UI.showNamingModal({
      initialName: conv.draftProjectName || '',
      onInput: function (value) { store.setDraftName(spaceId, convId, value); }, // 输入即保存，取消后不丢
      onCancel: function () { flow.namingModal = null; }, // 取消/关闭：回 03，保留名称与画像
      onConfirm: function (name) {
        var modal = flow.namingModal;
        store.setDraftName(spaceId, convId, name);
        modal.setLocked(true); // 04A：提交中锁定重复提交与弹窗操作
        SIM.createProjectRequest().then(function (res) {
          if (!res.ok) { // 04B：失败留在弹窗，信息保留
            modal.setLocked(false);
            modal.showError('创建失败，请重试。已填写内容已保留。');
            return;
          }
          var target = store.getConversation(spaceId, convId);
          if (!target || target.projectId) { // 已创建过：不重复
            modal.setLocked(false);
            modal.showError('项目已存在，请勿重复创建。');
            return;
          }
          var body = '项目画像已保存为初始版本。' +
            (target.conditions.length ? '之前提到的 ' + target.conditions.join('、') + ' 已保留。' : '') +
            '接下来会整理寻找计划。（演示流程到项目创建为止：寻找计划与任务创建暂未开放。）';
          var result = store.createProject(spaceId, convId, name, body);
          if (!result.ok) {
            modal.setLocked(false);
            modal.showError('创建失败，请重试。已填写内容已保留。');
            return;
          }
          modal.close(); // 05：关闭弹窗与画像面板，恢复完整对话
          flow.namingModal = null;
          flow.panelOpen = false;
          flow.panelErrors = {};
          if (lastPageKey !== pageKey()) renderAll();
        });
      }
    });
  }

  /* ---------------- 03 画像面板交互（V9 阅读／编辑两态） ----------------
   * 规则：编辑值直接写入共享草稿（不再需要“应用”）；完成/取消只收起控件；
   *      缺项就近提示 + 定位首个缺项；多画像一律按 portrait.id 定位。
   * ------------------------------------------------------------------ */
  function clearPanelError(key) {
    if (!flow.panelErrors[key]) return;
    delete flow.panelErrors[key];
    var row = document.querySelector('.portrait-panel [data-frow="' + key + '"] .pp-field-error');
    if (row) row.remove();
  }

  /** kp 形如 common:brand 或 persona:<id>:target。 */
  function parseKp(kp) {
    var parts = String(kp || '').split(':');
    if (parts[0] === 'persona') return { scope: 'persona', personaId: parts[1], field: parts[2] };
    return { scope: parts[0], field: parts[1] };
  }

  function writeFieldValue(conv, kp, value) {
    var parsed = parseKp(kp);
    if (parsed.scope === 'common') {
      store.setPortraitField(conv.spaceId, conv.id, parsed.field, value);
    } else if (parsed.scope === 'persona') {
      store.setPersonaFieldById(conv.spaceId, conv.id, parsed.personaId, parsed.field, value);
    }
  }

  /** V9 原位编辑：输入保持在控件临时值中，完成才写共享草稿。 */
  function onPanelInput(e) {
    var input = e.target;
    if (!input || !input.matches) return;
    var editing = flow.editing;
    if (input.matches('[data-role="field-editor"]') && editing && editing.kind === 'field') {
      var row = input.closest('.pp-field');
      var commit = row && row.querySelector('[data-action="commit-field"]');
      if (commit && editing.kp.split(':').pop() === 'target') {
        commit.disabled = !input.value.trim();
        var requiredHint = row.querySelector('.pp-edit-hint');
        if (requiredHint) requiredHint.hidden = !!input.value.trim();
      }
      return;
    }
    if (input.matches('[data-role="draft-field"]') && flow.addDraft) {
      flow.addDraft[input.dataset.key] = input.value;
      if (input.dataset.key === 'target') {
        var add = document.querySelector('.pp-draft-card [data-action="complete-add-persona"]');
        if (add) add.disabled = !input.value.trim();
        var hint = input.closest('.pp-field').querySelector('.pp-edit-hint');
        if (hint) hint.hidden = !!input.value.trim();
      }
      return;
    }
  }

  function onPanelKeydown(e) {
    if (!e.target.closest || !e.target.closest('.portrait-panel')) return;
    if (e.key === 'Escape' && (flow.editing || flow.addDraft)) {
      e.preventDefault();
      if (flow.addDraft) flow.addDraft = null;
      else flow.editing = null;
      var conv = activeConversation();
      if (conv) renderPanel(conv, 'edit');
      return;
    }
    if (e.key !== 'Enter' || e.isComposing || e.keyCode === 229 || e.target.tagName !== 'INPUT') return;
    if (e.target.matches('[data-role="field-editor"], [data-role="name-editor"]')) {
      e.preventDefault();
      var row = e.target.closest('.pp-field');
      var action = e.target.matches('[data-role="name-editor"]') ? 'commit-name' : 'commit-field';
      var button = (row || e.target.closest('.pp-persona')).querySelector('[data-action="' + action + '"]');
      if (button && !button.disabled) button.click();
    }
  }

  function onPanelClick(e) {
    var btn = e.target.closest('button');
    var body = e.target.closest('[data-action]');
    var conv = activeConversation();
    var el = btn || body;
    if (!el) return;
    var action = el.dataset.action;

    if (action === 'close-portrait') {
      flow.panelOpen = false;   // 关闭面板恢复完整对话；再打开保留修改
      flow.editing = null;
      flow.addDraft = null;
      if (lastPageKey !== pageKey()) renderAll();
      return;
    }
    if (action === 'jump-latest') { jumpToLatest(); return; }
    if (!conv || !conv.portrait) return;

    if (action === 'edit-field') {
      if (conv.stage !== 'parsed') return;
      startEditing({ kind: 'field', kp: el.dataset.frow });
      return;
    }
    if (action === 'edit-region') {
      if (conv.stage !== 'parsed') return;
      startEditing({ kind: 'region' });
      return;
    }
    if (action === 'add-region') {
      if (conv.stage !== 'parsed') return;
      if (!flow.editing || flow.editing.kind !== 'region') return;
      var picker = document.querySelector('.portrait-panel [data-role="region-picker"]');
      if (!picker || !picker.value) return;
      if (flow.editing.temp.indexOf(picker.value) === -1) flow.editing.temp.push(picker.value);
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'remove-region') {
      if (conv.stage !== 'parsed') return;
      if (!flow.editing || flow.editing.kind !== 'region') return;
      flow.editing.temp = flow.editing.temp.filter(function (code) { return code !== el.dataset.code; });
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'commit-region') {
      if (!flow.editing || flow.editing.kind !== 'region' || !flow.editing.temp.length) return;
      var regions = flow.editing.temp.slice();
      flow.editing = null;
      store.setRegionSelection(conv.spaceId, conv.id, regions);
      clearPanelError('portrait.region');
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'commit-field') {
      if (!flow.editing || flow.editing.kind !== 'field') return;
      var fieldEditor = document.querySelector('.portrait-panel [data-role="field-editor"]');
      if (!fieldEditor) return;
      var fieldValue = fieldEditor.value.trim();
      var fieldKey = flow.editing.kp;
      if (fieldKey.split(':').pop() === 'target' && !fieldValue) return;
      var parsedKey = parseKp(fieldKey);
      var oldValue = parsedKey.scope === 'common' ? conv.portrait.fields[parsedKey.field] :
        (conv.portrait.personas.filter(function (p) { return p.id === parsedKey.personaId; })[0] || {})[parsedKey.field];
      flow.editing = null;
      if (fieldValue !== String(oldValue || '')) writeFieldValue(conv, fieldKey, fieldValue);
      clearPanelError(fieldKey);
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'commit-name') {
      if (!flow.editing || flow.editing.kind !== 'name') return;
      var nameEditor = document.querySelector('.portrait-panel [data-role="name-editor"]');
      if (!nameEditor) return;
      var personaId = flow.editing.personaId;
      var person = conv.portrait.personas.filter(function (p) { return p.id === personaId; })[0];
      var name = nameEditor.value.trim();
      flow.editing = null;
      if (person && !name) store.resetPersonaNameAuto(conv.spaceId, conv.id, personaId);
      else if (person && (name !== person.name || !person.nameManual)) {
        store.setPersonaFieldById(conv.spaceId, conv.id, personaId, 'name', name);
      }
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'cancel-edit') {
      startEditing(null); // V9：舍弃本次控件临时值，共享草稿保持原样
      return;
    }
    if (action === 'edit-name') {
      if (conv.stage !== 'parsed') return;
      startEditing({ kind: 'name', personaId: el.dataset.personaId });
      return;
    }
    if (action === 'add-persona') {
      if (conv.stage !== 'parsed') return;
      if (flow.editing || flow.addDraft) return;
      flow.addDraft = { name: '', target: '', topics: '', preference: '', audience: '', must: '', avoid: '' };
      renderPanel(conv, 'edit');
      var draftName = document.querySelector('.pp-draft-card [data-key="name"]');
      if (draftName) draftName.focus({ preventScroll: true });
      return;
    }
    if (action === 'cancel-add-persona') {
      flow.addDraft = null;
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'complete-add-persona') {
      if (!flow.addDraft || !flow.addDraft.target.trim()) return;
      var draft = flow.addDraft;
      flow.addDraft = null;
      store.addPersona(conv.spaceId, conv.id, draft);
      renderPanel(conv, 'edit');
      return;
    }
    if (action === 'remove-persona') {
      if (conv.stage !== 'parsed') return;
      if (flow.editing || flow.addDraft) return;
      var r = store.removePersonaById(conv.spaceId, conv.id, el.dataset.personaId);
      if (!r.ok && r.reason === 'last-persona') UI.showToast('项目至少保留一张目标达人画像。');
      else if (r.ok) clearPersonaErrors(el.dataset.personaId);
      return;
    }
    if (action === 'confirm-portrait') {
      confirmPortrait();
      return;
    }
  }

  /** 删除画像后清掉该画像遗留的缺项提示，避免提示指向已不存在的画像。 */
  function clearPersonaErrors(personaId) {
    var prefix = 'persona:' + personaId + ':';
    Object.keys(flow.panelErrors).forEach(function (key) {
      if (key.indexOf(prefix) === 0) delete flow.panelErrors[key];
    });
  }

  /* ---------------- 事件 ---------------- */
  function onSidebarClick(e) {
    if (store.isSwitching()) return;
    var nav = e.target.closest('.nav-item');
    if (!nav) return;
    if (nav.dataset.platform) {
      if (nav.dataset.available === '1') {
        flow.panelOpen = false; // Instagram 始终开始新的空白会话
        flow.panelErrors = {};
        store.openBlankSession();
      } else {
        UI.showToast('该功能暂未开放。');
      }
      return;
    }
    if (nav.dataset.projectId) {
      UI.showToast('项目工作区暂未开放。'); // 本轮不合并 V9，不跳转示例项目
      return;
    }
    if (nav.dataset.convId) {
      flow.panelOpen = false; // 切换会话不携带上一会话的面板状态
      flow.panelErrors = {};
      store.openConversation(nav.dataset.convId);
      return;
    }
  }

  function onAccountEntryClick(e) {
    var entry = e.target.closest('.account-entry');
    if (!entry) return;
    e.stopPropagation();
    if (appState.popoverOpen) closePopover(e.detail === 0);
    else openPopover(e.detail === 0);
  }

  function onPopoverClick(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    if (btn.disabled || store.isSwitching()) return;
    if (btn.dataset.action === 'switch-space') {
      // 直接切换：无需选择列表
      if (store.isSwitching()) return;
      var target = otherSpaceId();
      if (target) requestSwitch(target);
      return;
    }
    if (btn.dataset.action === 'logout') {
      closePopover();
      UI.showConfirmModal({
        title: '退出登录',
        body: '确定要退出登录吗？\n退出仅结束本地演示登录状态，不会删除任何已保存的数据。',
        confirmLabel: '退出登录',
        cancelLabel: '取消',
        onConfirm: function () {
          store.confirmLogout();
          document.getElementById('reenter-btn').focus();
        },
        onCancel: focusAccountEntry // 动态查找仍存在的入口；保留原空间与输入
      });
      return;
    }
    if (btn.dataset.action === 'unavailable') {
      var name = btn.dataset.name || '该功能';
      closePopover(true); // 菜单动作会删除按钮，焦点回到仍存在的账户入口
      if (name === '项目工作区') UI.showToast('项目工作区暂未开放。');
      else UI.showToast('该功能暂未开放。');
      return;
    }
  }

  /** 会话区事件：发送 / 材料 / 链接录入 / 画像入口 / 重新解析 / 未开放提示。 */
  function onConversationClick(e) {
    var btn = e.target.closest('button');
    if (!btn) return;
    var action = btn.dataset.action;
    var composer = btn.closest('.composer');

    if (action === 'jump-latest') {
      jumpToLatest();
      return;
    }
    if (action === 'send') {
      handleSend();
      return;
    }
    if (action === 'add-attachment') {
      var fileInput = composer.querySelector('[data-role="file-input"]');
      if (fileInput) fileInput.click();
      return;
    }
    if (action === 'add-link') {
      var box = composer.querySelector('[data-role="link-input"]');
      box.hidden = !box.hidden;
      if (!box.hidden) {
        var linkInput = box.querySelector('input');
        linkInput.value = '';
        box.classList.remove('is-error');
        linkInput.focus();
      }
      return;
    }
    if (action === 'link-confirm') {
      var box2 = composer.querySelector('[data-role="link-input"]');
      var val = box2.querySelector('input').value.trim();
      if (!isValidUrl(val)) {
        box2.classList.add('is-error');
        box2.querySelector('input').focus();
        return;
      }
      var url = /^https?:\/\//i.test(val) ? val : 'https://' + val;
      var host = url.replace(/^https?:\/\//i, '').split('/')[0];
      store.addMaterial(composer.dataset.spaceId, composer.dataset.convId,
        { type: 'link', name: url, sub: host });
      UI.refreshComposerMaterials(composer, store.getMaterials(composer.dataset.spaceId, composer.dataset.convId));
      box2.hidden = true;
      box2.classList.remove('is-error');
      return;
    }
    if (action === 'link-cancel') {
      var box3 = composer.querySelector('[data-role="link-input"]');
      box3.hidden = true;
      box3.classList.remove('is-error');
      return;
    }
    if (action === 'remove-material') {
      store.removeMaterial(composer.dataset.spaceId, composer.dataset.convId, btn.dataset.matId);
      UI.refreshComposerMaterials(composer, store.getMaterials(composer.dataset.spaceId, composer.dataset.convId));
      return;
    }
    if (action === 'toggle-materials') {
      flow.expandMaterials = !flow.expandMaterials; // 查看：紧凑行 ↔ 逐条材料
      if (lastPageKey !== pageKey()) renderAll();
      return;
    }
    if (action === 'open-portrait') {
      flow.panelOpen = true; // 用户主动打开才分屏（02 → 03）
      if (lastPageKey !== pageKey()) renderAll();
      return;
    }
    if (action === 'retry-parse') {
      retryParse();
      return;
    }
    if (action === 'unavailable') {
      UI.showToast(btn.dataset.name === '项目工作区' ? '项目工作区暂未开放。' : '该功能暂未开放。');
    }
  }

  /** 本地文件选择（仅演示材料选择，不上传、不解析内容）。 */
  function onConversationChange(e) {
    var input = e.target;
    if (!input.matches || !input.matches('[data-role="file-input"]')) return;
    var composer = input.closest('.composer');
    var spaceId = composer.dataset.spaceId;
    var draftId = composer.dataset.convId;
    Array.prototype.forEach.call(input.files || [], function (file) {
      var ext = (file.name.split('.').pop() || '文件').toUpperCase().slice(0, 4);
      store.addMaterial(spaceId, draftId, { type: 'file', name: file.name, sub: ext + ' · ' + humanSize(file.size) });
    });
    input.value = '';
    UI.refreshComposerMaterials(composer, store.getMaterials(spaceId, draftId));
  }

  /** 对话输入专用快捷键；画像编辑和命名表单仍保留各自的 Enter 行为。 */
  function onConversationKeydown(e) {
    if (!e.target.matches || !e.target.matches('.composer textarea')) return;
    if (e.key !== 'Enter' || e.shiftKey) return;
    var composer = e.target.closest('.composer');
    if (e.isComposing || e.keyCode === 229 || composer.dataset.composing === 'true' ||
        Date.now() - Number(composer.dataset.compositionEnd || 0) < 50) return;
    e.preventDefault();
    if (!e.repeat) handleSend();
  }

  function onComposerComposition(e) {
    if (!e.target.matches || !e.target.matches('.composer textarea')) return;
    var composer = e.target.closest('.composer');
    if (e.type === 'compositionstart') composer.dataset.composing = 'true';
    else {
      composer.dataset.composing = 'false';
      composer.dataset.compositionEnd = String(Date.now());
    }
  }

  function onDocumentClick(e) {
    if (!appState.popoverOpen) return;
    // 重试属于当前切换操作；toast 会先移除自身，仍可由事件原始目标识别。
    if (e.target.closest('.toast-action')) return;
    if (e.target.closest('.account-popover')) return;
    if (e.target.closest('#account-entry') || e.target.closest('.account-entry')) return;
    closePopover();
  }

  function onDocumentKeydown(e) {
    if (!appState.popoverOpen) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closePopover(true);
      return;
    }
    if (e.key === 'Tab') {
      // 用户继续导航时直接完成短过渡，避免焦点进入暂被裁切的底部菜单。
      if (popoverResize) onPopoverViewportChange();
      var el = document.querySelector('.account-popover');
      var active = document.activeElement;
      if (!el || (!el.contains(active) && active.id !== 'account-entry')) return;
      var buttons = popoverButtons(el);
      if (!buttons.length) { e.preventDefault(); el.focus(); return; }
      var first = buttons[0], last = buttons[buttons.length - 1];
      if (!el.contains(active) || active === el) {
        e.preventDefault(); (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    }
  }

  // ---------------- 启动 ----------------
  function init() {
    document.getElementById('sidebar-scroll').addEventListener('click', onSidebarClick);
    document.getElementById('sidebar-account').addEventListener('click', onAccountEntryClick);
    document.getElementById('popover-root').addEventListener('click', onPopoverClick);
    document.getElementById('conversation-col').addEventListener('click', onConversationClick);
    document.getElementById('conversation-col').addEventListener('change', onConversationChange);
    document.getElementById('conversation-col').addEventListener('keydown', onConversationKeydown);
    document.getElementById('conversation-col').addEventListener('compositionstart', onComposerComposition);
    document.getElementById('conversation-col').addEventListener('compositionend', onComposerComposition);
    document.getElementById('portrait-panel-root').addEventListener('click', onPanelClick);
    document.getElementById('portrait-panel-root').addEventListener('input', onPanelInput);
    document.getElementById('portrait-panel-root').addEventListener('keydown', onPanelKeydown);
    document.getElementById('topbar').addEventListener('click', onConversationClick);
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('keydown', onDocumentKeydown);
    global.addEventListener('resize', onPopoverViewportChange);
    if (global.visualViewport) {
      global.visualViewport.addEventListener('resize', onPopoverViewportChange);
      global.visualViewport.addEventListener('scroll', onPopoverViewportChange);
    }
    if (reducedPopoverMotion.addEventListener) reducedPopoverMotion.addEventListener('change', onPopoverViewportChange);

    document.getElementById('reenter-btn').addEventListener('click', function () {
      store.reenterDemo();
      focusAccountEntry();
    });

    // 刷新 / 离开前落盘未发送输入（localStorage 同步写入）
    global.addEventListener('beforeunload', function () { store.flushDrafts().catch(function () {}); });
    global.addEventListener('pagehide', function () { store.flushDrafts().catch(function () {}); });

    store.onChange(function () {
      // 只有空间/会话/草稿位置或登录态改变才更新主页面；busy/失败事件不替换背景DOM。
      if (lastPageKey !== pageKey()) renderAll();
      if (appState.popoverOpen) renderPopover();
    });

    renderAll();
  }

  init();

  // 测试注入口：仅供 tests/verify.py 等自动化脚本注入延迟 / 失败传输使用，
  // 产品界面不提供任何调试开关。
  global.__creatorScoutStore = store;
})(window);
