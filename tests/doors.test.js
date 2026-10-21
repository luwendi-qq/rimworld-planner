'use strict';
/*
 * doors.test.js —— 门到底能不能过人
 *
 * 规则：门的通行轴由 rot 决定（0/2 南北，1/3 东西），两侧都要有可通行格。
 * 放在墙角（墙在南+东，开口在北+西）时，任何一轴都凑不齐 —— 游戏里就是堵死的。
 * 以前的实现只报「房间没有门」，看不出是门摆错了。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;

function place(defId, x, z, rot, opts) {
  const r = RW.placeBuilding(defId, x, z, rot || 0, opts || {});
  assert.ok(r && r.ok, '放置失败：' + defId + ' @ ' + x + ',' + z + ' → ' + (r && r.why));
  return r.b;
}

/** 8×8 的墙圈，doorAt 这一格留给门 */
function ring(doorAt) {
  H.resetMap(40, 40);
  for (let x = 10; x <= 17; x++) {
    if (!(doorAt && doorAt[0] === x && doorAt[1] === 10)) place('wall', x, 10);
    place('wall', x, 17);
  }
  for (let z = 11; z <= 16; z++) {
    place('wall', 10, z);
    place('wall', 17, z);
  }
}

function doorIssues() {
  return app.RWChecks.analyse(RW.state).issues.filter(function (i) { return i.kind === 'door'; });
}

test('门装在墙线上：不报错', function () {
  ring([13, 10]);
  place('door', 13, 10, 0);   // 东西向的墙，门朝北/南 → 通行 N-S，正确
  assert.strictEqual(doorIssues().length, 0);
});

test('门放在墙角：报 error（这是最常见的错法）', function () {
  // 不给门留缺口，门直接压在第 10 行和第 10 列的拐角
  H.resetMap(40, 40);
  for (let x = 10; x <= 17; x++) { if (x !== 10) place('wall', x, 10); place('wall', x, 17); }
  for (let z = 11; z <= 16; z++) { place('wall', 10, z); place('wall', 17, z); }
  place('door', 10, 10, 0);

  const bad = doorIssues();
  assert.strictEqual(bad.length, 1);
  assert.strictEqual(bad[0].level, 'error');
  assert.ok(bad[0].msg.indexOf('过不去') >= 0);
  // 消息里报的是游戏坐标（cells 仍是画布坐标，给网页高亮用）
  assert.ok(bad[0].msg.indexOf('(10,29)') >= 0, '消息应报游戏坐标 (10,29)：' + bad[0].msg);
});

test('门的方向和墙线垂直：先给 warn（不硬拦）', function () {
  ring([13, 10]);
  place('door', 13, 10, 90);  // 墙是东西向，门却朝东/西
  const w = doorIssues();
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].level, 'warn');
  assert.ok(w[0].msg.indexOf('转 90') >= 0);
});

test('存档原有的门放在墙角：只给 info，不挡施工', function () {
  ring([13, 10]);
  const b = place('door', 13, 10, 0);
  b.locked = true;
  b.x = 10; b.z = 10;   // 挪到墙角模拟遗迹
  const i = doorIssues();
  assert.strictEqual(i.length, 1);
  assert.strictEqual(i[0].level, 'info');
});

