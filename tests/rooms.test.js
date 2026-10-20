'use strict';
/*
 * tests/rooms.test.js —— 房间角色自动推导 + 温控估算
 *
 * 游戏里房间角色不是玩家指定的，而是 RoomRoleWorker 根据房间里有什么自动推导。
 * 这里锁住推导规则（卧室 / 兵营 / 病房 / 厨房 / 工坊 / 餐厅…）和温控模型。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Rooms = app.RWRooms;
const Checks = app.RWChecks;

function state() { return RW.state; }

/** 围一个 (size-2)×(size-2) 的房间，带一扇门 */
function buildRoom(x, z, withDoor, size) {
  size = size || 7;
  for (let i = 0; i < size; i++) {
    RW.placeBuilding('wall', x + i, z, 0);
    RW.placeBuilding('wall', x + i, z + size - 1, 0);
    RW.placeBuilding('wall', x, z + i, 0);
    RW.placeBuilding('wall', x + size - 1, z + i, 0);
  }
  if (withDoor) {
    const v = state().buildings.find((b) => b.defId === 'wall' && b.x === x + 2 && b.z === z);
    RW.removeBuilding(v.uid, true);
    RW.placeBuilding('door', x + 2, z, 0);
  }
}

function analyse() { return Checks.analyse(state()); }
function role() { return analyse().rooms[0].role; }
function put(id, x, z) {
  const r = RW.placeBuilding(id, x, z, 0);
  assert.ok(r.ok, id + ' 放不下：' + (r.why || ''));
  return r.b;
}
function setBedMode(b, mode) {
  RW.setSelection([b.uid], true);
  assert.strictEqual(RW.setSelectionBedMode(mode), 1);
  RW.setSelection([]);
}

// ---------------------------------------------------------------- 自动推导
test('房间：空房间就是「房间」，不需要手填用途', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const r = analyse().rooms[0];
  assert.strictEqual(r.role, 'room');
  assert.strictEqual(r.roleName, '房间');
});

test('房间：1 张普通床 → 卧室', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('bed', 7, 7);
  assert.strictEqual(role(), 'bedroom');
});

test('房间：1×2 的床只算一张，不会变成兵营', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('bed', 7, 7);
  const r = analyse().rooms[0];
  assert.strictEqual(r.beds, 1, '床按个数算，不按格子算');
  assert.strictEqual(r.role, 'bedroom');
});

test('房间：2 张普通床 → 兵营', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('bed', 6, 6);
  put('bed', 8, 6);
  assert.strictEqual(role(), 'barracks');
});

test('房间：医疗床 → 病房', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('hospital_bed', 7, 7);
  assert.strictEqual(role(), 'hospital');
});

test('房间：普通床切成医疗 → 病房', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const bed = put('bed', 7, 7);
  setBedMode(bed, 'medical');
  assert.strictEqual(role(), 'hospital');
});

test('房间：囚犯床 → 囚室；两张 → 囚犯兵营', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const bed = put('bed', 7, 7);
  setBedMode(bed, 'prison');
  assert.strictEqual(role(), 'prison');

  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  setBedMode(put('bed', 6, 6), 'prison');
  setBedMode(put('bed', 8, 6), 'prison');
  assert.strictEqual(role(), 'prisonBarracks');
});

test('房间：炉灶 → 厨房', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('stove_electric', 7, 7);
  assert.strictEqual(role(), 'kitchen');
});

test('房间：屠宰台也算厨房（游戏按产出可食用营养判断）', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('butcher_table', 7, 7);
  assert.strictEqual(role(), 'kitchen');
});

test('房间：工作台 → 工坊，研究台 → 实验室', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('electric_smithy', 7, 7);
  assert.strictEqual(role(), 'workshop');

  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('research_bench', 7, 7);
  assert.strictEqual(role(), 'lab');
});

test('房间：餐桌 → 餐厅；娱乐设施 → 娱乐室', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('table_2x2', 7, 7);
  assert.strictEqual(role(), 'dining');

  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('billiards_table', 7, 7);
  assert.strictEqual(role(), 'rec');
});

test('房间：储物架 → 储藏室；棺材 → 陵墓；动物床 → 畜栏', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('shelf', 7, 7);
  assert.strictEqual(role(), 'storage');

  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('sarcophagus', 7, 7);
  assert.strictEqual(role(), 'tomb');

  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('animal_bed', 7, 7);
  assert.strictEqual(role(), 'barn');
});

test('房间：婴儿床 ≥2 → 育儿室', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('crib', 6, 6);
  put('crib', 8, 6);
  assert.strictEqual(role(), 'nursery');
});

test('房间：拆掉一半后，两半都按自己的内容重新判定', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  put('bed', 7, 7);
  assert.strictEqual(role(), 'bedroom');

  // 在房间中间加一道墙，把房间切成两半
  for (let z = 6; z <= 10; z++) RW.placeBuilding('wall', 8, z, 0);
  RW.removeBuilding(state().buildings.find((b) => b.defId === 'wall' && b.x === 8 && b.z === 10).uid, true);
  RW.placeBuilding('door', 8, 10, 0);

  const rep = analyse();
  assert.strictEqual(rep.rooms.length, 2);
  const roles = rep.rooms.map((r) => r.role).sort();
  assert.strictEqual(roles.join(','), 'bedroom,room');
});

// ---------------------------------------------------------------- 目标温度
test('温控：默认 21°C，没有温差就不需要制冷机', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const r = analyse().rooms[0];
  assert.strictEqual(r.temp, 21);
  assert.strictEqual(r.tempNeed.kind, 'none');
});

test('温控：把目标改成 -10°C 后需要制冷机', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let r = analyse().rooms[0];
  Rooms.setTemperature(state(), r, -10);
  r = analyse().rooms[0];
  assert.strictEqual(r.temp, -10);
  assert.strictEqual(r.tempNeed.kind, 'cool');
  assert.ok(r.tempNeed.need >= 1);
});

test('温控：环境温度变了，需求跟着变', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const r = analyse().rooms[0];
  Rooms.setTemperature(state(), r, 0);
  state().ambientTemp = 21;
  const cool = analyse().rooms[0].tempNeed.need;
  state().ambientTemp = 40;
  const hotter = analyse().rooms[0].tempNeed.need;
  assert.ok(hotter > cool, '环境越热，冷库越费制冷机');
});

test('温控：目标温度可以撤销 / 重做', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const r = analyse().rooms[0];
  Rooms.setTemperature(state(), r, -10);
  assert.strictEqual(analyse().rooms[0].temp, -10);

  RW.undo();
  assert.strictEqual(analyse().rooms[0].temp, 21);
  RW.redo();
  assert.strictEqual(analyse().rooms[0].temp, -10);
});

test('温控：目标温度存在房间的每一格上，重建同一位置仍能读到', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  Rooms.setTemperature(state(), analyse().rooms[0], -10);
  assert.strictEqual(analyse().rooms[0].temp, -10);

  // 拆掉整间房再按原样围回来
  state().tool = 'erase';
  const cells = [];
  for (let x = 5; x < 12; x++) for (let z = 5; z < 12; z++) cells.push([x, z]);
  RW.commitCells(cells);
  buildRoom(5, 5, true);
  assert.strictEqual(analyse().rooms[0].temp, -10, '目标温度跟着格子走');
});
