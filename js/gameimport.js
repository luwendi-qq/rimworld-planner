/*
 * gameimport.js —— 「拖入游戏目录，自动导入数据和贴图」
 *
 * 全流程都在浏览器里跑，玩家不需要装任何东西：
 *   1. 拖入（或选择）RimWorld 安装目录 / Data 目录 / 若干 Assets.zip
 *   2. 遍历目录：读 Data 下的 Defs XML、Languages 里的语言包、以及所有 Assets.zip
 *   3. RWDefs 现场解析出精确建筑数据 + 材质表 + 地形表 → 合并进数据库
 *   4. 按 def 的 graphicData 从 Assets.zip 里取贴图，RWZip 解码（BC7/BC4/zstd）
 *   5. 结果存 IndexedDB，下次打开直接秒用
 *
 * 这是 tools/extract_defs.py + tools/extract_textures.py 的浏览器版；
 * 两个 Python 脚本仍然保留，给高级用户和其它平台用。
 */
(function (global) {
  'use strict';

  var DB_NAME = 'rw-planner-game', DB_VER = 1, STORE = 'sprites', META = 'meta';
  var IMG_EXT = /\.(dds|png|jpg|jpeg|tga|psd)$/i;
  var DIR_SLOT = { north: 'n', back: 'n', east: 'e', side: 'e', south: 's', front: 's', west: 'w' };
  var SKIP_TAIL = { m: 1, menuicon: 1, blueprint: 1 };
  var LINK_KIND = {
    cornerfiller: 'corner', basic: 'basic', transmitter: 'transmitter',
    transmitteroverlay: 'transmitter', asymmetric: 'basic'
  };
  var APPEARANCES = ['Planks', 'Bricks', 'Metal', 'Smooth'];

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function stripExt(s) {
    return s.replace(/\.(psd|png|jpg|jpeg|tga)\.dds$/i, '').replace(/\.(dds|png|jpg|jpeg|tga|psd)$/i, '');
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  // ---------------------------------------------------------------- IndexedDB
  // 少数环境（某些浏览器 / 某些 file:// 设置）不允许 IndexedDB。
  // 这时退回「内存存储」：功能照常，只是刷新页面后要重新导入一次。

  var MEM = { sprites: {}, meta: {} };
  function memDb() { return { mem: true, close: function () {} }; }

  function idbOpen() {
    return new Promise(function (res, rej) {
      if (!global.indexedDB) return res(memDb());
      var req;
      try { req = global.indexedDB.open(DB_NAME, DB_VER); }
      catch (e) { return res(memDb()); }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
      };
      req.onsuccess = function () { res(req.result); };
      req.onerror = function () { res(memDb()); };
      req.onblocked = function () { res(memDb()); };
    });
  }
  function idbPut(db, store, key, val) {
    if (db && db.mem) { MEM[store][key] = val; return Promise.resolve(); }
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(val, key);
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { rej(tx.error); };
    });
  }
  function idbGet(db, store, key) {
    if (db && db.mem) return Promise.resolve(MEM[store][key]);
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, 'readonly');
      var r = tx.objectStore(store).get(key);
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error); };
    });
  }
  function idbClear(db, store) {
    if (db && db.mem) { MEM[store] = {}; return Promise.resolve(); }
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).clear();
      tx.oncomplete = function () { res(); };
      tx.onerror = function () { rej(tx.error); };
    });
  }

  // ---------------------------------------------------------------- 目录遍历

  /** 从拖入的 DataTransfer 里收集文件；目录会递归展开 */
  function collectFromDrop(dt) {
    var out = [];
    var items = dt.items;
    var jobs = [];
    for (var i = 0; i < items.length; i++) {
      var entry = items[i].webkitGetAsEntry && items[i].webkitGetAsEntry();
      if (entry) jobs.push(walkEntry(entry, '', out));
      else if (items[i].getAsFile) {
        var f = items[i].getAsFile();
        if (f) out.push({ path: f.name, file: f });
      }
    }
    return Promise.all(jobs).then(function () { return out; });
  }

  function walkEntry(entry, prefix, out) {
    if (entry.isFile) {
      return new Promise(function (res) {
        entry.file(function (f) { out.push({ path: prefix + entry.name, file: f }); res(); }, function () { res(); });
      });
    }
    if (!entry.isDirectory) return Promise.resolve();
    var reader = entry.createReader();
    var dir = prefix + entry.name + '/';
    return new Promise(function (res) {
      var all = [];
      function more() {
        reader.readEntries(function (batch) {
          if (!batch.length) {
            Promise.all(all.map(function (e) { return walkEntry(e, dir, out); })).then(res);
            return;
          }
          all = all.concat(Array.prototype.slice.call(batch));
          more();
        }, function () { res(); });
      }
      more();
    });
  }

  /** 从 <input webkitdirectory> 收集 */
  function collectFromInput(fileList) {
    var out = [];
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      out.push({ path: (f.webkitRelativePath || f.name), file: f });
    }
    return out;
  }

  // ---------------------------------------------------------------- 贴图清单

  /** 把一组 zip 里的贴图名收集成「前缀 -> [条目名]」索引 */
  function buildTexIndex(zips) {
    var list = [];
    zips.forEach(function (z, zi) {
      z.names.forEach(function (n) {
        var nm = n.replace(/^\/+/, '');
        if (nm.indexOf('Resources/') === 0) nm = nm.slice(10);
        if (nm.indexOf('Textures/') !== 0) return;
        list.push({ z: zi, rel: nm.slice(9), full: n });
      });
    });
    list.sort(function (a, b) { return a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0; });
    return {
      all: list,
      find: function (prefix) {
        var p = prefix.replace(/\\/g, '/').replace(/^\/+/, '');
        var out = [];
        for (var i = 0; i < list.length; i++) {
          var r = list[i].rel;
          if (r.indexOf(p) !== 0) continue;
          if (r.length > p.length && '._/'.indexOf(r[p.length]) < 0) continue;
          out.push(list[i]);
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

  // ---------------------------------------------------------------- 主流程

  function Importer() {
    this.onProgress = null;
    this.cancel = false;
  }

  Importer.prototype.tick = function (text, frac) {
    if (this.onProgress) this.onProgress(text, frac);
  };

  /**
   * 导入。files = [{path, file}]
   * 返回 { buildings, stuffs, stuffCats, floors, spriteCount, skipped }
   */
  Importer.prototype.run = async function (files) {
    var self = this;
    var docs = [], zips = [], langJobs = [];

    this.tick('正在读取游戏目录…', 0.02);
    files.forEach(function (f) {
      var p = f.path.replace(/\\/g, '/');
      var lower = p.toLowerCase();
      var base = lower.split('/').pop();
      if (base === 'assets.zip') { zips.push(f.file); return; }
      // 语言包：官方简中（tar 打包 或 解包后的 DefInjected XML 都认）
      if (lower.indexOf('chinesesimplified') >= 0) {
        if (/\.tar$/.test(base)) langJobs.push({ file: f.file, kind: 'tar' });
        else if (/definjected\/.*\.xml$/.test(lower)) langJobs.push({ file: f.file, kind: 'xml' });
        return;
      }
      if (/\/defs\/.+\.xml$/i.test(lower)) docs.push(f);
    });

    if (!docs.length) throw new Error('没找到 Data/**/Defs/**/*.xml —— 请拖入整个 RimWorld 安装目录（或它的 Data 目录）');
    if (!zips.length) throw new Error('没找到 Assets.zip —— 请拖入整个 RimWorld 安装目录（新版贴图打包在 Assets.zip 里）');

    this.tick('正在读取定义文件（' + docs.length + ' 个）…', 0.08);
    var xmlDocs = [];
    for (var i = 0; i < docs.length; i++) {
      xmlDocs.push({ path: docs[i].path, xml: await docs[i].file.text() });
      if (i % 100 === 0) {
        this.tick('正在读取定义文件 ' + i + '/' + docs.length + '…', 0.08 + 0.12 * i / docs.length);
        await sleep(0);
      }
      if (this.cancel) throw new Error('已取消');
    }

    var lang = {}, langSource = '';
    for (var li = 0; li < langJobs.length; li++) {
      try {
        if (langJobs[li].kind === 'tar') {
          var got = global.RWDefs.parseLangTar(new Uint8Array(await langJobs[li].file.arrayBuffer()));
          if (Object.keys(got).length) { lang = got; langSource = '官方简中语言包（.tar）'; break; }
        } else {
          var txt = await langJobs[li].file.text();
          global.RWDefs.collectLangXml(txt, lang);
          if (Object.keys(lang).length) langSource = '官方简中语言包（已解包）';
        }
      } catch (e) { /* 换下一个来源 */ }
    }
    this.tick('正在解析建筑数据…', 0.22);
    var parsed = global.RWDefs.parse(xmlDocs, lang);
    if (!parsed.buildings.length) throw new Error('解析出来的建筑是 0 条，游戏版本可能不兼容');
    if (!langSource) langSource = '内置中文对照表（没找到官方简中语言包）';

    this.tick('正在打开贴图包（' + zips.length + ' 个）…', 0.26);
    var zipReaders = [];
    for (var z = 0; z < zips.length; z++) {
      zipReaders.push(await global.RWZip.openZip(zips[z]));
      if (this.cancel) throw new Error('已取消');
    }
    var tex = buildTexIndex(zipReaders);

    // ---- 合并数据 ----
    global.RWData.STUFF_CATS = parsed.stuffCats;
    global.RWData.STUFFS = parsed.stuffs;
    var merged = global.RWData.mergeBuildings(parsed.buildings);
    // 地形 / 山体 / 科技树 / 物品名（存档导入、可建造性校验、工时估算都要用）
    global.RWData.mergeTerrains(parsed.terrain ? Object.keys(parsed.terrain).map(function (k) { return parsed.terrain[k]; }) : null);
    global.RWData.mergeRocks(parsed.rocks);
    global.RWData.mergeResearches(parsed.researches);
    if (parsed.items) global.RWData.ITEM_NAMES = parsed.items;

    // ---- 贴图 ----
    var db = await idbOpen();
    var meta = { at: Date.now(), buildings: parsed.buildings.length, stuffs: parsed.stuffs.length };
    if (db.mem) meta.mem = true;
    var manifest = {
      base: null, atlas: { cols: 4, rows: 4, inset: 0.03125 },
      stuff: {}, byName: {}, boxes: {}, items: {}, floors: {}
    };
    var canvas = document.createElement('canvas');
    var cx = canvas.getContext('2d');
    var done = 0, total = 0, skipped = 0, bytes = 0;

    function toBlob(name, rgba, w, h) {
      canvas.width = w; canvas.height = h;
      cx.clearRect(0, 0, w, h);
      cx.putImageData(new ImageData(rgba, w, h), 0, 0);
      return new Promise(function (res, rej) {
        canvas.toBlob(function (b) { if (b) res(b); else rej(new Error('PNG 编码失败')); }, 'image/png');
      });
    }

    var MAXPX = 512;
    async function addImage(name, entryRef, key, out) {
      var data = await zipReaders[entryRef.z].read(entryRef.full);
      var dec = global.RWZip.decodeDds(data);
      var rgba = dec.rgba, w = dec.width, h = dec.height;
      // 地板贴图是 1024×1024 却只铺一格，降采样能省很多体积
      if (Math.max(w, h) > MAXPX) {
        var r = MAXPX / Math.max(w, h);
        var nw = Math.max(1, Math.round(w * r)), nh = Math.max(1, Math.round(h * r));
        var big = document.createElement('canvas'); big.width = w; big.height = h;
        big.getContext('2d').putImageData(new ImageData(rgba, w, h), 0, 0);
        var small = document.createElement('canvas'); small.width = nw; small.height = nh;
        var sc = small.getContext('2d');
        sc.imageSmoothingEnabled = true; sc.imageSmoothingQuality = 'high';
        sc.drawImage(big, 0, 0, nw, nh);
        rgba = sc.getImageData(0, 0, nw, nh).data;
        w = nw; h = nh;
      }
      var blob = await toBlob(name, rgba, w, h);
      await idbPut(db, STORE, name, blob);
      bytes += blob.size;
      var box = alphaBox(rgba, w, h);
      if (box) manifest.boxes[name] = box;
      out[key] = name;
      return { rgba: rgba, width: w, height: h };
    }

    // 先统计一下要处理多少张，好显示进度
    var plan = [];
    Object.keys(global.RWData.byId).forEach(function (id) {
      var def = global.RWData.byId[id];
      var dn = def.def || id;
      var g = findGraphic(parsed, dn);
      if (!g || !g.texPath) return;
      var files = tex.find(g.texPath);
      if (!files.length) return;
      plan.push({ def: def, dn: dn, g: g, files: files, cls: classify(files, g.texPath) });
    });

    for (var k = 0; k < plan.length; k++) {
      if (this.cancel) throw new Error('已取消');
      var item = plan[k];
      var def = item.def, g = item.g, got = item.cls, dn = item.dn;
      var gc = (g.graphicClass || '').split('.').pop();
      var link = LINK_KIND[norm(g.linkType)];
      var ds = parseVec(g.drawSize);
      var offs = offsetsOf(g);
      var stuffable = (def.stuffCats && def.stuffCats.length) > 0;
      var fixed = g.color ? colorOf(g.color) : null;
      var tint = fixed || (stuffable ? 'stuff' : null);
      var entry = { ds: ds };
      if (offs) entry.off = offs;

      try {
        if (link) {
          var sheets = {};
          var grayAny = false;
          if (gc === 'Graphic_Appearances') {
            var base = g.texPath.split('/').pop();
            for (var a = 0; a < APPEARANCES.length; a++) {
              var app = APPEARANCES[a];
              var hit = tex.find(g.texPath + '/' + base + '_Atlas_' + app);
              if (!hit.length) continue;
              var nm = dn + '__' + app + '.png';
              var d1 = await addImage(nm, hit[0], app, sheets);
              if (isGrayscale(d1.rgba, d1.width, d1.height)) grayAny = true;
              done++;
            }
            if (!Object.keys(sheets).length) { skipped++; continue; }
            if (!grayAny) tint = null;
          } else {
            var nm2 = dn + '__atlas.png';
            var d2 = await addImage(nm2, got.plain || item.files[0], 'default', sheets);
            if (!isGrayscale(d2.rgba, d2.width, d2.height)) tint = null;
            done++;
          }
          entry.kind = 'linked';
          entry.link = link;
          entry.sheets = sheets;
          if (g.linkFlags && g.linkFlags.length) entry.lf = g.linkFlags;
        } else if (gc === 'Graphic_Multi') {
          var imgs = {};
          var slots = [['n', 'n'], ['e', 'e'], ['s', 's'], ['w', 'w']];
          var first = null;
          for (var s = 0; s < slots.length; s++) {
            var f = got[slots[s][0]];
            if (!f) continue;
            var d3 = await addImage(dn + '__' + slots[s][1] + '.png', f, slots[s][1], imgs);
            first = first || d3;
            done++;
          }
          if (!first) {
            var d4 = await addImage(dn + '__n.png', got.plain || (got.variants[0] || item.files[0]), 'n', imgs);
            first = d4; done++;
          }
          if (tint && first && !isGrayscale(first.rgba, first.width, first.height)) tint = null;
          entry.kind = 'multi';
          entry.imgs = imgs;
        } else {
          var pick = (gc === 'Graphic_Random' && got.variants.length) ? got.variants.slice().sort(function (x, y) { return x.rel < y.rel ? -1 : 1; })[0]
                   : (got.plain || got.variants[0] || item.files[0]);
          if (!pick) { skipped++; continue; }
          var imgs2 = {};
          var d5 = await addImage(dn + '__n.png', pick, 'n', imgs2);
          if (tint && !isGrayscale(d5.rgba, d5.width, d5.height)) tint = null;
          entry.kind = 'single';
          entry.imgs = imgs2;
          done++;
        }
        if (tint) entry.tint = tint;
        if ((g.thingClass || '').indexOf('Building_Door') >= 0) entry.mir = 1;
        // 炮塔的炮身
        if (g.turretGunDef) {
          var gg = findGraphic(parsed, g.turretGunDef);
          if (gg && gg.texPath) {
            var gf = tex.find(gg.texPath);
            if (gf.length) {
              var ovImgs = {};
              await addImage(dn + '__top.png', gf[0], 'n', ovImgs);
              entry.ov = { ds: parseVec(gg.drawSize), imgs: ovImgs };
              done++;
            }
          }
        }
      } catch (e) {
        skipped++;
      }
      manifest.items[dn] = entry;
      manifest.byName[norm(dn)] = dn;
      if (def.id && def.id !== dn) manifest.byName[norm(def.id)] = dn;
      if (k % 12 === 0 || k === plan.length - 1) {
        this.tick('正在解出贴图 ' + done + ' 张…（' + (k + 1) + '/' + plan.length + '）', 0.3 + 0.68 * (k + 1) / plan.length);
        await sleep(0);
      }
    }

    // ---- 地板 ----
    var FLOOR_MAP = {
      none: 'Soil', wood: 'WoodPlankFloor', stone: 'TileGranite', tileSandstone: 'TileSandstone',
      tileGranite: 'TileGranite', tileLimestone: 'TileLimestone', tileSlate: 'TileSlate',
      tileMarble: 'TileMarble', tileAncient: 'AncientTile', metalTile: 'MetalTile',
      goldTile: 'GoldTile', silverTile: 'SilverTile', concrete: 'Concrete', steel: 'MetalTile',
      sterile: 'SterileTile', carpet: 'Carpet', paved: 'PavedTile', water: 'WaterShallow',
      bridge: 'Bridge'
    };
    var FALLBACK = { tileSandstone: 'Terrain/Surfaces/TileStone', tileGranite: 'Terrain/Surfaces/TileStone',
      tileLimestone: 'Terrain/Surfaces/TileStone', tileSlate: 'Terrain/Surfaces/TileStone',
      tileMarble: 'Terrain/Surfaces/TileStone', stone: 'Terrain/Surfaces/TileStone',
      metalTile: 'Terrain/Surfaces/GenericFloorTile', goldTile: 'Terrain/Surfaces/GenericFloorTile',
      silverTile: 'Terrain/Surfaces/GenericFloorTile', steel: 'Terrain/Surfaces/GenericFloorTile',
      sterile: 'Terrain/Surfaces/GenericFloorTile', bridge: 'Terrain/Surfaces/WoodFloor' };
    for (var fid in FLOOR_MAP) {
      var t = parsed.terrain[FLOOR_MAP[fid]] || {};
      var tp = t.texPath || FALLBACK[fid];
      if (!tp) continue;
      var ff = tex.find(tp);
      if (!ff.length) continue;
      try {
        var nm3 = 'floor__' + fid + '.png';
        var imgs3 = {};
        var d6 = await addImage(nm3, ff[0], 'img', imgs3);
        var fe = { img: imgs3.img };
        if (t.color && isGrayscale(d6.rgba, d6.width, d6.height)) fe.tint = t.color;
        manifest.floors[fid] = fe;
      } catch (e) { /* 忽略单张失败 */ }
    }

    await idbPut(db, META, 'manifest', manifest);
    await idbPut(db, META, 'buildings', parsed.buildings);
    await idbPut(db, META, 'stuffs', parsed.stuffs);
    await idbPut(db, META, 'stuffCats', parsed.stuffCats);
    await idbPut(db, META, 'terrains', parsed.terrain ? Object.keys(parsed.terrain).map(function (k) { return parsed.terrain[k]; }) : []);
    await idbPut(db, META, 'rocks', parsed.rocks || []);
    await idbPut(db, META, 'researches', parsed.researches || []);
    await idbPut(db, META, 'items', parsed.items || {});
    meta.sprites = done;
    meta.skipped = skipped;
    meta.bytes = bytes;
    meta.buildingsTotal = merged.total;
    meta.langSource = langSource;
    await idbPut(db, META, 'info', meta);
    db.close();

    this.tick('完成：' + done + ' 张贴图', 1);
    return { info: meta, manifest: manifest, merged: merged, buildings: parsed.buildings, langSource: langSource };
  };

  // ---- 从解析结果里找某条 def 的 graphicData ----
  function findGraphic(parsed, defName) {
    var cache = parsed.__gcache;
    if (!cache) {
      cache = parsed.__gcache = {};
      parsed.__raw.forEach(function (r) {
        var m = global.RWDefs.__resolve(r.el, parsed.__named);
        var dn = m.defName;
        if (dn && !cache[dn]) {
          cache[dn] = {
            texPath: m.graphicData.texPath, graphicClass: m.graphicData.graphicClass,
            drawSize: m.graphicData.drawSize, linkType: m.graphicData.linkType,
            linkFlags: m.graphicData.linkFlags, color: m.graphicData.color,
            drawOffset: m.graphicData.drawOffset, drawOffsetNorth: m.graphicData.drawOffsetNorth,
            drawOffsetEast: m.graphicData.drawOffsetEast, drawOffsetSouth: m.graphicData.drawOffsetSouth,
            drawOffsetWest: m.graphicData.drawOffsetWest,
            thingClass: m.thingClass, turretGunDef: m.building.turretGunDef
          };
        }
      });
    }
    return cache[defName];
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

  // ---------------------------------------------------------------- 读取缓存

  /**
   * 老缓存里可能存着英文名（当时没读到官方简中语言包）。
   * 能用内置对照表（js/zh-names.js）修的，顺手修一遍，省得用户重新导入。
   */
  function repairNames(buildings, stuffs, stuffCats) {
    var D = global.RWData;
    if (!D || !D.zhName || !D.hasCJK) return 0;
    var fixed = 0;
    function fix(o) {
      if (!o || !o.id || !o.name || D.hasCJK(o.name)) return;
      var zh = D.zhName(o.id);
      if (zh && zh !== o.name && D.hasCJK(zh)) { o.name = zh; fixed++; }
    }
    (buildings || []).forEach(fix);
    (stuffs || []).forEach(fix);
    (stuffCats || []).forEach(fix);
    return fixed;
  }

  /** 启动时尝试用缓存里的数据；成功返回 manifest，否则 null */
  async function loadCache() {
    try {
      var db = await idbOpen();
      var info = await idbGet(db, META, 'info');
      if (!info) { db.close(); return null; }
      var manifest = await idbGet(db, META, 'manifest');
      var buildings = await idbGet(db, META, 'buildings');
      var stuffs = await idbGet(db, META, 'stuffs');
      var stuffCats = await idbGet(db, META, 'stuffCats');
      var terrains = await idbGet(db, META, 'terrains');
      var rocks = await idbGet(db, META, 'rocks');
      var researches = await idbGet(db, META, 'researches');
      var items = await idbGet(db, META, 'items');
      if (!manifest || !buildings) { db.close(); return null; }
      var repaired = repairNames(buildings, stuffs, stuffCats);
      if (stuffCats) global.RWData.STUFF_CATS = stuffCats;
      if (stuffs) global.RWData.STUFFS = stuffs;
      var merged = global.RWData.mergeBuildings(buildings);
      if (terrains) global.RWData.mergeTerrains(terrains);
      if (rocks) global.RWData.mergeRocks(rocks);
      if (researches) global.RWData.mergeResearches(researches);
      if (items) global.RWData.ITEM_NAMES = items;
      if (repaired) info.repaired = repaired;
      db.close();
      return { info: info, manifest: manifest, merged: merged };
    } catch (e) { return null; }
  }

  /** 从 IndexedDB 取一张贴图，返回 objectURL */
  async function getImageURL(name) {
    var db = await idbOpen();
    var blob = await idbGet(db, STORE, name);
    db.close();
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }

  async function clearCache() {
    var db = await idbOpen();
    await idbClear(db, STORE);
    await idbClear(db, META);
    db.close();
  }

  async function cacheInfo() {
    try {
      var db = await idbOpen();
      var info = await idbGet(db, META, 'info');
      db.close();
      return info || null;
    } catch (e) { return null; }
  }

  global.RWGame = {
    Importer: Importer,
    collectFromDrop: collectFromDrop,
    collectFromInput: collectFromInput,
    loadCache: loadCache,
    getImageURL: getImageURL,
    clearCache: clearCache,
    cacheInfo: cacheInfo,
    _findGraphic: findGraphic
  };
})(typeof window !== 'undefined' ? window : globalThis);
