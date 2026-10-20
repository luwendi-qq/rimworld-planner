'use strict';
/*
 * tests/export-png.test.js —— 导出 PNG
 *
 * 导出的图片 = 画布上看到的东西（矢量图或原版贴图），
 * 只导出「全部内容」：所有建筑和地板的包围盒，不含悬停/框选这些交互提示。
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

  const r = RW.renderToCanvas();
  // 内容占 (10,10)-(21,16)，左右上下各留 1 格 → 13 × 8 格
  assert.strictEqual(r.w / 32, 13);
  assert.strictEqual(r.h / 32, 8);
});

test('PNG：地板也算进包围盒', () => {
  H.resetMap(60, 60);
  RW.placeBuilding('wall', 10, 10, 0);
  RW.state.floors['40,40'] = 'tileSandstone';
  const r = RW.renderToCanvas();
  // 墙在 (10,10)、地板在 (40,40) → 内容 x 从 10 到 41，两边各留 1 格 → 33 格宽
  assert.strictEqual(r.w / 32, 33, '地板在 (40,40)，宽度要算到它');
});

test('PNG：空画布不导出', () => {
  H.resetMap(40, 40);
  assert.strictEqual(RW.renderToCanvas(), null);
  assert.strictEqual(RW.exportPNG(), null);
});

test('PNG：导出后画布状态不被改坏', () => {
  H.resetMap(40, 40);
  RW.placeBuilding('wall', 10, 10, 0);
  const camBefore = JSON.stringify(RW.state.cam);
  const selBefore = JSON.stringify(RW.state.selection);

  RW.renderToCanvas();

  assert.strictEqual(JSON.stringify(RW.state.cam), camBefore, '相机不该被改动');
  assert.strictEqual(JSON.stringify(RW.state.selection), selBefore, '选中状态不该被改动');
});

test('PNG：尺寸有上限，不会画出一张几亿像素的图', () => {
  H.resetMap(400, 400);
  for (let i = 0; i < 400; i += 7) RW.placeBuilding('wall', i, i, 0);
  const r = RW.renderToCanvas({ maxPixels: 2000 });
  assert.ok(r.w <= 2000, '宽度不该超过上限：' + r.w);
  assert.ok(r.h <= 2000, '高度不该超过上限：' + r.h);
});
