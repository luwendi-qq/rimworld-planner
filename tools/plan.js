'use strict';
/*
 * tools/plan.js —— 给「没有浏览器，但有 shell」的调用方用的命令行入口
 *
 * 典型用途：让一个在玩 RimWorld 的 AI（通过 Mod 的 MCP 控制游戏）在动手盖之前，
 * 先把布局丢进这里跑一遍。整条链路都是文件 + JSON，不需要网页、不需要鼠标：
 *
 *   node tools/plan.js import  <存档.rws>     读存档 → 地形/小人/科技/库存 → 缓存
 *   node tools/plan.js apply   <plan.json>    把新规划叠到缓存上（可反复改）
 *   node tools/plan.js validate               跑校验（冲突/电力/房间/可达/地形）
 *   node tools/plan.js render                 出一张 ASCII 图（和游戏里同一套坐标）
 *   node tools/plan.js build-ops              转成可直接调 game.build() 的调用列表
 *   node tools/plan.js blueprint [--out x.xml] 需要 Blueprints 模组时的传统出口
 *   node tools/plan.js describe               输出契约：def 表 + 规则 + 示例
 *
 * 坐标约定（很重要）：本工具输入/输出**全部是游戏坐标**（和存档、和
 * RimMolt 的 build(x,z)、get_area 的 x/z 一致）。内部的画布坐标是翻转过的，
 * 换算只发生在读写 state 的那一层，不让调用方看到。
 */

const fs = require('node:fs');
const path = require('node:path');
const { loadApp } = require('./lib/load.js');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_STATE = path.join(ROOT, '.planner', 'state.rwplan.json');

// ---------------------------------------------------------------- 参数
function parseArgs(argv) {
  const out = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') { out._.push(...argv.slice(i + 1)); break; }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq > 0) {
        out.flags[a.slice(2, eq)] = a.slice(eq + 1);
      } else {
        const k = a.slice(2);
        const next = argv[i + 1];
        if (next && !next.startsWith('--')) { out.flags[k] = next; i++; }
        else out.flags[k] = true;
      }
    } else out._.push(a);
  }
  return out;
}

function fail(msg, code) {
  process.stderr.write('error: ' + msg + '\n');
  process.exitCode = code || 1;
  throw new Error(msg);
}

function num(v, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

// ---------------------------------------------------------------- 状态文件
function statePath(args) {
  return path.resolve(args.flags.state || DEFAULT_STATE);
}

function loadState(args) {
  const file = statePath(args);
  if (!fs.existsSync(file)) {
    fail('还没有读存档。先跑：node tools/plan.js import <存档.rws>（当前找的是 ' + file + '）');
  }
  const env = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!env || !env.project) fail('状态文件格式不对：' + file);
  const app = loadApp();
  app.RW.loadProject(env.project);
  return { app: app, env: env, file: file };
}

function saveState(file, meta, app) {
  const env = { meta: meta, project: app.RW.exportProject() };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(env));
  return env;
}

// ---------------------------------------------------------------- 坐标
// 编辑器坐标 = 画布坐标（z 向下）；游戏坐标 = 存档/MCP 坐标（+z 向北）。
function toGame(state, x, z) {
  return { x: state.flipX ? state.cols - 1 - x : x, z: state.flipZ !== false ? state.rows - 1 - z : z };
}
function toEditorCell(state, x, z) {
  return { x: state.flipX ? state.cols - 1 - x : x, z: state.flipZ !== false ? state.rows - 1 - z : z };
}
function toGameCells(state, cells) {
  return (cells || []).map(function (c) { return toGame(state, c[0], c[1]); });
}

/** 游戏 Position + 朝向 → 编辑器里多格建筑的最小角 */
function defIndex(app) {
  const byGame = {};
  const ids = Object.keys(app.RWData.byId || {});
  for (const id of ids) {
    const d = app.RWData.byId[id];
    const g = app.RWExport.gameDefName(d);
    if (g && !byGame[g]) byGame[g] = d;
  }
  return { byId: app.RWData.byId, byGame: byGame };
}

// ---------------------------------------------------------------- import
async function cmdImport(args) {
  const savePath = args._[0] || args.flags.save;
  if (!savePath) fail('用法：node tools/plan.js import <存档.rws> [--map 0] [--state 路径]');
  if (!fs.existsSync(savePath)) fail('找不到存档：' + savePath);

  const app = loadApp();
  const stat = fs.statSync(savePath);
  const text = fs.readFileSync(savePath, 'utf8');
  const mapIndex = num(args.flags.map, 0);

  const res = await app.RWIo.parseSave(text, { mapIndex: mapIndex });
  app.RWIo.importFromSave(res, {});

  const state = app.RW.state;
  if (!state.terrain || !state.terrain.cells) {
    process.stderr.write('warning: 地形网格没读出来（存档可能是旧格式）。地形校验会被跳过。\n');
  }
  if (!res.colonyName) state.mapName = path.basename(savePath, path.extname(savePath));

  const file = statePath(args);
  const meta = {
    source: path.resolve(savePath),
    sourceMtime: stat.mtime.toISOString(),
    savedAt: new Date().toISOString(),
    mapIndex: mapIndex,
    gameVersion: res.version || null,
    colony: res.colonyName || null,
    tick: res.tick || 0
  };
  saveState(file, meta, app);

  const terrain = app.RWSite.summarize();
  const topTerrain = Object.keys(terrain.byDef || {})
    .filter(function (k) { return k.charAt(0) !== '⛏'; })
    .sort(function (a, b) { return terrain.byDef[b] - terrain.byDef[a]; })
    .slice(0, 6);

  const res0 = res.resources || {};
  const stock = res0.hasHome && res0.home ? res0.home : (res0.all || {});
  const stockTop = Object.keys(stock)
    .sort(function (a, b) { return stock[b] - stock[a]; })
    .slice(0, 15)
    .map(function (k) { return { def: k, n: stock[k] }; });

  const colonists = (res.pawns || [])
    .filter(function (p) { return p.kindDef === 'Colonist' && !p.dead; })
    .map(function (p) {
      const s = p.skills || {};
      return {
        name: p.name,
        construction: s.Construction ? s.Construction.level : null,
        mining: s.Mining ? s.Mining.level : null,
        intellectual: s.Intellectual ? s.Intellectual.level : null
      };
    });

  const research = res.research || {};
  const progress = research.progress || {};
  const doneList = Object.keys(progress).filter(function (d) { return app.RWData.researchDone(research, d); });

  const locked = state.buildings.filter(function (b) { return b.locked; }).length;

  return {
    ok: true,
    state: file,
    source: {
      path: meta.source,
      mtime: meta.sourceMtime,
      ageMinutes: Math.round((Date.now() - stat.mtimeMs) / 60000)
    },
    colony: meta.colony,
    gameVersion: meta.gameVersion,
    tick: meta.tick,
    map: { w: state.cols, h: state.rows, index: mapIndex },
    terrain: {
      total: terrain.total,
      rock: terrain.rock,
      water: terrain.water,
      marsh: terrain.marsh,
      heavy: terrain.heavy,
      top: topTerrain.map(function (k) { return { def: k, cells: terrain.byDef[k] }; })
    },
    home: res.home ? { cells: Object.keys(res.home.cells || {}).filter(function (k) { return res.home.cells[k]; }).length } : null,
    buildings: { imported: res.buildings ? res.buildings.length : 0, locked: locked, floors: Object.keys(state.floors).length },
    colonists: colonists,
    research: {
      current: research.current || null,
      currentProgress: research.current ? (progress[research.current] || 0) : 0,
      completed: doneList.length,
      completedNames: doneList.slice(0, 12)
    },
    stock: { scope: res0.hasHome ? 'home' : 'all', top: stockTop }
  };
}

// ---------------------------------------------------------------- apply
function cmdApply(args) {
  const planPath = args._[0] || args.flags.plan;
  if (!planPath) fail('用法：node tools/plan.js apply <plan.json> [--state 路径] [--clear] [--no-auto-stuff]');
  if (!fs.existsSync(planPath)) fail('找不到规划文件：' + planPath);

  const { app, env, file } = loadState(args);
  let parsed;
  try { parsed = app.RWPlanImport.parsePlan(fs.readFileSync(planPath, 'utf8')); }
  catch (e) { fail(e.message); }
  const plan = parsed.plan;

  // 合并逻辑只有一份：js/planimport.js（网页「导入 AI 规划」调的是同一个函数）
  const report = app.RWPlanImport.apply(app.RW.state, plan, {
    autoStuff: !args.flags['no-auto-stuff'],
    clear: !!args.flags.clear
  });
  saveState(file, env.meta, app);

  return {
    ok: report.errors.length === 0,
    plan: path.resolve(planPath),
    replaced: report.replaced,
    applied: report.applied,
    stuffAssumed: Object.keys(report.stuffAssumed).length ? report.stuffAssumed : undefined,
    demolish: report.demolish.length ? report.demolish : undefined,
    cleared: report.cleared || undefined,
    roomTemp: report.roomTemp.length ? report.roomTemp : undefined,
    errors: report.errors,
    warnings: parsed.warnings.concat(report.warnings)
  };
}

// ---------------------------------------------------------------- validate
function cmdValidate(args) {
  const { app } = loadState(args);
  const state = app.RW.state;
  const limit = num(args.flags.limit, 12);
  const r = app.RWChecks.analyse(state);

  const issues = (r.issues || []).map(function (it) {
    const cells = it.cells || [];
    const g = toGameCells(state, cells);
    return {
      kind: it.kind, level: it.level, approx: !!it.approx, msg: it.msg,
      source: it.source,
      n: cells.length || undefined,
      cells: g.slice(0, limit)
    };
  });

  const counts = { error: 0, warn: 0, approx: 0 };
  issues.forEach(function (i) {
    if (i.level === 'error') counts.error++;
    else counts.warn++;
    if (i.approx) counts.approx++;
  });

  const rooms = (r.rooms || []).map(function (x) {
    return {
      role: x.role || null, area: x.area, space: x.space, spaceText: x.spaceText,
      doors: x.doors, reachable: x.reachable, outdoor: !!x.outdoor,
      targetC: app.RWRooms.temperatureOf(state, x)
    };
  });

  const power = r.power ? {
    nets: (r.power.nets || []).length,
    problems: (r.power.problems || []).length,
    detail: (r.power.nets || []).slice(0, 6).map(function (n) {
      return { gen: n.gen, use: n.use, store: n.store, deficit: n.deficit };
    })
  } : null;

  return {
    ok: counts.error === 0,
    plan: state.mapName,
    cellsTruncatedTo: limit,
    counts: counts,
    issues: issues,
    rooms: rooms,
    power: power
  };
}

// ---------------------------------------------------------------- render
function cmdRender(args) {
  const { app } = loadState(args);
  const state = app.RW.state;
  const scale = num(args.flags.scale, 0);
  const labels = !args.flags['no-labels'];

  // 新规划 和 存档原有 用两套字符，不然看不出哪些是这次要盖的
  const NEW = { wall: '#', door: '+', thing: 'o', floor: '.' };
  const OLD = { wall: '%', door: '&', thing: '0', floor: ',' };
  const RANK = { ' ': 0, '.': 1, ',': 1, o: 2, '0': 2, '+': 3, '&': 3, '#': 4, '%': 4, '~': 5, '^': 6 };

  const n = state.cols * state.rows;
  const grid = new Array(n).fill(' ');
  const lock = new Uint8Array(n);
  const put = function (x, z, ch, isOld) {
    if (x < 0 || z < 0 || x >= state.cols || z >= state.rows) return;
    const i = z * state.cols + x;
    if ((RANK[ch] || 0) > (RANK[grid[i]] || 0) || ((RANK[ch] || 0) === (RANK[grid[i]] || 0) && isOld)) {
      grid[i] = ch;
      lock[i] = isOld ? 1 : 0;
    }
  };

  for (let z = 0; z < state.rows; z++) {
    for (let x = 0; x < state.cols; x++) {
      if (app.RWSite.rockAt(x, z)) put(x, z, '^', false);
      else {
        const t = app.RWSite.terrainAt(x, z);
        if (t && t.isWater) put(x, z, '~', false);
      }
    }
  }

  Object.keys(state.floors).forEach(function (k) {
    const p = k.split(',');
    const old = !!(state.lockedFloors && state.lockedFloors[k]);
    put(+p[0], +p[1], old ? OLD.floor : NEW.floor, old);
  });

  state.buildings.forEach(function (b) {
    const def = app.RWData.byId[b.defId];
    if (!def) return;
    const fp = app.RW.footprint(def, b.rot);
    const tags = def.tags || [];
    const isDoor = tags.indexOf('door') >= 0;
    const isWall = tags.indexOf('solid') >= 0;
    const set = b.locked ? OLD : NEW;
    const ch = isDoor ? set.door : isWall ? set.wall : set.thing;
    for (let i = 0; i < fp[0]; i++) for (let j = 0; j < fp[1]; j++) put(b.x + i, b.z + j, ch, !!b.locked);
  });

  const want = num(args.flags.width, 0) || 100;
  const step = Math.max(1, scale > 0 ? scale : Math.ceil(state.cols / want));
  const cols = Math.ceil(state.cols / step);
  const rows = Math.ceil(state.rows / step);

  const lines = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const gz = state.rows - 1 - (r * step);
      let best = ' ', bestRank = -1, bestLock = 0;
      for (let dz = 0; dz < step; dz++) {
        for (let dx = 0; dx < step; dx++) {
          const gx = c * step + dx;
          const zz = gz - dz;
          if (gx >= state.cols || zz < 0) continue;
          const ed = toEditorCell(state, gx, zz);
          const gi = ed.z * state.cols + ed.x;
          const ch = grid[gi] || ' ';
          const rk = RANK[ch] || 0;
          if (rk > bestRank) { best = ch; bestRank = rk; bestLock = lock[gi]; }
        }
      }
      line += best;
    }
    lines.push(line.replace(/\s+$/, ''));
  }

  let ascii = lines;
  if (labels) {
    const gutter = String(state.rows - 1).length + 1;
    const tickEvery = Math.max(1, Math.round(10 / step));
    let head = ' '.repeat(gutter);
    for (let c = 0; c < cols; c++) head += (c % tickEvery === 0) ? '|' : ' ';
    const nums = ' '.repeat(gutter) + Array.from({ length: cols }, function (_, c) {
      if (c % tickEvery) return ' ';
      const label = String(c * step);
      return label.length <= tickEvery ? label.padEnd(tickEvery, ' ') : label.slice(0, tickEvery);
    }).join('').replace(/\s+$/, '');
    ascii = [head.replace(/\s+$/, ''), nums].concat(lines.map(function (line, r) {
      const gz = state.rows - 1 - r * step;
      return String(gz).padStart(gutter - 1, ' ') + ' ' + line;
    }));
  }

  return {
    plan: state.mapName,
    map: { w: state.cols, h: state.rows },
    cellPerChar: step,
    labels: labels,
    // 图里左上角那个字符对应的游戏坐标；往右 +x，往下 -z
    origin: { x: 0, z: state.rows - 1 },
    legend: {
      '#': '新规划·墙/围合', '+': '新规划·门', o: '新规划·其他建筑', '.': '新规划·地板',
      '%': '存档原有·墙', '&': '存档原有·门', '0': '存档原有·建筑', ',': '存档原有·地板',
      '~': '水', '^': '山体/矿石', ' ': '空地'
    },
    ascii: ascii
  };
}

// ---------------------------------------------------------------- build-ops
function cmdBuildOps(args) {
  const { app } = loadState(args);
  const state = app.RW.state;
  const opts = {
    excludeLocked: args.flags.all ? false : true,
    floors: args.flags['no-floors'] ? false : true
  };
  const r = app.RWBuild.toBuildOps(state, opts);

  // 同一格既有墙又有「贴墙件」：规划器允许这么画（画起来方便），
  // 但游戏里制冷机/通风格栅自己就占掉那格墙。列出来让调用方决定删哪边。
  const packed = app.RWExport.blueprintEntries(state, opts);
  const byCell = {};
  packed.entries.forEach(function (e) {
    if (e.terrain) return;
    const def = app.RWBuild.defByGameName(e.defName);
    if (!def) return;
    const k = e.x + ',' + e.z;
    (byCell[k] = byCell[k] || []).push(def);
  });
  const overlaps = [];
  Object.keys(byCell).forEach(function (k) {
    const defs = byCell[k];
    const solid = defs.find(function (d) { return (d.tags || []).indexOf('solid') >= 0; });
    // 只有「自己就是那格墙」的设备才算冲突；壁灯 / 壁挂火把是真正贴在墙上，不用管
    const REPLACE = { Cooler: 1, Vent: 1, PassiveCooler: 1 };
    const onwall = defs.find(function (d) {
      if ((d.tags || []).indexOf('onwall') < 0) return false;
      var g = app.RWExport.gameDefName(d);
      return !!(g && REPLACE[g]);
    });
    if (!solid || !onwall) return;
    const p = k.split(',');
    overlaps.push({ x: +p[0], z: +p[1], defs: [solid.name, onwall.name] });
  });

  // ---- 施工前要先下的指令：拆旧 / 采山 ----
  const prep = { deconstruct: [], mine: [], blocked: null };
  const wantPrep = !args.flags['no-prep'];
  let tempRooms = [];

  if (wantPrep) {
    app.RWPlanImport.findLockedOverlaps(state).forEach(function (d) {
      prep.deconstruct.push({ designator: 'Designator_Deconstruct', def: d.def, x: d.x, z: d.z });
    });

    const work = app.RWWork.analyse(state, {});
    const rocks = (work.terrain && work.terrain.rockCells) || [];
    app.RWBuild.toRects(rocks.map(function (c) { return [c.x, c.z]; })).forEach(function (rr) {
      const g = app.RWPlanImport.rectToGame(state, rr);
      prep.mine.push(g[0] === g[2] && g[1] === g[3]
        ? { designator: 'Designator_Mine', x: g[0], z: g[1] }
        : { designator: 'Designator_Mine', fill: 'filled', minX: g[0], minZ: g[1], maxX: g[2], maxZ: g[3] });
    });

    const bad = (work.terrain && work.terrain.terrainCells) || [];
    if (bad.length) {
      prep.blocked = {
        n: bad.length,
        reasons: work.terrain.reasons || {},
        note: '这些格不是山体，挖不动：沼泽/软沙要垫地基，水面要铺桥'
      };
    }

    const chk = app.RWChecks.analyse(state);
    tempRooms = (chk.rooms || [])
      .map(function (r) { return { area: r.area, role: r.role, c: app.RWRooms.temperatureOf(state, r) }; })
      .filter(function (r) { return r.c !== 21; });
  }

  return {
    plan: state.mapName,
    coordinateNote: 'def/x/z/rot 可直接喂给游戏侧 build()；矩形用 fill:"filled"',
    stats: r.stats,
    prep: (prep.deconstruct.length || prep.mine.length || prep.blocked) ? prep : undefined,
    roomTempToSet: tempRooms.length ? {
      note: '规划目标温度。游戏里装好制冷机后要再手动设一次，planner 不会替你设。',
      rooms: tempRooms
    } : undefined,
    overlaps: overlaps.length ? {
      n: overlaps.length,
      note: '同一格既有墙又有制冷机/通风格栅/被动散热器——它们在游戏里自己就占这格墙，通常要删掉墙。壁灯/壁挂火把不占墙，不会出现在这里。',
      cells: overlaps.slice(0, 20)
    } : undefined,
    ops: r.ops
  };
}

// ---------------------------------------------------------------- blueprint
function cmdBlueprint(args) {
  const { app } = loadState(args);
  const out = args.flags.out || args.flags.o;
  const r = app.RWExport.toBlueprintsXML(app.RW.state, {
    category: args.flags.category || undefined,
    name: args.flags.name || undefined
  });
  if (!r.xml) fail('画布上没有可导出的东西（或全部被跳过）');
  if (out) {
    fs.writeFileSync(path.resolve(out), r.xml, 'utf8');
    return { ok: true, file: path.resolve(out), count: r.count, size: { w: r.w, h: r.h }, skipped: r.skipped, lockedSkipped: r.lockedSkipped };
  }
  return { ok: true, count: r.count, size: { w: r.w, h: r.h }, xml: r.xml };
}

// ---------------------------------------------------------------- brief
/** 基地简报：给没有存档访问权的 AI（网页「导出 AI 简报」用的也是同一个生成器） */
function cmdBrief(args) {
  const { app } = loadState(args);
  const state = app.RW.state;
  const opts = {};
  if (args.flags.rect) {
    const r = String(args.flags.rect).split(',').map(Number);
    if (r.length === 4 && r.every(isFinite)) opts.rect = r;
  }
  if (args.flags.pad != null) opts.pad = num(args.flags.pad, 8);
  if (args.flags.width != null) opts.maxWidth = num(args.flags.width, 160);

  const brief = app.RWBrief.build(state, opts);
  const text = app.RWBrief.toMarkdown(brief);
  const out = args.flags.out || args.flags.o;
  if (out) {
    const file = path.resolve(out);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text, 'utf8');
    return {
      ok: true, file: file, bytes: Buffer.byteLength(text, 'utf8'),
      region: brief.region.rect, step: brief.region.step,
      buildings: brief.existing.count, defs: brief.defs.length,
      tick: brief.save.tick
    };
  }
  return { text: text };
}

// ---------------------------------------------------------------- project
/**
 * 把当前规划导出成**网页能直接打开的工程文件**（.rwplan.json）。
 *
 * 注意区别：.planner/state.rwplan.json 是 {meta, project} 信封（缓存用），
 * 网页的「打开工程」要的是裸 project。这里写的是后者，所以玩家双击网页 → 打开工程 → 微调 → 导出蓝图，
 * 存档里原有的建筑是 locked 的（淡显 + 锁），导出时自动排除，只剩 AI 新规划的部分。
 */
function cmdProject(args) {
  const { app } = loadState(args);
  const project = app.RW.exportProject();
  const out = args.flags.out || args.flags.o;
  if (!out) return project;

  const file = path.resolve(out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(project, null, 1));

  const locked = project.buildings.filter(function (b) { return b.locked; }).length;
  return {
    ok: true,
    file: file,
    bytes: fs.statSync(file).size,
    buildings: project.buildings.length,
    locked: locked,
    plan: project.buildings.length - locked,
    floors: Object.keys(project.floors).length,
    tick: (project.saveInfo && project.saveInfo.tick) || null,
    hint: '网页顶栏「打开工程」选这个文件；locked 的存档建筑会淡显，导出蓝图时自动排除'
  };
}

// ---------------------------------------------------------------- estimate
function cmdEstimate(args) {
  const { app } = loadState(args);
  const state = app.RW.state;
  const opts = {
    builders: args.flags.builders != null ? num(args.flags.builders, undefined) : undefined,
    miners: args.flags.miners != null ? num(args.flags.miners, undefined) : undefined,
    workHours: args.flags['work-hours'] != null ? num(args.flags['work-hours'], 16) : undefined,
    haulOverhead: args.flags['haul-overhead'] != null ? num(args.flags['haul-overhead'], 0.25) : undefined
  };
  const r = app.RWWork.analyse(state, opts);
  const round = function (v) { return Math.round(v * 10) / 10; };
  return {
    ok: r.verdict === 'ok',
    verdict: r.verdict,
    materials: {
      missing: (r.missingMats || []).slice(0, 12).map(function (m) {
        return { def: m.def, name: m.name, need: m.need, have: m.have, short: m.short };
      }),
      missingKinds: (r.missingMats || []).length,
      totalKinds: (r.materials || []).length
    },
    research: {
      done: r.research.done,
      missing: (r.research.lines || []).slice(0, 12).map(function (x) { return x.name || x.def || x; }),
      remainingPoints: r.research.remaining,
      days: round(r.research.ticks / 60000)
    },
    terrain: {
      rockCells: (r.terrain.rockCells || []).length,
      blockedCells: (r.terrain.terrainCells || []).length,
      reasons: r.terrain.reasons || {}
    },
    work: {
      buildDays: round(r.work.buildDays),
      mineDays: round(r.work.mineDays),
      researchDays: round(r.work.resDays),
      totalDays: round(r.work.totalDays),
      builders: r.work.buildersUsed,
      miners: r.work.minersUsed
    },
    pawns: r.pawns,
    note: 'opts 只统计未锁定的部分（存档原有建筑不计入需求）'
  };
}

// ---------------------------------------------------------------- state
function cmdState(args) {
  const { app, env, file } = loadState(args);
  return { ok: true, file: file, meta: env.meta, project: app.RW.exportProject() };
}

// ---------------------------------------------------------------- doctor
/** 三个平台默认的存档目录（能找到几个算几个） */
function saveDirs() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cands = [];
  if (process.platform === 'win32') {
    cands.push(path.join(home, 'AppData', 'LocalLow', 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Saves'));
  } else if (process.platform === 'darwin') {
    cands.push(path.join(home, 'Library', 'Application Support', 'RimWorld', 'Saves'));
  } else {
    cands.push(path.join(home, '.config', 'unity3d', 'Ludeon Studios', 'RimWorld by Ludeon Studios', 'Saves'));
  }
  return cands.filter(function (p) { return fs.existsSync(p); });
}

function cmdDoctor() {
  const nodeMajor = parseInt(String(process.versions.node).split('.')[0], 10) || 0;
  const app = loadApp();
  const missing = ['RW', 'RWData', 'RWChecks', 'RWWork', 'RWExport', 'RWIo', 'RWBuild', 'RWSite', 'RWRooms']
    .filter(function (k) { return !app[k]; });

  const generated = fs.existsSync(path.join(ROOT, 'js', 'buildings.generated.js'));

  let stateWritable = false;
  try {
    fs.mkdirSync(path.join(ROOT, '.planner'), { recursive: true });
    stateWritable = true;
  } catch (e) { stateWritable = false; }

  const dirs = saveDirs().map(function (d) {
    const all = fs.readdirSync(d).filter(function (f) { return /\.rws$/i.test(f); });
    const newest = all.map(function (f) {
      const st = fs.statSync(path.join(d, f));
      return { name: f, mtime: st.mtime.toISOString(), mb: Math.round(st.size / 104857.6) / 10 };
    }).sort(function (a, b) { return a.mtime < b.mtime ? 1 : a.mtime > b.mtime ? -1 : 0; }).slice(0, 3);
    return { path: d, count: all.length, newest: newest };
  });

  const ok = nodeMajor >= 18 && missing.length === 0 && stateWritable;
  return {
    ok: ok,
    node: process.versions.node,
    nodeOk: nodeMajor >= 18,
    platform: process.platform,
    core: { defs: Object.keys(app.RWData.byId || {}).length, missing: missing },
    generatedDefs: generated ? 'js/buildings.generated.js' : '缺少：精确 def 表（只用内置参考值）',
    stateCache: path.join(ROOT, '.planner', 'state.rwplan.json'),
    stateWritable: stateWritable,
    saveDirs: dirs,
    next: ok
      ? '跑 node tools/plan.js import "<存档.rws>" 开始；第一次先读 docs/for-llm.md'
      : (nodeMajor < 18 ? '升级到 Node 18+' : '检查 js/ 是否完整，或目录是否可写')
  };
}

// ---------------------------------------------------------------- describe
function cmdDescribe(args) {
  const app = loadApp();
  const cat = args.flags.cat;
  const idx = defIndex(app);
  const lines = [];

  lines.push('# RimWorld planner 契约（给模型看的）');
  lines.push('');
  lines.push('## 坐标');
  lines.push('- 全部用游戏坐标：x 向右为 +x，z 向上为 +z（和存档 / build(x,z) / get_area 一致）。');
  lines.push('- rot: 0=北 1=东 2=南 3=西。');
  lines.push('- 多格建筑只给它的 Position：游戏按 anchorOffset 从 Position 推出占地，奇数尺寸时锚点在中心格、偶数尺寸偏向一侧，**不是左下角**。照抄游戏里的 Position（或 build-ops 给的坐标）就行，别自己换算。');
  lines.push('');
  lines.push('## 流程');
  lines.push('1. `plan.js import <存档.rws>` —— 先读存档，否则没有地形/库存/科技。');
  lines.push('2. 写 plan.json（见下），`plan.js apply plan.json`。');
  lines.push('3. `plan.js validate` —— issues[].level=error 必须清零再用。');
  lines.push('4. `plan.js build-ops` —— 拿到 ops[]，逐条调游戏侧 build()。');
  lines.push('');
  lines.push('## plan.json');
  lines.push('```json');
  lines.push('{');
  lines.push('  "name": "基地 v1",');
  lines.push('  "materials": { "Wall": "WoodLog", "Bed": "Cloth" },');
  lines.push('  "buildings": [');
  lines.push('    { "def": "Wall", "x": 100, "z": 100, "rot": 0 },');
  lines.push('    { "def": "Door", "x": 110, "z": 100 },');
  lines.push('    { "def": "Bed", "x": 104, "z": 104, "rot": 1, "stuff": "Cloth" }');
  lines.push('  ],');
  lines.push('  "floors": { "100,100": "WoodPlankFloor" }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('## 硬规则（违反会被 validate 报 error，或游戏里 rejected）');
  lines.push('- 跨格建筑不能重叠。例外：电缆可埋墙下；壁灯 / 壁挂火把可以贴墙共存；制冷机 / 通风格栅 / 被动散热器会占掉那格墙。');
  lines.push('- 地图最外圈 1 格不可建造（x=0 / x=cols-1 / z=0 / z=rows-1）。');
  lines.push('- 地形要求由材质决定：木墙/木家具只要 Light；石头/钢/玻璃钢要 Heavy。浅水要铺桥、沼泽要垫地基、深水不能建、山体矿石要先开采。');
  lines.push('- 房间要能走进去（BFS 可达），否则房间判定不成立。');
  lines.push('- 电力按 6 格连接规则组网，自己算发电/耗电/储电。');
  lines.push('');
  lines.push('## 建筑（gameDef / 中文名 / 占地 / 可旋转 / 吃材质 / 电）');
  lines.push('| def | 名称 | 占地 | rotatable | stuff | power | cat |');
  lines.push('| --- | --- | --- | --- | --- | --- | --- |');

  const ids = Object.keys(idx.byId).sort();
  for (const id of ids) {
    const d = idx.byId[id];
    if (cat && d.cat !== cat) continue;
    const g = app.RWExport.gameDefName(d);
    if (!g) continue;
    const p = d.powerUse ? ('-' + d.powerUse) : d.powerGen ? ('+' + d.powerGen) : d.powerStore ? ('=' + d.powerStore) : '';
    const size = Array.isArray(d.size) ? d.size.join('x') : '1x1';
    lines.push('| ' + g + ' | ' + d.name + ' | ' + size + ' | ' +
      (d.rotatable === false ? 'no' : 'yes') + ' | ' + (d.stuff ? 'yes' : 'no') + ' | ' + p + ' | ' + d.cat + ' |');
  }

  lines.push('');
  lines.push('## 地板（floors 的取值）');
  const fids = Object.keys(app.RWData.floorsById || {}).sort();
  lines.push(fids.map(function (fid) {
    const f = app.RWData.floorsById[fid];
    return (f.def || fid) + '(' + (f.name || fid) + ')';
  }).join('、'));

  return { ok: true, text: lines.join('\n') };
}

// ---------------------------------------------------------------- main
const COMMANDS = {
  import: cmdImport,
  apply: cmdApply,
  validate: cmdValidate,
  render: cmdRender,
  'build-ops': cmdBuildOps,
  estimate: cmdEstimate,
  project: cmdProject,
  brief: cmdBrief,
  blueprint: cmdBlueprint,
  state: cmdState,
  describe: cmdDescribe,
  doctor: cmdDoctor
};

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);
  const cmd = args._.shift();
  if (!cmd || cmd === 'help' || cmd === '--help' || args.flags.help) {
    process.stdout.write([
      'node tools/plan.js <命令> [参数]',
      '',
      '  import <存档.rws> [--map N]   读存档（地形/小人/科技/库存）→ .planner/state.rwplan.json',
      '  apply  <plan.json>            把新规划叠到存档缓存上（可反复改）',
      '  validate [--limit N]          校验：冲突/地形/电力/房间/可达',
      '  render  [--width 100]         ASCII 图（游戏坐标）',
      '  build-ops [--all]             输出 build() 调用列表（默认只导新规划）',
      '  estimate [--builders N]       材料缺口 / 科技缺口 / 工期结论',
      '  project [--out 文件.rwplan]   导出网页能直接打开的工程文件',
      '  brief [--rect x,z,x2,z2] [--out 简报.md]   给没有存档访问权的 AI 的基地简报',
      '  blueprint [--out 文件.xml]    导出 Blueprints 模组蓝图',
      '  state                         打印当前工程 JSON',
      '  describe [--cat 分类]         打印契约：def 表 + 规则 + 示例',
      '  doctor                        环境自检：Node 版本 / 内核 / 存档目录',
      '',
      '通用参数：--state <路径>  默认 .planner/state.rwplan.json',
      ''
    ].join('\n'));
    return;
  }

  const fn = COMMANDS[cmd];
  if (!fn) fail('不认识的命令：' + cmd + '（用 --help 看列表）');

  const out = await fn(args);
  if (out && out.text) {
    process.stdout.write(out.text + '\n');
  } else {
    process.stdout.write(JSON.stringify(out, null, 1) + '\n');
  }
}

main().catch(function (e) {
  if (!process.exitCode) {
    process.stderr.write((e && e.stack || String(e)) + '\n');
    process.exitCode = 1;
  }
});
