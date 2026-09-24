/*
 * Creator Scout 独立首页原型 · 本地模拟适配层（simulation）
 *
 * 本模块是 00–05 流程的演示“后端”：从用户输入中用关键词规则提取画像草稿，
 * 并以带延时的 Promise 模拟发送 / 解析 / 修改 / 创建项目等异步操作。
 * 不实现通用自然语言理解；未支持的表达会明确引导用户直接编辑画像。
 *
 * 诚实性约定：
 *   - 用户输入原样进入历史消息，本模块只生成“演示解析结果”；
 *   - 材料内容不做真实解析，不把任何字段标成“材料提取”；
 *   - 修改回复只声称实际生效的字段；被更新的手动修改覆盖时不声称成功。
 *
 * 测试注入口：window.__creatorScoutSim（config + reset），产品界面无调试开关。
 */
(function (global) {
  'use strict';

  var Fixtures = global.Fixtures;
  var DEMO = Fixtures.simCase;

  var config = {
    sendDelay: 400, parseDelay: 1400, modDelay: 700, createDelay: 900,
    sendFail: 0, parseFail: 0, createFail: 0, modFail: 0 // 失败次数（每次请求消耗 1 次，>0 时失败）
  };

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  /** 计数型失败钩子：失败次数 >0 时本次请求失败并消耗一次。 */
  function shouldFail(kind) {
    if (config[kind + 'Fail'] > 0) { config[kind + 'Fail'] -= 1; return true; }
    return false;
  }

  // ------------------------------------------------------------------
  // 同步提取：从用户文本生成演示画像草稿（不 await，供会话创建时立即取标题）
  // ------------------------------------------------------------------
  /**
   * 地区识别：只在能明确映射到国家／地区字典时才返回代码。
   * 无法识别的输入返回 null——调用方不得把它伪装成有效选项。
   */
  function matchRegion(text) {
    text = String(text || '');
    var rules = Fixtures.regionRules || [];
    for (var i = 0; i < rules.length; i++) {
      for (var j = 0; j < rules[i].words.length; j++) {
        if (text.indexOf(rules[i].words[j]) !== -1) return rules[i].codes.slice();
      }
    }
    for (var k = 0; k < Fixtures.countryList.length; k++) {
      if (text.indexOf(Fixtures.countryList[k][1]) !== -1) return [Fixtures.countryList[k][0]];
    }
    return null;
  }

  function regionLabel(codes) {
    return (codes || []).map(function (c) { return Fixtures.countryMap[c] || c; }).join('、');
  }

  function extract(text) {
    text = String(text || '');
    var demo = DEMO.match.test(text);
    var codes = matchRegion(text);
    var country = codes ? regionLabel(codes) : null;
    var product = null;
    var pm = text.match(/(?:我们做|我在做|我们推广|推广的是?|卖的是?)([一-龥A-Za-z0-9 ]{2,14}?)[，,。.、\s]/);
    if (pm) product = pm[1].trim();
    var brand = null;
    var bm = text.match(/品牌(?:是|叫|为|：:)\s*([一-龥A-Za-z0-9 ]{2,20}?)[，,。.、\s]/);
    if (bm) brand = bm[1].trim();
    var direction = null;
    var dm = text.match(/找([一-龥A-Za-z0-9 ]{2,16}?)类?(?:Instagram|IG)?\s*达人/);
    if (dm) {
      direction = dm[1].replace(new RegExp(country || '@@'), '').replace(/^(的|一些|相关)/, '').trim();
    }

    // 目标国家／地区为结构化数据（代码列表），不再用自由文本充当有效地区
    var region = { selected: codes || [], source: codes ? '用户提供' : '' };

    var fields = {
      brand: brand || (demo ? DEMO.brand : '') || '',
      product: product || (demo ? DEMO.product : '') || '',
      coreValue: demo ? DEMO.coreValue : '',
      targetUsers: demo ? DEMO.targetUsers : '',
      usageScenarios: demo ? DEMO.usageScenarios : '',
      marketingGoal: demo ? DEMO.marketingGoal : ''
    };
    // 来源：输入文本直接提供的字段 → 用户提供；演示补全的字段 → AI建议
    var meta = {
      brand: brand ? { source: '用户提供' } : (demo ? { source: 'AI建议' } : null),
      product: product ? { source: '用户提供' } : (demo ? { source: '用户提供' } : null),
      coreValue: demo ? { source: 'AI建议' } : null,
      targetUsers: demo ? { source: 'AI建议' } : null,
      usageScenarios: demo ? { source: 'AI建议' } : null,
      marketingGoal: demo ? { source: 'AI建议' } : null
    };

    var personas;
    if (demo) {
      personas = DEMO.personas.map(function (p) {
        return { name: p.name, target: p.target, topics: p.topics, preference: p.preference,
          audience: p.audience, must: p.must, avoid: p.avoid, meta: {} };
      });
    } else {
      personas = [{
        name: direction ? direction + '画像' : '目标达人画像',
        target: direction ? '分享' + direction + '相关内容的创作者' : '',
        topics: '', preference: '', audience: '', must: '', avoid: '', meta: {}
      }];
    }

    // 本轮任务条件（仅保留用户明确提到的）
    var conditions = [];
    var cm = text.match(/先找\s*(\d+)\s*(?:个|位)/) || text.match(/找\s*(\d+)\s*(?:个|位)/);
    if (cm) conditions.push(cm[1] + ' 人');
    var fm = text.match(/粉丝\s*(\d+(?:\.\d+)?)\s*万?\s*[到至~\-—]\s*(\d+(?:\.\d+)?)\s*万/);
    if (fm) conditions.push(fm[1] + ' 万–' + fm[2] + ' 万粉丝');
    if (/邮箱/.test(text)) conditions.push('需要邮箱');

    var title;
    if (demo) title = DEMO.conversationTitle;
    else if (product) title = product + '达人探索';
    else if (direction) title = direction + '达人探索';
    else title = 'Instagram 达人探索';

    return {
      demo: demo,
      title: title,
      suggestedProjectName: brand || (demo ? DEMO.suggestedProjectName : '') || product || '新项目',
      direction: demo ? DEMO.direction : (direction ? direction + '内容创作者' : ''),
      fields: fields, fieldMeta: meta, region: region, personas: personas, conditions: conditions
    };
  }

  // ------------------------------------------------------------------
  // 异步模拟操作
  // ------------------------------------------------------------------
  function sendRequest() {
    return delay(config.sendDelay).then(function () {
      return { ok: !shouldFail('send') };
    });
  }

  /** 解析：返回画像草稿与 02 卡片文案。 */
  function parseRequest(userText) {
    return delay(config.parseDelay).then(function () {
      if (shouldFail('parse')) return { ok: false };
      var r = extract(userText);
      var regionText = regionLabel(r.region.selected);
      // 02 聚焦三点：产品与目标市场 / 建议达人类型及理由 / 一个主要操作
      var summary = [];
      if (r.fields.brand || r.fields.product) {
        summary.push({ label: '品牌与产品', value: [r.fields.brand, r.fields.product].filter(Boolean).join(' · ') });
      }
      summary.push({ label: '目标市场', value: regionText || '未指定' });
      if (r.direction) summary.push({ label: '达人方向', value: r.direction });
      var brandLine = r.fields.brand || '你的产品';
      var body = brandLine + ' 正在推广' + (r.fields.product || '产品') + '，希望在' +
        (regionText || '目标市场') + '寻找' + (r.direction || '合适的') + ' Instagram 创作者。\n' +
        regionText
          ? '理由：这类创作者的受众与上述市场重合，内容场景也更容易呈现产品用途。'
          : '目标市场还需要你补充，补充后这些会成为项目后续判断达人是否合适的长期标准。';
      return {
        ok: true,
        title: r.title,
        suggestedProjectName: r.suggestedProjectName,
        portraitDraft: { fields: r.fields, fieldMeta: r.fieldMeta, region: r.region, personas: r.personas, intentSeq: 0 },
        guidance: {
          title: '我理解到的目标',
          body: body,
          summary: summary,
          unverified: r.region.selected.length ? null : {
            title: '尚未核实',
            body: '演示解析未从你的输入中识别出可确认的国家／地区；附件与链接内容本轮不做真实解析，也不会标成已读取。'
          }
        },
        conditions: r.conditions
      };
    });
  }

  /** 对话修改请求：延时后返回是否放行（真实生效由 store 的字段意图序号守卫决定）。 */
  function modRequest() {
    return delay(config.modDelay).then(function () {
      return { ok: !shouldFail('mod') };
    });
  }

  function createProjectRequest() {
    return delay(config.createDelay).then(function () {
      return { ok: !shouldFail('create') };
    });
  }

  // ------------------------------------------------------------------
  // 修改表达解析：仅支持 README 列出的明确表达
  // ------------------------------------------------------------------
  var MOD_PATTERNS = [
    { re: /^(?:目标市场|目标国家|市场|地区)(?:名)?(?:改成|改为|换成|设为|修改为)\s*(.+?)[。.!！]?$/, field: 'region', label: '目标市场' },
    { re: /^品牌(?:名)?(?:改成|改为|换成|设为|修改为)\s*(.+?)[。.!！]?$/, field: 'brand', label: '品牌' },
    { re: /^目标达人(?:改成|改为|换成|设为|修改为)\s*(.+?)[。.!！]?$/, field: 'personaTarget', label: '目标达人' }
  ];

  /**
   * 返回：
   *   { matched: true, field, label, value, personaIndex? }
   *   { matched: false, looksLikeChange: true }  —— 含“改成”但字段不支持，引导直接编辑
   *   null —— 普通消息
   */
  function interpretModification(text) {
    text = String(text || '').trim();
    for (var i = 0; i < MOD_PATTERNS.length; i++) {
      var m = text.match(MOD_PATTERNS[i].re);
      if (m) {
        return { matched: true, field: MOD_PATTERNS[i].field, label: MOD_PATTERNS[i].label,
          value: m[1].trim(), personaIndex: MOD_PATTERNS[i].personaIndex };
      }
    }
    if (/改成|改为|换成|更改为/.test(text)) return { matched: false, looksLikeChange: true };
    return null;
  }

  global.SIM = {
    extract: extract,
    sendRequest: sendRequest,
    parseRequest: parseRequest,
    modRequest: modRequest,
    createProjectRequest: createProjectRequest,
    interpretModification: interpretModification,
    matchRegion: matchRegion,
    regionLabel: regionLabel,
    __config: config,
    __reset: function () {
      config.sendDelay = 400; config.parseDelay = 1400; config.modDelay = 700; config.createDelay = 900;
      config.sendFail = 0; config.parseFail = 0; config.createFail = 0; config.modFail = 0;
    }
  };

  // 测试注入口（仅自动化测试使用）
  global.__creatorScoutSim = { config: config, reset: global.SIM.__reset };
})(window);
