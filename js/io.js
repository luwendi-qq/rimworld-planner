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
   */
  function parseSave(text) {
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
                     planned: planned, stuff: stuff });
      }
    }
    return {
      buildings: found, floors: floors, unknown: unknown, skipped: skipped, onOtherMap: onOtherMap,
      mapSize: mapSize, mapSizes: mapSizes, mapIndex: curIdx, version: version, meta: metaInfo
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

    // 先备份一次撤销点，再清空画布：导入是「替换当前内容」而不是叠加上去
    RW.pushHistory();
    if (!opts.keepExisting) {
      RW.state.buildings = [];
      RW.state.floors = {};
      RW.state.selection = {};
    }
    RW.setGrid(W, H, true);

    var placed = 0, failed = 0, failReasons = {}, nudged = 0, plannedCount = 0;

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
        var r = RW.placeBuilding(b.defId, x, z, b.rot, { stuff: b.stuff });
        if (r.ok) { done = true; placed++; if (ci > 0) nudged++; r.b.planned = !!b.planned; }
        else why = r.why || '未知原因';
      }
      if (!done) { failed++; failReasons[why] = (failReasons[why] || 0) + 1; }
      else if (b.planned) plannedCount++;
    });
    // 地板蓝图 → 地板层
    var floorCount = 0;
    (result.floors || []).forEach(function (f) {
      var sx = flipX ? (W - 1 - f.x) : f.x;
      var sz = flipZ ? (H - 1 - f.z) : f.z;
      if (sx < 0 || sz < 0 || sx >= W || sz >= H) return;
      RW.state.floors[RW.key(sx, sz)] = f.floorId;
      if (f.planned) (RW.state.plannedFloors = RW.state.plannedFloors || {})[RW.key(sx, sz)] = f.forbidden ? 2 : 1;
      floorCount++;
    });

    RW.reindex(); RW.emit('change'); RW.fitContent();
    return {
      floors: floorCount,
      placed: placed, failed: failed, nudged: nudged, planned: plannedCount,
      failReasons: failReasons, unknown: result.unknown,
      mapSize: { w: W, h: H }, version: result.version,
      onOtherMap: result.onOtherMap
    };
  }

  global.RWIo = {
    loadStore: loadStore, saveStore: saveStore, saveNamed: saveNamed, deleteNamed: deleteNamed,
    saveSettings: saveSettings, loadSettings: loadSettings, lsAvailable: lsAvailable,
    parseSave: parseSave, importFromSave: importFromSave, matchDef: matchDef
  };
})(typeof window !== 'undefined' ? window : globalThis);
