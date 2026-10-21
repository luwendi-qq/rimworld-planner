'use strict';
/*
 * tools/lib/load.js —— 在 Node 里加载浏览器端的 planner 内核
 *
 * 复用 tests/harness.js 的沙箱（同样的加载顺序、同样的 canvas 存根），
 * 只补几样「io.js 读存档需要、Node 里又没有」的东西：
 *
 *   DOMParser         →  tools/lib/dom.js
 *   atob / btoa       →  Buffer base64
 *   Blob              →  harness 里是个空壳，但 io.js 要 Blob.stream() 喂给解压流
 *   Response          →  Node 自带（undici），沙箱里没有
 *
 * 这样命令行和测试跑的是同一份代码，不会出现「测试过了、CLI 行为不一样」。
 */

const { Readable } = require('node:stream');
const harness = require('./harness.js');
const { DOMParser } = require('./dom.js');

function toBuffer(part) {
  if (typeof part === 'string') return Buffer.from(part, 'utf8');
  if (ArrayBuffer.isView(part)) return Buffer.from(part.buffer, part.byteOffset, part.byteLength);
  if (part instanceof ArrayBuffer) return Buffer.from(part);
  return Buffer.from(String(part), 'utf8');
}

/** io.js 只用到 Blob([bytes]).stream() */
function makeBlob(parts, opts) {
  const buf = Buffer.concat((parts || []).map(toBuffer));
  return {
    size: buf.length,
    type: (opts && opts.type) || '',
    stream: function () { return Readable.toWeb(Readable.from([buf])); },
    arrayBuffer: async function () {
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  };
}

function loadApp() {
  const app = harness.loadApp();
  if (!app.DOMParser) app.DOMParser = DOMParser;
  if (typeof app.atob !== 'function') {
    app.atob = function (s) { return Buffer.from(String(s), 'base64').toString('binary'); };
  }
  if (typeof app.btoa !== 'function') {
    app.btoa = function (s) { return Buffer.from(String(s), 'binary').toString('base64'); };
  }
  app.Blob = makeBlob;
  if (app.Response === undefined) app.Response = Response;
  return app;
}

module.exports = { loadApp };
