/*
 * Creator Scout 独立首页原型 · 浏览器内自动测试
 * 运行方式：直接打开 tests/tests.html（file:// 可用），结果逐条列出。
 * 测试均为本地演示逻辑与 DOM 结构断言，不宣称真实服务链路通过。
 */
(function (global) {
  'use strict';

  var Fixtures = global.Fixtures;
  var Store = global.Store;
  var UI = global.UI;
  UI.setAssetBase('../assets/');

  var TEAM = 'sp-team-northstar';
  var PERSONAL = 'sp-personal-lin';
  var BLANK = Fixtures.BLANK_DRAFT_ID;

  // ---------------- 断言与运行器 ----------------
  var results = [];
  function assert(cond, msg) { if (!cond) throw new Error(msg || '断言失败'); }
  function assertEqual(actual, expected, msg) {
    if (actual !== expected) throw new Error((msg || '不相等') + '：期望 ' + JSON.stringify(expected) + '，实际 ' + JSON.stringify(actual));
  }

  function memoryStorage() {
    var data = {};
    return {
      shouldFail: false,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { if (this.shouldFail) throw new Error('模拟写入失败'); data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      _data: data
    };
  }

  function mountPopover(model) {
    var mount = document.getElementById('dom-mount');
    mount.innerHTML = '<div class="account-popover">' + UI.popoverAccountHTML(model, {}) + '</div>';
    return mount.querySelector('.account-popover');
  }
  function menuLabels(pop) {
    return Array.prototype.map.call(pop.querySelectorAll('.pop-menu'), function (group) {
      return Array.prototype.map.call(group.querySelectorAll('.pop-menu-item > span:first-of-type'), function (s) { return s.textContent; });
    });
  }

  var tests = [];

  function test(name, fn) { tests.push({ name: name, fn: fn }); }

  // ================================================================
  // 1. 账户浮窗四态（含管理员）显隐与顺序矩阵
  // ================================================================
  Fixtures.popoverTestFixtures.forEach(function (fx) {
    test('浮窗矩阵 · ' + fx.description, function () {
      var model = UI.computePopoverModel(fx);
      var pop = mountPopover(model);

      // 账号信息：四态一致，不随空间变化
      assertEqual(pop.querySelector('.pop-name').textContent, '林小满', '昵称应为账号级');
      assertEqual(pop.querySelector('.pop-email').textContent, 'xiaoman.lin@example.com', '注册邮箱应为账号级');
      assertEqual(pop.querySelector('.pop-avatar').textContent, '满', '头像初始字');

      var groups = menuLabels(pop);
      var hasSpaceSection = !!pop.querySelector('.pop-space');
      var hasSwitch = !!pop.querySelector('.switch-btn');
      var spaceName = pop.querySelector('.space-name');
      var roleText = pop.querySelector('.space-role');
      var tagText = pop.querySelector('.tag-space');

      if (fx.key === 'creator-default') {
        assert(hasSpaceSection, '创建者应有空间区');
        assert(hasSwitch, '创建者应有切换按钮');
        assertEqual(spaceName.textContent, 'Northstar Studio', '团队空间名称');
        assertEqual(tagText.textContent, '团队空间', '空间标签');
        assertEqual(roleText.textContent, '创建者', '身份文字');
        assertEqual(groups[0].join(','), '用量与计费,团队管理,业务邮箱', '空间功能顺序');
        assert(!groups[0].includes('开启团队协作'), '已有团队不应出现开启团队协作');
      } else if (fx.key === 'personal-with-team') {
        assert(hasSpaceSection, '已有团队的个人空间应显示空间区');
        assert(hasSwitch, '应有切换按钮');
        assertEqual(spaceName.textContent, '个人空间', '个人空间名称');
        assert(!tagText, '个人空间不应显示团队空间标签');
        assert(!roleText, '个人空间不应显示团队身份');
        assertEqual(groups[0].join(','), '用量与计费,业务邮箱', '空间功能顺序');
        assert(!groups[0].includes('团队管理'), '个人空间不应显示团队管理');
        assert(!groups[0].includes('开启团队协作'), '已有团队不应出现开启团队协作');
      } else if (fx.key === 'personal-no-team') {
        assert(!hasSpaceSection, '无团队应整区隐藏空间区');
        assert(!hasSwitch, '无团队不应有切换按钮');
        assert(!pop.querySelector('.space-icon'), '无团队不应有空间图标');
        assertEqual(groups[0].join(','), '用量与计费,业务邮箱,开启团队协作', '空间功能顺序');
        // 账号信息后紧跟分隔线，不留 76px 占位
        var secondChild = pop.children[1];
        assert(secondChild && secondChild.classList.contains('pop-divider'), '无团队：账号区后应直接是分隔线');
      } else if (fx.key === 'team-member') {
        assert(hasSpaceSection, '普通成员应有空间区');
        assert(hasSwitch, '普通成员应有切换按钮');
        assertEqual(roleText.textContent, '普通成员', '身份文字');
        assertEqual(groups[0].join(','), '用量与计费,业务邮箱', '普通成员无团队管理');
        assert(!groups[0].includes('团队管理'), '普通成员不应显示团队管理');
      } else if (fx.key === 'team-admin') {
        assert(hasSpaceSection, '管理员复用创建者布局');
        assert(hasSwitch, '管理员应有切换按钮');
        assertEqual(roleText.textContent, '管理员', '身份显示实际管理员');
        assertEqual(groups[0].join(','), '用量与计费,团队管理,业务邮箱', '管理员可见团队管理');
      }

      // 账号功能与退出登录：全部状态一致；未读数来自 fixture
      assertEqual(groups[1].join(','), '通知,个人设置', '账号功能顺序');
      assertEqual(groups[2].join(','), '退出登录', '退出登录独立分组');
      assertEqual(pop.querySelector('.badge-unread').textContent, '3', '未读数来自 fixture');
      assertEqual(pop.querySelectorAll('.pop-divider').length, 3, '分隔线数量');
    });
  });

  // ================================================================
  // 2. 空间数据隔离：切换后项目 / 最近会话实际变化
  // ================================================================
  test('空间数据隔离：项目与最近会话随空间切换', function () {
    var store = Store.create({ storage: memoryStorage() });
    assertEqual(store.getState().currentSpaceId, TEAM, '默认团队空间');
    var teamSpace = store.getCurrentSpace();
    assertEqual(teamSpace.projects.map(function (p) { return p.name; }).join(','), 'Aurora Skincare,TrailBrew Outdoor', '团队项目');
    assertEqual(teamSpace.conversations.length, 2, '团队最近会话数');

    return store.switchSpace(PERSONAL).then(function (r) {
      assert(r.ok, '切换成功');
      var personal = store.getCurrentSpace();
      assertEqual(personal.id, PERSONAL, '当前空间为个人空间');
      assertEqual(personal.projects.map(function (p) { return p.name; }).join(','), 'PetPal Essentials,HomeCafe Lab', '个人项目与团队不同');
      assertEqual(personal.conversations.map(function (c) { return c.displayTitle; }).join(','), 'PetPal Essentials,HomeCafe Lab', '个人最近会话与团队不同');
      // 无跨空间残留
      var names = personal.projects.concat(personal.conversations).map(function (x) { return x.name || x.displayTitle; });
      names.forEach(function (n) {
        assert(['Aurora Skincare', 'TrailBrew Outdoor', 'conv-team-aurora', 'conv-team-trailbrew'].indexOf(n) === -1, '个人空间不应出现团队数据：' + n);
      });
    });
  });

  // ================================================================
  // 3. 账号信息不随空间变化
  // ================================================================
  test('账号信息不随空间切换', function () {
    var store = Store.create({ storage: memoryStorage() });
    var before = { name: store.getAccount().name, email: store.getAccount().email, initial: store.getAccount().avatarInitial };
    return store.switchSpace(PERSONAL).then(function () {
      assertEqual(store.getAccount().name, before.name, '昵称不变');
      assertEqual(store.getAccount().email, before.email, '邮箱不变');
      assertEqual(store.getAccount().avatarInitial, before.initial, '头像不变');
    });
  });

  // ================================================================
  // 4. 草稿按空间 + 会话隔离，切换与“刷新”后恢复
  // ================================================================
  test('草稿隔离与恢复（含模拟刷新）', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    var teamConv = 'conv-team-aurora';
    var personalConv = 'conv-personal-petpal';
    var store2;

    store.setDraft(TEAM, teamConv, '团队会话的未发送输入');
    store.setDraft(TEAM, BLANK, '团队空白会话草稿');
    store.setDraft(PERSONAL, personalConv, '个人会话的未发送输入');
    store.setDraft(PERSONAL, BLANK, '个人空白会话草稿');

    return store.flushDrafts().then(function () {
      // 模拟刷新：用同一存储新建 store
      store2 = Store.create({ storage: storage });
      assertEqual(store2.getDraft(TEAM, teamConv), '团队会话的未发送输入', '刷新后团队会话草稿恢复');
      assertEqual(store2.getDraft(TEAM, BLANK), '团队空白会话草稿', '刷新后团队空白草稿恢复');
      assertEqual(store2.getDraft(PERSONAL, personalConv), '个人会话的未发送输入', '刷新后个人会话草稿恢复');
      assertEqual(store2.getDraft(PERSONAL, BLANK), '个人空白会话草稿', '刷新后个人空白草稿恢复');
      // 切换往返后草稿仍按空间隔离
      return store2.switchSpace(PERSONAL);
    }).then(function (r) {
      assert(r.ok, '切到个人空间');
      assertEqual(store2.getDraft(PERSONAL, personalConv), '个人会话的未发送输入', '个人空间读取个人草稿');
      assertEqual(store2.getDraft(TEAM, teamConv), '团队会话的未发送输入', '团队草稿仍在原空间，未迁移');
      return store2.switchSpace(TEAM);
    }).then(function (r) {
      assert(r.ok, '切回团队空间');
      assertEqual(store2.getDraft(TEAM, teamConv), '团队会话的未发送输入', '往返后团队草稿恢复');
    });
  });

  // ================================================================
  // 5. 首次进入目标空间显示空白首页；再次进入恢复会话位置
  // ================================================================
  test('首次进入空白、再次进入恢复会话位置', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    assertEqual(store.getActiveConversationId(PERSONAL), null, '个人空间初始无打开会话');

    return store.switchSpace(PERSONAL).then(function (r) {
      assert(r.ok, '首次进入个人空间');
      assertEqual(store.getActiveConversationId(PERSONAL), null, '首次进入显示空白首页');
      store.openConversation('conv-personal-homecafe');
      store.setDraft(PERSONAL, 'conv-personal-homecafe', '输入一半的内容');
      return store.switchSpace(TEAM);
    }).then(function (r) {
      assert(r.ok, '切回团队');
      assertEqual(store.getActiveConversationId(TEAM), null, '团队空间自身仍为空白');
      return store.switchSpace(PERSONAL);
    }).then(function (r) {
      assert(r.ok, '再次进入个人空间');
      assertEqual(store.getActiveConversationId(PERSONAL), 'conv-personal-homecafe', '恢复上次会话位置');
      assertEqual(store.getDraft(PERSONAL, 'conv-personal-homecafe'), '输入一半的内容', '恢复未发送输入');
    });
  });

  // ================================================================
  // 6. 选择当前空间不清空数据
  // ================================================================
  test('选择当前空间不清空首页与输入', function () {
    var store = Store.create({ storage: memoryStorage() });
    store.openConversation('conv-team-trailbrew');
    store.setDraft(TEAM, 'conv-team-trailbrew', '保留这些字');
    return store.switchSpace(TEAM).then(function (r) {
      assert(r.ok && r.noop, '选择当前空间应为空操作');
      assertEqual(store.getActiveConversationId(TEAM), 'conv-team-trailbrew', '会话位置不变');
      assertEqual(store.getDraft(TEAM, 'conv-team-trailbrew'), '保留这些字', '输入不变');
    });
  });

  // ================================================================
  // 7. 快速重复切换 / 旧响应晚到不串空间（序号守卫）
  // ================================================================
  test('旧空间的延迟响应不能覆盖新空间', function () {
    var store = Store.create({ storage: memoryStorage() });
    // 场景：先发起 慢的 team→personal（seq1），随后立刻发起 快的 personal→team（seq2）。
    // seq2 先完成并提交；seq1 的延迟响应到达后必须按 stale 忽略。
    store.__setTransport(function (target, seq) {
      if (seq === 1) return new Promise(function (resolve) { setTimeout(function () { resolve({ spaceId: target, seq: seq }); }, 150); });
      return new Promise(function (resolve) { setTimeout(function () { resolve({ spaceId: target, seq: seq }); }, 10); });
    });
    var p1 = store.switchSpace(PERSONAL); // seq1 慢
    var p2 = store.switchSpace(TEAM);     // seq2 快（切回当前空间，但切换中允许发起新意图）
    return Promise.all([p1, p2]).then(function (rs) {
      assert(rs[1].ok, '最新请求成功提交');
      assert(rs[0].stale, '旧请求应被标记为 stale');
      assertEqual(store.getState().currentSpaceId, TEAM, '旧响应晚到不得把空间改回个人空间');
      store.__resetTransport();
    });
  });

  test('快速连续两次有效切换按顺序提交', function () {
    var store = Store.create({ storage: memoryStorage() });
    return store.switchSpace(PERSONAL).then(function (r1) {
      assert(r1.ok, '第一次切换成功');
      return store.switchSpace(TEAM);
    }).then(function (r2) {
      assert(r2.ok, '第二次切换成功');
      assertEqual(store.getState().currentSpaceId, TEAM, '最终空间为团队');
    });
  });

  // ================================================================
  // 8. 切换失败：保留原空间与输入，重试可成功
  // ================================================================
  test('切换失败保留原空间与输入，可重试', function () {
    var store = Store.create({ storage: memoryStorage() });
    store.setDraft(TEAM, 'conv-team-aurora', '失败期间不能丢的输入');
    store.__setTransport(function () { return Promise.reject(new Error('模拟加载失败')); });

    return store.switchSpace(PERSONAL).then(function (r) {
      assert(!r.ok && r.reason === 'error', '切换失败');
      assertEqual(store.getState().currentSpaceId, TEAM, '失败后保留原空间');
      assertEqual(store.getDraft(TEAM, 'conv-team-aurora'), '失败期间不能丢的输入', '失败后输入保留');
      assertEqual(store.isSwitching(), false, '失败后解除锁定');
      // 重试
      store.__resetTransport();
      return store.switchSpace(PERSONAL);
    }).then(function (r2) {
      assert(r2.ok, '重试成功');
      assertEqual(store.getState().currentSpaceId, PERSONAL, '重试后进入个人空间');
    });
  });

  // ================================================================
  // 9. 草稿落盘失败：阻止切换并保留输入
  // ================================================================
  test('草稿落盘失败阻止切换', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    store.setDraft(TEAM, BLANK, '还没来得及保存的输入');
    storage.shouldFail = true; // 模拟存储写入失败

    return store.switchSpace(PERSONAL).then(function (r) {
      assert(!r.ok, '落盘失败应阻止切换');
      assertEqual(store.getState().currentSpaceId, TEAM, '仍停留在原空间');
      assertEqual(store.getDraft(TEAM, BLANK), '还没来得及保存的输入', '内存中的输入保留');
      storage.shouldFail = false;
      return store.switchSpace(PERSONAL); // 恢复后重试
    }).then(function (r2) {
      assert(r2.ok, '存储恢复后切换成功');
    });
  });

  // ================================================================
  // 10. 损坏存储安全默认（不混空间、不崩溃）
  // ================================================================
  test('损坏存储回退安全默认', function () {
    var storage = memoryStorage();
    storage.setItem('creator_scout_home_v1', '{broken json!!');
    var store = Store.create({ storage: storage });
    assertEqual(store.getState().currentSpaceId, TEAM, '回退默认团队空间');
    assertEqual(store.getActiveConversationId(TEAM), null, '回退默认空白会话');
    assertEqual(store.getDraft(TEAM, BLANK), '', '无残留草稿');
  });

  test('存储中的非法空间/会话 ID 被净化', function () {
    var storage = memoryStorage();
    storage.setItem('creator_scout_home_v1', JSON.stringify({
      version: 1,
      currentSpaceId: '不存在的空间',
      signedOut: false,
      viewStates: { '不存在的空间': { activeConversationId: 'x' }, 'sp-personal-lin': { activeConversationId: 'conv-team-aurora' } },
      drafts: { 'sp-personal-lin::conv-team-aurora': '跨空间草稿' }
    }));
    var store = Store.create({ storage: storage });
    assertEqual(store.getState().currentSpaceId, TEAM, '非法当前空间回退默认');
    assertEqual(store.getActiveConversationId(PERSONAL), null, '其他空间的会话 ID 不被采信');
    assertEqual(store.getDraft(PERSONAL, 'conv-team-aurora'), '', '跨空间草稿键不被采信');
  });

  // ================================================================
  // 11. 退出登录：确认后仅结束本地演示状态，数据保留
  // ================================================================
  test('退出登录与重新进入', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    store.setDraft(TEAM, BLANK, '退出前保存的输入');
    return store.flushDrafts().then(function () {
      store.confirmLogout();
      assertEqual(store.getState().signedOut, true, '退出后 signedOut');
      assertEqual(store.getState().currentSpaceId, TEAM, '空间状态不变');
      assertEqual(store.getDraft(TEAM, BLANK), '退出前保存的输入', '退出不删除数据');
      store.reenterDemo();
      assertEqual(store.getState().signedOut, false, '重新进入恢复');
      var store2 = Store.create({ storage: storage });
      assertEqual(store2.getDraft(TEAM, BLANK), '退出前保存的输入', '刷新后数据仍在');
    });
  });

  // ================================================================
  // 12. 未知空间目标被拒绝
  // ================================================================
  test('切换到未知空间被拒绝', function () {
    var store = Store.create({ storage: memoryStorage() });
    return store.switchSpace('sp-not-exist').then(function (r) {
      assert(!r.ok && r.reason === 'unknown-space', '拒绝未知空间');
      assertEqual(store.getState().currentSpaceId, TEAM, '空间不变');
    });
  });

  // 2026-09-24：主动新建与空间恢复分离，旧 v1 数据兼容。
  test('主动新会话独立空白，原有草稿与正式数据不删除', function () {
    var store = Store.create({ storage: memoryStorage() });
    var before = JSON.stringify(Fixtures.spaces);
    store.setDraft(TEAM, BLANK, '原空白输入');
    store.setDraft(TEAM, 'conv-team-aurora', '历史会话草稿');
    store.setDraft(PERSONAL, BLANK, '个人空间草稿');
    var first = store.openBlankSession();
    assert(first !== BLANK, '使用新的内部 ID');
    assertEqual(store.getDraft(TEAM, first), '', '主动新会话输入为空');
    store.setDraft(TEAM, first, '第一份新草稿');
    var second = store.openBlankSession();
    assert(first !== second, '重复主动新建生成不同 ID');
    assertEqual(store.getDraft(TEAM, second), '', '第二份也为空');
    assertEqual(store.getDraft(TEAM, first), '第一份新草稿', '旧独立草稿保留');
    assertEqual(store.getDraft(TEAM, BLANK), '原空白输入', '原 v1 草稿保留');
    assertEqual(store.getDraft(TEAM, 'conv-team-aurora'), '历史会话草稿', '历史草稿不变');
    assertEqual(store.getDraft(PERSONAL, BLANK), '个人空间草稿', '其他空间不受影响');
    assertEqual(JSON.stringify(Fixtures.spaces), before, '不创建项目/最近会话，不改消息或绑定');
  });

  test('独立空白草稿在空间往返与刷新后恢复', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    var teamDraft = store.openBlankSession();
    store.setDraft(TEAM, teamDraft, '团队独立草稿');
    var personalDraft;
    return store.switchSpace(PERSONAL).then(function () {
      personalDraft = store.openBlankSession();
      store.setDraft(PERSONAL, personalDraft, '个人独立草稿');
      return store.switchSpace(TEAM);
    }).then(function () {
      assertEqual(store.getActiveDraftId(), teamDraft, '返回团队恢复同一个草稿 ID');
      assertEqual(store.getDraft(TEAM, teamDraft), '团队独立草稿', '恢复内容');
      return store.flushDrafts();
    }).then(function () {
      var fresh = Store.create({ storage: storage });
      assertEqual(fresh.getActiveDraftId(TEAM), teamDraft, '刷新后团队 ID 不变');
      assertEqual(fresh.getActiveDraftId(PERSONAL), personalDraft, '刷新后个人 ID 不变');
      assertEqual(fresh.getDraft(TEAM, teamDraft), '团队独立草稿', '刷新后团队输入不变');
      assertEqual(fresh.getDraft(PERSONAL, personalDraft), '个人独立草稿', '刷新后个人输入不变');
    });
  });

  test('旧 v1 无新增字段的存储兼容，不丢旧空白与历史草稿', function () {
    var storage = memoryStorage();
    storage.setItem('creator_scout_home_v1', JSON.stringify({ version: 1, currentSpaceId: TEAM, signedOut: false,
      viewStates: { 'sp-team-northstar': { activeConversationId: null } },
      drafts: { 'sp-team-northstar::__blank__': '旧输入', 'sp-team-northstar::conv-team-aurora': '旧历史草稿' } }));
    var store = Store.create({ storage: storage });
    assertEqual(store.getActiveBlankDraftId(), BLANK, '原空白 ID 兼容');
    assertEqual(store.getDraft(TEAM, null), '旧输入', '原首页恢复旧输入');
    var id = store.openBlankSession();
    assertEqual(store.getDraft(TEAM, id), '', '主动新建仍为空');
    return store.flushDrafts().then(function () {
      var fresh = Store.create({ storage: storage });
      assertEqual(fresh.getDraft(TEAM, BLANK), '旧输入', '原空白输入仍在');
      assertEqual(fresh.getDraft(TEAM, 'conv-team-aurora'), '旧历史草稿', '原历史输入仍在');
      assertEqual(fresh.getActiveBlankDraftId(), id, '新位置已保存');
    });
  });

  test('未登记内部草稿 ID 和跨空间写入被拒绝', function () {
    var store = Store.create({ storage: memoryStorage() });
    var id = store.openBlankSession();
    assertEqual(store.setDraft(PERSONAL, id, '不应串入'), false, '团队草稿 ID 不属于个人空间');
    assertEqual(store.setDraft(TEAM, 'conv-personal-petpal', '不应串入'), false, '拒绝跨空间历史 ID');
    assertEqual(store.setDraft(TEAM, '__draft__unregistered', '不应写入'), false, '拒绝未登记 ID');
    assertEqual(store.getDraft(PERSONAL, id), '', '无跨空间输入');
  });

  test('损坏的内部草稿指针安全回退且合法旧输入仍在', function () {
    var storage = memoryStorage();
    storage.setItem('creator_scout_home_v1', JSON.stringify({ version: 1, currentSpaceId: TEAM,
      viewStates: { 'sp-team-northstar': { activeConversationId: null, activeBlankDraftId: '__draft__unknown', blankDraftIds: [null, {}, '__proto__'] } },
      drafts: { 'sp-team-northstar::__blank__': '合法旧草稿', 'sp-team-northstar::__draft__unknown': '未登记输入' } }));
    var store = Store.create({ storage: storage });
    assertEqual(store.getActiveBlankDraftId(), BLANK, '未知指针回退');
    assertEqual(store.getDraft(TEAM, BLANK), '合法旧草稿', '合法旧数据不丢');
    assertEqual(store.getDraft(TEAM, '__draft__unknown'), '', '不接受未登记数据');
  });

  test('长账户文案转义且完整 title 可供悬停查看', function () {
    var account = { name: '很长的昵称<甲>&"乙"'.repeat(8), email: 'long.alias+'.repeat(8) + '@example.com', avatarInitial: '长', unreadCount: 3 };
    var team = { name: '超长团队名称<技术>&"研发"'.repeat(8), avatarInitial: '团' };
    var pop = mountPopover(UI.computePopoverModel({ account: account, team: team, membershipRole: 'member', currentSpaceType: 'team' }));
    assertEqual(pop.querySelector('.pop-name').title, account.name, '昵称完整 title');
    assertEqual(pop.querySelector('.pop-email').title, account.email, '邮箱完整 title');
    assertEqual(pop.querySelector('.space-name').title, team.name, '团队名完整 title');
    assertEqual(pop.querySelector('.space-role').textContent, '普通成员', '身份保持完整');
    assertEqual(pop.querySelectorAll('script').length, 0, '内容不解释为 HTML');
  });


  // ================================================================
  // 13. 00-05：会话创建与解析（模型层）
  // ================================================================
  test('首次发送创建唯一会话，材料与草稿正确转移', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    store.setDraft(TEAM, BLANK, '我们做便携咖啡机，想找美国户外类 Instagram 达人。');
    var before = store.getConversations(TEAM).length;
    var conv = store.createConversation(TEAM, BLANK, '我们做便携咖啡机，想找美国户外类 Instagram 达人。',
      [{ type: 'file', name: 'a.pdf', sub: 'PDF' }], { title: '便携咖啡机达人探索', conditions: ['100 人'] });
    assertEqual(store.getConversations(TEAM).length, before + 1, '只新增一个会话');
    assertEqual(store.getActiveConversationId(TEAM), conv.id, '会话成为当前会话');
    assertEqual(store.getDraft(TEAM, BLANK), '', '空白草稿文字已消费');
    assertEqual(conv.messages[0].role, 'user', '首条为用户消息（原样文本）');
    assertEqual(conv.messages[0].text, '我们做便携咖啡机，想找美国户外类 Instagram 达人。', '用户输入原样保留');
    assertEqual(conv.messages[0].materials.length, 1, '材料随消息保留');
    assertEqual(conv.messages[1].kind, 'parsing', '第二张为解析中卡片');
    assertEqual(conv.stage, 'parsing', '阶段为解析中');
    var store2 = Store.create({ storage: storage });
    assertEqual(store2.getConversations(TEAM).length, before + 1, '刷新后会话仍在');
  });

  test('解析结果替换解析卡并写入画像草稿', function () {
    var store = Store.create({ storage: memoryStorage() });
    var conv = store.createConversation(TEAM, BLANK, '我们做便携咖啡机，想找美国户外类 Instagram 达人。', [], { title: 't' });
    var parseMsgId = conv.messages[1].id;
    var result = {
      title: '便携咖啡机达人探索', suggestedProjectName: 'OutdoorBrew', conditions: ['100 人'],
      portraitDraft: { fields: { targetCountry: '美国', brand: 'OutdoorBrew' }, fieldMeta: {}, personas: [{ name: 'P1', target: 'T1' }], intentSeq: 0 },
      guidance: { title: '我理解到的目标', body: 'b', summary: [], unverified: { title: '尚未核实', body: 'u' }, retained: { line1: 'l1', line2: 'l2' } }
    };
    assert(store.applyParseResult(TEAM, conv.id, parseMsgId, result), '替换成功');
    var updated = store.getConversation(TEAM, conv.id);
    assertEqual(updated.messages[1].kind, 'guidance', '解析卡已替换为引导卡');
    assertEqual(updated.stage, 'parsed', '阶段为已解析');
    assertEqual(updated.portrait.fields.brand, 'OutdoorBrew', '画像草稿已写入');
    assertEqual(updated.draftProjectName, 'OutdoorBrew', '建议项目名已写入');
    assert(!store.applyParseResult(TEAM, conv.id, '不存在', result), '重复应用被拒绝');
  });

  test('用户改过的项目名不被后续解析覆盖', function () {
    var store = Store.create({ storage: memoryStorage() });
    var conv = store.createConversation(TEAM, BLANK, '我们做便携咖啡机。', [], { title: 't' });
    store.setDraftName(TEAM, conv.id, 'MyName');
    store.applyParseResult(TEAM, conv.id, conv.messages[1].id, { suggestedProjectName: 'AIName',
      portraitDraft: { fields: {}, fieldMeta: {}, personas: [{ name: 'p', target: 't' }] } });
    assertEqual(store.getConversation(TEAM, conv.id).draftProjectName, 'MyName', '用户名称保留');
  });

  // ================================================================
  // 14. 00-05：画像草稿编辑与意图序号守卫
  // ================================================================
  test('对话修改意图守卫：旧响应不能覆盖新修改', function () {
    var store = Store.create({ storage: memoryStorage() });
    var conv = store.createConversation(TEAM, BLANK, '需求', [], { title: 't' });
    store.applyParseResult(TEAM, conv.id, conv.messages[1].id, {
      portraitDraft: { fields: { brand: 'A' }, fieldMeta: {}, personas: [{ name: 'p', target: 't' }] }
    });
    var seq = store.claimIntent(TEAM, conv.id);
    store.setPortraitField(TEAM, conv.id, 'brand', 'Manual');
    var blocked = store.applyCommandPatch(TEAM, conv.id, { field: 'brand', value: 'AI' }, seq);
    assert(!blocked.applied, '旧响应被拒绝');
    assertEqual(blocked.currentValue, 'Manual', '返回当前值');
    assertEqual(store.getPortrait(TEAM, conv.id).fields.brand, 'Manual', '手动值未被覆盖');
    var seq2 = store.claimIntent(TEAM, conv.id);
    var ok = store.applyCommandPatch(TEAM, conv.id, { field: 'brand', value: 'Cmd' }, seq2);
    assert(ok.applied, '更新的命令意图生效');
    assertEqual(store.getPortrait(TEAM, conv.id).fields.brand, 'Cmd', '字段为命令值');
    var seq3 = store.claimIntent(TEAM, conv.id);
    store.setPersonaField(TEAM, conv.id, 0, 'target', 'ManualTarget');
    var blockedP = store.applyCommandPatch(TEAM, conv.id, { field: 'personaTarget', value: 'X', personaIndex: 0 }, seq3);
    assert(!blockedP.applied, '画像目标达人的旧响应被拒绝');
  });

  test('画像多卡片：新增、删除保护与至少一张', function () {
    var store = Store.create({ storage: memoryStorage() });
    var conv = store.createConversation(TEAM, BLANK, '需求', [], { title: 't' });
    store.applyParseResult(TEAM, conv.id, conv.messages[1].id, {
      portraitDraft: { fields: {}, fieldMeta: {}, personas: [{ name: 'p1', target: 't1' }] }
    });
    assertEqual(store.getPortrait(TEAM, conv.id).personas.length, 1, '初始一张');
    var lastId = store.getPortrait(TEAM, conv.id).personas[0].id;
    var r1 = store.removePersonaById(TEAM, conv.id, lastId);
    assert(!r1.ok && r1.reason === 'last-persona', '最后一张不可删除');
    var added = store.addPersona(TEAM, conv.id);
    assertEqual(store.getPortrait(TEAM, conv.id).personas.length, 2, '新增一张');
    var r2 = store.removePersonaById(TEAM, conv.id, added.id);
    assert(r2.ok, '非最后一张可删除');
  });

  // ================================================================
  // 15. 00-05：项目创建原子性与空间隔离
  // ================================================================
  test('创建项目：一次提交一个项目、绑定与名称同步', function () {
    var storage = memoryStorage();
    var store = Store.create({ storage: storage });
    var conv = store.createConversation(TEAM, BLANK, '我们做便携咖啡机，要有邮箱。', [], { title: 't', conditions: ['需要邮箱'] });
    store.applyParseResult(TEAM, conv.id, conv.messages[1].id, {
      portraitDraft: { fields: { targetCountry: '美国' }, fieldMeta: {}, personas: [{ name: 'p', target: 't' }] }
    });
    var before = store.getProjects(TEAM).length;
    var r = store.createProject(TEAM, conv.id, 'OutdoorBrew', 'body');
    assert(r.ok, '创建成功');
    assertEqual(store.getProjects(TEAM).length, before + 1, '只新增一个项目');
    var updated = store.getConversation(TEAM, conv.id);
    assertEqual(updated.projectId, r.projectId, '会话绑定项目');
    assertEqual(updated.title, 'OutdoorBrew', '会话标题同步为项目名');
    assertEqual(updated.stage, 'project_created', '阶段为已创建');
    assertEqual(updated.messages[updated.messages.length - 1].kind, 'created', '追加成功消息');
    assertEqual(updated.messages.filter(function (m) { return m.kind === 'created'; }).length, 1, '仅一条成功消息');
    var r2 = store.createProject(TEAM, conv.id, 'Again', 'b');
    assert(!r2.ok, '重复创建被拒绝');
    assertEqual(store.getProjects(TEAM).length, before + 1, '不产生重复项目');
    var store2 = Store.create({ storage: storage });
    assertEqual(store2.getProjects(TEAM).length, before + 1, '刷新后项目仍在');
    assertEqual(store2.getConversation(TEAM, conv.id).title, 'OutdoorBrew', '刷新后绑定与名称仍在');
  });

  test('新会话与项目按空间隔离', function () {
    var store = Store.create({ storage: memoryStorage() });
    store.createConversation(TEAM, BLANK, '团队需求', [], { title: '团队会话' });
    var teamCount = store.getConversations(TEAM).length;
    var personalBefore = store.getConversations(PERSONAL).length;
    var projectsBefore = store.getProjects(PERSONAL).length;
    assertEqual(store.getConversations(PERSONAL).length, personalBefore, '个人空间会话不受影响');
    store.createConversation(PERSONAL, BLANK, '个人需求', [], { title: '个人会话' });
    assertEqual(store.getConversations(TEAM).length, teamCount, '团队空间会话不受影响');
    assert(store.getConversations(PERSONAL).some(function (c) { return c.title === '个人会话'; }), '个人空间有自己的新会话');
    assert(!store.getConversations(TEAM).some(function (c) { return c.title === '个人会话'; }), '团队空间不出现个人会话');
    assertEqual(store.getProjects(PERSONAL).length, projectsBefore, '个人项目不受影响');
  });

  test('v1 旧数据升级：草稿保留，会话/项目用 fixture 初始', function () {
    var storage = memoryStorage();
    storage.setItem('creator_scout_home_v1', JSON.stringify({
      version: 1,
      currentSpaceId: 'sp-personal-lin',
      signedOut: false,
      viewStates: { 'sp-personal-lin': { activeConversationId: 'conv-personal-homecafe', activeBlankDraftId: BLANK, blankDraftIds: [BLANK] } },
      drafts: { 'sp-personal-lin::conv-personal-homecafe': '旧草稿' }
    }));
    var store = Store.create({ storage: storage });
    assertEqual(store.getState().version, 2, '升级到 v2');
    assertEqual(store.getState().currentSpaceId, PERSONAL, '当前空间保留');
    assertEqual(store.getDraft(PERSONAL, 'conv-personal-homecafe'), '旧草稿', '旧草稿保留');
    assertEqual(store.getConversations(TEAM).length, 2, '团队空间会话为 fixture 初始');
    assertEqual(store.getProjects(TEAM).length, 2, '团队项目为 fixture 初始');
  });

  // ---------------- 运行 ----------------
  function renderBoard() {
    var board = document.getElementById('fixture-board');
    Fixtures.popoverTestFixtures.forEach(function (fx) {
      var model = UI.computePopoverModel(fx);
      var cell = document.createElement('div');
      cell.className = 'fixture-cell';
      cell.innerHTML = '<span class="cell-label">' + fx.description + '</span>' +
        '<div class="account-popover" style="position:static;">' + UI.popoverAccountHTML(model, {}) + '</div>';
      board.appendChild(cell);
    });
  }

  function appendResult(item) {
    var list = document.getElementById('result-list');
    var el = document.createElement('div');
    el.className = 'result-item';
    el.innerHTML = '<span class="' + (item.pass ? 'result-pass' : 'result-fail') + '">' + (item.pass ? '通过' : '失败') +
      '</span><span class="result-name">' + item.name + '</span>' +
      (item.pass ? '' : '<span class="result-msg">' + (item.error || '') + '</span>');
    list.appendChild(el);
  }

  function run() {
    renderBoard();
    var chain = Promise.resolve();
    var passed = 0, failed = 0;
    tests.forEach(function (t) {
      chain = chain.then(function () {
        return Promise.resolve().then(t.fn).then(function () {
          passed++; appendResult({ name: t.name, pass: true });
        }).catch(function (e) {
          failed++; appendResult({ name: t.name, pass: false, error: e && e.message ? e.message : String(e) });
        });
      });
    });
    chain.then(function () {
      document.getElementById('summary').textContent =
        '共 ' + tests.length + ' 项：通过 ' + passed + '，失败 ' + failed + (failed === 0 ? ' ✅' : ' ❌');
      document.title = failed === 0 ? 'Creator Scout 首页原型 · 测试（全部通过）' : 'Creator Scout 首页原型 · 测试（存在失败）';
    });
  }

  run();
})(window);
