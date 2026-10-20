'use strict';
/*
 * tests/geometry.test.js —— 占地、朝向、坐标系换算
 *
 * 这几处是最容易出现「游戏里摆歪了」的隐性 bug：
 *   · footprint()      旋转后的占地宽高
 *   · anchorOffset()   游戏 OccupiedRect 的「中心格 → 最小角」偏移
 *   · flipX / flipZ    编辑器坐标 ↔ 游戏坐标的翻转
 * 改这几处之前请先读 docs/import-export.md「坐标与朝向」一节。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Data = app.RWData;
const IO = app.RWIo;
const X = app.RWExport;

// ---------------------------------------------------------------- 占地
test('占地：1x1 建筑旋转后尺寸不变', () => {
  const wall = Data.byId['wall'];
  for (const rot of [0, 90, 180, 270]) {
    assert.deepStrictEqual(H.plain(RW.footprint(wall, rot)), [1, 1]);
  }
});

test('占地：1x2 的床转 90° 后变成 2x1', () => {
  const bed = Data.byId['bed'];
  assert.deepStrictEqual(H.plain(RW.footprint(bed, 0)), [1, 2]);
  assert.deepStrictEqual(H.plain(RW.footprint(bed, 90)), [2, 1]);
  assert.deepStrictEqual(H.plain(RW.footprint(bed, 180)), [1, 2]);
  assert.deepStrictEqual(H.plain(RW.footprint(bed, 270)), [2, 1]);
});

test('占地：2x1 的置物架转 90° 后变成 1x2', () => {
  const shelf = Data.byId['shelf'];
  assert.deepStrictEqual(H.plain(RW.footprint(shelf, 0)), [2, 1]);
  assert.deepStrictEqual(H.plain(RW.footprint(shelf, 90)), [1, 2]);
});

test('占地：不可旋转的建筑（墙 / 太阳能 / 桌子）永远按原尺寸摆', () => {
  for (const id of ['wall', 'solar_generator', 'table_2x2']) {
    const def = Data.byId[id];
    assert.strictEqual(def.rotatable, false, id + ' 应该是不可旋转的');
    for (const rot of [0, 90, 180, 270]) {
      assert.deepStrictEqual(H.plain(RW.footprint(def, rot)), H.plain(def.size), id + ' rot=' + rot);
    }
  }
});

// ---------------------------------------------------------------- anchorOffset
test('锚点：1x1 的偏移永远是 0（pos 就是它自己）', () => {
  for (const rot of [0, 1, 2, 3]) {
    assert.deepStrictEqual(H.plain(RW.anchorOffset(rot, 1, 1)), { x: 0, z: 0 });
  }
});

test('锚点：黄金值（改公式前请先对照游戏验证）', () => {
  // 这些是当前实现的取值。docs/import-export.md 说这套偏移在真实存档
  // 的 764 个建筑上「冲突 0 格」，改动前务必重新对照游戏核实。
  const cases = [
    [0, 2, 1, { x: 0, z: 0 }],
    [0, 1, 2, { x: 0, z: 0 }],
    [0, 2, 2, { x: 0, z: 0 }],
    [1, 2, 2, { x: 0, z: 1 }],
    [2, 2, 2, { x: 1, z: 1 }],
    [3, 2, 2, { x: 1, z: 0 }],
    [0, 3, 3, { x: 1, z: 1 }],
    [0, 3, 2, { x: 1, z: 0 }],
    [0, 2, 3, { x: 0, z: 1 }],
  ];
  for (const [rot, w, h, want] of cases) {
    assert.deepStrictEqual(H.plain(RW.anchorOffset(rot, w, h)), want,
      'rot=' + rot + ' ' + w + 'x' + h);
  }
});

test('锚点：偏移不会把最小角推出占地范围之外', () => {
  for (let rot = 0; rot < 4; rot++) {
    for (let w = 1; w <= 4; w++) {
      for (let h = 1; h <= 4; h++) {
        const o = H.plain(RW.anchorOffset(rot, w, h));
        assert.ok(o.x >= 0 && o.x < w, 'x 越界 rot=' + rot + ' ' + w + 'x' + h);
        assert.ok(o.z >= 0 && o.z < h, 'z 越界 rot=' + rot + ' ' + w + 'x' + h);
      }
    }
  }
});

// ---------------------------------------------------------------- 坐标系翻转
test('坐标：flipZ 时游戏北边（z 小）在编辑器上方（z 大）', () => {
  H.resetMap(100, 100);
  const res = IO.importFromSave({
    buildings: [{ defId: 'wall', x: 10, z: 10, rot: 0 }],
    floors: [], mapSize: { w: 100, h: 100 },
  }, { flipZ: true, flipX: false, lockImported: false });
  assert.strictEqual(res.placed, 1);
  const b = RW.state.buildings[0];
  assert.strictEqual(b.x, 10, 'x 不该被翻');
  assert.strictEqual(b.z, 89, 'z 应该翻到 99-10=89');
});

test('坐标：flipX 时游戏 x 也翻', () => {
  H.resetMap(100, 100);
  IO.importFromSave({
    buildings: [{ defId: 'wall', x: 10, z: 10, rot: 0 }],
    floors: [], mapSize: { w: 100, h: 100 },
  }, { flipZ: true, flipX: true, lockImported: false });
  const b = RW.state.buildings[0];
  assert.strictEqual(b.x, 89);
  assert.strictEqual(b.z, 89);
});

test('坐标：不翻的时候导入位置 = 游戏位置', () => {
  H.resetMap(100, 100);
  IO.importFromSave({
    buildings: [{ defId: 'wall', x: 10, z: 10, rot: 0 }],
    floors: [], mapSize: { w: 100, h: 100 },
  }, { flipZ: false, flipX: false, lockImported: false });
  const b = RW.state.buildings[0];
  assert.strictEqual(b.x, 10);
  assert.strictEqual(b.z, 10);
});

// ---------------------------------------------------------------- 往返
test('往返：存档坐标 → 编辑器 → 蓝图，游戏里的相对位置不变', () => {
  H.resetMap(100, 100);
  const src = [
    { defId: 'wall', x: 10, z: 10, rot: 0 },
    { defId: 'bed', x: 50, z: 60, rot: 90 },
    { defId: 'table_2x2', x: 70, z: 20, rot: 0 },
    { defId: 'double_bed', x: 30, z: 40, rot: 0 },
  ];
  const res = IO.importFromSave({
    buildings: src, floors: [], mapSize: { w: 100, h: 100 },
  }, { flipZ: true, flipX: false, lockImported: false });
  assert.strictEqual(res.placed, src.length, '所有建筑都应该放得下');
  assert.strictEqual(res.nudged, 0, '不该有任何建筑被挪位');

  const out = X.toBlueprintsXML(RW.state, { name: 't' });
  const bp = H.parseBlueprint(out.xml);
  assert.strictEqual(bp.items.length, src.length);

  // 蓝图里的位置是相对蓝图原点的；原点在所有 pos 的最小处
  const minX = Math.min(...src.map((b) => b.x));
  const minZ = Math.min(...src.map((b) => b.z));
  for (let i = 0; i < src.length; i++) {
    const item = bp.items[i];
    assert.strictEqual(item.pos.x, src[i].x - minX,
      src[i].defId + ' 的 x 相对位置不对');
    assert.strictEqual(item.pos.z, src[i].z - minZ,
      src[i].defId + ' 的 z 相对位置不对');
    assert.strictEqual(item.rot, src[i].rot / 90,
      src[i].defId + ' 的朝向不对');
  }
});

test('往返：朝向 + 翻转一起也不丢位置', () => {
  H.resetMap(60, 60);
  const src = [
    { defId: 'shelf', x: 5, z: 7, rot: 90 },
    { defId: 'shelf', x: 40, z: 3, rot: 270 },
    { defId: 'bed', x: 25, z: 33, rot: 180 },
  ];
  const res = IO.importFromSave({
    buildings: src, floors: [], mapSize: { w: 60, h: 60 },
  }, { flipZ: true, flipX: true, lockImported: false });
  assert.strictEqual(res.placed, 3);
  assert.strictEqual(res.nudged, 0);

  const out = X.toBlueprintsXML(RW.state, { name: 't' });
  const bp = H.parseBlueprint(out.xml);
  assert.strictEqual(bp.items.length, 3);
  const minX = Math.min(...src.map((b) => b.x));
  const minZ = Math.min(...src.map((b) => b.z));
  for (let i = 0; i < src.length; i++) {
    assert.strictEqual(bp.items[i].pos.x, src[i].x - minX);
    assert.strictEqual(bp.items[i].pos.z, src[i].z - minZ);
  }
});
