'use strict';
/*
 * tests/blueprint.test.js —— 蓝图 XML 的结构与内容
 *
 * 蓝图格式参考 Blueprints 模组（Fluffy, MIT）。这里锁住：
 *   · 文件骨架（根 <Blueprint> → meta → 内层 <Blueprint> → BuildableThings）
 *   · 每个条目的字段（ThingDef / TerrainDef / Stuff / Position / Rotation）
 *   · 位置与尺寸的写法（相对蓝图原点，(x, 0, z)）
 *   · 「只导出新增」时存档原有建筑要排除
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;
const Data = app.RWData;
const X = app.RWExport;

function exportXml(state, opts) {
  return X.toBlueprintsXML(state || RW.state, opts || {});
}

// ---------------------------------------------------------------- 骨架
test('蓝图：文件骨架符合 Blueprints 模组的格式', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 5, 5, 0);
  const out = exportXml(RW.state, { name: '测试基地' });

  assert.ok(out.xml.startsWith('\uFEFF'), '应该带 BOM');
  assert.ok(out.xml.includes('<?xml version="1.0" encoding="utf-8"?>'), '应该有 XML 声明');
  assert.ok(out.xml.includes('\r\n'), '应该用 CRLF 换行');
  assert.ok(out.xml.includes('<Blueprint>'), '应该有根 <Blueprint>');
  assert.ok(out.xml.includes('<meta>'), '应该有 <meta>');
  assert.ok(out.xml.includes('<BuildableThings>'), '应该有 <BuildableThings>');
  assert.ok(out.xml.includes('<Name>测试基地</Name>'), '应该写进工程名');
  assert.ok(out.xml.includes('<Category>布局</Category>'), '应该写分类');
  assert.ok(/<Size>\(\d+, \d+\)<\/Size>/.test(out.xml), '<Size> 应该是 (宽, 高)');
});

test('蓝图：meta 里带上模组列表，游戏才不会报「缺少 mod」', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 5, 5, 0);
  const bp = H.parseBlueprint(exportXml(RW.state, { name: 't' }).xml);
  assert.ok(bp.modIds.length > 0, 'modIds 不能是空的');
  assert.ok(bp.modIds.indexOf('ludeon.rimworld') >= 0, '应该带上本体');
});

test('蓝图：存档里的 mod 列表会被复用', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 5, 5, 0);
  const out = exportXml(RW.state, {
    name: 't',
    meta: {
      gameVersion: '1.6.1234',
      modIds: ['ludeon.rimworld', 'my.mod'],
      modSteamIds: ['1', '2'],
      modNames: ['Core', '我的模组'],
    },
  });
  assert.ok(out.xml.includes('<gameVersion>1.6.1234</gameVersion>'));
  assert.ok(out.xml.includes('<li>my.mod</li>'));
});

// ---------------------------------------------------------------- 条目
test('蓝图：每件建筑都写 ThingDef / Position / Rotation', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 3, 4, 0);
  RW.placeBuilding('bed', 10, 10, 90);
  const out = exportXml(RW.state, { name: 't' });
  const bp = H.parseBlueprint(out.xml);

  assert.strictEqual(bp.items.length, 2);
  for (const item of bp.items) {
    assert.ok(item.def, '应该有 ThingDef');
    assert.ok(item.pos, '应该有 Position');
    assert.ok(typeof item.rot === 'number', '应该有 Rotation');
    assert.ok(item.rot >= 0 && item.rot <= 3, 'Rotation 应该是 0-3');
    assert.strictEqual(item.pos.y, 0, 'Position 的 y 恒为 0');
  }
});

test('蓝图：朝向按 0-3 写，不是 0/90/180/270', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('bed', 10, 10, 180);
  const bp = H.parseBlueprint(exportXml(RW.state, { name: 't' }).xml);
  assert.strictEqual(bp.items[0].rot, 2, '180° 应该写成 2');
});

test('蓝图：不可旋转的建筑一律按 0 导出', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('solar_generator', 10, 10, 90);
  const bp = H.parseBlueprint(exportXml(RW.state, { name: 't' }).xml);
  assert.strictEqual(bp.items[0].rot, 0, '太阳能发电机不可旋转，应该导出成 0');
});

test('蓝图：地板写成 TerrainDef 而不是 ThingDef', () => {
  H.resetMap(30, 30);
  RW.state.floors['5,5'] = 'tileSandstone';
  RW.state.floors['6,5'] = 'tileSandstone';
  const out = exportXml(RW.state, { name: 't' });
  assert.ok(out.xml.includes('<TerrainDef>TileSandstone</TerrainDef>'), '应该写 TerrainDef');
  assert.ok(!out.xml.includes('<ThingDef>TileSandstone</ThingDef>'), '不该写成 ThingDef');
  const bp = H.parseBlueprint(out.xml);
  assert.strictEqual(bp.items.length, 2);
  assert.strictEqual(bp.items[0].terrain, 'TileSandstone');
  assert.strictEqual(bp.items[0].rot, 0, '地板没有朝向');
});

test('蓝图：可建材质的东西会写 Stuff，不能用的不写', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 5, 5, 0, { stuff: 'WoodLog' });
  RW.placeBuilding('cooler', 10, 10, 0);   // 制冷机不能换材质
  const bp = H.parseBlueprint(exportXml(RW.state, { name: 't' }).xml);
  const wall = bp.items.find((i) => i.def === 'Wall');
  const cooler = bp.items.find((i) => i.def === 'Cooler');
  assert.strictEqual(wall.stuff, 'WoodLog', '墙应该写材质');
  assert.ok(!cooler.stuff, '制冷机不该写材质');
});

// ---------------------------------------------------------------- 只导出新增
test('蓝图：默认排除存档原有（锁定）的建筑', () => {
  H.resetMap(30, 30);
  RW.placeBuilding('wall', 5, 5, 0, { locked: true });
  RW.placeBuilding('wall', 6, 5, 0);

  const withLock = exportXml(RW.state, { name: 't', excludeLocked: true });
  assert.strictEqual(withLock.count, 1, '锁定的那个不该导出');
  assert.strictEqual(withLock.lockedSkipped, 1);
  assert.strictEqual(H.parseBlueprint(withLock.xml).items.length, 1);

  const all = exportXml(RW.state, { name: 't', excludeLocked: false });
  assert.strictEqual(all.count, 2, '取消排除后应该都导出');
});

test('蓝图：锁定的地板也不导出', () => {
  H.resetMap(30, 30);
  RW.state.floors['5,5'] = 'tileSandstone';
  RW.state.lockedFloors['5,5'] = true;
  RW.state.floors['6,5'] = 'tileSandstone';

  const out = exportXml(RW.state, { name: 't', excludeLocked: true });
  assert.strictEqual(out.count, 1);
  assert.strictEqual(out.lockedSkipped, 1);
});

// ---------------------------------------------------------------- 空 / 尺寸
test('蓝图：空画布导出为空，不报错', () => {
  H.resetMap(30, 30);
  const out = exportXml(RW.state, { name: '空' });
  assert.strictEqual(out.count, 0);
  assert.strictEqual(out.xml, '');
});

test('蓝图：Size 覆盖所有建筑的包围盒', () => {
  H.resetMap(60, 60);
  RW.placeBuilding('wall', 10, 10, 0);
  RW.placeBuilding('wall', 20, 15, 0);
  const out = exportXml(RW.state, { name: 't' });
  // 两面墙的 pos 差 10 格、5 格 → 包围盒 11 × 6
  assert.strictEqual(out.w, 11);
  assert.strictEqual(out.h, 6);
  assert.ok(out.xml.includes('<Size>(11, 6)</Size>'));
});

test('蓝图：位置全是相对坐标，不会出现负数', () => {
  H.resetMap(60, 60);
  RW.placeBuilding('wall', 10, 10, 0);
  RW.placeBuilding('wall', 30, 40, 0);
  const bp = H.parseBlueprint(exportXml(RW.state, { name: 't' }).xml);
  for (const item of bp.items) {
    assert.ok(item.pos.x >= 0, 'x 不该是负数');
    assert.ok(item.pos.z >= 0, 'z 不该是负数');
  }
});
