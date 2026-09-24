/*
 * Creator Scout 独立首页原型 · 状态模型（store）· v2
 *
 * v1 职责全部保留：当前空间、每空间 viewState、按 spaceId+conversationId 隔离的
 * 未发送草稿、localStorage 持久化（损坏回退安全默认）、空间切换（序号守卫 + 锁定 +
 * 失败保留）、退出登录（仅本地演示状态）。
 *
 * v2 新增（00–05 流程）：会话 / 画像草稿 / 项目成为持久化状态——
 *   spaces[spaceId].projects      项目列表（fixture 初始 + 创建追加）
 *   spaces[spaceId].conversations 会话列表（fixture 初始 + 发送成功创建）
 *   conv.portrait                 对话与画像共用的草稿（字段 + 来源 + 意图序号守卫）
 *   materialDrafts                发送前的附件/链接材料草稿（按空间+草稿ID隔离）
 *
 * 本文件只做状态与规则，不做 DOM 渲染；渲染见 ui.js。模拟延时/失败见 simulation.js。
 */
(function (global) {
  'use strict';

  var Fixtures = global.Fixtures;
  var BLANK = Fixtures.BLANK_DRAFT_ID;
  var STORAGE_KEY = 'creator_scout_home_v1'; // 存储键保持不变；数据内部 version 升到 2

  function isBlankDraftId(id) {
    return id === BLANK || (typeof id === 'string' && /^__draft__[a-z0-9-]{1,80}$/i.test(id));
  }

  function uid(prefix) {
    var s = global.crypto && typeof global.crypto.randomUUID === 'function'
      ? global.crypto.randomUUID()
      : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    return prefix + '-' + s;
  }

  function autoPersonaName(target, region) {
    var value = String(target || '').trim();
    var core = '';
    if (/兽医/.test(value)) core = '兽医型达人';
    else if (/护士|护理/.test(value)) core = '护士型达人';
    else if (/医护/.test(value)) core = '医护型达人';
    else if (/医生|临床/.test(value)) core = '医生型达人';
    else if (/3C|数码|消费电子/i.test(value)) core = '3C达人';
    else if (/美妆|个护|美容/.test(value)) core = '美妆个护达人';
    else if (/家居/.test(value)) core = '家居达人';
    else if (/游戏/.test(value)) core = '游戏达人';
    if (!core) return value.length > 12 ? value.slice(0, 12) + '…' : value;
    var selected = region && region.selected;
    return selected && selected.length === 1 && Fixtures.countryMap[selected[0]]
      ? Fixtures.countryMap[selected[0]] + core : core;
  }

  function refreshAutoPersonaNames(conv) {
    if (!conv || !conv.portrait) return;
    conv.portrait.personas.forEach(function (persona) {
      if (!persona.nameManual) persona.name = autoPersonaName(persona.target, conv.portrait.region);
    });
  }

  function spaceById(id) {
    for (var i = 0; i < Fixtures.spaces.length; i++) {
      if (Fixtures.spaces[i].id === id) return Fixtures.spaces[i];
    }
    return null;
  }

  function draftKey(spaceId, conversationId) {
    return spaceId + '::' + (conversationId == null ? BLANK : conversationId);
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function defaultTransport(targetSpaceId, seq) {
    return sleep(120).then(function () {
      return { spaceId: targetSpaceId, seq: seq };
    });
  }

  // ------------------------------------------------------------------
  // fixture 会话 → v2 会话对象（项目助手历史会话：已绑定项目）
  // ------------------------------------------------------------------
  function normalizeFixtureConversation(fx, spaceId) {
    return {
      id: fx.id,
      spaceId: spaceId,
      platform: 'instagram',
      title: fx.displayTitle,
      stage: 'project_created', // parsing | parsed | project_created
      dateLabel: fx.dateLabel,
      messages: (fx.messages || []).slice(),
      projectId: fx.projectId || null,
      draftProjectName: null,
      nameTouched: false,
      portrait: null,
      conditions: [],
      intentSeq: 0
    };
  }

  function defaultSpacesData() {
    var out = {};
    Fixtures.spaces.forEach(function (space) {
      out[space.id] = {
        projects: space.projects.map(function (p) { return { id: p.id, platform: p.platform, name: p.name }; }),
        conversations: space.conversations.map(function (c) { return normalizeFixtureConversation(c, space.id); })
      };
    });
    return out;
  }

  var PERSONA_TEXT_FIELDS = ['name', 'target', 'topics', 'preference', 'audience', 'must', 'avoid'];
  // V9 字段键 → 本 Demo 字段键的映射层（仅影响草稿内部命名，不改 UI 文案）
  // V9: brand / product / coreValue / targetUser / useScene / goal
  var PORTRAIT_TEXT_FIELDS = ['brand', 'product', 'coreValue', 'targetUsers', 'usageScenarios', 'marketingGoal'];
  var V9_FIELD_ALIAS = { coreValue: 'coreValue', targetUser: 'targetUsers', useScene: 'usageScenarios', goal: 'marketingGoal' };

  function knownCountryCodes() {
    return (global.Fixtures.countryList || []).map(function (c) { return c[0]; });
  }

  /** 国家／地区净化：只保留字典内代码、去重、顺序稳定。缺失文本不能冒充有效选择。 */
  function sanitizeRegion(r) {
    var known = knownCountryCodes();
    var selected = [];
    if (r && Array.isArray(r.selected)) {
      r.selected.forEach(function (code) {
        if (typeof code === 'string' && known.indexOf(code) !== -1 && selected.indexOf(code) === -1) {
          selected.push(code);
        }
      });
    } else if (r && typeof r.selected === 'string') {
      String(r.selected).split(/[、,，\/|]/).forEach(function (name) {
        name = name.trim();
        global.Fixtures.countryList.forEach(function (c) {
          if (c[1] === name && selected.indexOf(c[0]) === -1) selected.push(c[0]);
        });
      });
    }
    // 迁移：旧草稿用 fields.targetCountry 文本保存地区
    if (!selected.length && r && typeof r.textLegacy === 'string' && r.textLegacy.trim()) {
      String(r.textLegacy).split(/[、,，\/|]/).forEach(function (name) {
        name = name.trim();
        global.Fixtures.countryList.forEach(function (c) {
          if (c[1] === name && selected.indexOf(c[0]) === -1) selected.push(c[0]);
        });
      });
    }
    return { selected: selected, source: r && typeof r.source === 'string' ? r.source : '' };
  }

  function sanitizeMessage(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.role !== 'user' && m.role !== 'agent') return null;
    // 用户消息必须有正文；agent 消息允许只有 body（纯文本回复卡片，如「已收到你的消息」）
    if (m.role === 'user' && typeof m.text !== 'string') return null;
    if (m.role === 'agent' && typeof m.text !== 'string' && typeof m.title !== 'string' && typeof m.body !== 'string') return null;
    var out = { id: typeof m.id === 'string' ? m.id : uid('msg'), role: m.role };
    if (m.role === 'user') {
      out.text = String(m.text || '');
      if (Array.isArray(m.materials)) {
        out.materials = m.materials.map(sanitizeMaterial).filter(Boolean);
      }
    } else {
      out.kind = typeof m.kind === 'string' ? m.kind : 'card';
      if (typeof m.title === 'string') out.title = m.title;
      if (typeof m.body === 'string') out.body = m.body;
      if (typeof m.text === 'string') out.text = m.text;
      if (Array.isArray(m.summary)) out.summary = m.summary;
      if (m.unverified && typeof m.unverified === 'object') out.unverified = m.unverified;
      if (m.retained && typeof m.retained === 'object') out.retained = m.retained;
      if (typeof m.statusLine === 'string') out.statusLine = m.statusLine;
      if (typeof m.note === 'string') out.note = m.note;
    }
    return out;
  }

  function sanitizeMaterial(m) {
    if (!m || typeof m !== 'object') return null;
    if (m.type !== 'file' && m.type !== 'link') return null;
    return {
      id: typeof m.id === 'string' && m.id ? m.id : uid('mat'),
      type: m.type,
      name: String(m.name || ''),
      sub: String(m.sub || '')
    };
  }

  function sanitizePortrait(p) {
    if (!p || typeof p !== 'object' || !p.fields || !Array.isArray(p.personas)) return null;
    var fields = {}, fieldMeta = {};
    PORTRAIT_TEXT_FIELDS.forEach(function (f) {
      if (typeof p.fields[f] === 'string') fields[f] = p.fields[f];
      if (p.fieldMeta && p.fieldMeta[f] && typeof p.fieldMeta[f].source === 'string') {
        fieldMeta[f] = { source: p.fieldMeta[f].source, seq: Number(p.fieldMeta[f].seq) || 0 };
      }
    });
    var personas = p.personas.map(function (persona) {
      if (!persona || typeof persona !== 'object') return null;
      var out = { id: typeof persona.id === 'string' ? persona.id : uid('persona'),
        nameManual: !!persona.nameManual, meta: {} };
      PERSONA_TEXT_FIELDS.forEach(function (f) {
        out[f] = typeof persona[f] === 'string' ? persona[f] : '';
        if (persona.meta && persona.meta[f] && typeof persona.meta[f].source === 'string') {
          out.meta[f] = { source: persona.meta[f].source, seq: Number(persona.meta[f].seq) || 0 };
        }
      });
      return out;
    }).filter(Boolean);
    if (!personas.length) return null;
    return { fields: fields, fieldMeta: fieldMeta, region: sanitizeRegion(p.region || { selected: null, textLegacy: p.fields ? p.fields.targetCountry : '' }),
      personas: personas, intentSeq: Number(p.intentSeq) || 0 };
  }

  function sanitizeConversation(c, spaceId) {
    if (!c || typeof c !== 'object' || typeof c.id !== 'string') return null;
    var fx = null;
    var fixtureSpace = spaceById(spaceId);
    if (fixtureSpace) {
      for (var i = 0; i < fixtureSpace.conversations.length; i++) {
        if (fixtureSpace.conversations[i].id === c.id) { fx = fixtureSpace.conversations[i]; break; }
      }
    }
    var base = fx ? normalizeFixtureConversation(fx, spaceId) : null;
    var messages = Array.isArray(c.messages) ? c.messages.map(sanitizeMessage).filter(Boolean)
      : (base ? base.messages : []);
    if (!messages.length) return null; // 空会话不落盘
    var stage = ['parsing', 'parsed', 'project_created'].indexOf(c.stage) !== -1 ? c.stage : (base ? base.stage : 'parsed');
    return {
      id: c.id,
      spaceId: spaceId,
      platform: 'instagram',
      title: typeof c.title === 'string' && c.title ? c.title : (base ? base.title : 'Instagram 会话'),
      stage: stage,
      dateLabel: typeof c.dateLabel === 'string' ? c.dateLabel : (base ? base.dateLabel : ''),
      messages: messages,
      projectId: typeof c.projectId === 'string' ? c.projectId : (base ? base.projectId : null),
      draftProjectName: typeof c.draftProjectName === 'string' ? c.draftProjectName : null,
      nameTouched: !!c.nameTouched,
      portrait: sanitizePortrait(c.portrait),
      conditions: Array.isArray(c.conditions) ? c.conditions.filter(function (x) { return typeof x === 'string'; }) : [],
      intentSeq: Number(c.intentSeq) || 0
    };
  }

  function sanitizeSpaces(raw) {
    var out = {};
    Fixtures.spaces.forEach(function (space) {
      var data = raw && raw[space.id];
      var projects = (data && Array.isArray(data.projects) ? data.projects : [])
        .filter(function (p) { return p && typeof p.id === 'string' && typeof p.name === 'string'; })
        .map(function (p) { return { id: p.id, platform: typeof p.platform === 'string' ? p.platform : 'instagram', name: p.name }; });
      // fixture 项目始终保留（防止历史数据丢失初始项目）
      space.projects.forEach(function (fp) {
        if (!projects.some(function (p) { return p.id === fp.id; })) {
          projects.push({ id: fp.id, platform: fp.platform, name: fp.name });
        }
      });
      var seen = {};
      var conversations = (data && Array.isArray(data.conversations) ? data.conversations : [])
        .map(function (c) { return sanitizeConversation(c, space.id); })
        .filter(Boolean)
        .filter(function (c) { return seen[c.id] ? false : (seen[c.id] = true); });
      // fixture 会话缺失时补回（保留初始历史）
      space.conversations.forEach(function (fc) {
        if (!conversations.some(function (c) { return c.id === fc.id; })) {
          conversations.push(normalizeFixtureConversation(fc, space.id));
        }
      });
      out[space.id] = { projects: projects, conversations: conversations };
    });
    return out;
  }

  function createStore(options) {
    options = options || {};
    var storage = options.storage || (function () {
      try { return global.localStorage; } catch (e) { return null; }
    })();
    var storageKey = options.storageKey || STORAGE_KEY;
    var transport = defaultTransport;

    // ---------------- 持久化（带净化的安全加载） ----------------
    function sanitize(data) {
      if (!data || typeof data !== 'object' || (data.version !== 1 && data.version !== 2)) return null;
      var currentSpaceId = spaceById(data.currentSpaceId) ? data.currentSpaceId : Fixtures.defaultSpaceId;
      var spacesData = sanitizeSpaces(data.spaces);
      var viewStates = {};
      var drafts = {};
      Fixtures.spaces.forEach(function (space) {
        var vs = data.viewStates && data.viewStates[space.id];
        var convId = vs && vs.activeConversationId;
        var blankIds = [BLANK];
        if (vs && Array.isArray(vs.blankDraftIds)) {
          vs.blankDraftIds.forEach(function (id) {
            if (isBlankDraftId(id) && blankIds.indexOf(id) === -1) blankIds.push(id);
          });
        }
        var known = spacesData[space.id].conversations.some(function (c) { return c.id === convId; });
        viewStates[space.id] = {
          activeConversationId: known ? convId : null,
          activeBlankDraftId: vs && blankIds.indexOf(vs.activeBlankDraftId) !== -1 ? vs.activeBlankDraftId : BLANK,
          blankDraftIds: blankIds
        };
        spacesData[space.id].conversations.concat(blankIds.map(function (id) { return { id: id }; })).forEach(function (conv) {
          var key = draftKey(space.id, conv.id);
          var val = data.drafts && data.drafts[key];
          if (typeof val === 'string') drafts[key] = val;
        });
      });
      var materialDrafts = {};
      if (data.materialDrafts && typeof data.materialDrafts === 'object') {
        Object.keys(data.materialDrafts).forEach(function (key) {
          var parts = key.split('::');
          if (parts.length !== 2 || !spaceById(parts[0])) return;
          if (!Array.isArray(data.materialDrafts[key])) return;
          var list = data.materialDrafts[key].map(sanitizeMaterial).filter(Boolean);
          if (list.length) materialDrafts[key] = list;
        });
      }
      return {
        version: 2,
        currentSpaceId: currentSpaceId,
        signedOut: !!data.signedOut,
        viewStates: viewStates,
        drafts: drafts,
        materialDrafts: materialDrafts,
        spaces: spacesData
      };
    }

    function loadOrDefault() {
      if (!storage) return defaultState();
      try {
        var raw = storage.getItem(storageKey);
        if (!raw) return defaultState();
        return sanitize(JSON.parse(raw)) || defaultState();
      } catch (e) {
        return defaultState(); // 损坏存储：安全默认，不混空间
      }
    }

    function defaultState() {
      var viewStates = {};
      Fixtures.spaces.forEach(function (space) {
        viewStates[space.id] = { activeConversationId: null, activeBlankDraftId: BLANK, blankDraftIds: [BLANK] };
      });
      return {
        version: 2,
        currentSpaceId: Fixtures.defaultSpaceId,
        signedOut: false,
        viewStates: viewStates,
        drafts: {},
        materialDrafts: {},
        spaces: defaultSpacesData()
      };
    }

    var state = loadOrDefault();

    function newBlankDraftId(spaceId) {
      var ids = state.viewStates[spaceId].blankDraftIds;
      var id;
      do { id = '__draft__' + uid(''); } while (ids.indexOf(id) !== -1);
      return id;
    }

    function resolveDraftId(spaceId, id) {
      var space = spaceById(spaceId);
      var vs = state.viewStates[spaceId];
      if (!space || !vs) return null;
      if (id == null) id = vs.activeBlankDraftId;
      return findConversation(spaceId, id) || vs.blankDraftIds.indexOf(id) !== -1 ? id : null;
    }

    var persistTimer = null;
    var listeners = [];

    function emitChange() {
      listeners.slice().forEach(function (fn) { try { fn(); } catch (e) { /* 单个监听器异常不阻断其他 */ } });
    }

    function persist() {
      if (!storage) return;
      var raw = JSON.stringify({
        version: 2,
        currentSpaceId: state.currentSpaceId,
        signedOut: state.signedOut,
        viewStates: state.viewStates,
        drafts: state.drafts,
        materialDrafts: state.materialDrafts,
        spaces: state.spaces
      });
      storage.setItem(storageKey, raw); // 配额/安全模式等异常向上抛出，由调用方处理
    }

    function schedulePersist() {
      if (!storage) return;
      if (persistTimer) clearTimeout(persistTimer);
      persistTimer = setTimeout(function () {
        persistTimer = null;
        try { persist(); } catch (e) { /* 草稿输入期的静默失败：切换/刷新时 flushDrafts 仍会暴露错误 */ }
      }, 200);
    }

    function flushDrafts() {
      if (persistTimer) { clearTimeout(persistTimer); persistTimer = null; }
      return new Promise(function (resolve, reject) {
        if (!storage) return resolve();
        try { persist(); resolve(); } catch (e) { reject(e); }
      });
    }

    // ---------------- 空间切换（序号守卫 + 锁定 + 失败保留） ----------------
    var switchSeq = 0;
    var switching = null; // { to, seq }

    function switchSpace(targetSpaceId) {
      if (!spaceById(targetSpaceId)) {
        return Promise.resolve({ ok: false, reason: 'unknown-space', target: targetSpaceId });
      }
      if (targetSpaceId === state.currentSpaceId && !switching) {
        return Promise.resolve({ ok: true, noop: true, target: targetSpaceId });
      }
      var seq = ++switchSeq;
      switching = { to: targetSpaceId, seq: seq };
      emitChange(); // 呈现“切换中”反馈并锁定重复操作

      return flushDrafts()
        .then(function () { return transport(targetSpaceId, seq); })
        .then(function (res) {
          if (seq !== switchSeq) return { ok: false, stale: true, reason: 'stale', target: targetSpaceId };
          if (!res || res.spaceId !== targetSpaceId) {
            return { ok: false, reason: 'mismatch', target: targetSpaceId };
          }
          state.currentSpaceId = targetSpaceId;
          try { persist(); } catch (e) { /* 已切换成功；存储失败不回滚空间，后续输入继续重试落盘 */ }
          return { ok: true, target: targetSpaceId };
        })
        .catch(function (err) {
          if (seq !== switchSeq) return { ok: false, stale: true, reason: 'stale', target: targetSpaceId };
          return { ok: false, reason: 'error', error: err, target: targetSpaceId };
        })
        .then(function (result) {
          if (switching && switching.seq === seq) switching = null;
          if (!result.stale) emitChange();
          return result;
        });
    }

    // ---------------- v2：会话 / 画像 / 项目 ----------------
    function findConversation(spaceId, convId) {
      var sd = state.spaces[spaceId];
      if (!sd) return null;
      for (var i = 0; i < sd.conversations.length; i++) {
        if (sd.conversations[i].id === convId) return sd.conversations[i];
      }
      return null;
    }

    function nowLabel() {
      var d = new Date();
      function two(n) { return (n < 10 ? '0' : '') + n; }
      return '今天 ' + two(d.getHours()) + ':' + two(d.getMinutes());
    }

    function commit() {
      try { persist(); } catch (e) { schedulePersist(); }
      emitChange();
    }

    var store = {
      // 数据访问
      getAccount: function () { return Fixtures.account; },
      getTeam: function () { return Fixtures.team; },
      getMembershipRole: function () { return 'creator'; },
      getSpaces: function () { return Fixtures.spaces; },
      getSpace: spaceById,
      getPlatforms: function () { return Fixtures.platforms; },
      getState: function () { return state; },
      getCurrentSpace: function () { return spaceById(state.currentSpaceId); },

      getProjects: function (spaceId) {
        var sd = state.spaces[spaceId || state.currentSpaceId];
        return sd ? sd.projects : [];
      },
      getConversations: function (spaceId) {
        var sd = state.spaces[spaceId || state.currentSpaceId];
        return sd ? sd.conversations : [];
      },
      getConversation: function (spaceId, convId) { return findConversation(spaceId, convId); },

      /** 首次发送成功：由空白草稿创建会话（唯一入口，重复调用不会产生第二条）。 */
      createConversation: function (spaceId, draftId, text, materials, pre) {
        var vs = state.viewStates[spaceId];
        var conv = {
          id: uid('conv'),
          spaceId: spaceId,
          platform: 'instagram',
          title: (pre && pre.title) || 'Instagram 达人探索',
          stage: 'parsing',
          dateLabel: nowLabel(),
          messages: [],
          projectId: null,
          draftProjectName: null,
          nameTouched: false,
          portrait: null,
          conditions: (pre && pre.conditions) || [],
          intentSeq: 0
        };
        conv.messages.push({ id: uid('msg'), role: 'user', text: String(text || ''), materials: (materials || []).slice() });
        conv.messages.push({ id: uid('msg'), role: 'agent', kind: 'parsing',
          title: '正在读取材料并整理你的需求',
          body: '已使用文字需求；材料已接收。本轮为演示流程，附件与链接内容不做真实解析。',
          statusLine: '✓ 需求已识别',
          note: '你可以继续补充信息。' });
        var sd = state.spaces[spaceId];
        sd.conversations.unshift(conv); // 新会话排在最近列表最前
        // 消费草稿：文字与材料移动到会话，空白草稿清空
        var key = draftKey(spaceId, resolveDraftId(spaceId, draftId));
        delete state.drafts[key];
        var mkey = spaceId + '::' + (resolveDraftId(spaceId, draftId) || BLANK);
        delete state.materialDrafts[mkey];
        vs.activeConversationId = conv.id;
        commit();
        return conv;
      },

      appendUserMessage: function (spaceId, convId, text, materials) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return null;
        conv.messages.push({ id: uid('msg'), role: 'user', text: String(text || ''), materials: (materials || []).slice() });
        commit();
        return conv;
      },

      appendAgentMessage: function (spaceId, convId, msg) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return null;
        msg.id = msg.id || uid('msg');
        msg.role = 'agent';
        conv.messages.push(msg);
        commit();
        return msg;
      },

      replaceMessage: function (spaceId, convId, messageId, newMsg) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return false;
        for (var i = 0; i < conv.messages.length; i++) {
          if (conv.messages[i].id === messageId) {
            newMsg.id = newMsg.id || messageId;
            newMsg.role = newMsg.role || 'agent';
            conv.messages[i] = newMsg;
            commit();
            return true;
          }
        }
        return false;
      },

      /** 解析成功：替换解析卡为 02 引导卡，写入画像草稿与建议项目名。 */
      applyParseResult: function (spaceId, convId, parseMsgId, result) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return false;
        var g = result && result.guidance || {};
        var replaced = false;
        for (var i = 0; i < conv.messages.length; i++) {
          if (conv.messages[i].id === parseMsgId) {
            conv.messages[i] = { id: parseMsgId, role: 'agent', kind: 'guidance',
              title: g.title, body: g.body,
              summary: g.summary, unverified: g.unverified,
              retained: g.retained };
            replaced = true;
            break;
          }
        }
        if (!replaced) return false;
        conv.title = result.title || conv.title;
        conv.portrait = sanitizePortrait(result.portraitDraft) || conv.portrait;
        conv.conditions = result.conditions || conv.conditions;
        if (!conv.nameTouched) conv.draftProjectName = result.suggestedProjectName || conv.draftProjectName;
        conv.stage = 'parsed';
        commit();
        return true;
      },

      /** 解析失败：解析卡替换为可重试的错误卡；会话与已接收消息保留。 */
      markParseError: function (spaceId, convId, parseMsgId) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return false;
        for (var i = 0; i < conv.messages.length; i++) {
          if (conv.messages[i].id === parseMsgId) {
            conv.messages[i] = { id: parseMsgId, role: 'agent', kind: 'parse-error',
              title: '解析未完成',
              body: '演示解析未完成。你的需求和材料已保留在会话中，可以重新解析。',
              retry: true };
            commit();
            return true;
          }
        }
        return false;
      },

      /** 预占一个意图序号（对话修改发出时调用）。 */
      claimIntent: function (spaceId, convId) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return 0;
        conv.intentSeq += 1;
        schedulePersist();
        return conv.intentSeq;
      },

      /**
       * 应用模拟修改补丁（字段意图守卫）：
       * 若该字段存在更新的意图（seq 更大，如用户后来的手动修改），拒绝应用并返回当前值。
       * personaId 为稳定标识，不依赖数组位置：删除/新增画像后不会写错目标。
       */
      applyCommandPatch: function (spaceId, convId, patch, seq) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return { applied: false, reason: 'no-portrait' };
        if (patch.field === 'personaTarget') {
          var persona = patch.personaId
            ? conv.portrait.personas.filter(function (p) { return p.id === patch.personaId; })[0]
            : conv.portrait.personas[patch.personaIndex || 0];
          if (!persona) return { applied: false, reason: 'no-persona' };
          if (!persona.meta) persona.meta = {};
          var pmeta = persona.meta.target;
          if (pmeta && pmeta.seq > seq) return { applied: false, currentValue: persona.target };
          persona.target = patch.value;
          persona.meta.target = { source: '对话修改', seq: seq };
          if (!persona.nameManual) persona.name = autoPersonaName(persona.target, conv.portrait.region);
          commit();
          return { applied: true, personaId: persona.id };
        }
        // 结构化地区：无法识别的输入不写入，也不清空已有有效选择
        if (patch.field === 'region') {
          var codes = Array.isArray(patch.value) ? patch.value : [];
          var known = knownCountryCodes();
          codes = codes.filter(function (c) { return known.indexOf(c) !== -1; });
          if (!codes.length) {
            return { applied: false, reason: 'unknown-region',
              currentValue: (conv.portrait.region.selected || []).map(function (c) { return global.Fixtures.countryMap[c]; }).join('、') };
          }
          if (conv.portrait.region.meta && conv.portrait.region.meta.seq > seq) {
            return { applied: false, reason: 'stale',
              currentValue: (conv.portrait.region.selected || []).map(function (c) { return global.Fixtures.countryMap[c]; }).join('、') };
          }
          conv.intentSeq += 1;
          conv.portrait.region.selected = codes;
          conv.portrait.region.source = '对话修改';
          conv.portrait.region.meta = { source: '对话修改', seq: Math.max(seq, conv.intentSeq) };
          refreshAutoPersonaNames(conv);
          commit();
          return { applied: true };
        }
        var meta = conv.portrait.fieldMeta[patch.field];
        if (meta && meta.seq > seq) {
          return { applied: false, currentValue: conv.portrait.fields[patch.field] };
        }
        conv.portrait.fields[patch.field] = patch.value;
        conv.portrait.fieldMeta[patch.field] = { source: '对话修改', seq: seq };
        commit();
        return { applied: true };
      },

      // ---- 画像草稿编辑（表单直接编辑 → 同一份草稿） ----
      getPortrait: function (spaceId, convId) {
        var conv = findConversation(spaceId, convId);
        return conv ? conv.portrait : null;
      },
      setPortraitField: function (spaceId, convId, field, value) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait || PORTRAIT_TEXT_FIELDS.indexOf(field) === -1) return false;
        conv.intentSeq += 1;
        conv.portrait.fields[field] = String(value == null ? '' : value);
        conv.portrait.fieldMeta[field] = { source: '手动修改', seq: conv.intentSeq };
        schedulePersist();
        return true;
      },
      // ---- 目标国家／地区（结构化；手动选择写同一份草稿） ----
      setRegionSelection: function (spaceId, convId, codes) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait || !Array.isArray(codes)) return false;
        var known = knownCountryCodes();
        var selected = codes.filter(function (code, index) {
          return known.indexOf(code) !== -1 && codes.indexOf(code) === index;
        });
        if (!selected.length) return false;
        if (selected.join(',') === conv.portrait.region.selected.join(',')) return true;
        conv.intentSeq += 1;
        conv.portrait.region.selected = selected;
        conv.portrait.region.source = '手动修改';
        conv.portrait.region.meta = { source: '手动修改', seq: conv.intentSeq };
        refreshAutoPersonaNames(conv);
        commit();
        return true;
      },
      addRegion: function (spaceId, convId, code) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return { ok: false, reason: 'invalid' };
        if (knownCountryCodes().indexOf(code) === -1) return { ok: false, reason: 'unknown-region' };
        if (conv.portrait.region.selected.indexOf(code) !== -1) return { ok: false, reason: 'duplicate' };
        conv.intentSeq += 1;
        conv.portrait.region.selected.push(code);
        conv.portrait.region.source = '手动修改';
        conv.portrait.region.meta = { source: '手动修改', seq: conv.intentSeq };
        refreshAutoPersonaNames(conv);
        commit();
        return { ok: true };
      },
      removeRegion: function (spaceId, convId, code) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return { ok: false, reason: 'invalid' };
        var before = conv.portrait.region.selected.length;
        conv.portrait.region.selected = conv.portrait.region.selected.filter(function (c) { return c !== code; });
        if (conv.portrait.region.selected.length === before) return { ok: false, reason: 'not-found' };
        conv.intentSeq += 1;
        conv.portrait.region.source = '手动修改';
        conv.portrait.region.meta = { source: '手动修改', seq: conv.intentSeq };
        refreshAutoPersonaNames(conv);
        commit();
        return { ok: true };
      },
      setPersonaField: function (spaceId, convId, personaIndex, field, value) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return false;
        var persona = conv.portrait.personas[personaIndex];
        if (!persona || PERSONA_TEXT_FIELDS.indexOf(field) === -1) return false;
        if (!persona.meta) persona.meta = {};
        conv.intentSeq += 1;
        persona[field] = String(value == null ? '' : value);
        persona.meta[field] = { source: '手动修改', seq: conv.intentSeq };
        if (field === 'name') persona.nameManual = true;
        if (field === 'target' && !persona.nameManual) persona.name = autoPersonaName(persona.target, conv.portrait.region);
        schedulePersist();
        return true;
      },
      /** 按稳定 ID 写入（UI 与异步回复统一走这条，避免增删后写错画像）。 */
      setPersonaFieldById: function (spaceId, convId, personaId, field, value) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return false;
        var persona = conv.portrait.personas.filter(function (p) { return p.id === personaId; })[0];
        if (!persona || PERSONA_TEXT_FIELDS.indexOf(field) === -1) return false;
        if (!persona.meta) persona.meta = {};
        conv.intentSeq += 1;
        persona[field] = String(value == null ? '' : value);
        persona.meta[field] = { source: '手动修改', seq: conv.intentSeq };
        if (field === 'name') persona.nameManual = true;
        if (field === 'target' && !persona.nameManual) persona.name = autoPersonaName(persona.target, conv.portrait.region);
        schedulePersist();
        return true;
      },
      resetPersonaNameAuto: function (spaceId, convId, personaId) {
        var conv = findConversation(spaceId, convId);
        var persona = conv && conv.portrait && conv.portrait.personas.filter(function (p) { return p.id === personaId; })[0];
        if (!persona) return false;
        conv.intentSeq += 1;
        persona.nameManual = false;
        persona.name = autoPersonaName(persona.target, conv.portrait.region);
        schedulePersist();
        return true;
      },
      addPersona: function (spaceId, convId, draft) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return null;
        var persona = { id: uid('persona'), name: '新画像 ' + (conv.portrait.personas.length + 1), nameManual: false,
          target: '', topics: '', preference: '', audience: '', must: '', avoid: '', meta: {} };
        if (draft) {
          if (!String(draft.target || '').trim()) return null;
          conv.intentSeq += 1;
          ['target', 'topics', 'preference', 'audience', 'must', 'avoid'].forEach(function (field) {
            persona[field] = String(draft[field] || '').trim();
            if (persona[field]) persona.meta[field] = { source: '手动修改', seq: conv.intentSeq };
          });
          persona.name = String(draft.name || '').trim() || autoPersonaName(persona.target, conv.portrait.region);
          persona.nameManual = !!String(draft.name || '').trim();
        }
        conv.portrait.personas.push(persona);
        commit();
        return persona;
      },
      removePersonaById: function (spaceId, convId, personaId) {
        var conv = findConversation(spaceId, convId);
        if (!conv || !conv.portrait) return { ok: false, reason: 'invalid' };
        if (conv.portrait.personas.length <= 1) return { ok: false, reason: 'last-persona' }; // 至少保留一张
        var next = conv.portrait.personas.filter(function (p) { return p.id !== personaId; });
        if (next.length === conv.portrait.personas.length) return { ok: false, reason: 'not-found' };
        conv.portrait.personas = next;
        commit();
        return { ok: true };
      },

      // ---- 04 命名 / 05 创建 ----
      setDraftName: function (spaceId, convId, name) {
        var conv = findConversation(spaceId, convId);
        if (!conv) return false;
        conv.draftProjectName = String(name == null ? '' : name);
        conv.nameTouched = true; // 用户改过的名称不被后续模拟解析覆盖
        schedulePersist();
        return true;
      },
      /** 原子提交：创建项目 + 绑定会话 + 追加成功消息 + 名称同步。 */
      createProject: function (spaceId, convId, name, successBody) {
        var sd = state.spaces[spaceId];
        var conv = findConversation(spaceId, convId);
        if (!sd || !conv || conv.projectId || conv.stage !== 'parsed') return { ok: false, reason: 'invalid' };
        var projectId = uid('proj');
        sd.projects.push({ id: projectId, platform: conv.platform, name: name });
        conv.projectId = projectId;
        conv.title = name; // 最近会话 / 顶栏 / 项目名称同步
        conv.stage = 'project_created';
        conv.draftProjectName = name;
        conv.messages.push({ id: uid('msg'), role: 'agent', kind: 'created',
          title: name + ' 项目已创建', body: successBody });
        commit();
        return { ok: true, projectId: projectId };
      },

      // ---- 材料草稿（发送前，按空间 + 草稿ID隔离） ----
      getMaterials: function (spaceId, draftId) {
        var id = resolveDraftId(spaceId, draftId);
        return id ? (state.materialDrafts[spaceId + '::' + id] || []) : [];
      },
      addMaterial: function (spaceId, draftId, material) {
        var id = resolveDraftId(spaceId, draftId);
        if (!id) return null;
        var key = spaceId + '::' + id;
        var mat = sanitizeMaterial(material);
        if (!mat) return null;
        mat.id = mat.id || uid('mat');
        if (!state.materialDrafts[key]) state.materialDrafts[key] = [];
        if (state.materialDrafts[key].some(function (m) { return m.name === mat.name; })) return null; // 去重
        state.materialDrafts[key].push(mat);
        commit();
        return mat;
      },
      removeMaterial: function (spaceId, draftId, materialId) {
        var id = resolveDraftId(spaceId, draftId);
        if (!id) return false;
        var key = spaceId + '::' + id;
        var list = state.materialDrafts[key];
        if (!list) return false;
        state.materialDrafts[key] = list.filter(function (m) { return m.id !== materialId; });
        if (!state.materialDrafts[key].length) delete state.materialDrafts[key];
        commit();
        return true;
      },

      // ---- 既有：会话位置 / 草稿 / 切换 / 退出 ----
      getActiveConversationId: function (spaceId) {
        var vs = state.viewStates[spaceId || state.currentSpaceId];
        return vs ? vs.activeConversationId : null;
      },
      getActiveBlankDraftId: function (spaceId) {
        var vs = state.viewStates[spaceId || state.currentSpaceId];
        return vs ? vs.activeBlankDraftId : null;
      },
      getActiveDraftId: function (spaceId) {
        var vs = state.viewStates[spaceId || state.currentSpaceId];
        return vs ? (vs.activeConversationId || vs.activeBlankDraftId) : null;
      },
      openConversation: function (conversationId) {
        if (switching || state.signedOut) return;
        if (!findConversation(state.currentSpaceId, conversationId)) return;
        state.viewStates[state.currentSpaceId].activeConversationId = conversationId;
        commit();
      },
      openBlankSession: function () {
        if (switching || state.signedOut) return;
        var vs = state.viewStates[state.currentSpaceId];
        var id = newBlankDraftId(state.currentSpaceId);
        vs.activeConversationId = null;
        vs.activeBlankDraftId = id;
        vs.blankDraftIds.push(id);
        try { persist(); } catch (e) { schedulePersist(); }
        emitChange();
        return id;
      },
      getDraft: function (spaceId, conversationId) {
        var id = resolveDraftId(spaceId, conversationId);
        return id ? (state.drafts[draftKey(spaceId, id)] || '') : '';
      },
      setDraft: function (spaceId, conversationId, text) {
        var id = resolveDraftId(spaceId, conversationId);
        if (!id) return false;
        var key = draftKey(spaceId, id);
        if (text === '' || text == null) delete state.drafts[key];
        else state.drafts[key] = String(text);
        schedulePersist();
        return true;
      },
      flushDrafts: flushDrafts,

      switchSpace: switchSpace,
      isSwitching: function () { return !!switching; },
      getSwitchingTo: function () { return switching ? switching.to : null; },

      confirmLogout: function () {
        state.signedOut = true;
        try { persist(); } catch (e) { /* 内存态已退出；存储失败不阻断演示退出 */ }
        emitChange();
      },
      reenterDemo: function () {
        state.signedOut = false;
        try { persist(); } catch (e) { /* 同上 */ }
        emitChange();
      },

      onChange: function (fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (x) { return x !== fn; }); }; },

      // ---- 测试注入口（仅 tests 使用；产品代码不得调用） ----
      __setTransport: function (fn) { transport = fn || defaultTransport; },
      __resetTransport: function () { transport = defaultTransport; },
      __getSwitchSeq: function () { return switchSeq; },
      __clearSwitchingLockForTest: function () { switching = null; }
    };
    return store;
  }

  global.Store = { create: createStore, draftKey: draftKey };
})(window);
