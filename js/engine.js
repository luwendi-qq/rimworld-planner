/*
 * engine.js —— 状态、模型、渲染与交互
 */
(function (global) {
  'use strict';

  var Data = global.RWData;
  var Art = global.RWArt;

  // ---------------------------------------------------------------- 状态
  var state = {
    cols: 250,
    rows: 250,
    cam: { ox: 0, oy: 0, cell: 26 },
    buildings: [],
    floors: {},          // "x,z" -> floorId
    plannedFloors: {},   // "x,z" -> 1=规划中(蓝图) 2=规划中但被禁用
    lockedFloors: {},    // "x,z" -> true（存档原有地板，导出时排除）
    areas: {},           // "x,z" -> areaId（区域规划层，仅本工具）
    nextUid: 1,
    selection: {},       // uid -> true（建筑）
    floorSelection: {},  // "x,z" -> true（地板，框选后可整片删）
    tool: 'place',       // place | select | erase | move | pan
    drawMode: 'brush',   // brush(自由) | rect(方框) | rectFill(填充)
    brush: null,         // {kind:'building'|'floor', id, stuff}
    lastStuff: {},       // defId -> 上次选的材质（和游戏一样记住）
    rotation: 0,
    flip: false,
    layers: { grid: true, floors: true, buildings: true, power: false, rooms: false, zones: true, terrain: true, blocked: false, home: true },
    hover: null,
    marquee: null,
    drag: null,
    paste: null,         // {items:[...], floors:[...], at:{x,z}}
    history: [],
    future: [],
    issues: [],
    roomInfo: [],
    powerInfo: null,
    // 与游戏视角一致：游戏里 +z 是北（屏幕上方），本编辑器 z 向下，导入/导出时翻转 Z
    flipZ: true,
    planColor: 'Structure_White',
    mapName: '未命名布局',
    // ---- 存档带出来的地图信息 ----
    terrain: null,       // { w,h,cells:Uint16Array, defs:{} }
    rocks: null,         // { w,h,cells, defs }
    roofs: null,         // { w,h,cells, kind }
    home: null,          // { w,h,cells:Uint16Array(0/1), count } 玩家活动区域
    terrainReady: false,
    importStamp: 0,
    saveInfo: null,      // { version, difficulty, pawns, research, resources }
    respectTerrain: true, // 放置时按地形校验
    strictTerrain: false, // true=地形不满足直接拒绝；false=允许先规划、只警告
    useHomeStock: true    // 库存只统计玩家活动区域（Area_Home）
  };

  var listeners = {};
  function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
  function emit(ev, payload) { (listeners[ev] || []).forEach(function (f) { f(payload); }); }

  // ---------------------------------------------------------------- 工具函数
  function key(x, z) { return x + ',' + z; }

  function footprint(def, rot) {
    var w = def.size[0], h = def.size[1];
    // 游戏里不可旋转的建筑永远按 Rotation=0 摆放，编辑器也不该换尺寸
    if (def.rotatable === false) return [w, h];
    return (rot % 180 === 0) ? [w, h] : [h, w];
  }

  function defOf(b) { return Data.byId[b.defId]; }

  function cellsOf(b) {
    var def = defOf(b); if (!def) return [];
    var fp = footprint(def, b.rot), out = [];
    for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) out.push([b.x + i, b.z + j]);
    return out;
  }

  function inBounds(x, z) { return x >= 0 && z >= 0 && x < state.cols && z < state.rows; }

  // 建立「格 -> 建筑」索引
  function buildIndex() {
    var idx = {};
    state.buildings.forEach(function (b) {
      cellsOf(b).forEach(function (c) {
        var k = key(c[0], c[1]);
        (idx[k] = idx[k] || []).push(b);
      });
    });
    return idx;
  }

  var INDEX = {};
  function reindex() { INDEX = buildIndex(); }

  function indexAdd(b) {
    var def = defOf(b); if (!def) return;
    var fp = footprint(def, b.rot);
    for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
      var k = key(b.x + i, b.z + j);
      (INDEX[k] = INDEX[k] || []).push(b);
    }
  }
  function indexRemove(b) {
    var def = defOf(b); if (!def) return;
    var fp = footprint(def, b.rot);
    for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
      var list = INDEX[key(b.x + i, b.z + j)];
      if (!list) continue;
      var n = list.indexOf(b);
      if (n >= 0) list.splice(n, 1);
    }
  }

  function buildingsAt(x, z) { return INDEX[key(x, z)] || []; }

  // ---------------------------------------------------------------- 材质（逐物品）
  /** 某个建筑能用的材质列表（按游戏 stuffCategories 过滤，按 commonality 降序） */
  function stuffsFor(def) { return Data.stuffsFor(def); }
  function stuffById(id) { return Data.stuffById(id); }
  /** 新放这个建筑时用什么材质：优先「上次给这个建筑选过的」，否则取最常用的那种 */
  function defaultStuff(def) {
    if (!def || !def.stuffCats || !def.stuffCats.length) return null;
    if (state.lastStuff && state.lastStuff[def.id]) return state.lastStuff[def.id];
    var list = stuffsFor(def);
    return list.length ? list[0].id : null;
  }
  function setStuffOf(defId, stuff) {
    if (!state.lastStuff) state.lastStuff = {};
    state.lastStuff[defId] = stuff || null;
  }

  // ---------------------------------------------------------------- 门的朝向
  // 游戏里 Building_Door 自己算朝向（只可能是北/东），存档里的 rot 对门无效。
  // AlignQualityAgainst：不可通行=9，另一扇门=1，其余=0
  function doorQualityAt(x, z) {
    var list = INDEX[key(x, z)];
    if (!list) return 0;
    var best = 0;
    for (var i = 0; i < list.length; i++) {
      var d = defOf(list[i]);
      if (!d) continue;
      if (d.door) return 1;
      if (d.tags.indexOf('solid') >= 0) best = 9;
    }
    return best;
  }
  function doorRotAt(x, z) {
    var num = doorQualityAt(x + 1, z) + doorQualityAt(x - 1, z);
    var num2 = doorQualityAt(x, z - 1) + doorQualityAt(x, z + 1);
    return num >= num2 ? 0 : 90;
  }

  /** 两个建筑能否共存同一格
   *  - under（电缆）：可以埋在任何建筑下面，永远共存
   *  - onwall（壁灯 / 制冷机 / 通风口等）：可以贴着实心建筑
   */
  function coexist(a, b) {
    if (a.tags.indexOf('under') >= 0 || b.tags.indexOf('under') >= 0) return true;
    var ao = a.tags.indexOf('onwall') >= 0, bo = b.tags.indexOf('onwall') >= 0;
    if (ao && bo) return true;
    var as = a.tags.indexOf('solid') >= 0, bs = b.tags.indexOf('solid') >= 0;
    if (ao && bs) return true;
    if (bo && as) return true;
    return false;
  }

  /** 找出会被新建筑占掉的位置上的既有建筑（可共存的除外） */
  function victimsAt(def, x, z, rot, ignoreUid) {
    var fp = footprint(def, rot), out = [];
    for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
      var list = buildingsAt(x + i, z + j);
      for (var n = 0; n < list.length; n++) {
        var b = list[n];
        if (b.uid === ignoreUid || out.indexOf(b) >= 0) continue;
        var od = defOf(b);
        if (od && coexist(def, od)) continue;
        out.push(b);
      }
    }
    return out;
  }

  /** 地形/山体检查（没导入存档地形时永远通过） */
  function terrainIssue(defId, x, z, rot, stuff) {
    if (!state.respectTerrain || !global.RWSite) return null;
    if (!state.terrain && !state.rocks) return null;
    return global.RWSite.checkBuilding(defId, x, z, rot, stuff);
  }
  function siteBlock(defId, x, z, rot, stuff, ignoreTerrain) {
    if (ignoreTerrain) return null;
    var s = terrainIssue(defId, x, z, rot, stuff);
    // 默认只警告（允许先把蓝图画在山体/沼泽上，再按估算决定挖不挖）；
    // 勾了「严格模式」才会直接拒绝放置。
    if (s && !s.ok && state.strictTerrain) return s;
    return null;
  }

  /**
   * 判定能否放置（不再有「原地替换」：冲突就拒绝，避免误删东西）
   */
  function canPlace(defId, x, z, rot, ignoreUid, stuff, ignoreTerrain) {
    var def = Data.byId[defId]; if (!def) return { ok: false, why: '未知建筑' };
    var fp = footprint(def, rot);
    if (x < 0 || z < 0 || x + fp[0] > state.cols || z + fp[1] > state.rows)
      return { ok: false, why: '超出地图边界' };
    var site = siteBlock(defId, x, z, rot, stuff, ignoreTerrain);
    if (site && !site.ok) return site;
    var victims = victimsAt(def, x, z, rot, ignoreUid);
    if (victims.length) {
      var locked = victims.filter(function (b) { return b.locked; });
      if (locked.length) {
        return { ok: false, why: '这一格是存档原有建筑（已锁定），先解锁或删掉', victims: victims, locked: locked };
      }
      return { ok: false, why: '与「' + (defOf(victims[0]) || { name: '?' }).name + '」重合，先删掉那一格', victims: victims };
    }
    return { ok: true, terrain: terrainIssue(defId, x, z, rot, stuff) };
  }

  /** 放一个建筑。冲突直接失败，不会删除任何已有建筑。 */
  function placeBuilding(defId, x, z, rot, opts) {
    opts = opts || {};
    var def = Data.byId[defId];
    if (!def) return { ok: false, why: '未知建筑' };
    var fp = footprint(def, rot);
    if (x < 0 || z < 0 || x + fp[0] > state.cols || z + fp[1] > state.rows)
      return { ok: false, why: '超出地图边界' };
    var site = siteBlock(defId, x, z, rot, opts.stuff, opts.ignoreTerrain);
    if (site && !site.ok) return site;
    var victims = victimsAt(def, x, z, rot, opts.ignoreUid);
    if (victims.length) {
      var locked = victims.filter(function (b) { return b.locked; });
      if (locked.length) {
        return { ok: false, why: '这一格是存档原有建筑（已锁定），先解锁或删掉', victims: victims, locked: locked };
      }
      return { ok: false, why: '与「' + (defOf(victims[0]) || { name: '?' }).name + '」重合，先删掉那一格', victims: victims };
    }
    var b = { uid: state.nextUid++, defId: defId, x: x, z: z, rot: rot || 0, color: opts.color || null,
              stuff: (opts.stuff !== undefined) ? opts.stuff : defaultStuff(def) };
    if (opts.locked) b.locked = true;
    state.buildings.push(b);
    indexAdd(b);
    return { ok: true, b: b, replaced: 0 };
  }

  /** 批量放置（方框/填充一次性画很多格），历史只记一步；冲突的格子会被跳过 */
  function placeBatch(cells, defId, rot, opts) {
    opts = opts || {};
    var def = Data.byId[defId];
    if (!def) return { placed: 0, skipped: cells.length, failed: cells.length };
    var placed = 0, failed = 0, blocked = 0;
    cells.forEach(function (c) {
      var res = placeBuilding(def.id, c[0], c[1], rot, opts);
      if (res.ok) placed++;
      else if (res.victims) blocked++;
      else failed++;
    });
    return { placed: placed, replaced: 0, failed: failed, blocked: blocked };
  }

  // ---------------------------------------------------------------- 历史
  function snapshot() {
    return JSON.stringify({
      cols: state.cols, rows: state.rows,
      buildings: state.buildings,
      floors: state.floors, plannedFloors: state.plannedFloors,
      lockedFloors: state.lockedFloors,
      nextUid: state.nextUid
    });
  }
  function pushHistory() {
    state.history.push(snapshot());
    if (state.history.length > 120) state.history.shift();
    state.future.length = 0;
    emit('history');
  }
  function restore(json) {
    var s = JSON.parse(json);
    state.cols = s.cols; state.rows = s.rows;
    state.buildings = s.buildings;
    state.floors = s.floors || {};
    state.plannedFloors = s.plannedFloors || {};
    state.lockedFloors = s.lockedFloors || {};
    state.nextUid = s.nextUid;
    state.selection = {};
    reindex(); render(); emit('change');
  }
  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshot());
    restore(state.history.pop());
    emit('history');
  }
  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshot());
    restore(state.future.pop());
    emit('history');
  }

  // ---------------------------------------------------------------- 编辑操作
  function addBuilding(defId, x, z, rot, opts) {
    opts = opts || {};
    // 兼容旧行为：默认不替换（调用方要替换请用 placeBuilding / placeBatch）
    var res = placeBuilding(defId, x, z, rot, {
      ignoreUid: opts.ignoreUid, color: opts.color, stuff: opts.stuff,
      replace: opts.replace != null ? opts.replace : false
    });
    return res;
  }

  function removeBuilding(uid, force) {
    for (var i = 0; i < state.buildings.length; i++) {
      if (state.buildings[i].uid === uid) {
        if (state.buildings[i].locked && !force) return false;
        indexRemove(state.buildings[i]);
        state.buildings.splice(i, 1);
        return true;
      }
    }
    return false;
  }

  function removeAt(x, z, force) {
    var list = buildingsAt(x, z).slice();
    var removed = false;
    list.forEach(function (b) { if (removeBuilding(b.uid, force)) removed = true; });
    var k = key(x, z);
    if (state.floors[k] && (force || !(state.lockedFloors && state.lockedFloors[k]))) {
      delete state.floors[k];
      if (state.lockedFloors) delete state.lockedFloors[k];
      removed = true; reindex();
    }
    return removed;
  }

  /** 清空：默认保留存档原有的锁定建筑（底图），force=true 才全部清掉 */
  function clearAll(force) {
    pushHistory();
    if (force) {
      state.buildings = []; state.floors = {}; state.plannedFloors = {}; state.lockedFloors = {};
    } else {
      state.buildings = state.buildings.filter(function (b) { return b.locked; });
      var keep = {};
      Object.keys(state.lockedFloors || {}).forEach(function (k) { if (state.floors[k]) keep[k] = state.floors[k]; });
      state.floors = keep;
      state.plannedFloors = {};
      var lf = {};
      Object.keys(keep).forEach(function (k) { lf[k] = true; });
      state.lockedFloors = lf;
    }
    state.selection = {}; state.floorSelection = {};
    reindex(); render(); emit('change');
  }

  /** keepFloors=true 时保留地板选择（框选时建筑和地板是一起选中的） */
  function setSelection(uids, keepFloors) {
    state.selection = {};
    uids.forEach(function (u) { state.selection[u] = true; });
    if (!keepFloors) state.floorSelection = {};
    emit('change');
  }
  function selectedBuildings() {
    return state.buildings.filter(function (b) { return state.selection[b.uid]; });
  }
  /** 被选中的地板格（框选地板后可以整片删掉） */
  function selectedFloors() {
    var out = [];
    Object.keys(state.floorSelection || {}).forEach(function (k) {
      if (state.floors[k]) out.push({ key: k, id: state.floors[k] });
    });
    return out;
  }
  function selectionCount() {
    return { buildings: Object.keys(state.selection).length, floors: selectedFloors().length };
  }

  function deleteSelection() {
    var sel = Object.keys(state.selection).map(Number);
    var fl = selectedFloors();
    if (!sel.length && !fl.length) return;
    pushHistory();
    var removed = 0, blocked = 0;
    if (sel.length) {
      state.buildings = state.buildings.filter(function (b) {
        if (!state.selection[b.uid]) return true;
        if (b.locked) { blocked++; return true; }   // 存档原有建筑不删
        removed++; return false;
      });
    }
    fl.forEach(function (f) {
      if (state.lockedFloors && state.lockedFloors[f.key]) { blocked++; return; }
      delete state.floors[f.key]; removed++;
    });
    state.selection = {}; state.floorSelection = {};
    if (!removed) state.history.pop();
    reindex(); render(); emit('change');
    return { removed: removed, blocked: blocked };
  }

  function rotateSelection() {
    var sel = selectedBuildings();
    if (!sel.length) { state.rotation = (state.rotation + 90) % 360; emit('change'); render(); return; }
    pushHistory();
    var moved = 0;
    sel.forEach(function (b) {
      var def = defOf(b);
      if (def && def.rotatable === false) return;    // 游戏里不可旋转
      if (b.locked) return;                          // 存档原有建筑不动
      var nr = (b.rot + 90) % 360;
      var chk = canPlace(b.defId, b.x, b.z, nr, b.uid, b.stuff);
      if (chk.ok) { b.rot = nr; moved++; }
    });
    reindex(); render(); emit('change');
    return moved;
  }

  function copySelection() {
    var sel = selectedBuildings();
    if (!sel.length) return null;
    var minX = Infinity, minZ = Infinity;
    sel.forEach(function (b) { minX = Math.min(minX, b.x); minZ = Math.min(minZ, b.z); });
    var items = sel.map(function (b) {
      return { defId: b.defId, dx: b.x - minX, dz: b.z - minZ, rot: b.rot, color: b.color, stuff: b.stuff };
    });
    var flo = [];
    Object.keys(state.floors).forEach(function (k) {
      var p = k.split(','), fx = +p[0], fz = +p[1];
      if (fx >= minX && fz >= minZ) {
        var inside = sel.some(function (b) {
          var fp = footprint(defOf(b), b.rot);
          return fx >= b.x && fx < b.x + fp[0] && fz >= b.z && fz < b.z + fp[1];
        });
        if (inside) flo.push({ dx: fx - minX, dz: fz - minZ, id: state.floors[k] });
      }
    });
    return { items: items, floors: flo, w: 0, h: 0 };
  }

  function pasteAt(clip, ox, oz) {
    pushHistory();
    var made = [];
    clip.items.forEach(function (it) {
      var r = addBuilding(it.defId, ox + it.dx, oz + it.dz, it.rot, { stuff: it.stuff });
      if (r.ok) { r.b.color = it.color; made.push(r.b.uid); }
    });
    clip.floors.forEach(function (f) { state.floors[key(ox + f.dx, oz + f.dz)] = f.id; });
    reindex(); render(); emit('change');
    return made;
  }

  // ---------------------------------------------------------------- 渲染
  var cv, ctx, dpr = 1, cssW = 0, cssH = 0;

  function resize() {
    var rect = cv.getBoundingClientRect();
    dpr = global.devicePixelRatio || 1;
    cssW = rect.width; cssH = rect.height;
    cv.width = Math.max(1, Math.round(cssW * dpr));
    cv.height = Math.max(1, Math.round(cssH * dpr));
    render();
  }

  function screenToCell(sx, sy) {
    return { x: (sx - state.cam.ox) / state.cam.cell, z: (sy - state.cam.oy) / state.cam.cell };
  }
  /** 以屏幕上某个点为锚缩放（对齐游戏手感：按钮/滚轮都不会把视野甩到左上角） */
  function zoomAt(factor, sx, sy) {
    if (sx == null) sx = cssW / 2;
    if (sy == null) sy = cssH / 2;
    var before = screenToCell(sx, sy);
    state.cam.cell = Math.max(3, Math.min(80, state.cam.cell * factor));
    var after = screenToCell(sx, sy);
    state.cam.ox += (after.x - before.x) * state.cam.cell;
    state.cam.oy += (after.z - before.z) * state.cam.cell;
    render();
  }

  function cellAt(sx, sy) {
    var c = screenToCell(sx, sy);
    return { x: Math.floor(c.x), z: Math.floor(c.z) };
  }

  function fitView(pad, minCell) {
    pad = pad == null ? 24 : pad;
    // 250×250 的默认地图如果硬塞进窗口，每格只有 3 像素，网格根本看不见；
    // 所以给一个下限，放不下时就按这个缩放居中显示。
    minCell = minCell == null ? 7 : minCell;
    var cell = Math.min((cssW - pad * 2) / state.cols, (cssH - pad * 2) / state.rows);
    state.cam.cell = Math.max(minCell, Math.min(80, cell));
    state.cam.ox = (cssW - state.cols * state.cam.cell) / 2;
    state.cam.oy = (cssH - state.rows * state.cam.cell) / 2;
    render();
  }

  /** 进入时的默认视图：有东西就对准内容；空地图就按「一眼能看清网格」的缩放居中 */
  function homeView() {
    if (state.buildings.length) { fitContent(); return; }
    state.cam.cell = 28;
    state.cam.ox = cssW / 2 - (state.cols / 2) * state.cam.cell;
    state.cam.oy = cssH / 2 - (state.rows / 2) * state.cam.cell;
    render();
  }

  /**
   * 存档/蓝图里的 pos → 占地区域最小角的偏移。
   * 完全照搬游戏的 GenAdj.OccupiedRect + GenAdj.AdjustForRotation：
   *   1) 先按朝向交换尺寸（东/西）；
   *   2) 偶数尺寸时，按朝向把「中心」往负方向挪一格（这就是作者经验公式在模仿的东西）；
   *   3) 最小角 = 中心 − ⌊(尺寸−1)/2⌋。
   * rot：0=北 1=东 2=南 3=西；w/h 是该朝向下的占地宽/高。
   */
  function anchorOffset(rot, w, h) {
    var dx = 0, dz = 0;
    if (!(w === 1 && h === 1)) {
      if (rot === 1) { if (h % 2 === 0) dz = -1; }
      else if (rot === 2) { if (w % 2 === 0) dx = -1; if (h % 2 === 0) dz = -1; }
      else if (rot === 3) { if (w % 2 === 0) dx = -1; }
    }
    return { x: Math.floor((w - 1) / 2) - dx, z: Math.floor((h - 1) / 2) - dz };
  }

  /** 把视图适配到指定矩形区域（格坐标） */
  /** 把视图适配到已有建筑的包围盒；没内容时退回整张地图 */
  function fitContent(pad) {
    pad = pad == null ? 4 : pad;
    if (!state.buildings.length) { fitView(); return; }
    // 用分位数：地图上零星散落的建筑（矿、遗迹、电线杆）会把包围盒撑到整张地图，
    // 直接按包围盒适配就等于没适配，所以掐掉两端的离群点，对准主要基地。
    var xs = [], zs = [];
    state.buildings.forEach(function (b) {
      var def = defOf(b); if (!def) return;
      var fp = footprint(def, b.rot);
      xs.push(b.x + fp[0] / 2); zs.push(b.z + fp[1] / 2);
    });
    if (!xs.length) { fitView(); return; }
    // 取中位数当基地中心，再挑「离中心最近的一半」建筑来算包围盒 ——
    // 这样对准的是主基地，不会被地图另一头的矿点/哨所拉偏。
    var sxs = xs.slice().sort(function (a, b) { return a - b; });
    var szs = zs.slice().sort(function (a, b) { return a - b; });
    var mx = sxs[sxs.length >> 1], mz = szs[szs.length >> 1];
    var pts = [];
    for (var pi = 0; pi < xs.length; pi++) {
      var dx = xs[pi] - mx, dz = zs[pi] - mz;
      pts.push({ x: xs[pi], z: zs[pi], d: dx * dx + dz * dz });
    }
    pts.sort(function (a, b) { return a.d - b.d; });
    var keep = Math.min(pts.length, Math.max(8, Math.round(pts.length * 0.5)));
    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (var qi = 0; qi < keep; qi++) {
      minX = Math.min(minX, pts[qi].x); maxX = Math.max(maxX, pts[qi].x);
      minZ = Math.min(minZ, pts[qi].z); maxZ = Math.max(maxZ, pts[qi].z);
    }
    if (maxX - minX < 16) { var cx0 = (minX + maxX) / 2; minX = cx0 - 8; maxX = cx0 + 8; }
    if (maxZ - minZ < 16) { var cz0 = (minZ + maxZ) / 2; minZ = cz0 - 8; maxZ = cz0 + 8; }
    minX -= pad; minZ -= pad; maxX += pad; maxZ += pad;
    var w = Math.max(1, maxX - minX), h = Math.max(1, maxZ - minZ);
    var cell = Math.min(cssW / w, cssH / h);
    state.cam.cell = Math.max(2, Math.min(60, cell));
    state.cam.ox = cssW / 2 - (minX + w / 2) * state.cam.cell;
    state.cam.oy = cssH / 2 - (minZ + h / 2) * state.cam.cell;
    render();
  }

  function visibleRange() {
    var x0 = Math.max(0, Math.floor(-state.cam.ox / state.cam.cell));
    var z0 = Math.max(0, Math.floor(-state.cam.oy / state.cam.cell));
    var x1 = Math.min(state.cols, Math.ceil((cssW - state.cam.ox) / state.cam.cell));
    var z1 = Math.min(state.rows, Math.ceil((cssH - state.cam.oy) / state.cam.cell));
    return { x0: x0, z0: z0, x1: x1, z1: z1 };
  }

  var COLORS = {
    gridMinor: 'rgba(255,255,255,0.06)',
    gridMajor: 'rgba(255,255,255,0.14)',
    grid5: 'rgba(51,205,217,0.16)',      // 游戏强调青 TexUI.HighlightLineResearchColor
    outside: '#0e1113',
    inside: '#1d211b',                   // 暗绿灰（TexUI.GrayBg #333F33 的色调）
    ok: '#15b01a',                       // ColorLibrary.Green
    bad: '#e50000',                      // ColorLibrary.Red
    select: '#fff080',                   // TexUI.HighlightSelectedTex（游戏里的选中暖黄）
    marquee: 'rgba(255,240,128,0.16)'
  };

  function drawGrid(v) {
    var c = state.cam.cell;
    if (c < 5) return;
    var minor = COLORS.gridMajor, major = COLORS.grid5;
    ctx.lineWidth = 1 / c;
    for (var x = v.x0; x <= v.x1; x++) {
      ctx.strokeStyle = x % 5 === 0 ? major : minor;
      ctx.beginPath(); ctx.moveTo(x, v.z0); ctx.lineTo(x, v.z1); ctx.stroke();
    }
    for (var z = v.z0; z <= v.z1; z++) {
      ctx.strokeStyle = z % 5 === 0 ? major : minor;
      ctx.beginPath(); ctx.moveTo(v.x0, z); ctx.lineTo(v.x1, z); ctx.stroke();
    }
  }

  function drawFloors(v) {
    var c = state.cam.cell;
    for (var x = v.x0; x < v.x1; x++) {
      for (var z = v.z0; z < v.z1; z++) {
        var f = state.floors[key(x, z)];
        if (!f) continue;
        var fl = Data.floorsById[f];
        if (!fl) continue;
        ctx.save();
        var lockedFloor = state.lockedFloors && state.lockedFloors[key(x, z)];
        if (lockedFloor) { ctx.globalAlpha = 0.6; }
        if (!Art.drawFloorSprite(ctx, fl, x, z, 1)) Art.drawFloor(ctx, fl, x, z, 1);
        ctx.globalAlpha = 1;
        // 被选中的地板格描个边，好看出框选到了哪些
        if (state.floorSelection[key(x, z)]) {
          ctx.strokeStyle = COLORS.select;
          ctx.lineWidth = 2 / state.cam.cell;
          ctx.strokeRect(x + 0.03, z + 0.03, 0.94, 0.94);
        }
        var pf = state.plannedFloors && state.plannedFloors[key(x, z)];
        if (pf) {
          // 1=规划中（蓝图）  2=规划中但被禁用
          ctx.fillStyle = pf === 2 ? 'rgba(20,22,26,0.62)' : 'rgba(150,200,255,0.30)';
          ctx.fillRect(x, z, 1, 1);
        }
        ctx.restore();
      }
    }
  }

  function drawBuildings(v) {
    // 先画电线和地板，再画实体，最后画贴墙件
    var list = state.buildings;
    var i, b, def, fp;
    for (i = 0; i < list.length; i++) {
      b = list[i]; def = defOf(b); if (!def) continue;
      fp = footprint(def, b.rot);
      if (b.x + fp[0] < v.x0 || b.x > v.x1 || b.z + fp[1] < v.z0 || b.z > v.z1) continue;
      if (def.tags.indexOf('conduit') >= 0) drawOne(b, def, fp);
    }
    for (i = 0; i < list.length; i++) {
      b = list[i]; def = defOf(b); if (!def) continue;
      fp = footprint(def, b.rot);
      if (b.x + fp[0] < v.x0 || b.x > v.x1 || b.z + fp[1] < v.z0 || b.z > v.z1) continue;
      if (def.tags.indexOf('conduit') < 0 && def.tags.indexOf('onwall') < 0) drawOne(b, def, fp);
    }
    for (i = 0; i < list.length; i++) {
      b = list[i]; def = defOf(b); if (!def) continue;
      fp = footprint(def, b.rot);
      if (b.x + fp[0] < v.x0 || b.x > v.x1 || b.z + fp[1] < v.z0 || b.z > v.z1) continue;
      if (def.tags.indexOf('onwall') >= 0) drawOne(b, def, fp);
    }
  }

  /**
   * 建筑的作用区域（相对占地，按朝向变换）。
   * 数据在 data.js 的 zones 字段：{x,z,w,h,kind,label}，坐标以「未旋转的左下角为原点、z 向上」描述。
   * kind: cold/hot（制冷机）、clear（必须留空，如风机风区）、interact（互动区）
   */
  function zonesOf(def, rot) {
    if (!def.zones || !def.zones.length) return [];
    var w = def.size[0], h = def.size[1];
    var cx = (w - 1) / 2, cz = (h - 1) / 2;
    var fp = footprint(def, rot);
    var ncx = (fp[0] - 1) / 2, ncz = (fp[1] - 1) / 2;
    var r = ((rot % 360) + 360) % 360;
    return def.zones.map(function (z) {
      // 约定：z.x/z.z 是作用区左上角，相对占地左上角（z 向下增大）
      var x0 = z.x - cx, z0 = z.z - cz;
      var x1 = z.x + z.w - 1 - cx, z1 = z.z + z.h - 1 - cz;
      var cs = [[x0, z0], [x1, z0], [x0, z1], [x1, z1]].map(function (c) {
        var dx = c[0], dz = c[1];
        if (r === 90) return [-dz, dx];
        if (r === 180) return [-dx, -dz];
        if (r === 270) return [dz, -dx];
        return [dx, dz];
      });
      var mnx = Math.min(cs[0][0], cs[1][0], cs[2][0], cs[3][0]);
      var mxx = Math.max(cs[0][0], cs[1][0], cs[2][0], cs[3][0]);
      var mnz = Math.min(cs[0][1], cs[1][1], cs[2][1], cs[3][1]);
      var mxz = Math.max(cs[0][1], cs[1][1], cs[2][1], cs[3][1]);
      return {
        x: ncx + mnx, z: ncz + mnz, w: mxx - mnx + 1, h: mxz - mnz + 1,
        kind: z.kind || 'interact', label: z.label || ''
      };
    });
  }

  // 圆形作用范围：用「格子拼成的多边形」近似（游戏里作用范围也是按格算的）
  var radiusCache = {};
  function radiusCells(def) {
    var r = def.radius || 0;
    var c = radiusCache[def.id];
    if (c && c.r === r) return c.cells;
    var cells = [], set = {}, lim = Math.ceil(r);
    for (var dx = -lim; dx <= lim; dx++) {
      for (var dz = -lim; dz <= lim; dz++) {
        if (dx * dx + dz * dz <= r * r + 0.25) {
          cells.push([dx, dz]);
          set[dx + ',' + dz] = true;
        }
      }
    }
    radiusCache[def.id] = { r: r, cells: cells, set: set };
    return cells;
  }

  /** 该格是不是「导电」的（电缆或用电/发电设备）——用于电缆自动衔接 */
  function isPowerCell(x, z) {
    var list = INDEX[key(x, z)];
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      var d = defOf(list[i]);
      if (d && (d.tags.indexOf('conduit') >= 0 || d.tags.indexOf('power') >= 0)) return true;
    }
    return false;
  }
  function conduitConnMask(x, z) {
    var m = 0;
    if (isPowerCell(x, z - 1)) m |= 1;
    if (isPowerCell(x + 1, z)) m |= 2;
    if (isPowerCell(x, z + 1)) m |= 4;
    if (isPowerCell(x - 1, z)) m |= 8;
    return m;
  }

  // ---- 原版贴图的「连接件」掩码（墙 / 栅栏 / 沙袋 / 电缆…）----
  // 位：1=北(上) 2=东(右) 4=南(下) 8=西(左)，和游戏 Graphic_Linked 的索引一致
  function linksAt(lf, x, z) {
    var list = INDEX[key(x, z)];
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      var d = defOf(list[i]);
      if (!d) continue;
      var of = Art.linkFlagsOf(d);
      if (!of) continue;
      for (var a = 0; a < lf.length; a++) if (of.indexOf(lf[a]) >= 0) return true;
    }
    return false;
  }
  function linkMaskAt(lf, x, z) {
    var m = 0;
    if (lf.length) {
      if (linksAt(lf, x, z - 1)) m |= 1;
      if (linksAt(lf, x + 1, z)) m |= 2;
      if (linksAt(lf, x, z + 1)) m |= 4;
      if (linksAt(lf, x - 1, z)) m |= 8;
    }
    return m;
  }
  var DIAG_OFF = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
  var DIAG_BITS = [[8, 4], [8, 1], [2, 1], [2, 4]];
  function diagMaskAt(lf, x, z, mask) {
    var m = 0;
    for (var i = 0; i < 4; i++) {
      if (!(mask & DIAG_BITS[i][0]) || !(mask & DIAG_BITS[i][1])) continue;
      if (!linksAt(lf, x + DIAG_OFF[i][0], z + DIAG_OFF[i][1])) continue;
      m |= (1 << i);
    }
    return m;
  }
  /** 给贴图渲染用的信息（连接件掩码 / 门的朝向 / 材质） */
  function spriteInfoAt(x, z, def, stuff) {
    var info = { stuff: stuff || null };
    if (def && def.door) { info.drot = doorRotAt(x, z); return info; }
    if (!Art.isLinked || !Art.isLinked(def)) return info;
    var lf = Art.linkFlagsOf(def) || [];
    var mask = linkMaskAt(lf, x, z);
    info.mask = mask;
    info.dmask = (Art.linkKindOf(def) === 'corner') ? diagMaskAt(lf, x, z, mask) : 0;
    return info;
  }

  /** 用贴图画一个建筑（图没加载好返回 false，让调用方走矢量） */
  function drawArtFor(def, rot, x, z, fp, alpha, stuff) {
    if (!Art.useSprite || !Art.useSprite(def, rot, stuff)) return false;
    ctx.save();
    if (alpha != null) ctx.globalAlpha = alpha;
    Art.drawSpriteAt(ctx, def, rot, x, z, fp, spriteInfoAt(x, z, def, stuff));
    ctx.restore();
    return true;
  }

  /** 矢量贴图模式下也按「这个建筑的材质」上色（贴图模式走的是染色，不需要） */
  function withStuffColor(def, stuff, fn) {
    var s = stuff ? stuffById(stuff) : null;
    if (!s || !s.color) { fn(); return; }
    var oldC = def._color, oldA = def._accent;
    def._color = s.color;
    if (def._accent) def._accent = s.color;
    try { fn(); } finally { def._color = oldC; def._accent = oldA; }
  }

  var drawErrors = {};
  function drawOne(b, def, fp) {
    try { drawOneInner(b, def, fp); }
    catch (e) {
      // 某条数据有问题时，画个红框占位，绝不让整个画布停止刷新
      if (!drawErrors[def.id]) {
        drawErrors[def.id] = String(e && e.message || e);
        if (global.console) console.error('[draw] ' + def.id + ' 画不出来:', e);
      }
      ctx.strokeStyle = 'rgba(224,87,74,0.9)'; ctx.lineWidth = 2 / state.cam.cell;
      ctx.strokeRect(b.x + 0.1, b.z + 0.1, Math.max(1, fp[0]) - 0.2, Math.max(1, fp[1]) - 0.2);
    }
  }

  function drawOneInner(b, def, fp) {
    var w = def.size[0], h = def.size[1];
    var isConduit = def.tags.indexOf('conduit') >= 0;
    var info = null;
    var alpha = b.planned ? 0.5 : null;
    if (b.locked) alpha = (alpha == null ? 0.72 : alpha * 0.72);
    if (drawArtFor(def, b.rot, b.x, b.z, fp, alpha, b.stuff)) {
      // 贴图已画
    } else {
      if (isConduit) info = { conn: conduitConnMask(b.x, b.z) };
      ctx.save();
      ctx.translate(b.x + fp[0] / 2, b.z + fp[1] / 2);
      // 电缆不旋转：它的连线方向由四周邻居决定
      if (!isConduit) ctx.rotate(b.rot * Math.PI / 180);
      ctx.translate(-w / 2, -h / 2);
      ctx.lineJoin = 'round';
      if (alpha != null) ctx.globalAlpha = alpha;
      withStuffColor(def, b.stuff, function () { Art.drawBuilding(ctx, def, w, h, info); });
      ctx.restore();
    }
    if (b.planned) {
      ctx.strokeStyle = 'rgba(120,190,255,0.85)';
      ctx.lineWidth = 1.5 / state.cam.cell;
      ctx.setLineDash([0.22, 0.16]);
      ctx.strokeRect(b.x + 0.06, b.z + 0.06, fp[0] - 0.12, fp[1] - 0.12);
      ctx.setLineDash([]);
    }
    // 存档原有建筑：淡一点 + 左上角一个很小的 🔒（屏幕尺寸固定，避免挡住贴图）
    if (b.locked && state.cam.cell > 8) {
      var lockPx = Math.max(5, Math.min(9, state.cam.cell * 0.24));
      ctx.save();
      ctx.font = (lockPx / state.cam.cell) + 'px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.globalAlpha = 0.85;
      ctx.fillStyle = '#ffffff';
      ctx.fillText('🔒', b.x + 0.04, b.z + 0.02);
      ctx.restore();
    }
    if (state.selection[b.uid]) {
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = 2 / state.cam.cell;
      ctx.strokeRect(b.x + 0.03, b.z + 0.03, fp[0] - 0.06, fp[1] - 0.06);
    }
  }

  function drawOverlays(v) {
    if (state.layers.rooms && state.roomInfo && state.roomInfo.length) {
      state.roomInfo.forEach(function (r, i) {
        var hue = (i * 47) % 360;
        ctx.fillStyle = 'hsla(' + hue + ',70%,55%,0.14)';
        r.cells.forEach(function (c) { ctx.fillRect(c[0], c[1], 1, 1); });
        // 标签：在屏幕上是 12px（所以格子坐标里要除以 cell）
        if (state.cam.cell > 11) {
          var cx = r.cells.reduce(function (a, c) { return a + c[0]; }, 0) / r.cells.length + 0.5;
          var cz = r.cells.reduce(function (a, c) { return a + c[1]; }, 0) / r.cells.length + 0.5;
          ctx.fillStyle = 'hsla(' + hue + ',85%,80%,0.95)';
          ctx.font = (11 / state.cam.cell) + 'px sans-serif';
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(r.area + '格', cx, cz);
        }
      });
    }
    if (state.layers.power && state.powerInfo) {
      var pi = state.powerInfo;
      ctx.lineWidth = Math.max(0.08, 3 / state.cam.cell);
      pi.links.forEach(function (l) {
        ctx.strokeStyle = l.live ? 'rgba(255,210,80,0.55)' : 'rgba(255,210,80,0.22)';
        ctx.beginPath(); ctx.moveTo(l.a[0] + .5, l.a[1] + .5); ctx.lineTo(l.b[0] + .5, l.b[1] + .5); ctx.stroke();
      });
      // 无电/缺电标记
      pi.problems.forEach(function (p) {
        if (!p.defId) return;
        var c2 = Data.byId[p.defId] ? footprint(Data.byId[p.defId], p.rot) : [1, 1];
        ctx.strokeStyle = COLORS.bad; ctx.lineWidth = Math.max(0.1, 3 / state.cam.cell);
        ctx.setLineDash([0.25, 0.2]);
        ctx.strokeRect(p.x + 0.08, p.z + 0.08, c2[0] - 0.16, c2[1] - 0.16);
        ctx.setLineDash([]);
      });
    }
    // 作用范围：半径圆圈 + 有向作用区（制冷机冷热端、通风口两侧、风机风区…）
    if (state.layers.zones) {
      state.buildings.forEach(function (b) {
        var def = defOf(b); if (!def) return;
        drawZonesOf(def, b.rot, b.x, b.z, 1);
      });
    }

    // 冲突高亮
    state.issues.forEach(function (it) {
      if (it.kind !== 'overlap' && it.kind !== 'oob') return;
      if (!it.cells) return;
      it.cells.forEach(function (c) {
        ctx.fillStyle = 'rgba(224,87,74,0.35)';
        ctx.fillRect(c[0], c[1], 1, 1);
      });
    });
  }

  /**
   * 画一个建筑的「作用范围」（半径圈 + 有向作用区）。
   * 摆放预览和已放好的建筑共用，所以摆放时也能看到风区/冷热端。
   * alpha 用来在预览时画淡一点。
   */
  function drawZonesOf(def, rot, x, z, alpha) {
    if (!def) return;
    if (!def.radius && (!def.zones || !def.zones.length)) return;
    var fp = footprint(def, rot);
    var a = alpha == null ? 1 : alpha;
    if (def.radius) {
      // 游戏里作用范围按格算，所以用「格子拼成的多边形」近似圆
      var rc = radiusCells(def), rset = radiusCache[def.id].set;
      var ox0 = x + fp[0] / 2 - 0.5, oz0 = z + fp[1] / 2 - 0.5;
      ctx.fillStyle = 'rgba(120,200,255,' + (0.10 * a) + ')';
      rc.forEach(function (c) { ctx.fillRect(ox0 + c[0], oz0 + c[1], 1, 1); });
      ctx.strokeStyle = 'rgba(120,200,255,' + (0.6 * a) + ')';
      ctx.lineWidth = 1.4 / state.cam.cell;
      ctx.beginPath();
      rc.forEach(function (c) {
        var gx = ox0 + c[0], gz = oz0 + c[1];
        if (!rset[c[0] + ',' + (c[1] - 1)]) { ctx.moveTo(gx, gz); ctx.lineTo(gx + 1, gz); }
        if (!rset[c[0] + ',' + (c[1] + 1)]) { ctx.moveTo(gx, gz + 1); ctx.lineTo(gx + 1, gz + 1); }
        if (!rset[(c[0] - 1) + ',' + c[1]]) { ctx.moveTo(gx, gz); ctx.lineTo(gx, gz + 1); }
        if (!rset[(c[0] + 1) + ',' + c[1]]) { ctx.moveTo(gx + 1, gz); ctx.lineTo(gx + 1, gz + 1); }
      });
      ctx.stroke();
    }
    zonesOf(def, rot).forEach(function (zn) {
      var col = zn.kind === 'cold' ? '120,200,255' : zn.kind === 'hot' ? '240,140,70'
              : zn.kind === 'clear' ? '235,80,80' : zn.kind === 'clear2' ? '230,180,60'
              : zn.kind === 'joy' ? '235,90,110' : '150,220,150';
      ctx.fillStyle = 'rgba(' + col + ',' + (0.16 * a) + ')';
      ctx.fillRect(x + zn.x, z + zn.z, zn.w, zn.h);
      ctx.strokeStyle = 'rgba(' + col + ',' + (0.75 * a) + ')';
      ctx.lineWidth = 1.2 / state.cam.cell;
      ctx.setLineDash([0.3, 0.2]);
      ctx.strokeRect(x + zn.x, z + zn.z, zn.w, zn.h);
      ctx.setLineDash([]);
    });
  }

  function drawBrushPreview(v) {
    // ---- 粘贴预览 ----
    if (state.paste) {
      var clip = state.paste;
      clip.items.forEach(function (it) {
        var def = Data.byId[it.defId]; if (!def) return;
        var fp = footprint(def, it.rot);
        var tx = state.paste.at.x + it.dx, tz = state.paste.at.z + it.dz;
        var ok = canPlace(it.defId, tx, tz, it.rot, null, it.stuff);
        var bad = !ok.ok || (ok.terrain && !ok.terrain.ok);
        if (state.layers.zones) drawZonesOf(def, it.rot, tx, tz, 0.8);
        if (!drawArtFor(def, it.rot, tx, tz, fp, 0.75, it.stuff)) {
          ctx.globalAlpha = 0.75;
          ctx.save();
          ctx.translate(tx + fp[0] / 2, tz + fp[1] / 2);
          ctx.rotate(it.rot * Math.PI / 180);
          ctx.translate(-def.size[0] / 2, -def.size[1] / 2);
          Art.drawBuilding(ctx, def, def.size[0], def.size[1]);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = bad ? 'rgba(224,87,74,0.25)' : 'rgba(74,208,122,0.16)';
        ctx.fillRect(tx, tz, fp[0], fp[1]);
        ctx.strokeStyle = bad ? COLORS.bad : COLORS.ok;
        ctx.lineWidth = 2 / state.cam.cell;
        ctx.strokeRect(tx, tz, fp[0], fp[1]);
      });
      return;
    }

    // ---- 拖动形状预览（直线 / 方框 / 填充）----
    if (state.drag && state.drag.shape) {
      var sh = shapeCells(state.drag.from, state.drag.to);
      var erasing = state.tool === 'erase';
      var defR = (!erasing && state.brush && state.brush.kind === 'building') ? Data.byId[state.brush.id] : null;
      var floorR = (!erasing && state.brush && state.brush.kind === 'floor') ? Data.floorsById[state.brush.id] : null;
      var fpR = defR ? footprint(defR, state.rotation) : [1, 1];

      if (floorR) {
        ctx.globalAlpha = 0.6;
        sh.cells.forEach(function (c) {
          if (!Art.drawFloorSprite(ctx, floorR, c[0], c[1], 1)) Art.drawFloor(ctx, floorR, c[0], c[1], 1);
        });
        ctx.globalAlpha = 1;
      } else if (defR && sh.cells.length <= 900) {
        var bstuff = state.brush ? state.brush.stuff : null;
        // 摆放预览也画作用范围（和游戏的 PlaceWorker 一样）
        if (state.layers.zones && sh.cells.length <= 60) {
          sh.cells.forEach(function (c) { drawZonesOf(defR, state.rotation, c[0], c[1], 0.7); });
        }
        if (Art.useSprite && Art.useSprite(defR, state.rotation, bstuff)) {
          sh.cells.forEach(function (c) {
            drawArtFor(defR, state.rotation, c[0], c[1], fpR, 0.55, bstuff);
          });
        } else {
          ctx.globalAlpha = 0.55;
          sh.cells.forEach(function (c) {
            ctx.save();
            ctx.translate(c[0] + fpR[0] / 2, c[1] + fpR[1] / 2);
            ctx.rotate(state.rotation * Math.PI / 180);
            ctx.translate(-defR.size[0] / 2, -defR.size[1] / 2);
            Art.drawBuilding(ctx, defR, defR.size[0], defR.size[1]);
            ctx.restore();
          });
          ctx.globalAlpha = 1;
        }
      }
      sh.cells.forEach(function (c) {
        var fill;
        if (erasing) fill = 'rgba(224,87,74,0.25)';
        else if (defR) {
          var chk = canPlace(defR.id, c[0], c[1], state.rotation, null, bstuff);
          var bad = !chk.ok || (chk.terrain && !chk.terrain.ok);
          fill = bad ? 'rgba(224,87,74,0.22)' : 'rgba(74,208,122,0.16)';
        } else fill = 'rgba(120,200,255,0.18)';
        ctx.fillStyle = fill;
        ctx.fillRect(c[0], c[1], fpR[0], fpR[1]);
      });
      var bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
      sh.cells.forEach(function (c) {
        bx0 = Math.min(bx0, c[0]); bz0 = Math.min(bz0, c[1]);
        bx1 = Math.max(bx1, c[0]); bz1 = Math.max(bz1, c[1]);
      });
      ctx.strokeStyle = erasing ? COLORS.bad : COLORS.select;
      ctx.lineWidth = 2 / state.cam.cell;
      ctx.strokeRect(bx0, bz0, bx1 - bx0 + fpR[0], bz1 - bz0 + fpR[1]);
      return;
    }

    if (!state.hover) return;
    if (state.tool === 'select' || state.tool === 'pan' || state.tool === 'erase') return;
    if (!state.brush) return;
    var hx = state.hover.x, hz = state.hover.z;

    if (state.brush.kind === 'floor') {
      var fl = Data.floorsById[state.brush.id];
      if (!fl) return;
      ctx.globalAlpha = 0.7;
      if (!Art.drawFloorSprite(ctx, fl, hx, hz, 1)) Art.drawFloor(ctx, fl, hx, hz, 1);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS.select; ctx.lineWidth = 1 / state.cam.cell;
      ctx.strokeRect(hx, hz, 1, 1);
      return;
    }
    var def = Data.byId[state.brush.id]; if (!def) return;
    var fp = footprint(def, state.rotation);
    var chk = canPlace(def.id, hx, hz, state.rotation, null, state.brush.stuff);
    var bad = !chk.ok || (chk.terrain && !chk.terrain.ok);
    // 摆放预览就显示作用范围：风机风区、制冷机冷热端、太阳灯照射圈…（和游戏一致）
    if (state.layers.zones) drawZonesOf(def, state.rotation, hx, hz, 0.95);
    if (!drawArtFor(def, state.rotation, hx, hz, fp, 0.6, state.brush.stuff)) {
      ctx.globalAlpha = 0.6;
      ctx.save();
      ctx.translate(hx + fp[0] / 2, hz + fp[1] / 2);
      ctx.rotate(state.rotation * Math.PI / 180);
      ctx.translate(-def.size[0] / 2, -def.size[1] / 2);
      Art.drawBuilding(ctx, def, def.size[0], def.size[1]);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = bad ? 'rgba(224,87,74,0.25)' : 'rgba(74,208,122,0.16)';
    ctx.fillRect(hx, hz, fp[0], fp[1]);
    ctx.strokeStyle = bad ? COLORS.bad : COLORS.ok;
    ctx.lineWidth = 2 / state.cam.cell;
    ctx.strokeRect(hx, hz, fp[0], fp[1]);
  }

  function drawMarquee() {
    if (!state.marquee) return;
    var a = state.marquee.a, b = state.marquee.b;
    var x = Math.min(a.x, b.x), z = Math.min(a.z, b.z);
    var w = Math.abs(b.x - a.x), h = Math.abs(b.z - a.z);
    ctx.fillStyle = COLORS.marquee;
    ctx.fillRect(x, z, w, h);
    ctx.strokeStyle = COLORS.select; ctx.lineWidth = 1 / state.cam.cell;
    ctx.strokeRect(x, z, w, h);
  }

  /** 存档地形 / 山体（离屏 1px/格画布，按格缩放贴上去） */
  function drawTerrainLayer() {
    if (!state.terrainReady || !global.RWSite) return;
    var cv = global.RWSite.canvases();
    if (!cv || !cv.terrain) return;
    var prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = 0.9;
    ctx.drawImage(cv.terrain, 0, 0, state.cols, state.rows);
    if (cv.rock) { ctx.globalAlpha = 0.85; ctx.drawImage(cv.rock, 0, 0, state.cols, state.rows); }
    ctx.globalAlpha = 1;
    ctx.imageSmoothingEnabled = prev;
  }

  /** 玩家活动区域：淡绿底 + 边界 */
  function drawHomeLayer() {
    if (!state.home || !global.RWSite) return;
    var cv = global.RWSite.canvases();
    if (!cv || !cv.home) return;
    var prev = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(cv.home, 0, 0, state.cols, state.rows);
    ctx.imageSmoothingEnabled = prev;
  }

  /**
   * 「不可建造」覆盖层：把当前笔刷放不下的格子标红。
   * 选中地板笔刷就按地板检查，没笔刷时按「墙」的标准（Heavy）粗略标一下。
   */
  function drawBlockedOverlay(v) {
    if (!state.respectTerrain || !global.RWSite) return;
    if (!state.terrain && !state.rocks) return;
    var Site = global.RWSite;
    var isFloor = state.brush && state.brush.kind === 'floor';
    var def = (!isFloor && state.brush && state.brush.kind === 'building') ? Data.byId[state.brush.id] : null;
    var stuff = state.brush ? state.brush.stuff : null;
    ctx.save();
    for (var x = v.x0; x < v.x1; x++) {
      for (var z = v.z0; z < v.z1; z++) {
        var c = isFloor ? Site.checkFloor(state.brush.id, x, z)
              : (def ? Site.cellCheck(def, stuff, x, z)
                     : { ok: !!(Site.terrainAt(x, z) && (Site.terrainAt(x, z).aff || []).indexOf('Heavy') >= 0) });
        if (c.ok) continue;
        ctx.fillStyle = c.kind === 'rock' ? 'rgba(90,110,140,0.35)' : 'rgba(224,87,74,0.28)';
        ctx.fillRect(x, z, 1, 1);
      }
    }
    ctx.restore();
  }

  function render() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = COLORS.outside;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.translate(state.cam.ox, state.cam.oy);
    ctx.scale(state.cam.cell, state.cam.cell);
    ctx.beginPath(); ctx.rect(0, 0, state.cols, state.rows); ctx.clip();
    ctx.fillStyle = COLORS.inside;
    ctx.fillRect(0, 0, state.cols, state.rows);
    var v = visibleRange();
    if (state.layers.terrain && state.terrainReady) drawTerrainLayer();
    if (state.layers.home && state.home) drawHomeLayer();
    if (state.layers.floors) drawFloors(v);
    if (state.layers.grid) drawGrid(v);
    if (state.layers.buildings) drawBuildings(v);
    drawOverlays(v);
    if (state.layers.blocked) drawBlockedOverlay(v);
    drawMarquee();
    drawBrushPreview(v);
    ctx.restore();
  }

  // ---------------------------------------------------------------- 交互
  var panning = null;

  function attach(canvas) {
    cv = canvas; ctx = cv.getContext('2d');

    cv.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    cv.addEventListener('mousedown', function (e) {
      var r = cv.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;

      if (e.button === 1 || state.tool === 'pan' || e.altKey && e.button === 0) {
        panning = { sx: sx, sy: sy, ox: state.cam.ox, oy: state.cam.oy };
        cv.style.cursor = 'grabbing';
        return;
      }
      if (e.button === 2) { // 右键：取消笔刷 / 删除
        if (state.paste) { state.paste = null; render(); return; }
        if (state.brush) { setBrush(null); emit('change'); return; }
        var c0 = cellAt(sx, sy);
        var here = buildingsAt(c0.x, c0.z);
        var hitSel = here.filter(function (b) { return state.selection[b.uid]; });
        pushHistory();
        var removed = 0;
        if (hitSel.length && Object.keys(state.selection).length > 1) {
          // 右键点在已选中的东西上 → 删掉整批选中（锁定的存档建筑不动）
          var sel = Object.keys(state.selection);
          state.buildings = state.buildings.filter(function (b) {
            if (!state.selection[b.uid]) return true;
            if (b.locked) return true;
            removed++; return false;
          });
          state.selection = {};
          reindex();
        } else {
          if (removeAt(c0.x, c0.z)) removed = 1;
        }
        if (!removed) state.history.pop();
        render(); emit('change');
        return;
      }
      if (e.button !== 0) return;

      if (state.paste) {
        var made = pasteAt(state.paste, state.paste.at.x, state.paste.at.z);
        setSelection(made);
        emit('change'); return;
      }

      if (state.tool === 'select') {
        var c1 = cellAt(sx, sy);
        // 拖已经选中的东西 = 移动；拖空白 = 框选（两个功能合一）
        var here = buildingsAt(c1.x, c1.z);
        var hitSel = here.some(function (b) { return state.selection[b.uid]; });
        if (hitSel) { startMoveSelection(); return; }
        state.marquee = { a: c1, b: c1, add: e.shiftKey };
        return;
      }
      var c2 = cellAt(sx, sy);
      // 没拿笔刷时，单击直接选中那一格上的东西（不用先切到「框选」）
      if (!state.brush && state.tool !== 'erase') {
        state.marquee = { a: c2, b: c2, add: e.shiftKey };
        return;
      }
      // 放置 / 橡皮：统一「拖动出形状 → 松手提交」，形状由建筑类型自动决定
      if (state.tool === 'erase' || state.brush) {
        state.drag = { shape: true, from: c2, to: c2 };
        emitHud();
        render();
        return;
      }
      state.drag = null;
      render();
    });

    global.addEventListener('mousemove', function (e) {
      var r = cv.getBoundingClientRect();
      var sx = e.clientX - r.left, sy = e.clientY - r.top;
      var inside = sx >= 0 && sy >= 0 && sx <= r.width && sy <= r.height;

      if (panning) {
        state.cam.ox = panning.ox + (sx - panning.sx);
        state.cam.oy = panning.oy + (sy - panning.sy);
        render(); return;
      }
      if (!inside) { state.hover = null; render(); return; }

      var c = cellAt(sx, sy);
      var changed = !state.hover || state.hover.x !== c.x || state.hover.z !== c.z;
      state.hover = { x: c.x, z: c.z, fx: screenToCell(sx, sy).x, fz: screenToCell(sx, sy).z };
      emit('hover', state.hover);

      if (state.drag && state.drag.shape) {
        if (changed) { state.drag.to = c; emitHud(); render(); }
        return;
      }
      if (state.drag && state.drag.move) {
        var mv = state.drag.move;
        var dx = c.x - mv.from.x, dz = c.z - mv.from.z;
        if (dx !== mv.lastDx || dz !== mv.lastDz) {
          mv.lastDx = dx; mv.lastDz = dz;
          state.buildings.forEach(function (b) {
            if (mv.orig[b.uid]) { b.x = mv.orig[b.uid].x + dx; b.z = mv.orig[b.uid].z + dz; }
          });
          reindex(); render();
        }
        return;
      } else if (state.marquee) {
        state.marquee.b = c;
      } else if (state.paste) {
        state.paste.at = { x: c.x, z: c.z };
      }
      if (changed || state.marquee) render();
    });

    global.addEventListener('mouseup', function (e) {
      if (panning) { panning = null; cv.style.cursor = ''; return; }
      if (state.drag && state.drag.shape) {
        var d0 = state.drag;
        state.drag = null;
        commitShape(d0.from, d0.to);
        emitHud(true);
        return;
      }
      if (state.marquee) {
        var m = state.marquee;
        var x0 = Math.min(m.a.x, m.b.x), z0 = Math.min(m.a.z, m.b.z);
        var x1 = Math.max(m.a.x, m.b.x), z1 = Math.max(m.a.z, m.b.z);
        var hit = {};
        var single = (x1 - x0 < 0.5 && z1 - z0 < 0.5);
        state.buildings.forEach(function (b) {
          var def = defOf(b); if (!def) return;
          var fp = footprint(def, b.rot);
          if (single) {
            // 单击：只要这一格被它占着就选中（多格建筑也能点中）
            if (b.x <= x0 && x0 < b.x + fp[0] && b.z <= z0 && z0 < b.z + fp[1]) hit[b.uid] = true;
          } else {
            // 框选：中心落在框内即算选中
            var cx = b.x + fp[0] / 2, cz = b.z + fp[1] / 2;
            if (cx >= x0 && cx <= x1 + 1 && cz >= z0 && cz <= z1 + 1) hit[b.uid] = true;
          }
        });
        if (!m.add) { state.selection = {}; state.floorSelection = {}; }
        Object.keys(hit).forEach(function (u) { state.selection[u] = true; });
        // 地板也能框选（选中后按 Delete 就能整片删掉）
        Object.keys(state.floors).forEach(function (k) {
          var p = k.split(','), fx = +p[0], fz = +p[1];
          if (single) {
            if (fx === x0 && fz === z0) state.floorSelection[k] = true;
          } else if (fx >= x0 && fx <= x1 && fz >= z0 && fz <= z1) {
            state.floorSelection[k] = true;
          }
        });
        state.marquee = null;
        emit('change'); render();
      }
      if (state.drag && state.drag.move) { reindex(); emit('change'); render(); }
      state.drag = null;
    });

    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var r = cv.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });

    // 拖动选中的东西
    cv.addEventListener('dblclick', function (e) {
      var r = cv.getBoundingClientRect();
      var c = cellAt(e.clientX - r.left, e.clientY - r.top);
      var list = buildingsAt(c.x, c.z);
      if (list.length) setSelection(list.map(function (b) { return b.uid; }));
    });

    global.addEventListener('resize', resize);
  }

  // ---------------- 绘制辅助 ----------------
  /** 矩形范围内的格子；fill=false 时只取一圈 */
  function rectCells(a, b, fill) {
    var x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
    var z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
    var cells = [];
    for (var x = x0; x <= x1; x++) {
      for (var z = z0; z <= z1; z++) {
        if (!fill && !(x === x0 || x === x1 || z === z0 || z === z1)) continue;
        cells.push([x, z]);
      }
    }
    return { cells: cells, w: x1 - x0 + 1, h: z1 - z0 + 1 };
  }

  /**
   * 直线：和游戏一样不能拉斜线，只取「横 / 竖 / 点」。
   * 方向由位移较大的那一轴决定，另一轴锁在起点，避免手抖时整条线乱跳。
   */
  function lineCells(a, b) {
    var dx = b.x - a.x, dz = b.z - a.z;
    var cells = [];
    if (Math.abs(dx) >= Math.abs(dz)) {
      var sx = dx >= 0 ? 1 : -1;
      for (var x = a.x; ; x += sx) { cells.push([x, a.z]); if (x === b.x) break; }
      return { cells: cells, w: cells.length, h: 1 };
    }
    var sz = dz >= 0 ? 1 : -1;
    for (var z = a.z; ; z += sz) { cells.push([a.x, z]); if (z === b.z) break; }
    return { cells: cells, w: 1, h: cells.length };
  }

  /**
   * 按类型自动决定绘制方式（和游戏一致，不需要手动切）：
   *   墙 / 栅栏 / 沙袋 …（不可通行且参与围合的实体）→ 方框
   *   门 / 家具 / 生产设施 / 电器 …→ 直线（单点即一格）
   *   地面 → 填充
   * 单个建筑想强制指定，可以在数据里给它加 draw 字段。
   */
  function defaultDrawMode(def) {
    if (def && def.draw) return def.draw;
    if (!def) return 'rectFill';
    if (def.tags.indexOf('solid') >= 0 && def.tags.indexOf('room') >= 0) return 'rect';
    return 'brush';
  }

  function brushDef() {
    if (!state.brush || state.brush.kind !== 'building') return null;
    return Data.byId[state.brush.id] || null;
  }
  function brushIsMultiCell() {
    var d = brushDef(); if (!d) return false;
    var fp = footprint(d, state.rotation);
    return fp[0] > 1 || fp[1] > 1;
  }

  /** 当前拖动会覆盖哪些格子（三种绘制方式统一入口） */
  function shapeCells(from, to) {
    if (state.drawMode === 'rect') return rectCells(from, to, false);
    if (state.drawMode === 'rectFill') return rectCells(from, to, true);
    // 自由：多格建筑一次只放一个；1×1 的拉一条直线
    if (brushIsMultiCell()) return { cells: [[from.x, from.z]], w: 1, h: 1 };
    return lineCells(from, to);
  }

  function modeName() {
    if (state.drawMode === 'rect') return '方框';
    if (state.drawMode === 'rectFill') return '填充';
    return brushIsMultiCell() ? '单个' : '直线';
  }

  /** 把一批格子按当前笔刷落下去 */
  function commitCells(cells) {
    pushHistory();
    var changed = 0, replaced = 0, blocked = 0, reasons = {};
    if (state.tool === 'erase') {
      cells.forEach(function (c) { if (removeAt(c[0], c[1])) changed++; });
    } else if (state.brush && state.brush.kind === 'floor') {
      cells.forEach(function (c) {
        var k = key(c[0], c[1]);
        var chk = (state.respectTerrain && global.RWSite)
          ? global.RWSite.checkFloor(state.brush.id, c[0], c[1]) : { ok: true };
        if (!chk.ok && state.strictTerrain) { blocked++; reasons[chk.why] = (reasons[chk.why] || 0) + 1; return; }
        if (state.brush.id === 'none') delete state.floors[k];
        else state.floors[k] = state.brush.id;
        if (state.lockedFloors) delete state.lockedFloors[k];   // 手动铺过就不再算存档原有
        changed++;
      });
    } else if (state.brush && state.brush.kind === 'building') {
      var def = brushDef();
      if (def) {
        var out = placeBatch(cells, def.id, state.rotation, { color: def._color, stuff: state.brush.stuff });
        changed = out.placed; replaced = out.replaced; blocked = out.blocked;
      }
    }
    if (!changed && !replaced) state.history.pop();
    else emit('change');
    reindex();
    render();
    return { changed: changed, replaced: replaced, blocked: blocked, reasons: reasons };
  }

  /** 兼容旧调用：提交一个矩形区域 */
  function commitRect(from, to, fill) {
    var r = rectCells(from, to, fill);
    var out = commitCells(r.cells);
    out.w = r.w; out.h = r.h;
    return out;
  }

  /** 提交当前拖动的形状 */
  function commitShape(from, to) {
    var sh = shapeCells(from, to);
    var out = commitCells(sh.cells);
    out.w = sh.w; out.h = sh.h;
    return out;
  }

  /** 拖动时的实时读数 */
  function hudText() {
    var d = state.drag;
    if (!d || !d.from || !d.to) return '';
    var sh = shapeCells(d.from, d.to);
    var what = state.tool === 'erase' ? '擦除 ' + modeName() : modeName();
    return sh.w + ' × ' + sh.h + '　' + what + ' · ' + sh.cells.length + ' 格';
  }
  function emitHud() { emit('hud', hudText()); }

  function setBrush(kind, id, stuff) {
    if (!kind) { state.brush = null; state.paste = null; }
    else {
      var prev = (state.brush && state.brush.kind === kind && state.brush.id === id) ? state.brush : null;
      state.brush = { kind: kind, id: id };
      if (kind === 'building') {
        var def = Data.byId[id];
        state.brush.stuff = (stuff !== undefined) ? stuff
          : (prev && prev.stuff !== undefined) ? prev.stuff : defaultStuff(def);
      }
    }
    if (kind === 'building') { state.tool = 'place'; state.drawMode = defaultDrawMode(Data.byId[id]); }
    else if (kind === 'floor') { state.tool = 'place'; state.drawMode = 'rectFill'; }
    state.rotation = 0;
    render(); emit('change');
  }

  /** 换当前笔刷的材质（和游戏一样：先选材质再放） */
  function setBrushStuff(stuff) {
    if (!state.brush || state.brush.kind !== 'building') return;
    state.brush.stuff = stuff;
    setStuffOf(state.brush.id, stuff);
    render(); emit('change');
  }

  /** 改已选中建筑的材质 */
  function setSelectionStuff(stuff) {
    var sel = selectedBuildings();
    if (!sel.length) return 0;
    pushHistory();
    var n = 0;
    sel.forEach(function (b) {
      var def = defOf(b);
      if (!def || !def.stuffCats || !def.stuffCats.length) return;
      if (b.locked) return;    // 存档原有建筑不改材质
      b.stuff = stuff; n++;
    });
    if (state.brush && state.brush.kind === 'building') setStuffOf(state.brush.id, stuff);
    render(); emit('change');
    return n;
  }
  function setTool(t) {
    state.tool = t;
    if (t === 'select' || t === 'pan') state.brush = null;
    if (t === 'select' || t === 'pan') state.paste = null;
    // 橡皮默认「拖框填充删除」（拖一个矩形整片删掉，含地板）
    if (t === 'erase') state.drawMode = 'rectFill';
    render(); emit('change');
  }

  function startMoveSelection() {
    var sel = selectedBuildings().filter(function (b) { return !b.locked; });
    if (!sel.length) return;
    var orig = {};
    sel.forEach(function (b) { orig[b.uid] = { x: b.x, z: b.z }; });
    pushHistory();
    var minX = Math.min.apply(null, sel.map(function (b) { return b.x; }));
    var minZ = Math.min.apply(null, sel.map(function (b) { return b.z; }));
    state.drag = { move: { from: { x: minX, z: minZ }, orig: orig, lastDx: 0, lastDz: 0 } };
  }

  // ---------------------------------------------------------------- 载入 / 导出数据
  /** 网格 RLE：把几万格压成 [值, 连续数, ...]，存进工程 JSON 不会太大 */
  function rleEncode(arr) {
    var out = [], i = 0, n = arr.length;
    while (i < n) {
      var v = arr[i], j = i + 1;
      while (j < n && arr[j] === v) j++;
      out.push(v, j - i);
      i = j;
    }
    return out;
  }
  function rleDecode(flat, total) {
    var out = new Uint16Array(total), p = 0;
    for (var i = 0; i + 1 < flat.length; i += 2) {
      var v = flat[i], c = flat[i + 1];
      for (var k = 0; k < c && p < total; k++) out[p++] = v;
    }
    return out;
  }
  function packLayer(L) {
    if (!L || !L.cells) return null;
    return { w: L.w, h: L.h, defs: L.defs || {}, rle: rleEncode(L.cells) };
  }
  function unpackLayer(P) {
    if (!P || !P.rle) return null;
    return { w: P.w, h: P.h, defs: P.defs || {}, cells: rleDecode(P.rle, P.w * P.h) };
  }

  function loadProject(data) {
    state.cols = data.cols || 250;
    state.rows = data.rows || 250;
    state.buildings = (data.buildings || []).map(function (b) {
      var o = { uid: state.nextUid++, defId: b.defId, x: b.x, z: b.z, rot: b.rot || 0,
                color: b.color || null, stuff: b.stuff || null };
      if (b.locked) o.locked = true;
      if (b.src) o.src = b.src;
      if (b.planned) o.planned = true;
      return o;
    });
    state.floors = data.floors || {};
    state.plannedFloors = data.plannedFloors || {};
    state.lockedFloors = data.lockedFloors || {};
    state.lastStuff = data.lastStuff || {};
    state.mapName = data.name || '未命名布局';
    state.terrain = unpackLayer(data.terrain);
    state.rocks = unpackLayer(data.rocks);
    state.home = unpackLayer(data.home);
    state.terrainReady = !!state.terrain;
    state.importStamp = (state.importStamp || 0) + 1;
    if (data.useHomeStock != null) state.useHomeStock = !!data.useHomeStock;
    state.saveInfo = data.saveInfo || null;
    if (state.saveInfo && state.saveInfo.hasHome) {
      state.saveInfo.resources = state.useHomeStock !== false
        ? (state.saveInfo.resourcesHome || {}) : (state.saveInfo.resourcesAll || {});
    }
    if (data.respectTerrain != null) state.respectTerrain = !!data.respectTerrain;
    if (data.strictTerrain != null) state.strictTerrain = !!data.strictTerrain;
    if (global.RWSite) global.RWSite.terrainDirty();
    state.selection = {};
    state.history = []; state.future = [];
    reindex(); render(); emit('change');
  }

  function exportProject() {
    return {
      format: 'rw-planner', version: 1, name: state.mapName,
      cols: state.cols, rows: state.rows,
      buildings: state.buildings.map(function (b) {
        var o = { defId: b.defId, x: b.x, z: b.z, rot: b.rot, color: b.color, stuff: b.stuff };
        if (b.locked) o.locked = true;
        if (b.src) o.src = b.src;
        if (b.planned) o.planned = true;
        return o;
      }),
      floors: state.floors, plannedFloors: state.plannedFloors,
      lockedFloors: state.lockedFloors,
      lastStuff: state.lastStuff,
      terrain: packLayer(state.terrain), rocks: packLayer(state.rocks), home: packLayer(state.home),
      saveInfo: state.saveInfo, respectTerrain: state.respectTerrain, strictTerrain: state.strictTerrain,
      useHomeStock: state.useHomeStock
    };
  }

  function setGrid(cols, rows, quiet) {
    if (!quiet) pushHistory();
    state.cols = Math.max(4, Math.min(400, cols | 0));
    state.rows = Math.max(4, Math.min(400, rows | 0));
    // 裁掉越界建筑
    state.buildings = state.buildings.filter(function (b) {
      var def = defOf(b); var fp = footprint(def, b.rot);
      return b.x + fp[0] <= state.cols && b.z + fp[1] <= state.rows;
    });
    Object.keys(state.floors).forEach(function (k) {
      var p = k.split(',');
      if (+p[0] >= state.cols || +p[1] >= state.rows) {
        delete state.floors[k];
        if (state.lockedFloors) delete state.lockedFloors[k];
      }
    });
    reindex(); fitView(); emit('change');
  }

  // ---------------------------------------------------------------- 锁定（存档原有建筑）
  /** 设选中建筑的锁定状态 */
  function setSelectionLocked(on) {
    var sel = selectedBuildings();
    if (!sel.length) return 0;
    pushHistory();
    sel.forEach(function (b) { if (on) b.locked = true; else delete b.locked; });
    if (!on) {
      // 解锁后同时也解除地板锁定（同一批底图一起解锁更顺手）
      var fl = Object.keys(state.floorSelection || {});
      fl.forEach(function (k) { if (state.lockedFloors) delete state.lockedFloors[k]; });
    }
    render(); emit('change');
    return sel.length;
  }
  function setAllLocked(on) {
    pushHistory();
    state.buildings.forEach(function (b) {
      if (b.src === 'save' || b.locked || on) { if (on) b.locked = true; else delete b.locked; }
    });
    if (!on) state.lockedFloors = {};
    else {
      Object.keys(state.floors).forEach(function (k) { state.lockedFloors[k] = true; });
    }
    render(); emit('change');
  }
  function lockedCount() {
    var n = 0;
    state.buildings.forEach(function (b) { if (b.locked) n++; });
    return n;
  }

  // ---------------------------------------------------------------- 对外 API
  global.RW = {
    state: state,
    on: on, emit: emit,
    attach: attach, resize: resize, render: render, fitView: fitView, fitContent: fitContent,
    homeView: homeView,
    zoomAt: zoomAt, anchorOffset: anchorOffset,
    cellInfo: function (x, z) {
      if (!inBounds(x, z)) return null;
      var Site = global.RWSite;
      var terrain = Site ? Site.terrainAt(x, z) : null;
      var rock = Site ? Site.rockAt(x, z) : null;
      var roof = Site ? Site.roofAt(x, z) : 0;
      var inHome = !!(state.home && state.home.cells && state.home.cells[z * state.home.w + x]);
      var build = null;
      if (Site) {
        if (state.brush && state.brush.kind === 'building') build = Site.cellCheck(Data.byId[state.brush.id], state.brush.stuff, x, z);
        else if (state.brush && state.brush.kind === 'floor') build = Site.checkFloor(state.brush.id, x, z);
      }
      return {
        x: x, z: z,
        floor: state.floors[key(x, z)] || null,
        lockedFloor: !!(state.lockedFloors && state.lockedFloors[key(x, z)]),
        planned: state.plannedFloors ? (state.plannedFloors[key(x, z)] || 0) : 0,
        terrain: terrain ? { def: terrain.def, name: terrain.name, aff: terrain.aff || [], unknown: !!terrain.unknown } : null,
        rock: rock ? { def: rock.def, name: rock.name, hp: rock.hp, thing: rock.mineableThing, yield: rock.yield } : null,
        roof: roof,
        home: inHome,
        build: build,
        buildings: buildingsAt(x, z).map(function (b) {
          var d = defOf(b);
          return {
            uid: b.uid, defId: b.defId, name: d ? d.name : b.defId,
            defName: (d && (d.def || d.en)) || b.defId,
            size: d ? d.size : [1, 1], rot: b.rot,
            fp: d ? footprint(d, b.rot) : [1, 1],
            stuff: b.stuff || null,
            stuffName: (function () { var s = stuffById(b.stuff); return s ? s.name : null; })(),
            tags: (d && d.tags) || [], cat: d ? d.cat : '',
            powerUse: d ? (d.powerUse || 0) : 0,
            powerGen: d ? (d.powerGen || 0) : 0,
            powerStore: d ? (d.powerStore || 0) : 0,
            beauty: d ? d.beauty : null, dlc: d ? d.dlc : null,
            work: d ? (d.work || 0) : 0,
            cost: d ? (d.cost || null) : null,
            research: d ? (d.research || null) : null,
            skillReq: d ? (d.skillReq || 0) : 0,
            aff: d ? (d.aff || null) : null,
            zones: d ? zonesOf(d, b.rot) : [],
            radius: d ? d.radius : 0,
            rotatable: d ? d.rotatable !== false : true,
            planned: !!b.planned, locked: !!b.locked, src: b.src || null,
            selected: !!state.selection[b.uid]
          };
        })
      };
    },
    getViewSize: function () { return { w: cssW, h: cssH }; },
    screenToCell: screenToCell, cellAt: cellAt, visibleRange: visibleRange,
    key: key, footprint: footprint, defOf: defOf, cellsOf: cellsOf, inBounds: inBounds, zonesOf: zonesOf,
    reindex: reindex, buildingsAt: buildingsAt, canPlace: canPlace,
    siteBlock: siteBlock,
    coexist: coexist, victimsAt: victimsAt, placeBuilding: placeBuilding, placeBatch: placeBatch,
    rectCells: rectCells, lineCells: lineCells, shapeCells: shapeCells, commitRect: commitRect,
    commitShape: commitShape, commitCells: commitCells, defaultDrawMode: defaultDrawMode,
    modeName: modeName, hudText: hudText, emitHud: emitHud,
    isPowerCell: isPowerCell, conduitConnMask: conduitConnMask,
    spriteInfoAt: spriteInfoAt,
    addBuilding: addBuilding, removeBuilding: removeBuilding, removeAt: removeAt, clearAll: clearAll,
    setSelection: setSelection, selectedBuildings: selectedBuildings, deleteSelection: deleteSelection,
    selectedFloors: selectedFloors, selectionCount: selectionCount,
    setSelectionLocked: setSelectionLocked, setAllLocked: setAllLocked, lockedCount: lockedCount,
    rleEncode: rleEncode, rleDecode: rleDecode,
    stuffsFor: stuffsFor, stuffById: stuffById, defaultStuff: defaultStuff,
    setBrushStuff: setBrushStuff, setSelectionStuff: setSelectionStuff,
    doorRotAt: doorRotAt,
    rotateSelection: rotateSelection, startMoveSelection: startMoveSelection,
    copySelection: copySelection, pasteAt: pasteAt, setBrush: setBrush, setTool: setTool,
    pushHistory: pushHistory, undo: undo, redo: redo,
    loadProject: loadProject, exportProject: exportProject, setGrid: setGrid,
    terrainDirty: function () { if (global.RWSite) global.RWSite.terrainDirty(); else state.importStamp++; },
    COLORS: COLORS
  };
})(typeof window !== 'undefined' ? window : globalThis);
