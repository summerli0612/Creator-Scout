/*
 * Creator Scout 独立首页原型 · 渲染层（ui）
 * 只负责根据 store / fixture 数据生成 DOM 与轻量反馈，不持有业务状态。
 * 浮窗四态的显隐与顺序由 computePopoverModel 纯函数计算，主界面与测试共用。
 */
(function (global) {
  'use strict';

  var Fixtures = global.Fixtures;
  var BLANK = Fixtures.BLANK_DRAFT_ID;
  var composerObserver = null;

  var assetBase = 'assets/';
  function icon(name) { return assetBase + name; }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  var ROLE_LABELS = { creator: '创建者', admin: '管理员', member: '普通成员' };

  /* ------------------------------------------------------------------
   * 账户浮窗模型（四态规则，对齐 account-popover.md 矩阵）
   * 入参 fixtureLike：{ account, team, membershipRole, currentSpaceType }
   *   - team 为 null 表示无团队：空间区整区不存在（不留占位），
   *     空间功能为 用量与计费 → 业务邮箱 → 开启团队协作，无切换按钮。
   *   - 已有团队：团队空间按角色显示身份；创建者/管理员显示团队管理；
   *     普通成员不显示团队管理；个人空间不显示团队管理，也不显示开启团队协作。
   * ------------------------------------------------------------------ */
  function computePopoverModel(fixtureLike) {
    var account = fixtureLike.account;
    var team = fixtureLike.team || null;
    var role = fixtureLike.membershipRole || null;
    var currentSpaceType = fixtureLike.currentSpaceType || 'personal';
    var hasTeam = !!team;
    var inTeam = hasTeam && currentSpaceType === 'team';

    var spaceSection = null;
    if (hasTeam) {
      if (inTeam) {
        spaceSection = {
          kind: 'team',
          name: team.name,
          initial: team.avatarInitial,
          typeLabel: '团队空间',
          roleLabel: ROLE_LABELS[role] || '',
          canSwitch: true
        };
      } else {
        spaceSection = {
          kind: 'personal',
          name: '个人空间',
          typeLabel: null,
          roleLabel: null,
          canSwitch: true
        };
      }
    }

    var spaceMenu = [{ id: 'usage', label: '用量与计费', icon: 'icon-usage.svg' }];
    if (inTeam && (role === 'creator' || role === 'admin')) {
      spaceMenu.push({ id: 'team-manage', label: '团队管理', icon: 'icon-team.svg' });
    }
    spaceMenu.push({ id: 'mail', label: '业务邮箱', icon: 'icon-mail.svg' });
    if (!hasTeam) {
      spaceMenu.push({ id: 'start-team', label: '开启团队协作', icon: 'icon-team.svg' });
    }

    return {
      account: account,
      hasTeam: hasTeam,
      inTeam: inTeam,
      canManageTeam: inTeam && (role === 'creator' || role === 'admin'),
      spaceSection: spaceSection,
      spaceMenu: spaceMenu,
      accountMenu: [
        { id: 'notifications', label: '通知', icon: 'icon-notify.svg', badge: account.unreadCount },
        { id: 'settings', label: '个人设置', icon: 'icon-settings.svg' }
      ]
    };
  }

  /* ------------------------------------------------------------------
   * 账户浮窗 DOM（默认账户菜单视图）
   * ------------------------------------------------------------------ */
  function popoverAccountHTML(model, opts) {
    opts = opts || {};
    var switching = !!opts.switching;
    var hintId = opts.hintId || '';
    var h = '';
    h += '<div class="pop-account">';
    h += '<div class="pop-avatar">' + esc(model.account.avatarInitial) + '</div>';
    h += '<div class="pop-account-text"><div class="pop-name" title="' + esc(model.account.name) + '">' + esc(model.account.name) + '</div>' +
      '<div class="pop-email en" title="' + esc(model.account.email) + '">' + esc(model.account.email) + '</div></div>';
    h += '</div>';

    if (model.spaceSection) {
      var s = model.spaceSection;
      h += '<div class="pop-space"><div class="space-row">';
      if (s.kind === 'team') {
        h += '<div class="space-avatar">' + esc(s.initial) + '</div>';
        h += '<div class="space-meta"><div class="space-name" title="' + esc(s.name) + '">' + esc(s.name) + '</div>';
        h += '<div class="space-tags"><span class="tag-space">' + esc(s.typeLabel) + '</span>' +
          '<span class="space-role">' + esc(s.roleLabel) + '</span></div></div>';
      } else {
        h += '<img class="space-icon" src="' + icon('icon-personal-space.svg') + '" alt="">';
        h += '<div class="space-meta"><div class="space-name">' + esc(s.name) + '</div></div>';
      }
      // 直接切换：点击即切换到另一空间（账号最多一个个人空间 + 一个团队空间，二者互切）
      h += '<button type="button" class="switch-btn" data-action="switch-space" aria-label="切换空间"' +
        (hintId ? ' aria-describedby="' + esc(hintId) + '"' : '') +
        (switching ? ' disabled' : '') + '><img src="' + icon('icon-switch-arrows.svg') + '" alt=""></button>';
      h += '<span class="switch-hint' + (switching ? ' is-busy' : '') + '"' +
        (hintId ? ' id="' + esc(hintId) + '"' : '') + ' role="' + (switching ? 'status' : 'tooltip') + '">' +
        (switching ? '切换中…' : '切换空间') + '</span>';
      h += '</div></div>';
    }

    h += '<div class="pop-divider" role="separator"></div>';
    h += '<div class="pop-menu" role="group" aria-label="空间功能">';
    model.spaceMenu.forEach(function (item) {
      h += '<button type="button" class="pop-menu-item" data-action="unavailable" ' +
        'data-name="' + esc(item.label) + '"' + (switching ? ' disabled' : '') + '>' +
        '<img src="' + icon(item.icon) + '" alt=""><span>' + esc(item.label) + '</span></button>';
    });
    h += '</div>';

    h += '<div class="pop-divider" role="separator"></div>';
    h += '<div class="pop-menu" role="group" aria-label="账号功能">';
    model.accountMenu.forEach(function (item) {
      var badge = item.badge ? '<span class="badge-unread en">' + esc(item.badge) + '</span>' : '';
      h += '<button type="button" class="pop-menu-item" data-action="unavailable" ' +
        'data-name="' + esc(item.label) + '"' + (switching ? ' disabled' : '') + '>' +
        '<img src="' + icon(item.icon) + '" alt=""><span>' + esc(item.label) + '</span>' + badge + '</button>';
    });
    h += '</div>';

    h += '<div class="pop-divider" role="separator"></div>';
    h += '<div class="pop-menu" role="group" aria-label="退出">';
    h += '<button type="button" class="pop-menu-item pop-menu-item--logout" data-action="logout"' +
      (switching ? ' disabled' : '') + '>' +
      '<img src="' + icon('icon-logout.svg') + '" alt=""><span>退出登录</span></button>';
    h += '</div>';
    return h;
  }

  /** 空间成功切换时只替换相关信息，保留外框、账号区、切换按钮和未变化的菜单节点。 */
  function updatePopoverSpace(popover, model) {
    var template = document.createElement('div');
    template.innerHTML = popoverAccountHTML(model, {});
    var row = popover.querySelector('.space-row');
    var nextRow = template.querySelector('.space-row');
    if (row && nextRow) {
      var avatar = row.querySelector('.space-avatar, .space-icon');
      var nextAvatar = nextRow.querySelector('.space-avatar, .space-icon');
      if (avatar && nextAvatar) avatar.replaceWith(nextAvatar);
      // 名称与标签按目标空间更新；右侧同一个切换按钮完全不动。
      row.querySelector('.space-meta').innerHTML = nextRow.querySelector('.space-meta').innerHTML;
    }
    var menu = popover.querySelector('.pop-menu[aria-label="空间功能"]');
    var nextMenu = template.querySelector('.pop-menu[aria-label="空间功能"]');
    var desired = Array.prototype.slice.call(nextMenu.children);
    var names = desired.map(function (item) { return item.dataset.name; });
    Array.prototype.slice.call(menu.children).forEach(function (item) {
      if (names.indexOf(item.dataset.name) === -1) item.remove();
    });
    desired.forEach(function (item, index) {
      var existing = Array.prototype.slice.call(menu.children).filter(function (child) {
        return child.dataset.name === item.dataset.name;
      })[0];
      var node = existing || item;
      if (menu.children[index] !== node) menu.insertBefore(node, menu.children[index] || null);
    });
  }

  /**
   * 切换提示独立于浮窗的滚动/动画容器；仅按钮 hover / 键盘 focus 或切换中显示。
   * 返回清理函数，浮窗重绘/关闭必须调用，避免遗留提示和监听器。
   */
  function attachSwitchHint(popover, layer) {
    var button = popover.querySelector('.switch-btn');
    var hint = popover.querySelector('.switch-hint');
    if (!button || !hint) return function () {};
    var disposed = false, frame = null;
    hint.hidden = true;
    hint.classList.add('is-floating');
    layer.appendChild(hint);
    var viewport = global.visualViewport;

    function update() {
      frame = null;
      if (disposed || !popover.isConnected) return;
      var busy = hint.classList.contains('is-busy');
      var requested = busy || button.matches(':hover') || button.matches(':focus-visible');
      if (!requested) { hint.hidden = true; return; }
      var box = popover.getBoundingClientRect(), anchor = button.getBoundingClientRect();
      var margin = 8, gap = 8;
      var leftEdge = (viewport ? viewport.offsetLeft : 0) + margin;
      var topEdge = (viewport ? viewport.offsetTop : 0) + margin;
      var rightEdge = leftEdge + (viewport ? viewport.width : global.innerWidth) - margin * 2;
      var bottomEdge = topEdge + (viewport ? viewport.height : global.innerHeight) - margin * 2;
      var anchorVisible = anchor.top >= Math.max(box.top, topEdge) && anchor.bottom <= Math.min(box.bottom, bottomEdge);
      if (!busy && !anchorVisible) { hint.hidden = true; return; }
      hint.style.maxWidth = Math.max(0, rightEdge - leftEdge) + 'px';
      hint.hidden = false;
      var size = hint.getBoundingClientRect();
      function clamp(value, low, high) { return Math.max(low, Math.min(value, high)); }
      var x, y, placement;
      // 放在外框右侧：至少离按钮8px，同时保证不压在浮窗边框/信息上。
      var right = Math.max(anchor.right + gap, box.right + gap);
      if (right + size.width <= rightEdge) {
        x = right;
        y = clamp(anchor.top + (anchor.height - size.height) / 2, topEdge, bottomEdge - size.height);
        placement = 'right';
      } else if (box.top - gap - size.height >= topEdge) {
        x = clamp(anchor.right - size.width, leftEdge, rightEdge - size.width);
        y = box.top - gap - size.height;
        placement = 'top';
      } else if (box.bottom + gap + size.height <= bottomEdge) {
        x = clamp(anchor.right - size.width, leftEdge, rightEdge - size.width);
        y = box.bottom + gap;
        placement = 'bottom';
      } else if (box.left - gap - size.width >= leftEdge) {
        x = box.left - gap - size.width;
        y = clamp(anchor.top, topEdge, bottomEdge - size.height);
        placement = 'left';
      } else {
        // 极端小视口宁可不画提示，也不盖住名称/身份；按钮仍有 aria-label。
        hint.hidden = true;
        return;
      }
      hint.style.left = Math.round(x) + 'px';
      hint.style.top = Math.round(y) + 'px';
      hint.dataset.placement = placement;
    }
    function schedule() {
      if (!disposed && frame === null) frame = global.requestAnimationFrame(update);
    }
    var events = ['pointerenter', 'pointerleave', 'focus', 'blur'];
    events.forEach(function (name) { button.addEventListener(name, schedule); });
    popover.addEventListener('scroll', schedule, { passive: true });
    popover.addEventListener('animationend', schedule);
    global.addEventListener('resize', schedule);
    if (viewport) {
      viewport.addEventListener('resize', schedule);
      viewport.addEventListener('scroll', schedule);
    }
    update();
    function dispose() {
      disposed = true;
      if (frame !== null) global.cancelAnimationFrame(frame);
      events.forEach(function (name) { button.removeEventListener(name, schedule); });
      popover.removeEventListener('scroll', schedule);
      popover.removeEventListener('animationend', schedule);
      global.removeEventListener('resize', schedule);
      if (viewport) {
        viewport.removeEventListener('resize', schedule);
        viewport.removeEventListener('scroll', schedule);
      }
      hint.remove();
    }
    // 原位更新忙碌文案或布局时复用同一提示，不重建按钮及监听器。
    dispose.update = update;
    return dispose;
  }

  /* 会话阶段 → 侧栏「最近」副标题 / 顶栏右 meta（对齐 Figma 01/02/03/05） */
  var STAGE_LABELS = {
    parsing: '解析中',
    parsed: '草稿',              // 画像面板打开时显示「等待画像确认」（03/04 状态）
    project_created: '项目助手'
  };

  function conversationSubLabel(conv, panelOpen) {
    if (conv.stage === 'parsed' && panelOpen) return '等待画像确认';
    return STAGE_LABELS[conv.stage] || '草稿';
  }

  /* ------------------------------------------------------------------
   * 侧栏
   * ------------------------------------------------------------------ */
  function renderSidebar(store, opts) {
    opts = opts || {};
    var account = store.getAccount();
    var space = store.getCurrentSpace();
    var activeConvId = store.getActiveConversationId(space.id);
    var h = '';

    // AI Agent 分区
    h += '<div class="side-section side-section--agents"><div class="side-label">AI Agent</div>';
    store.getPlatforms().forEach(function (p) {
      var selected = p.id === 'instagram' && activeConvId === null;
      h += '<button type="button" class="nav-item' + (selected ? ' is-selected' : '') +
        '" data-platform="' + esc(p.id) + '" data-available="' + (p.available ? '1' : '0') + '">' +
        '<img class="nav-icon" src="' + icon('icon-' + p.id + '.svg') + '" alt=""><span class="nav-label">' +
        esc(p.label) + '</span></button>';
    });
    h += '</div>';

    // 项目分区
    h += '<div class="side-section side-section--projects"><div class="side-label">项目</div>';
    store.getProjects(space.id).forEach(function (proj) {
      h += '<button type="button" class="nav-item" data-project-id="' + esc(proj.id) + '">' +
        '<img class="nav-icon" src="' + icon('icon-folder.svg') + '" alt=""><span class="nav-label">' +
        esc(proj.name) + '</span></button>';
    });
    h += '</div>';

    // 最近分区（副标题随阶段：解析中 / 草稿 / 等待画像确认 / 项目助手）
    h += '<div class="side-section side-section--recents"><div class="side-label">最近</div>';
    store.getConversations(space.id).forEach(function (conv) {
      var selected = conv.id === activeConvId;
      h += '<button type="button" class="nav-item nav-item--recent' + (selected ? ' is-selected' : '') +
        '" data-conv-id="' + esc(conv.id) + '">' +
        '<img class="nav-icon" src="' + icon('icon-chat.svg') + '" alt="">' +
        '<span class="nav-text"><span class="nav-title">' + esc(conv.title) + '</span>' +
        '<span class="nav-sub">' + esc(conversationSubLabel(conv, opts.panelOpen)) + '</span></span></button>';
    });
    h += '</div>';

    var scrollRoot = document.getElementById('sidebar-scroll');
    scrollRoot.innerHTML = h;
    renderAccountEntry(store, account, space);
  }

  function renderAccountEntry(store, account, space) {
    var entry = document.getElementById('sidebar-account');
    entry.innerHTML =
      '<button type="button" class="account-entry" id="account-entry" aria-haspopup="dialog" aria-expanded="false">' +
      '<span class="entry-avatar">' + esc(account.avatarInitial) + '</span>' +
      '<span class="entry-text"><span class="entry-name">' + esc(account.name) + '</span>' +
      '<span class="entry-space">' + esc(space.name) + '</span></span>' +
      '<span class="entry-chevron">' + ICONS.chevronUp + '</span></button>';
  }

  /* ------------------------------------------------------------------
   * 顶栏（随会话阶段显示：新会话 / 材料解析中 / 项目草稿 / 关联项目）
   * ------------------------------------------------------------------ */
  function renderTopbar(store, opts) {
    opts = opts || {};
    var space = store.getCurrentSpace();
    var activeConvId = store.getActiveConversationId(space.id);
    var topbar = document.getElementById('topbar');
    var h = '<img class="top-icon" src="' + icon('icon-instagram.svg') + '" alt="">';
    if (!activeConvId) {
      h += '<span class="top-title">Instagram 达人营销</span>';
      h += '<span class="top-meta">新会话</span>';
    } else {
      var conv = store.getConversation(space.id, activeConvId);
      if (!conv) {
        h += '<span class="top-title">Instagram 达人营销</span><span class="top-meta">新会话</span>';
        topbar.innerHTML = h;
        return;
      }
      h += '<span class="top-title">Instagram 达人营销</span>';
      h += '<span class="top-sub" title="' + esc(conv.title) + '">' + esc(conv.title) + '</span>';
      if (conv.stage === 'parsing') {
        h += '<span class="top-meta">材料解析中</span>';
      } else if (conv.stage === 'parsed') {
        if (opts.panelOpen && conv.draftProjectName) {
          h += '<span class="top-meta">项目草稿：' + esc(conv.draftProjectName) + '</span>';
        }
      } else if (conv.stage === 'project_created') {
        var proj = store.getProjects(space.id).filter(function (p) { return p.id === conv.projectId; })[0];
        h += '<span class="top-meta">关联项目：' + esc(proj ? proj.name : conv.title) + '</span>';
        h += '<button type="button" class="btn-enter-project" data-action="unavailable" data-name="项目工作区">' +
          '<img src="' + icon('icon-folder.svg') + '" alt="">进入项目  →</button>';
      }
    }
    topbar.innerHTML = h;
  }

  /* ------------------------------------------------------------------
   * 输入组件（空白 / 完整会话 / 窄会话三态共用一套操作与状态）
   * 发送就绪 = 非空文字 或 至少一份材料；发送中锁定；失败保留内容并提供重试。
   * ------------------------------------------------------------------ */
  function composerHTML(spaceId, draftId, placeholder, variant) {
    return '<div class="composer composer--' + variant + '" data-space-id="' + esc(spaceId) +
      '" data-conv-id="' + esc(draftId == null ? BLANK : draftId) + '" data-variant="' + variant + '">' +
      '<div class="composer-mats" data-role="materials"></div>' +
      '<textarea placeholder="' + esc(placeholder) + '" aria-label="需求描述输入框" rows="2"></textarea>' +
      '<div class="composer-error" data-role="error" hidden></div>' +
      '<div class="composer-actions">' +
      '<button type="button" class="btn-ghost" data-action="add-attachment">＋  添加附件</button>' +
      '<button type="button" class="btn-ghost btn-link" data-action="add-link">↗  添加链接</button>' +
      '<button type="button" class="btn-send" data-action="send">发送  →</button>' +
      '</div>' +
      '<div class="link-input" data-role="link-input" hidden>' +
      '<input type="text" placeholder="粘贴链接，如 https://example.com" aria-label="链接地址">' +
      '<button type="button" class="link-input-add" data-action="link-confirm">添加</button>' +
      '<button type="button" class="link-input-cancel" data-action="link-cancel">取消</button>' +
      '</div>' +
      '<input type="file" class="file-input" data-role="file-input" multiple hidden>' +
      '</div>';
  }

  /** 材料标签（发送前在输入区内，可移除；不上传、不解析内容） */
  function materialChipHTML(mat) {
    var badge = mat.type === 'file' ? (mat.name.split('.').pop() || '文件').toUpperCase().slice(0, 4) : '↗';
    return '<span class="mat-chip" data-mat-id="' + esc(mat.id) + '">' +
      '<span class="mat-badge">' + esc(badge) + '</span>' +
      '<span class="mat-name" title="' + esc(mat.name) + '">' + esc(mat.name) + '</span>' +
      '<span class="mat-sub">' + esc(mat.sub) + '</span>' +
      '<button type="button" class="mat-remove" data-action="remove-material" data-mat-id="' + esc(mat.id) + '" aria-label="移除材料">×</button>' +
      '</span>';
  }

  /** 会话内材料行：解析中逐条展示（01）；解析后聚合为紧凑行（02） */
  function messageMaterialsHTML(materials, expanded) {
    if (!materials || !materials.length) return '';
    if (expanded) {
      var rows = '';
      materials.forEach(function (m) {
        var badge = m.type === 'file' ? (m.name.split('.').pop() || '文件').toUpperCase().slice(0, 4) : '↗';
        rows += '<div class="mat-row"><span class="mat-row-badge">' + esc(badge) + '</span>' +
          '<span class="mat-row-name" title="' + esc(m.name) + '">' + esc(m.name) + '</span>' +
          '<span class="mat-row-sub">' + esc(m.sub) + '</span>' +
          '<span class="mat-row-status">已接收</span></div>';
      });
      return rows;
    }
    var count = materials.length;
    return '<div class="mat-compact"><span class="mat-compact-text">' + count + ' 份材料 · 本轮演示未解析内容</span>' +
      '<button type="button" class="mat-compact-view" data-action="toggle-materials">查看</button></div>';
  }

  function agentCardHTML(m) {
    var h = '<div class="msg-card--agent">';
    if (m.title) h += '<div class="agent-title' + (m.kind === 'created' ? ' is-created' : '') + '">' + esc(m.title) + '</div>';
    if (m.kind === 'created') h += '<span class="created-check" aria-hidden="true">✓</span>';
    if (m.body) h += '<div class="agent-body">' + esc(m.body) + '</div>';
    if (m.text) h += '<div class="agent-body">' + esc(m.text) + '</div>';
    if (m.statusLine) h += '<div class="agent-status-line">' + esc(m.statusLine) + '</div>';
    if (m.note) h += '<div class="agent-note">' + esc(m.note) + '</div>';
    if (m.summary && m.summary.length) {
      h += '<div class="agent-summary">';
      m.summary.forEach(function (row) {
        h += '<div class="agent-summary-row"><span class="row-label">' + esc(row.label) + '</span>' +
          '<span class="row-value">' + esc(row.value) + '</span></div>';
      });
      h += '</div>';
    }
    if (m.unverified) {
      h += '<div class="agent-unverified"><div class="unverified-title">' + esc(m.unverified.title) + '</div>' +
        '<div class="agent-body">' + esc(m.unverified.body) + '</div></div>';
    }
    if (m.kind === 'guidance') {
      var created = m.convStage === 'project_created';
      var status = created ? '已创建' : (m.panelOpen ? '正在查看' : '待确认');
      var button;
      if (created) {
        button = '<button type="button" class="btn-view-portrait is-secondary" data-action="open-portrait">查看当前项目画像</button>';
      } else if (m.panelOpen) {
        button = '<button type="button" class="btn-view-portrait is-open" disabled>已打开</button>';
      } else {
        button = '<button type="button" class="btn-view-portrait" data-action="open-portrait">查看并确认</button>';
      }
      h += '<div class="guidance-divider"></div>';
      h += '<div class="guidance-action">' +
        '<div class="guidance-copy"><div class="guidance-copy-title">项目画像</div>' +
        '<div class="guidance-copy-sub">确认项目长期使用的达人筛选标准</div></div>' +
        '<div class="guidance-controls">' +
        '<span class="guidance-status">' + status + '</span>' + button +
        '</div></div>';
    }
    if (m.kind === 'parse-error') {
      h += '<div class="parse-retry"><button type="button" class="btn-retry-parse" data-action="retry-parse">重新解析</button></div>';
    }
    h += '</div>';
    return h;
  }

  function renderConversation(store, opts) {
    opts = opts || {};
    var space = store.getCurrentSpace();
    var activeConvId = store.getActiveConversationId(space.id);
    var root = document.getElementById('conversation-col');
    var h = '';

    root.classList.toggle('is-narrow', !!opts.panelOpen);

    if (!activeConvId) {
      // 默认空白会话（Figma 306:74）：滚动视口占满，正文在 .blank-inner 内限宽居中
      h += '<div class="blank-session">';
      h += '<div class="blank-inner">';
      h += '<img class="blank-mark" src="' + icon('mark-instagram.png') + '" alt="Instagram" width="40" height="40">';
      h += '<div class="blank-title">你想找什么样的 Instagram 达人？</div>';
      h += '<div class="blank-sub">说说你的产品和目标市场，其他条件可以边聊边补充。</div>';
      h += composerHTML(space.id, store.getActiveBlankDraftId(space.id), '例如：我们做便携咖啡机，想找美国的户外类达人……', 'blank');
      h += '</div>';
      h += '</div>';
    } else {
      var conv = store.getConversation(space.id, activeConvId);
      if (!conv) { root.innerHTML = ''; return; }
      var variant = opts.panelOpen ? 'narrow' : 'chat';
      var placeholder = conv.stage === 'parsing' ? '继续补充需求，或等待材料读取完成……' : '继续补充或修改需求……';
      // .chat-view 占满对话列：滚动视口独立滚动，正文 .chat-inner 限宽居中，
      // 输入区 .composer-outer 固定在底部并与正文共用同一条居中轴线。
      h += '<div class="chat-view">';
      if (opts.panelOpen) {
        h += '<div class="narrow-header"><span class="narrow-title">需求对话</span>' +
          '<span class="narrow-hint">与右侧共用同一份草稿</span></div>';
      }
      h += '<div class="chat-scroll-wrap">';
      h += '<div class="chat-scroll" data-role="chat-scroll">';
      h += '<div class="chat-inner">';
      if (conv.dateLabel) h += '<div class="chat-date">' + esc(conv.dateLabel) + '</div>';
      var expandMaterials = !!opts.expandMaterials;
      conv.messages.forEach(function (m) {
        if (m.role === 'user') {
          h += '<div class="msg-block" data-message-id="' + esc(m.id) + '"><div class="msg-sender msg-sender--user">你</div>' +
            '<div class="msg-bubble--user">' + esc(m.text) + '</div>';
          h += messageMaterialsHTML(m.materials, expandMaterials || conv.stage === 'parsing');
          h += '</div>';
        } else {
          var card = Object.assign({}, m, {
            panelOpen: opts.panelOpen && conv.stage === 'parsed',
            convStage: conv.stage
          });
          h += '<div class="msg-block" data-message-id="' + esc(m.id) + '"><div class="msg-sender">Instagram  Agent</div>' + agentCardHTML(card) + '</div>';
        }
      });
      h += '</div>'; // .chat-inner
      h += '</div>'; // .chat-scroll
      h += '<button type="button" class="jump-latest-btn is-hidden" data-action="jump-latest" ' +
        'aria-label="回到底部" title="回到底部">' + ICONS.arrowDown + '</button>';
      h += '</div>'; // .chat-scroll-wrap
      h += '<div class="composer-outer">';
      h += composerHTML(space.id, conv.id, placeholder, variant);
      if (!opts.panelOpen) {
        var footnote;
        if (conv.stage === 'parsing') footnote = '材料失败不会阻断其他内容解析；失败材料的信息保持待核实。';
        else if (conv.stage === 'parsed') footnote = '当前为项目草稿 · 项目和任务均未启动';
        else {
          var proj = store.getProjects(space.id).filter(function (p) { return p.id === conv.projectId; })[0];
          footnote = '已关联 ' + esc(proj ? proj.name : conv.title) + ' · 会话继续可用';
        }
        h += '<div class="chat-footnote">' + footnote + '</div>';
      }
      h += '</div>'; // .composer-outer
      h += '</div>'; // .chat-view
    }
    if (composerObserver) { composerObserver.disconnect(); composerObserver = null; }
    root.innerHTML = h;

    // 输入组件：恢复草稿 + 材料标签 + 事件
    var composer = root.querySelector('.composer');
    if (composer) {
      var draftId = composer.dataset.convId;
      var materials = store.getMaterials(space.id, draftId);
      var matsBox = composer.querySelector('[data-role="materials"]');
      matsBox.innerHTML = materials.map(materialChipHTML).join('');
      var textarea = composer.querySelector('textarea');
      textarea.value = store.getDraft(space.id, draftId);
      updateSendState(composer);
      resizeComposer(composer);
      textarea.addEventListener('input', function () {
        store.setDraft(space.id, draftId, textarea.value);
        updateSendState(composer);
        resizeComposer(composer);
      });
      // 仅宽度变化才重算，避免由自身高度变化触发观察循环。
      if (global.ResizeObserver) {
        var lastWidth = composer.clientWidth;
        composerObserver = new global.ResizeObserver(function () {
          if (composer.clientWidth !== lastWidth) {
            lastWidth = composer.clientWidth;
            resizeComposer(composer);
          }
        });
        composerObserver.observe(composer);
      }
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { if (composer.isConnected) resizeComposer(composer); });
      }
    }
  }

  function resizeComposer(composer) {
    var textarea = composer.querySelector('textarea');
    if (!textarea) return;
    var style = global.getComputedStyle(textarea);
    var minHeight = parseFloat(style.minHeight) || 44;
    var maxHeight = Math.max(minHeight, parseFloat(style.maxHeight) || 220);
    var previousScroll = textarea.scrollTop;
    // 先收起再测量，删除内容时也能回落；操作行始终留在正常文档流里。
    textarea.style.height = '0px';
    var height = Math.min(maxHeight, Math.max(minHeight, textarea.scrollHeight));
    textarea.style.height = height + 'px';
    textarea.style.overflowY = textarea.scrollHeight > height + 1 ? 'auto' : 'hidden';
    textarea.scrollTop = previousScroll;
  }

  function updateSendState(composer) {
    var textarea = composer.querySelector('textarea');
    var send = composer.querySelector('.btn-send');
    if (send.classList.contains('is-sending')) return; // 发送中锁定
    var hasMaterials = composer.querySelectorAll('.mat-chip').length > 0;
    var ready = textarea.value.trim().length > 0 || hasMaterials;
    send.classList.toggle('is-ready', ready);
    send.setAttribute('aria-disabled', ready ? 'false' : 'true');
    send.disabled = !ready;
  }

  /** 发送中：按钮显示「发送中…」并禁用（00B）。 */
  function setComposerSending(composer, sending) {
    var send = composer.querySelector('.btn-send');
    if (!send) return;
    if (sending) {
      send.classList.add('is-sending');
      send.classList.remove('is-ready');
      send.disabled = true;
      send.textContent = '发送中…';
    } else {
      send.classList.remove('is-sending');
      send.textContent = '发送  →';
      updateSendState(composer);
    }
  }

  /** 发送失败：输入区附近就近提示 + 原位重试（00C），内容与材料保留。 */
  function showComposerError(composer, message) {
    var box = composer.querySelector('[data-role="error"]');
    if (!box) return;
    box.hidden = false;
    box.innerHTML = '<span class="composer-error-text">' + esc(message) + '</span>' +
      '<button type="button" class="composer-error-retry" data-action="send">重试</button>';
  }

  function clearComposerError(composer) {
    var box = composer.querySelector('[data-role="error"]');
    if (box) { box.hidden = true; box.innerHTML = ''; }
  }

  /** 发送成功后刷新材料标签（清空或回填）。 */
  function refreshComposerMaterials(composer, materials) {
    var box = composer.querySelector('[data-role="materials"]');
    if (box) box.innerHTML = (materials || []).map(materialChipHTML).join('');
    updateSendState(composer);
  }

  /* ------------------------------------------------------------------
   * 轻提示 Toast
   * ------------------------------------------------------------------ */
  function showToast(message, opts) {
    opts = opts || {};
    var root = document.getElementById('toast-root');
    var el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    var actionHTML = opts.actionLabel
      ? '<button type="button" class="toast-action">' + esc(opts.actionLabel) + '</button>'
      : '';
    el.innerHTML = '<span>' + esc(message) + '</span>' + actionHTML;
    root.appendChild(el);
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      if (el.parentNode) el.parentNode.removeChild(el);
      if (opts.onClose) opts.onClose();
    }
    var timer = setTimeout(close, opts.duration || (opts.actionLabel ? 8000 : 3500));
    if (opts.actionLabel) {
      el.querySelector('.toast-action').addEventListener('click', function () {
        close();
        if (opts.onAction) opts.onAction();
      });
    }
    return { close: close };
  }

  /* ------------------------------------------------------------------
   * 二次确认弹窗（焦点圈定 + Esc 取消）
   * ------------------------------------------------------------------ */
  function showConfirmModal(opts) {
    var root = document.getElementById('modal-root');
    root.innerHTML =
      '<div class="modal-overlay">' +
      '<div class="modal" role="dialog" aria-modal="true" aria-label="' + esc(opts.title) + '">' +
      '<div class="modal-title">' + esc(opts.title) + '</div>' +
      '<div class="modal-body">' + esc(opts.body) + '</div>' +
      '<div class="modal-actions">' +
      '<button type="button" class="btn btn-ghost-modal" data-modal="cancel">' + esc(opts.cancelLabel || '取消') + '</button>' +
      '<button type="button" class="btn btn-primary" data-modal="confirm">' + esc(opts.confirmLabel || '确定') + '</button>' +
      '</div></div></div>';
    var overlay = root.querySelector('.modal-overlay');
    var cancelBtn = root.querySelector('[data-modal="cancel"]');
    var confirmBtn = root.querySelector('[data-modal="confirm"]');

    function close() { root.innerHTML = ''; document.removeEventListener('keydown', onKeydown, true); }
    function onCancel() { close(); if (opts.onCancel) opts.onCancel(); }
    function onConfirm() { close(); if (opts.onConfirm) opts.onConfirm(); }
    function onKeydown(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel(); return; }
      if (e.key === 'Tab') {
        // 焦点圈定在弹窗内
        if (document.activeElement === confirmBtn && !e.shiftKey) { e.preventDefault(); cancelBtn.focus(); }
        else if (document.activeElement === cancelBtn && e.shiftKey) { e.preventDefault(); confirmBtn.focus(); }
      }
    }
    cancelBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    document.addEventListener('keydown', onKeydown, true);
    cancelBtn.focus();
    return { close: close };
  }

  /* ------------------------------------------------------------------
   * 03：项目画像面板（Figma 334:258 View=Project portrait；业务字段与交互继承 V9）
   *
   * 映射层（V9 字段键 → 本 Demo 草稿键）：
   *   平台 platform（只读）· 目标国家／地区 region{selected:[]}（结构化代码）
   *   brand / product / coreValue / targetUser→targetUsers / useScene→usageScenarios / goal→marketingGoal
   *   画像 persona: creator→target / theme→topics / preference / audience / must / exclude→avoid
   * 控件沿用 V9：field-row = 标签列 + 主列（阅读 body + meta pill/操作）；
   *   编辑态为单行 input 或 textarea，完成／取消成对出现，不额外弹确认。
   * ------------------------------------------------------------------ */
  var V9_CFIELDS = [
    { key: 'brand', label: '品牌', kind: 'text' },
    { key: 'product', label: '产品／服务', kind: 'text' },
    { key: 'coreValue', label: '核心功能与价值', kind: 'area' },
    { key: 'targetUsers', label: '产品目标用户', kind: 'area' },
    { key: 'usageScenarios', label: '产品使用场景', kind: 'area' },
    { key: 'marketingGoal', label: '推广目标', kind: 'area' }
  ];
  var V9_PFIELDS = [
    { key: 'target', label: '目标达人', kind: 'area', required: true, ph: '例如：分享临床工作、医疗效率内容的医生创作者' },
    { key: 'topics', label: '内容主题', kind: 'area', ph: '补充内容主题' },
    { key: 'preference', label: '内容偏好', kind: 'area', ph: '例如：真实自然、专业可信、生活化、测评、教程或场景展示' },
    { key: 'audience', label: '期望影响人群', kind: 'area', ph: '补充期望影响人群' },
    { key: 'must', label: '一定要符合', kind: 'area', ph: '例如：具有明确的医生或临床从业身份' },
    { key: 'avoid', label: '不希望出现', kind: 'area', ph: '例如：纯机构宣传账号、内容搬运账号' }
  ];

  function countryName(code) {
    return (Fixtures.countryMap && Fixtures.countryMap[code]) || code;
  }

  function pillHTML(source, missing) {
    if (missing) return '<span class="pp-pill is-missing">需要补充</span>';
    if (!source) return '';
    return '<span class="pp-pill' + (source === '手动修改' ? ' is-manual' : '') + '">' + esc(source) + '</span>';
  }

  /** V9 field-row：阅读态。长文本自然换行；locked（平台）只展示，不给编辑入口。 */
  function readingRowHTML(def, value, source, kp) {
    if (def.kind === 'locked') {
      return '<div class="pp-field-body is-set">' + esc(value) + '</div>' +
        '<div class="pp-field-meta">' + pillHTML(source) + '</div>';
    }
    var isSet = !!String(value || '').trim();
    var cls = 'pp-field-body' + (isSet ? ' is-set' : ' is-unset') + (def.kind === 'area' ? ' is-area' : '');
    var act = isSet ? '修改' : '补充';
    return '<div class="' + cls + '" data-action="edit-field" data-frow="' + esc(kp) + '">' +
      (isSet ? esc(value) : esc(def.unsetLabel || '未设置')) + '</div>' +
      '<div class="pp-field-meta">' + pillHTML(isSet ? source : null, !isSet && def.required) +
      '<span class="pp-row-actions">' +
      '<button type="button" class="pp-act" data-action="edit-field" data-frow="' + esc(kp) + '">' + act + '</button>' +
      '</span></div>';
  }

  /** V9 field-row：编辑态（V9 editor + editorActions）。 */
  function editingRowHTML(def, value, source) {
    var ph = esc(def.ph || (def.required ? '请填写' : '补充') + def.label);
    var control = def.kind === 'area'
      ? '<textarea class="pp-field-edit" data-role="field-editor" rows="3" placeholder="' + ph + '" aria-label="' + esc(def.label) + '">' + esc(value) + '</textarea>'
      : '<input class="pp-field-edit" data-role="field-editor" type="text" value="' + esc(value) + '" placeholder="' + ph + '" aria-label="' + esc(def.label) + '">';
    return control +
      (def.required ? '<div class="pp-edit-hint"' + (String(value || '').trim() ? ' hidden' : '') + '>目标达人为启动必填</div>' : '') +
      '<div class="pp-field-meta">' + pillHTML(source) +
      '<span class="pp-row-actions">' +
      '<button type="button" class="pp-act is-primary" data-action="commit-field"' +
      (def.required && !String(value || '').trim() ? ' disabled' : '') + '>完成</button>' +
      '<button type="button" class="pp-act is-plain" data-action="cancel-edit">取消</button>' +
      '</span></div>';
  }

  function fieldRowHTML(kp, def, value, source, error, isEditing, view, extraClass) {
    var mainCls = 'pp-field-main' + (isEditing ? ' is-editing' : '');
    return '<div class="pp-field' + (extraClass ? ' ' + extraClass : '') + '" data-frow="' + esc(kp) + '">' +
      '<div class="pp-field-label">' + esc(def.label) + (def.required ? ' <span class="req">*</span>' : '') + '</div>' +
      '<div class="' + mainCls + '">' +
      (isEditing && !view ? editingRowHTML(def, value, source) : readingRowHTML(def, value, source, kp)) +
      (error ? '<div class="pp-field-error">' + esc(error) + '</div>' : '') +
      '</div></div>';
  }

  /** 目标国家／地区：V9 region 行（chips + select + 添加；至少一项才可进入命名）。 */
  function regionRowHTML(region, error, editing, view) {
    var selected = (region && region.selected) || [];
    var source = region && region.source;
    var isEditing = !!editing;
    var shown = isEditing && editing.temp ? editing.temp : selected;
    var mainCls = 'pp-field-main' + (isEditing ? ' is-editing' : '');
    var body;
    if (isEditing && !view) {
      var chips = shown.map(function (code) {
        return '<span class="pp-chip">' + esc(countryName(code)) +
          '<button type="button" data-action="remove-region" data-code="' + esc(code) + '" aria-label="移除' + esc(countryName(code)) + '">×</button></span>';
      }).join('');
      var options = (Fixtures.countryList || []).map(function (item) {
        var dup = shown.indexOf(item[0]) !== -1;
        return '<option value="' + esc(item[0]) + '"' + (dup ? ' disabled' : '') + '>' + esc(item[1]) + '</option>';
      }).join('');
      body = '<div class="pp-region-body">' +
        (chips ? '<div class="pp-chips">' + chips + '</div>' : '') +
        '<div class="pp-region-controls">' +
        '<select data-role="region-picker" aria-label="添加国家或地区"><option value="">选择国家或地区</option>' + options + '</select>' +
        '<button type="button" class="pp-region-add" data-action="add-region">添加</button>' +
        '</div></div>' +
        '<div class="pp-field-meta">' + pillHTML(source) +
        '<span class="pp-row-actions">' +
        '<button type="button" class="pp-act is-primary" data-action="commit-region"' + (shown.length ? '' : ' disabled') + '>完成</button>' +
        '<button type="button" class="pp-act is-plain" data-action="cancel-edit">取消</button>' +
        '</span></div>';
    } else if (selected.length) {
      body = '<div class="pp-region-body"><div class="pp-chips">' + selected.map(function (code) {
        return '<span class="pp-chip">' + esc(countryName(code)) + '</span>';
      }).join('') + '</div></div>' +
        '<div class="pp-field-meta">' + pillHTML(source) +
        '<span class="pp-row-actions">' +
        '<button type="button" class="pp-act" data-action="edit-region">' + (view ? '查看' : '修改') + '</button>' +
        '</span></div>';
    } else {
      body = '<div class="pp-field-body is-unset" data-action="edit-region">未选择</div>' +
        '<div class="pp-field-meta">' + pillHTML(null, true) +
        '<span class="pp-row-actions"><button type="button" class="pp-act" data-action="edit-region">补充</button></span></div>';
    }
    return '<div class="pp-field" data-frow="region">' +
      '<div class="pp-field-label">目标国家／地区 <span class="req">*</span></div>' +
      '<div class="' + mainCls + '">' + body +
      (error ? '<div class="pp-field-error">' + esc(error) + '</div>' : '') +
      '</div></div>';
  }

  function personaCardHTML(persona, errors, editing, view, canDelete) {
    var h = '<div class="pp-persona" data-persona-id="' + esc(persona.id) + '">';
    h += '<div class="pp-persona-head">';
    h += '<div class="pp-persona-title-block">';
    if (editing && editing.kind === 'name' && editing.personaId === persona.id && !view) {
      h += '<input class="pp-persona-name-input" data-role="name-editor" type="text" value="' + esc(persona.name) +
        '" aria-label="画像名称" placeholder="新目标画像">';
    } else {
      var hasName = !!String(persona.name || '').trim();
      h += '<span class="pp-persona-name-text' + (hasName ? '' : ' is-placeholder') + '"' +
        (view ? '' : ' data-action="edit-name" data-persona-id="' + esc(persona.id) + '"') + '>' +
        esc(hasName ? persona.name : '新目标画像') + '</span>';
    }
    h += '<div class="pp-persona-head-hint">画像短名称' + (view ? '' : ' · 点击可编辑') + '</div>';
    h += '</div>';
    h += '<div class="pp-persona-head-actions">';
    if (editing && editing.kind === 'name' && editing.personaId === persona.id && !view) {
      h += '<button type="button" class="pp-act is-primary" data-action="commit-name">完成</button>';
      h += '<button type="button" class="pp-act is-plain" data-action="cancel-edit">取消</button>';
    } else if (!view) {
      h += '<button type="button" class="pp-act" data-action="edit-name" data-persona-id="' + esc(persona.id) + '">修改名称</button>';
      h += '<button type="button" class="pp-persona-delete' + (canDelete ? '' : ' is-disabled') +
        '" data-action="remove-persona" data-persona-id="' + esc(persona.id) + '">删除</button>';
    }
    h += '</div></div>';
    h += '<div class="pp-persona-fields">';
    V9_PFIELDS.forEach(function (def) {
      if (def.key === 'must') h += '<div class="pp-sub-label">筛选条件</div>';
      var kp = 'persona:' + persona.id + ':' + def.key;
      var isEditing = !!(editing && editing.kind === 'field' && editing.kp === kp);
      var source = persona.meta && persona.meta[def.key] ? persona.meta[def.key].source : '';
      var extra = def.key === 'target' ? 'pp-field--creator pp-field--full' : '';
      h += fieldRowHTML(kp, def, persona[def.key], source, errors[kp], isEditing, view, extra);
    });
    h += '</div></div>';
    return h;
  }

  /** 与 V9 一样先在草稿卡填写，再一次性加入画像列表。 */
  function draftPersonaHTML(draft) {
    var h = '<div class="pp-persona pp-draft-card">' +
      '<div class="pp-persona-head"><div class="pp-persona-title-block">' +
      '<div class="pp-persona-name-text">新目标画像</div>' +
      '<div class="pp-persona-head-hint">填写完成后添加到画像列表</div></div></div>' +
      '<div class="pp-persona-fields">' +
      '<div class="pp-field"><div class="pp-field-label">画像名称</div><div class="pp-field-main">' +
      '<input class="pp-field-edit" data-role="draft-field" data-key="name" type="text" placeholder="留空则自动命名" value="' + esc(draft.name || '') + '"></div></div>';
    V9_PFIELDS.forEach(function (def) {
      if (def.key === 'must') h += '<div class="pp-sub-label">筛选条件</div>';
      h += '<div class="pp-field"><div class="pp-field-label">' + esc(def.label) +
        (def.required ? ' <span class="req">*</span>' : '') + '</div><div class="pp-field-main">' +
        '<textarea class="pp-field-edit" data-role="draft-field" data-key="' + esc(def.key) +
        '" rows="3" placeholder="' + esc(def.ph || (def.required ? '请填写' : '补充') + def.label) + '">' +
        esc(draft[def.key] || '') + '</textarea>' +
        (def.required ? '<div class="pp-edit-hint"' + (String(draft.target || '').trim() ? ' hidden' : '') + '>目标达人为启动必填</div>' : '') +
        '</div></div>';
    });
    return h + '</div><div class="pp-draft-actions">' +
      '<button type="button" class="pp-act is-plain" data-action="cancel-add-persona">取消</button>' +
      '<button type="button" class="pp-act is-primary" data-action="complete-add-persona"' +
      (String(draft.target || '').trim() ? '' : ' disabled') + '>完成添加</button></div></div>';
  }

  /**
   * 渲染画像面板。
   * editing：{ kind:'field', kp } | { kind:'region' } | { kind:'name', personaId } | null
   * 编辑/阅读切换由调用方持有（不落盘），编辑值直接写入共享草稿。
   */
  function renderPortraitPanel(store, conv, errors, mode, editing, addDraft) {
    errors = errors || {};
    mode = mode || 'edit';
    editing = editing || null;
    var view = mode === 'view'; // 创建后：只读查看已确认画像
    var portrait = conv.portrait;
    if (!portrait) return '';
    var region = portrait.region || { selected: [], source: '' };
    var missing = [];
    if (!region.selected.length) missing.push('目标国家／地区');
    portrait.personas.forEach(function (p, i) {
      if (!String(p.target || '').trim()) missing.push('第 ' + (i + 1) + ' 张画像的目标达人');
    });

    var h = '';
    h += '<div class="portrait-panel' + (view ? ' is-view' : '') + '" data-mode="' + mode + '">';
    h += '<div class="pp-header"><div class="pp-header-content">' +
      '<div class="pp-title">' + (view ? '项目画像' : '确认并完善项目画像') + '</div>' +
      '<div class="pp-sub">' + (view ? '达人筛选标准 · 已保存' : '确认 Agent 整理的内容，可继续补充达人要求') + '</div>' +
      '</div>' +
      '<button type="button" class="pp-close" data-action="close-portrait" aria-label="关闭画像面板">×</button>' +
      '</div>';
    h += '<div class="pp-scroll" data-role="pp-scroll"><div class="pp-content">';

    // 基础找人（V9 renderBasic）
    h += '<div class="pp-group">';
    h += '<div class="pp-group-head"><div><div class="pp-group-title">基础找人</div>' +
      '<div class="pp-group-hint">启动必填：目标国家／地区</div></div>' +
      '<span class="pp-section-tag">启动必填</span></div>';
    h += fieldRowHTML('common:platform', { label: '平台', kind: 'locked' }, 'Instagram', '入口确定 · 只读', '', false, true);
    h += regionRowHTML(region, errors['portrait.region'], editing && editing.kind === 'region' ? editing : null, view);
    h += '</div>';

    // 产品与营销背景（V9 renderProduct）
    h += '<div class="pp-group">';
    h += '<div class="pp-group-head"><div><div class="pp-group-title">产品与营销背景</div>' +
      '<div class="pp-group-hint">全部可选，不阻止创建项目</div></div>' +
      '<span class="pp-section-tag">全部选填</span></div>';
    V9_CFIELDS.forEach(function (def) {
      var kp = 'common:' + def.key;
      var isEditing = !!(editing && editing.kind === 'field' && editing.kp === kp);
      var meta = portrait.fieldMeta[def.key];
      h += fieldRowHTML(kp, def, portrait.fields[def.key], meta ? meta.source : '',
        errors['portrait.' + def.key], isEditing, view);
    });
    h += '</div>';

    // 目标达人画像（V9 renderPortraits）
    h += '<div class="pp-personas-label"><div class="pp-group-title">目标达人画像</div>' +
      '<span class="pp-small">每个画像是一组独立的达人要求</span>' +
      '<span class="pp-section-tag">至少 1 张</span></div>';
    var canDelete = portrait.personas.length > 1;
    portrait.personas.forEach(function (persona) {
      h += personaCardHTML(persona, errors, editing, view, canDelete);
    });
    if (addDraft && !view) h += draftPersonaHTML(addDraft);
    if (!view) {
      h += '<button type="button" class="pp-add-persona" data-action="add-persona"' +
        (addDraft ? ' hidden' : '') + '>＋ 新增目标达人画像</button>';
    }
    h += '</div></div>';

    h += '<div class="pp-footer"><div class="pp-footer-inner">';
    if (view) {
      h += '<div class="pp-footer-hint">画像已确认 · 初始版本 v1（项目创建时保存）</div>';
    } else {
      h += '<div class="pp-footer-hint">' +
        (editing || addDraft ? '请先完成当前编辑' :
          (missing.length ? '还需补充启动必填：' + esc(missing.join('、')) : '启动必填已齐全，其余信息可稍后完善')) +
        '</div>' +
        '<button type="button" class="pp-confirm" data-action="confirm-portrait"' +
        (editing || addDraft ? ' disabled' : '') + '>确认画像并创建项目</button>';
    }
    h += '</div></div></div>';
    return h;
  }

  /* ------------------------------------------------------------------
   * 04：命名弹窗（520 宽，覆盖在 03 之上；状态：默认 / 名称为空 / 创建中 / 创建失败）
   * ------------------------------------------------------------------ */
  function showNamingModal(opts) {
    var root = document.getElementById('modal-root');
    root.innerHTML =
      '<div class="modal-overlay naming-overlay">' +
      '<div class="naming-modal" role="dialog" aria-modal="true" aria-label="确认项目名称">' +
      '<div class="nm-header"><div class="nm-title">确认项目名称</div>' +
      '<button type="button" class="nm-close" data-modal="close" aria-label="关闭">×</button></div>' +
      '<div class="nm-body">' +
      '<div class="nm-label-row"><span class="nm-label">项目名称</span><span class="nm-star">*</span></div>' +
      '<input class="nm-input" type="text" value="' + esc(opts.initialName || '') + '" placeholder="请输入项目名称" aria-label="项目名称">' +
      '<div class="nm-error" hidden></div>' +
      '</div>' +
      '<div class="nm-footer">' +
      '<button type="button" class="btn btn-ghost-modal nm-cancel" data-modal="cancel">取消</button>' +
      '<button type="button" class="btn btn-primary nm-confirm" data-modal="confirm">创建项目</button>' +
      '</div></div></div>';

    var overlay = root.querySelector('.naming-overlay');
    var input = root.querySelector('.nm-input');
    var errorBox = root.querySelector('.nm-error');
    var confirmBtn = root.querySelector('.nm-confirm');
    var cancelBtn = root.querySelector('.nm-cancel');
    var closeBtn = root.querySelector('.nm-close');
    var closed = false;
    var submitting = false;

    function close() {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKeydown, true);
      root.innerHTML = '';
    }
    function setLocked(locked) {
      submitting = locked;
      confirmBtn.textContent = locked ? '创建中…' : '创建项目';
      confirmBtn.disabled = locked;
      cancelBtn.disabled = locked;
      closeBtn.disabled = locked;
      input.disabled = locked;
    }
    function showError(msg) {
      errorBox.hidden = false;
      errorBox.textContent = msg;
      input.classList.add('is-error');
    }
    function clearError() {
      errorBox.hidden = true;
      errorBox.textContent = '';
      input.classList.remove('is-error');
    }
    function onCancel() {
      if (submitting) return; // 提交中锁定弹窗操作
      close();
      if (opts.onCancel) opts.onCancel();
    }
    function onConfirm() {
      if (submitting) return;
      clearError();
      var name = input.value.trim();
      if (!name) {
        showError('请输入项目名称'); // 名称为空就近报错，不提交
        input.focus();
        return;
      }
      if (opts.onConfirm) opts.onConfirm(name);
    }
    function onKeydown(e) {
      if (e.key === 'Escape') {
        if (submitting) { e.preventDefault(); return; } // 创建中不允许 Esc
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && document.activeElement === input) {
        e.preventDefault();
        onConfirm();
        return;
      }
      if (e.key === 'Tab') {
        var focusables = [input, cancelBtn, confirmBtn].filter(function (b) { return !b.disabled; });
        var first = focusables[0], last = focusables[focusables.length - 1];
        if (!first) { e.preventDefault(); return; }
        if (document.activeElement === last && !e.shiftKey) { e.preventDefault(); first.focus(); }
        else if (document.activeElement === first && e.shiftKey) { e.preventDefault(); last.focus(); }
      }
    }
    cancelBtn.addEventListener('click', onCancel);
    closeBtn.addEventListener('click', onCancel);
    confirmBtn.addEventListener('click', onConfirm);
    input.addEventListener('input', clearError);
    // 取消/关闭也要保留用户已填名称（回 03 再打开不丢失）
    if (opts.onInput) input.addEventListener('input', function () { opts.onInput(input.value); });
    document.addEventListener('keydown', onKeydown, true);
    input.focus();
    input.select();
    return {
      close: close,
      setLocked: setLocked,
      showError: showError,
      clearError: clearError,
      getName: function () { return input.value.trim(); }
    };
  }

  /* ------------------------------------------------------------------
   * 内联小图标（非品牌资产，仅交互指示符）
   * ------------------------------------------------------------------ */
  var ICONS = {
    chevronUp: '<svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true"><path d="M2.5 8L6 4.5L9.5 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    arrowDown: '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 3.5V12M8 12L4.5 8.5M8 12L11.5 8.5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>'
  };

  global.UI = {
    setAssetBase: function (base) { assetBase = base; },
    esc: esc,
    ICONS: ICONS,
    computePopoverModel: computePopoverModel,
    popoverAccountHTML: popoverAccountHTML,
    updatePopoverSpace: updatePopoverSpace,
    attachSwitchHint: attachSwitchHint,
    renderSidebar: renderSidebar,
    renderTopbar: renderTopbar,
    renderConversation: renderConversation,
    renderPortraitPanel: renderPortraitPanel,
    showNamingModal: showNamingModal,
    updateSendState: updateSendState,
    setComposerSending: setComposerSending,
    showComposerError: showComposerError,
    clearComposerError: clearComposerError,
    refreshComposerMaterials: refreshComposerMaterials,
    resizeComposer: resizeComposer,
    showToast: showToast,
    showConfirmModal: showConfirmModal
  };
})(window);
