/*
 * site.js —— 存档地形 / 山体 / 可建造性
 *
 * 从 .rws 读出来的地形和山体是两张「格子图」，这里负责：
 *   · 查某一格是什么地形、上面有没有山体/矿石、头顶是不是厚岩层
 *   · 判断某个建筑/地板能不能放在这里（地形 affordance 检查，和游戏 GenConstruct 一致）
 *   · 把地形/山体烤成离屏画布，画布层直接按格缩放贴上去（几万格也不卡）
 *
 * affordance 的含义（来自游戏 TerrainAffordanceDefs）：
 *   Light  < Medium < Heavy   —— 由弱到强，重型建筑（墙等）要求 Heavy
 *   Bridgeable / WaterproofConduitable / ShallowWater / MovingFluid / Diggable / GrowSoil / SmoothableStone
 * 沼泽（MarshyTerrain）只有 Light，所以放不了墙；泥地/深水什么都没有，只能先铺桥/地基。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  function state() { return global.RW && global.RW.state; }

  function terrainAt(x, z) {
    var s = state();
    if (!s || !s.terrain || !s.terrain.cells) return null;
    if (x < 0 || z < 0 || x >= s.terrain.w || z >= s.terrain.h) return null;
    var v = s.terrain.cells[z * s.terrain.w + x];
    if (!v) return null;
    var def = s.terrain.defs[v] || null;
    if (!def) return { def: '#' + v, name: '未知地形', color: '#6b6b6b', aff: [], unknown: true };
    return Data.terrain(def);
  }

  function rockAt(x, z) {
    var s = state();
    if (!s || !s.rocks || !s.rocks.cells) return null;
    if (x < 0 || z < 0 || x >= s.rocks.w || z >= s.rocks.h) return null;
    var v = s.rocks.cells[z * s.rocks.w + x];
    if (!v) return null;
    var def = s.rocks.defs[v] || null;
    if (!def) return null;
    return Data.rock(def) || { def: def, name: def, hp: 400, mineableThing: null, yield: 1 };
  }

  /** 屋顶：0 无 / 1 建造 / 2 薄岩顶 / 3 厚岩顶 */
  function roofAt(x, z) {
    var s = state();
    if (!s || !s.roofs || !s.roofs.cells) return 0;
    if (x < 0 || z < 0 || x >= s.roofs.w || z >= s.roofs.h) return 0;
    var v = s.roofs.cells[z * s.roofs.w + x];
    return (s.roofs.kind && s.roofs.kind[v]) || 0;
  }

  /** 建筑需要的地形 affordance：优先 def.aff；写了 useStuffTerrainAffordance 的看材质 */
  function requiredAff(def, stuff) {
    if (stuff) {
      var st = Data.stuffById ? Data.stuffById(stuff) : null;
      if (st && st.aff) return st.aff;
    }
    return (def && (def.aff || null)) || null;
  }

  /** 地板条目 + 从游戏数据补全的 terrain 元信息（造价/工时/affordance） */
  function floorMeta(id) {
    var f = Data.floorsById[id];
    if (!f) return null;
    var t = f.def ? Data.terrain(f.def) : null;
    return {
      id: id, name: f.name, color: (t && t.color) || f.color,
      def: f.def || null,
      needAff: f.aff || (t && t.need) || null,
      aff: (t && t.aff) || null,
      work: (t && (t.work != null)) ? t.work : (f.work || 0),
      cost: (t && t.cost) || f.cost || null,
      research: (t && t.research) || f.research || null,
      skillReq: f.skillReq || 0,
      dlc: f.dlc || (t && t.dlc) || null
    };
  }

  /**
   * 单格能不能放这个建筑。reason 会返回给预览/校验用。
   * 返回 { ok, why, kind }，kind: 'rock' 需要开采 / 'terrain' 地形不支持 / 'floor' 地板不支持
   */
  function cellCheck(def, stuff, x, z) {
    var s = state();
    if (!s) return { ok: true };
    // 山体/矿石：格子上有自然岩石，必须先开采（开采后会变成 X_RoughHewn 地形）
    var rk = rockAt(x, z);
    if (rk && !rk.removed) {
      return { ok: false, kind: 'rock', why: '这里是' + rk.name + '（山体/矿石），需要先开采' };
    }
    var t = terrainAt(x, z);
    if (!t) return { ok: true };
    var need = requiredAff(def, stuff);
    if (!need) return { ok: true };
    if (t.unknown) return { ok: true, warn: true };
    var aff = t.aff || [];
    if (aff.indexOf(need) < 0) {
      var where = t.name || t.def;
      return {
        ok: false, kind: 'terrain',
        why: '「' + where + '」撑不住这个建筑（需要 ' + need + '）'
      };
    }
    return { ok: true };
  }

  /** 检查一种建筑放在 (x,z) 的整个占地 */
  function checkBuilding(defId, x, z, rot, stuff) {
    var RW = global.RW;
    var def = Data.byId[defId];
    if (!def || !RW) return { ok: true };
    var fp = RW.footprint(def, rot);
    var bad = [], rocks = [], reasons = {};
    for (var i = 0; i < fp[0]; i++) {
      for (var j = 0; j < fp[1]; j++) {
        var c = cellCheck(def, stuff, x + i, z + j);
        if (c.ok) continue;
        (c.kind === 'rock' ? rocks : bad).push([x + i, z + j]);
        reasons[c.why] = (reasons[c.why] || 0) + 1;
      }
    }
    if (!bad.length && !rocks.length) return { ok: true };
    var first = Object.keys(reasons)[0] || '地形不支持';
    return { ok: false, why: first, reasons: reasons, cells: bad, rockCells: rocks, def: def };
  }

  /** 检查一块地板 */
  function checkFloor(floorId, x, z) {
    var meta = floorMeta(floorId);
    if (!meta) return { ok: true };
    if (!meta.needAff) return { ok: true };   // 土/水这种不可建造的「地板」直接跳过
    var rk = rockAt(x, z);
    if (rk) return { ok: false, kind: 'rock', why: '这里是' + rk.name + '，需要先开采' };
    var t = terrainAt(x, z);
    if (!t || t.unknown) return { ok: true };
    if ((t.aff || []).indexOf(meta.needAff) < 0) {
      return { ok: false, kind: 'terrain', why: '「' + (t.name || t.def) + '」铺不了这种地板（需要 ' + meta.needAff + '）' };
    }
    return { ok: true };
  }

  // ---------------------------------------------------------------- 颜色
  var WATER_COLORS = { WaterShallow: '#2b5c7d', WaterDeep: '#1b3a52', WaterOceanShallow: '#255273', WaterOceanDeep: '#14324a', WaterMovingShallow: '#2a6484', WaterMovingChestDeep: '#1f4c67' };

  function terrainColor(def, t) {
    if (WATER_COLORS[def]) return WATER_COLORS[def];
    if (t && t.color) return t.color;
    if (/Marsh|Mud|Marshy/i.test(def)) return '#3d4a32';
    if (/Lava/i.test(def)) return '#8a3a14';
    if (/Ice/i.test(def)) return '#b9d4dd';
    if (/RoughHewn/i.test(def)) return '#514f4c';
    if (/_Rough/i.test(def)) return '#3a3733';
    if (/_Smooth/i.test(def)) return '#6a6660';
    if (/Soil/i.test(def)) return '#4a4034';
    if (/Sand/i.test(def)) return '#b6a077';
    if (/Gravel|PackedDirt|Asphalt/i.test(def)) return '#5d5a52';
    return '#6b6b6b';
  }

  // ---------------------------------------------------------------- 离屏画布
  var terrainCv = null, rockCv = null, homeCv = null, built = 0;

  function ensureCanvas(w, h) {
    if (!terrainCv) terrainCv = document.createElement('canvas');
    if (!rockCv) rockCv = document.createElement('canvas');
    if (!homeCv) homeCv = document.createElement('canvas');
    if (terrainCv.width !== w || terrainCv.height !== h) {
      terrainCv.width = w; terrainCv.height = h;
      rockCv.width = w; rockCv.height = h;
      homeCv.width = w; homeCv.height = h;
      terrainCv._at = 0; rockCv._at = 0; homeCv._at = 0;
    }
  }

  /** 把地形/山体/玩家区域烤成 1 像素/格的画布（只在地图变化时重建） */
  function buildCanvases() {
    var s = state();
    if (!s || !s.terrain || !s.terrain.cells) { terrainCv = rockCv = homeCv = null; built = 0; return; }
    if (terrainCv && built === s.importStamp) return;
    var w = s.terrain.w, h = s.terrain.h;
    ensureCanvas(w, h);
    var tctx = terrainCv.getContext('2d');
    var img = tctx.createImageData(w, h);
    var px = img.data;
    var cells = s.terrain.cells;
    for (var i = 0; i < w * h; i++) {
      var v = cells[i];
      var col = '#2a2c26';
      if (v) {
        var def = s.terrain.defs[v];
        var t = def ? Data.terrain(def) : null;
        col = terrainColor(def || ('#' + v), t);
      }
      var o = i * 4;
      px[o] = parseInt(col.slice(1, 3), 16);
      px[o + 1] = parseInt(col.slice(3, 5), 16);
      px[o + 2] = parseInt(col.slice(5, 7), 16);
      px[o + 3] = 255;
    }
    tctx.putImageData(img, 0, 0);

    // 山体：深色 + 斜纹（一眼看出「这里要开采」）
    var rctx = rockCv.getContext('2d');
    rctx.clearRect(0, 0, w, h);
    if (s.rocks && s.rocks.cells) {
      var rc = s.rocks.cells;
      var rimg = rctx.createImageData(w, h);
      var rp = rimg.data;
      for (var k = 0; k < w * h; k++) {
        var rv = rc[k];
        if (!rv) continue;
        var rdef = s.rocks.defs[rv];
        var rock = rdef ? Data.rock(rdef) : null;
        var rcol = (rock && rock.color) || '#4a4744';
        var ro = k * 4;
        rp[ro] = parseInt(rcol.slice(1, 3), 16);
        rp[ro + 1] = parseInt(rcol.slice(3, 5), 16);
        rp[ro + 2] = parseInt(rcol.slice(5, 7), 16);
        rp[ro + 3] = 235;
      }
      rctx.putImageData(rimg, 0, 0);
      // 斜纹
      rctx.save();
      rctx.globalCompositeOperation = 'source-atop';
      rctx.strokeStyle = 'rgba(0,0,0,0.35)';
      rctx.lineWidth = 0.5;
      for (var d = -h; d < w; d += 4) {
        rctx.beginPath(); rctx.moveTo(d, 0); rctx.lineTo(d + h, h); rctx.stroke();
      }
      rctx.restore();
    }
    // 玩家活动区域：淡绿填充 + 边界线（1px/格，缩放后仍是细线）
    var hctx = homeCv.getContext('2d');
    hctx.clearRect(0, 0, w, h);
    if (s.home && s.home.cells) {
      var hc = s.home.cells;
      var himg = hctx.createImageData(w, h);
      var hp = himg.data;
      for (var q = 0; q < w * h; q++) {
        if (!hc[q]) continue;
        var qo = q * 4;
        hp[qo] = 110; hp[qo + 1] = 220; hp[qo + 2] = 150; hp[qo + 3] = 26;
      }
      hctx.putImageData(himg, 0, 0);
      // 只画边界：上下左右邻居不在区域内时才描边
      hctx.strokeStyle = 'rgba(120,235,170,0.55)';
      hctx.lineWidth = 1;
      hctx.beginPath();
      for (var hz = 0; hz < h; hz++) {
        for (var hx = 0; hx < w; hx++) {
          var hi = hz * w + hx;
          if (!hc[hi]) continue;
          if (hz === 0 || !hc[hi - w]) { hctx.moveTo(hx, hz); hctx.lineTo(hx + 1, hz); }
          if (hz === h - 1 || !hc[hi + w]) { hctx.moveTo(hx, hz + 1); hctx.lineTo(hx + 1, hz + 1); }
          if (hx === 0 || !hc[hi - 1]) { hctx.moveTo(hx, hz); hctx.lineTo(hx, hz + 1); }
          if (hx === w - 1 || !hc[hi + 1]) { hctx.moveTo(hx + 1, hz); hctx.lineTo(hx + 1, hz + 1); }
        }
      }
      hctx.stroke();
    }
    built = s.importStamp;
  }

  function terrainDirty() {
    var s = state();
    if (s) s.importStamp = (s.importStamp || 0) + 1;
    built = -1;
  }

  function canvases() {
    buildCanvases();
    return { terrain: terrainCv, rock: rockCv, home: homeCv };
  }

  // ---------------------------------------------------------------- 统计
  function summarize() {
    var s = state();
    var out = { total: 0, rock: 0, marsh: 0, water: 0, heavy: 0, byDef: {} };
    if (!s || !s.terrain || !s.terrain.cells) return out;
    var w = s.terrain.w, h = s.terrain.h, cells = s.terrain.cells;
    out.total = w * h;
    for (var i = 0; i < w * h; i++) {
      var v = cells[i];
      if (!v) continue;
      var def = s.terrain.defs[v];
      var t = def ? Data.terrain(def) : null;
      var a = (t && t.aff) || [];
      if (a.indexOf('Heavy') >= 0) out.heavy++;
      if (t && t.isWater) out.water++;
      if (def && /Marsh|Marshy|Mud/i.test(def)) out.marsh++;
      out.byDef[def || ('#' + v)] = (out.byDef[def || ('#' + v)] || 0) + 1;
      if (s.rocks && s.rocks.cells) {
        var rv = s.rocks.cells[i];
        if (rv) { out.rock++; out.byDef['⛏' + (s.rocks.defs[rv] || 'rock')] = (out.byDef['⛏' + (s.rocks.defs[rv] || 'rock')] || 0) + 1; }
      }
    }
    return out;
  }

  global.RWSite = {
    terrainAt: terrainAt, rockAt: rockAt, roofAt: roofAt,
    requiredAff: requiredAff, floorMeta: floorMeta,
    cellCheck: cellCheck, checkBuilding: checkBuilding, checkFloor: checkFloor,
    terrainColor: terrainColor,
    canvases: canvases, terrainDirty: terrainDirty, buildCanvases: buildCanvases,
    summarize: summarize
  };
})(typeof window !== 'undefined' ? window : globalThis);
