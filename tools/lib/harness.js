'use strict';
/*
 * tools/lib/harness.js —— 在 Node 里加载浏览器端的 planner 内核
 *
 * 项目里的 js 是纯前端 IIFE：靠 window.RWData / window.RW 这些全局对象互相通信，
 * 没有模块系统、也没有构建步骤。这里用 node:vm 建一个沙箱，按 index.html 的顺序
 * 把它们加载一遍，再补上几个最小 DOM 存根（画布 2D 上下文、localStorage）。
 *
 * 这是**运行时**依赖：tools/plan.js 用它跑 CLI，tests/harness.js 只是再包一层测试助手。
 * 所以分发时只需要 js/ + tools/，不需要 tests/。
 * 零第三方依赖。Node 18+（要 DecompressionStream / Readable.toWeb / Response）。
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

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
  'js/rooms.js',
  'js/checks.js',
  'js/workload.js',
  'js/exporters.js',
  'js/buildops.js',
  'js/planimport.js',
  'js/brief.js',
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
    // 沙箱里的 console：log 也走 stderr，避免污染 CLI 的 stdout（机器要读 JSON）
    console: {
      log: function () { process.stderr.write(Array.prototype.join.call(arguments, ' ') + '\n'); },
      warn: function () { process.stderr.write(Array.prototype.join.call(arguments, ' ') + '\n'); },
      error: function () { process.stderr.write(Array.prototype.join.call(arguments, ' ') + '\n'); },
      info: function () { process.stderr.write(Array.prototype.join.call(arguments, ' ') + '\n'); },
      debug: function () {},
    },
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

module.exports = {
  ROOT: ROOT,
  FILES: FILES,
  makeSandbox: makeSandbox,
  loadApp: loadApp,
};
