'use strict';
/*
 * tests/data.test.js —— 建筑数据库本身的质量
 *
 * 数据是从游戏 Defs 里提取的，这几条测试守住「库里的东西是可信的」：
 *  - 每条都有名字 / 尺寸 / 分类
 *  - 游戏里玩家造不出来的东西（飞船 / 轨道 / 剧情）要标出来，别混进物品栏
 *  - 分类别再是一个 100 多条的「杂项」大杂烩
 *  - 造价 / 工时 / 科技这些字段该有的地方得有
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const D = app.RWData;
const ids = Object.keys(D.byId);

test('数据：每条都有名字、尺寸、分类', () => {
  for (const id of ids) {
    const d = D.byId[id];
    assert.ok(d.name, id + ' 缺名字');
    assert.ok(Array.isArray(d.size) && d.size.length === 2, id + ' 缺尺寸');
    assert.ok(d.size[0] >= 1 && d.size[1] >= 1, id + ' 尺寸不合法');
    assert.ok(d.cat, id + ' 缺分类');
  }
});

test('数据：分类都在已知的分类表里', () => {
  const cats = D.CATEGORIES.map((c) => c.id);
  for (const id of ids) {
    assert.ok(cats.indexOf(D.byId[id].cat) >= 0, id + ' 的分类 ' + D.byId[id].cat + ' 不在表里');
  }
});

test('数据：玩家造不出来的东西要标 noBuild 并单独归类', () => {
  const nb = ids.filter((id) => D.byId[id].noBuild);
  assert.ok(nb.length > 0, '应该能识别出一些不可建造的条目');
  for (const id of nb) {
    assert.strictEqual(D.byId[id].cat, 'special', id + ' 应该归到 special');
  }
  // 船、轨道、剧情道具这些一定要在里面
  for (const id of ['Ship_Reactor', 'Ship_Beam', 'GravshipHull', 'PassengerShuttle', 'TransportPod', 'OrbitalScanner']) {
    assert.ok(D.byId[id], id + ' 应该存在于库里');
    assert.strictEqual(D.byId[id].noBuild, 1, id + ' 应该标记为不可建造');
  }
});

test('数据：常见的墙体家具不能被误判成不可建造', () => {
  for (const id of ['wall', 'door', 'bed', 'table_2x2', 'solar_generator', 'cooler', 'wind_turbine', 'mini_turret']) {
    assert.ok(D.byId[id], id + ' 应该存在');
    assert.ok(!D.byId[id].noBuild, id + ' 不该被标成不可建造');
  }
});

test('数据：分类别再是一个大杂烩', () => {
  const byCat = {};
  for (const id of ids) {
    (byCat[D.byId[id].cat] = byCat[D.byId[id].cat] || []).push(id);
  }
  assert.ok(byCat.misc.length <= 40, '「杂项」还有 ' + byCat.misc.length + ' 条，太多了');
  // 细分出来的几类应该有东西
  for (const c of ['statue', 'ritual', 'funeral', 'tech']) {
    assert.ok(byCat[c] && byCat[c].length > 0, '分类 ' + c + ' 是空的');
  }
});

test('数据：主要建筑都要有造价或工时，估算面板才准', () => {
  // 这些是玩家天天要造的，不该缺数据
  const important = ['wall', 'door', 'bed', 'table_2x2', 'cooler', 'heater', 'solar_generator',
    'wind_turbine', 'battery', 'conduit', 'research_bench', 'hi_tech_research_bench',
    'stove_electric', 'sandbags', 'mini_turret', 'nutrient_dispenser', 'hydroponics'];
  for (const id of important) {
    const d = D.byId[id];
    assert.ok(d, id + ' 应该存在');
    const hasCost = (d.cost && Object.keys(d.cost).length) || d.costStuff;
    assert.ok(hasCost || d.work, id + ' 既没有造价也没有工时');
  }
});

test('数据：图标别再一堆通用方块', () => {
  const generic = ids.filter((id) => D.byId[id].art === 'generic');
  // 只剩下造不出来的东西（飞船件）用通用图标是可以的
  const bad = generic.filter((id) => !D.byId[id].noBuild);
  assert.ok(bad.length <= 5, '还有 ' + bad.length + ' 条可建造的东西是通用图标：' + bad.join(' '));
});

test('数据：游戏里能建的地形都要在地板表里', () => {
  // 这三条按 RimWorld 1.7 的 TerrainDef 补齐（数值来自游戏 defs）
  const heavyBridge = D.floorsById['heavyBridge'];
  assert.ok(heavyBridge, '应该有重型桥');
  assert.strictEqual(heavyBridge.def, 'HeavyBridge');
  assert.strictEqual(heavyBridge.aff, 'Bridgeable', '重型桥和普通桥一样要求 Bridgeable');
  assert.deepStrictEqual(H.plain(heavyBridge.cost), { Steel: 14 });
  assert.strictEqual(heavyBridge.work, 2500);
  assert.deepStrictEqual(H.plain(heavyBridge.research), ['HeavyBridges']);

  const plate = D.floorsById['bioferritePlate'];
  assert.ok(plate, '应该有活铁板');
  assert.strictEqual(plate.def, 'BioferritePlate');
  assert.deepStrictEqual(H.plain(plate.cost), { Bioferrite: 4 });
  assert.strictEqual(plate.work, 800);

  const sub = D.floorsById['substructure'];
  assert.ok(sub, '应该有逆重亚结构');
  assert.strictEqual(sub.def, 'Substructure');
  assert.deepStrictEqual(H.plain(sub.cost), { GravlitePanel: 1, Steel: 4 });
  assert.strictEqual(sub.work, 600);
});

test('数据：材料名表能查到建造材料', () => {
  assert.ok(D.ITEM_NAMES, '应该有材料中文名表');
  for (const k of ['Steel', 'WoodLog', 'BlocksSandstone', 'Gold', 'Plasteel', 'ComponentIndustrial']) {
    assert.ok(D.ITEM_NAMES[k], '材料 ' + k + ' 没有中文名');
  }
});

test('数据：科技表能查到建筑的前置科技', () => {
  const r = D.researches();
  const bed = D.byId['bed'];
  if (bed.research && bed.research.length) {
    for (const tech of bed.research) {
      assert.ok(r[tech], '科技 ' + tech + ' 不在科技表里');
      assert.ok(r[tech].name, '科技 ' + tech + ' 没有中文名');
    }
  }
});
