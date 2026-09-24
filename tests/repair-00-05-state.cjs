// Browser-independent check of the existing 00–05 state rules.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', 'js');
const data = new Map();
const window = {
  localStorage: {
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value))
  }
};
const context = vm.createContext({ window, setTimeout, clearTimeout, console });
for (const name of ['fixtures.js', 'simulation.js', 'store.js', 'ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), context, { filename: name });
}

async function run() {
  const store = window.Store.create();
  const team = window.Fixtures.defaultSpaceId;
  const personal = window.Fixtures.spaces.find(space => space.id !== team).id;
  const blank = store.getActiveBlankDraftId(team);
  store.setDraft(team, blank, '团队未发送需求');
  await store.switchSpace(personal);
  assert.equal(store.getDraft(personal, store.getActiveBlankDraftId(personal)), '');
  store.setDraft(personal, store.getActiveBlankDraftId(personal), '个人未发送需求');
  await store.switchSpace(team);
  assert.equal(store.getDraft(team, blank), '团队未发送需求');

  const text = '我们做便携咖啡机，想找美国户外类 Instagram 达人，需要邮箱。';
  const conv = store.createConversation(team, blank, text, [], window.SIM.extract(text));
  assert.equal(store.getDraft(team, blank), '');
  const parseId = conv.messages[1].id;
  window.SIM.__config.parseDelay = 0;
  const parsed = await window.SIM.parseRequest(text);
  assert.equal(parsed.ok, true);
  assert.equal(store.applyParseResult(team, conv.id, parseId, parsed), true);
  assert.equal(conv.stage, 'parsed');
  assert.ok(conv.portrait.region.selected.length);
  const originalRegion = conv.portrait.region.selected.slice();
  const alternateRegion = window.Fixtures.countryList.find(([code]) => !originalRegion.includes(code))[0];
  assert.equal(store.setRegionSelection(team, conv.id, [alternateRegion]), true);
  assert.equal(conv.portrait.region.selected.join(','), alternateRegion);

  const oldIntent = store.claimIntent(team, conv.id);
  store.setPortraitField(team, conv.id, 'brand', '用户最新品牌');
  assert.equal(store.applyCommandPatch(team, conv.id,
    { field: 'brand', value: '过时回复' }, oldIntent).applied, false);
  assert.equal(conv.portrait.fields.brand, '用户最新品牌');
  const originalPersona = conv.portrait.personas[0];
  const countBeforeDraft = conv.portrait.personas.length;
  const draftCard = window.UI.renderPortraitPanel(store, conv, {}, 'edit', null,
    { name: '', target: '旅行内容创作者', topics: '', preference: '', audience: '', must: '', avoid: '' });
  assert.ok(draftCard.includes('完成添加'));
  assert.ok(draftCard.includes('筛选条件'));
  assert.match(draftCard, /class="pp-confirm"[^>]*disabled/);
  assert.equal(conv.portrait.personas.length, countBeforeDraft);
  const completed = store.addPersona(team, conv.id, { name: '', target: '旅行内容创作者' });
  assert.equal(completed.name, '旅行内容创作者');
  assert.equal(conv.portrait.personas.length, countBeforeDraft + 1);
  store.setPersonaFieldById(team, conv.id, completed.id, 'target', '分享数码产品的创作者');
  assert.ok(completed.name.endsWith('3C达人'));
  store.setPersonaFieldById(team, conv.id, completed.id, 'name', '用户命名');
  store.setPersonaFieldById(team, conv.id, completed.id, 'target', '分享游戏内容的创作者');
  assert.equal(completed.name, '用户命名');
  store.resetPersonaNameAuto(team, conv.id, completed.id);
  assert.ok(completed.name.endsWith('游戏达人'));
  const extra = store.addPersona(team, conv.id);
  assert.ok(extra);
  store.setPersonaFieldById(team, conv.id, extra.id, 'target', '长内容'.repeat(80));
  assert.equal(conv.portrait.personas.find(p => p.id === extra.id).target.length, 240);
  const reading = window.UI.renderPortraitPanel(store, conv, {}, 'edit', null);
  assert.ok(reading.includes('长内容'.repeat(80)));
  const editing = window.UI.renderPortraitPanel(store, conv, {}, 'edit',
    { kind: 'field', kp: `persona:${extra.id}:target` });
  assert.ok(editing.includes('textarea class="pp-field-edit"'));
  if (conv.portrait.personas.length > 2) {
    assert.equal(store.removePersonaById(team, conv.id, originalPersona.id).ok, true);
  }
  while (conv.portrait.personas.length > 1) {
    assert.equal(store.removePersonaById(team, conv.id, conv.portrait.personas[0].id).ok, true);
  }
  assert.equal(store.removePersonaById(team, conv.id, conv.portrait.personas[0].id).reason, 'last-persona');

  store.setDraftName(team, conv.id, '户外咖啡达人');
  const teamBefore = store.getProjects(team).length;
  const personalBefore = store.getProjects(personal).length;
  window.SIM.__config.createDelay = 0;
  window.SIM.__config.createFail = 1;
  assert.equal((await window.SIM.createProjectRequest()).ok, false);
  assert.equal(conv.draftProjectName, '户外咖啡达人');
  assert.equal(store.getProjects(team).length, teamBefore);
  assert.equal((await window.SIM.createProjectRequest()).ok, true);
  assert.equal(store.createProject(team, conv.id, conv.draftProjectName, '已创建').ok, true);
  assert.equal(store.createProject(team, conv.id, conv.draftProjectName, '重复').ok, false);
  assert.equal(store.getProjects(team).length, teamBefore + 1);
  assert.equal(store.getProjects(personal).length, personalBefore);
  assert.equal(conv.stage, 'project_created');
  assert.equal(conv.title, '户外咖啡达人');
  console.log('00–05 state rules: PASS');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
