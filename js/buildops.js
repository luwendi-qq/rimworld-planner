/*
 * buildops.js —— 把规划转成「游戏侧建造调用」列表
 *
 * 为什么需要它：planning 工具的输出最终要落到游戏里。两种落地方式：
 *   1. 蓝图 .xml（Blueprints 模组，人手动放进文件夹）
 *   2. 直接调用游戏侧的 build(def, x, z, rot, stuff) —— 比如 RimMolt 这类 MCP
 *
 * 第 2 种不需要模组、也不需要人工搬文件，但它有一个硬约束：一次调用只能放一个
 * def。整座基地几百个格子，逐格调用既慢又烧上下文。所以这里把「同 def / 同材质 /
 * 同朝向」的相邻单格合并成矩形（游戏的拖拽放置本来就支持矩形填充），
 * 一面墙、一片地板通常就是一次调用。
 *
 * 坐标不在这里换算 —— 直接用 RWExport.blueprintEntries 的结果（已经是游戏坐标），
 * 免得和蓝图导出算出两套坐标。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  var byGameName = null;
  var byGameNameStamp = -1;

  /** 游戏 defName → 建筑定义（数据库可能在导入游戏资源后被替换，所以要检查） */
  function defByGameName(name) {
    var stamp = Data.byId ? Object.keys(Data.byId).length : 0;
    if (!byGameName || byGameNameStamp !== stamp) {
      byGameName = {};
      var ids = Object.keys(Data.byId || {});
      for (var i = 0; i < ids.length; i++) {
        var d = Data.byId[ids[i]];
        var g = global.RWExport.gameDefName(d);
        if (g && !byGameName[g]) byGameName[g] = d;
      }
      byGameNameStamp = stamp;
    }
    return byGameName[name] || null;
  }

  /**
   * 把一堆格子拆成尽可能少的矩形（贪心：先向右拉，再整行向下扩）。
   * cells: [[x,z], ...] → [[x0,z0,x1,z1], ...]
   */
  function toRects(cells) {
    var set = {}, list = [];
    for (var i = 0; i < cells.length; i++) {
      var k = cells[i][0] + ',' + cells[i][1];
      if (!set[k]) { set[k] = 1; list.push([cells[i][0], cells[i][1]]); }
    }
    list.sort(function (a, b) { return a[1] - b[1] || a[0] - b[0]; });

    var used = {}, out = [];
    for (var n = 0; n < list.length; n++) {
      var x0 = list[n][0], z0 = list[n][1];
      if (used[x0 + ',' + z0]) continue;

      var x1 = x0;
      while (set[(x1 + 1) + ',' + z0] && !used[(x1 + 1) + ',' + z0]) x1++;

      var z1 = z0;
      for (;;) {
        var ok = true;
        for (var x = x0; x <= x1; x++) {
          var kk = x + ',' + (z1 + 1);
          if (!set[kk] || used[kk]) { ok = false; break; }
        }
        if (!ok) break;
        z1++;
      }

      for (var xx = x0; xx <= x1; xx++) {
        for (var zz = z0; zz <= z1; zz++) used[xx + ',' + zz] = 1;
      }
      out.push([x0, z0, x1, z1]);
    }
    return out;
  }

  /** 电缆这类「可以埋在墙下」的东西必须在墙之前放，否则墙会挡住它 */
  function layerOf(def) {
    if (!def) return 2;
    var tags = def.tags || [];
    if (tags.indexOf('under') >= 0 || /conduit/i.test(def.id || '')) return 0;
    if (tags.indexOf('door') >= 0) return 3;
    return 2;
  }

  /**
   * @param {object} state   RW.state
   * @param {object} [opts]  {excludeLocked, floors, stuff}
   * @returns {{ops:Array, stats:Object}}
   *   ops[i] 单格:  {def, x, z, rot?, stuff?}
   *   ops[i] 矩形:  {def, minX, minZ, maxX, maxZ, fill:'filled', stuff?}
   *   可直接展开成游戏侧 build(...) 的参数。
   */
  function toBuildOps(state, opts) {
    opts = opts || {};
    var packed = global.RWExport.blueprintEntries(state, opts);

    var floorsByDef = {};   // defName -> [[x,z]]
    var thingsByKey = {};   // defName|stuff|rot -> {def, stuff, rot, cells:[]}
    var singles = [];       // 多格建筑：只能逐件放，保持游戏 Position

    packed.entries.forEach(function (e) {
      if (e.terrain) {
        (floorsByDef[e.terrain] = floorsByDef[e.terrain] || []).push([e.x, e.z]);
        return;
      }
      var def = defByGameName(e.defName);
      var fp = def ? global.RW.footprint(def, (e.rot || 0) * 90) : [1, 1];
      if (fp[0] === 1 && fp[1] === 1) {
        var key = e.defName + '|' + (e.stuff || '') + '|' + (e.rot || 0);
        var box = thingsByKey[key];
        if (!box) box = thingsByKey[key] = { def: e.defName, stuff: e.stuff, rot: e.rot || 0, cells: [] };
        box.cells.push([e.x, e.z]);
      } else {
        singles.push({ kind: layerOf(def), op: withStuff({ def: e.defName, x: e.x, z: e.z, rot: e.rot || 0 }, e.stuff) });
      }
    });

    function withStuff(op, stuff) {
      if (stuff) op.stuff = stuff;
      return op;
    }

    var ops = [];

    // 1) 地板：整片地板合并成矩形
    Object.keys(floorsByDef).forEach(function (name) {
      toRects(floorsByDef[name]).forEach(function (r) {
        if (r[0] === r[2] && r[1] === r[3]) ops.push({ def: name, x: r[0], z: r[1] });
        else ops.push({ def: name, fill: 'filled', minX: r[0], minZ: r[1], maxX: r[2], maxZ: r[3] });
      });
    });

    // 2) 单格建筑：按层排序（电缆 → 其他 → 门），同层内按 def 合并
    var groups = Object.keys(thingsByKey).map(function (k) { return thingsByKey[k]; });
    groups.sort(function (a, b) {
      return layerOf(defByGameName(a.def)) - layerOf(defByGameName(b.def)) ||
        (a.def < b.def ? -1 : a.def > b.def ? 1 : 0);
    });
    groups.forEach(function (g) {
      toRects(g.cells).forEach(function (r) {
        var op;
        if (r[0] === r[2] && r[1] === r[3]) {
          op = withStuff({ def: g.def, x: r[0], z: r[1] }, g.stuff);
        } else {
          op = withStuff({ def: g.def, fill: 'filled', minX: r[0], minZ: r[1], maxX: r[2], maxZ: r[3] }, g.stuff);
        }
        if (g.rot) op.rot = g.rot;
        ops.push(op);
      });
    });

    // 3) 多格建筑（床/桌子/装配台）：一件一次调用
    singles.sort(function (a, b) { return a.kind - b.kind; });
    singles.forEach(function (s) { ops.push(s.op); });

    var cellCount = 0;
    ops.forEach(function (op) {
      if (op.fill) cellCount += (op.maxX - op.minX + 1) * (op.maxZ - op.minZ + 1);
      else cellCount += 1;
    });

    return {
      ops: ops,
      stats: {
        ops: ops.length,
        cells: cellCount,
        floors: packed.entries.filter(function (e) { return !!e.terrain; }).length,
        things: packed.entries.filter(function (e) { return !e.terrain; }).length,
        lockedSkipped: packed.lockedSkipped,
        skipped: packed.skipped
      }
    };
  }

  global.RWBuild = { toBuildOps: toBuildOps, toRects: toRects, defByGameName: defByGameName };
})(typeof window !== 'undefined' ? window : globalThis);
