'use strict';
/*
 * planimport.test.js —— AI 的 plan.json 合并进工程
 *
 * 这是网页「导入 AI 规划」和命令行 apply 共用的唯一实现，所以重点测三件事：
 *   1. 多格建筑的「游戏 Position ↔ 画布最小角」往返不能偏
 *   2. 反复 apply 是幂等的（不能越叠越多）
 *   3. 锁定建筑 / 地板 / 目标温度 / 撞车让路 的语义
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const PI = app.RWPlanImport;

function addLocked(defId, x, z, extra) {
  const s = RW.state;
  s.buildings.push(Object.assign({
    uid: s.nextUid++, defId: defId, x: x, z: z, rot: 0,
    color: null, stuff: null, bedMode: null, locked: true
  }, extra || {}));
}

test('多格建筑：游戏坐标 → 画布 → 游戏坐标，往返不变', function () {
  H.resetMap(60, 60);
  const ids = ['bed', 'double_bed', 'wall', 'battery'];
  ids.forEach(function (id) {
    const def = app.RWData.byId[id];
    if (!def) return;
    for (let rot = 0; rot < 4; rot++) {
      const ed = PI.gameThingToEditor(RW.state, def, rot * 90, 12, 9);
      const back = PI.editorThingToGame(RW.state, def, rot * 90, ed.x, ed.z);
      assert.deepStrictEqual(
        { x: back.x, z: back.z }, { x: 12, z: 9 },
        id + ' rot=' + rot + ' 往返偏了'
      );
    }
  });
});

test('apply：墙 / 门 / 地板 / 目标温度，且重复执行幂等', function () {
  H.resetMap(60, 60);
  const s = RW.state;

  const buildings = [];
  for (let x = 10; x <= 17; x++) {
    if (x !== 13) buildings.push({ def: 'Wall', x: x, z: 10 });
    buildings.push({ def: 'Wall', x: x, z: 17 });
  }
  for (let z = 11; z <= 16; z++) {
    buildings.push({ def: 'Wall', x: 10, z: z });
    buildings.push({ def: 'Wall', x: 17, z: z });
  }
  buildings.push({ def: 'Door', x: 13, z: 10 });

  const floors = {};
  for (let x = 11; x <= 16; x++) for (let z = 11; z <= 16; z++) floors[x + ',' + z] = 'WoodPlankFloor';

  const plan = {
    name: '合并测试',
    buildings: buildings,
    floors: floors,
    roomTemp: [{ at: [13, 13], c: -10 }]
  };

  const r1 = PI.apply(s, plan, {});
  assert.strictEqual(r1.errors.length, 0);
  assert.strictEqual(r1.applied.buildings, buildings.length);
  assert.strictEqual(r1.applied.floors, 36);

  const n1 = s.buildings.length;
  const r2 = PI.apply(s, plan, {});
  assert.strictEqual(s.buildings.length, n1, '重复 apply 不能累加');
  assert.strictEqual(r2.replaced.buildings, buildings.length, '第二次应该先撤掉上一次的');

  const floorId = s.floors[Object.keys(s.floors)[0]];
  assert.strictEqual(floorId, 'wood', 'TerrainDef 要解析成内部地板 id');

  const room = app.RWChecks.analyse(s).rooms.filter(function (r) {
    return r.cells.some(function (c) { return s.floors[c[0] + ',' + c[1]]; });
  })[0];
  assert.ok(room, '应该能识别出围起来的房间');
  assert.strictEqual(app.RWRooms.temperatureOf(s, room), -10, '目标温度要落到整间房');
  assert.strictEqual(r1.roomTemp.length, 1);
});

test('压到存档原有建筑：先报 demolish，clear 后才让路', function () {
  H.resetMap(40, 40);
  const s = RW.state;
  const locked = PI.cellToGame(s, 5, 5);      // 编辑器 (5,5) 对应的游戏坐标
  addLocked('wall', 5, 5);

  const plan = { buildings: [{ def: 'Wall', x: locked.x, z: locked.z }] };

  const r1 = PI.apply(s, plan, {});
  assert.strictEqual(r1.demolish.length, 1);
  assert.strictEqual(r1.cleared, 0);
  assert.strictEqual(s.buildings.filter(function (b) { return b.locked; }).length, 1, '没 clear 时旧建筑还在');

  const r2 = PI.apply(s, plan, { clear: true });
  assert.strictEqual(r2.cleared, 1);
  assert.strictEqual(s.buildings.filter(function (b) { return b.locked; }).length, 0, 'clear 后旧建筑让路');
  assert.strictEqual(s.buildings.filter(function (b) { return b.src === 'plan'; }).length, 1);
});

test('未知 def / 越界 / 坏坐标都报错但不炸', function () {
  H.resetMap(20, 20);
  const s = RW.state;
  const r = PI.apply(s, {
    buildings: [
      { def: 'NoSuchBuilding', x: 1, z: 1 },
      { def: 'Wall', x: 999, z: 1 },
      { def: 'Wall', x: 'a', z: 1 }
    ]
  }, {});
  assert.strictEqual(r.errors.length, 3);
  assert.strictEqual(r.applied.buildings, 0);
});

test('materials 的 key 和实际 def 对不上时给警告', function () {
  H.resetMap(30, 30);
  const r = PI.apply(RW.state, {
    materials: { Wall: 'WoodLog' },          // 实际用的是 GrayWall
    buildings: [{ def: 'GrayWall', x: 5, z: 5 }]
  }, {});
  assert.strictEqual(r.errors.length, 0);
  assert.ok(r.warnings.some(function (w) {
    return w.indexOf('materials') >= 0 && w.indexOf('Wall') >= 0;
  }), '应该提示 materials 的 key 没匹配上：' + JSON.stringify(r.warnings));
});

test('parsePlan：容忍 // 注释和尾逗号，并给警告', function () {
  const text = [
    '{',
    '  "name": "带注释",',
    '  "buildings": [',
    '    // 这是注释',
    '    { "def": "Wall", "x": 1, "z": 1 },',
    '  ],',
    '}'
  ].join('\n');
  const r = PI.parsePlan(text);
  assert.strictEqual(r.plan.name, '带注释');
  assert.strictEqual(r.plan.buildings.length, 1);
  assert.ok(r.warnings.length > 0);
  assert.ok(r.plan.buildings[0].x === 1);
});

test('parsePlan：真坏了要抛错，不要静默吞掉', function () {
  assert.throws(function () { PI.parsePlan('{ "a": '); }, /解析失败/);
});
