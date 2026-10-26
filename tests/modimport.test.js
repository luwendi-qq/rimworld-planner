'use strict';
/*
 * tests/modimport.test.js —— 拖入模组 → 扫描模组新增建筑
 *
 * 这里把浏览器用的四个 IIFE 也装进同一个沙箱（gamezip / gamedefs / gameimport / modimport），
 * 然后用「假的 File 对象」模拟拖入的模组目录。锁住：
 *   · 能从 About/About.xml 认出模组，并收集 packageId / 名字 / 创意工坊 id
 *   · 模组 Defs 和缓存的「核心 Defs XML」拼在一起解析，ParentName 跨模组继承能解开
 *   · 只把该模组自己声明的建筑合并进数据库，并打上 mod / modName 标记
 *   · 删除模组时回滚到核心数据；导出蓝图时 meta.modIds 自动带上模组
 *   · LoadFolders.xml 版本选择、没有 LoadFolders.xml 时的版本目录回退
 *   · 失败信息：不是模组目录 / 官方 Core / 没有可建造建筑
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const H = require('./harness.js');
const L = require('../tools/lib/load.js');

const app = L.loadApp();
for (const rel of ['js/gamezip.js', 'js/gamedefs.js', 'js/gameimport.js', 'js/modimport.js']) {
  vm.runInContext(fs.readFileSync(path.join(H.ROOT, rel), 'utf8'), app, { filename: rel });
}

const Data = app.RWData;
const Mods = app.RWMods;
const Game = app.RWGame;

// ---------------------------------------------------------------- 假文件

function fakeFile(name, text) {
  return {
    name: name,
    text: async function () { return text; },
    arrayBuffer: async function () { return new ArrayBuffer(0); },
  };
}

/** 把一个 { 相对路径: 内容 } 的对象变成「拖入的文件列表」 */
function drop(files) {
  return Object.keys(files).map(function (rel) {
    return { path: rel, file: fakeFile(rel.split('/').pop(), files[rel]) };
  });
}

// ---------------------------------------------------------------- 测试用 XML

const CORE_DOCS = [{
  path: 'Data/Core/Defs/ThingDefs_Buildings/Buildings.xml',
  xml: [
    '<Defs>',
    '  <ThingDef Name="TestBuildingBase" Abstract="True">',
    '    <category>Building</category>',
    '    <designationCategory>Furniture</designationCategory>',
    '    <stuffCategories><li>Woody</li></stuffCategories>',
    '    <statBases><WorkToBuild>10</WorkToBuild><Beauty>2</Beauty></statBases>',
    '  </ThingDef>',
    '  <ThingDef ParentName="TestBuildingBase">',
    '    <defName>TestCoreTable</defName>',
    '    <label>table</label>',
    '    <thingClass>Building</thingClass>',
    '    <size>(1,2)</size>',
    '    <graphicData><texPath>Things/Furniture/Table</texPath><graphicClass>Graphic_Multi</graphicClass></graphicData>',
    '  </ThingDef>',
    '</Defs>',
  ].join('\n'),
}];

const ABOUT = function (name, pkg, extra) {
  return [
    '<ModMetaData>',
    '  <name>' + name + '</name>',
    '  <author>tester</author>',
    '  <packageId>' + pkg + '</packageId>',
    '  <modVersion>1.0</modVersion>',
    '  <supportedVersions><li>1.6</li><li>1.7</li></supportedVersions>',
    extra || '',
    '</ModMetaData>',
  ].join('\n');
};

function benchDef(defName, parent, label) {
  return [
    '<Defs><ThingDef ParentName="' + parent + '">',
    '  <defName>' + defName + '</defName>',
    '  <label>' + (label || defName) + '</label>',
    '  <thingClass>Building</thingClass>',
    '  <size>(2,1)</size>',
    '  <graphicData><texPath>Things/Furniture/Bench</texPath><graphicClass>Graphic_Single</graphicClass></graphicData>',
    '</ThingDef></Defs>',
  ].join('\n');
}

/** 铺一份「已导入游戏目录」的核心数据（相当于用户之前拖过游戏目录） */
async function seedCore(docs, version) {
  docs = docs || CORE_DOCS;
  version = version || '1.7';
  const parsed = app.RWDefs.parse(docs, {});
  await Game.setMeta('defdocs', docs);
  await Game.setMeta('gameVersion', version);
  await Game.setMeta('buildings', parsed.buildings);
  await Game.setMeta('stuffs', parsed.stuffs);
  await Game.setMeta('stuffCats', parsed.stuffCats);
  await Game.setMeta('manifest', {
    base: null, atlas: { cols: 4, rows: 4, inset: 0.03125 },
    stuff: {}, byName: {}, boxes: {}, items: {}, floors: {},
  });
}

/** 每个用例前清干净：IndexedDB（内存版）+ 内存状态 + 之前合并进来的模组建筑 */
async function clean() {
  await Game.clearCache();
  Mods.reset();
  for (let i = Data.BUILDINGS.length - 1; i >= 0; i--) {
    const b = Data.BUILDINGS[i];
    if (b && b.mod) {
      if (Data.byId[b.id] === b) delete Data.byId[b.id];
      Data.BUILDINGS.splice(i, 1);
    }
  }
  Data.reindexBuildings();
}

const MOD_ABOUT_PATH = 'Mods/TestMod/About/About.xml';

// ---------------------------------------------------------------- 看门狗：导入的数据越界恢复

test('模组：重复导入同一个 packageId 只保留一份记录', async () => {
  await clean();
  await seedCore();
  const files = drop({});
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod', '<publishedFileId>0</publishedFileId>'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase'),
  });
  const first = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(first.mods.length, 1);
  assert.equal(first.mods[0].packageId, 'tester.mod');
  assert.equal(first.mods[0].name, '测试模组');
  const second = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(second.mods.length, 1, '同一个模组重新导入不应该出现两条记录');
  assert.equal(second.buildings, 1, '同一个模组重新导入不应该重复加建筑');
  assert.ok(Data.byId['TestBench'], '模组建筑应该进数据库');
  assert.equal(Data.byId['TestBench'].mod, 'tester.mod');
  assert.equal(Data.byId['TestBench'].modName, '测试模组');
  assert.ok(Data.byId['TestCoreTable'], '核心建筑不能被模组导入弄丢');
});

test('模组：ParentName 继承自原版抽象 def 也能解析（需要核心 Defs 缓存）', async () => {
  await clean();
  await seedCore();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase', '工作台'),
  });
  const res = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(res.hasCore, true);
  const b = Data.byId['TestBench'];
  assert.ok(b);
  assert.deepEqual(b.size, [2, 1], '尺寸应来自模组自己写的那行');
  assert.equal(b.name, '工作台');
  // 材质分类、分类、工时、美观这些字段继承自原版抽象 def
  assert.deepEqual(b.stuffCats, ['Woody']);
  assert.equal(b.cat, 'furniture');
  assert.equal(b.work, 10);
  assert.equal(b.beauty, 2);
});

test('模组：没有导入游戏目录时，只解析模组自己文档里能解出来的部分（并给出提示）', async () => {
  await clean();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase'),
  });
  const res = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(res.hasCore, false);
  assert.ok(res.warnings.some(function (w) { return /没有找到已导入的游戏目录/.test(w.message); }));
  assert.equal(Data.byId['TestBench'], undefined, '解析不出 designationCategory 时不应该硬塞进数据库');
  assert.equal(res.mods.length, 1);
  assert.equal(res.mods[0].count, 0);
});

test('模组：删除后回滚到核心数据，核心建筑原样保留', async () => {
  await clean();
  await seedCore();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase'),
  });
  await Mods.importFiles(m, null, { skipTextures: true });
  assert.ok(Data.byId['TestBench']);
  const res = await Mods.remove('tester.mod');
  assert.equal(res.mods.length, 0);
  assert.equal(Data.byId['TestBench'], undefined, '删模组后建筑应该消失');
  assert.ok(Data.byId['TestCoreTable'], '核心建筑应该还在');
});

test('模组：启动时从 IndexedDB 恢复', async () => {
  await clean();
  await seedCore();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase'),
  });
  await Mods.importFiles(m, null, { skipTextures: true });
  // 模拟刷新页面：清掉内存里合并过的模组建筑
  Mods.reset();
  for (let i = Data.BUILDINGS.length - 1; i >= 0; i--) {
    const b = Data.BUILDINGS[i];
    if (b && b.mod) Data.BUILDINGS.splice(i, 1);
  }
  Data.reindexBuildings();
  assert.equal(Data.byId['TestBench'], undefined);
  const res = await Mods.restore();
  assert.ok(res);
  assert.equal(res.mods.length, 1);
  assert.ok(Data.byId['TestBench'], '刷新后应该从 IndexedDB 恢复模组建筑');
});

test('模组：导出蓝图时 meta.modIds 自动带上扫描进来的模组', async () => {
  await clean();
  await seedCore();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod', '<publishedFileId>123456</publishedFileId>'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase'),
  });
  await Mods.importFiles(m, null, { skipTextures: true });

  H.resetMap(20, 20);
  app.RW.placeBuilding('TestBench', 4, 4, 0);
  const out = app.RWExport.toBlueprintsXML(app.RW.state, { name: '测试蓝图' });
  assert.ok(out.count > 0, '应该导出一条建筑');
  assert.ok(out.xml.indexOf('<ThingDef>TestBench</ThingDef>') >= 0);
  assert.ok(out.xml.indexOf('<li>tester.mod</li>') >= 0, 'modIds 应包含模组 packageId');
  assert.ok(out.xml.indexOf('<li>123456</li>') >= 0, 'modSteamIds 应包含创意工坊 id');
  assert.ok(out.xml.indexOf('<li>测试模组</li>') >= 0, 'modNames 应包含模组名');
  assert.ok(out.xml.indexOf('<gameVersion>1.7</gameVersion>') >= 0);
});

test('模组：蓝图没用到某个模组时，meta 不写它的 packageId（Blueprints 只做 mod 差异提示）', async () => {
  await clean();
  await seedCore();
  const m = drop({
    'Mods/ModA/About/About.xml': ABOUT('甲模组', 'tester.a'),
    'Mods/ModA/Defs/Bench.xml': benchDef('TestBenchA', 'TestBuildingBase'),
    'Mods/ModB/About/About.xml': ABOUT('乙模组', 'tester.b'),
    'Mods/ModB/Defs/Bench.xml': benchDef('TestBenchB', 'TestBuildingBase'),
  });
  const res = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(res.mods.length, 2);

  H.resetMap(20, 20);
  app.RW.placeBuilding('TestBenchA', 4, 4, 0);
  const out = app.RWExport.toBlueprintsXML(app.RW.state, { name: '只用了甲模组' });
  assert.ok(out.xml.indexOf('<li>tester.a</li>') >= 0, '用到的模组要写进 modIds');
  assert.equal(out.xml.indexOf('<li>tester.b</li>'), -1, '没用到的模组不该出现在 modIds');
});

test('模组：LoadFolders.xml 按当前游戏版本挑文件夹', async () => {
  await clean();
  await seedCore();
  const lf = [
    '<loadFolders>',
    '  <v1.6><li>1.6</li></v1.6>',
    '  <v1.7><li>1.7</li></v1.7>',
    '  <default><li>/</li></default>',
    '</loadFolders>',
  ].join('\n');
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/LoadFolders.xml': lf,
    'Mods/TestMod/1.6/Defs/Old.xml': benchDef('TestOldBench', 'TestBuildingBase'),
    'Mods/TestMod/1.7/Defs/New.xml': benchDef('TestNewBench', 'TestBuildingBase'),
  });
  await Mods.importFiles(m, null, { skipTextures: true });
  assert.ok(Data.byId['TestNewBench'], '1.7 目录下的建筑应该导入');
  assert.equal(Data.byId['TestOldBench'], undefined, '1.6 目录下的建筑不该在 1.7 里导入');
});

test('模组：没写 LoadFolders.xml 时回退到「不高于当前版本的版本目录」', async () => {
  await clean();
  await seedCore();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/1.6/Defs/Old.xml': benchDef('TestOldBench', 'TestBuildingBase'),
    'Mods/TestMod/1.7/Defs/New.xml': benchDef('TestNewBench', 'TestBuildingBase'),
  });
  await Mods.importFiles(m, null, { skipTextures: true });
  assert.ok(Data.byId['TestNewBench']);
  assert.equal(Data.byId['TestOldBench'], undefined);
});

test('模组：pickLoadFolders 会跳过 IfModActive 条件文件夹、支持根目录 "/"', () => {
  const lf = [
    '<loadFolders>',
    '  <v1.7>',
    '    <li>/</li>',
    '    <li>1.7</li>',
    '    <li IfModActive="foo.bar">Compat</li>',
    '  </v1.7>',
    '</loadFolders>',
  ].join('\n');
  const dirs = Mods._pickLoadFolders(lf, '1.7');
  assert.deepEqual(Array.from(dirs), ['', '1.7']);
  // 版本超前的 v1.8 不选
  assert.deepEqual(Array.from(Mods._pickLoadFolders('<loadFolders><v1.6><li>1.6</li></v1.6><v1.8><li>1.8</li></v1.8></loadFolders>', '1.7')), ['1.6']);
});

test('模组：不是模组目录 / 官方 Core 都会给出明确错误', async () => {
  await clean();
  await assert.rejects(
    Mods.importFiles(drop({ '随便一个文件/readme.txt': 'hi' }), null, { skipTextures: true }),
    /没找到模组[\s\S]*创意工坊/
  );
  const core = drop({
    'Data/Core/About/About.xml': ABOUT('Core', 'ludeon.rimworld'),
    'Data/Core/Defs/ThingDefs_Buildings/Buildings.xml': CORE_DOCS[0].xml,
  });
  const res = await Mods.importFiles(core, null, { skipTextures: true });
  assert.equal(res.mods.length, 0);
  assert.ok(res.errors.some(function (e) { return /官方 Core\/DLC/.test(e.message); }));
});

test('模组：创意工坊目录（steamapps/workshop/content/294100/<id>/）自动把文件夹名当工坊 ID', async () => {
  await clean();
  await seedCore();
  const m = drop({
    'steamapps/workshop/content/294100/833899765/About/About.xml': ABOUT('工坊模组', 'tester.workshop'),
    'steamapps/workshop/content/294100/833899765/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBenchW', 'TestBuildingBase'),
  });
  const res = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(res.mods.length, 1, '应认出 294100 下的一个模组');
  assert.equal(res.mods[0].packageId, 'tester.workshop');
  assert.equal(res.mods[0].steamId, '833899765', '老 mod 没带 PublishedFileId.txt 时用文件夹名兜底');
  assert.equal(res.buildings, 1, '应扫出模组建筑');

  H.resetMap(20, 20);
  app.RW.placeBuilding('TestBenchW', 4, 4, 0);
  const out = app.RWExport.toBlueprintsXML(app.RW.state, { name: '工坊模组蓝图' });
  assert.ok(out.xml.indexOf('<li>833899765</li>') >= 0, 'meta.modSteamIds 应包含工坊 ID');
});

test('模组：一个建筑都没有时给出提示，但记录仍然保存（方便以后补核心数据再解析）', async () => {
  await clean();
  await seedCore();
  const m = drop({
    [MOD_ABOUT_PATH]: ABOUT('只有物品的模组', 'tester.items'),
    'Mods/TestMod/Defs/Items.xml': '<Defs><ThingDef><defName>TestItem</defName><label>item</label><category>Item</category></ThingDef></Defs>',
  });
  const res = await Mods.importFiles(m, null, { skipTextures: true });
  assert.equal(res.mods.length, 1);
  assert.ok(res.warnings.some(function (w) { return /没有解析出可建造建筑/.test(w.message); }));
});

test('模组：groupMods 能一次认出 Mods/ 下的多个模组，忽略非模组目录', () => {
  const files = drop({
    'Mods/A/About/About.xml': ABOUT('A', 'a.a'),
    'Mods/A/Defs/x.xml': '<Defs/>',
    'Mods/B/About/About.xml': ABOUT('B', 'b.b'),
    'Mods/README.txt': 'x',
    'Mods/B/Textures/x.png': 'x',
  });
  const groups = Mods._groupMods(files);
  assert.equal(groups.length, 2);
  assert.deepEqual(groups.map(function (g) { return g.root; }).sort(), ['Mods/A', 'Mods/B']);
});

test('模组：classifyFiles 只收 Defs / 简中语言包 / Textures 里的贴图', () => {
  const files = drop({
    [MOD_ABOUT_PATH]: ABOUT('测试模组', 'tester.mod'),
    'Mods/TestMod/Defs/ThingDefs_Buildings/Bench.xml': benchDef('TestBench', 'TestBuildingBase'),
    'Mods/TestMod/Languages/ChineseSimplified/DefInjected/ThingDef/Bench.xml': '<LanguageData><TestBench>长凳</TestBench></LanguageData>',
    'Mods/TestMod/Textures/Things/Furniture/Bench.png': 'x',
    'Mods/TestMod/Textures/Things/Furniture/Bench_east.png': 'x',
    'Mods/TestMod/Readme.md': 'x',
  });
  const groups = Mods._groupMods(files);
  const cls = Mods._classifyFiles(groups[0], ['']);
  assert.equal(cls.defDocs.length, 1);
  assert.equal(cls.langDocs.length, 1);
  assert.deepEqual(cls.textures.map(function (t) { return t.rel; }).sort(),
    ['Things/Furniture/Bench.png', 'Things/Furniture/Bench_east.png']);
});
