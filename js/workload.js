/*
 * workload.js —— 蓝图可行性 + 工作量/时间估算
 *
 * 把「蓝图（未锁定的新增建筑/地板）」和「存档里读出来的情报（小人属性、科技进度、库存）」
 * 放在一起算：
 *   · 能不能实现：地形/山体是否挡路、科技是否解锁、材料够不够、技能够不够
 *   · 要多久：建造工时 + 开采工时 + 研究工时，换算成游戏内天数
 *
 * 数值模型尽量贴着游戏（RimWorld）：
 *   建造速度 ConstructionSpeed = 1 × (0.3 + 0.0875×技能等级) × 小人全局工作速度
 *   开采 tick/次 = 100 / MiningSpeed；岩石每 80 点伤害算一次（自然岩石）
 *   研究 点/tick = 0.00825 × ResearchSpeed × 研究台系数 × 难度系数
 *   1 游戏日 = 60000 tick = 24 小时；1 tick ≈ 1/60 秒
 * 都是估算，面板里会把假设列出来。
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  // 和游戏 TraitDef 的 WorkSpeedGlobal 偏移一致（常见项；没列到的按 0 算）
  var TRAIT_WORK = {
    Industrious: 0.35, HardWorker: 0.20, Neurotic: 0.20, VeryNeurotic: 0.40,
    Lazy: -0.20, Slothful: -0.35, Workaholic: 0.30, Depressive: -0.10
  };
  var DIFFICULTY = { Peaceful: 1.2, 'Community Builder': 1.2, 'Adventure Story': 1.0,
    'Strive to Survive': 1.0, 'Blood and Dust': 0.95, 'Losing is Fun': 0.9 };

  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }

  function pawnWorkOffset(p) {
    var off = 0;
    (p.traits || []).forEach(function (t) { off += TRAIT_WORK[t] || 0; });
    return off;
  }
  function pawnSpeed(p, stat) {
    var lv = (p.skills && p.skills[stat] && p.skills[stat].level) || 0;
    var global = 1 + pawnWorkOffset(p);
    if (stat === 'Construction') return (0.3 + 0.0875 * lv) * global;
    if (stat === 'Mining') return (0.04 + 0.12 * lv) * global;
    if (stat === 'Intellectual') return (0.08 + 0.115 * lv) * global;
    return global;
  }

  /** 研究台系数：简单 0.75 / 高科 1.0 / +多分析仪 1.1 */
  function benchFactor(state) {
    var f = 0.75, found = false;
    (state.buildings || []).forEach(function (b) {
      var d = Data.byId[b.defId]; if (!d) return;
      var dn = (d.def || d.en || d.id || '');
      if (/HiTechResearchBench/i.test(dn)) { f = Math.max(f, 1.0); found = true; }
      if (/SimpleResearchBench/i.test(dn)) { f = Math.max(f, 0.75); found = true; }
      if (/MultiAnalyzer/i.test(dn)) { f = Math.max(f, 1.1); found = true; }
    });
    return f;
  }

  function materialName(def) {
    if (Data.ITEM_NAMES && Data.ITEM_NAMES[def]) return Data.ITEM_NAMES[def];
    var s = Data.stuffById ? Data.stuffById(def) : null;
    return s ? s.name : def;
  }

  /**
   * 主分析。返回一个纯数据对象，UI 负责渲染。
   */
  function analyse(state, opts) {
    opts = opts || {};
    var Site = global.RWSite;
    var items = {};            // key -> { name, kind, n, work, cost:{}, research:[], skillReq, cells }
    var materials = {};        // def -> 数量
    var rockCells = {};        // "x,z" -> rock def
    var terrainBad = {};       // "x,z" -> terrain name
    var terrainBadBy = {};     // reason -> count
    var maxSkillReq = 0, maxSkillName = '';

    function item(key, seed) {
      if (!items[key]) items[key] = { key: key, n: 0, work: 0, cost: {}, research: {}, skillReq: 0 };
      items[key].n++;
      if (seed.work) items[key].work = seed.work;
      if (seed.name) items[key].name = seed.name;
      if (seed.kind) items[key].kind = seed.kind;
      if (seed.defId) items[key].defId = seed.defId;
      if (seed.cost) for (var k in seed.cost) items[key].cost[k] = (items[key].cost[k] || 0) + seed.cost[k];
      if (seed.research) seed.research.forEach(function (r) { items[key].research[r] = true; });
      items[key].skillReq = Math.max(items[key].skillReq, seed.skillReq || 0);
      return items[key];
    }

    // ---- 建筑 ----
    (state.buildings || []).forEach(function (b) {
      if (b.locked) return;
      var def = Data.byId[b.defId]; if (!def) return;
      var st = b.stuff && Data.stuffById ? Data.stuffById(b.stuff) : null;
      // 工时（含材质系数/偏移）
      var w = def.work || 0;
      if (st) w = w * (st.workFactor != null ? st.workFactor : 1) + (st.workOffset || 0);
      var cost = {};
      if (def.cost) for (var k in def.cost) cost[k] = (cost[k] || 0) + def.cost[k];
      if (def.costStuff && def.stuffCats && def.stuffCats.length) {
        var sid = b.stuff || null;
        if (sid) cost[sid] = (cost[sid] || 0) + def.costStuff;
        else if (st && st.id) cost[st.id] = (cost[st.id] || 0) + def.costStuff;
        else cost['(未选材质)'] = (cost['(未选材质)'] || 0) + def.costStuff;
      }
      var it = item('b:' + b.defId + '|' + (b.stuff || ''), {
        name: def.name, kind: 'building', defId: b.defId, work: w,
        cost: cost, research: def.research || [], skillReq: def.skillReq || 0
      });
      it.cells = it.cells || [];
      var fp = global.RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) it.cells.push([b.x + i, b.z + j]);
      if ((def.skillReq || 0) > maxSkillReq) { maxSkillReq = def.skillReq; maxSkillName = def.name; }
      for (var ck in cost) materials[ck] = (materials[ck] || 0) + cost[ck];

      // 地形/山体检查
      if (Site && (state.terrain || state.rocks) && state.respectTerrain) {
        var chk = Site.checkBuilding(b.defId, b.x, b.z, b.rot, b.stuff);
        if (!chk.ok) {
          (chk.rockCells || []).forEach(function (c) { var rk = Site.rockAt(c[0], c[1]); rockCells[c[0] + ',' + c[1]] = rk ? rk.def : 'rock'; });
          (chk.cells || []).forEach(function (c) {
            var t = Site.terrainAt(c[0], c[1]);
            terrainBad[c[0] + ',' + c[1]] = t ? t.name : '地形';
          });
          Object.keys(chk.reasons || {}).forEach(function (r) { terrainBadBy[r] = (terrainBadBy[r] || 0) + chk.reasons[r]; });
        }
      }
    });

    // ---- 地板 ----
    Object.keys(state.floors || {}).forEach(function (k) {
      if (state.lockedFloors && state.lockedFloors[k]) return;
      var fid = state.floors[k];
      var meta = Site ? Site.floorMeta(fid) : null;
      if (!meta) return;
      var p = k.split(',');
      var cost = meta.cost ? JSON.parse(JSON.stringify(meta.cost)) : {};
      items['f:' + fid] = items['f:' + fid] || { key: 'f:' + fid, n: 0, work: 0, cost: {}, research: {}, skillReq: 0, cells: [] };
      var it = items['f:' + fid];
      it.n++; it.name = meta.name; it.kind = 'floor';
      it.work = meta.work || 0;
      if (meta.skillReq) it.skillReq = Math.max(it.skillReq || 0, meta.skillReq);
      for (var c in cost) { it.cost[c] = (it.cost[c] || 0) + cost[c]; materials[c] = (materials[c] || 0) + cost[c]; }
      (meta.research || []).forEach(function (r) { it.research[r] = true; });
      it.cells.push([+p[0], +p[1]]);
      if (Site && (state.terrain || state.rocks) && state.respectTerrain) {
        var f = Site.checkFloor(fid, +p[0], +p[1]);
        if (!f.ok) {
          var kk = +p[0] + ',' + +p[1];
          if (f.kind === 'rock') { var rk = Site.rockAt(+p[0], +p[1]); rockCells[kk] = rk ? rk.def : 'rock'; }
          else { var t = Site.terrainAt(+p[0], +p[1]); terrainBad[kk] = t ? t.name : '地形'; }
          terrainBadBy[f.why] = (terrainBadBy[f.why] || 0) + 1;
        }
      }
    });

    var itemList = Object.keys(items).map(function (k) { return items[k]; });

    // ---- 科技 ----
    var research = state.saveInfo && state.saveInfo.research;
    var resDefs = Data.researches ? Data.researches() : {};
    var progress = (research && research.progress) || {};
    var current = research ? research.current : null;
    function isDone(def) {
      var info = resDefs[def];
      var pt = progress[def];
      if (pt == null) return false;
      if (info && info.cost > 0) return pt >= info.cost - 0.001;
      // 没导入研究数据时退而求其次：有进度且不是当前项目 → 认为已完成
      return pt > 0 && def !== current;
    }
    var needRes = {};
    var missing = {};
    function addRes(def, via) {
      if (needRes[def]) return;
      needRes[def] = via || 'direct';
      if (isDone(def)) return;
      missing[def] = resDefs[def] || { def: def, cost: 0, prereq: [] };
      ((resDefs[def] && resDefs[def].prereq) || []).forEach(function (p) { addRes(p, def); });
    }
    itemList.forEach(function (it) { Object.keys(it.research || {}).forEach(function (r) { addRes(r, it.name); }); });

    // ---- 小人 ----
    var pawns = (state.saveInfo && state.saveInfo.pawns) || [];
    var alive = pawns.filter(function (p) { return !p.dead; });
    function withSkills(list, stat, fallbackLevel) {
      return list.map(function (p) {
        var lv = (p.skills && p.skills[stat] && p.skills[stat].level) || 0;
        return { p: p, lv: lv, speed: pawnSpeed(p, stat), passion: (p.skills && p.skills[stat] && p.skills[stat].passion) || 'None' };
      }).sort(function (a, b) { return b.lv - a.lv || b.speed - a.speed; });
    }
    var builders = withSkills(alive, 'Construction');
    var miners = withSkills(alive, 'Mining');
    var researchers = withSkills(alive, 'Intellectual');
    if (!builders.length && alive.length) {
      builders = alive.map(function (p) { return { p: p, lv: 0, speed: pawnSpeed(p, 'Construction'), passion: 'None' }; });
      miners = alive.map(function (p) { return { p: p, lv: 0, speed: pawnSpeed(p, 'Mining'), passion: 'None' }; });
      researchers = alive.map(function (p) { return { p: p, lv: 0, speed: pawnSpeed(p, 'Intellectual'), passion: 'None' }; });
    }

    // ---- 工时 ----
    var totalWork = itemList.reduce(function (a, it) { return a + (it.work || 0) * it.n; }, 0);

    var mineHits = 0, mineHp = {};
    Object.keys(rockCells).forEach(function (k) {
      var def = rockCells[k];
      var rk = Data.rock ? Data.rock(def) : null;
      var hp = (rk && rk.hp) || 400;
      mineHp[def] = (mineHp[def] || 0) + hp;
      mineHits += Math.ceil(hp / 80);
    });

    var useBuilders = opts.builders != null ? opts.builders : Math.max(1, builders.length);
    useBuilders = Math.max(1, Math.min(useBuilders, Math.max(1, builders.length)));
    var buildSpeed = 0;
    builders.slice(0, useBuilders).forEach(function (b) { buildSpeed += b.speed; });
    if (!buildSpeed) buildSpeed = 1;

    var bestMiner = miners.length ? miners[0].speed : 1;
    var useMiners = opts.miners != null ? opts.miners : Math.max(1, Math.min(2, miners.length));
    var mineSpeed = 0;
    miners.slice(0, useMiners).forEach(function (m) { mineSpeed += m.speed; });
    if (!mineSpeed) mineSpeed = 1;

    var haulOverhead = opts.haulOverhead != null ? opts.haulOverhead : 0.25;
    var workHours = opts.workHours != null ? opts.workHours : 16;

    var buildTicks = (totalWork / buildSpeed) * (1 + haulOverhead);           // tick
    var mineTicks = 0;
    Object.keys(rockCells).forEach(function (k) {
      var def = rockCells[k];
      var rk = Data.rock ? Data.rock(def) : null;
      var hp = (rk && rk.hp) || 400;
      var hits = Math.ceil(hp / 80);
      mineTicks += hits * (100 / Math.max(0.1, mineSpeed));
    });

    // ---- 研究时间 ----
    var factor = DIFFICULTY[state.saveInfo && state.saveInfo.difficulty] || 1.0;
    var bench = benchFactor(state);
    var bestRes = researchers.length ? researchers[0].speed : 1;
    var resPerTick = 0.00825 * bestRes * bench * factor;
    if (resPerTick <= 0) resPerTick = 0.00825;
    var resRemaining = 0, resLines = [];
    Object.keys(missing).forEach(function (def) {
      var info = missing[def];
      var cost = info.cost || 0;
      var done = progress[def] || 0;
      var remain = Math.max(0, cost - done);
      resRemaining += remain;
      resLines.push({ def: def, name: info.name || def, cost: cost, progress: done, remain: remain, via: needRes[def] });
    });
    resLines.sort(function (a, b) { return b.remain - a.remain; });
    var resTicks = resRemaining / resPerTick;

    var TICKS_DAY = 60000;
    var totalTicks = buildTicks + mineTicks + resTicks;
    function days(ticks) { return ticks / TICKS_DAY; }

    // ---- 材料 ----
    var stock = (state.saveInfo && state.saveInfo.resources) || {};
    var matLines = Object.keys(materials).map(function (d) {
      var need = materials[d], have = stock[d] || 0;
      return { def: d, name: materialName(d), need: need, have: have, short: Math.max(0, need - have) };
    }).sort(function (a, b) { return b.short - a.short || b.need - a.need; });
    var missingMats = matLines.filter(function (m) { return m.short > 0; });

    // ---- 技能 ----
    var bestBuildLevel = builders.length ? builders[0].lv : 0;
    var skillOk = !maxSkillReq || bestBuildLevel >= maxSkillReq;

    // ---- 结论 ----
    var rockCount = Object.keys(rockCells).length;
    var terrainCount = Object.keys(terrainBad).length;
    var blocked = !!(rockCount || terrainCount || !skillOk);
    var verdict = blocked ? 'blocked' : (missing.length || missingMats.length ? 'partial' : 'ok');

    return {
      items: itemList.sort(function (a, b) { return (b.work * b.n) - (a.work * a.n); }),
      materials: matLines, missingMats: missingMats,
      research: {
        lines: resLines, remaining: resRemaining, ticks: resTicks, done: resLines.length === 0,
        rate: resPerTick, speed: bestRes, bench: bench, factor: factor, difficulty: (state.saveInfo && state.saveInfo.difficulty) || ''
      },
      terrain: {
        rockCells: Object.keys(rockCells).map(function (k) { var p = k.split(','); return { x: +p[0], z: +p[1], def: rockCells[k] }; }),
        terrainCells: Object.keys(terrainBad).map(function (k) { var p = k.split(','); return { x: +p[0], z: +p[1], def: terrainBad[k] }; }),
        reasons: terrainBadBy
      },
      pawns: {
        builders: builders.map(function (b) { return { name: b.p.name, level: b.lv, speed: b.speed, passion: b.passion }; }),
        miners: miners.map(function (m) { return { name: m.p.name, level: m.lv, speed: m.speed, passion: m.passion }; }),
        researchers: researchers.map(function (r) { return { name: r.p.name, level: r.lv, speed: r.speed, passion: r.passion }; })
      },
      work: {
        totalWork: totalWork, buildTicks: buildTicks, mineTicks: mineTicks, resTicks: resTicks,
        totalTicks: totalTicks, buildDays: days(buildTicks), mineDays: days(mineTicks),
        resDays: days(resTicks), totalDays: days(totalTicks),
        buildSpeed: buildSpeed, mineSpeed: mineSpeed, buildersUsed: useBuilders, minersUsed: useMiners,
        workHours: workHours, haulOverhead: haulOverhead, mineHits: mineHits,
        buildHours: buildTicks / 2500,
        mineHours: mineTicks / 2500,
        resHours: resTicks / 2500,
        totalHours: totalTicks / 2500
      },
      skill: { maxSkillReq: maxSkillReq, name: maxSkillName, best: bestBuildLevel, ok: skillOk },
      verdict: verdict,
      hasSave: !!(state.saveInfo && (state.saveInfo.pawns.length || state.saveInfo.research))
    };
  }

  global.RWWork = {
    analyse: analyse, pawnSpeed: pawnSpeed, benchFactor: benchFactor, materialName: materialName
  };
})(typeof window !== 'undefined' ? window : globalThis);
