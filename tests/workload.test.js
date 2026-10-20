'use strict';
/*
 * tests/workload.test.js —— 可行性 / 材料 / 工期估算
 *
 * 估算是本工具自己的近似模型（见 js/workload.js 顶部的公式说明），
 * 这里锁住的是「算法行为」：材料缺口、科技前置、技能门槛、结论。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Work = app.RWWork;
const Data = app.RWData;

/** 造一个「有存档情报」的状态。 */
function withSave(saveInfo) {
  H.resetMap(40, 40);
  RW.state.saveInfo = saveInfo;
  return RW.state;
}

const BASE_SAVE = {
  difficulty: 'Community Builder',
  pawns: [
    { name: '老王', dead: false, traits: ['Industrious'], skills: { Construction: { level: 10, passion: 'None' } } },
    { name: '小李', dead: false, traits: [], skills: { Construction: { level: 4, passion: 'None' } } },
  ],
  research: { current: null, progress: {} },
  resources: {},
  resourcesHome: {},
  resourcesAll: {},
};

// ---------------------------------------------------------------- 材料
test('估算：材料不够时能算出缺口', () => {
  withSave(H.plain(BASE_SAVE));
  for (let i = 0; i < 10; i++) RW.placeBuilding('wall', i, 5, 0, { stuff: 'Steel' });

  const rep = Work.analyse(RW.state, {});
  const steel = rep.materials.find((m) => m.def === 'Steel');
  assert.ok(steel, '应该有钢铁这一项');
  assert.strictEqual(steel.need, 50, '10 面钢墙 × 5 块钢 = 50');
  assert.strictEqual(steel.have, 0);
  assert.strictEqual(steel.short, 50);
  assert.strictEqual(rep.missingMats.length, 1);
  assert.strictEqual(rep.verdict, 'partial', '材料不够应该是「有条件」');
});

test('估算：库存够了就没有缺口', () => {
  const save = H.plain(BASE_SAVE);
  save.resources = { Steel: 500 };
  withSave(save);
  for (let i = 0; i < 10; i++) RW.placeBuilding('wall', i, 5, 0, { stuff: 'Steel' });

  const rep = Work.analyse(RW.state, {});
  assert.strictEqual(rep.missingMats.length, 0);
  assert.strictEqual(rep.verdict, 'ok', '应该判定为「能建」');
});

test('估算：锁定的存档原有建筑不计入需求', () => {
  withSave(H.plain(BASE_SAVE));
  for (let i = 0; i < 10; i++) RW.placeBuilding('wall', i, 5, 0, { stuff: 'Steel', locked: true });

  const rep = Work.analyse(RW.state, {});
  assert.strictEqual(rep.items.length, 0, '锁定的建筑不该进估算');
  assert.strictEqual(rep.materials.length, 0);
});

// ---------------------------------------------------------------- 工期
test('估算：工时换算成天数', () => {
  withSave(H.plain(BASE_SAVE));
  for (let i = 0; i < 10; i++) RW.placeBuilding('wall', i, 5, 0, { stuff: 'Steel' });

  const rep = Work.analyse(RW.state, { builders: 1, workHours: 16, haulOverhead: 0 });
  assert.ok(rep.work.totalWork > 0, '应该有总工时');
  assert.ok(rep.work.buildDays > 0, '应该算出建造天数');
  // 1 游戏日 = 60000 tick
  assert.ok(Math.abs(rep.work.buildTicks / 60000 - rep.work.buildDays) < 1e-9);
});

test('估算：建造人数越多工期越短', () => {
  withSave(H.plain(BASE_SAVE));
  for (let i = 0; i < 20; i++) RW.placeBuilding('wall', i, 5, 0, { stuff: 'Steel' });

  const one = Work.analyse(RW.state, { builders: 1 });
  const two = Work.analyse(RW.state, { builders: 2 });
  assert.ok(two.work.buildDays < one.work.buildDays, '两个人应该比一个人快');
});

// ---------------------------------------------------------------- 科技
test('估算：缺前置科技会列出来', () => {
  const save = H.plain(BASE_SAVE);
  withSave(save);
  // 精密装配台要 ComplexFurniture 之类的科技
  RW.placeBuilding('fabrication_bench', 5, 5, 0);

  const rep = Work.analyse(RW.state, {});
  const need = rep.items.find((it) => it.name && /装配台|工作台/.test(it.name));
  assert.ok(need, '应该有工作台这一项');
  assert.ok(Object.keys(need.research || {}).length > 0, '工作台应该有科技前置');
  assert.ok(rep.research.lines.length > 0, '应该列出缺的科技');
  assert.strictEqual(rep.research.done, false);
  assert.strictEqual(rep.verdict, 'partial', '缺科技应该是「有条件」');
});

test('估算：科技已经研究完就不算缺口', () => {
  const save = H.plain(BASE_SAVE);
  const res = Data.researches ? Data.researches() : {};
  const need = Object.keys(res).find((d) => /ComplexFurniture/.test(d));
  if (!need) return;   // 这版游戏数据里没这个科技，跳过
  save.research.progress = { [need]: (res[need].cost || 100) };
  withSave(save);
  RW.placeBuilding('fabrication_bench', 5, 5, 0);

  const rep = Work.analyse(RW.state, {});
  const line = rep.research.lines.find((l) => l.def === need);
  assert.ok(!line || line.remain <= 0, '研究完的科技不该还有剩余');
});

// ---------------------------------------------------------------- 技能
test('估算：技能门槛不够时判定为「建不了」', () => {
  const save = H.plain(BASE_SAVE);
  // 把所有小人的建造技能压到 0
  save.pawns.forEach((p) => { p.skills.Construction = { level: 0, passion: 'None' }; });
  withSave(save);
  RW.placeBuilding('hi_tech_research_bench', 5, 5, 0);   // 需要建造技能 10

  const rep = Work.analyse(RW.state, {});
  assert.strictEqual(rep.skill.ok, false, '技能不够应该判定不可行');
  assert.strictEqual(rep.verdict, 'blocked');
});

test('估算：地形撑不住时判定为「建不了」', () => {
  withSave(H.plain(BASE_SAVE));
  H.setTerrain(40, 40, { MarshyTerrain: () => true });
  RW.placeBuilding('wall', 5, 5, 0, { ignoreTerrain: true });

  const rep = Work.analyse(RW.state, {});
  assert.ok(rep.terrain.terrainCells.length > 0, '应该统计出撑不住的地形');
  assert.strictEqual(rep.verdict, 'blocked');
});
