'use strict';
/*
 * buildops.test.js —— 「规划 → 游戏侧 build() 调用」的等价性
 *
 * 关键不变量：build-ops 合并矩形之后，落地的东西必须和 blueprintEntries
 * 完全一致 —— 不多放一件，也不少放一件。否则游戏里就会缺墙 / 多盖一间。
 *
 * 注意允许「同格两件」：电缆埋在墙下、制冷机贴墙，游戏里本来就合法，
 * 所以比较用的是多重集合（key → 次数），不是简单的 set。
 */

const test = require('node:test');
const assert = require('node:assert');
const { loadApp, resetMap } = require('./harness.js');

function floorDefNames(app) {
  const out = new Set();
  const floors = app.RWData.floorsById || {};
  for (const id of Object.keys(floors)) {
    if (floors[id] && floors[id].def) out.add(floors[id].def);
  }
  return out;
}

/** 把 ops 展开成 "kind:x,z" → 次数 */
function expandOps(ops, terrainNames) {
  const counts = new Map();
  ops.forEach(function (op) {
    const kind = terrainNames.has(op.def) ? 'F' : 'T';
    const cells = op.fill
      ? rectCells(op.minX, op.minZ, op.maxX, op.maxZ)
      : [[op.x, op.z]];
    cells.forEach(function (c) {
      const k = kind + ':' + c[0] + ',' + c[1];
      counts.set(k, (counts.get(k) || 0) + 1);
    });
  });
  return counts;
}

function rectCells(x0, z0, x1, z1) {
  const out = [];
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) out.push([x, z]);
  return out;
}

/** blueprintEntries 的期望值，同样的多重集合表示 */
function entryCounts(app, opts) {
  const packed = app.RWExport.blueprintEntries(app.RW.state, opts || {});
  const counts = new Map();
  packed.entries.forEach(function (e) {
    const k = (e.terrain ? 'F' : 'T') + ':' + e.x + ',' + e.z;
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  return { counts: counts, packed: packed };
}

function sorted(m) {
  return Array.from(m.entries()).sort(function (a, b) { return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0; });
}

function add(app, defId, x, z, extra) {
  const s = app.RW.state;
  s.buildings.push(Object.assign({
    uid: s.nextUid++, defId: defId, x: x, z: z, rot: 0, color: null, stuff: null, bedMode: null
  }, extra || {}));
}

test('地板：一整片矩形合并成一次调用', function () {
  const app = loadApp();
  resetMap(40, 40);
  const s = app.RW.state;
  for (let x = 10; x < 30; x++) for (let z = 10; z < 30; z++) s.floors[x + ',' + z] = 'wood';

  const r = app.RWBuild.toBuildOps(s, {});
  assert.strictEqual(r.ops.length, 1, '20×20 地板应该是 1 次调用');
  const op = r.ops[0];
  assert.ok(op.fill);
  assert.deepStrictEqual([op.maxX - op.minX + 1, op.maxZ - op.minZ + 1], [20, 20]);
  assert.ok(op.def && op.def !== 'wood', '要用 TerrainDef 名，不是内部 id');
});

test('墙：一圈墙不会被拆成几十次调用', function () {
  const app = loadApp();
  resetMap(60, 60);
  for (let x = 10; x <= 19; x++) { add(app, 'wall', x, 10); add(app, 'wall', x, 19); }
  for (let z = 11; z <= 18; z++) { add(app, 'wall', 10, z); add(app, 'wall', 19, z); }

  const r = app.RWBuild.toBuildOps(app.RW.state, {});
  assert.ok(r.ops.length <= 8, '四面墙不该被拆成 ' + r.ops.length + ' 次调用');
  assert.ok(r.ops.every(function (o) { return o.def === 'Wall'; }), '要用游戏 defName');

  assert.deepStrictEqual(sorted(expandOps(r.ops, floorDefNames(app))), sorted(entryCounts(app).counts));
});

test('多格建筑：只按锚点放一次，材质用 defName', function () {
  const app = loadApp();
  resetMap(40, 40);
  add(app, 'bed', 5, 5, { stuff: 'Cloth' });

  const r = app.RWBuild.toBuildOps(app.RW.state, {});
  assert.strictEqual(r.ops.length, 1);
  assert.strictEqual(r.ops[0].def, 'Bed');
  assert.strictEqual(r.ops[0].stuff, 'Cloth');
  assert.ok(!r.ops[0].fill, '床不能被当矩形铺');
});

test('锁定的存档建筑默认不导出，excludeLocked:false 才导出', function () {
  const app = loadApp();
  resetMap(40, 40);
  add(app, 'wall', 5, 5, { locked: true });
  add(app, 'wall', 6, 5);

  const onlyNew = app.RWBuild.toBuildOps(app.RW.state, {});
  assert.strictEqual(onlyNew.stats.lockedSkipped, 1);
  assert.strictEqual(expandOps(onlyNew.ops, floorDefNames(app)).size, 1);

  const all = app.RWBuild.toBuildOps(app.RW.state, { excludeLocked: false });
  assert.strictEqual(expandOps(all.ops, floorDefNames(app)).size, 2);
});

test('混合布局（含门、床、电缆埋在墙下）：与 blueprintEntries 完全一致', function () {
  const app = loadApp();
  resetMap(60, 60);
  const s = app.RW.state;
  for (let x = 10; x <= 19; x++) for (let z = 10; z <= 19; z++) s.floors[x + ',' + z] = 'wood';

  // 上墙留一个门洞
  for (let x = 10; x <= 19; x++) if (x !== 14) add(app, 'wall', x, 19);
  for (let x = 10; x <= 19; x++) add(app, 'wall', x, 10);
  for (let z = 11; z <= 18; z++) { add(app, 'wall', 10, z); add(app, 'wall', 19, z); }
  add(app, 'door', 14, 19);
  add(app, 'bed', 12, 12, { rot: 90, stuff: 'Cloth' });
  add(app, 'battery', 17, 15, { stuff: 'Steel' });
  // 电缆埋在墙下：同格两件，游戏里合法
  add(app, 'conduit', 10, 15);

  const r = app.RWBuild.toBuildOps(s, {});
  const want = entryCounts(app);
  assert.deepStrictEqual(sorted(expandOps(r.ops, floorDefNames(app))), sorted(want.counts));
  assert.strictEqual(r.stats.cells, want.packed.entries.length);
});

test('电缆排在墙前面（不然墙会挡住它）', function () {
  const app = loadApp();
  resetMap(40, 40);
  add(app, 'wall', 10, 10);
  add(app, 'conduit', 10, 10);
  const ops = app.RWBuild.toBuildOps(app.RW.state, {}).ops;
  const idxWall = ops.findIndex(function (o) { return o.def === 'Wall'; });
  const idxWire = ops.findIndex(function (o) { return /Conduit/.test(o.def); });
  assert.ok(idxWire >= 0, '电缆没被导出');
  assert.ok(idxWire < idxWall, '电缆必须在墙之前放');
});

test('toRects：不重叠、覆盖完整', function () {
  const cells = [];
  for (let x = 0; x < 5; x++) for (let z = 0; z < 5; z++) cells.push([x, z]);
  const keep = cells.filter(function (c) { return !(c[0] === 2 && c[1] === 2) && !(c[0] === 3 && c[1] === 1); });
  const rects = loadApp().RWBuild.toRects(keep);

  let total = 0;
  const seen = new Set();
  rects.forEach(function (r) {
    for (let x = r[0]; x <= r[2]; x++) for (let z = r[1]; z <= r[3]; z++) {
      const k = x + ',' + z;
      assert.ok(!seen.has(k), '矩形重叠：' + k);
      seen.add(k); total++;
    }
  });
  assert.strictEqual(total, keep.length);
  assert.strictEqual(seen.size, keep.length);
});
