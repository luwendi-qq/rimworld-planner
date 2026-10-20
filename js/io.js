/*
 * io.js —— 工程存取、RimWorld 存档(.rws) 读取
 */
(function (global) {
  'use strict';

  var RW = global.RW, Data = global.RWData, X = global.RWExport;
  var LS_KEY = 'rw-planner:layouts';
  var LS_SETS = 'rw-planner:settings';

  // ---------------------------------------------- localStorage
  function lsAvailable() {
    try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch (e) { return false; }
  }
  function loadStore() {
    if (!lsAvailable()) return {};
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveStore(o) {
    if (!lsAvailable()) return false;
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
  }
  function saveNamed(name, project) {
    var s = loadStore(); s[name] = project; return saveStore(s);
  }
  function deleteNamed(name) { var s = loadStore(); delete s[name]; return saveStore(s); }

  function saveSettings(o) {
    if (!lsAvailable()) return;
    try { localStorage.setItem(LS_SETS, JSON.stringify(o)); } catch (e) { }
  }
  function loadSettings() {
    if (!lsAvailable()) return null;
    try { return JSON.parse(localStorage.getItem(LS_SETS) || 'null'); } catch (e) { return null; }
  }

  // ---------------------------------------------- 存档读取 (.rws)
  // defName → 本库 id 的匹配统一交给 RWData.matchDefName（含别名表）
  function matchDef(defName) { return Data.matchDefName(defName); }

  var ROT_FROM_INT = { 0: 0, 1: 90, 2: 180, 3: 270 };

  // ---------------------------------------------- 存档网格（地形/山体/屋顶）
  // 游戏把整张地图的网格用 raw-deflate + base64 存进 XML：
  //   <terrainGrid><topGridDeflate>...</topGridDeflate></terrainGrid>
  //   <compressedThingMapDeflate>...</compressedThingMapDeflate>
  // 解出来是 width*height 个 uint16，每个是 defName 的短哈希：
  //   h = 23; h = h*31 + charCode; 短路到 16 位时 % 65535
  // 顺序是 z*W + x（z 从南到北，和 thing 的 pos 同一坐标系）。

  function b64Bytes(b64) {
    var s = String(b64 || '').replace(/\s+/g, '');
    var bin = atob(s);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  /** raw deflate 解压（DecompressionStream 现代浏览器都支持） */
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('这个浏览器不支持解压存档网格（需要 DecompressionStream：Chrome 80+/Edge/Firefox 113+）');
    }
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  /** 把一个 *Deflate 元素解成 Uint16Array（失败返回 null，不阻断存档导入） */
  async function decodeGridU16(el) {
    if (!el) return null;
    try {
      var bytes = b64Bytes(el.textContent);
      var raw = await inflateRaw(bytes);
      // 有的网格（fog）是 1 字节/格；地形/山体是 2 字节
      if (raw.length % 2 === 0 && raw.length >= 2) {
        return new Uint16Array(raw.buffer, raw.byteOffset, raw.length >> 1);
      }
      return new Uint8Array(raw.buffer, raw.byteOffset, raw.length);
    } catch (e) {
      if (global.console) console.warn('[save] 网格解压失败:', e && e.message);
      return null;
    }
  }

  /** 只解压成字节（位图网格用，比如玩家活动区域） */
  async function decodeBytes(el) {
    if (!el) return null;
    try {
      var bytes = b64Bytes(el.textContent);
      return await inflateRaw(bytes);
    } catch (e) {
      if (global.console) console.warn('[save] 位图解压失败:', e && e.message);
      return null;
    }
  }

  function tagName(el) { var t = el.tagName || ''; return t.indexOf(':') >= 0 ? t.split(':').pop() : t; }

  /** 在 map 元素里找某个直接/间接子元素，名字以 Deflate 结尾的网格 */
  function gridEl(mapEl, name) {
    var list = mapEl.getElementsByTagName(name);
    return list.length ? list[0] : null;
  }
  function subtreeGrid(parentEl, name) {
    if (!parentEl) return null;
    var list = parentEl.getElementsByTagName(name);
    return list.length ? list[0] : null;
  }

  /**
   * 解析存档里的整张地图图层（地形 / 山体 / 屋顶），返回编辑坐标系的网格。
   * 返回 { w, h, terrain:{cells,defs,unknown}, rocks:{cells,defs}, roofs:{cells,thick} }
   */
  async function parseMapLayers(mapEl, W, H, flipX, flipZ, curIdx) {
    if (!mapEl || !W || !H) return null;
    var total = W * H;

    var terrainSeg = mapEl.getElementsByTagName('terrainGrid')[0]
      || (function () { var a = mapEl.getElementsByTagName('terrainGrid'); return a.length ? a[0] : null; })();
    var terrGrid = terrainSeg ? subtreeGrid(terrainSeg, 'topGridDeflate') : null;
    var rockGrid = gridEl(mapEl, 'compressedThingMapDeflate');
    var roofSeg = mapEl.getElementsByTagName('roofGrid')[0];
    var roofGrid = roofSeg ? subtreeGrid(roofSeg, 'roofsDeflate') : null;

    var terr = await decodeGridU16(terrGrid);
    var rock = await decodeGridU16(rockGrid);
    var roof = await decodeGridU16(roofGrid);
    if (!terr && !rock && !roof) return null;

    // 读到的数组按「游戏坐标」排列，翻成编辑器坐标。t 可能是 Uint16 或 Uint8。
    function toEditor(src, size) {
      var dst = new Uint16Array(total);
      if (!src) return dst;
      for (var gz = 0; gz < H; gz++) {
        for (var gx = 0; gx < W; gx++) {
          var gi = gz * W + gx;
          if (gi >= src.length) continue;
          var v = src[gi];
          if (!v) continue;
          var x = flipX ? (W - 1 - gx) : gx;
          var z = flipZ ? (H - 1 - gz) : gz;
          dst[z * W + x] = v;
        }
      }
      return dst;
    }

    var terrE = toEditor(terr), rockE = toEditor(rock), roofE = toEditor(roof);

    // 哈希 -> defName
    var terrDefs = {}, terrUnknown = {};
    var byHash = {};
    var T = Data.terrains ? Data.terrains() : {};
    Object.keys(T).forEach(function (d) { byHash[Data.terrainHash(d)] = d; });
    Object.keys(byHash).forEach(function (h) { terrDefs[h] = byHash[h]; });
    var seen = {};
    terrE.forEach(function (v) {
      if (!v || seen[v]) return;
      seen[v] = 1;
      if (terrDefs[v]) return;
      var d = Data.terrainByHash(v);
      if (d) terrDefs[v] = d; else terrUnknown[v] = 1;
    });

    // 山体：只关心自然岩石（含资源矿），地表的碎石块不算
    var rockDefs = {}, rockList = Data.rocks ? Data.rocks() : {};
    Object.keys(rockList).forEach(function (d) { rockDefs[Data.terrainHash(d)] = d; });
    var rockSeen = {};
    rockE.forEach(function (v) {
      if (v && !rockSeen[v]) { rockSeen[v] = 1; if (!rockDefs[v]) { var d = null; Object.keys(rockList).forEach(function (k) { if (Data.terrainHash(k) === v) d = k; }); if (d) rockDefs[v] = d; } }
    });

    // 屋顶：ThickRockRoof / ThinRockRoof 表示头顶是山体
    var roofThick = Data.terrainHash('RoofRockThick') || 0;
    var roofThin = Data.terrainHash('RoofRockThin') || 0;
    // 内置兜底哈希（游戏 RoofDef 的名字固定，直接算）
    function rhash(n) { return Data.terrainHash(n); }
    roofThick = rhash('RoofRockThick'); roofThin = rhash('RoofRockThin');
    var roofKind = {}; roofKind[rhash('RoofConstructed')] = 1; roofKind[rhash('RoofRockThin')] = 2; roofKind[rhash('RoofRockThick')] = 3;

    // 压缩物品图里不只有岩石，还有碎石块/植物/杂物。这里只留「自然岩石」：
    //   · 认得出的岩石 def → 保留
    //   · 不认识的 def，但脚下是 X_Rough / X_RoughHewn 岩层 → 按脚下的岩石类型归类
    //     （1.7/模组里有些岩石 def 没在 Defs 里，靠地形反推）
    //   · 其余（石块、杂物）→ 清 0，免得当成山体
    for (var ci = 0; ci < total; ci++) {
      var rv = rockE[ci];
      if (!rv) continue;
      if (rockDefs[rv]) continue;
      var td = terrDefs[terrE[ci]];
      var inferred = td && Data.rockByTerrain ? Data.rockByTerrain(td) : null;
      if (inferred) {
        var ih = Data.terrainHash(inferred);
        rockE[ci] = ih;
        rockDefs[ih] = inferred;
      } else {
        rockE[ci] = 0;
      }
    }

    return {
      w: W, h: H, flipX: !!flipX, flipZ: flipZ !== false,
      terrain: { w: W, h: H, cells: terrE, defs: terrDefs, unknown: Object.keys(terrUnknown).length },
      rocks: { w: W, h: H, cells: rockE, defs: rockDefs },
      roofs: { w: W, h: H, cells: roofE, kind: roofKind }
    };
  }

  /**
   * 玩家活动区域（Area_Home）：游戏里 <areaManager><areas><li Class="Area_Home">
   * 里是一张按位打包的 BoolGrid（trueCount + mapSizeX/Z + arrDeflate）。
   * 后续用来区分「玩家基地范围内」和「地图自带的荒野/山体」：
   *   · 画布上给玩家区域加一层淡绿边界
   *   · 库存默认只统计玩家区域内的物品（可以在面板里切回全地图）
   */
  async function parseHomeArea(mapEl, W, H, flipX, flipZ) {
    if (!mapEl) return null;
    var am = mapEl.getElementsByTagName('areaManager')[0];
    if (!am) return null;
    var areas = am.getElementsByTagName('areas')[0];
    if (!areas) return null;
    for (var i = 0; i < areas.children.length; i++) {
      var li = areas.children[i];
      var cls = li.getAttribute('Class') || '';
      if (cls !== 'Area_Home') continue;
      var inner = li.getElementsByTagName('innerGrid')[0];
      if (!inner) return null;
      var def = inner.getElementsByTagName('arrDeflate')[0];
      var raw = await decodeBytes(def);
      if (!raw) return null;
      var total = W * H;
      var cells = new Uint16Array(total);
      var count = 0;
      for (var gz = 0; gz < H; gz++) {
        for (var gx = 0; gx < W; gx++) {
          var gi = gz * W + gx;
          var on = (raw[gi >> 3] >> (gi & 7)) & 1;
          if (!on) continue;
          var x = flipX ? (W - 1 - gx) : gx;
          var z = flipZ ? (H - 1 - gz) : gz;
          cells[z * W + x] = 1;
          count++;
        }
      }
      return { w: W, h: H, cells: cells, count: count };
    }
    return null;
  }

  /** 玩家阵营：<allFactions><li><def>PlayerColony</def><loadID>11</loadID> → Faction_11 */
  function playerFactionRefs(doc) {
    var refs = {}, any = false, name = '';
    ['allFactions', 'factions'].forEach(function (box) {
      var boxEls = doc.getElementsByTagName(box);
      for (var b = 0; b < boxEls.length; b++) {
        var kids = boxEls[b].children;
        for (var i = 0; i < kids.length; i++) {
          var defEl = directChild(kids[i], 'def');
          var idEl = directChild(kids[i], 'loadID');
          if (!defEl || !idEl) continue;
          var d = (defEl.textContent || '').trim();
          if (/^Player(Colony|Tribe|Faction)/.test(d)) {
            refs['Faction_' + (idEl.textContent || '').trim()] = true;
            any = true;
            var nm = directChild(kids[i], 'name');
            if (nm && !name) name = (nm.textContent || '').trim();
          }
        }
      }
    });
    // 兜底：实在找不到就返回空，调用方会退化成「所有带技能的 Pawn」
    return { refs: refs, any: any, name: name };
  }

  /** 解析殖民者：姓名 + 技能 + 特质 + 工作优先级 */
  function parsePawns(mapEl, faction) {
    var out = [];
    var thingsEls = mapEl.getElementsByTagName('things');
    for (var t = 0; t < thingsEls.length; t++) {
      var kids = thingsEls[t].children;
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i];
        var cls = node.getAttribute('Class') || '';
        if (cls !== 'Pawn') continue;
        var def = textOf(node, 'def');
        if (!def) continue;
        var kindDef = textOf(node, 'kindDef') || '';
        var fac = textOf(node, 'faction');
        var humanlike = /Human/i.test(def) ||
          /^(Colonist|Slave|Prisoner|Child|VatGrown|WildChild|Nomad|Tribal|Villager|Town|Imperial|Mercenary|Pirate|Soldier|Guard|Trader|Visitor| refugee|Refugee)/i.test(kindDef);
        if (!humanlike) continue;
        if (faction.any && fac && !faction.refs[fac]) continue;
        if (faction.any && !fac) continue;
        // 死亡/被搬运的也算，先收着，后面用 dead 标记
        var dead = /true/i.test(textOf(node, 'dead') || '');
        var name = '';
        var nameEl = directChild(node, 'name');
        if (nameEl) {
          var nick = directChild(nameEl, 'nick');
          var first = directChild(nameEl, 'first');
          var last = directChild(nameEl, 'last');
          var single = directChild(nameEl, 'name');
          name = (nick && (nick.textContent || '').trim())
            || (single && (single.textContent || '').trim())
            || (((first && first.textContent) || '') + ' ' + ((last && last.textContent) || '')).trim();
        }
        if (!name) name = def;

        var skills = {};
        var skillsBox = directChild(node, 'skills');
        if (skillsBox) {
          var inner = directChild(skillsBox, 'skills') || skillsBox;
          var li = inner.children;
          for (var s = 0; s < li.length; s++) {
            var sd = directChild(li[s], 'def');
            if (!sd) continue;
            var key = (sd.textContent || '').trim();
            skills[key] = {
              level: parseInt(textOf(li[s], 'level') || '0', 10) || 0,
              passion: textOf(li[s], 'passion') || 'None'
            };
          }
        }
        var traits = [];
        var traitsBox = directChild(node, 'traits');
        if (traitsBox) {
          var all = directChild(traitsBox, 'allTraits') || traitsBox;
          var tl = all.children;
          for (var q = 0; q < tl.length; q++) {
            var td = directChild(tl[q], 'def');
            if (td) traits.push((td.textContent || '').trim());
          }
        }
        var priorities = [];
        var ws = directChild(node, 'workSettings');
        if (ws) {
          var pr = directChild(ws, 'priorities');
          var vals = pr ? directChild(pr, 'vals') : null;
          if (vals) {
            for (var v = 0; v < vals.children.length; v++) {
              priorities.push(parseInt((vals.children[v].textContent || '0').trim(), 10) || 0);
            }
          }
        }
        out.push({
          id: textOf(node, 'id'), def: def, name: name,
          kindDef: textOf(node, 'kindDef') || '',
          faction: fac, dead: dead,
          skills: skills, traits: traits, priorities: priorities
        });
      }
    }
    return out;
  }

  /** 解析科技进度 */
  function parseResearch(doc) {
    var rm = doc.getElementsByTagName('researchManager')[0];
    if (!rm) return null;
    var cur = textOf(rm, 'currentProj') || null;
    var progress = {};
    var pbox = directChild(rm, 'progress');
    if (pbox) {
      var keys = directChild(pbox, 'keys');
      var vals = directChild(pbox, 'values');
      if (keys && vals) {
        var n = Math.min(keys.children.length, vals.children.length);
        for (var i = 0; i < n; i++) {
          var k = (keys.children[i].textContent || '').trim();
          var v = parseFloat((vals.children[i].textContent || '0').trim()) || 0;
          if (k) progress[k] = v;
        }
      }
    }
    return { current: cur, progress: progress };
  }

  /**
   * 解析基地库存：把当前地图上所有物品按 def 累加 stackCount。
   * 同时按「玩家活动区域」分开统计（有 Area_Home 时）：
   *   all  = 全地图（含荒野里散落的物品）
   *   home = 玩家区域内（基地库存，默认用它）
   */
  function parseResources(mapEl, home, W, H, flipX, flipZ) {
    var all = {}, inHome = {};
    var skipped = ['Pawn', 'Plant', 'Filth', 'Corpse', 'Mote', 'Projectile', 'Building', 'Blueprint_Build', 'Frame', 'Mineable'];
    var thingsEls = mapEl.getElementsByTagName('things');

    function bump(el, pos) {
      var d = directChild(el, 'def'); var sc = directChild(el, 'stackCount');
      if (!d || !sc) return;
      var dn = (d.textContent || '').trim();
      var n = parseInt((sc.textContent || '0').trim(), 10) || 0;
      if (!dn || n <= 0) return;
      all[dn] = (all[dn] || 0) + n;
      if (home && pos) {
        var ex = flipX ? (W - 1 - pos.x) : pos.x;
        var ez = flipZ ? (H - 1 - pos.z) : pos.z;
        if (ex >= 0 && ez >= 0 && ex < W && ez < H && home.cells[ez * W + ex]) {
          inHome[dn] = (inHome[dn] || 0) + n;
        }
      }
    }

    function walk(el, depth, pos) {
      if (depth > 6) return;
      var kids = el.children;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        var t = tagName(c);
        if (t !== 'thing' && t !== 'li') continue;
        var cls = c.getAttribute('Class') || '';
        if (skipped.indexOf(cls) >= 0) continue;
        var pEl = directChild(c, 'pos');
        var p = pEl ? parseVec3(pEl.textContent) : null;
        if (p) pos = p;
        bump(c, pos);
        // 容器里的东西（货架、托盘、背包……）也要算
        var inner = c.getElementsByTagName('innerContainer');
        for (var k = 0; k < inner.length; k++) walk(inner[k], depth + 1, pos);
        walk(c, depth + 1, pos);
      }
    }
    for (var t = 0; t < thingsEls.length; t++) walk(thingsEls[t], 0, null);
    return { all: all, home: inHome, hasHome: !!home };
  }

  function directChild(el, tag) {
    var kids = el.children;
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].tagName === tag) return kids[i];
    }
    return null;
  }

  function textOf(el, tag) {
    var c = directChild(el, tag);
    return c ? (c.textContent || '').trim() : '';
  }

  /** 地板蓝图的名字 → 本工具的地板种类（近似映射，只为观感） */
  function guessFloor(name) {
    var n = (name || '').toLowerCase();
    // 按材质细分，别再全糊成一个颜色
    if (/^ancientheavybridge|heavybridge/.test(n)) return 'bridge';
    if (/^ancient.*bridge|bridge/.test(n)) return 'bridge';
    if (/^ancient/.test(n)) return 'tileAncient';
    if (/carpet/.test(n)) return 'carpet';
    if (/sterile/.test(n)) return 'sterile';
    if (/concrete/.test(n)) return 'concrete';
    if (/gold/.test(n)) return 'goldTile';
    if (/silver/.test(n)) return 'silverTile';
    if (/metal|steel/.test(n)) return 'metalTile';
    if (/wood|plank|log|burned/.test(n)) return 'wood';
    if (/sandstone/.test(n)) return 'tileSandstone';
    if (/granite/.test(n)) return 'tileGranite';
    if (/limestone/.test(n)) return 'tileLimestone';
    if (/slate/.test(n)) return 'tileSlate';
    if (/marble/.test(n)) return 'tileMarble';
    if (/paved|brick/.test(n)) return 'paved';
    if (/tile|stone/.test(n)) return 'stone';
    return null;
  }

  /** 解析 "<size>(250, 1, 250)</size>" 这种三维坐标串 */
  function parseVec3(s) {
    var m = String(s || '').match(/\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?/);
    return m ? { x: +m[1], y: +m[2], z: +m[3] } : null;
  }

  /**
   * 读取 .rws 存档。
   * 地图尺寸在 savegame/game/maps/li/mapInfo/size，形如 (250, 1, 250)。
   * 建筑在 <things> 下，每条是 <thing Class="Building"> 或 <li Class="Building">。
   * 异步：地形/山体网格是 raw-deflate 压缩的，需要 DecompressionStream。
   */
  async function parseSave(text, opts) {
    opts = opts || {};
    var doc;
    try {
      doc = new DOMParser().parseFromString(text, 'application/xml');
    } catch (e) {
      throw new Error('存档 XML 解析失败');
    }
    if (doc.querySelector('parsererror')) throw new Error('存档 XML 解析失败（文件可能不完整）');

    var version = '';
    var metaEl = doc.querySelector('savegame > meta') || doc.querySelector('meta');
    if (metaEl) {
      var gv = directChild(metaEl, 'gameVersion');
      if (gv) version = (gv.textContent || '').trim();
    }
    // 存档里的 mod 列表，蓝图 meta 直接复用，免得游戏报「缺少 mod」
    function liList(parent, tag) {
      if (!parent) return [];
      var box = directChild(parent, tag);
      if (!box) return [];
      var out = [];
      for (var i = 0; i < box.children.length; i++) out.push((box.children[i].textContent || '').trim());
      return out;
    }
    var metaInfo = {
      gameVersion: version,
      modIds: liList(metaEl, 'modIds'),
      modSteamIds: liList(metaEl, 'modSteamIds'),
      modNames: liList(metaEl, 'modNames')
    };

    // 地图尺寸：每张地图一个 mapInfo/size
    var maps = doc.querySelectorAll('maps > li');
    var mapSizes = [];
    for (var m = 0; m < maps.length; m++) {
      var info = directChild(maps[m], 'mapInfo');
      var sizeEl = info ? directChild(info, 'size') : null;
      var v = sizeEl ? parseVec3(sizeEl.textContent) : null;
      mapSizes.push(v ? { w: v.x, h: v.z } : null);
    }
    // currentMapIndex 在 savegame/game/ 下，不是 savegame 的直接子元素
    var idxEl = doc.querySelector('game > currentMapIndex') || doc.querySelector('currentMapIndex');
    var curIdx = idxEl ? parseInt((idxEl.textContent || '').trim(), 10) : 0;
    if (isNaN(curIdx)) curIdx = 0;
    var mapSize = mapSizes[curIdx] || mapSizes.find(function (s) { return s; }) || null;
    var mapEl = maps[curIdx] || maps[0] || null;

    var thingsEls = doc.getElementsByTagName('things');
    var found = [], floors = [], unknown = {}, skipped = 0, onOtherMap = 0;

    for (var t = 0; t < thingsEls.length; t++) {
      var kids = thingsEls[t].children;
      for (var i = 0; i < kids.length; i++) {
        var node = kids[i];
        // 建筑本体（Building / Building_Bed / Building_Door …）
        // 以及 Blueprint_Build（建造蓝图）和 Frame（施工框架）—— 玩家规划中的东西也要，
        // 游戏里很多基地本身就是「一堆蓝图」的状态。
        // 其余（Plant/Filth/Pawn/物品/Corpse/Mineable…）一律忽略。
        var cls = node.getAttribute('Class') || '';
        var planned = false;
        if (cls.indexOf('Building') === 0) { /* 已建成 */ }
        else if (cls === 'Blueprint_Build' || cls === 'Frame') { planned = true; }
        else continue;

        var defName = textOf(node, 'def');
        if (!defName) continue;
        var posRaw = textOf(node, 'pos');
        if (!posRaw) continue;
        var pos = parseVec3(posRaw);
        if (!pos) continue;
        // 多地图存档：只取当前地图
        var mapTag = textOf(node, 'map');
        if (mapTag !== '' && parseInt(mapTag, 10) !== curIdx) { onOtherMap++; continue; }

        // 蓝图/框架的 def 带前缀：Blueprint_Wall / Frame_Wall
        var lookup = defName, prefix = '';
        if (cls === 'Blueprint_Build' || cls === 'Frame') {
          var us = defName.indexOf('_');
          if (us > 0) { prefix = defName.slice(0, us).toLowerCase(); lookup = defName.slice(us + 1); }
        }
        if (prefix && guessFloor(lookup)) {
          var forbidEl = directChild(node, 'forbidden');
          floors.push({
            x: pos.x, z: pos.z, floorId: guessFloor(lookup),
            planned: true,
            forbidden: !!(forbidEl && /true/i.test(forbidEl.textContent || ''))
          });
          continue;
        }

        var id = matchDef(lookup);
        if (!id) {
          if (/wall|door|bed|table|bench|turret|generator|lamp|cooler|heater|conduit|fence|shelf|column|sarcoph|grave|statue|sculpture|stove|drill|console|battery|solar|wind|turbine|vent|trap|pod|altar|throne|brazier|torch|refinery|smelter|crematorium|dispenser|hydro|analyzer|scanner|barricade|sandbag|bridge|mortar|crib|dresser|pot|pin|billiard|poker|school|slab|relay|radiator|embrasure/i.test(defName)) {
            unknown[lookup] = (unknown[lookup] || 0) + 1;
          } else skipped++;
          continue;
        }
        var rot = 0;
        var rotRaw = textOf(node, 'rot');
        if (rotRaw !== '') rot = ((parseInt(rotRaw, 10) || 0) % 4 + 4) % 4 * 90;
        // 材质：存档里每个建筑都带 <stuff>，和游戏一样逐物品独立
        var stuffRaw = textOf(node, 'stuff');
        var stuff = null;
        if (stuffRaw && Data.stuffById) {
          var s = Data.stuffById(stuffRaw);
          if (s) stuff = s.id;
        }
        found.push({ defId: id, x: pos.x, z: pos.z, rot: rot, srcDef: defName,
                     planned: planned, stuff: stuff, forbidden: (function () {
                       var f = directChild(node, 'forbidden');
                       return !!(f && /true/i.test(f.textContent || ''));
                     })() });
      }
    }

    // ---- 地图图层 / 殖民者 / 科技 / 库存 ----
    var layers = null;
    if (mapEl && mapSize && !opts.noLayers) {
      try {
        layers = await parseMapLayers(mapEl, mapSize.w, mapSize.h, opts.flipX, opts.flipZ !== false, curIdx);
      } catch (e) {
        if (global.console) console.warn('[save] 地形解析失败:', e && e.message);
      }
    }
    var faction = mapEl ? playerFactionRefs(doc) : { refs: {}, any: false, name: '' };
    var home = null;
    if (mapEl && mapSize) {
      try { home = await parseHomeArea(mapEl, mapSize.w, mapSize.h, opts.flipX, opts.flipZ !== false); }
      catch (e) { if (global.console) console.warn('[save] 玩家区域解析失败:', e && e.message); }
    }
    var pawns = mapEl ? parsePawns(mapEl, faction) : [];
    var research = parseResearch(doc);
    var resources = mapEl && mapSize
      ? parseResources(mapEl, home, mapSize.w, mapSize.h, opts.flipX, opts.flipZ !== false)
      : { all: {}, home: {}, hasHome: false };

    var difficulty = '';
    var stEl = doc.getElementsByTagName('storyteller')[0];
    if (stEl) difficulty = textOf(stEl, 'difficulty') || '';

    return {
      buildings: found, floors: floors, unknown: unknown, skipped: skipped, onOtherMap: onOtherMap,
      mapSize: mapSize, mapSizes: mapSizes, mapIndex: curIdx, version: version, meta: metaInfo,
      layers: layers, pawns: pawns, research: research, resources: resources,
      home: home, colonyName: faction.name || '',
      difficulty: difficulty, factionRefs: Object.keys(faction.refs)
    };
  }

  /**
   * 把存档里的建筑导入画布。
   *   1) 地图尺寸自动设成存档里的尺寸
   *   2) 按存档原始坐标放置（不再挪到左上角，避免「偏移」）
   *   3) 默认翻转 Z 轴：游戏里 +z 是北（屏幕上方），本编辑器 z 向下，
   *      翻过来才能和游戏内看到的朝向一致
   */
  function importFromSave(result, opts) {
    opts = opts || {};
    var bs = result.buildings;
    var sz = result.mapSize || {};
    var W = Math.max(8, sz.w || 0);
    var H = Math.max(8, sz.h || 0);

    // 没有地图尺寸就按内容推算
    if (!sz.w || !sz.h) {
      var mx = 0, mz = 0;
      bs.forEach(function (b) { mx = Math.max(mx, b.x + 1); mz = Math.max(mz, b.z + 1); });
      W = Math.max(W, mx + 2); H = Math.max(H, mz + 2);
    }

    var flipZ = opts.flipZ !== false;   // 默认开
    var flipX = !!opts.flipX;

    // 翻转设置要写回状态：导出蓝图时用的是 state.flipX / state.flipZ，
    // 如果这里不写回，「翻转 X 轴」导入的存档导出来会左右镜像。
    RW.state.flipZ = flipZ;
    RW.state.flipX = flipX;

    // 导入是「替换当前内容」而不是叠加上去 —— 记一份整体快照，撤销时整张还原
    var before = RW.snapshotState();
    if (!opts.keepExisting) {
      RW.state.buildings = [];
      RW.state.floors = {};
      RW.state.lockedFloors = {};
      RW.state.selection = {};
    }
    RW.setGrid(W, H, true);

    var placed = 0, failed = 0, failReasons = {}, nudged = 0, plannedCount = 0;
    var lock = opts.lockImported !== false;   // 默认把存档原有建筑锁起来（导出时排除）

    bs.forEach(function (b) {
      var def = Data.byId[b.defId];
      var fp = def ? RW.footprint(def, b.rot) : [1, 1];
      // 存档里的 pos 是占地矩形「居中」的那一格：最小角 = pos - (尺寸-1)/2。
      // 先把 pos 换算回占地区域的最小角（游戏坐标），再映射成编辑器的左上角。
      var Ri2 = (Math.round((b.rot || 0) / 90) % 4 + 4) % 4;   // 朝向（编辑器 = 游戏，已不再加 180°）
      var Rg = (def && def.rotatable === false) ? 0 : Ri2;
      var off2 = RW.anchorOffset(Rg, fp[0], fp[1]);
      var minXg = b.x - off2.x, minZg = b.z - off2.z;   // 占地区域最小角（游戏坐标）
      // 候选位置全部在「游戏坐标」里算，翻转只在放下前做一次。
      var cands = [[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1]];

      var done = false, why = '';
      for (var ci = 0; ci < cands.length && !done; ci++) {
        var gx = minXg + cands[ci][0], gz = minZg + cands[ci][1];
        var x = flipX ? (W - 1 - (gx + fp[0] - 1)) : gx;
        var z = flipZ ? (H - 1 - (gz + fp[1] - 1)) : gz;
        var r = RW.placeBuilding(b.defId, x, z, b.rot, { stuff: b.stuff, ignoreTerrain: true });
        if (r.ok) {
          done = true; placed++; if (ci > 0) nudged++;
          r.b.planned = !!b.planned;
          r.b.src = 'save';
          r.b.locked = lock;
        } else why = r.why || '未知原因';
      }
      if (!done) { failed++; failReasons[why] = (failReasons[why] || 0) + 1; }
      else if (b.planned) plannedCount++;
    });
    // 地板蓝图 → 地板层（也标成存档原有）
    var floorCount = 0;
    RW.state.lockedFloors = RW.state.lockedFloors || {};
    (result.floors || []).forEach(function (f) {
      var sx = flipX ? (W - 1 - f.x) : f.x;
      var sz = flipZ ? (H - 1 - f.z) : f.z;
      if (sx < 0 || sz < 0 || sx >= W || sz >= H) return;
      RW.state.floors[RW.key(sx, sz)] = f.floorId;
      if (f.planned) (RW.state.plannedFloors = RW.state.plannedFloors || {})[RW.key(sx, sz)] = f.forbidden ? 2 : 1;
      if (lock) RW.state.lockedFloors[RW.key(sx, sz)] = true;
      floorCount++;
    });

    // 地图图层（地形 / 山体 / 屋顶）+ 玩家区域 + 存档情报
    RW.state.terrain = result.layers ? result.layers.terrain : null;
    RW.state.rocks = result.layers ? result.layers.rocks : null;
    RW.state.roofs = result.layers ? result.layers.roofs : null;
    RW.state.home = result.home || null;
    RW.state.terrainReady = !!(result.layers && result.layers.terrain);
    if (RW.state.layers) {
      RW.state.layers.terrain = !!result.layers;
      RW.state.layers.home = !!result.home;
    }
    var res = result.resources || { all: {}, home: {}, hasHome: false };
    RW.state.saveInfo = {
      version: result.version, difficulty: result.difficulty,
      pawns: result.pawns || [], research: result.research || null,
      resources: res.hasHome ? res.home : res.all,     // 估算默认用玩家区域内库存
      resourcesHome: res.home || {}, resourcesAll: res.all || {},
      hasHome: !!res.hasHome,
      colonyName: result.colonyName || '',
      factionRefs: result.factionRefs || []
    };
    if (result.colonyName && (!RW.state.mapName || /未命名/.test(RW.state.mapName))) {
      RW.state.mapName = result.colonyName;
    }
    if (RW.terrainDirty) RW.terrainDirty();

    RW.pushHistory({ all: { from: before, to: RW.snapshotState() } });
    RW.reindex(); RW.emit('change'); RW.fitContent();
    return {
      floors: floorCount,
      placed: placed, failed: failed, nudged: nudged, planned: plannedCount,
      failReasons: failReasons, unknown: result.unknown,
      mapSize: { w: W, h: H }, version: result.version,
      onOtherMap: result.onOtherMap,
      terrain: result.layers ? result.layers.terrain : null,
      rocks: result.layers ? result.layers.rocks : null,
      home: result.home || null,
      colonyName: result.colonyName || '',
      pawns: (result.pawns || []).length,
      resources: Object.keys(res.hasHome ? res.home : res.all).length,
      resourcesAll: Object.keys(res.all || {}).length,
      locked: lock ? placed : 0
    };
  }

  global.RWIo = {
    loadStore: loadStore, saveStore: saveStore, saveNamed: saveNamed, deleteNamed: deleteNamed,
    saveSettings: saveSettings, loadSettings: loadSettings, lsAvailable: lsAvailable,
    parseSave: parseSave, importFromSave: importFromSave, matchDef: matchDef
  };
})(typeof window !== 'undefined' ? window : globalThis);
