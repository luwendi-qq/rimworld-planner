'use strict';
/*
 * tests/rooms.test.js —— 房间指定（用途 / 目标温度）与温控估算
 *
 * 用途决定两件事：房间里该有什么、要几台制冷机/加热器。
 * 温控是近似模型（见 js/rooms.js 顶部的公式），这里锁住它的行为。
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
    const v = RW.state.buildings.find((b) => b.defId === 'wall' && b.x === x + 2 && b.z === z);
    RW.removeBuilding(v.uid, true);
    RW.placeBuilding('door', x + 2, z, 0);
  }
}

function analyse() { return Checks.analyse(state()); }
function issuesOfKind(rep, kind) { return rep.issues.filter((i) => i.kind === kind); }

// ---------------------------------------------------------------- 指定
test('房间：默认没有指定', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const rep = analyse();
  assert.strictEqual(rep.rooms[0].role, 'none');
  assert.strictEqual(rep.rooms[0].roleName, '普通房间');
});

test('房间：指定用途后能读回来', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'kitchen');
  rep = analyse();
  assert.strictEqual(rep.rooms[0].role, 'kitchen');
  assert.strictEqual(rep.rooms[0].roleName, '厨房');
});

test('房间：指定写在每一格上，房间被拆开时两半都保留', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'workshop');
  // 在中间砌一堵墙，把房间切成两半
  for (let i = 6; i <= 10; i++) RW.placeBuilding('wall', 8, i, 0);
  rep = analyse();
  assert.strictEqual(rep.rooms.length, 2);
  for (const r of rep.rooms) assert.strictEqual(r.role, 'workshop', '两半都该保留用途');
});

test('房间：用途写进工程文件，存了再打开还在', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'hospital');
  state().ambientTemp = 12;
  const json = JSON.parse(JSON.stringify(RW.exportProject()));
  H.resetMap(40, 40);
  RW.loadProject(json);
  const rep2 = analyse();
  assert.strictEqual(rep2.rooms[0].role, 'hospital');
  assert.strictEqual(state().ambientTemp, 12);
});

test('房间：改用途可以撤销', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'bedroom');
  rep = analyse();
  assert.strictEqual(rep.rooms[0].role, 'bedroom');

  RW.undo();
  rep = analyse();
  assert.strictEqual(rep.rooms[0].role, 'none', '撤销后应该回到没有指定');

  RW.redo();
  rep = analyse();
  assert.strictEqual(rep.rooms[0].role, 'bedroom', '重做后应该又变回卧室');
});

test('房间：改目标温度可以撤销', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'cold', 12);
  rep = analyse();
  assert.strictEqual(rep.rooms[0].temp, 12);

  RW.undo();
  rep = analyse();
  assert.strictEqual(rep.rooms[0].role, 'none');
});

// ---------------------------------------------------------------- 用途检查
test('房间：卧室里没有床会被提示', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'bedroom');
  rep = analyse();
  const need = issuesOfKind(rep, 'roomNeed');
  assert.strictEqual(need.length, 1);
  assert.ok(/床/.test(need[0].msg), '提示里要说明缺什么：' + need[0].msg);
});

test('房间：卧室里有床就不提示', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'bedroom');
  RW.placeBuilding('bed', 8, 8, 0);
  rep = analyse();
  assert.strictEqual(issuesOfKind(rep, 'roomNeed').length, 0);
});

test('房间：厨房缺炉灶会被提示', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'kitchen');
  rep = analyse();
  assert.strictEqual(issuesOfKind(rep, 'roomNeed').length, 1);
  RW.placeBuilding('stove_electric', 8, 8, 0);
  rep = analyse();
  assert.strictEqual(issuesOfKind(rep, 'roomNeed').length, 0);
});

test('房间：有床却没指定成卧室，会给个提示', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  RW.placeBuilding('bed', 8, 8, 0);
  const rep = analyse();
  assert.strictEqual(issuesOfKind(rep, 'roomRole').length, 1);
});

// ---------------------------------------------------------------- 温控
test('温控：常温房间里不需要制冷机', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  state().ambientTemp = 21;
  const rep = analyse();
  const r = rep.rooms[0];
  assert.strictEqual(r.tempNeed.kind, 'none');
  assert.strictEqual(r.cooling, 0);
  assert.strictEqual(issuesOfKind(rep, 'temp').length, 0, '常温房间不该被提示要制冷');
});

test('温控：冷冻室比冷藏室需要更多制冷机', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  state().ambientTemp = 21;
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'cold');
  rep = analyse();
  const coldNeed = rep.rooms[0].tempNeed.need;

  Rooms.setRole(state(), rep.rooms[0], 'freezer');
  rep = analyse();
  const freezerNeed = rep.rooms[0].tempNeed.need;

  assert.ok(freezerNeed > coldNeed, '冷冻应该比冷藏更费制冷机：' + freezerNeed + ' vs ' + coldNeed);
  assert.strictEqual(rep.rooms[0].temp, -10, '冷冻室默认 -10°C');
  assert.strictEqual(rep.rooms[0].roleName, '冷冻室');
});

test('温控：制冷机不够会提示还差几台', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  state().ambientTemp = 21;
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'freezer');
  rep = analyse();
  const t = issuesOfKind(rep, 'temp');
  assert.strictEqual(t.length, 1);
  assert.ok(/制冷器/.test(t[0].msg));
  assert.ok(/-10/.test(t[0].msg), '提示里要写目标温度：' + t[0].msg);
});

test('温控：温度目标可以改', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  state().ambientTemp = 21;
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'cold', 12);
  rep = analyse();
  assert.strictEqual(rep.rooms[0].temp, 12);
  assert.strictEqual(rep.rooms[0].tempNeed.kind, 'cool', '目标 12°C 比环境 21°C 低，要制冷');
  assert.strictEqual(rep.rooms[0].tempNeed.delta, 9);
});

test('温控：目标温度高于环境时要加热', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  state().ambientTemp = 0;
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'cold', 20);
  rep = analyse();
  assert.strictEqual(rep.rooms[0].tempNeed.kind, 'heat');
  assert.ok(rep.rooms[0].tempNeed.need > 0);
  const t = issuesOfKind(rep, 'temp');
  assert.strictEqual(t.length, 1);
  assert.ok(/加热器/.test(t[0].msg));
});

test('温控：环境温度变了，需求跟着变', () => {
  H.resetMap(80, 80);
  buildRoom(5, 5, true, 30);          // 28×28 = 784 格
  state().ambientTemp = 21;
  let rep = analyse();
  Rooms.setRole(state(), rep.rooms[0], 'freezer');
  rep = analyse();
  const warm = rep.rooms[0].tempNeed.need;
  state().ambientTemp = 40;
  rep = analyse();
  assert.ok(rep.rooms[0].tempNeed.need > warm, '环境越热，需要的制冷机越多');
});

// ---------------------------------------------------------------- 制冷机冷热端
test('制冷机：两侧是两个不同房间时会被提示', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  buildRoom(15, 5, true);
  // 共用的墙上开一扇门，再在墙上装制冷机
  for (let i = 5; i <= 11; i++) RW.placeBuilding('wall', 12, i, 0);
  const mid = RW.state.buildings.find((b) => b.defId === 'wall' && b.x === 12 && b.z === 8);
  RW.removeBuilding(mid.uid, true);
  RW.placeBuilding('cooler', 12, 8, 0);

  const rep = analyse();
  const side = issuesOfKind(rep, 'coolerSide');
  assert.ok(side.length > 0, '应该提示制冷机两侧都是房间');
});

test('制冷机：装在房间墙外（两侧都不是房间）会被提示', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('cooler', 10, 10, 0);
  const rep = analyse();
  const side = issuesOfKind(rep, 'coolerSide');
  assert.ok(side.length > 0, '应该提示这台制冷机冷不到任何地方');
});
