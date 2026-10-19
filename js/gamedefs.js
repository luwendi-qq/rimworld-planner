/*
 * gamedefs.js —— 在浏览器里解析 RimWorld 的 Defs，得到精确的建筑数据
 *
 * 这是 tools/extract_defs.py 的 JS 版：拖入游戏目录后现场生成
 *   · 建筑表（尺寸 / 电力 / 通行性 / 材质分类 / 是否门 / 输电标记…）
 *   · 材质表（StuffDef：颜色、所属分类、外观、常用度）
 *   · 地板表（TerrainDef 的贴图与颜色）
 * 结果直接喂给 RWData.mergeBuildings()，和跑 Python 脚本的效果一样。
 */
(function (global) {
  'use strict';

  var DLC_DIRS = ['Royalty', 'Ideology', 'Biotech', 'Anomaly', 'Odyssey'];

  var CAT_MAP = {
    structure: 'structure', orders: 'structure', floors: 'structure', zone: 'structure',
    furniture: 'furniture', joy: 'joy', recreation: 'joy',
    production: 'production', power: 'power', temperature: 'temperature',
    security: 'security', misc: 'misc', ship: 'misc', ideology: 'misc',
    royalty: 'misc', biotech: 'misc', anomaly: 'misc', odyssey: 'misc',
    medical: 'furniture', furniturearchitecture: 'furniture'
  };

  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
  /** 中文名兜底：官方语言包 > 内置对照表（zh-names.js）> 英文 label */
  function zhNameOf(dn, fallback) {
    var D = global.RWData;
    if (D && D.zhName) { var v = D.zhName(dn); if (v) return v; }
    return fallback || dn;
  }
  function tag(el) { var t = el.tagName || el.nodeName || ''; return t.indexOf(':') >= 0 ? t.split(':').pop() : t; }
  function kids(el, name) {
    var out = [];
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 1 && tag(c) === name) out.push(c);
    }
    return out;
  }
  function kid(el, name) { var l = kids(el, name); return l.length ? l[0] : null; }
  function textOf(el, name) { var c = kid(el, name); return c && c.textContent != null ? c.textContent.trim() : null; }
  function listText(el, name) {
    var c = kid(el, name); if (!c) return [];
    var out = [];
    for (var i = 0; i < c.childNodes.length; i++) {
      var li = c.childNodes[i];
      if (li.nodeType === 1 && li.textContent && li.textContent.trim()) out.push(li.textContent.trim());
    }
    return out;
  }
  function parseSize(raw) {
    var m = /^\(?\s*(\d+)\s*[,xX]\s*(\d+)\s*\)?$/.exec(String(raw || '').trim());
    if (!m) return [1, 1];
    var w = +m[1], h = +m[2];
    return (w < 1 || h < 1) ? [1, 1] : [w, h];
  }
  function num(v, d) { var n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }
  function hexColor(raw) {
    if (!raw) return null;
    var nums = (String(raw).match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    if (nums.length < 3) return null;
    if (Math.max(nums[0], nums[1], nums[2]) <= 1) nums = nums.map(function (n) { return n * 255; });
    function h(n) { n = Math.max(0, Math.min(255, Math.round(n))); return (n < 16 ? '0' : '') + n.toString(16); }
    return '#' + h(nums[0]) + h(nums[1]) + h(nums[2]);
  }

  /** 按名字猜一个矢量图标画法（贴图缺失时的兜底，和 extract_defs.py 一致） */
  function pickArt(defName) {
    var n = norm(defName);
    var rules = [
      [/walllamp|torchwalllamp/, 'walllamp'],
      [/^wall$|slabwall|ship_beam/, 'wall'],
      [/autodoor/, 'autodoor'],
      [/door|flap(?!.*animal)|animalflap/, 'door'],
      [/fencegate/, 'fencegate'],
      [/fence/, 'fence'],
      [/column|pillar/, 'column'],
      [/sandbag/, 'sandbag'],
      [/barricade/, 'barricade'],
      [/barrier/, 'barrier'],
      [/^bridge/, 'bridge'],
      [/bedroll/, 'bedroll'],
      [/hospitalbed|medicalbed/, 'hospbed'],
      [/crib/, 'crib'],
      [/animalbed/, 'animalbed'],
      [/animalsleepingbox/, 'animalbox'],
      [/bed$|bed(?!roll)/, 'bed'],
      [/sleepingspot$|animalsleepingspot|sleepingspot/, 'spot'],
      [/^spot$/, 'spot'],
      [/stool/, 'stool'],
      [/chair|throne|armchair|couch/, 'chair'],
      [/dresser/, 'dresser'],
      [/shelf|bookcase/, 'shelf'],
      [/plantpot/, 'pot'],
      [/statue|sculpture/, 'statue'],
      [/torch/, 'torch'],
      [/sunlamp/, 'sunlamp'],
      [/lamp|floodlight|glow/, 'lamp'],
      [/brazier|campfire|fire/, 'brazier'],
      [/drape/, 'drape'],
      [/television|tv$/, 'screen'],
      [/butcher/, 'butcher'],
      [/stonecutter/, 'bench'],
      [/sculpt/, 'statuebench'],
      [/tailor|smithy|machining|fabrication|research|drug|crafting|^table/, 'bench'],
      [/stove|cook/, 'stove'],
      [/smelt|cremator|furnace/, 'smelter'],
      [/refiner|refinery|brewery/, 'refinery'],
      [/barrel/, 'barrel'],
      [/dispenser/, 'dispenser'],
      [/hydroponic/, 'hydro'],
      [/deepdrill|drill/, 'drill'],
      [/scanner|analyzer/, 'scanner'],
      [/console|comms/, 'console'],
      [/hopper/, 'hopper'],
      [/conduit|cable|powerline/, 'conduit'],
      [/powerswitch|switch/, 'switch'],
      [/battery/, 'battery'],
      [/solar/, 'solar'],
      [/windturbine|wind/, 'wind'],
      [/watermill/, 'watermill'],
      [/geothermal|^geo/, 'geo'],
      [/generator|reactor|powercell/, 'generator'],
      [/cooler|radiator/, 'cooler'],
      [/heater/, 'heater'],
      [/vent/, 'vent'],
      [/turret|autocannon|foamturret|sniper/, 'turret'],
      [/mortar|rocket|artillery/, 'mortar'],
      [/trap|mine/, 'trap'],
      [/grave|sarcophag|tomb/, 'grave'],
      [/horseshoe/, 'horseshoes'],
      [/altar|shrine|stele|monolith/, 'altar'],
      [/pod|launcher/, 'pod'],
      [/cryptosleep|vat|gestator|recharger|casket/, 'pod'],
      [/beacon|relay|marker|spot$/, 'spot'],
      [/table/, 'table']
    ];
    for (var i = 0; i < rules.length; i++) if (rules[i][0].test(n)) return rules[i][1];
    return 'generic';
  }

  // ---------------------------------------------------------------- 继承摊平

  function parentsOf(el, named) {
    var acc = [], cur = el, d = 0;
    while (d++ < 12) {
      var pn = cur.getAttribute && cur.getAttribute('ParentName');
      if (!pn || !named[pn]) break;
      acc.unshift(named[pn]);
      cur = named[pn];
    }
    return acc;
  }

  var SCALARS = ['defName', 'label', 'category', 'designationCategory', 'passability',
    'holdsRoof', 'fillPercent', 'size', 'thingClass', 'rotatable',
    'specialDisplayRadius', 'designationHotKey', 'terrainAffordanceNeeded',
    'mineable', 'useStuffTerrainAffordance', 'constructionSkillPrerequisite', 'techLevel',
    'costStuffCount'];

  /** 把一条 def 的继承链摊平 */
  function resolve(el, named) {
    var chain = parentsOf(el, named).concat([el]);
    var m = { comps: [], stuffCategories: [], statBases: {}, building: {}, graphicData: {},
              costList: [], research: [] };
    SCALARS.forEach(function (k) { m[k] = null; });
    chain.forEach(function (node) {
      SCALARS.forEach(function (k) { var v = textOf(node, k); if (v != null) m[k] = v; });
      var st = kid(node, 'statBases');
      if (st) for (var i = 0; i < st.childNodes.length; i++) {
        var c = st.childNodes[i];
        if (c.nodeType === 1 && c.textContent) m.statBases[tag(c)] = c.textContent.trim();
      }
      var bd = kid(node, 'building');
      if (bd) for (var j = 0; j < bd.childNodes.length; j++) {
        var b = bd.childNodes[j];
        if (b.nodeType === 1 && b.textContent) m.building[tag(b)] = b.textContent.trim();
      }
      // costList / researchPrerequisites：和游戏一样，子节点默认追加；写了 Inherit=false 则清空
      [['costList', 'costList'], ['researchPrerequisites', 'research']].forEach(function (pair) {
        var box = kid(node, pair[0]);
        if (!box) return;
        if (box.getAttribute('Inherit') === 'false') m[pair[1]] = [];
        for (var k3 = 0; k3 < box.childNodes.length; k3++) {
          var li = box.childNodes[k3];
          if (li.nodeType !== 1) continue;
          var v = (li.textContent || '').trim();
          if (v) m[pair[1]].push({ key: tag(li), val: v });
        }
      });
      var gd = kid(node, 'graphicData');
      if (gd) {
        ['texPath', 'graphicClass', 'drawSize', 'drawOffset', 'linkType', 'shaderType',
          'color', 'drawRotated', 'drawOffsetNorth', 'drawOffsetEast', 'drawOffsetSouth',
          'drawOffsetWest'].forEach(function (k) {
          var v = textOf(gd, k); if (v != null) m.graphicData[k] = v;
        });
        var lf = listText(gd, 'linkFlags');
        if (lf.length) m.graphicData.linkFlags = lf;
      }
      var comps = kid(node, 'comps');
      if (comps) {
        if (comps.getAttribute('Inherit') === 'false') m.comps = [];
        for (var k2 = 0; k2 < comps.childNodes.length; k2++) {
          if (comps.childNodes[k2].nodeType === 1) m.comps.push(comps.childNodes[k2]);
        }
      }
      var sc = kid(node, 'stuffCategories');
      if (sc) {
        if (sc.getAttribute('Inherit') === 'false') m.stuffCategories = [];
        m.stuffCategories = m.stuffCategories.concat(listText(node, 'stuffCategories'));
      }
    });
    // costList 汇总成 { 物品: 数量 }；researchPrerequisites 里是 <li>名字</li>
    var cost = {};
    m.costList.forEach(function (c) { cost[c.key] = (cost[c.key] || 0) + num(c.val); });
    m.cost = cost;
    m.research = m.research.map(function (r) { return r.key === 'li' ? r.val : r.key; });
    return m;
  }

  /** 读取 <affordances> 列表（地形用） */
  function affordancesOf(el, named) {
    var chain = parentsOf(el, named).concat([el]);
    var out = [];
    chain.forEach(function (node) {
      var box = kid(node, 'affordances');
      if (!box) return;
      if (box.getAttribute('Inherit') === 'false') out = [];
      for (var i = 0; i < box.childNodes.length; i++) {
        var li = box.childNodes[i];
        if (li.nodeType !== 1) continue;
        var v = (li.textContent || '').trim();
        if (v && out.indexOf(v) < 0) out.push(v);
      }
    });
    return out;
  }

  // ---------------------------------------------------------------- 主入口

  /**
   * docs: [{ path, xml }]  —— path 形如 Data/Core/Defs/... （用来判断属于哪个 DLC）
   * lang: { defName: 中文名 }（可选）
   */
  function parse(docs, lang) {
    lang = lang || {};
    var named = {}, thingDefs = [], cats = [], terrainDefs = [], stuffDefs = [], seenDef = {};
    var researchDefs = [];
    var parser = new DOMParser();
    docs.forEach(function (doc) {
      var xml;
      try { xml = parser.parseFromString(doc.xml, 'application/xml'); }
      catch (e) { return; }
      if (!xml || xml.getElementsByTagName('parsererror').length) return;
      var dlc = '';
      var m = /(?:^|[\\/])Data[\\/]([^\\/]+)[\\/]/i.exec(doc.path);
      if (m && DLC_DIRS.indexOf(m[1]) >= 0) dlc = m[1];
      var all = xml.getElementsByTagName('*');
      for (var i = 0; i < all.length; i++) {
        var el = all[i];
        var t = tag(el);
        var nm = el.getAttribute && el.getAttribute('Name');
        if (nm && !named[nm]) named[nm] = el;
        if (t === 'ThingDef') thingDefs.push({ el: el, dlc: dlc });
        else if (t === 'TerrainDef') terrainDefs.push(el);
        else if (t === 'StuffCategoryDef') cats.push(el);
        else if (t === 'ResearchProjectDef') researchDefs.push(el);
      }
    });

    // ---- 材质分类（按文档顺序）----
    var stuffCats = [], seenCat = {};
    cats.forEach(function (el) {
      var dn = textOf(el, 'defName');
      if (dn && !seenCat[dn]) { seenCat[dn] = 1; stuffCats.push({ id: dn, name: lang[dn] || zhNameOf(dn, textOf(el, 'label')) }); }
    });

    // ---- 建筑 ----
    var builtin = global.RWData ? (function () {
      var s = {};
      (global.RWData.BUILDINGS || []).forEach(function (b) {
        s[norm(b.id)] = 1; if (b.en) s[norm(b.en)] = 1; if (b.def) s[norm(b.def)] = 1;
      });
      return s;
    })() : {};
    var entries = [], seen = {};
    thingDefs.forEach(function (rec) {
      var el = rec.el, m = resolve(el, named);
      var defName = m.defName;
      if (!defName || seen[defName]) return;
      seen[defName] = 1;
      if ((m.category || '') !== 'Building') return;
      var designCat = m.designationCategory;
      if (!designCat && !builtin[norm(defName)]) return;   // 只要玩家能建造的（+ 内置库里已有的）

      var size = parseSize(m.size);
      var compByClass = {};
      m.comps.forEach(function (li) { compByClass[li.getAttribute('Class') || ''] = li; });

      var powerUse = 0, powerGen = 0, powerStore = 0, hasPower = false, transmits = false;
      var isDoor = false;
      Object.keys(compByClass).forEach(function (cls) {
        var li = compByClass[cls];
        var tp = (textOf(li, 'transmitsPower') || '').toLowerCase();
        if (tp === 'true') transmits = true;
        if (cls.indexOf('Power') < 0 && cls.indexOf('Battery') < 0) {
          if (cls.indexOf('Door') >= 0) isDoor = true;
          return;
        }
        if (cls.indexOf('Battery') >= 0) {
          hasPower = true;
          powerStore = Math.max(powerStore, num(textOf(li, 'storedEnergyMax')));
          return;
        }
        hasPower = true;
        var cons = num(textOf(li, 'basePowerConsumption'));
        var gen = num(textOf(li, 'basePowerGeneration'));
        if (cls.indexOf('PowerPlant') >= 0) {
          if (gen > 0) powerGen = Math.max(powerGen, gen);
          else if (cons < 0) powerGen = Math.max(powerGen, -cons);
        } else if (cons < 0) powerGen = Math.max(powerGen, -cons);
        else powerUse = Math.max(powerUse, cons);
      });
      if ((m.thingClass || '').indexOf('Door') >= 0) isDoor = true;

      var pass = m.passability || 'Walkable';
      var holdsRoof = m.holdsRoof === 'true';
      var stuff = m.stuffCategories.length > 0;
      var beauty = num(m.statBases.Beauty);
      var tags = [];
      if ((pass === 'Impassable' || pass === 'PassThroughOnly') && !isDoor) tags.push('solid');
      if (isDoor) tags.push('door');
      if (hasPower || defName === 'PowerConduit') tags.push('power');
      if (powerGen > 0) tags.push('gen');
      if (powerStore > 0) tags.push('store');
      if (defName === 'PowerConduit' || norm(defName).indexOf('conduit') >= 0) { tags.push('conduit'); tags.push('under'); }
      if (pass === 'Walkable' || pass === 'Standable') tags.push('pass');
      if (holdsRoof) tags.push('roof');
      if (isDoor || (holdsRoof && pass === 'Impassable') || /wall|fence|embrasure/.test(norm(defName))) tags.push('room');
      if (/walllamp/.test(norm(defName)) || /cooler/.test(norm(defName)) || /vent/.test(norm(defName))) tags.push('onwall');
      if (/lamp/.test(norm(defName)) || /torch/.test(norm(defName))) tags.push('light');
      if (/turret/.test(norm(defName))) tags.push('turret');
      if (/^(bed|doublebed|royalbed|hospitalbed|crib|bedroll)/.test(norm(defName))) tags.push('bed');

      var category = CAT_MAP[norm(designCat)] || CAT_MAP[norm(m.category)] || 'misc';
      var entry = {
        id: defName,
        name: lang[defName] || zhNameOf(defName, m.label),
        en: defName,
        cat: category,
        size: size,
        art: pickArt(defName),
        tags: tags.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(),
        def: defName
      };
      if (Math.round(beauty * 100) !== 0) entry.beauty = Math.round(beauty * 100) / 100;
      if (powerUse) entry.powerUse = Math.round(powerUse);
      if (powerGen) entry.powerGen = Math.round(powerGen);
      if (powerStore) entry.powerStore = Math.round(powerStore);
      if (stuff) entry.stuff = true;
      if (m.stuffCategories.length) entry.stuffCats = m.stuffCategories;
      if (transmits) entry.tx = 1;
      if ((m.building.allowWireConnection || '').toLowerCase() === 'false') entry.awc = 0;
      if ((m.thingClass || '').indexOf('Building_Door') >= 0) entry.door = 1;
      if ((m.rotatable || '').toLowerCase() === 'false') entry.rotatable = false;
      var r = num(m.specialDisplayRadius);
      if (r > 0) entry.radius = r;
      // 建造所需：工时、固定材料、科技前置、技能前置、地形要求
      var workToBuild = num(m.statBases.WorkToBuild);
      if (workToBuild > 0) entry.work = Math.round(workToBuild);
      if (Object.keys(m.cost).length) entry.cost = m.cost;
      var csc = num(m.costStuffCount);
      if (csc > 0) entry.costStuff = csc;
      if (m.research.length) entry.research = m.research;
      var skill = num(m.constructionSkillPrerequisite);
      if (skill > 0) entry.skillReq = skill;
      if (m.terrainAffordanceNeeded && m.terrainAffordanceNeeded !== 'true') entry.aff = m.terrainAffordanceNeeded;
      if ((m.useStuffTerrainAffordance || '').toLowerCase() === 'true') entry.useStuffAff = 1;
      if (rec.dlc) entry.dlc = rec.dlc;
      entries.push(entry);
    });

    // ---- 材质 ----
    var used = {};
    entries.forEach(function (e) { (e.stuffCats || []).forEach(function (c) { used[c] = 1; }); });
    var stuffs = [], seenStuff = {};
    thingDefs.forEach(function (rec) {
      var el = rec.el;
      var cc = null, app = null, color = null, common = null;
      var workFactor = null, workOffset = null, csFactor = null, stAff = null;
      parentsOf(el, named).concat([el]).forEach(function (node) {
        var sp = kid(node, 'stuffProps');
        var affv = textOf(node, 'terrainAffordanceNeeded');
        if (affv) stAff = affv;
        if (!sp) return;
        var cbox = kid(sp, 'categories');
        if (cbox) { var l = listText(sp, 'categories'); if (l.length) cc = l; }
        var v = textOf(sp, 'appearance'); if (v) app = v;
        v = textOf(sp, 'color'); if (v) color = v;
        v = textOf(sp, 'commonality'); if (v) common = v;
        var fbox = kid(sp, 'statFactors');
        if (fbox) {
          var wf = textOf(fbox, 'WorkToBuild'); if (wf != null) workFactor = num(wf, 1);
          var cf = textOf(fbox, 'ConstructionSpeedFactor'); if (cf != null) csFactor = num(cf, 1);
        }
        var obox = kid(sp, 'statOffsets');
        if (obox) {
          var wo = textOf(obox, 'WorkToBuild'); if (wo != null) workOffset = num(wo, 0);
          var co = textOf(obox, 'ConstructionSpeedFactor'); if (co != null) csFactor = (csFactor == null ? 1 : csFactor) + num(co, 0);
        }
      });
      if (!cc) return;
      if (!cc.some(function (c) { return used[c]; })) return;
      var dn = textOf(el, 'defName');
      if (!dn || seenStuff[dn]) return;
      seenStuff[dn] = 1;
      var st = {
        id: dn, def: dn,
        name: lang[dn] || zhNameOf(dn, textOf(el, 'label')),
        color: hexColor(color), cats: cc, app: app || '', common: num(common)
      };
      if (workFactor != null) st.workFactor = workFactor;
      if (workOffset != null) st.workOffset = workOffset;
      if (csFactor != null) st.csFactor = csFactor;
      if (stAff) st.aff = stAff;
      stuffs.push(st);
    });

    // ---- 材料/物品名（造价清单会引用 Steel / ComponentIndustrial 这类 defName）----
    var items = {};
    thingDefs.forEach(function (rec) {
      var dn = textOf(rec.el, 'defName');
      if (!dn || items[dn]) return;
      var nm = lang[dn] || zhNameOf(dn, textOf(rec.el, 'label'));
      if (nm) items[dn] = nm;
    });

    // ---- 自然岩石（山体）----
    var rocks = [], seenRock = {};
    thingDefs.forEach(function (rec) {
      var el = rec.el, m = resolve(el, named);
      if (!m.defName || seenRock[m.defName]) return;
      var natural = (m.building.isNaturalRock || '').toLowerCase() === 'true';
      if (!natural && (m.mineable || '').toLowerCase() !== 'true') return;
      if ((m.category || '') !== 'Building') return;
      seenRock[m.defName] = 1;
      var hp = num(m.statBases.MaxHitPoints, 400);
      var mt = m.building.mineableThing || null;
      var y = num(m.building.mineableYield, 1);
      var isRes = (m.building.isResourceRock || '').toLowerCase() === 'true';
      rocks.push({
        def: m.defName,
        name: lang[m.defName] || zhNameOf(m.defName, m.label),
        hp: hp, mineableThing: mt, yield: y, resource: isRes,
        color: hexColor(m.graphicData.color)
      });
    });

    // ---- 地形（TerrainDef）----
    var terrain = {};
    terrainDefs.forEach(function (el) {
      var dn = textOf(el, 'defName');
      if (!dn) return;
      var tp = textOf(el, 'texturePath') || textOf(el, 'texPath');
      var parent = el.getAttribute('ParentName');
      if (!tp && parent && terrain[parent]) tp = terrain[parent].texPath;
      var col = hexColor(textOf(el, 'color'));
      if (!col && parent && terrain[parent]) col = terrain[parent].color;
      var aff = affordancesOf(el, named);
      var cost = {};
      var cl = kid(el, 'costList');
      if (cl) for (var ci = 0; ci < cl.childNodes.length; ci++) {
        var c = cl.childNodes[ci];
        if (c.nodeType === 1) cost[tag(c)] = num(c.textContent);
      }
      var work = null;
      var stb = kid(el, 'statBases');
      if (stb) { var w = textOf(stb, 'WorkToBuild'); if (w != null) work = num(w); }
      var research = listText(el, 'researchPrerequisites');
      var smooth = textOf(el, 'smoothedTerrain') || (parent && terrain[parent] ? terrain[parent].smoothTo : null);
      terrain[dn] = {
        def: dn,
        name: lang[dn] || zhNameOf(dn, textOf(el, 'label')),
        texPath: tp, color: col, aff: aff,
        need: textOf(el, 'terrainAffordanceNeeded') || null,
        work: work, cost: Object.keys(cost).length ? cost : null,
        research: research.length ? research : null,
        smoothTo: smooth || null,
        isWater: /^(Water|Marsh|Mud|Lava|HotSpring)/.test(dn)
      };
    });
    // 从自然岩石生成游戏运行时才会有的三种地形：X_Rough / X_RoughHewn / X_Smooth
    rocks.forEach(function (rk) {
      var baseName = rk.name || rk.def;
      var col = rk.color || '#6a6a6a';
      [['_Rough', '粗' + baseName], ['_RoughHewn', '开采' + baseName], ['_Smooth', '光滑' + baseName]].forEach(function (pair) {
        var dn = rk.def + pair[0];
        if (terrain[dn]) return;
        terrain[dn] = {
          def: dn, name: pair[1], texPath: null, color: col,
          aff: pair[0] === '_Smooth' ? ['Light', 'Medium', 'Heavy'] : ['Light', 'Medium', 'Heavy', 'SmoothableStone'],
          work: null, cost: null, research: null,
          smoothTo: pair[0] === '_Smooth' ? null : rk.def + '_Smooth',
          isWater: false, isRock: true
        };
      });
    });

    // ---- 科技树（ResearchProjectDef）----
    var researches = [], seenRes = {};
    researchDefs.forEach(function (el) {
      var dn = textOf(el, 'defName');
      if (!dn || seenRes[dn]) return;
      seenRes[dn] = 1;
      researches.push({
        def: dn,
        name: lang[dn] || zhNameOf(dn, textOf(el, 'label')),
        cost: num(textOf(el, 'baseCost'), 0),
        prereq: listText(el, 'prerequisites'),
        techLevel: textOf(el, 'techLevel') || '',
        anomaly: /anomaly/i.test(dn) || /Knowledge/.test(textOf(el, 'tab') || '')
      });
    });

    return {
      buildings: entries, stuffs: stuffs, stuffCats: stuffCats, terrain: terrain,
      rocks: rocks, researches: researches, items: items,
      __raw: thingDefs, __named: named
    };
  }

  /** 从一份 DefInjected XML 里收集 label（官方语言包解包后的形式） */
  function collectLangXml(xml, out) {
    var m = xml.match(/<([A-Za-z0-9_]+)\.(label|labelNoun)>([^<]+)</g);
    if (!m) return 0;
    var n = 0;
    m.forEach(function (s) {
      var mm = /<([A-Za-z0-9_]+)\.(label|labelNoun)>([^<]+)</.exec(s);
      if (!mm) return;
      var key = mm[1], kind = mm[2], val = mm[3].trim();
      if (kind === 'label') { out[key] = val; n++; }
      else if (!out[key]) { out[key] = val; n++; }
    });
    return n;
  }

  /** 解析官方语言包的 .tar（Languages/ChineseSimplified*.tar），拿到官方中文名 */
  function parseLangTar(bytes) {
    var out = {};
    var u8 = bytes, p = 0;
    var dec = new TextDecoder('utf-8');
    while (p + 512 <= u8.length) {
      var name = dec.decode(u8.subarray(p, p + 100)).replace(/\0.*$/, '');
      if (!name) break;
      var sizeStr = dec.decode(u8.subarray(p + 124, p + 136)).replace(/\0.*$/, '').trim();
      var size = parseInt(sizeStr, 8) || 0;
      var type = u8[p + 156];
      var dataStart = p + 512;
      if (type === 0 || type === 48) {          // 普通文件
        var lower = name.toLowerCase();
        if (/definjected\/(thingdef|stuffcategorydef|terraindef|researchprojectdef)\/.*\.xml$/.test(lower)) {
          var xml = dec.decode(u8.subarray(dataStart, dataStart + size));
          var m = xml.match(/<([A-Za-z0-9_]+)\.(label|labelNoun)>([^<]+)</g);
          if (m) {
            m.forEach(function (s) {
              var mm = /<([A-Za-z0-9_]+)\.(label|labelNoun)>([^<]+)</.exec(s);
              if (!mm) return;
              var key = mm[1], kind = mm[2], val = mm[3].trim();
              if (kind === 'label') out[key] = val;
              else if (!out[key]) out[key] = val;
            });
          }
        }
      }
      p = dataStart + Math.ceil(size / 512) * 512;
    }
    return out;
  }

  global.RWDefs = {
    parse: parse, parseLangTar: parseLangTar, pickArt: pickArt, norm: norm,
    __resolve: resolve, collectLangXml: collectLangXml
  };
})(typeof window !== 'undefined' ? window : globalThis);
