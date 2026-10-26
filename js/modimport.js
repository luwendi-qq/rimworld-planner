/*
 * modimport.js —— 「拖入模组，把模组新增的可建造建筑扫描进来」
 *
 * 和 gameimport.js 一样全部在浏览器里跑，玩家不用装任何东西：
 *   1. 从拖入的文件路径里找 About/About.xml，认出每个模组（packageId / 名字 / 支持版本 / 创意工坊 id）
 *   2. 按 LoadFolders.xml 挑出这个模组对当前游戏版本生效的文件夹；
 *      没写 LoadFolders.xml 的（老模组，通常只有 1.6/ 1.7/ 这样的版本目录）按版本目录回退
 *   3. 把模组 Defs XML 和「导入游戏目录时缓存下来的核心 Defs XML」拼在一起交给 RWDefs 解析
 *      —— 模组里 ParentName 指向原版抽象 def 的继承，只有这样才解得开
 *   4. 只挑这个模组自己声明的 ThingDef（可建造的），打上 mod/modName 标记并进 RWData
 *   5. 模组的 Textures/** 是散装 png/dds（不像原版打包在 Assets.zip 里），按 graphicData 解出来合并进贴图清单
 *   6. 全部存 IndexedDB：下次打开自动恢复；删除模组时只回滚模组那一层，核心数据不动
 *
 * 依赖：RWData（data.js）、RWDefs（gamedefs.js）、RWZip（gamezip.js）、RWGame（gameimport.js）。
 * 单独加载本文件是安全的：所有跨模块引用都发生在函数调用时。
 */
(function (global) {
  'use strict';

  var MODS_KEY = 'mods';
  var IMG_EXT = /\.(dds|png|jpg|jpeg)$/i;
  var DIR_SLOT = { north: 'n', back: 'n', east: 'e', side: 'e', south: 's', front: 's', west: 'w' };
  var SKIP_TAIL = { m: 1, menuicon: 1, blueprint: 1 };
  var LINK_KIND = {
    cornerfiller: 'corner', basic: 'basic', transmitter: 'transmitter',
    transmitteroverlay: 'transmitter', asymmetric: 'basic'
  };
  var APPEARANCES = ['Planks', 'Bricks', 'Metal', 'Smooth'];
  var MAXPX = 512;
  // 官方 Core/DLC：它们应该从「导入游戏资源」走，不要当模组导进来
  var OFFICIAL = {
    'ludeon.rimworld': 1, 'ludeon.rimworld.royalty': 1, 'ludeon.rimworld.ideology': 1,
    'ludeon.rimworld.biotech': 1, 'ludeon.rimworld.anomaly': 1, 'ludeon.rimworld.odyssey': 1
  };

  // 内存里的当前状态：records = 已导入模组记录；base = 核心游戏数据快照
  var state = { records: null, base: null, gameVersion: '' };

  // ---------------------------------------------------------------- 小工具

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function safeName(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mod';
  }
  function stripExt(s) {
    return s.replace(/\.(psd|png|jpg|jpeg|tga)\.dds$/i, '').replace(/\.(dds|png|jpg|jpeg|tga|psd)$/i, '');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function cloneObj(o) {
    var r = {};
    if (o) for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) r[k] = o[k];
    return r;
  }
  function cloneEntry(e) {
    var r = {};
    if (e) for (var k in e) if (Object.prototype.hasOwnProperty.call(e, k)) r[k] = e[k];
    return r;
  }

  function readText(file) {
    if (!file) return Promise.resolve('');
    if (typeof file.text === 'function') return Promise.resolve(file.text());
    if (typeof file.text === 'string') return Promise.resolve(file.text);
    return Promise.resolve('');
  }
  function readBuf(file) {
    if (!file) return Promise.resolve(new ArrayBuffer(0));
    if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
    return Promise.resolve(new ArrayBuffer(0));
  }

  /** 取一个 XML 里某个标签的文本（About.xml / LoadFolders.xml 够用了） */
  function xmlText(xml, tag) {
    var re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
    var m = re.exec(xml || '');
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim();
  }
  /** 取某个标签里所有 <li> 的文本 */
  function xmlList(xml, tag) {
    var re = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i');
    var m = re.exec(xml || '');
    if (!m) return [];
    var out = [], liRe = /<li\b[^>]*>([\s\S]*?)<\/li>/g, lm;
    while ((lm = liRe.exec(m[1]))) {
      var v = lm[1].replace(/<[^>]+>/g, '').trim();
      if (v) out.push(v);
    }
    return out;
  }
  function cmpVer(a, b) {
    var x = String(a || '0').split('.').map(Number), y = String(b || '0').split('.').map(Number);
    return ((x[0] || 0) - (y[0] || 0)) || ((x[1] || 0) - (y[1] || 0));
  }

  // ---------------------------------------------------------------- 文件分组：认出模组

  function relOf(p, root) {
    var s = String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (!root) return s;
    var r = String(root).replace(/\\/g, '/');
    if (s.indexOf(r + '/') === 0) return s.slice(r.length + 1);
    return s;
  }

  /**
   * 从一个文件集合里认出模组：路径里出现 About/About.xml 的那一级就是模组根。
   * 支持一次拖入整个 Mods/（里面多个模组），也支持单个模组文件夹。
   *
   * 分两趟：先靠 About.xml 找出所有模组根，再把每个文件归到最长的那个根下面
   * （这样 Mods/A 和嵌套在里面的 Mods/A/B 不会串）。
   */
  function groupMods(files) {
    var groups = {}, order = [], list = [];
    (files || []).forEach(function (f) {
      if (!f || !f.path) return;
      list.push({ f: f, p: String(f.path).replace(/\\/g, '/').replace(/^\/+/, '') });
    });
    // 第一趟：找模组根
    list.forEach(function (it) {
      var segs = it.p.split('/');
      var idx = -1;
      for (var i = 0; i < segs.length - 1; i++) {
        if (segs[i].toLowerCase() === 'about' && segs[i + 1].toLowerCase() === 'about.xml') { idx = i; break; }
      }
      if (idx < 0) return;
      var root = segs.slice(0, idx).join('/');
      var key = root.toLowerCase();
      if (!groups[key]) {
        groups[key] = { root: root, files: [], aboutFile: it.f.file, aboutPath: it.p };
        order.push(key);
      }
    });
    // 第二趟：把文件归到最长的模组根（嵌套模组时更具体的那层优先）
    var roots = order.map(function (k) { return { key: k, root: groups[k].root }; })
      .sort(function (a, b) { return b.root.length - a.root.length; });
    list.forEach(function (it) {
      for (var i = 0; i < roots.length; i++) {
        var r = roots[i];
        if (it.p === r.root + '/About/About.xml' || it.p.indexOf(r.root + '/') === 0) {
          groups[r.key].files.push(it.f);
          return;
        }
      }
    });
    return order.map(function (k) { return groups[k]; });
  }

  /** 从 About/About.xml（+ PublishedFileId.txt）读出模组元信息 */
  async function readAbout(group) {
    var xml = await readText(group.aboutFile);
    var meta = {
      packageId: xmlText(xml, 'packageId'),
      name: xmlText(xml, 'name') || xmlText(xml, 'packageId'),
      author: xmlText(xml, 'author'),
      version: xmlText(xml, 'modVersion'),
      supported: xmlList(xml, 'supportedVersions'),
      steamId: ''
    };
    // 创意工坊 id：优先 PublishedFileId.txt，其次 About.xml 里的链接
    for (var i = 0; i < group.files.length; i++) {
      var rel = relOf(group.files[i].path, group.root).toLowerCase();
      if (rel === 'about/publishedfileid.txt') {
        var txt = (await readText(group.files[i].file)).replace(/\s+/g, '').trim();
        if (/^\d+$/.test(txt)) { meta.steamId = txt; break; }
      }
    }
    if (!meta.steamId) {
      var m = /steam:\/\/url\/CommunityFilePage\/(\d+)/.exec(xml) ||
              /<publishedFileId>\s*(\d+)\s*<\/publishedFileId>/i.exec(xml) ||
              /communityFilePage\/(\d+)/i.exec(xml);
      if (m) meta.steamId = m[1];
    }
    // 创意工坊 mod 的文件夹名就是发布 ID（steamapps/workshop/content/294100/<id>/），
    // 有些老 mod 没带 PublishedFileId.txt，用文件夹名兜底
    if (!meta.steamId) {
      var segs = String(group.root || '').split('/');
      var last = segs[segs.length - 1] || '';
      if (/^\d+$/.test(last)) meta.steamId = last;
    }
    if (!meta.packageId) meta.packageId = 'unknown.' + safeName(meta.name);
    return meta;
  }

  // ---------------------------------------------------------------- 版本目录 / LoadFolders

  /** 模组根下直接出现的版本目录（1.0 / 1.6 / 1.7 …） */
  function versionDirsOf(group) {
    var set = {};
    group.files.forEach(function (f) {
      var rel = relOf(f.path, group.root);
      var seg = rel.split('/')[0];
      if (/^\d+\.\d+$/.test(seg)) set[seg] = 1;
    });
    return Object.keys(set).sort(cmpVer);
  }

  /**
   * 解析 LoadFolders.xml，挑出当前游戏版本要加载的文件夹。
   * 返回 null 表示没写 LoadFolders.xml（调用方走版本目录回退）。
   */
  function pickLoadFolders(xml, gameVersion) {
    if (!xml) return null;
    var body = /<loadFolders\b[^>]*>([\s\S]*)<\/loadFolders>/i.exec(xml);
    if (!body) return null;
    var blocks = [], blockRe = /<([A-Za-z0-9_.\-]+)>([\s\S]*?)<\/\1>/g, m;
    while ((m = blockRe.exec(body[1]))) {
      if (m[1].toLowerCase() === 'li') continue;
      var dirs = [], liRe = /<li\b([^>]*)>([\s\S]*?)<\/li>/g, lm;
      while ((lm = liRe.exec(m[2]))) {
        // 条件文件夹（IfModActive…）先跳过：我们无法精确还原玩家的模组加载顺序
        if (/IfMod(Active|NotActive)/i.test(lm[1] || '')) continue;
        var v = lm[2].replace(/<[^>]+>/g, '').trim();
        if (v) dirs.push(v.replace(/\\/g, '/').replace(/^\/+|\/+$/g, ''));
      }
      blocks.push({ key: m[1].toLowerCase(), dirs: dirs });
    }
    if (!blocks.length) return null;
    var chosen = null, i;
    if (gameVersion) {
      var want = 'v' + gameVersion;
      for (i = 0; i < blocks.length; i++) if (blocks[i].key === want) { chosen = blocks[i]; break; }
    }
    if (!chosen && gameVersion) {
      for (i = 0; i < blocks.length; i++) {
        var vm = /^v(\d+\.\d+)$/.exec(blocks[i].key);
        if (!vm || cmpVer(vm[1], gameVersion) > 0) continue;
        if (!chosen || cmpVer(vm[1], chosen.key.slice(1)) > 0) chosen = blocks[i];
      }
    }
    if (!chosen) for (i = 0; i < blocks.length; i++) if (blocks[i].key === 'default') { chosen = blocks[i]; break; }
    if (!chosen) chosen = blocks[blocks.length - 1];
    return chosen.dirs;
  }

  /** 这个模组对当前游戏版本生效的加载文件夹（'' 表示模组根） */
  async function effectiveFolders(group, gameVersion) {
    for (var i = 0; i < group.files.length; i++) {
      var rel = relOf(group.files[i].path, group.root).toLowerCase();
      if (rel === 'loadfolders.xml') {
        var dirs = pickLoadFolders(await readText(group.files[i].file), gameVersion);
        if (dirs && dirs.length) return dirs;
        break;
      }
    }
    // 没写 LoadFolders.xml：根 + 「不高于当前游戏版本的最高版本目录」
    var vers = versionDirsOf(group);
    var folders = [''];
    if (vers.length) {
      var pick = null;
      for (var v = 0; v < vers.length; v++) {
        if (!gameVersion || cmpVer(vers[v], gameVersion) <= 0) pick = vers[v];
      }
      if (!pick) pick = vers[0];
      folders.push(pick);
    }
    return folders;
  }

  /** 按生效文件夹分类文件：Defs XML / 简中语言包 / Textures 散装贴图 */
  function classifyFiles(group, folders) {
    var out = { defDocs: [], langDocs: [], textures: [] };
    var seen = {};
    folders = folders.filter(function (v, i, a) { return a.indexOf(v) === i; });
    group.files.forEach(function (f) {
      var rel = relOf(f.path, group.root);
      var lower = rel.toLowerCase();
      for (var i = 0; i < folders.length; i++) {
        var pre = folders[i] ? folders[i].toLowerCase() + '/' : '';
        if (lower.indexOf(pre + 'defs/') === 0 && /\.xml$/i.test(rel)) {
          if (!seen['d:' + rel]) { seen['d:' + rel] = 1; out.defDocs.push({ rel: rel, file: f.file }); }
          return;
        }
        if (lower.indexOf(pre + 'languages/chinesesimplified/definjected/') === 0 && /\.xml$/i.test(rel)) {
          if (!seen['l:' + rel]) { seen['l:' + rel] = 1; out.langDocs.push({ rel: rel, file: f.file }); }
          return;
        }
        if (lower.indexOf(pre + 'textures/') === 0 && IMG_EXT.test(rel)) {
          var texRel = rel.slice(pre.length + 'textures/'.length);
          if (!seen['t:' + texRel]) { seen['t:' + texRel] = 1; out.textures.push({ rel: texRel, file: f.file }); }
          return;
        }
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- 声明了哪些 def

  /** 扫这个模组自己的 Defs XML，记下它声明了哪些 defName（只看顶层 def 标签） */
  function scanDeclared(docs) {
    var out = { things: {}, terrains: {}, researches: {}, stuffCats: {} };
    (docs || []).forEach(function (d) {
      var xml = d.xml || '';
      var re = /<ThingDef\b[^>]*>([\s\S]*?)<\/ThingDef>/g, m;
      while ((m = re.exec(xml))) {
        var dn = xmlText(m[1], 'defName');
        if (dn) out.things[dn] = 1;
      }
      var tre = /<TerrainDef\b[^>]*>([\s\S]*?)<\/TerrainDef>/g;
      while ((m = tre.exec(xml))) {
        var tdn = xmlText(m[1], 'defName');
        if (tdn) out.terrains[tdn] = 1;
      }
      var rre = /<ResearchProjectDef\b[^>]*>([\s\S]*?)<\/ResearchProjectDef>/g;
      while ((m = rre.exec(xml))) {
        var rdn = xmlText(m[1], 'defName');
        if (rdn) out.researches[rdn] = 1;
      }
      var cre = /<StuffCategoryDef\b[^>]*>([\s\S]*?)<\/StuffCategoryDef>/g;
      while ((m = cre.exec(xml))) {
        var cdn = xmlText(m[1], 'defName');
        if (cdn) out.stuffCats[cdn] = 1;
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- 贴图索引 / 解码（和 gameimport 同款规则）

  function buildTexIndex(list) {
    var arr = list.slice().sort(function (a, b) { return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0; });
    return {
      all: arr,
      find: function (prefix) {
        var p = String(prefix || '').replace(/\\/g, '/').replace(/^\/+/, '');
        var out = [];
        for (var i = 0; i < arr.length; i++) {
          var r = arr[i].rel;
          if (r.indexOf(p) !== 0) continue;
          if (r.length > p.length && '._/'.indexOf(r[p.length]) < 0) continue;
          out.push(arr[i]);
        }
        return out;
      }
    };
  }

  function classify(files, base) {
    var lastseg = base.split('/').pop();
    var out = { variants: [] };
    files.forEach(function (f) {
      var stem = stripExt(f.rel);
      var tail;
      if (stem.indexOf(base + '/') === 0) {
        var rest = stem.slice(base.length + 1);
        tail = rest.indexOf(lastseg) === 0 ? rest.slice(lastseg.length) : rest;
      } else if (stem.indexOf(base) === 0) {
        tail = stem.slice(base.length);
      } else return;
      var t = tail.replace(/^_+/, '').toLowerCase();
      if (!t) { if (!out.plain) out.plain = f; return; }
      if (DIR_SLOT[t]) { if (!out[DIR_SLOT[t]]) out[DIR_SLOT[t]] = f; return; }
      if (SKIP_TAIL[t]) return;
      out.variants.push(f);
    });
    return out;
  }

  function isGrayscale(rgba, w, h) {
    var step = Math.max(1, Math.floor((w * h) / 2000));
    var sat = 0, n = 0;
    for (var i = 0; i < w * h; i += step) {
      var o = i * 4;
      if (rgba[o + 3] < 32) continue;
      var r = rgba[o], g = rgba[o + 1], b = rgba[o + 2];
      var mx = Math.max(r, g, b);
      if (!mx) continue;
      sat += (mx - Math.min(r, g, b)) / mx;
      n++;
    }
    return n ? (sat / n) < 0.15 : false;
  }

  function alphaBox(rgba, w, h) {
    var minx = w, miny = h, maxx = -1, maxy = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (rgba[(y * w + x) * 4 + 3] > 24) {
          if (x < minx) minx = x; if (x > maxx) maxx = x;
          if (y < miny) miny = y; if (y > maxy) maxy = y;
        }
      }
    }
    if (maxx < 0) return null;
    var nx = minx / w, ny = miny / h, nw = (maxx - minx + 1) / w, nh = (maxy - miny + 1) / h;
    if (nx < 0.005 && ny < 0.005 && nw > 0.99 && nh > 0.99) return null;
    return [Math.round(nx * 1e4) / 1e4, Math.round(ny * 1e4) / 1e4,
            Math.round(nw * 1e4) / 1e4, Math.round(nh * 1e4) / 1e4];
  }

  function parseVec(raw) {
    if (!raw) return [1, 1];
    var n = (String(raw).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (!n.length) return [1, 1];
    if (n.length === 1) return [Math.round(n[0] * 1e4) / 1e4, Math.round(n[0] * 1e4) / 1e4];
    return [Math.round(n[0] * 1e4) / 1e4, Math.round(n[1] * 1e4) / 1e4];
  }
  function parseVec3(raw) {
    if (!raw) return null;
    var n = (String(raw).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (n.length >= 3) return [n[0], n[2]];
    if (n.length === 2) return [n[0], n[1]];
    return null;
  }
  function offsetsOf(g) {
    var out = {}, any = false;
    [['n', 'drawOffsetNorth'], ['e', 'drawOffsetEast'], ['s', 'drawOffsetSouth'], ['w', 'drawOffsetWest']].forEach(function (p) {
      var v = parseVec3(g[p[1]]);
      if (v && (Math.abs(v[0]) > 1e-6 || Math.abs(v[1]) > 1e-6)) {
        out[p[0]] = [Math.round(v[0] * 1e4) / 1e4, Math.round(v[1] * 1e4) / 1e4];
        any = true;
      }
    });
    var gv = parseVec3(g.drawOffset);
    if (gv && (Math.abs(gv[0]) > 1e-6 || Math.abs(gv[1]) > 1e-6)) { out.g = gv; any = true; }
    return any ? out : null;
  }
  function colorOf(raw) {
    var n = (String(raw).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (n.length < 3) return null;
    if (Math.max(n[0], n[1], n[2]) <= 1) n = n.map(function (v) { return v * 255; });
    function h(v) { v = Math.max(0, Math.min(255, Math.round(v))); return (v < 16 ? '0' : '') + v.toString(16); }
    return '#' + h(n[0]) + h(n[1]) + h(n[2]);
  }

  /** 一张散装贴图 → {rgba,width,height}；dds 用 RWZip 解，png/jpg 交给浏览器 */
  async function imageOf(texEntry) {
    var rel = String(texEntry.rel || '').toLowerCase();
    if (/\.dds$/.test(rel)) {
      if (!global.RWZip || !global.RWZip.decodeDds) throw new Error('缺少 DDS 解码器');
      var dec = global.RWZip.decodeDds(new Uint8Array(await readBuf(texEntry.file)));
      return { rgba: dec.rgba, width: dec.width, height: dec.height };
    }
    if (typeof global.createImageBitmap !== 'function') throw new Error('环境不支持 PNG 解码');
    var bytes = new Uint8Array(await readBuf(texEntry.file));
    var blob = new global.Blob([bytes], { type: /\.jpe?g$/i.test(rel) ? 'image/jpeg' : 'image/png' });
    var bmp = await global.createImageBitmap(blob);
    var c = global.document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    var cx = c.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    var d = cx.getImageData(0, 0, c.width, c.height);
    return { rgba: d.data, width: c.width, height: c.height };
  }

  /** 解码 → 必要时降到 512px → 存 IndexedDB；返回 alphaBox / 实际写盘的名字 */
  async function saveSprite(name, img) {
    var rgba = img.rgba, w = img.width, h = img.height;
    if (Math.max(w, h) > MAXPX) {
      var r = MAXPX / Math.max(w, h);
      var nw = Math.max(1, Math.round(w * r)), nh = Math.max(1, Math.round(h * r));
      var big = global.document.createElement('canvas');
      big.width = w; big.height = h;
      big.getContext('2d').putImageData(new global.ImageData(rgba, w, h), 0, 0);
      var small = global.document.createElement('canvas');
      small.width = nw; small.height = nh;
      var sc = small.getContext('2d');
      sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high';
      sc.drawImage(big, 0, 0, nw, nh);
      rgba = sc.getImageData(0, 0, nw, nh).data;
      w = nw; h = nh;
    }
    var canvas = global.document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    var cx = canvas.getContext('2d');
    cx.putImageData(new global.ImageData(rgba, w, h), 0, 0);
    var blob = await new Promise(function (res, rej) {
      canvas.toBlob(function (b) { if (b) res(b); else rej(new Error('PNG 编码失败')); }, 'image/png');
    });
    await global.RWGame.putTexture(name, blob);
    return { box: alphaBox(rgba, w, h), size: blob.size || 0 };
  }

  function spriteNamesOf(entry) {
    var out = [];
    if (!entry) return out;
    if (entry.imgs) for (var k in entry.imgs) out.push(entry.imgs[k]);
    if (entry.sheets) for (var s in entry.sheets) out.push(entry.sheets[s]);
    if (entry.ov && entry.ov.imgs) for (var o in entry.ov.imgs) out.push(entry.ov.imgs[o]);
    return out;
  }

  /**
   * 给一个模组的建筑解贴图。摸不到图 / 环境不支持就跳过，让图标回退到矢量画法。
   * 返回 {items:{defName:entry}, names:[文件名], boxes:{文件名:box}, sprites:n}
   */
  async function packModSprites(parsed, mod) {
    var res = { items: {}, names: [], boxes: {}, sprites: 0 };
    if (!mod.textures || !mod.textures.length) return res;
    var tex = buildTexIndex(mod.textures);
    var tag = 'mod_' + safeName(mod.packageId) + '__';

    async function add(name, texEntry) {
      var img = await imageOf(texEntry);
      var saved = await saveSprite(name, img);
      res.names.push(name);
      if (saved.box) res.boxes[name] = saved.box;
      res.sprites++;
      return img;
    }

    for (var i = 0; i < mod.buildings.length; i++) {
      if (mod.cancelled) return res;
      var def = mod.buildings[i];
      var dn = def.def;
      var g;
      try { g = global.RWGame._findGraphic(parsed, dn); } catch (e) { g = null; }
      if (!g || !g.texPath) continue;
      var files = tex.find(g.texPath);
      if (!files.length) continue;
      var got = classify(files, g.texPath);
      var gc = (g.graphicClass || '').split('.').pop();
      var link = LINK_KIND[norm(g.linkType)];
      var ds = parseVec(g.drawSize);
      var offs = offsetsOf(g);
      var stuffable = !!(def.stuffCats && def.stuffCats.length);
      var fixed = g.color ? colorOf(g.color) : null;
      var tint = fixed || (stuffable ? 'stuff' : null);
      var entry = { ds: ds };
      if (offs) entry.off = offs;
      try {
        if (link) {
          var sheets = {}, grayAny = false;
          if (gc === 'Graphic_Appearances') {
            var baseName = g.texPath.split('/').pop();
            for (var a = 0; a < APPEARANCES.length; a++) {
              var app = APPEARANCES[a];
              var hit = tex.find(g.texPath + '/' + baseName + '_Atlas_' + app);
              if (!hit.length) continue;
              var d1 = await add(tag + dn + '__' + app + '.png', hit[0]);
              sheets[app] = tag + dn + '__' + app + '.png';
              if (isGrayscale(d1.rgba, d1.width, d1.height)) grayAny = true;
            }
            if (!Object.keys(sheets).length) continue;
            if (!grayAny) tint = null;
          } else {
            var atlasName = tag + dn + '__atlas.png';
            var d2 = await add(atlasName, got.plain || files[0]);
            sheets['default'] = atlasName;
            if (!isGrayscale(d2.rgba, d2.width, d2.height)) tint = null;
          }
          entry.kind = 'linked';
          entry.link = link;
          entry.sheets = sheets;
          if (g.linkFlags && g.linkFlags.length) entry.lf = g.linkFlags;
        } else if (gc === 'Graphic_Multi') {
          var imgs = {}, first = null, slots = ['n', 'e', 's', 'w'];
          for (var s = 0; s < slots.length; s++) {
            var f = got[slots[s]];
            if (!f) continue;
            var nmM = tag + dn + '__' + slots[s] + '.png';
            var d3 = await add(nmM, f);
            imgs[slots[s]] = nmM;
            first = first || d3;
          }
          if (!first) {
            var nmM1 = tag + dn + '__n.png';
            first = await add(nmM1, got.plain || got.variants[0] || files[0]);
            imgs.n = nmM1;
          }
          if (tint && first && !isGrayscale(first.rgba, first.width, first.height)) tint = null;
          entry.kind = 'multi';
          entry.imgs = imgs;
        } else {
          var pick = (gc === 'Graphic_Random' && got.variants.length)
            ? got.variants.slice().sort(function (x, y) { return x.rel < y.rel ? -1 : 1; })[0]
            : (got.plain || got.variants[0] || files[0]);
          if (!pick) continue;
          var nmS = tag + dn + '__n.png';
          var d5 = await add(nmS, pick);
          if (tint && !isGrayscale(d5.rgba, d5.width, d5.height)) tint = null;
          entry.kind = 'single';
          entry.imgs = { n: nmS };
        }
        if (tint) entry.tint = tint;
        if ((g.thingClass || '').indexOf('Building_Door') >= 0) entry.mir = 1;
        if (g.turretGunDef) {
          var gg = global.RWGame._findGraphic(parsed, g.turretGunDef);
          if (gg && gg.texPath) {
            var gf = tex.find(gg.texPath);
            if (gf.length) {
              var topName = tag + dn + '__top.png';
              await add(topName, gf[0]);
              entry.ov = { ds: parseVec(gg.drawSize), imgs: { n: topName } };
            }
          }
        }
      } catch (e) {
        // 单张贴图失败不影响整个模组：回退矢量图标
        continue;
      }
      res.items[dn] = entry;
    }
    return res;
  }

  // ---------------------------------------------------------------- 数据合并 / 回滚

  function cloneManifest(m) {
    if (!m) return null;
    return {
      base: m.base || null,
      atlas: m.atlas || { cols: 4, rows: 4, inset: 0.03125 },
      stuff: cloneObj(m.stuff),
      byName: cloneObj(m.byName),
      boxes: cloneObj(m.boxes),
      items: cloneObj(m.items),
      floors: cloneObj(m.floors)
    };
  }

  function emptyManifest() {
    return { base: null, atlas: { cols: 4, rows: 4, inset: 0.03125 }, stuff: {}, byName: {}, boxes: {}, items: {}, floors: {} };
  }

  /** 把「核心快照 + 若干模组记录」重新合进 RWData，返回合并后的贴图清单 */
  function applyRecords(records, base) {
    var D = global.RWData;
    records = records || [];

    // ---- 建筑：先回滚到核心，再按记录顺序合并（后导入的覆盖先导入的）----
    if (base && base.buildings) {
      D.restoreBaseBuildings(base.buildings);
      // 用户可能还没走过「导入游戏资源」的初始化合并（例如只导了模组）：
      // 把核心建筑补进来，保证核心数据不会因为导模组而变少。
      D.mergeBuildings(base.buildings);
    } else {
      var B = D.BUILDINGS;
      for (var i = B.length - 1; i >= 0; i--) {
        if (B[i] && B[i].mod) {
          if (D.byId[B[i].id] === B[i]) delete D.byId[B[i].id];
          B.splice(i, 1);
        }
      }
      D.reindexBuildings();
    }
    records.forEach(function (r) { if (r.buildings && r.buildings.length) D.mergeBuildings(r.buildings); });

    // ---- 材质 / 材质分类：核心打底，模组按 id 去重追加 ----
    var baseStuffs = (base && base.stuffs) ? base.stuffs : (D.STUFFS || []).filter(function (s) { return !s.mod; });
    var seenS = {}, stuffs = [];
    baseStuffs.forEach(function (s) { if (s && s.id && !seenS[s.id]) { stuffs.push(s); seenS[s.id] = 1; } });
    records.forEach(function (r) {
      (r.stuffs || []).forEach(function (s) {
        if (!s || !s.id || seenS[s.id]) return;
        var c = cloneEntry(s); c.mod = r.packageId;
        stuffs.push(c); seenS[s.id] = 1;
      });
    });
    D.STUFFS = stuffs;

    var baseCats = (base && base.stuffCats) ? base.stuffCats : (D.STUFF_CATS || []).filter(function (c) { return !c.mod; });
    var seenC = {}, cats = [];
    baseCats.forEach(function (c) { if (c && c.id && !seenC[c.id]) { cats.push(c); seenC[c.id] = 1; } });
    records.forEach(function (r) {
      (r.stuffCats || []).forEach(function (c) {
        if (!c || !c.id || seenC[c.id]) return;
        var cc = cloneEntry(c); cc.mod = r.packageId;
        cats.push(cc); seenC[c.id] = 1;
      });
    });
    D.STUFF_CATS = cats;

    // ---- 科技 / 物品名（只增不减；删模组后残留也无害）----
    records.forEach(function (r) {
      if (r.researches && r.researches.length) D.mergeResearches(r.researches);
      if (r.items) D.mergeItemNames(r.items);
    });

    // ---- 贴图清单 ----
    var baseManifest = (base && base.manifest) || global.RWSprites || null;
    if (!records.length) return baseManifest ? cloneManifest(baseManifest) : null;
    var m = baseManifest ? cloneManifest(baseManifest) : emptyManifest();
    records.forEach(function (r) {
      var sp = r.sprites || {};
      Object.keys(sp).forEach(function (dn) {
        m.items[dn] = sp[dn];
        m.byName[norm(dn)] = dn;
      });
      var bx = r.boxes || {};
      Object.keys(bx).forEach(function (k) { m.boxes[k] = bx[k]; });
    });
    return m;
  }

  async function loadBase() {
    var G = global.RWGame;
    var base = { buildings: null, stuffs: null, stuffCats: null, manifest: null, gameVersion: '' };
    if (!G) return base;
    try {
      base.buildings = await G.getMeta('buildings');
      base.stuffs = await G.getMeta('stuffs');
      base.stuffCats = await G.getMeta('stuffCats');
      base.manifest = await G.getMeta('manifest');
      base.gameVersion = (await G.getMeta('gameVersion')) || '';
    } catch (e) { /* 没有游戏数据也能只导模组 */ }
    return base;
  }

  async function loadRecords() {
    if (state.records) return state.records;
    try { state.records = (await global.RWGame.getMeta(MODS_KEY)) || []; }
    catch (e) { state.records = []; }
    return state.records;
  }

  function setRecords(records) {
    state.records = records || [];
    return global.RWGame.setMeta(MODS_KEY, state.records);
  }

  // ---------------------------------------------------------------- 解析

  /**
   * 把核心 Defs + 已存模组 Defs + 本次新模组 Defs 一起解析。
   * （ParentName 可能跨模组/跨原版，必须同一批喂给 RWDefs.parse）
   */
  function parseTogether(baseRecords, newMods, core) {
    var docs = [], lang = {};
    if (core && core.docs && core.docs.length) docs = docs.concat(core.docs);
    (baseRecords || []).forEach(function (r) {
      if (r.defDocs) docs = docs.concat(r.defDocs);
      if (r.lang) for (var k in r.lang) lang[k] = r.lang[k];
    });
    newMods.forEach(function (m) {
      if (m.defDocs) docs = docs.concat(m.defDocs);
      if (m.lang) for (var k2 in m.lang) lang[k2] = m.lang[k2];
    });
    return global.RWDefs.parse(docs, lang);
  }

  function extractForMod(parsed, mod) {
    var dec = mod.declared;
    var buildings = [];
    var seen = {};
    parsed.buildings.forEach(function (b) {
      if (!b || !b.def || !dec.things[b.def] || seen[b.def]) return;
      seen[b.def] = 1;
      var c = cloneEntry(b);
      c.mod = mod.packageId;
      c.modName = mod.name;
      buildings.push(c);
    });
    var stuffs = [];
    parsed.stuffs.forEach(function (s) {
      if (!s || !s.def || !dec.things[s.def]) return;
      var c = cloneEntry(s);
      c.mod = mod.packageId;
      stuffs.push(c);
    });
    var cats = [];
    parsed.stuffCats.forEach(function (c) {
      if (!c || !c.id || !dec.stuffCats[c.id]) return;
      var cc = cloneEntry(c);
      cc.mod = mod.packageId;
      cats.push(cc);
    });
    var researches = [];
    parsed.researches.forEach(function (r) {
      if (!r || !r.def || !dec.researches[r.def]) return;
      var c = cloneEntry(r);
      c.mod = mod.packageId;
      researches.push(c);
    });
    var items = {};
    if (parsed.items) Object.keys(parsed.items).forEach(function (dn) {
      if (dec.things[dn]) items[dn] = parsed.items[dn];
    });
    return { buildings: buildings, stuffs: stuffs, stuffCats: cats, researches: researches, items: items };
  }

  // ---------------------------------------------------------------- 公开操作

  function tickOf(onProgress) {
    return function (text, frac) { if (onProgress) onProgress(text, frac); };
  }

  /**
   * 导入一批文件（来自 RWGame.collectFromDrop / collectFromInput 的 [{path,file}]）。
   * @param {Array} files
   * @param {Function} [onProgress] (text, frac)
   * @param {Object} [opts] {skipTextures:true} —— Node 命令行/单测里跳过贴图解码
   */
  async function importFiles(files, onProgress, opts) {
    opts = opts || {};
    var tick = tickOf(onProgress);

    tick('正在识别模组…', 0.02);
    var groups = groupMods(files);
    var errors = [], added = [], warnings = [];
    if (!groups.length) {
      throw new Error('没找到模组：拖入的文件夹里没有 About/About.xml。' +
        '本地模组在 RimWorld/Mods/；Steam 创意工坊订阅的 mod 在 steamapps/workshop/content/294100/，' +
        '把 294100 整个文件夹拖进来即可（面板里「创意工坊的 mod 在哪？」有各平台路径）。');
    }

    var base = await loadBase();
    var core = await global.RWGame.getCoreDefDocs();
    var records = (await loadRecords()).slice();
    var gameVersion = (core && core.version) || base.gameVersion || '';

    // ---- 读 About / 选生效文件夹 / 分类文件 ----
    var mods = [];
    for (var gi = 0; gi < groups.length; gi++) {
      var group = groups[gi];
      tick('正在读取模组信息 ' + (gi + 1) + '/' + groups.length + '…', 0.04 + 0.12 * gi / groups.length);
      var about;
      try { about = await readAbout(group); }
      catch (e) { errors.push({ name: group.root || '?', message: 'About.xml 读取失败：' + (e.message || e) }); continue; }
      if (OFFICIAL[String(about.packageId).toLowerCase()] || /^ludeon\./i.test(about.packageId)) {
        errors.push({ name: about.name || group.root, message: '这是官方 Core/DLC，请用「导入游戏资源」导入游戏目录，不要当模组导入' });
        continue;
      }
      var folders = await effectiveFolders(group, gameVersion);
      var cls = classifyFiles(group, folders);
      var defDocs = [];
      for (var di = 0; di < cls.defDocs.length; di++) {
        var rel = cls.defDocs[di].rel;
        defDocs.push({ path: (group.root ? group.root + '/' : '') + rel, xml: await readText(cls.defDocs[di].file) });
        if (di % 30 === 0) await sleep(0);
      }
      var lang = {};
      for (var li = 0; li < cls.langDocs.length; li++) {
        try {
          var ltxt = await readText(cls.langDocs[li].file);
          if (global.RWDefs.collectLangXml) global.RWDefs.collectLangXml(ltxt, lang);
        } catch (e) { /* 语言包坏了不影响 */ }
      }
      var declared = scanDeclared(defDocs);
      var mod = {
        packageId: about.packageId,
        name: about.name,
        author: about.author,
        version: about.version,
        supported: about.supported,
        steamId: about.steamId,
        at: Date.now(),
        gameVersion: gameVersion,
        folders: folders,
        defDocs: defDocs,
        lang: lang,
        declared: declared,
        textures: opts.skipTextures ? [] : cls.textures
      };
      if (!defDocs.length) {
        warnings.push({ name: about.name, message: '没有找到当前游戏版本生效的 Defs（' + (gameVersion || '未知版本') + '），已跳过' });
      }
      mods.push(mod);
    }
    if (!mods.length) return finalize([], base, errors, added, warnings, 0, 0);

    // ---- 一起解析（核心 + 旧模组 + 新模组）----
    var newPkgs = {};
    mods.forEach(function (m) { newPkgs[m.packageId] = 1; });
    var keepRecords = records.filter(function (r) { return !newPkgs[r.packageId]; });
    tick('正在解析模组定义（' + (core && core.docs ? '核心 + ' : '') + mods.length + ' 个模组）…', 0.2);
    var parsed = parseTogether(keepRecords, mods, core);
    if (!core) warnings.push({ name: '', message: '没有找到已导入的游戏目录数据（如果之前导入过旧版缓存，请重新导入一次游戏目录）：模组里 ParentName 指向原版/其它 DLC 的继承可能解析不全。建议先「导入游戏资源」再导模组。' });

    // ---- 每个模组只挑自己声明的 def ----
    var got = {}, dupes = {};
    for (var mi = 0; mi < mods.length; mi++) {
      var m = mods[mi];
      var data = extractForMod(parsed, m);
      data.buildings.forEach(function (b) {
        if (got[b.def]) { dupes[b.def] = 1; return; }
        (m.buildings = m.buildings || []).push(b);
      });
      m.stuffs = [];
      m.stuffCats = [];
      m.researches = [];
      m.items = {};
      m.buildings = m.buildings || [];
      m.stuffs = data.stuffs;
      m.stuffCats = data.stuffCats;
      m.researches = data.researches;
      m.items = data.items;
      if (!m.buildings.length) {
        warnings.push({ name: m.name, message: '没有解析出可建造建筑（可能只加了物品/家具 def 不是 Building，或依赖原版补丁）' });
      }
      got = got;
      // 记录已占用的 defName，避免后面的模组重复加
      m.buildings.forEach(function (b) { got[b.def] = 1; });
    }
    if (Object.keys(dupes).length) {
      warnings.push({ name: '', message: '有 ' + Object.keys(dupes).length + ' 个 def 被多个模组同时声明，按导入顺序取了第一个：' + Object.keys(dupes).slice(0, 8).join(', ') });
    }

    // ---- 贴图 ----
    var sprites = 0, bytes = 0;
    if (!opts.skipTextures) {
      for (var pi = 0; pi < mods.length; pi++) {
        tick('正在解出模组贴图 ' + (pi + 1) + '/' + mods.length + '…', 0.5 + 0.45 * pi / mods.length);
        try {
          var packed = await packModSprites(parsed, mods[pi]);
          mods[pi].sprites = packed.items;
          mods[pi].spriteNames = packed.names;
          mods[pi].boxes = packed.boxes;
          sprites += packed.sprites;
          if (global.RWGame && global.RWGame._lastSpriteBytes) bytes += 0; // 预留
        } catch (e) {
          mods[pi].sprites = {};
          mods[pi].spriteNames = [];
          mods[pi].boxes = {};
          warnings.push({ name: mods[pi].name, message: '贴图解码失败（会回退矢量图标）：' + (e.message || e) });
        }
      }
    } else {
      mods.forEach(function (m) { m.sprites = {}; m.spriteNames = []; m.boxes = {}; });
    }

    // ---- 存记录 + 应用 ----
    var nextRecords = keepRecords.concat(mods);
    mods.forEach(function (m) {
      added.push({ packageId: m.packageId, name: m.name, count: m.buildings.length, sprites: (m.spriteNames || []).length });
    });
    await setRecords(nextRecords);
    state.base = base;
    state.gameVersion = gameVersion;
    var manifest = applyRecords(nextRecords, base);
    var buildings = 0;
    mods.forEach(function (m) { buildings += m.buildings.length; });
    tick('完成：' + buildings + ' 个模组建筑 · ' + sprites + ' 张贴图', 1);
    return finalize(nextRecords, base, errors, added, warnings, sprites, buildings, manifest);
  }

  function finalize(records, base, errors, added, warnings, sprites, buildings, manifest) {
    if (manifest === undefined) manifest = applyRecords(records, state.base || base);
    return {
      manifest: manifest,
      mods: list(),
      added: added,
      errors: errors,
      warnings: warnings,
      sprites: sprites,
      buildings: buildings,
      hasCore: !!(state.base && state.base.buildings)
    };
  }

  /** 启动时从 IndexedDB 恢复已导入的模组（在 RWGame.loadCache() 之后调用） */
  async function restore() {
    var records;
    try { records = (await global.RWGame.getMeta(MODS_KEY)) || []; }
    catch (e) { records = []; }
    state.records = records;
    var base = await loadBase();
    state.base = base;
    // 即使没有导入过模组，也把游戏版本记下来：导出蓝图时 meta.gameVersion 要用
    state.gameVersion = base.gameVersion || '';
    if (!records.length) return null;
    var manifest = applyRecords(records, base);
    return { manifest: manifest, mods: list() };
  }

  /** 游戏目录重新导入之后：用新的核心数据重新解析已存模组（贴图沿用之前解出的文件） */
  async function refresh() {
    var records = await loadRecords();
    if (!records.length) return null;
    var base = await loadBase();
    var core = await global.RWGame.getCoreDefDocs();
    var parsed;
    try { parsed = parseTogether([], records, core); }
    catch (e) { return { manifest: applyRecords(records, base), mods: list() }; }
    var next = [];
    records.forEach(function (r) {
      var m = {
        packageId: r.packageId, name: r.name, author: r.author, version: r.version,
        supported: r.supported, steamId: r.steamId, at: r.at, gameVersion: base.gameVersion || r.gameVersion,
        folders: r.folders, defDocs: r.defDocs, lang: r.lang, declared: r.declared,
        sprites: r.sprites || {}, spriteNames: r.spriteNames || [], boxes: r.boxes || {}
      };
      try {
        var data = extractForMod(parsed, m);
        m.buildings = data.buildings;
        m.stuffs = data.stuffs;
        m.stuffCats = data.stuffCats;
        m.researches = data.researches;
        m.items = data.items;
      } catch (e) {
        m.buildings = r.buildings || [];
        m.stuffs = r.stuffs || [];
        m.stuffCats = r.stuffCats || [];
        m.researches = r.researches || [];
        m.items = r.items || {};
      }
      // 贴图按 defName 复用；新出现的 def 暂时用矢量图标
      next.push(m);
    });
    await setRecords(next);
    state.base = base;
    state.gameVersion = base.gameVersion || '';
    var manifest = applyRecords(next, base);
    return { manifest: manifest, mods: list() };
  }

  /** 删除一个模组：清掉它的贴图、记录，然后把数据回滚到「核心 + 剩余模组」 */
  async function remove(packageId) {
    var records = await loadRecords();
    var keep = [], del = [];
    records.forEach(function (r) {
      if (r.packageId === packageId) del.push(r); else keep.push(r);
    });
    if (!del.length) return { manifest: applyRecords(keep, state.base || await loadBase()), mods: list() };
    var names = [];
    del.forEach(function (r) { names = names.concat(r.spriteNames || []); });
    try { await global.RWGame.delTextures(names); } catch (e) { /* 清贴图失败不影响数据回滚 */ }
    await setRecords(keep);
    var base = state.base || await loadBase();
    state.base = base;
    var manifest = applyRecords(keep, base);
    return { manifest: manifest, mods: list() };
  }

  /** 清空所有模组 */
  async function removeAll() {
    var records = await loadRecords();
    var names = [];
    records.forEach(function (r) { names = names.concat(r.spriteNames || []); });
    try { await global.RWGame.delTextures(names); } catch (e) { /* 同上 */ }
    await setRecords([]);
    var base = await loadBase();
    state.base = base;
    var manifest = applyRecords([], base);
    return { manifest: manifest, mods: [] };
  }

  /** 清空内存状态（「清除游戏缓存」之后调用；IndexedDB 已经被 RWGame.clearCache 清掉） */
  function reset() {
    state.records = null;
    state.base = null;
    state.gameVersion = '';
  }

  /**
   * 给导出蓝图用的模组元信息（meta.modIds / modSteamIds / modNames）。
   *
   * 传了 entries（toBlueprintsXML 里的 BuildableThings）时，只把「真正提供了
   * 蓝图里某个 def 的模组」写进去：Blueprints 只拿 meta 做 mod 差异提示，
   * 多写无关模组会让玩家看到假的「缺少 mod」。
   * 不传时退回「所有已扫描模组」，给预览/调试用。
   */
  function exportMeta(entries) {
    var ids = ['brrainz.harmony', 'ludeon.rimworld', 'nova.blueprints.waylith17'];
    var steam = ['0', '0', '0'];
    var names = ['Harmony', 'Core', 'Blueprints - 1.7 Waylith (Unofficial)'];
    var records = state.records || [];
    var want = null;
    if (entries && entries.length) {
      var usedDefs = {};
      entries.forEach(function (e) {
        if (!e) return;
        if (e.defName) usedDefs[e.defName] = 1;
        if (e.terrain) usedDefs[e.terrain] = 1;
        if (e.stuff) usedDefs[e.stuff] = 1;   // 核心建筑用了模组材质时，这个模组也得写进 meta
      });
      want = {};
      records.forEach(function (r) {
        (r.buildings || []).forEach(function (b) { if (b && b.def && usedDefs[b.def]) want[r.packageId] = r; });
        (r.stuffs || []).forEach(function (s) { if (s && s.def && usedDefs[s.def]) want[r.packageId] = r; });
      });
    } else {
      want = {};
      records.forEach(function (r) { if (r && r.packageId) want[r.packageId] = r; });
    }
    records.forEach(function (r) {
      if (!r || !r.packageId || !want[r.packageId]) return;
      var id = String(r.packageId).toLowerCase();
      if (ids.indexOf(id) >= 0) {
        var at = ids.indexOf(id);
        if (r.steamId && steam[at] === '0') steam[at] = String(r.steamId);
        if (r.name && !names[at]) names[at] = r.name;
        return;
      }
      ids.push(id);
      steam.push(String(r.steamId || '0'));
      names.push(r.name || r.packageId);
    });
    return { modIds: ids, modSteamIds: steam, modNames: names, gameVersion: state.gameVersion || '' };
  }

  function list() {
    return (state.records || []).map(function (r) {
      return {
        packageId: r.packageId,
        name: r.name || r.packageId,
        count: (r.buildings || []).length,
        sprites: (r.spriteNames || []).length,
        version: r.version || '',
        steamId: r.steamId || '',
        at: r.at || 0
      };
    });
  }

  global.RWMods = {
    importFiles: importFiles,
    restore: restore,
    refresh: refresh,
    remove: remove,
    removeAll: removeAll,
    reset: reset,
    list: list,
    exportMeta: exportMeta,
    // 给命令行工具 / 单测用
    _groupMods: groupMods,
    _pickLoadFolders: pickLoadFolders,
    _classifyFiles: classifyFiles,
    _applyRecords: applyRecords,
    _state: function () { return state; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
