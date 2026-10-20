/*
 * rooms.js —— 房间指定（designation）与温控估算
 *
 * RimWorld 里房间不只是「围起来的一块地」：你可以给它指定用途
 * （卧室 / 厨房 / 工坊 / 冷藏 / 冷冻…），并设定目标温度。
 * 用途决定了两件事：
 *   1) 房间里该有什么（卧室要有床、厨房要有炉灶、工坊要有工作台…）
 *   2) 房间里该有多少台制冷机 / 加热器
 *
 * 这里实现的是本工具自己的近似模型（不是游戏内物理的精确复刻）：
 *   冷（热）量需求 ∝ 面积 × |环境温度 − 目标温度|
 *   一台制冷机 ≈ 30 格 × 21°C 温差当量；一台加热器 ≈ 25 格 × 21°C
 *   所以：需要台数 = ceil(面积 × ΔT / (每台的格数 × 21))
 * 在「常温 21°C → 0°C」这个最常见的情形下，等价于大家常用的
 * 「一台制冷机管 30 格」经验值。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  // ---------------------------------------------------------------- 房间用途
  /**
   * need：这一用途要求房间里至少有一件满足条件的建筑。
   *   tags —— 建筑带这个标签
   *   defs —— 建筑 id 在这个列表里
   *   cats —— 建筑分类在这个列表里
   */
  var ROLES = [
    { id: 'none',       name: '普通房间', temp: 21,  need: null,                     desc: '不指定用途' },
    { id: 'bedroom',    name: '卧室',     temp: 21,  need: { tags: ['bed'] },        desc: '住人，至少要有一张床' },
    { id: 'barracks',   name: '兵营',     temp: 21,  need: { tags: ['bed'] },        desc: '士兵睡觉的地方' },
    { id: 'prison',     name: '囚室',     temp: 21,  need: { tags: ['bed'] },        desc: '关俘虏，最好用栅栏门' },
    { id: 'hospital',   name: '病房',     temp: 21,  need: { defs: ['hospital_bed'] }, desc: '需要病床' },
    { id: 'kitchen',    name: '厨房',     temp: 21,  need: { defs: ['stove_electric', 'stove_fuel', 'campfire'] }, desc: '需要炉灶' },
    { id: 'dining',     name: '餐厅',     temp: 21,  need: { tags: ['solid'] },       desc: '要有能坐的桌子' },
    { id: 'recreation', name: '娱乐室',   temp: 21,  need: { cats: ['joy'] },         desc: '要有娱乐设施' },
    { id: 'workshop',   name: '工坊',     temp: 21,  need: { cats: ['production'] },  desc: '要有一台工作台' },
    { id: 'lab',        name: '实验室',   temp: 21,  need: { defs: ['research_bench', 'hi_tech_research_bench'] }, desc: '需要研究台' },
    { id: 'storage',    name: '储藏室',   temp: 21,  need: null,                     desc: '放东西' },
    { id: 'cold',       name: '冷藏室',   temp: 4,   need: null,                     desc: '目标 4°C（放食物）' },
    { id: 'freezer',    name: '冷冻室',   temp: -10, need: null,                     desc: '目标 -10°C（放肉）' }
  ];

  // 温控当量
  var COOLER_CELLS = 30;   // 一台制冷机在「温差 21°C」时能压住的格数
  var HEATER_CELLS = 25;   // 一台加热器的当量格数
  var REF_DELTA = 21;      // 参考温差（常温 21°C → 0°C）

  function roleById(id) {
    for (var i = 0; i < ROLES.length; i++) if (ROLES[i].id === id) return ROLES[i];
    return null;
  }

  // ---------------------------------------------------------------- 指定
  /** 房间当前的指定：扫它所有格子，谁被指定过就算谁的 */
  function roleOf(state, room) {
    var map = state.roomRole || {};
    var temps = state.roomTemp || {};
    var rid = null, temp = null;
    for (var i = 0; i < room.cells.length; i++) {
      var k = room.cells[i][0] + ',' + room.cells[i][1];
      var v = map[k];
      if (!v) continue;
      if (!rid) rid = v;
      if (temps[k] != null) temp = temps[k];
    }
    var def = roleById(rid) || ROLES[0];
    if (temp == null) temp = def.temp;
    return { role: def.id, name: def.name, temp: temp, def: def };
  }

  /**
   * 给房间指定用途。
   * 写进它的每一格 —— 这样房间之后被拆开时，两半都还保留这个用途（和游戏一致）。
   */
  function setRole(state, room, roleId, temp) {
    if (!state.roomRole) state.roomRole = {};
    if (!state.roomTemp) state.roomTemp = {};
    var def = roleById(roleId) || ROLES[0];
    room.cells.forEach(function (c) {
      var k = c[0] + ',' + c[1];
      if (def.id === 'none') {
        delete state.roomRole[k];
        delete state.roomTemp[k];
        return;
      }
      state.roomRole[k] = def.id;
      if (temp != null && temp !== def.temp) state.roomTemp[k] = temp;
      else delete state.roomTemp[k];
    });
    return def;
  }

  /** 清掉不在任何房间里的残留指定（比如房间被拆散后） */
  function prune(state, rooms) {
    if (!state.roomRole) return;
    var alive = {};
    rooms.forEach(function (r) {
      r.cells.forEach(function (c) { alive[c[0] + ',' + c[1]] = true; });
    });
    Object.keys(state.roomRole).forEach(function (k) {
      if (!alive[k]) delete state.roomRole[k];
    });
    if (state.roomTemp) {
      Object.keys(state.roomTemp).forEach(function (k) {
        if (!alive[k]) delete state.roomTemp[k];
      });
    }
  }

  // ---------------------------------------------------------------- 温控
  /**
   * 这个房间要达到目标温度，需要几台制冷机 / 加热器。
   * 返回 { kind: 'cool'|'heat'|'none', need: 台数, delta: 温差 }
   */
  function temperatureNeed(room, ambient, target) {
    var delta = (ambient == null ? 21 : ambient) - (target == null ? 21 : target);
    if (delta > 0) {
      return { kind: 'cool', need: Math.ceil(room.area * delta / (COOLER_CELLS * REF_DELTA)), delta: delta };
    }
    if (delta < 0) {
      return { kind: 'heat', need: Math.ceil(room.area * (-delta) / (HEATER_CELLS * REF_DELTA)), delta: delta };
    }
    return { kind: 'none', need: 0, delta: 0 };
  }

  /** 房间里有没有满足该用途要求的建筑 */
  function meetsNeed(room, need) {
    if (!need) return true;
    for (var i = 0; i < room.things.length; i++) {
      var def = Data.byId[room.things[i].defId];
      if (!def) continue;
      if (need.tags && need.tags.length) {
        var ok = need.tags.every(function (t) { return def.tags && def.tags.indexOf(t) >= 0; });
        if (!ok) continue;
      }
      if (need.defs && need.defs.length && need.defs.indexOf(def.id) < 0) continue;
      if (need.cats && need.cats.length && need.cats.indexOf(def.cat) < 0) continue;
      return true;
    }
    return false;
  }

  global.RWRooms = {
    ROLES: ROLES,
    roleById: roleById,
    roleOf: roleOf,
    setRole: setRole,
    prune: prune,
    temperatureNeed: temperatureNeed,
    meetsNeed: meetsNeed,
    COOLER_CELLS: COOLER_CELLS,
    HEATER_CELLS: HEATER_CELLS
  };
})(typeof window !== 'undefined' ? window : globalThis);
