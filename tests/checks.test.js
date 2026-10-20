'use strict';
/*
 * tests/checks.test.js —— 布局校验：冲突、电力、房间、可达性
 *
 * 校验是本工具自己实现的近似模型（见 docs/checks.md），
 * 这里锁住的是「模型的行为」，不是游戏的精确数值。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Checks = app.RWChecks;

function issuesOfKind(rep, kind) {
  return rep.issues.filter((i) => i.kind === kind);
}

/** 围一个 5×5 的房间（内部 25 格），留一扇门在 (x+2, z)。 */
function buildRoom(x, z, withDoor) {
  const size = 7;          // 含墙 7×7，内部 5×5
  for (let i = 0; i < size; i++) {
    RW.placeBuilding('wall', x + i, z, 0);
    RW.placeBuilding('wall', x + i, z + size - 1, 0);
    RW.placeBuilding('wall', x, z + i, 0);
    RW.placeBuilding('wall', x + size - 1, z + i, 0);
  }
  if (withDoor) {
    // 拆掉上边中间那格墙，换成门
    const dw = x + 2, dz = z;
    const victim = RW.state.buildings.find(
      (b) => b.defId === 'wall' && b.x === dw && b.z === dz);
    if (victim) RW.removeBuilding(victim.uid, true);
    RW.placeBuilding('door', dw, dz, 0);
  }
}

// ---------------------------------------------------------------- 冲突
test('冲突：两个建筑占同一格会被报出来', () => {
  H.resetMap(30, 30);
  // 引擎本身不允许重叠放置，所以直接改状态模拟异常数据
  RW.state.buildings.push({ uid: 9001, defId: 'wall', x: 5, z: 5, rot: 0 });
  RW.state.buildings.push({ uid: 9002, defId: 'table_2x2', x: 5, z: 5, rot: 0 });
  RW.reindex();

  const rep = Checks.analyse(RW.state);
  assert.ok(issuesOfKind(rep, 'overlap').length > 0, '应该报占地冲突');
});

test('冲突：贴地图边界的建筑会给出提示', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 0, 5, 0);
  const rep = Checks.analyse(RW.state);
  assert.strictEqual(issuesOfKind(rep, 'edge').length, 1);
});

// ---------------------------------------------------------------- 电力
test('电力：没有电缆的用电器会被提示', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('cooler', 20, 20, 0);
  const rep = Checks.analyse(RW.state);
  const power = issuesOfKind(rep, 'power');
  assert.ok(power.length > 0, '孤立用电器应该被提示');
  assert.ok(/没有电缆/.test(power[0].msg), '提示内容要说清是缺电缆');
});

test('电力：发电机 + 电缆 + 用电器组成一张网，功率能对上', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('solar_generator', 5, 5, 0);   // 1700W
  RW.placeBuilding('conduit', 9, 5, 0);
  RW.placeBuilding('conduit', 9, 6, 0);
  RW.placeBuilding('conduit', 9, 7, 0);
  RW.placeBuilding('cooler', 9, 8, 0);            // 200W

  const rep = Checks.analyse(RW.state);
  const net = rep.power.nets.find((n) => n.gen > 0);
  assert.ok(net, '应该找到一张有发电的网');
  assert.strictEqual(net.gen, 1700);
  assert.strictEqual(net.use, 200);
  assert.strictEqual(net.deficit, -1500, '发电大于耗电，不该有缺口');
});

test('电力：耗电大于发电会算出缺口', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('solar_generator', 5, 5, 0);   // 1700W
  RW.placeBuilding('conduit', 9, 5, 0);
  RW.placeBuilding('conduit', 9, 6, 0);
  RW.placeBuilding('conduit', 9, 7, 0);
  RW.placeBuilding('sun_lamp', 9, 8, 0);          // 2900W
  RW.placeBuilding('sun_lamp', 10, 8, 0);

  const rep = Checks.analyse(RW.state);
  const net = rep.power.nets.find((n) => n.gen > 0);
  assert.strictEqual(net.gen, 1700);
  assert.strictEqual(net.use, 5800);
  assert.strictEqual(net.deficit, 4100);
});

test('电力：两张互不相连的电网要分开算', () => {
  H.resetMap(60, 60);
  RW.placeBuilding('solar_generator', 5, 5, 0);
  RW.placeBuilding('conduit', 9, 5, 0);
  RW.placeBuilding('cooler', 9, 6, 0);

  RW.placeBuilding('wood_generator', 40, 40, 0);  // 1000W
  RW.placeBuilding('conduit', 42, 40, 0);
  RW.placeBuilding('cooler', 42, 41, 0);         // 200W

  const rep = Checks.analyse(RW.state);
  const withGen = rep.power.nets.filter((n) => n.gen > 0);
  assert.strictEqual(withGen.length, 2, '应该是两张独立的网');
  assert.deepStrictEqual(H.plain(withGen.map((n) => n.gen).sort()), [1000, 1700]);
});

test('电力：电池算储电，不算发电', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('battery', 10, 10, 0);         // 600 储电
  RW.placeBuilding('conduit', 11, 10, 0);
  const rep = Checks.analyse(RW.state);
  const net = rep.power.nets[0];
  assert.strictEqual(net.gen, 0);
  assert.strictEqual(net.store, 600);
});

test('电力：6 格之内才算连上，7 格就不算', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('conduit', 10, 10, 0);
  RW.placeBuilding('cooler', 16, 10, 0);         // 正好 6 格 → 连上
  let rep = Checks.analyse(RW.state);
  let net = rep.power.nets.find((n) => n.use > 0);
  assert.ok(net, '6 格内的用电器应该连上电网');
  assert.strictEqual(net.use, 200);

  H.resetMap(40, 40);
  RW.placeBuilding('conduit', 10, 10, 0);
  RW.placeBuilding('cooler', 17, 10, 0);         // 7 格 → 连不上
  rep = Checks.analyse(RW.state);
  const power = issuesOfKind(rep, 'power');
  assert.ok(power.length > 0, '7 格外的用电器应该被提示没有电缆');
});

test('电力：大建筑横跨好几个分桶也不会漏连', () => {
  H.resetMap(60, 60);
  // 4×4 的发电机占 (5,5)-(8,8)，电缆在它右边 4 格处
  RW.placeBuilding('solar_generator', 5, 5, 0);
  RW.placeBuilding('conduit', 12, 6, 0);
  RW.placeBuilding('cooler', 13, 6, 0);
  const rep = Checks.analyse(RW.state);
  const net = rep.power.nets.find((n) => n.gen > 0);
  assert.ok(net, '应该连成一张网');
  assert.strictEqual(net.use, 200);
});

// ---------------------------------------------------------------- 房间
test('房间：围起来的区域会被识别成一个房间', () => {
  H.resetMap(30, 30);
  buildRoom(5, 5, true);
  const rep = Checks.analyse(RW.state);
  assert.strictEqual(rep.rooms.length, 1);
  assert.strictEqual(rep.rooms[0].area, 25, '5×5 的内部应该是 25 格');
  assert.strictEqual(rep.rooms[0].doors, 1);
  assert.strictEqual(rep.rooms[0].reachable, true, '有门就应该能通到室外');
});

test('房间：没门的封闭房间会被提示「密封」', () => {
  H.resetMap(30, 30);
  buildRoom(5, 5, false);
  const rep = Checks.analyse(RW.state);
  assert.strictEqual(rep.rooms.length, 1);
  assert.strictEqual(rep.rooms[0].doors, 0);
  assert.strictEqual(rep.rooms[0].reachable, false);
  assert.ok(issuesOfKind(rep, 'sealed').length > 0, '应该提示房间没门');
});

test('房间：有门但通不到室外，会提示「无法通到室外」', () => {
  H.resetMap(40, 40);
  // 两个房间共用同一堵墙（x=11），墙中间开一扇门：彼此连通，但整体与室外隔绝
  buildRoom(5, 5, false);
  buildRoom(11, 5, false);
  const mid = RW.state.buildings.find((b) => b.defId === 'wall' && b.x === 11 && b.z === 8);
  RW.removeBuilding(mid.uid, true);
  RW.placeBuilding('door', 11, 8, 0);

  const rep = Checks.analyse(RW.state);
  assert.strictEqual(rep.rooms.length, 2);
  for (const r of rep.rooms) {
    assert.strictEqual(r.doors, 1, '两个房间都只连着那一扇门');
    assert.strictEqual(r.reachable, false, '都到不了室外');
  }
  assert.strictEqual(issuesOfKind(rep, 'unreachable').length, 2);
});

test('房间：空间评分按游戏的分档给出文字', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  const rep = Checks.analyse(RW.state);
  const r = rep.rooms[0];
  // 25 格、0 格被占 → 1.4×25 = 35 → 「一般」
  assert.strictEqual(r.space, 35);
  assert.strictEqual(r.spaceText, '一般');
});

test('房间：床会被统计进房间（用来判断要不要制冷）', () => {
  H.resetMap(40, 40);
  buildRoom(5, 5, true);
  RW.placeBuilding('bed', 7, 7, 0);
  const rep = Checks.analyse(RW.state);
  assert.strictEqual(rep.rooms[0].beds, 1);
});

test('房间：玩家区域外的封闭区域算地图预制，不算玩家房间', () => {
  H.resetMap(30, 30);
  buildRoom(5, 5, true);
  const s = RW.state;
  s.home = { w: 30, h: 30, cells: new Uint16Array(30 * 30), count: 1 };
  s.home.cells[25 * 30 + 25] = 1;   // 玩家区域只在远处
  // 模拟存档导入的锁定建筑（远古遗迹）
  s.buildings.forEach(function (b) { b.locked = true; b.src = 'save'; });
  let rep = Checks.analyse(s);
  assert.strictEqual(rep.rooms[0].prefab, true);
  assert.strictEqual(rep.rooms[0].role, 'prefab');
  assert.strictEqual(rep.prefabs, 1);

  // 把房间圈进玩家区域，就应该重新当房间处理
  for (let x = 5; x < 12; x++) for (let z = 5; z < 12; z++) s.home.cells[z * 30 + x] = 1;
  rep = Checks.analyse(s);
  assert.strictEqual(rep.rooms[0].prefab, false);
  assert.notStrictEqual(rep.rooms[0].role, 'prefab');
});

test('房间：玩家自己画在区域外的规划仍算房间', () => {
  H.resetMap(30, 30);
  buildRoom(5, 5, true);
  const s = RW.state;
  s.home = { w: 30, h: 30, cells: new Uint16Array(30 * 30), count: 1 };
  s.home.cells[25 * 30 + 25] = 1;
  const rep = Checks.analyse(s);
  assert.strictEqual(rep.rooms[0].prefab, false, '未锁定的新规划不该被当成预制');
});

test('房间：超过 5184 格会被提示（游戏里不算室内）', () => {
  H.resetMap(200, 200);
  // 围一个 80×80 的房间
  const size = 80, x = 5, z = 5;
  for (let i = 0; i < size; i++) {
    RW.placeBuilding('wall', x + i, z, 0);
    RW.placeBuilding('wall', x + i, z + size - 1, 0);
    RW.placeBuilding('wall', x, z + i, 0);
    RW.placeBuilding('wall', x + size - 1, z + i, 0);
  }
  const rep = Checks.analyse(RW.state);
  assert.strictEqual(rep.rooms.length, 1);
  assert.strictEqual(rep.rooms[0].area, 78 * 78);
  assert.ok(issuesOfKind(rep, 'toobig').length > 0, '应该提示房间太大');
});

// ---------------------------------------------------------------- 作用范围
test('作用范围：风力发电机的迎风区被挡住会被提示', () => {
  H.resetMap(60, 60);
  RW.placeBuilding('wind_turbine', 30, 30, 0);
  RW.placeBuilding('table_2x2', 30, 22, 0);   // 落在迎风区里
  const rep = Checks.analyse(RW.state);
  const z = issuesOfKind(rep, 'zoneBlocked');
  assert.ok(z.length > 0, '挡住作用范围应该被提示');
  assert.ok(/风力/.test(z[0].msg), '提示里应该带上是哪个设备');
});
