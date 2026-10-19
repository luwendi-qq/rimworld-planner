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

    // ---------- 2. 电力 ----------
    var power = analysePower(state, cellMap);
    power.problems.forEach(function (p) {
      // 电网是近似模型（游戏内的连接规则更宽松），所以只当提示、不当错误
      issues.push({ kind: 'power', level: 'warn', msg: p.msg, cells: p.cells });
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
            kind: 'zoneBlocked', level: 'warn',
            msg: '「' + def.name + '」的' + zn.label + '被挡住了（有 ' + blocked.length + ' 格被实体占用，会导致它不工作）',
            cells: blocked
          });
        }
      });
    });

    // ---------- 3&4. 房间 / 连通 ----------
    var rooms = analyseRooms(state, cellMap);
    state.roomInfo = rooms.rooms;
    rooms.rooms.forEach(function (r, idx) {
      if (r.doors === 0) {
        // 天然岩洞 / 远古遗迹本来就没门，玩家忘了开门也可能。属于提示，不是错误。
        issues.push({
          kind: 'sealed', level: 'info',
          msg: '房间 #' + (idx + 1) + '（' + r.area + ' 格）是封闭的、没有门' +
            (r.ancient ? '（天然/遗迹结构，通常不用管）' : '（天然岩洞、遗迹，或你还没装门）'),
          cells: r.cells
        });
      } else if (!r.reachable) {
        issues.push({
          kind: 'unreachable', level: 'warn',
          msg: '房间 #' + (idx + 1) + '（' + r.area + ' 格）无法通到室外',
          cells: r.cells
        });
      }
      if (r.area > 5184) {
        issues.push({ kind: 'toobig', level: 'warn', msg: '房间 #' + (idx + 1) + ' 超过 5184 格上限，会被判定为非房间室内空间', cells: r.cells });
      }
    });

    // ---------- 5. 温控估算 ----------
    rooms.rooms.forEach(function (r, idx) {
      r.cooling = Math.max(1, Math.ceil(r.area / 30));
      r.heating = Math.max(1, Math.ceil(r.area / 30));
      // 里面什么都没有的空腔（天然岩洞 / 遗迹）不用提示制冷
      var furnished = (r.beds || 0) > 0;   // 只有住人的房间才提示制冷，遗迹/空腔不提示
      if (furnished && r.area >= 60 && r.coolers < r.cooling) {
        issues.push({
          kind: 'temp', level: 'info',
          msg: '房间 #' + (idx + 1) + '（' + r.area + ' 格）估算需要约 ' + r.cooling + ' 台制冷器，当前只有 ' + r.coolers + ' 台',
          cells: r.cells
        });
      }
    });

    state.issues = issues;
    state.powerInfo = power;
    return {
      issues: issues, rooms: rooms.rooms, power: power,
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
    var links = [], seen = {};
    items.forEach(function (A) {
      var ka = key(A.x, A.z);
      for (var x = A.x - POWER_RANGE; x < A.x + A.w + POWER_RANGE; x++) {
        for (var z = A.z - POWER_RANGE; z < A.z + A.h + POWER_RANGE; z++) {
          var list = byCell[key(x, z)];
          if (!list) continue;
          for (var i = 0; i < list.length; i++) {
            var B = list[i];
            if (B === A) continue;
            if (!A.tx && !B.tx) continue;      // 两个用电器之间不会相连
            var kb = key(B.x, B.z);
            union(ka, kb);
            var ek = ka < kb ? ka + '>' + kb : kb + '>' + ka;
            if (!seen[ek]) { seen[ek] = 1; links.push({ a: [A.x, A.z], b: [B.x, B.z] }); }
          }
        }
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
    var rooms = [];
    var roomIdx = 0;
    regions.forEach(function (r) {
      if (r.outdoor) return;
      roomIdx++;
      var area = r.cells.length;
      var blocked = 0, coolers = 0, heaters = 0, beds = 0, ancient = false;
      r.cells.forEach(function (c) {
        var list = cellMap[key(c[0], c[1])] || [];
        list.forEach(function (b) {
          var def = Data.byId[b.defId]; if (!def) return;
          if (blocksWalk(def)) blocked++;
          if (def.id === 'cooler' || def.id === 'passive_cooler') coolers++;
          if (def.id === 'heater') heaters++;
          if (has(def, 'bed')) beds++;
          if (isAncient(def)) ancient = true;
        });
      });
      // 贴在房间边界上的制冷器/加热器也算
      coolers += countWallUnits(cellMap, r.cells, ['cooler', 'passive_cooler']);
      heaters += countWallUnits(cellMap, r.cells, ['heater']);
      var space = 1.4 * area - 0.9 * blocked;
      rooms.push({
        area: area, cells: r.cells, doors: regionDoors[r.id] ? regionDoors[r.id].doors.length : 0,
        space: Math.round(space * 10) / 10, spaceText: spaceRating(space),
        reachable: !!reach[r.id], outdoor: false,
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
