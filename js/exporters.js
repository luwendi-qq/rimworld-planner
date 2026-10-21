/*
 * exporters.js —— 导出
 *   - Blueprints 模组的蓝图 .xml（真建造指令，小人会消耗材料开建）
 *   - 工程 JSON（完整保真，可再次打开）
 *   - PNG 图片
 */
(function (global) {
  'use strict';

  var RW = global.RW, Data = global.RWData;

  /** 编辑器 z ↔ 游戏 z。游戏里 +z 是北（屏幕上方），本编辑器 z 向下，所以要翻过来。 */
  function mapZ(z) {
    return RW.state.flipZ ? (RW.state.rows - 1 - z) : z;
  }

  // ------------------------------------------------ 下载 / 读取文件
  function download(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  function readFile(file) {
    return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () { res(fr.result); };
      fr.onerror = rej;
      fr.readAsText(file);
    });
  }

  function escapeXml(str) {
    return String(str).replace(/[<>&'"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c];
    });
  }

  // ------------------------------------------------ Blueprints 模组（真蓝图）
  // 文件位置：<存档数据目录>/Blueprints/<名字>.xml
  // 结构：<Blueprint> 里 <BuildableThings> 列出每件要建的东西
  //   <li><ThingDef>Wall</ThingDef><Stuff>BlocksSandstone</Stuff><Position>(x,0,z)</Position><Rotation>1</Rotation></li>
  // 地板用 <TerrainDef>。Position 是相对于蓝图原点的偏移。
  var STUFF_DEF = {
    stone: 'BlocksSandstone', wood: 'WoodLog', steel: 'Steel',
    silver: 'Silver', gold: 'Gold', plasteel: 'Plasteel', uranium: 'Uranium'
  };
  var FLOOR_TERRAIN = {
    wood: 'WoodFloor', stone: 'TileSandstone', concrete: 'Concrete',
    steel: 'PavedTile', sterile: 'SterileTile', carpet: 'CarpetRed', paved: 'PavedTile',
    bridge: 'Bridge'
  };

  /** 本库地板 id → 游戏 TerrainDef（优先用数据里的 def 字段，更准） */
  function floorTerrainOf(id) {
    if (id === 'none' || id === 'water' || id === 'tileAncient') return null;  // 非玩家可建造/仅观感
    var f = Data.floorsById && Data.floorsById[id];
    if (f && f.def) return f.def;
    return FLOOR_TERRAIN[id] || null;
  }

  /** 本库条目 → 游戏 defName */
  function gameDefName(def) {
    if (!def) return null;
    if (def.def) return def.def;
    if (def.en && /^[A-Za-z][A-Za-z0-9_]*$/.test(def.en)) return def.en;
    return null;
  }

  /**
   * 生成 Blueprints 模组用的蓝图 XML。
   * 结构与真实导出文件一致（根 <Blueprint>，内含 <meta> 和一层同名 <Blueprint>）：
   *   <Blueprint><meta>…</meta><Blueprint>
   *     <BuildableThings><li><ThingDef/><Stuff/><Position/></li>…</BuildableThings>
   *     <Name/><Category/><Size/></Blueprint></Blueprint>
   * Rotation 总是写出（整数 0-3），Size 是二维 (w, h)。
   */
  /**
   * 把工程换算成「游戏坐标 + 朝向」的条目（蓝图 XML 和 build-ops 共用）。
   *
   * 坐标换算只在这里做一次：编辑器 z 向下、游戏 +z 向北，所以要翻；
   * 多格建筑再按 GenAdj.OccupiedRect 从「最小角」换成游戏里的 Position。
   * 两条导出路径都吃这份结果，避免哪天改了一边、另一边忘了。
   *
   * @returns {{entries:Array, skipped:Object, lockedSkipped:number}}
   *          entries[i] = {terrain} 或 {defName, stuff, x, z, rot}（全是游戏坐标）
   */
  function blueprintEntries(state, opts) {
    opts = opts || {};
    var stuff = STUFF_DEF[opts.stuff || 'stone'] || null;
    var entries = [], skipped = {}, lockedSkipped = 0;
    var excludeLocked = opts.excludeLocked !== false;

    if (opts.floors !== false) {
      Object.keys(state.floors).forEach(function (k) {
        if (excludeLocked && state.lockedFloors && state.lockedFloors[k]) { lockedSkipped++; return; }
        var t = floorTerrainOf(state.floors[k]);
        if (!t) return;
        var p = k.split(',');
        entries.push({ terrain: t, x: +p[0], z: mapZ(+p[1]) });
      });
    }

    var flipX = state.flipX, flipZ = state.flipZ !== false;
    state.buildings.forEach(function (b) {
      if (excludeLocked && b.locked) { lockedSkipped++; return; }
      var def = Data.byId[b.defId];
      var dn = gameDefName(def);
      if (!dn) { skipped[def ? def.name : b.defId] = (skipped[def ? def.name : b.defId] || 0) + 1; return; }
      // 编辑器朝向 = 游戏朝向（坐标系做了 Z 翻转，方向语义一致，不需要再加 180°）
      var rot = (Math.round((b.rot || 0) / 90) % 4 + 4) % 4;
      // 不可旋转的建筑（发电机/太阳能/地热…）游戏永远按 0 放
      if (def && def.rotatable === false) rot = 0;
      var fp = RW.footprint(def, b.rot);        // 旋转后的占地尺寸（编辑器坐标系）
      var w = fp[0], h = fp[1];
      // 占地区域在「游戏坐标系」里的最小角
      var minX = flipX ? (state.cols - 1 - (b.x + w - 1)) : b.x;
      var minZ = flipZ ? (state.rows - 1 - (b.z + h - 1)) : b.z;
      // 再按游戏规则（GenAdj.OccupiedRect）把「最小角」换成 pos
      var off = RW.anchorOffset(rot, w, h);
      // 逐物品材质：优先用这个建筑自己的 stuff，没有就退回全局选择
      var bStuff = b.stuff || (def && def.stuff ? stuff : null);
      entries.push({
        defName: dn,
        stuff: (def && def.stuffCats && def.stuffCats.length) ? bStuff : null,
        x: minX + off.x, z: minZ + off.z,
        rot: rot
      });
    });

    return { entries: entries, skipped: skipped, lockedSkipped: lockedSkipped };
  }

  function toBlueprintsXML(state, opts) {
    opts = opts || {};
    var packed = blueprintEntries(state, opts);
    var entries = packed.entries, skipped = packed.skipped, lockedSkipped = packed.lockedSkipped;

    if (!entries.length) return { xml: '', count: 0, skipped: skipped, lockedSkipped: lockedSkipped };

    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    entries.forEach(function (e) {
      minX = Math.min(minX, e.x); minZ = Math.min(minZ, e.z);
      maxX = Math.max(maxX, e.x); maxZ = Math.max(maxZ, e.z);
    });

    // meta：优先复用导入存档里的 mod 列表，这样游戏不会报「缺少 mod」
    var meta = opts.meta || {};
    var modIds = meta.modIds && meta.modIds.length ? meta.modIds : ['brrainz.harmony', 'ludeon.rimworld', 'nova.blueprints.waylith17'];
    var modSteam = meta.modSteamIds && meta.modSteamIds.length ? meta.modSteamIds : modIds.map(function () { return '0'; });
    var modNames = meta.modNames && meta.modNames.length ? meta.modNames : ['Harmony', 'Core', 'Blueprints - 1.7 Waylith (Unofficial)'];
    while (modSteam.length < modIds.length) modSteam.push('0');
    while (modNames.length < modIds.length) modNames.push('');

    var T = '\t';
    var L = [];
    L.push('<?xml version="1.0" encoding="utf-8"?>');
    L.push('<Blueprint>');
    L.push(T + '<meta>');
    L.push(T + T + '<gameVersion>' + escapeXml(opts.gameVersion || meta.gameVersion || '') + '</gameVersion>');
    L.push(T + T + '<modIds>');
    modIds.forEach(function (x) { L.push(T + T + T + '<li>' + escapeXml(x) + '</li>'); });
    L.push(T + T + '</modIds>');
    L.push(T + T + '<modSteamIds>');
    modSteam.forEach(function (x) { L.push(T + T + T + '<li>' + escapeXml(x) + '</li>'); });
    L.push(T + T + '</modSteamIds>');
    L.push(T + T + '<modNames>');
    modNames.forEach(function (x) { L.push(T + T + T + '<li>' + escapeXml(x) + '</li>'); });
    L.push(T + T + '</modNames>');
    L.push(T + '</meta>');
    L.push(T + '<Blueprint>');
    L.push(T + T + '<BuildableThings>');
    entries.forEach(function (e) {
      L.push(T + T + T + '<li>');
      if (e.terrain) {
        L.push(T + T + T + T + '<TerrainDef>' + escapeXml(e.terrain) + '</TerrainDef>');
      } else {
        L.push(T + T + T + T + '<ThingDef>' + escapeXml(e.defName) + '</ThingDef>');
        if (e.stuff) L.push(T + T + T + T + '<Stuff>' + escapeXml(e.stuff) + '</Stuff>');
      }
      L.push(T + T + T + T + '<Position>(' + (e.x - minX) + ', 0, ' + (e.z - minZ) + ')</Position>');
      L.push(T + T + T + T + '<Rotation>' + (e.terrain ? 0 : e.rot) + '</Rotation>');
      L.push(T + T + T + '</li>');
    });
    L.push(T + T + '</BuildableThings>');
    L.push(T + T + '<Name>' + escapeXml(opts.name || state.mapName || 'layout') + '</Name>');
    L.push(T + T + '<Category>' + escapeXml(opts.category || '布局') + '</Category>');
    L.push(T + T + '<Size>(' + (maxX - minX + 1) + ', ' + (maxZ - minZ + 1) + ')</Size>');
    L.push(T + '</Blueprint>');
    L.push('</Blueprint>');
    // 与真实文件一致：带 BOM + CRLF
    return {
      xml: '\uFEFF' + L.join('\r\n') + '\r\n',
      count: entries.length, skipped: skipped, lockedSkipped: lockedSkipped,
      w: maxX - minX + 1, h: maxZ - minZ + 1
    };
  }

  global.RWExport = {
    toBlueprintsXML: toBlueprintsXML, blueprintEntries: blueprintEntries, gameDefName: gameDefName,
    download: download, readFile: readFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
