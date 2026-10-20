'use strict';
/*
 * tests/history.test.js —— 撤销 / 重做（增量式历史）
 *
 * 撤销栈记的是「这次改了什么」的增量，不是整张图的快照。
 * 这里把每种编辑都撤销一遍、再重做一遍，确认状态能完整还原。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Data = app.RWData;

function state() { return RW.state; }

/** 当前画布的指纹（用来比较「还原没还原」） */
function fingerprint() {
  const s = state();
  const b = s.buildings
    .map((x) => [x.uid, x.defId, x.x, x.z, x.rot, x.stuff || '', x.bedMode || '', x.locked ? 1 : 0].join(':'))
    .sort()
    .join('|');
  const f = Object.keys(s.floors).sort().map((k) => k + '=' + s.floors[k]).join('|');
  const lf = Object.keys(s.lockedFloors).sort().join('|');
  return [s.cols + 'x' + s.rows, b, f, lf].join('##');
}

function drawWall(x, z) {
  // 走 commitCells：和玩家真的画一笔是同一条路径（会进撤销栈）
  state().brush = { kind: 'building', id: 'wall' };
  state().tool = 'place';
  const r = RW.commitCells([[x, z]]);
  return r.changed > 0;
}

/** 用笔刷铺一批地板（走的是 commitCells，和玩家操作同一条路径） */
function paintFloor(id, cells) {
  state().brush = { kind: 'floor', id: id };
  state().tool = 'place';
  return RW.commitCells(cells);
}

// ---------------------------------------------------------------- 放 / 删
test('撤销：放一面墙后撤销，画布回到空', () => {
  H.resetMap(30, 30);
  const before = fingerprint();
  assert.ok(drawWall(5, 5));
  assert.notStrictEqual(fingerprint(), before);

  RW.undo();
  assert.strictEqual(fingerprint(), before);
  assert.strictEqual(state().buildings.length, 0);
});

test('撤销：删掉后再撤销，建筑带着原来的 uid 回来', () => {
  H.resetMap(30, 30);
  drawWall(5, 5);
  drawWall(6, 5);
  const uid = state().buildings[0].uid;
  const before = fingerprint();

  RW.setSelection([uid], true);
  RW.deleteSelection();
  assert.strictEqual(state().buildings.length, 1);

  RW.undo();
  assert.strictEqual(state().buildings.length, 2);
  assert.ok(state().buildings.some((b) => b.uid === uid), 'uid 不能变');
  assert.strictEqual(fingerprint(), before);
});

test('重做：撤销之后能重做回去', () => {
  H.resetMap(30, 30);
  drawWall(5, 5);
  const after = fingerprint();
  RW.undo();
  RW.redo();
  assert.strictEqual(fingerprint(), after);
  assert.strictEqual(state().buildings.length, 1);
});

test('撤销：一次擦掉多格，撤销后建筑顺序不乱', () => {
  H.resetMap(30, 30);
  const uids = [];
  for (let x = 10; x <= 12; x++) uids.push(RW.placeBuilding('wall', x, 10, 0).b.uid);
  const before = state().buildings.map((b) => b.uid);

  state().tool = 'erase';
  RW.commitCells([[10, 10], [11, 10]]);
  assert.strictEqual(state().buildings.length, 1);

  RW.undo();
  assert.deepStrictEqual(state().buildings.map((b) => b.uid), before);
  assert.deepStrictEqual(uids, before);
});

test('撤销：床的医疗 / 囚犯开关可逆', () => {
  H.resetMap(30, 30);
  const r = RW.placeBuilding('bed', 10, 10, 0);
  const uid = r.b.uid;
  RW.setSelection([uid], true);
  assert.strictEqual(RW.setSelectionBedMode('medical'), 1);
  assert.strictEqual(state().buildings.find((b) => b.uid === uid).bedMode, 'medical');

  RW.undo();
  assert.ok(!state().buildings.find((b) => b.uid === uid).bedMode);
});

test('撤销：一串操作可以一路退回去', () => {
  H.resetMap(30, 30);
  const start = fingerprint();
  drawWall(5, 5);
  drawWall(6, 5);
  paintFloor('tileSandstone', [[10, 10], [11, 10]]);
  drawWall(20, 20);

  RW.undo(); RW.undo(); RW.undo(); RW.undo();
  assert.strictEqual(fingerprint(), start, '应该完全回到起点');

  RW.redo(); RW.redo(); RW.redo(); RW.redo();
  assert.strictEqual(state().buildings.length, 3);
  assert.strictEqual(Object.keys(state().floors).length, 2);
});

// ---------------------------------------------------------------- 属性
test('撤销：旋转选中后撤销，朝向复原', () => {
  H.resetMap(30, 30);
  drawWall(5, 5);
  const r = RW.placeBuilding('bed', 10, 10, 0);
  const uid = r.b.uid;
  RW.setSelection([uid], true);
  RW.rotateSelection();
  assert.strictEqual(state().buildings.find((b) => b.uid === uid).rot, 90);

  RW.undo();
  assert.strictEqual(state().buildings.find((b) => b.uid === uid).rot, 0);
});

test('撤销：改材质后撤销，材质复原', () => {
  H.resetMap(30, 30);
  drawWall(5, 5);
  const uid = state().buildings[0].uid;
  const was = state().buildings[0].stuff;
  RW.setSelection([uid], true);
  RW.setSelectionStuff('WoodLog');
  assert.strictEqual(state().buildings[0].stuff, 'WoodLog');

  RW.undo();
  assert.strictEqual(state().buildings[0].stuff, was);
});

test('撤销：锁定 / 解锁可逆', () => {
  H.resetMap(30, 30);
  drawWall(5, 5);
  const uid = state().buildings[0].uid;
  RW.setSelection([uid], true);
  RW.setSelectionLocked(true);
  assert.ok(state().buildings[0].locked);

  RW.undo();
  assert.ok(!state().buildings[0].locked, '撤销后不该还是锁定的');
});

// ---------------------------------------------------------------- 地板
test('撤销：铺地板后撤销，地板消失', () => {
  H.resetMap(30, 30);
  paintFloor('tileSandstone', [[10, 10], [11, 10], [12, 10]]);
  assert.strictEqual(Object.keys(state().floors).length, 3);

  RW.undo();
  assert.strictEqual(Object.keys(state().floors).length, 0);
});

test('撤销：在已有地板上重铺，撤销后回到原来的地板', () => {
  H.resetMap(30, 30);
  paintFloor('tileSandstone', [[10, 10]]);
  paintFloor('wood', [[10, 10]]);
  assert.strictEqual(state().floors['10,10'], 'wood');

  RW.undo();
  assert.strictEqual(state().floors['10,10'], 'tileSandstone');
});

// ---------------------------------------------------------------- 网格
test('撤销：改地图尺寸后撤销，尺寸复原', () => {
  H.resetMap(60, 60);
  RW.setGrid(30, 30);
  assert.strictEqual(state().cols, 30);

  RW.undo();
  assert.strictEqual(state().cols, 60);
  assert.strictEqual(state().rows, 60);
});

// ---------------------------------------------------------------- 内存
test('撤销栈：体积和改动量有关，和地图大小无关', () => {
  H.resetMap(250, 250);
  for (let i = 0; i < 50; i++) drawWall(i, i);
  const size = JSON.stringify(state().history).length;
  // 50 次增量改动远小于「整张图 × 120 份快照」
  assert.ok(size < 200 * 1024, '撤销栈不该超过 200KB，实际 ' + size + ' 字节');
});

test('撤销栈：一次拖动只记一条历史', () => {
  H.resetMap(60, 60);
  const n0 = state().history.length;
  state().brush = { kind: 'building', id: 'wall' };
  state().tool = 'place';
  RW.commitCells([[8, 8], [9, 8], [10, 8]]);
  assert.strictEqual(state().history.length, n0 + 1, '一次拖动只记一条');
  assert.strictEqual(state().buildings.length, 3);
});

test('快照：撤销导入要还原地形 / 屋顶 / 翻转设置', () => {
  H.resetMap(30, 30);
  state().flipX = false;
  state().flipZ = true;
  state().terrain = { w: 2, h: 2, cells: new Uint16Array([1, 2, 3, 4]), defs: { 1: 'Soil' } };
  state().roofs = { w: 2, h: 2, cells: new Uint16Array([1, 0, 0, 0]), kind: { 1: 1 } };
  state().saveInfo = { version: '1.7', colonyName: '旧存档' };
  const before = RW.snapshotState();

  // 模拟导入新存档：地形、屋顶、翻转、saveInfo 全换掉
  state().terrain = { w: 2, h: 2, cells: new Uint16Array([9, 9, 9, 9]), defs: { 9: 'Sand' } };
  state().roofs = { w: 2, h: 2, cells: new Uint16Array([0, 0, 0, 0]), kind: {} };
  state().saveInfo = { version: '1.8', colonyName: '新存档' };
  state().flipX = true; state().flipZ = false;

  RW.restoreState(before);
  assert.strictEqual(state().terrain.defs[1], 'Soil');
  assert.strictEqual(state().roofs.cells[0], 1);
  assert.strictEqual(state().saveInfo.colonyName, '旧存档');
  assert.strictEqual(state().flipX, false);
  assert.strictEqual(state().flipZ, true);
});

test('复制：全选房间时，内部地板一起复制', () => {
  H.resetMap(40, 40);
  for (let i = 0; i < 5; i++) {
    RW.placeBuilding('wall', 5 + i, 5, 0);
    RW.placeBuilding('wall', 5 + i, 9, 0);
    RW.placeBuilding('wall', 5, 5 + i, 0);
    RW.placeBuilding('wall', 9, 5 + i, 0);
  }
  const cells = [];
  for (let x = 5; x < 10; x++) for (let z = 5; z < 10; z++) cells.push([x, z]);
  paintFloor('tileSandstone', cells);

  RW.setSelection(state().buildings.map((b) => b.uid), true);
  const clip = RW.copySelection();
  assert.strictEqual(clip.floors.length, 25, '5×5 房间的 25 格地板都要复制，不能只复制墙脚下的');
});

test('复制：只框选地板也能复制 / 存模板', () => {
  H.resetMap(40, 40);
  paintFloor('tileSandstone', [[10, 10], [11, 10], [12, 10]]);
  RW.setSelection([], true);
  ['10,10', '11,10', '12,10'].forEach((k) => { state().floorSelection[k] = true; });

  const clip = RW.copySelection();
  assert.ok(clip, '只选地板也要能复制');
  assert.strictEqual(clip.items.length, 0);
  assert.strictEqual(clip.floors.length, 3);
});
