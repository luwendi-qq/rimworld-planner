/*
 * planimport.js —— 把 AI 写的 plan.json 合并到当前工程
 *
 * 命令行（tools/plan.js apply）和网页（顶栏「导入 AI 规划」）走的是**同一个函数**。
 * 这一层必须只有一份实现：坐标翻转、多格建筑锚点、材质、房间温度、撞车检测，
 * 任何一处两边写法不同，AI 就会在网页里看到和 CLI 不一样的结果。
 *
 * 坐标约定：plan.json 里的一切都是**游戏坐标**（x 向右、z 向上），
 * 内部画布坐标（z 向下）的换算只在这个文件里发生。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  function gameDefName(def) { return global.RWExport.gameDefName(def); }

  /** 游戏 defName / 内部 id / 中文名 → 建筑定义 */
  function resolveDef(name) {
    if (!name) return null;
    var byId = Data.byId || {};
    if (byId[name]) return byId[name];
    var lower = String(name).toLowerCase();
    if (byId[lower]) return byId[lower];
    var hit = null;
    var ids = Object.keys(byId);
    for (var i = 0; i < ids.length; i++) {
      var d = byId[ids[i]];
      var g = gameDefName(d);
      if (g && g.toLowerCase() === lower) { hit = d; break; }
      if (d.name === name) { hit = d; break; }
    }
    return hit;
  }

  /** TerrainDef / 内部地板 id / 中文名 → 地板 id */
  function resolveFloor(name) {
    var floors = Data.floorsById || {};
    if (floors[name]) return name;
    var lower = String(name).toLowerCase();
    var ids = Object.keys(floors);
    for (var i = 0; i < ids.length; i++) {
      var f = floors[ids[i]];
      if (String(f.def || '').toLowerCase() === lower) return ids[i];
      if (String(f.name || '') === name) return ids[i];
    }
    return null;
  }

  // ---------------------------------------------------------------- 宽松 JSON
  // AI 写的 plan.json 经常带 // 注释或最后多一个逗号。标准 JSON 不允许，
  // 但这对工作文件没什么意义 —— 先按严格 JSON 读，失败再宽容一次，并给出警告。
  function stripComments(src) {
    var out = '', i = 0, inStr = false, esc = false;
    while (i < src.length) {
      var c = src.charAt(i), n = src.charAt(i + 1);
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; out += c; i++; continue; }
      if (c === '/' && n === '/') {
        while (i < src.length && src.charAt(i) !== '\n') i++;
        continue;
      }
      if (c === '/' && n === '*') {
        i += 2;
        while (i < src.length && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) i++;
        i += 2;
        continue;
      }
      out += c;
      i++;
    }
    return out;
  }

  function stripTrailingCommas(src) {
    var out = '', i = 0, inStr = false, esc = false;
    while (i < src.length) {
      var c = src.charAt(i);
      if (inStr) {
        out += c;
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        i++;
        continue;
      }
      if (c === '"') { inStr = true; out += c; i++; continue; }
      if (c === ',') {
        var j = i + 1;
        while (j < src.length && /\s/.test(src.charAt(j))) j++;
        var nx = src.charAt(j);
        if (nx === '}' || nx === ']') { i++; continue; }   // 丢掉尾逗号
      }
      out += c;
      i++;
    }
    return out;
  }

  /** @returns {{plan:object, warnings:string[]}} */
  function parsePlan(text) {
    var warnings = [];
    try {
      return { plan: JSON.parse(text), warnings: warnings };
    } catch (strictErr) {
      var cleaned = stripTrailingCommas(stripComments(String(text)));
      try {
        var plan = JSON.parse(cleaned);
        warnings.push('plan.json 不是严格 JSON（有 // 注释或多余的尾逗号），已按宽松模式读取；标准 JSON 不允许这些写法');
        return { plan: plan, warnings: warnings };
      } catch (looseErr) {
        throw new Error('plan.json 解析失败：' + looseErr.message);
      }
    }
  }

  /** 游戏 Position + 朝向 → 画布坐标里多格建筑的最小角 */
  function gameThingToEditor(state, def, rotDeg, gx, gz) {
    var RW = global.RW;
    var fp = RW.footprint(def, rotDeg);
    var w = fp[0], h = fp[1];
    var off = RW.anchorOffset((Math.round(rotDeg / 90) % 4 + 4) % 4, w, h);
    var minX = gx - off.x, minZ = gz - off.z;
    return {
      x: state.flipX ? state.cols - 1 - (minX + w - 1) : minX,
      z: state.flipZ !== false ? state.rows - 1 - (minZ + h - 1) : minZ,
      w: w, h: h
    };
  }

  /** 画布里的建筑 → 游戏 Position（gameThingToEditor 的逆运算） */
  function editorThingToGame(state, def, rotDeg, ex, ez) {
    var RW = global.RW;
    var fp = RW.footprint(def, rotDeg);
    var w = fp[0], h = fp[1];
    var minX = state.flipX ? state.cols - 1 - (ex + w - 1) : ex;
    var minZ = state.flipZ !== false ? state.rows - 1 - (ez + h - 1) : ez;
    var off = RW.anchorOffset((Math.round(rotDeg / 90) % 4 + 4) % 4, w, h);
    return { x: minX + off.x, z: minZ + off.z };
  }

  /** 画布单元格 → 游戏坐标 */
  function cellToGame(state, x, z) {
    return {
      x: state.flipX ? state.cols - 1 - x : x,
      z: state.flipZ !== false ? state.rows - 1 - z : z
    };
  }

  /** 游戏坐标 → 画布单元格（和 cellToGame 同一个公式，互为反函数） */
  function gameCellToEditor(state, x, z) {
    return cellToGame(state, x, z);
  }

  /** 画布矩形 → 游戏坐标矩形（翻转后仍是矩形） */
  function rectToGame(state, r) {
    var xa = state.flipX ? state.cols - 1 - r[2] : r[0];
    var xb = state.flipX ? state.cols - 1 - r[0] : r[2];
    var za = state.flipZ !== false ? state.rows - 1 - r[3] : r[1];
    var zb = state.flipZ !== false ? state.rows - 1 - r[1] : r[3];
    return [Math.min(xa, xb), Math.min(za, zb), Math.max(xa, xb), Math.max(za, zb)];
  }

  /**
   * 没指定材质时从库存里挑一个。优先木头/布料，钢和稀有金属留着急用。
   * 挑不到库存里的，就退回该 def 能接受的最常见材质。
   */
  function pickStuff(def, stock) {
    if (!def || !def.stuffCats || !def.stuffCats.length) return null;
    var list = Data.stuffsFor ? Data.stuffsFor(def) : [];
    if (!list || !list.length) return null;
    var PREF = ['WoodLog', 'Cloth', 'Leather_Plain',
      'BlocksSandstone', 'BlocksGranite', 'BlocksLimestone', 'BlocksSlate', 'BlocksMarble',
      'Steel', 'Plasteel', 'Silver', 'Gold', 'Uranium', 'Jade'];
    function rank(s) {
      var i = PREF.indexOf(s.def);
      return i < 0 ? PREF.length + 1 : i;
    }
    var owned = list.filter(function (s) { return (stock[s.def] || 0) > 0; })
      .sort(function (a, b) { return rank(a) - rank(b) || (stock[b.def] || 0) - (stock[a.def] || 0); });
    if (owned.length) return owned[0].def;
    var any = list.slice().sort(function (a, b) { return rank(a) - rank(b); });
    return any[0] ? any[0].def : null;
  }

  /** 新规划压到了哪些「存档原有」建筑（扩建时最常见：已标拆除但还没拆完） */
  function findLockedOverlaps(state) {
    var planCells = {};
    state.buildings.forEach(function (b) {
      if (b.src !== 'plan') return;
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = global.RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) {
        planCells[(b.x + i) + ',' + (b.z + j)] = true;
      }
    });

    var out = [];
    state.buildings.forEach(function (b) {
      if (!b.locked) return;
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = global.RW.footprint(def, b.rot);
      var hits = 0, cells = 0, i, j;
      for (i = 0; i < fp[0]; i++) for (j = 0; j < fp[1]; j++) {
        cells++;
        if (planCells[(b.x + i) + ',' + (b.z + j)]) hits++;
      }
      if (!hits) return;
      var gp = editorThingToGame(state, def, b.rot, b.x, b.z);
      out.push({
        uid: b.uid,
        def: gameDefName(def) || def.id,
        name: def.name, x: gp.x, z: gp.z,
        rot: (Math.round(b.rot / 90) % 4 + 4) % 4,
        cells: cells, covered: hits
      });
    });
    return out;
  }

  /**
   * 把 plan.json 合并进 state。
   *
   * 规则（和 CLI 完全一致）：
   *   - 先撤掉上一次 src === 'plan' 的东西，再重放（幂等，可反复改同一份 plan）
   *   - 存档带来的建筑带 locked，永远不动；除非 opts.clear 且确实被新规划压到
   *   - 地板：未锁定的会被重写（lockedFloors 才是存档原有的）
   *   - roomTemp: [{at:[x,z], c:-10}] 或 { "x,z": -10 }，按游戏坐标给整间房设温度
   *
   * @returns {{errors:Array, warnings:Array, replaced:Object, applied:Object,
   *            stuffAssumed:Object, demolish:Array, cleared:number, roomTemp:Array}}
   */
  function apply(state, plan, opts) {
    opts = opts || {};
    var autoStuff = opts.autoStuff !== false;
    var stock = (state.saveInfo && state.saveInfo.resources) || {};

    var errors = [], warnings = [], stuffAssumed = {};

    var before = state.buildings.length;
    state.buildings = state.buildings.filter(function (b) { return b.src !== 'plan'; });
    var removed = before - state.buildings.length;

    var removedFloors = 0;
    Object.keys(state.floors).forEach(function (k) {
      if (!(state.lockedFloors && state.lockedFloors[k])) { delete state.floors[k]; removedFloors++; }
    });

    var materials = plan.materials || {};
    var usedMat = {};
    var usedDefs = {};
    var matWarned = {};
    var added = 0;

    (plan.buildings || []).forEach(function (b, i) {
      var name = b.def || b.defId;
      var def = resolveDef(name);
      if (!def) {
        errors.push({ at: 'buildings[' + i + ']', msg: '不认识的建筑：' + name });
        return;
      }
      var rot = b.rot == null ? 0 : (((b.rot | 0) % 4) + 4) % 4;
      var rotDeg = def.rotatable === false ? 0 : rot * 90;
      var gx = b.x, gz = b.z;
      if (!Number.isFinite(gx) || !Number.isFinite(gz)) {
        errors.push({ at: 'buildings[' + i + ']', msg: 'x/z 必须是数字' });
        return;
      }
      var ed = gameThingToEditor(state, def, rotDeg, gx, gz);
      if (ed.x < 0 || ed.z < 0 || ed.x + ed.w > state.cols || ed.z + ed.h > state.rows) {
        errors.push({ at: 'buildings[' + i + ']', msg: name + ' 在 (' + gx + ',' + gz + ') 超出地图范围' });
        return;
      }
      var matKey = null;
      var stuff = b.stuff || null;
      if (!stuff && materials[name] != null) { stuff = materials[name]; matKey = name; }
      else if (!stuff && materials[def.id] != null) { stuff = materials[def.id]; matKey = def.id; }
      if (matKey) {
        usedMat[matKey] = true;
        if ((!def.stuffCats || !def.stuffCats.length) && !matWarned[matKey]) {
          matWarned[matKey] = true;
          warnings.push('"' + matKey + '" 不能换材质（' + def.name + '），materials 里给它的材质会被忽略');
        }
      }
      usedDefs[gameDefName(def) || name] = true;
      if (!stuff && autoStuff) {
        stuff = pickStuff(def, stock);
        if (stuff) stuffAssumed[gameDefName(def) || name] = stuff;
      }
      state.buildings.push({
        uid: state.nextUid++, defId: def.id, x: ed.x, z: ed.z, rot: rotDeg,
        color: null, stuff: stuff, bedMode: b.bedMode || null, src: 'plan'
      });
      added++;
    });

    Object.keys(plan.floors || {}).forEach(function (key) {
      var p = key.split(',');
      var gx = +p[0], gz = +p[1];
      var floorId = resolveFloor(plan.floors[key]);
      if (!floorId) { errors.push({ at: 'floors["' + key + '"]', msg: '不认识的地板：' + plan.floors[key] }); return; }
      var ed = gameCellToEditor(state, gx, gz);
      var ex = ed.x, ez = ed.z;
      if (ex < 0 || ez < 0 || ex >= state.cols || ez >= state.rows) {
        errors.push({ at: 'floors["' + key + '"]', msg: '超出地图范围' });
        return;
      }
      var ek = ex + ',' + ez;
      if (state.lockedFloors && state.lockedFloors[ek]) { warnings.push('地板 ' + key + ' 是存档原有的（锁定），跳过'); return; }
      state.floors[ek] = floorId;
    });

    // ---- 和存档原有建筑撞车 ----
    var demolish = findLockedOverlaps(state);
    var clearUids = {};
    demolish.forEach(function (d) { clearUids[d.uid] = true; delete d.uid; });

    var cleared = 0;
    if (opts.clear && demolish.length) {
      state.buildings = state.buildings.filter(function (b) { return !clearUids[b.uid]; });
      cleared = demolish.length;
    } else if (demolish.length) {
      warnings.push('新规划和 ' + demolish.length + ' 个存档原有建筑重叠：先拆掉它们，或选择「无视旧建筑」');
    }

    // ---- 房间目标温度 ----
    var tempSpecs = [];
    if (Array.isArray(plan.roomTemp)) {
      plan.roomTemp.forEach(function (t, i) {
        var at = t.at || [t.x, t.z];
        if (!Array.isArray(at) || at.length < 2) { errors.push({ at: 'roomTemp[' + i + ']', msg: '要写 at:[x,z]' }); return; }
        tempSpecs.push({ at: [+at[0], +at[1]], c: t.c != null ? Number(t.c) : (t.temp != null ? Number(t.temp) : null) });
      });
    } else if (plan.roomTemp && typeof plan.roomTemp === 'object') {
      Object.keys(plan.roomTemp).forEach(function (k) {
        var p = k.split(',');
        tempSpecs.push({ at: [+p[0], +p[1]], c: Number(plan.roomTemp[k]) });
      });
    }

    var roomsApplied = [];
    if (tempSpecs.length) {
      var rooms = (global.RWChecks.analyse(state).rooms) || [];
      tempSpecs.forEach(function (spec) {
        var ed = cellToGame(state, spec.at[0], spec.at[1]);
        var room = rooms.filter(function (r) {
          return Array.isArray(r.cells) && r.cells.some(function (c) { return c[0] === ed.x && c[1] === ed.z; });
        })[0];
        if (!room) {
          warnings.push('目标温度：(' + spec.at[0] + ',' + spec.at[1] + ') 不在任何封闭房间里（还没围起来？）');
          return;
        }
        var c = (spec.c == null || !isFinite(spec.c) || spec.c === 21) ? null
          : Math.max(-60, Math.min(60, Math.round(spec.c)));
        room.cells.forEach(function (cell) {
          var k = cell[0] + ',' + cell[1];
          if (c == null) delete state.roomTemp[k]; else state.roomTemp[k] = c;
        });
        roomsApplied.push({ at: spec.at, c: c, area: room.area });
      });
    }

    // materials 的 key 写错（比如用了 GrayWall 却写 "Wall"）时不会报错，只会静默退回自动选材。
    // 这会让「我明明指定了木头」和实际材质对不上，所以明确提示。
    var unusedMat = Object.keys(materials).filter(function (k) { return !usedMat[k]; });
    if (unusedMat.length) {
      warnings.push('materials 里的 ' + unusedMat.map(function (k) { return '"' + k + '"'; }).join('、') +
        ' 没有对应的建筑（这次用的是 ' + Object.keys(usedDefs).join('、') +
        '）。material 的 key 要写建筑的 defName');
    }

    state.mapName = plan.name || state.mapName;

    return {
      errors: errors, warnings: warnings,
      replaced: { buildings: removed, floors: removedFloors },
      applied: { buildings: added, floors: Object.keys(plan.floors || {}).length },
      stuffAssumed: stuffAssumed,
      demolish: demolish,
      cleared: cleared,
      roomTemp: roomsApplied
    };
  }

  global.RWPlanImport = {
    apply: apply,
    parsePlan: parsePlan,
    resolveDef: resolveDef,
    resolveFloor: resolveFloor,
    gameThingToEditor: gameThingToEditor,
    editorThingToGame: editorThingToGame,
    cellToGame: cellToGame,
    gameCellToEditor: gameCellToEditor,
    rectToGame: rectToGame,
    pickStuff: pickStuff,
    findLockedOverlaps: findLockedOverlaps
  };
})(typeof window !== 'undefined' ? window : globalThis);
