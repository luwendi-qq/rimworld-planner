'use strict';
/*
 * tests/gameimport-drop.test.js —— 「把文件夹拖进来」的收集逻辑
 *
 * 背景：macOS 上双击打开 html（file://）时，Chromium 会拒绝 webkitGetAsEntry 的
 * 目录读取（readEntries 抛 EncodingError），拖进来的文件夹变成 0 个文件。
 * 现在的实现是 entry-first：同步拿 webkitGetAsEntry / getAsFile，
 * getAsFileSystemHandle 只在没有 entry 时兜底，而且必须带超时
 * （Chromium 在 file:// / 没有手势的合成拖拽里，这个 Promise 可能永远不落地）。
 *
 * 这里用一个最小 vm 沙箱加载 js/gameimport.js（它只依赖浏览器全局，加载时不需要 DOM），
 * 然后用假的 DataTransferItem / FileSystemHandle 把各条兜底路径都过一遍。
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadGameImport(opts) {
  opts = opts || {};
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.console = console;
  // 测试里超时用立即执行，免得为了验证「promise 永不落地」真等 4 秒
  sandbox.setTimeout = opts.fastTimers ? function (fn) { setImmediate(fn); return 1; } : setTimeout;
  sandbox.clearTimeout = opts.fastTimers ? function () {} : clearTimeout;
  sandbox.Promise = Promise;
  sandbox.URL = URL;
  sandbox.Uint8Array = Uint8Array;
  sandbox.Uint8ClampedArray = Uint8ClampedArray;
  vm.createContext(sandbox);
  const code = fs.readFileSync(path.join(ROOT, 'js', 'gameimport.js'), 'utf8');
  vm.runInContext(code, sandbox, { filename: 'js/gameimport.js' });
  return { RWGame: sandbox.RWGame, sandbox: sandbox };
}

const loaded = loadGameImport();
const RWGame = loaded.RWGame;

/** 假的 FileSystemDirectoryHandle（只要有 kind/name/values 就够走递归） */
function dirHandle(name, children) {
  return {
    kind: 'directory',
    name: name,
    values: function () {
      let i = 0;
      return {
        next: function () {
          if (i < children.length) return Promise.resolve({ done: false, value: children[i++] });
          return Promise.resolve({ done: true, value: undefined });
        }
      };
    }
  };
}

/** 假的 FileSystemFileHandle */
function fileHandle(name, opts) {
  opts = opts || {};
  return {
    kind: 'file',
    name: name,
    getFile: function () {
      if (opts.fail) return Promise.reject(new Error('not readable'));
      const f = { name: name, text: async function () { return opts.text || ''; }, size: 1 };
      return Promise.resolve(f);
    }
  };
}

/** 假的 DataTransferItem：handle / entry / file 三种能力按需拼 */
function item(opts) {
  const it = { kind: 'file' };
  if (opts.handle) {
    it.getAsFileSystemHandle = function () {
      return opts.handle === 'reject' ? Promise.reject(new Error('nope')) : Promise.resolve(opts.handle);
    };
  }
  if (opts.entry) {
    it.webkitGetAsEntry = function () { return opts.entry; };
  }
  if (opts.file) {
    it.getAsFile = function () { return opts.file; };
  }
  return it;
}

/** 假的 webkitGetAsEntry 目录：readEntries 分两批返回 */
function entryDir(name, children, opts) {
  opts = opts || {};
  return {
    isDirectory: true,
    isFile: false,
    name: name,
    createReader: function () {
      let done = false;
      return {
        readEntries: function (ok, fail) {
          if (opts.failRead) return fail(new DOMException('bad uri', 'EncodingError'));
          if (done) return ok([]);
          done = true;
          return ok(children);
        }
      };
    }
  };
}

function entryFile(name) {
  return {
    isFile: true,
    isDirectory: false,
    name: name,
    file: function (ok) { ok({ name: name, size: 1 }); }
  };
}

function pathsOf(list) {
  // 注意：list 是 vm 沙箱里造的数组（跟测试文件不是同一个 realm），
  // 先用本地的 Array.from 拷回来，deepStrictEqual 才不会因为原型不同误报
  return Array.from(list, function (x) { return x.path; }).sort();
}

test('dropHasFiles：文字/链接拖拽不算文件', function () {
  assert.equal(RWGame.dropHasFiles(null), false);
  assert.equal(RWGame.dropHasFiles({ files: [], items: [{ kind: 'string' }] }), false);
  assert.equal(RWGame.dropHasFiles({ files: [], items: [{ kind: 'file' }] }), true);
  assert.equal(RWGame.dropHasFiles({ files: [{ name: 'a.txt' }] }), true);
});

test('没有 entry 时用 getAsFileSystemHandle 递归读目录', async function () {
  const handle = dirHandle('RimWorld', [
    dirHandle('Data', [
      dirHandle('Core', [fileHandle('About.xml', { text: '<About/>' })]),
      fileHandle('Version.txt', { text: '1.5' })
    ]),
    fileHandle('readme.mdx')
  ]);
  const out = await RWGame.collectFromDrop({ items: [item({ handle: handle })], files: [] });
  assert.deepStrictEqual(pathsOf(out), [
    'RimWorld/Data/Core/About.xml',
    'RimWorld/Data/Version.txt',
    'RimWorld/readme.mdx'
  ]);
  assert.ok(out.every(function (x) { return x.file; }));
});

test('entry 优先：有 webkitGetAsEntry 时直接走它', async function () {
  const entry = entryDir('Mods', [entryDir('CoolMod', [entryFile('About.xml')])]);
  const out = await RWGame.collectFromDrop({ items: [item({ handle: 'reject', entry: entry })], files: [] });
  assert.deepStrictEqual(pathsOf(out), ['Mods/CoolMod/About.xml']);
});

test('webkitGetAsEntry 读目录失败（macOS file:// 的 EncodingError）不抛异常', async function () {
  const entry = entryDir('RimWorld', [entryFile('About.xml')], { failRead: true });
  const out = await RWGame.collectFromDrop({ items: [item({ handle: 'reject', entry: entry })], files: [] });
  assert.deepStrictEqual(Array.from(out), []);
});

test('两种接口都在时不会重复收集', async function () {
  const handle = dirHandle('Mods', [fileHandle('a.xml')]);
  const entry = entryDir('Mods', [entryFile('a.xml')]);
  const out = await RWGame.collectFromDrop({ items: [item({ handle: handle, entry: entry })], files: [] });
  assert.deepStrictEqual(pathsOf(out), ['Mods/a.xml']);
});

test('items 为空时退回 dt.files', async function () {
  const f = { name: 'Assets.zip', webkitRelativePath: '' };
  const out = await RWGame.collectFromDrop({ items: [], files: [f] });
  assert.deepStrictEqual(pathsOf(out), ['Assets.zip']);
  assert.equal(out[0].file, f);
});

test('单个文件（没有 handle/entry）退回 getAsFile', async function () {
  const f = { name: 'save.rws' };
  const out = await RWGame.collectFromDrop({ items: [item({ file: f })], files: [f] });
  assert.deepStrictEqual(pathsOf(out), ['save.rws']);
});

test('目录里某个文件读不出来时跳过，不影响其它文件', async function () {
  const handle = dirHandle('Mods', [
    fileHandle('bad.xml', { fail: true }),
    fileHandle('good.xml')
  ]);
  const out = await RWGame.collectFromDrop({ items: [item({ handle: handle })], files: [] });
  assert.deepStrictEqual(pathsOf(out), ['Mods/good.xml']);
});

test('file:// 页面不走 getAsFileSystemHandle（它会永远挂着），直接用 entry', async function () {
  const env = loadGameImport({ fastTimers: true });
  env.sandbox.location = { protocol: 'file:' };
  const entry = entryDir('RimWorld', [entryDir('Data', [entryFile('Version.txt')])]);
  const it = item({
    handle: { kind: 'directory', name: 'RimWorld', values: function () { throw new Error('file:// 下不该走到这里'); } },
    entry: entry
  });
  it.getAsFileSystemHandle = function () { throw new Error('file:// 下不该调用 getAsFileSystemHandle'); };
  const out = await env.RWGame.collectFromDrop({ items: [it], files: [] });
  assert.deepStrictEqual(pathsOf(out), ['RimWorld/Data/Version.txt']);
});

test('getAsFileSystemHandle 永不落地时超时兜底到 entry，不会卡死', async function () {
  const env = loadGameImport({ fastTimers: true });
  const entry = entryDir('Mods', [entryFile('About.xml')]);
  const it = item({ entry: entry });
  it.getAsFileSystemHandle = function () { return new Promise(function () { /* 永远不 resolve，模拟 Chromium 在 file:// 的行为 */ }); };
  const out = await env.RWGame.collectFromDrop({ items: [it], files: [] });
  assert.deepStrictEqual(pathsOf(out), ['Mods/About.xml']);
});

test('字符串 item 不会被当成文件', async function () {
  const out = await RWGame.collectFromDrop({
    items: [{ kind: 'string', getAsFileSystemHandle: function () { throw new Error('不该被调用'); } }],
    files: []
  });
  assert.deepStrictEqual(Array.from(out), []);
});

test('looksLikeGameDir：zip / Data 下的 Defs xml 才算游戏目录', function () {
  assert.equal(RWGame.looksLikeGameDir([{ path: 'RimWorld/Data/Core/Assets.zip' }]), true);
  assert.equal(RWGame.looksLikeGameDir([{ path: 'RimWorld.app/Contents/MacOS/Assets.zip' }]), true);
  assert.equal(RWGame.looksLikeGameDir([{ path: 'RimWorld/Data/Core/Defs/ThingDefs_Buildings/Buildings.xml' }]), true);
  assert.equal(RWGame.looksLikeGameDir([{ path: 'RimWorld/ScenarioPreview.jpg' }]), false);
  assert.equal(RWGame.looksLikeGameDir([{ path: 'RimWorld' }]), false);
  assert.equal(RWGame.looksLikeGameDir([]), false);
  assert.equal(RWGame.looksLikeGameDir(null), false);
});

test('looksLikeModDir：About.xml / 任意 Defs xml 算模组目录', function () {
  assert.equal(RWGame.looksLikeModDir([{ path: 'Mods/CoolMod/About/About.xml' }]), true);
  assert.equal(RWGame.looksLikeModDir([{ path: 'CoolMod/Defs/Buildings.xml' }]), true);
  assert.equal(RWGame.looksLikeModDir([{ path: 'CoolMod/Textures/a.png' }]), false);
  assert.equal(RWGame.looksLikeModDir(null), false);
});
