'use strict';
/*
 * tests/export-png.test.js —— 导出 PNG
 *
 * 导出的图片 = 画布上看到的东西（矢量图或原版贴图），不含悬停/框选这些交互提示。
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;

test('PNG：整图导出会自动算包围盒', () => {
  H.resetMap(60, 60);
  RW.placeBuilding('wall', 10, 10, 0);
  RW.placeBuilding('wall', 20, 15, 0);

  const r = RW.renderToCanvas({ scope: 'all' });
  // 内容占 (10,10)-(21,16)，左右上下各留 1 格 → 13 × 8 格
  assert.strictEqual(r.w / 32, 13);
  assert.strictEqual(r.h / 32, 8);
});

test('PNG：空画布也能导出（按整张地图）', () => {
  H.resetMap(40, 40);
  const r = RW.renderToCanvas({ scope: 'all' });
  assert.ok(r.w > 0 && r.h > 0, '应该也能出一张图');
});

test('PNG：导出后画布状态不被改坏', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('wall', 10, 10, 0);
  const camBefore = JSON.stringify(RW.state.cam);
  const selBefore = JSON.stringify(RW.state.selection);

  RW.renderToCanvas({ scope: 'all' });

  assert.strictEqual(JSON.stringify(RW.state.cam), camBefore, '相机不该被改动');
  assert.strictEqual(JSON.stringify(RW.state.selection), selBefore, '选中状态不该被改动');
});

test('PNG：尺寸有上限，不会画出一张几亿像素的图', () => {
  H.resetMap(400, 400);
  for (let i = 0; i < 400; i += 7) RW.placeBuilding('wall', i, i, 0);
  const r = RW.renderToCanvas({ scope: 'all', maxPixels: 2000 });
  assert.ok(r.w <= 2000, '宽度不该超过上限：' + r.w);
  assert.ok(r.h <= 2000, '高度不该超过上限：' + r.h);
});
