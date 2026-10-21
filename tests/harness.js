'use strict';
/*
 * tests/harness.js —— 测试侧的沙箱封装
 *
 * 沙箱本体在 tools/lib/harness.js（CLI 与测试共用同一份），
 * 这里只保留测试专用的助手：resetMap / setTerrain / setRocks / parseBlueprint。
 */

const { ROOT, FILES, makeSandbox, loadApp } = require('../tools/lib/harness.js');

/** 清空画布，回到一张干净的白纸，方便每个用例独立跑。 */
function resetMap(cols, rows) {
  const app = loadApp();
  const RW = app.RW;
  const s = RW.state;
  s.buildings = [];
  s.floors = {};
  s.lockedFloors = {};
  s.plannedFloors = {};
  s.terrain = null;
  s.rocks = null;
  s.roofs = null;
  s.home = null;
  s.roomTemp = {};
  s.ambientTemp = 21;
  s.saveInfo = null;
  s.terrainReady = false;
  s.respectTerrain = true;
  s.strictTerrain = false;
  s.mapName = '测试布局';
  s.flipZ = true;
  s.flipX = false;
  s.selection = {};
  s.floorSelection = {};
  s.history = [];
  s.future = [];
  RW.setGrid(cols || 60, rows || 60, true);
  return s;
}

/**
 * 造一张地形图。
 * fill = { 'Soil': (x,z)=>true, 'MarshyTerrain': (x,z)=>... }，
 * 每个地形名配一个函数，返回 true 的格子就是该地形；没被任何函数命中的格子留空。
 */
function setTerrain(w, h, fill) {
  const s = loadApp().RW.state;
  const cells = new Uint16Array(w * h);
  const defs = {};
  const idx = {};
  const rules = [];
  let next = 1;
  for (const [name, fn] of Object.entries(fill)) {
    idx[name] = next;
    defs[next] = name;
    rules.push({ fn: fn, v: next });
    next++;
  }
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      for (const r of rules) {
        if (r.fn(x, z)) { cells[z * w + x] = r.v; break; }
      }
    }
  }
  s.terrain = { w: w, h: h, cells: cells, defs: defs };
  s.terrainReady = true;
  return s.terrain;
}

/**
 * 造一张山体图。
 * fill = { '5,5': 'Granite', '6,5': 'Granite' }，键是坐标，值是岩石 defName。
 */
function setRocks(w, h, fill) {
  const s = loadApp().RW.state;
  const cells = new Uint16Array(w * h);
  const defs = {};
  const idx = {};
  let next = 1;
  for (const name of Object.values(fill)) {
    if (idx[name]) continue;
    idx[name] = next;
    defs[next] = name;
    next++;
  }
  for (const [k, name] of Object.entries(fill)) {
    const [x, z] = k.split(',').map(Number);
    cells[z * w + x] = idx[name];
  }
  s.rocks = { w: w, h: h, cells: cells, defs: defs };
  return s.rocks;
}

/** 极简 XML 解析：把导出的蓝图拆成条目数组（我们自己生成的格式，正则足够）。 */
function parseBlueprint(xml) {
  const items = [];
  // 只看 <BuildableThings> 段，别把 <meta> 里的 modIds / modNames 的 <li> 也当成建筑
  const block = /<BuildableThings>([\s\S]*?)<\/BuildableThings>/.exec(xml);
  const body = block ? block[1] : '';
  const re = /<li>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const body2 = m[1];
    const item = {};
    const t = /<TerrainDef>(.*?)<\/TerrainDef>/.exec(body2);
    const d = /<ThingDef>(.*?)<\/ThingDef>/.exec(body2);
    const s = /<Stuff>(.*?)<\/Stuff>/.exec(body2);
    const p = /<Position>\((-?\d+),\s*(-?\d+),\s*(-?\d+)\)<\/Position>/.exec(body2);
    const r = /<Rotation>(\d+)<\/Rotation>/.exec(body2);
    if (t) item.terrain = t[1];
    if (d) item.def = d[1];
    if (s) item.stuff = s[1];
    if (p) item.pos = { x: +p[1], y: +p[2], z: +p[3] };
    if (r) item.rot = +r[1];
    items.push(item);
  }
  return {
    items: items,
    size: (function () {
      const s = /<Size>\((-?\d+),\s*(-?\d+)\)<\/Size>/.exec(xml);
      return s ? { w: +s[1], h: +s[2] } : null;
    })(),
    name: (function () {
      const s = /<Name>(.*?)<\/Name>/.exec(xml);
      return s ? s[1] : null;
    })(),
    category: (function () {
      const s = /<Category>(.*?)<\/Category>/.exec(xml);
      return s ? s[1] : null;
    })(),
    modIds: (function () {
      const s = /<modIds>([\s\S]*?)<\/modIds>/.exec(xml);
      if (!s) return [];
      return (s[1].match(/<li>(.*?)<\/li>/g) || []).map(function (x) {
        return x.replace(/<\/?li>/g, '');
      });
    })(),
  };
}

/**
 * 把沙箱里的值转成宿主对象。
 * vm 沙箱里的对象带着另一个 realm 的 prototype，assert.deepStrictEqual 会因为
 * prototype 不同而失败，所以比对面统一先过一遍这个函数。
 */
function plain(v) {
  if (v === null || v === undefined) return v;
  if (typeof v !== 'object') return v;
  return JSON.parse(JSON.stringify(v));
}

module.exports = {
  ROOT: ROOT,
  loadApp: loadApp,
  resetMap: resetMap,
  setTerrain: setTerrain,
  setRocks: setRocks,
  parseBlueprint: parseBlueprint,
  plain: plain,
};
