'use strict';
/*
 * tests/site.test.js —— 存档地形 / 山体 / 可建造性
 *
 * 可建造性走的是游戏同一套规则：建筑的 terrainAffordanceNeeded
 * 必须在该格地形的 affordance 列表里（游戏的 GenConstruct.CanBuildOnTerrain）。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Site = app.RWSite;
const Data = app.RWData;

/** 铺一张地形图：fn(x,z) 返回地形 defName（返回空 = 该格无地形数据）。 */
function terrain(fn, w, h) {
  w = w || 20; h = h || 20;
  H.resetMap(w, h);
  const names = new Set();
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const n = fn(x, z);
      if (n) names.add(n);
    }
  }
  const fill = {};
  for (const n of names) fill[n] = (x, z) => fn(x, z) === n;
  return H.setTerrain(w, h, fill);
}

// ---------------------------------------------------------------- 基础
test('地形：没有存档数据时什么都放得下', () => {
  H.resetMap(20, 20);
  const r = Site.checkBuilding('wall', 5, 5, 0);
  assert.strictEqual(r.ok, true);
});

test('地形：普通土壤上墙、灯、床都能放', () => {
  terrain(() => 'Soil');
  assert.strictEqual(Site.checkBuilding('wall', 5, 5, 0).ok, true);
  assert.strictEqual(Site.checkBuilding('wall_lamp', 5, 5, 0).ok, true);
  assert.strictEqual(Site.checkBuilding('bed', 5, 5, 0).ok, true);
});

// ---------------------------------------------------------------- affordance
test('地形：沼泽只有 Light，撑不住墙（要 Heavy）', () => {
  terrain(() => 'MarshyTerrain');
  const wall = Site.checkBuilding('wall', 5, 5, 0);
  assert.strictEqual(wall.ok, false);
  assert.strictEqual(wall.cells.length, 1);
  assert.ok(/撑不住/.test(wall.why), '要说清是地形撑不住：' + wall.why);

  // 但 Light 的建筑放得下
  assert.strictEqual(Site.checkBuilding('wall_lamp', 5, 5, 0).ok, true);
  assert.strictEqual(Site.checkBuilding('bed', 5, 5, 0).ok, true);
});

test('地形：软沙只有 Light，撑不住墙', () => {
  terrain(() => 'SoftSand');
  assert.strictEqual(Site.checkBuilding('wall', 5, 5, 0).ok, false);
  assert.strictEqual(Site.checkBuilding('conduit', 5, 5, 0).ok, true);
});

test('地形：深水什么建筑都放不下', () => {
  terrain(() => 'WaterDeep');
  assert.strictEqual(Site.checkBuilding('wall', 5, 5, 0).ok, false);
  assert.strictEqual(Site.checkBuilding('wall_lamp', 5, 5, 0).ok, false);
});

test('地形：浅水能铺桥（Bridge 是 Light）', () => {
  terrain(() => 'WaterShallow');
  const bridge = Site.checkFloor('bridge', 5, 5);
  assert.strictEqual(bridge.ok, true, '木桥应该能铺在浅水上');
});

test('地形：混凝土能撑住重型建筑', () => {
  terrain(() => 'Concrete');
  assert.strictEqual(Site.checkBuilding('wall', 5, 5, 0).ok, true);
});

test('地形：多格建筑会逐格检查，占到坏格子就整体不行', () => {
  // 左半边是沼泽（只有 Light），右半边是土壤
  terrain((x) => (x < 3 ? 'MarshyTerrain' : 'Soil'), 10, 10);
  // 3×1 的石匠台要 Heavy
  const bad = Site.checkBuilding('stonecutter', 2, 5, 0);   // 覆盖 (2,5)(3,5)(4,5)
  assert.strictEqual(bad.ok, false);
  assert.strictEqual(bad.cells.length, 1, '只有落在沼泽上的那一格不行');

  const good = Site.checkBuilding('stonecutter', 5, 5, 0);  // 全部在土壤上
  assert.strictEqual(good.ok, true);
});

// ---------------------------------------------------------------- 山体
test('山体：有矿石的格子要先开采', () => {
  terrain(() => 'Soil');
  H.setRocks(20, 20, { '5,5': 'Granite' });
  const r = Site.checkBuilding('wall', 5, 5, 0);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.rockCells.length, 1);
  assert.ok(/开采/.test(r.why), '提示要说要先开采：' + r.why);
});

test('山体：山体上的建筑会被校验统计成「要先开采」', () => {
  terrain(() => 'Soil');
  H.setRocks(20, 20, { '5,5': 'Granite' });
  RW.placeBuilding('wall', 5, 5, 0, { ignoreTerrain: true });
  const rep = app.RWChecks.analyse(RW.state);
  const t = rep.issues.filter((i) => i.kind === 'terrain');
  assert.ok(t.length > 0, '应该报出山体问题');
  assert.ok(/开采/.test(t[0].msg));
});

// ---------------------------------------------------------------- 地板
test('地板：沼泽上铺不了需要 Heavy 的地板', () => {
  terrain(() => 'MarshyTerrain');
  const r = Site.checkFloor('tileSandstone', 5, 5);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.kind, 'terrain');
});

test('地板：土 / 水这种「观感地板」不参与可建造性检查', () => {
  terrain(() => 'WaterDeep');
  assert.strictEqual(Site.checkFloor('none', 5, 5).ok, true);
  assert.strictEqual(Site.checkFloor('water', 5, 5).ok, true);
});
