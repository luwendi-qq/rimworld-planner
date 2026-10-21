/*
 * brief.js —— 「基地简报」：给没有存档访问权的 AI 看的一份精确快照
 *
 * 用途：玩家在网页里点「导出 AI 简报」，把文件贴给聊天 AI；AI 据此写 plan.json，
 * 玩家再「导入 AI 规划」合并回来。
 *
 * 精确度原则：
 *   1. 全部用**游戏坐标**（x 右、z 上），和存档 / build(x,z) / plan.json 一致。
 *   2. 玩家正在看的区域给**逐格**数据（默认 1 格 1 字符）＋ 精确的障碍矩形；
 *      区域外用粗粒度总览，明确标注「这里只是统计，别在这里下细活」。
 *   3. 地形按游戏 affordance 分五类，写清楚每一类能干什么：
 *        heavy  可承重（墙、家具、任何东西）
 *        light  只能铺地板/轻建筑，墙会倒
 *        water  没有可建造 affordance，要先铺桥
 *        rock   山体/矿石，要先开采
 *        none   其他（不可建）
 *   4. 库存写明范围（玩家区域 / 全地图），科技写清「已完成」和「当前研究」。
 *   5. 带 tick：AI 和玩家都能知道这份简报基于哪一版存档。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;
  var PI = global.RWPlanImport;

  var RANK = { ' ': 0, '.': 1, ',': 1, ':': 1, o: 2, '0': 2, '+': 3, '&': 3, '#': 4, '%': 4, '~': 5, '^': 6 };

  var CLASS_DEF = {
    heavy: '可承重：墙 / 家具 / 任何建筑',
    light: '只吃 Light：木墙/木家具可以，石头/钢/玻璃钢要 Heavy；浅水要铺桥，沼泽要垫地基（看 def 列）',
    water: '深水：没有任何可建造 affordance，要先铺桥',
    rock: '山体 / 矿石：要先开采',
    none: '其他不可建格'
  };

  function clampRect(state, r) {
    var x0 = Math.max(0, Math.min(state.cols - 1, Math.floor(r[0])));
    var z0 = Math.max(0, Math.min(state.rows - 1, Math.floor(r[1])));
    var x1 = Math.max(0, Math.min(state.cols - 1, Math.floor(r[2])));
    var z1 = Math.max(0, Math.min(state.rows - 1, Math.floor(r[3])));
    if (x1 < x0) { var t = x0; x0 = x1; x1 = t; }
    if (z1 < z0) { t = z0; z0 = z1; z1 = t; }
    return [x0, z0, x1, z1];
  }

  /**
   * 编辑器坐标 → {cls, def}
   * 先看游戏的 terrainAffordance，再看 isWater：
   * 沼泽也标着 isWater，但它有 Light —— 应该算「撑不住墙的软地」，不是「要铺桥的水面」。
   */
  function terrainInfoAt(editorX, editorZ) {
    var Site = global.RWSite;
    var rk = Site.rockAt(editorX, editorZ);
    if (rk) return { cls: 'rock', def: rk.def };
    var t = Site.terrainAt(editorX, editorZ);
    if (!t) return { cls: 'none', def: null };
    var aff = t.aff || [];
    if (aff.indexOf('Heavy') >= 0) return { cls: 'heavy', def: t.def };
    if (aff.indexOf('Light') >= 0) return { cls: 'light', def: t.def };
    if (t.isWater) return { cls: 'water', def: t.def };
    return { cls: 'none', def: t.def };
  }

  function terrainClassAt(editorX, editorZ) { return terrainInfoAt(editorX, editorZ).cls; }

  /** 玩家区域包围盒（编辑器坐标）。没有就返回 null */
  function homeBBox(state) {
    var home = state.home;
    if (!home || !home.cells || !home.w || !home.h) return null;
    var w = home.w, h = home.h, cells = home.cells;
    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (var z = 0; z < h; z++) {
      for (var x = 0; x < w; x++) {
        if (!cells[z * w + x]) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    return isFinite(minX) ? [minX, minZ, maxX, maxZ] : null;
  }

  /** 编辑器包围盒 → 游戏坐标包围盒 */
  function bboxToGame(state, b) {
    var a = PI.cellToGame(state, b[0], b[1]);
    var c = PI.cellToGame(state, b[2], b[3]);
    return [Math.min(a.x, c.x), Math.min(a.z, c.z), Math.max(a.x, c.x), Math.max(a.z, c.z)];
  }

  /** 每格的建筑字符（游戏坐标），一次遍历，避免逐格换算 */
  function buildingLayer(state) {
    var map = {};
    state.buildings.forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = global.RW.footprint(def, b.rot);
      var set = b.locked ? { wall: '%', door: '&', thing: '0' } : { wall: '#', door: '+', thing: 'o' };
      var tags = def.tags || [];
      var ch = tags.indexOf('door') >= 0 ? set.door : (tags.indexOf('solid') >= 0 ? set.wall : set.thing);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
        var g = PI.cellToGame(state, b.x + i, b.z + j);
        map[g.x + ',' + g.z] = { ch: ch, locked: !!b.locked, name: def.name };
      }
    });
    Object.keys(state.floors).forEach(function (k) {
      var p = k.split(',');
      var g = PI.cellToGame(state, +p[0], +p[1]);
      var locked = !!(state.lockedFloors && state.lockedFloors[k]);
      var cell = map[g.x + ',' + g.z];
      if (!cell) map[g.x + ',' + g.z] = { ch: locked ? ',' : '.', locked: locked };
    });
    return map;
  }

  /**
   * 游戏坐标矩形内，逐类障碍的精确矩形。
   * 只收集 region 里的格子，所以结果天然被裁剪在区域内。
   */
  function blockersInRegion(state, region) {
    var groups = {};   // "kind|def" -> {kind, def, cells}
    for (var gz = region[1]; gz <= region[3]; gz++) {
      for (var gx = region[0]; gx <= region[2]; gx++) {
        var e = PI.gameCellToEditor(state, gx, gz);
        var info = terrainInfoAt(e.x, e.z);
        if (info.cls === 'heavy') continue;
        var key = info.cls + '|' + (info.def || '');
        var g = groups[key] || (groups[key] = { kind: info.cls, def: info.def, cells: [] });
        g.cells.push([e.x, e.z]);
      }
    }
    var out = [];
    Object.keys(groups).forEach(function (key) {
      var g = groups[key];
      global.RWBuild.toRects(g.cells).forEach(function (r) {
        var gg = PI.rectToGame(state, r);
        out.push({ kind: g.kind, def: g.def, x0: gg[0], z0: gg[1], x1: gg[2], z1: gg[3] });
      });
    });
    return out;
  }

  /** 全区统计（分类计数） */
  function wholeCounts(state) {
    var counts = { heavy: 0, light: 0, water: 0, rock: 0, none: 0 };
    for (var z = 0; z < state.rows; z++) {
      for (var x = 0; x < state.cols; x++) counts[terrainClassAt(x, z)]++;
    }
    return counts;
  }

  /**
   * 区域 ASCII（游戏坐标）。
   * step > 1 时块内取优先级最高的字符（岩 > 水 > 墙 > 门 > 建筑 > 地板），偏保守。
   */
  function regionAscii(state, region, step, bLayer) {
    step = Math.max(1, step | 0);
    var lines = [];
    var width = region[2] - region[0] + 1;

    for (var gz = region[3]; gz >= region[1]; gz -= step) {
      var line = '';
      for (var gx = region[0]; gx <= region[2]; gx += step) {
        var best = ' ', bestRank = -1;
        for (var dz = 0; dz < step; dz++) {
          for (var dx = 0; dx < step; dx++) {
            var x = gx + dx, z = gz - dz;
            if (z < region[1] || x > region[2]) continue;
            var cell = bLayer[x + ',' + z];
            var ch = cell ? cell.ch : null;
            if (!ch) {
              var e = PI.gameCellToEditor(state, x, z);
              var info = terrainInfoAt(e.x, e.z);
              ch = info.cls === 'rock' ? '^' : info.cls === 'water' ? '~' : info.cls === 'light' ? ':' : info.cls === 'none' ? '!' : ' ';
            }
            var rk = RANK[ch] == null ? 0 : RANK[ch];
            if (rk > bestRank) { best = ch; bestRank = rk; }
          }
        }
        line += best;
      }
      lines.push(line.replace(/\s+$/, ''));
    }

    // 坐标标尺：左边 z，上方 x
    var gutter = String(region[3]).length + 1;
    var tickEvery = Math.max(1, Math.round(10 / step));
    var head = ' '.repeat(gutter);
    for (var c = 0; c < Math.ceil(width / step); c++) head += (c % tickEvery === 0) ? '|' : ' ';
    var nums = ' '.repeat(gutter) + Array.from({ length: Math.ceil(width / step) }, function (_, i) {
      if (i % tickEvery) return ' ';
      var label = String(region[0] + i * step);
      return label.length <= tickEvery ? label.padEnd(tickEvery, ' ') : label.slice(0, tickEvery);
    }).join('').replace(/\s+$/, '');
    var body = lines.map(function (line, i) {
      var z = region[3] - i * step;
      return String(z).padStart(gutter - 1, ' ') + ' ' + line;
    });
    return [head.replace(/\s+$/, ''), nums].concat(body);
  }

  function defRow(def) {
    var g = global.RWExport.gameDefName(def);
    if (!g) return null;
    var size = Array.isArray(def.size) ? def.size.join('×') : '1×1';
    var cost = '';
    if (def.cost) {
      cost = Object.keys(def.cost).map(function (k) { return k + ':' + def.cost[k]; }).join(',');
    }
    if (def.costStuff) cost += (cost ? ',' : '') + 'stuff×' + def.costStuff;
    var power = '';
    if (def.powerUse) power = '-' + def.powerUse;
    else if (def.powerGen) power = '+' + def.powerGen;
    else if (def.powerStore) power = '=' + def.powerStore;
    return {
      def: g, name: def.name, cat: def.cat, size: size,
      rot: def.rotatable === false ? 'no' : 'yes',
      stuff: (def.stuffCats || []).join('/'),
      terrain: def.aff || '',
      power: power,
      cost: cost,
      research: (def.research || []).join(',')
    };
  }

  /**
   * @param {object} state
   * @param {object} [opts] {rect:[x0,z0,x1,z1] 游戏坐标, pad:8, maxWidth:160}
   */
  function build(state, opts) {
    opts = opts || {};
    var pad = opts.pad == null ? 8 : opts.pad;
    var maxWidth = opts.maxWidth || 160;

    // ---- 区域：优先用调用方给的（网页传当前视口），否则玩家区域 + pad，再否则全图 ----
    var rect = null;
    var regionSource = opts.source || 'viewport';
    if (opts.rect) {
      rect = clampRect(state, opts.rect);
      regionSource = 'viewport';
    } else {
      var home = homeBBox(state);
      if (home) {
        rect = clampRect(state, [home[0] - pad, home[1] - pad, home[2] + pad, home[3] + pad]);
        var g = bboxToGame(state, rect);
        rect = clampRect(state, g);
        regionSource = 'home';
      } else {
        rect = [0, 0, state.cols - 1, state.rows - 1];
        regionSource = 'whole-map';
      }
    }

    var width = rect[2] - rect[0] + 1;
    var step = Math.max(1, Math.ceil(width / maxWidth));

    var bLayer = buildingLayer(state);
    var regionCounts = { heavy: 0, light: 0, water: 0, rock: 0, none: 0 };
    for (var gz = rect[1]; gz <= rect[3]; gz++) {
      for (var gx = rect[0]; gx <= rect[2]; gx++) {
        var e = PI.gameCellToEditor(state, gx, gz);
        regionCounts[terrainClassAt(e.x, e.z)]++;
      }
    }

    var lockedCount = 0, lockedInRegion = 0;
    var eb = [Infinity, Infinity, -Infinity, -Infinity];
    state.buildings.forEach(function (b) {
      if (!b.locked) return;
      lockedCount++;
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = global.RW.footprint(def, b.rot);
      var a = PI.cellToGame(state, b.x, b.z);
      var c = PI.cellToGame(state, b.x + fp[0] - 1, b.z + fp[1] - 1);
      var x0 = Math.min(a.x, c.x), x1 = Math.max(a.x, c.x);
      var z0 = Math.min(a.z, c.z), z1 = Math.max(a.z, c.z);
      eb[0] = Math.min(eb[0], x0); eb[1] = Math.min(eb[1], z0);
      eb[2] = Math.max(eb[2], x1); eb[3] = Math.max(eb[3], z1);
      if (!(x1 < rect[0] || x0 > rect[2] || z1 < rect[1] || z0 > rect[3])) lockedInRegion++;
    });

    var colonists = ((state.saveInfo && state.saveInfo.pawns) || [])
      .filter(function (p) { return !p.dead; })
      .map(function (p) {
        var s = p.skills || {};
        function lv(k) { return s[k] ? s[k].level : null; }
        return { name: p.name, construction: lv('Construction'), mining: lv('Mining'), intellectual: lv('Intellectual') };
      });

    var research = (state.saveInfo && state.saveInfo.research) || null;
    var completed = [];
    if (research && research.progress) {
      completed = Object.keys(research.progress).filter(function (d) {
        return Data.researchDone ? Data.researchDone(research, d) : false;
      }).map(function (d) {
        var r = Data.research ? Data.research(d) : null;
        return r ? (r.name || d) : d;
      });
    }

    var stockObj = (state.saveInfo && state.saveInfo.resources) || {};
    var stock = Object.keys(stockObj)
      .sort(function (a, b) { return stockObj[b] - stockObj[a]; })
      .map(function (k) { return { def: k, n: stockObj[k] }; });

    var defs = [];
    Object.keys(Data.byId).sort().forEach(function (id) {
      var row = defRow(Data.byId[id]);
      if (row) defs.push(row);
    });

    return {
      briefVersion: 1,
      planFormat: 1,
      tool: 'rimworld-planner',
      generatedAt: new Date().toISOString(),
      save: {
        colony: (state.saveInfo && state.saveInfo.colonyName) || '',
        project: state.mapName || '',
        tick: (state.saveInfo && state.saveInfo.tick) || 0,
        gameVersion: (state.saveInfo && state.saveInfo.version) || '',
        difficulty: (state.saveInfo && state.saveInfo.difficulty) || ''
      },
      map: {
        w: state.cols, h: state.rows,
        coord: 'x 向右为 +x，z 向上为 +z；和存档 / build(x,z) / plan.json 完全一致'
      },
      region: {
        source: regionSource,
        rect: rect,
        step: step,
        note: step > 1
          ? '每字符代表 ' + step + '×' + step + ' 格；块内任一是岩/水/墙就按那个标（偏保守），下笔前用 rects 精确核对'
          : '逐格：1 字符 = 1 格'
      },
      terrain: {
        classDef: CLASS_DEF,
        regionCounts: regionCounts,
        wholeCounts: wholeCounts(state),
        rects: blockersInRegion(state, rect)
      },
      ascii: {
        legend: {
          ' ': '可承重空地', ':': 'Light 地形（软地/沼泽/浅水，看 rects 的 def）', '^': '山体/矿石（要挖）',
          '~': '水（要桥）', '!': '不可建',
          '#': '新规划·墙', '+': '新规划·门', 'o': '新规划·其他建筑', '.': '新规划·地板',
          '%': '存档原有·墙', '&': '存档原有·门', '0': '存档原有·建筑', ',': '存档原有·地板'
        },
        lines: regionAscii(state, rect, step, bLayer)
      },
      existing: {
        count: lockedCount,
        inRegion: lockedInRegion,
        bbox: isFinite(eb[0]) ? eb : null
      },
      colonists: colonists,
      research: {
        current: research ? research.current : null,
        currentProgress: research && research.current ? (research.progress[research.current] || 0) : 0,
        currentCost: research && research.current && Data.research(research.current)
          ? Data.research(research.current).cost : null,
        completed: completed
      },
      stock: {
        scope: state.useHomeStock === false ? 'all' : 'home',
        note: state.useHomeStock === false ? '全地图库存' : '玩家区域内库存（默认）',
        items: stock
      },
      defs: defs,
      rules: [
        '门要留在墙的缺口里，不要和墙同一格',
        '地图最外圈 1 格不可建造（x=0 / x=' + (state.cols - 1) + ' / z=0 / z=' + (state.rows - 1) +
          '）。这是**地图边界**，不是本简报的区域边界，别混',
        '地形要求由**材质**决定：木墙/木家具只要 light 就够；石头/钢/玻璃钢要 heavy。' +
          'light 里的浅水要铺桥、沼泽要垫地基；water（深水）什么墙都放不了；rock 要先开采',
        '跨格建筑不能重叠。例外：电缆可埋墙下；壁灯 / 壁挂火把可以贴墙共存；' +
          '制冷机、通风格栅、被动散热器会**占掉**那格墙',
        '房间必须能走进去，否则房间判定 / 温控 / 空间评分都不成立',
        '电力按 6 格连接，但至少一端要是输电建筑（电缆/开关/发电机/电池）；两个纯用电器不会自动连',
        '制冷机台数 ≈ ceil(面积 × 温差 ÷ 630)；冷冻库要在 plan.json 里写 roomTemp',
        'planner 不校验交互格 / 使用区 / 风道，见下面的「摆放注意」'
      ],
      placement: [
        '制冷机 / 加热器：rot 决定冷端朝向；冷端朝室内，冷热两端格都不能堵。制冷机自己就是那格墙',
        '壁灯 / 壁挂火把：真正贴在墙上，不占墙格',
        '马蹄铁 / 电视 / 台球桌：要有使用区（watch area），至少一侧留空；电视要椅子或床朝向它',
        '象棋桌 / 餐桌：要配套座位（椅子/凳子），座位朝桌子，别把座位堵死',
        '风力发电机：前后风道不能有建筑、山体或高墙遮挡',
        '太阳能板：不能有屋顶或遮挡，别贴着高墙',
        '工作台 / 研究台：交互格（通常正面一格）要留空；高级研究台旁边要留多分析仪的位置',
        '医疗床：旁边要留生命维持仪的位置；床两侧要能走',
        '门：两侧都要能通行，别对着墙；自动门还要接电',
        '陷阱：放在敌人必经的通道，别放在殖民者每天必经的路上',
        '电池：接进同一张电网，别孤网空转',
        '冷库：制冷机热端朝室外或大空间，否则等于给隔壁房间加热',
        '地板不是必须的：不保温，只影响美观 / 清洁 / 移速。冷库、工坊可以不铺；木地板还会烧'
      ],
      questions: [
        '这个空间给谁用？住几个人、要几张床（单人还是双人）？',
        '需要哪些功能间：卧室 / 厨房+冷库 / 工坊 / 研究室 / 餐厅 / 娱乐 / 医务 / 监狱 / 畜栏？',
        '预算和材料：木头、石头、钢各有多少？优先用哪种？要不要铺地板（不保温，只影响美观/清洁）？',
        '科技到哪一步：有没有电力、自动门、太阳能、空调、机枪塔？',
        '防御要做到什么程度：围墙 / 沙袋 / 陷阱 / 机枪塔 / 逃生通道？',
        '位置偏好：贴着现有基地扩建、靠山、靠水，还是独立新建？',
        '温控要求：卧室 21°C？冷库 -10°C？有没有需要无菌的房间？',
        '最多占多少格？有没有不能动的东西（电缆、矿脉、遗迹、树）？'
      ]
    };
  }

  // ---------------------------------------------------------------- markdown
  function md(b) {
    var L = [];
    function p(s) { L.push(s == null ? '' : s); }

    p('# RimWorld 基地简报（给 AI）');
    p('');
    p('> 这是玩家存档的一份**精确快照**。请据此输出 `plan.json`，不要凭空猜地形或库存。');
    p('> 生成时间：' + b.generatedAt + '　存档 tick：' + b.save.tick +
      '　殖民地名：' + (b.save.colony || '（存档没记）') +
      '　工程名：' + (b.save.project || '（未命名）') +
      '　版本：' + (b.save.gameVersion || '?'));
    p('');
    p('## 0. 开工前先问清楚（不要直接开干）');
    p('');
    p('如果玩家只说了「造个房子 / 造个基地」这种程度，**先问完下面这几条再写 plan.json**。');
    p('问的时候一次问 3–4 条，别一口气甩 8 个问题。');
    p('');
    b.questions.forEach(function (q, i) { p((i + 1) + '. ' + q); });
    p('');
    p('拿不准就按保守值做，并在方案里标出「这里我假设了 X」。');
    p('');
    p('## 1. 坐标与区域');
    p('');
    p('- 地图：' + b.map.w + ' × ' + b.map.h + '　' + b.map.coord);
    p('- 本简报的细区：`[' + b.region.rect.join(', ') + ']`（x0,z0,x1,z1，含端点），来源：' +
      (b.region.source === 'selection' ? '**玩家框选的区域**' :
       b.region.source === 'rect' ? '命令行指定的区域' :
       b.region.source === 'home' ? '玩家活动区域 + 边距' :
       b.region.source === 'viewport' ? '玩家当前视口' : '整张地图'));
    p('- 这个矩形就是本简报的**全部细粒度数据范围**；边界和地图边界无关。' +
      '地图最外圈 1 格（x=0 / x=' + (b.map.w - 1) + ' / z=0 / z=' + (b.map.h - 1) + '）才不可建造。');
    p('- ' + b.region.note);
    p('- 已有的建筑（存档里的）共 **' + b.existing.count + '** 件，其中 **' + b.existing.inRegion +
      '** 件在本区域里：图上是 `% & 0 ,`，**不要覆盖它们**；区域外的没画。');
    p('');
    p('## 2. 地图（游戏坐标，上行是 +z）');
    p('');
    p('```');
    b.ascii.lines.forEach(function (l) { p(l); });
    p('```');
    p('');
    p('图例：' + Object.keys(b.ascii.legend).map(function (k) {
      return '`' + (k === ' ' ? '␠' : k) + '` ' + b.ascii.legend[k];
    }).join(' · '));
    p('');
    p('## 3. 地形分类（精确）');
    p('');
    p('| 类别 | 含义 | 本区域 | 全图 |');
    p('| --- | --- | ---: | ---: |');
    ['heavy', 'light', 'water', 'rock', 'none'].forEach(function (k) {
      p('| `' + k + '` | ' + b.terrain.classDef[k] + ' | ' + b.terrain.regionCounts[k] + ' | ' + b.terrain.wholeCounts[k] + ' |');
    });
    p('');
    p('**区域内障碍的精确矩形**（x0,z0,x1,z1，含端点）。下笔前用这个核对，别只看图：');
    p('');
    p('| 类别 | 地形 def | x0 | z0 | x1 | z1 |');
    p('| --- | --- | ---: | ---: | ---: | ---: |');
    if (!b.terrain.rects.length) p('| — | | | | | |');
    b.terrain.rects.forEach(function (r) {
      p('| `' + r.kind + '` | `' + (r.def || '?') + '` | ' + r.x0 + ' | ' + r.z0 + ' | ' + r.x1 + ' | ' + r.z1 + ' |');
    });
    p('');
    p('## 4. 殖民者与科技');
    p('');
    p('| 名字 | 建造 | 采矿 | 智识 |');
    p('| --- | ---: | ---: | ---: |');
    b.colonists.forEach(function (c) {
      p('| ' + c.name + ' | ' + (c.construction == null ? '?' : c.construction) + ' | ' +
        (c.mining == null ? '?' : c.mining) + ' | ' + (c.intellectual == null ? '?' : c.intellectual) + ' |');
    });
    p('');
    p('- 当前研究：' + (b.research.current
      ? b.research.current + '（' + Math.round(b.research.currentProgress || 0) + '/' + (b.research.currentCost || '?') + '）'
      : '无'));
    p('- 已完成（' + b.research.completed.length + '）：' + (b.research.completed.join('、') || '无'));
    p('');
    p('## 5. 库存（精确数量）');
    p('');
    p('范围：' + b.stock.note + '。');
    p('');
    p('| 物品 | 数量 | 物品 | 数量 |');
    p('| --- | ---: | --- | ---: |');
    for (var i = 0; i < b.stock.items.length; i += 2) {
      var a = b.stock.items[i], c2 = b.stock.items[i + 1];
      p('| `' + a.def + '` | ' + a.n + ' | ' + (c2 ? '`' + c2.def + '` | ' + c2.n : ' | ') + ' |');
    }
    p('');
    p('## 6. 建筑表（写 plan.json 只能用这里的 def）');
    p('');
    p('| def | 名称 | 尺寸 | 可旋转 | 可换材质 | 地形要求 | 电 | 造价 | 科技前置 |');
    p('| --- | --- | --- | --- | --- | --- | ---: | --- | --- |');
    b.defs.forEach(function (d) {
      p('| `' + d.def + '` | ' + d.name + ' | ' + d.size + ' | ' + d.rot + ' | ' +
        (d.stuff || '—') + ' | ' + (d.terrain || '—') + ' | ' + (d.power || '—') + ' | ' +
        (d.cost || '—') + ' | ' + (d.research || '—') + ' |');
    });
    p('');
    p('> 「地形要求」是不指定材质时的要求。**有材质时按材质算**：木头 = Light，');
    p('> 钢 = Medium，石头 = Heavy。所以木墙能建在沼泽/软地上，石墙不行。');
    p('> 像 `WaterproofConduit` 这种要求特殊 affordance 的，只能放在对应地形上（水里）。');
    p('');
    p('## 7. plan.json 格式');
    p('');
    p('```json');
    p('{');
    p('  "name": "基地 v1",');
    p('  "materials": { "Wall": "WoodLog", "Bed": "Cloth" },');
    p('  "buildings": [');
    p('    { "def": "Wall", "x": 100, "z": 100 },');
    p('    { "def": "Door", "x": 110, "z": 100 },');
    p('    { "def": "Bed",  "x": 104, "z": 104, "rot": 1 }');
    p('  ],');
    p('  "floors": { "100,100": "WoodPlankFloor" },');
    p('  "roomTemp": [ { "at": [105,105], "c": -10 } ]');
    p('}');
    p('```');
    p('');
    p('- `def` / `stuff` / 地板名都用**游戏 defName**（上表第一列）。');
    p('- `rot`：0 北 / 1 东 / 2 南 / 3 西。多格建筑只给 Position（中心锚点，不是左下角）。');
    p('- `floors` 的 key 是 `"x,z"`，value 是 TerrainDef（如 `WoodPlankFloor`）。**可以为空**：地板不保温，');
    p('  只影响美观 / 清洁 / 移速；冷库、工坊可以不铺，木地板还会烧。');
    p('- `materials` 的 key 必须是**你实际用的 defName**（用 `GrayWall` 就写 `GrayWall`）。');
    p('  写成 `Wall` 不会生效，会静默退回自动选材 —— 导入时会给出警告。');
    p('- 冷冻库写 `roomTemp`，否则规划器按 21°C 算，不会给数制冷机。');
    p('- 不写 `stuff` 时，导入会从库存里自动挑（木头/布料优先）；想指定就写 `materials`。');
    p('');
    p('## 8. 摆放注意（planner 不校验，放的时候看游戏里的范围提示）');
    p('');
    b.placement.forEach(function (x) { p('- ' + x); });
    p('');
    p('> 游戏侧的 `list_architect` 会给出每件建筑的 `placement`（交互格、watch area、排烟口、射程）；');
    p('> 能查就查，查不到就按上面这几条保守留空。');
    p('');
    p('## 9. 硬规则');
    p('');
    b.rules.forEach(function (r) { p('- ' + r); });
    p('');
    p('> 玩家会把你的 plan.json 导入网页，那里会跑一遍校验。带着 `error` 的方案会被退回，');
    p('> 所以宁可保守：拿不准的格子不要放墙，多留一格通道。');
    p('');

    return L.join('\n');
  }

  global.RWBrief = { build: build, toMarkdown: md, terrainClassAt: terrainClassAt };
})(typeof window !== 'undefined' ? window : globalThis);
