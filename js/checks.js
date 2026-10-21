/*
 * checks.js —— 布局可行性校验
 *  1) 占地冲突 / 地图边缘不可建造
 *  2) 电力网络（连通性 + 发电/耗电/储电平衡）
 *  3) 房间识别（面积 / 空间评分 / 是否有门）
 *  4) 通路可达性（每个房间能否连到室外）
 *  5) 冷库 / 温控（估算）
 *
 * 所有算法都是本工具自己实现的近似模型，用于「不出门就能判断布局是否可行」。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  function has(def, t) { return def.tags && def.tags.indexOf(t) >= 0; }
  // 能不能封住房间。游戏里房间的边界不只是墙和门：
  // 嵌在墙里的制冷机 / 通风孔 / 蒸发制冷器也是不可通行的，它们本身就是冷库密封的一环。
  // 这里只额外认「贴墙件 + 不可通行」，不能把 solid 全算进来 ——
  // 床、桌子、发电机、炮塔都带 solid，那样会把一个房间切成一堆碎块。
  function encloses(def) { return has(def, 'room') || (has(def, 'onwall') && !has(def, 'pass')); }
  function isDoor(def) { return has(def, 'door'); }
  function isPower(def) { return def.tags && (has(def, 'conduit') || has(def, 'power')); }
  function isConsumer(def) { return has(def, 'power') && !has(def, 'gen') && !has(def, 'store') && (def.powerUse || 0) > 0; }
  function isProvider(def) { return has(def, 'gen') || (has(def, 'store') && (def.powerStore || 0) > 0); }
  function blocksWalk(def) { return !has(def, 'pass') && !isDoor(def) && !has(def, 'onwall'); }

  // 空间评分 → 中文评级（阈值参考游戏内「空间」分档）
  function spaceRating(v) {
    if (v < 12.5) return '拥挤';
    if (v < 29) return '较紧';
    if (v < 55) return '一般';
    if (v < 70) return '略宽敞';
    if (v < 130) return '相当宽敞';
    if (v < 349.5) return '非常宽敞';
    return '极其宽敞';
  }

  function analyse(state) {
    var RW = global.RW;
    var key = RW.key;
    var issues = [];

    // ---------- 索引 ----------
    var cellMap = {};      // "x,z" -> [building]
    var allCells = [];
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
        var k = key(b.x + i, b.z + j);
        (cellMap[k] = cellMap[k] || []).push(b);
        allCells.push([b.x + i, b.z + j]);
      }
    });

    // ---------- 1. 冲突 & 边缘 ----------
    var overlapCells = [];
    Object.keys(cellMap).forEach(function (k) {
      var list = cellMap[k];
      if (list.length < 2) return;
      // 和引擎用同一套共存规则：电缆(under)可以埋在墙里、贴墙件(onwall)可以贴着实体。
      // 只要有任意一对不能共存，才算真冲突。
      var bad = false;
      for (var a = 0; a < list.length && !bad; a++) {
        for (var c = a + 1; c < list.length; c++) {
          var da = Data.byId[list[a].defId], db = Data.byId[list[c].defId];
          if (!da || !db) continue;
          if (!global.RW.coexist(da, db)) { bad = true; break; }
        }
      }
      if (bad) {
        var p = k.split(',');
        overlapCells.push([+p[0], +p[1]]);
      }
    });
    if (overlapCells.length) {
      issues.push({
        kind: 'overlap', level: 'error',
        msg: '有 ' + overlapCells.length + ' 格被两个建筑同时占用（游戏里放不下）',
        cells: overlapCells
      });
    }
    var edge = [];
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = RW.footprint(def, b.rot);
      if (b.x === 0 || b.z === 0 || b.x + fp[0] === state.cols || b.z + fp[1] === state.rows) {
        edge.push([b.x, b.z]);
      }
    });
    if (edge.length) {
      issues.push({
        kind: 'edge', level: 'warn',
        msg: '有 ' + edge.length + ' 个建筑贴着地图边界：游戏内侧边 1 格是「不可建造区」',
        cells: edge
      });
    }

    // ---------- 1.5 地形 / 山体（导入了存档才有数据）----------
    if (global.RWSite && (state.terrain || state.rocks) && state.respectTerrain !== false) {
      var rockCells = [], terrainCells = [], rockDefs = {}, terrainDefs = {}, terrainWhy = {};
      state.buildings.forEach(function (b) {
        if (b.locked) return;                     // 存档原有建筑不报地形问题
        var def = Data.byId[b.defId]; if (!def) return;
        var chk = global.RWSite.checkBuilding(b.defId, b.x, b.z, b.rot, b.stuff);
        if (chk.ok) return;
        (chk.rockCells || []).forEach(function (c) {
          rockCells.push(c);
          var rk = global.RWSite.rockAt(c[0], c[1]);
          if (rk) rockDefs[rk.name] = (rockDefs[rk.name] || 0) + 1;
        });
        (chk.cells || []).forEach(function (c) {
          terrainCells.push(c);
          var t = global.RWSite.terrainAt(c[0], c[1]);
          if (t) terrainDefs[t.name] = (terrainDefs[t.name] || 0) + 1;
          if (chk.why) terrainWhy[chk.why] = (terrainWhy[chk.why] || 0) + 1;
        });
      });
      // 新铺的地板
      Object.keys(state.floors).forEach(function (k) {
        if (state.lockedFloors && state.lockedFloors[k]) return;
        var p = k.split(',');
        var f = global.RWSite.checkFloor(state.floors[k], +p[0], +p[1]);
        if (f.ok) return;
        terrainCells.push([+p[0], +p[1]]);
        var t = global.RWSite.terrainAt(+p[0], +p[1]);
        if (t) terrainDefs[t.name] = (terrainDefs[t.name] || 0) + 1;
      });
      if (rockCells.length) {
        var rkList = Object.keys(rockDefs).map(function (n) { return n + '×' + rockDefs[n]; }).join('、');
        issues.push({
          kind: 'terrain', level: 'error',
          msg: '有 ' + rockCells.length + ' 格是山体/矿石（' + rkList + '），蓝图要先开采才能建造',
          cells: rockCells
        });
      }
      if (terrainCells.length) {
        var tList = Object.keys(terrainDefs).map(function (n) { return n + '×' + terrainDefs[n]; }).join('、');
        var whys = Object.keys(terrainWhy);
        var detail = whys.length
          ? whys.slice(0, 3).join('；') + (whys.length > 3 ? '；…' : '')
          : '地形不满足这些建筑的要求（换材质 / 垫地基 / 铺桥）';
        issues.push({
          kind: 'terrain', level: 'error',
          msg: '有 ' + terrainCells.length + ' 格地形撑不住蓝图（' + tList + '）：' + detail,
          cells: terrainCells
        });
      }
    }

    // ---------- 2. 电力 ----------
    var power = analysePower(state, cellMap);
    power.problems.forEach(function (p) {
      // 电网是近似模型（游戏内的连接规则更宽松），所以只当提示、不当错误
      issues.push({ kind: 'power', level: 'warn', approx: true, msg: p.msg, cells: p.cells });
    });

    // ---------- 2.5 作用范围被占用 ----------
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def || !def.zones) return;
      var zs = RW.zonesOf(def, b.rot);
      zs.forEach(function (zn) {
        if (zn.kind !== 'clear' && zn.kind !== 'clear2') return;
        var blocked = [];
        for (var x = Math.ceil(b.x + zn.x); x < b.x + zn.x + zn.w; x++) {
          for (var z = Math.ceil(b.z + zn.z); z < b.z + zn.z + zn.h; z++) {
            var list = cellMap[key(x, z)] || [];
            for (var i = 0; i < list.length; i++) {
              var od = Data.byId[list[i].defId];
              if (od && blocksWalk(od) && list[i].uid !== b.uid) blocked.push([x, z]);
            }
          }
        }
        if (blocked.length) {
          issues.push({
            kind: 'zoneBlocked', level: 'warn', approx: true,
            msg: '「' + def.name + '」的' + zn.label + '被挡住了（有 ' + blocked.length + ' 格被实体占用，会导致它不工作）',
            cells: blocked
          });
        }
      });
    });

    // ---------- 2.8 门 ----------
    issues = issues.concat(analyseDoors(state, cellMap, key));

    // ---------- 3&4. 房间 / 连通 ----------
    var rooms = analyseRooms(state, cellMap);
    state.roomInfo = rooms.rooms;
    rooms.rooms.forEach(function (r, idx) {
      if (r.prefab) return;   // 玩家区域外的地图预制建筑（远古遗迹等）不算玩家房间
      if (r.doors === 0) {
        // 天然岩洞 / 远古遗迹本来就没门，玩家忘了开门也可能。属于提示，不是错误。
        issues.push({
          kind: 'sealed', level: 'info', approx: true,
          msg: '房间 #' + (idx + 1) + '（' + r.area + ' 格）是封闭的、没有能通行的门' +
            (r.ancient ? '（天然/遗迹结构，通常不用管）' : '（天然岩洞、遗迹，或门没装对位置）'),
          cells: r.cells
        });
      } else if (!r.reachable) {
        issues.push({
          kind: 'unreachable', level: 'warn', approx: true,
          msg: '房间 #' + (idx + 1) + '（' + r.area + ' 格）无法通到室外',
          cells: r.cells
        });
      }
      if (r.area > 5184) {
        issues.push({ kind: 'toobig', level: 'warn', msg: '房间 #' + (idx + 1) + ' 超过 5184 格上限，会被判定为非房间室内空间', cells: r.cells });
      }
    });

    // ---------- 5. 房间角色（自动推导）+ 温控 ----------
    var Rooms = global.RWRooms;
    var ambient = state.ambientTemp == null ? 21 : state.ambientTemp;
    var prefabCount = 0;
    rooms.rooms.forEach(function (r, idx) {
      if (r.prefab) {
        r.role = 'prefab';
        r.roleName = '地图预制';
        r.roleWhy = '玩家区域外（地图自带建筑 / 遗迹）';
        r.roleDef = null;
        r.ambient = ambient;
        r.temp = null;
        r.tempNeed = { kind: 'none', need: 0, delta: 0 };
        r.cooling = 0; r.heating = 0; r.coolingOld = 0;
        prefabCount++;
        return;
      }
      var ro = Rooms
        ? Rooms.deriveRole(r)
        : { role: 'room', name: '房间', def: null, why: '' };
      r.role = ro.role;
      r.roleName = ro.name;
      r.roleWhy = ro.why;
      r.roleDef = ro.def;
      r.ambient = ambient;
      r.temp = Rooms ? Rooms.temperatureOf(state, r) : 21;
      var need = Rooms
        ? Rooms.temperatureNeed(r, ambient, r.temp)
        : { kind: 'cool', need: Math.max(1, Math.ceil(r.area / 30)), delta: 21 };
      r.tempNeed = need;
      // 兼容旧字段：cooling / heating 表示「需要几台」
      r.cooling = need.kind === 'cool' ? need.need : 0;
      r.heating = need.kind === 'heat' ? need.need : 0;
      r.coolingOld = Math.max(1, Math.ceil(r.area / 30));   // 老的经验值，仅供参考

      // 温控（本工具的近似模型，不是游戏物理）
      if (r.tempNeed.kind === 'cool' && r.coolers < r.tempNeed.need) {
        issues.push({
          kind: 'temp', level: 'info', approx: true,
          msg: '房间 #' + (idx + 1) + '（' + r.roleName + '，目标 ' + r.temp + '°C，环境 ' + ambient + '°C）估算需要约 ' +
               r.tempNeed.need + ' 台制冷器，当前只有 ' + r.coolers + ' 台',
          cells: r.cells
        });
      }
      if (r.tempNeed.kind === 'heat' && r.heaters < r.tempNeed.need) {
        issues.push({
          kind: 'temp', level: 'info', approx: true,
          msg: '房间 #' + (idx + 1) + '（' + r.roleName + '，目标 ' + r.temp + '°C，环境 ' + ambient + '°C）估算需要约 ' +
               r.tempNeed.need + ' 台加热器，当前只有 ' + r.heaters + ' 台',
          cells: r.cells
        });
      }
    });

    // ---------- 5.5 制冷机的冷热端 ----------
    // 游戏里制冷机是「一冷一热」：冷的那侧房间降温，热的那侧房间升温。
    // 所以最常见的翻车点就是：它两侧各是一个房间 —— 一个变冷一个变热。
    // 判断不依赖朝向；有存档屋顶数据时，没屋顶的院子算室外（和游戏一致）。
    (function () {
      var rgOf = {};
      var prefabIds = {};
      rooms.rooms.forEach(function (r) { if (r.prefab) prefabIds[r.id] = 1; });
      rooms.regions.forEach(function (rg) {
        rg.cells.forEach(function (c) { rgOf[key(c[0], c[1])] = rg; });
      });
      // 新规划的建筑格：房间如果是用 plan 的墙围出来的，存档里当然没有屋顶数据，
      // 不能因此把它当成「室外」——游戏里盖好墙会自动封顶。
      var planCells = {};
      state.buildings.forEach(function (b) {
        if (b.src !== 'plan') return;
        var d = Data.byId[b.defId]; if (!d) return;
        var fp = RW.footprint(d, b.rot);
        for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
          planCells[key(b.x + i, b.z + j)] = true;
        }
      });
      function roomIsPlanned(rg) {
        if (!rg || !rg.cells) return false;
        for (var i = 0; i < rg.cells.length; i++) {
          var c = rg.cells[i];
          if (planCells[key(c[0] + 1, c[1])] || planCells[key(c[0] - 1, c[1])] ||
              planCells[key(c[0], c[1] + 1)] || planCells[key(c[0], c[1] - 1)]) return true;
        }
        return false;
      }
      function indoorSide(cell) {
        var rg = rgOf[key(cell[0], cell[1])] || null;
        if (!rg || prefabIds[rg.id]) return null;
        if (state.roofs && state.roofs.cells && global.RWSite && global.RWSite.roofAt && !roomIsPlanned(rg)) {
          // 有屋顶数据：没屋顶的格子按室外算（院子 / 露天平台）
          return global.RWSite.roofAt(cell[0], cell[1]) > 0 ? rg : null;
        }
        return rg.outdoor ? null : rg;
      }
      state.buildings.forEach(function (b) {
        var def = Data.byId[b.defId];
        if (!def || def.id !== 'cooler') return;
        var zs = RW.zonesOf(def, b.rot);
        if (zs.length < 2) return;
        var sideCells = zs.map(function (zn) {
          return [b.x + zn.x + Math.floor(zn.w / 2), b.z + zn.z + Math.floor(zn.h / 2)];
        });
        var a = indoorSide(sideCells[0]), b2 = indoorSide(sideCells[1]);
        if (!a && !b2) {
          issues.push({
            kind: 'coolerSide', level: 'warn', approx: true,
            msg: '有一台制冷机两侧都不是房间，它冷不到任何地方（要装在房间的墙上）',
            cells: [[b.x, b.z]]
          });
        } else if (a && b2 && a !== b2) {
          issues.push({
            kind: 'coolerSide', level: 'warn', approx: true,
            msg: '有一台制冷机两侧是两个不同的房间：冷的那间会降温、热的那间会升温。' +
                 '把它挪到「一侧是房间、另一侧通室外」的位置才对',
            cells: [[b.x, b.z]]
          });
        } else if (a && b2 && a === b2) {
          issues.push({
            kind: 'coolerSide', level: 'info', approx: true,
            msg: '有一台制冷机装在房间内部，冷热端在同一个房间里，制不成冷',
            cells: [[b.x, b.z]]
          });
        }
      });
    })();

    // 标注问题来自新规划还是存档原有（贴边、遗迹门这类多半不是玩家的锅）
    var oldCells = {}, newCells = {};
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
        (b.locked ? oldCells : newCells)[key(b.x + i, b.z + j)] = true;
      }
    });
    issues.forEach(function (it) {
      if (!it.cells || !it.cells.length) return;
      var o = 0, n = 0;
      it.cells.forEach(function (c) {
        var k = key(c[0], c[1]);
        if (oldCells[k]) o++;
        if (newCells[k]) n++;
      });
      it.source = (!n && o) ? 'existing' : (!o && n) ? 'plan' : 'mixed';
    });

    state.issues = issues;
    state.powerInfo = power;
    return {
      issues: issues, rooms: rooms.rooms, power: power,
      prefabs: prefabCount,
      outdoorArea: rooms.outdoorArea,
      stats: stats(state)
    };
  }

  // -------------------------------------------------- 电力
  // 完全照游戏的 PowerConnectionMaker：
  //   * ConnectMaxDist = 6：输电建筑能和「6 格内」的用电建筑相连（不是只挨着才行）
  //   * 输电建筑 = 电缆 / 电源开关 / 发电机 / 电池（CompProperties_Power.transmitsPower）
  //   * 用电器只连最近的输电建筑 → 这里近似成「6 格内有输电建筑就连上」
  var POWER_RANGE = 6;

  function isTransmitter(def) {
    return has(def, 'conduit') || def.tx === 1 || (def.powerStore || 0) > 0;
  }

  function analysePower(state, cellMap) {
    var key = global.RW.key;
    var parent = {};
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function union(a, b) { a = find(a); b = find(b); if (a !== b) parent[a] = b; }

    var items = [];        // 每个电力建筑一条
    var byCell = {};       // "x,z" -> [item]
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId];
      if (!def || !isPower(def)) return;
      var fp = global.RW.footprint(def, b.rot);
      var it = { b: b, def: def, x: b.x, z: b.z, w: fp[0], h: fp[1], tx: isTransmitter(def) };
      items.push(it);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
        var k = key(b.x + i, b.z + j);
        parent[k] = k;
        (byCell[k] = byCell[k] || []).push(it);
      }
    });

    // 连边：任意一侧是输电建筑、且两者相距不超过 6 格
    //
    // 性能：只从「输电建筑」这一侧发起（用电器之间本来就不会相连），
    // 并且用空间分桶（16×16 一格）缩小候选范围 ——
    // 早先每个电力建筑都要扫 13×13 = 169 个格子，几百个设备时会很慢。
    var BUCKET = 16;
    var buckets = {};
    items.forEach(function (it) {
      // 一个建筑可能横跨好几个桶（大型建筑 / 太阳能板），它占的每个桶都登记它
      var bx0 = Math.floor(it.x / BUCKET), bx1 = Math.floor((it.x + it.w - 1) / BUCKET);
      var bz0 = Math.floor(it.z / BUCKET), bz1 = Math.floor((it.z + it.h - 1) / BUCKET);
      for (var bx = bx0; bx <= bx1; bx++) {
        for (var bz = bz0; bz <= bz1; bz++) {
          var bk = bx + ',' + bz;
          (buckets[bk] = buckets[bk] || []).push(it);
        }
      }
    });
    function nearItems(A) {
      var out = [];
      var x0 = A.x - POWER_RANGE, x1 = A.x + A.w - 1 + POWER_RANGE;
      var z0 = A.z - POWER_RANGE, z1 = A.z + A.h - 1 + POWER_RANGE;
      var bx0 = Math.floor(x0 / BUCKET), bx1 = Math.floor(x1 / BUCKET);
      var bz0 = Math.floor(z0 / BUCKET), bz1 = Math.floor(z1 / BUCKET);
      for (var bx = bx0; bx <= bx1; bx++) {
        for (var bz = bz0; bz <= bz1; bz++) {
          var list = buckets[bx + ',' + bz];
          if (!list) continue;
          for (var i = 0; i < list.length; i++) out.push(list[i]);
        }
      }
      return out;
    }

    var links = [], seen = {};
    items.forEach(function (A) {
      if (!A.tx) return;                 // 只要输电建筑发起就够了
      var ka = key(A.x, A.z);
      var cand = nearItems(A);
      for (var n = 0; n < cand.length; n++) {
        var B = cand[n];
        if (B === A) continue;
        // 距离判定：两栋建筑占的格子最近也要在 6 格之内
        var dx = Math.max(0, Math.max(B.x - (A.x + A.w - 1), A.x - (B.x + B.w - 1)));
        var dz = Math.max(0, Math.max(B.z - (A.z + A.h - 1), A.z - (B.z + B.h - 1)));
        if (dx > POWER_RANGE || dz > POWER_RANGE) continue;
        var kb = key(B.x, B.z);
        union(ka, kb);
        var ek = ka < kb ? ka + '>' + kb : kb + '>' + ka;
        if (!seen[ek]) { seen[ek] = 1; links.push({ a: [A.x, A.z], b: [B.x, B.z] }); }
      }
    });

    // 汇总每张电网
    var nets = {};
    items.forEach(function (it) {
      var r = find(key(it.x, it.z));
      var net = nets[r] = nets[r] || { gen: 0, use: 0, store: 0, items: [], hasTx: false, cells: [] };
      net.items.push(it);
      net.gen += it.def.powerGen || 0;
      net.use += it.def.powerUse || 0;
      net.store += it.def.powerStore || 0;
      if (it.tx) net.hasTx = true;
      for (var i = 0; i < it.w; i++) for (var j = 0; j < it.h; j++) net.cells.push([it.x + i, it.z + j]);
    });

    // 问题：附近没有输电网 / 电网没有电源 / 缺电
    var problems = [];
    items.forEach(function (it) {
      var def = it.def;
      if (!isConsumer(def)) return;
      var net = nets[find(key(it.x, it.z))];
      if (!net || !net.hasTx) {
        problems.push({
          defId: it.b.defId, x: it.x, z: it.z, rot: it.b.rot,
          msg: '「' + def.name + '」周围 6 格内没有电缆 / 发电机',
          cells: [[it.x, it.z]]
        });
        return;
      }
      if (net.gen + net.store === 0) {
        problems.push({
          defId: it.b.defId, x: it.x, z: it.z, rot: it.b.rot,
          msg: '「' + def.name + '」所在电网里没有发电机 / 电池',
          cells: [[it.x, it.z]]
        });
      }
    });
    var netList = Object.keys(nets).map(function (r) {
      var n = nets[r];
      var deficit = n.use - n.gen;
      return {
        gen: n.gen, use: n.use, store: n.store, deficit: deficit,
        batteryMinutes: n.use > 0 && n.store > 0 ? (n.store / n.use * 60) : 0,
        count: n.items.length, cells: n.cells
      };
    });
    netList.forEach(function (n, i) {
      if (n.deficit > 0) {
        problems.push({
          x: n.cells.length ? n.cells[0][0] : 0, z: n.cells.length ? n.cells[0][1] : 0, rot: 0,
          msg: '电网 #' + (i + 1) + '：耗电 ' + n.use + 'W 大于发电 ' + n.gen + 'W，缺口 ' + n.deficit +
               'W（共 ' + n.cells.length + ' 格）',
          cells: n.cells
        });
      }
    });

    return { nets: netList, links: links, problems: problems };
  }

  // -------------------------------------------------- 门
  /**
   * 门要真的能过人。
   *
   * 门的通行轴由 rot 决定：0/2 = 南北，1/3 = 东西；两侧都必须是可通行格。
   * 最常见的错法是把门放在墙角：墙在南边+东边，开口在北边+西边，任何一轴都
   * 凑不出一对通行格 —— 游戏里就是堵死的。但房间 flood-fill 仍把门当围合，
   * 所以以前只会报「房间没有门」，看不出是门摆错了。
   */
  function analyseDoors(state, cellMap, key) {
    var issues = [];
    var Site = global.RWSite;

    // 对外一律报游戏坐标（和 plan.json / get_area 一致），别把画布坐标漏出去
    function gameCell(x, z) {
      return {
        x: state.flipX ? state.cols - 1 - x : x,
        z: state.flipZ !== false ? state.rows - 1 - z : z
      };
    }

    function blockedCell(x, z) {
      if (x < 0 || z < 0 || x >= state.cols || z >= state.rows) return true;
      var list = cellMap[key(x, z)] || [];
      for (var i = 0; i < list.length; i++) {
        var d = Data.byId[list[i].defId];
        if (d && blocksWalk(d)) return true;
      }
      if (Site) {
        if (Site.rockAt(x, z)) return true;
        var t = Site.terrainAt(x, z);
        if (t && t.aff && t.aff.indexOf('Walkable') < 0) return true;
      }
      return false;
    }

    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId];
      if (!def || !isDoor(def)) return;
      var rot = ((Math.round((b.rot || 0) / 90) % 4) + 4) % 4;
      var ns = !blockedCell(b.x, b.z - 1) && !blockedCell(b.x, b.z + 1);
      var ew = !blockedCell(b.x - 1, b.z) && !blockedCell(b.x + 1, b.z);
      var g = gameCell(b.x, b.z);
      var at = '门在 (' + g.x + ',' + g.z + ')';
      var level = b.locked ? 'info' : 'error';
      var tag = b.locked ? '（存档原有的）' : '';

      if (!ns && !ew) {
        issues.push({
          kind: 'door', level: level,
          msg: at + tag + ' 过不去：上下和左右都凑不出一对可通行的格子（常见是放在墙角 / 贴着两面墙）',
          cells: [[b.x, b.z]]
        });
      } else if (rot % 2 === 0 && !ns && ew) {
        issues.push({
          kind: 'door', level: b.locked ? 'info' : 'warn', approx: true,
          msg: at + tag + ' 的方向和墙线垂直：这面墙是东西向，门应该转 90°（rot=' + ((rot + 1) % 4) + '）',
          cells: [[b.x, b.z]]
        });
      } else if (rot % 2 === 1 && !ew && ns) {
        issues.push({
          kind: 'door', level: b.locked ? 'info' : 'warn', approx: true,
          msg: at + tag + ' 的方向和墙线垂直：这面墙是南北向，门应该转 90°（rot=' + ((rot + 1) % 4) + '）',
          cells: [[b.x, b.z]]
        });
      }
    });
    return issues;
  }

  // -------------------------------------------------- 房间 + 连通
  function analyseRooms(state, cellMap) {
    var key = global.RW.key;
    var cols = state.cols, rows = state.rows;
    var barrier = {};   // 围合格
    var doorCell = {};  // 门所在格
    var doorCount = 0;

    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = global.RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
        var k = key(b.x + i, b.z + j);
        if (encloses(def)) barrier[k] = true;
        if (isDoor(def)) { doorCell[k] = b; doorCount++; }
      }
    });

    // flood fill 出所有区域（区域 id 数组）
    var region = {};
    var regions = [];
    var idx = 0;
    for (var z = 0; z < rows; z++) {
      for (var x = 0; x < cols; x++) {
        var k0 = key(x, z);
        if (barrier[k0] || region[k0] !== undefined) continue;
        var id = idx++;
        var queue = [[x, z]], cells = [], touchesEdge = false;
        region[k0] = id;
        while (queue.length) {
          var c = queue.pop();
          cells.push(c);
          if (c[0] === 0 || c[1] === 0 || c[0] === cols - 1 || c[1] === rows - 1) touchesEdge = true;
          var nb = [[c[0] + 1, c[1]], [c[0] - 1, c[1]], [c[0], c[1] + 1], [c[0], c[1] - 1]];
          for (var q = 0; q < nb.length; q++) {
            var nx = nb[q][0], nz = nb[q][1];
            if (nx < 0 || nz < 0 || nx >= cols || nz >= rows) continue;
            var kk = key(nx, nz);
            if (barrier[kk] || region[kk] !== undefined) continue;
            region[kk] = id;
            queue.push([nx, nz]);
          }
        }
        regions.push({ id: id, cells: cells, outdoor: touchesEdge });
      }
    }

    // 每个区域的门 & 相邻区域
    var regionDoors = {};    // regionId -> {doors:[cell], adjacent:{regionId:true}}
    regions.forEach(function (r) { regionDoors[r.id] = { doors: [], adjacent: {} }; });
    Object.keys(doorCell).forEach(function (k) {
      var p = k.split(','), x = +p[0], z = +p[1];
      var nb = [[x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]];
      var touch = {};
      nb.forEach(function (n) {
        if (n[0] < 0 || n[1] < 0 || n[0] >= cols || n[1] >= rows) return;
        var rid = region[key(n[0], n[1])];
        if (rid === undefined) return;
        touch[rid] = true;
      });
      Object.keys(touch).forEach(function (rid) {
        regionDoors[rid].doors.push([x, z]);
        Object.keys(touch).forEach(function (rid2) {
          if (rid2 !== rid) regionDoors[rid].adjacent[rid2] = true;
        });
      });
    });

    // 可达性：从「室外」区域出发，经门做 BFS
    var outdoorIds = regions.filter(function (r) { return r.outdoor; }).map(function (r) { return r.id; });
    var reach = {};
    var q = outdoorIds.slice();
    q.forEach(function (id) { reach[id] = true; });
    while (q.length) {
      var cur = q.pop();
      var adj = regionDoors[cur] ? regionDoors[cur].adjacent : {};
      Object.keys(adj).forEach(function (n) {
        if (!reach[n]) { reach[n] = true; q.push(+n); }
      });
    }

    // 哪些建筑算「天然/遗迹」（远古遗迹、岩洞这类本来就没有门，不该报问题）
    function isAncient(def) {
      if (!def) return false;
      var t = (def.id + ' ' + (def.def || '') + ' ' + (def.en || '') + ' ' + def.name).toLowerCase();
      return /ancient|ruin|遗迹|远古|岩洞|洞穴/.test(t);
    }

    // 组装房间
    // 导入存档时，玩家区域（Area_Home）之外的地图自带建筑（远古遗迹、废弃营地等）
    // 在游戏里也是 Room，但不是玩家基地的房间。这里标成 prefab，不算房间角色 / 温控 / 校验。
    var home = (state.home && state.home.cells && state.home.count !== 0) ? state.home : null;
    var rooms = [];
    var roomIdx = 0;
    regions.forEach(function (r) {
      if (r.outdoor) return;
      roomIdx++;
      var area = r.cells.length;
      var blocked = 0, coolers = 0, heaters = 0, beds = 0, ancient = false;
      // 设备按「个数」统计：床是 1×2 的，会占两格，不能按格子算成两张床
      var counted = {};
      var things = [];
      var homeCells = 0;
      r.cells.forEach(function (c) {
        if (home && c[0] >= 0 && c[1] >= 0 && c[0] < home.w && c[1] < home.h &&
            home.cells[c[1] * home.w + c[0]]) homeCells++;
        var list = cellMap[key(c[0], c[1])] || [];
        list.forEach(function (b) {
          var def = Data.byId[b.defId]; if (!def) return;
          if (blocksWalk(def)) blocked++;
          var once = !counted[b.uid];
          if (once) { counted[b.uid] = true; things.push(b); }
          if (once && (def.id === 'cooler' || def.id === 'passive_cooler')) coolers++;
          if (once && def.id === 'heater') heaters++;
          if (once) {
            var bed = global.RWRooms && global.RWRooms.bedOf ? global.RWRooms.bedOf(b) : null;
            if (bed && bed.human) beds++;
          }
          if (isAncient(def)) ancient = true;
        });
      });
      // 玩家自己画的建筑（未锁定 / 非存档导入）→ 即使不在 Area_Home 里也算规划房间。
      // 这样「导入存档后想在基地外扩建」不会被误标成预制。
      var playerBuilt = things.some(function (b) { return !b.locked && b.src !== 'save'; });
      if (!playerBuilt) {
        for (var ci = 0; ci < r.cells.length && !playerBuilt; ci++) {
          var cc = r.cells[ci];
          var nb = [[cc[0] + 1, cc[1]], [cc[0] - 1, cc[1]], [cc[0], cc[1] + 1], [cc[0], cc[1] - 1]];
          for (var ni = 0; ni < nb.length && !playerBuilt; ni++) {
            var list2 = cellMap[key(nb[ni][0], nb[ni][1])];
            if (list2 && list2.some(function (b) { return !b.locked && b.src !== 'save'; })) playerBuilt = true;
          }
        }
      }
      // 贴在房间边界上的制冷器/加热器也算
      coolers += countWallUnits(cellMap, r.cells, ['cooler', 'passive_cooler']);
      heaters += countWallUnits(cellMap, r.cells, ['heater']);
      var space = 1.4 * area - 0.9 * blocked;
      rooms.push({
        id: r.id, area: area, cells: r.cells, things: things,
        doors: regionDoors[r.id] ? regionDoors[r.id].doors.length : 0,
        space: Math.round(space * 10) / 10, spaceText: spaceRating(space),
        reachable: !!reach[r.id], outdoor: false,
        homeCells: homeCells, prefab: !!home && homeCells === 0 && !playerBuilt,
        blocked: blocked, coolers: coolers, heaters: heaters, beds: beds, ancient: ancient
      });
    });

    var outdoorArea = regions.filter(function (r) { return r.outdoor; })
      .reduce(function (a, r) { return a + r.cells.length; }, 0);

    return { rooms: rooms, regions: regions, outdoorArea: outdoorArea, doorCount: doorCount };
  }

  // 统计房间四周贴着的温控设备（制冷器/加热器常装在墙上，不在房间格内）
  function countWallUnits(cellMap, cells, ids) {
    var key = global.RW.key;
    var count = 0, seen = {};
    cells.forEach(function (c) {
      var nb = [[c[0] + 1, c[1]], [c[0] - 1, c[1]], [c[0], c[1] + 1], [c[0], c[1] - 1]];
      nb.forEach(function (n) {
        var list = cellMap[key(n[0], n[1])];
        if (!list) return;
        list.forEach(function (b) {
          if (ids.indexOf(b.defId) >= 0 && !seen[b.uid]) { seen[b.uid] = true; count++; }
        });
      });
    });
    return count;
  }

  // -------------------------------------------------- 统计
  function stats(state) {
    var count = {}, total = 0;
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      count[def.id] = (count[def.id] || 0) + 1;
      total++;
    });
    var list = Object.keys(count).map(function (id) {
      var def = Data.byId[id];
      return { id: id, name: def ? def.name : id, n: count[id], size: def ? def.size : [1, 1], cat: def ? def.cat : '' };
    }).sort(function (a, b) { return b.n - a.n; });
    var floorCount = Object.keys(state.floors).length;
    return { total: total, byType: list, floors: floorCount, cells: total };
  }

  global.RWChecks = { analyse: analyse, spaceRating: spaceRating, isPower: isPower, isConsumer: isConsumer, isDoor: isDoor, encloses: encloses, blocksWalk: blocksWalk };
})(typeof window !== 'undefined' ? window : globalThis);
