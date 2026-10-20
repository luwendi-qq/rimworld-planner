'use strict';
/*
 * tests/harness.js —— 在 Node 里把浏览器端的脚本跑起来
 *
 * 项目里的 js 是纯前端 IIFE：靠 window.RWData / window.RW 这些全局对象互相通信，
 * 没有模块系统、也没有构建步骤。这里用 node:vm 建一个沙箱，按 index.html 里的顺序
 * 把它们加载一遍，再补上几个最小 DOM 存根（画布 2D 上下文、localStorage）。
 *
 * 目的：能在命令行里对「占地 / 朝向 / 坐标换算 / 蓝图导出 / 校验」这些纯逻辑做断言，
 * 而不用开浏览器。零第三方依赖。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

// 加载顺序 = index.html 里 <script> 的顺序。
// 跳过 fzstd/gamezip/gamedefs/gameimport（只在浏览器里用得上），
// 跳过 main.js（要真实 DOM）。
const FILES = [
  'js/data.js',
  'js/zh-names.js',
  'js/buildings.generated.js',   // 精确数据库；没有也不该让测试挂掉
  'js/icons.js',
  'js/engine.js',
  'js/site.js',
  'js/checks.js',
  'js/workload.js',
  'js/exporters.js',
  'js/io.js',
];

// ---------------------------------------------------------------- 2D 上下文存根
function makeCtx() {
  const noop = function () {};
  const ctx = {
    canvas: null,
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1,
    globalAlpha: 1, globalCompositeOperation: 'source-over',
    font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic',
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10,
    shadowBlur: 0, shadowColor: 'transparent', shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, arc: noop, arcTo: noop,
    ellipse: noop, rect: noop, roundRect: noop,
    fill: noop, stroke: noop, clip: noop,
    fillRect: noop, strokeRect: noop, clearRect: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setTransform: noop, transform: noop, resetTransform: noop,
    fillText: noop, strokeText: noop,
    setLineDash: noop, getLineDash: function () { return []; },
    drawImage: noop, drawFocusIfNeeded: noop,
    measureText: function (t) { return { width: String(t == null ? '' : t).length * 6 }; },
    createLinearGradient: function () { return { addColorStop: noop }; },
    createRadialGradient: function () { return { addColorStop: noop }; },
    createPattern: function () { return { setTransform: noop }; },
    createImageData: function (w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
    },
    getImageData: function (x, y, w, h) {
      return { width: w, height: h, data: new Uint8ClampedArray(Math.max(0, w * h * 4)) };
    },
    putImageData: noop,
    getContextAttributes: function () { return {}; },
  };
  return ctx;
}

function makeCanvas() {
  const c = {
    width: 300, height: 150,
    style: {},
    getContext: function () { return c._ctx || (c._ctx = makeCtx()); },
    toDataURL: function () { return 'data:,'; },
    toBlob: function (cb) { if (cb) cb({ __fakeBlob: true, size: 1, type: 'image/png' }); },
    addEventListener: function () {},
    removeEventListener: function () {},
    getBoundingClientRect: function () {
      return { left: 0, top: 0, right: c.width, bottom: c.height, width: c.width, height: c.height };
    },
  };
  return c;
}

function makeDocument() {
  const el = function () {
    return {
      style: {}, dataset: {}, children: [], classList: { add: function () {}, remove: function () {}, contains: function () { return false; } },
      appendChild: function () {}, removeChild: function () {}, setAttribute: function () {},
      getAttribute: function () { return null; }, addEventListener: function () {},
      getContext: function () { return makeCtx(); },
    };
  };
  return {
    createElement: function (tag) { return tag === 'canvas' ? makeCanvas() : el(); },
    createElementNS: function (ns, tag) { return tag === 'canvas' ? makeCanvas() : el(); },
    createTextNode: function () { return {}; },
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    getElementsByTagName: function () { return []; },
    addEventListener: function () {}, removeEventListener: function () {},
    body: el(), documentElement: el(),
  };
}

function makeStorage() {
  const map = new Map();
  return {
    getItem: function (k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem: function (k, v) { map.set(String(k), String(v)); },
    removeItem: function (k) { map.delete(String(k)); },
    clear: function () { map.clear(); },
    key: function (i) { return Array.from(map.keys())[i] || null; },
    get length() { return map.size; },
  };
}

// ---------------------------------------------------------------- 沙箱
function makeSandbox() {
  const sandbox = {
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval,
    queueMicrotask: queueMicrotask,
    Promise: Promise, Date: Date, Math: Math, JSON: JSON,
    URL: { createObjectURL: function () { return 'blob:stub'; }, revokeObjectURL: function () {} },
    devicePixelRatio: 1,
    localStorage: makeStorage(),
    document: makeDocument(),
    performance: { now: function () { return Date.now(); } },
    addEventListener: function () {}, removeEventListener: function () {},
    requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
    cancelAnimationFrame: function (id) { clearTimeout(id); },
    Image: function () { this.width = 0; this.height = 0; },
    Blob: function () {},
    FileReader: function () {},
    File: function () {},
    TextDecoder: TextDecoder, TextEncoder: TextEncoder,
    DecompressionStream: typeof DecompressionStream !== 'undefined' ? DecompressionStream : undefined,
    CompressionStream: typeof CompressionStream !== 'undefined' ? CompressionStream : undefined,
  };
  vm.createContext(sandbox);
  // 让 IIFE 里的 `typeof window !== 'undefined' ? window : globalThis` 拿到沙箱全局
  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', sandbox);
  return sandbox;
}

let cached = null;

/** 加载一次，返回沙箱（含 RWData / RW / RWSite / RWChecks / RWWork / RWExport）。 */
function loadApp() {
  if (cached) return cached;
  const sandbox = makeSandbox();
  for (const rel of FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p });
  }
  cached = sandbox;
  return sandbox;
}

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
