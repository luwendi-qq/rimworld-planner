/*
 * main.js —— 界面装配与事件绑定
 */
(function (global) {
  'use strict';

  var RW = global.RW, Data = global.RWData, Art = global.RWArt, X = global.RWExport, Io = global.RWIo, Checks = global.RWChecks;
  var Rooms = global.RWRooms;
  var state = RW.state;
  var $ = function (id) { return document.getElementById(id); };

  // 让 data.js 里的 _color 生效（结构件取用户设定的墙体材质色）
  var STUFF_COLORS = {
    wood: '#8b6a45', stone: '#8d8d88', steel: '#79828d', silver: '#b9c2c9',
    plasteel: '#5a6b7a', uranium: '#7f8f4a', gold: '#c9a63c'
  };
  // 全局兜底材质：只有「老工程文件里没记材质」的建筑才会用到
  function stuffColor(key) {
    var s = Data.stuffById ? Data.stuffById(key) : null;
    if (s && s.color) return s.color;
    var S = global.RWSprites;
    if (S && S.stuff && S.stuff[key]) return S.stuff[key];
    return STUFF_COLORS[key] || STUFF_COLORS.stone;
  }
  var currentStuff = 'stone';

  function applyStuff() {
    var c = STUFF_COLORS[currentStuff] || STUFF_COLORS.stone;
    Data.BUILDINGS.forEach(function (b) {
      if (b.cat === 'structure' && b.stuff) b._color = c;
    });
    if (Art.setMaterial) Art.setMaterial(currentStuff, stuffColor(currentStuff));
  }

  // ------------------------------------------------------------------ 物品栏
  var activeCat = 'structure';
  var searchText = '';

  // ------------------------------------------------------------------ 收藏
  function isFav(id) { return (state.favorites || []).indexOf(id) >= 0; }
  function toggleFav(id) {
    var list = state.favorites || (state.favorites = []);
    var i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
    savePrefs();
    buildPalette();
  }
  function savePrefs() {
    var s = Io.loadSettings() || {};
    s.favorites = state.favorites || [];
    s.recent = state.recent || [];
    s.ambientTemp = state.ambientTemp;
    Io.saveSettings(s);
  }

  function buildTabs() {
    var box = $('catTabs');
    box.innerHTML = '';
    // 收藏 / 最近：200 多个建筑全靠搜索太累，这两个页签把常用的挑出来
    [['fav', '★ 收藏'], ['recent', '🕘 最近']].forEach(function (pair) {
      var b = document.createElement('button');
      b.className = 'tab' + (pair[0] === activeCat ? ' on' : '');
      b.textContent = pair[1];
      b.onclick = function () { activeCat = pair[0]; buildTabs(); buildPalette(); };
      box.appendChild(b);
    });
    // 导入过模组建筑才出现「🧩 模组」页签（数据来自 js/modimport.js）
    var modApi = global.RWMods;
    if (modApi && modApi.list && modApi.list().length && hasModBuildings()) {
      var mb = document.createElement('button');
      mb.id = 'mod';
      mb.className = 'tab' + (activeCat === 'mod' ? ' on' : '');
      mb.textContent = '🧩 模组';
      mb.title = modBuildings().length + ' 项';
      mb.onclick = function () { activeCat = 'mod'; buildTabs(); buildPalette(); };
      box.appendChild(mb);
    }
    Data.CATEGORIES.forEach(function (c) {
      var n = Data.BUILDINGS.filter(function (b) { return b.cat === c.id; }).length;
      var b = document.createElement('button');
      b.className = 'tab' + (c.id === activeCat ? ' on' : '');
      b.textContent = c.name;
      b.title = n + ' 项';
      b.onclick = function () { activeCat = c.id; buildTabs(); buildPalette(); };
      box.appendChild(b);
    });
    // 游戏菜单里的「地板」「区域」也做成页签
    [['floor', '地板']].forEach(function (pair) {
      var b = document.createElement('button');
      b.className = 'tab' + (pair[0] === activeCat ? ' on' : '');
      b.textContent = pair[1];
      b.onclick = function () { activeCat = pair[0]; buildTabs(); buildPalette(); };
      $('catTabs').appendChild(b);
    });
  }

  /** 物品栏 tooltip 里的「造价 / 工时 / 科技 / 技能」 */
  function buildInfoText(def) {
    var out = '';
    // 造价
    var cost = [];
    if (def.cost) {
      Object.keys(def.cost).forEach(function (k) {
        var n = def.cost[k];
        if (!n) return;
        cost.push((Data.itemName ? Data.itemName(k) : k) + '×' + n);
      });
    }
    if (def.costStuff) {
      var sid = (state.lastStuff && state.lastStuff[def.id]) || null;
      var s = (sid && Data.stuffById) ? Data.stuffById(sid) : null;
      if (!s && Data.stuffsFor) {
        var list = Data.stuffsFor(def);
        s = (list && list.length) ? list[0] : null;
      }
      cost.push('材质×' + def.costStuff + (s ? '（' + s.name + '）' : ''));
    }
    if (cost.length) out += '\n造价 ' + cost.join('、');
    if (def.work) out += '\n工时 ' + def.work;
    if (def.research && def.research.length) {
      var rs = def.research.map(function (r) {
        var info = Data.research ? Data.research(r) : null;
        return info ? info.name : r;
      });
      out += '\n科技 ' + rs.join('、');
    }
    if (def.skillReq) out += '\n建造技能 ' + def.skillReq;
    if (def.hp) out += '\n耐久 ' + def.hp;
    if (def.menu === 0) out += '\n不在建筑师菜单里（工作台制作 / 任务奖励）';
    return out;
  }

  function buildPalette() {
    var box = $('palette');
    box.innerHTML = '';
    var q = searchText.trim().toLowerCase();
    var list;
    if (activeCat === 'floor') {
      list = Data.FLOORS.map(function (f) { return { floor: f }; });
    } else if (activeCat === 'fav') {
      list = (state.favorites || []).map(function (id) {
        var d = Data.byId[id]; return d ? { def: d } : null;
      }).filter(Boolean);
    } else if (activeCat === 'recent') {
      list = (state.recent || []).map(function (id) {
        var d = Data.byId[id]; return d ? { def: d } : null;
      }).filter(Boolean);
    } else if (activeCat === 'mod') {
      // 只列模组扫描进来的建筑（照常应用搜索过滤）
      list = Data.BUILDINGS.filter(function (b) {
        if (!b.mod) return false;
        if (!q) return true;
        return (b.name + ' ' + (b.en || '') + ' ' + b.id + ' ' +
          (b.modName || '') + ' ' + b.mod).toLowerCase().indexOf(q) >= 0;
      }).map(function (b) { return { def: b }; });
    } else {
      list = Data.BUILDINGS.filter(function (b) {
        if (b.cat !== activeCat) return false;
        if (!q) return true;
        return (b.name + ' ' + (b.en || '') + ' ' + b.id).toLowerCase().indexOf(q) >= 0;
      }).map(function (b) { return { def: b }; });
    }
    if (q && activeCat !== 'floor' && activeCat !== 'fav' && activeCat !== 'recent' && activeCat !== 'mod') {
      // 搜索时跨类别
      list = Data.BUILDINGS.filter(function (b) {
        return (b.name + ' ' + (b.en || '') + ' ' + b.id).toLowerCase().indexOf(q) >= 0;
      }).map(function (b) { return { def: b }; });
    }
    if (!list.length) {
      box.innerHTML = '<div class="empty">' +
        (activeCat === 'fav' ? '还没收藏东西 —— 点物品上的 ☆ 可以收藏' :
         activeCat === 'recent' ? '还没有用过的东西' :
         activeCat === 'mod' ? '还没有导入模组建筑 —— 右侧「导入模组建筑」把 Mods 文件夹拖进来' :
         '没有匹配项') + '</div>';
      return;
    }

    list.forEach(function (item) {
      var el = document.createElement('button');
      el.className = 'pitem';
      var cv = document.createElement('canvas');
      el.appendChild(cv);
      var label = document.createElement('span');
      var def = item.def;
      if (def) {
        label.innerHTML = '<b>' + esc(def.name) + '</b><i>' + def.size[0] + '×' + def.size[1] +
          (def.powerGen ? ' ⚡' + def.powerGen : (def.powerUse ? ' ⚡-' + def.powerUse : '')) +
          (def.menu === 0 ? ' <em title="不在建筑师菜单里（工作台制作 / 任务奖励）">○</em>' : '') +
          (def.v && !def.exact ? ' <em title="尺寸可能随版本变动，请以游戏内为准">?</em>' : '') + '</i>' +
          '<i class="stuff" data-stuff="' + esc(def.id) + '"></i>';
        var dn = def.def || def.id;
        var en = def.en || '';
        el.title = def.name +
          (def.mod ? '（模组：' + (def.modName || def.mod) + '）' : '') +
          (en && en !== def.name && en.toLowerCase() !== String(dn).toLowerCase() ? '（' + en + '）' : '') +
          (def.dlc ? '　[' + def.dlc + ']' : '') +
          (def.menu === 0 ? '\n○ 不在建筑师菜单里（工作台制作 / 任务奖励）' : '') +
          '\nid: ' + dn +
          '\n占地 ' + def.size[0] + '×' + def.size[1] +
          (def.powerGen ? '\n发电 ' + def.powerGen + 'W' : '') +
          (def.powerUse ? '\n耗电 ' + def.powerUse + 'W' : '') +
          (def.beauty ? '\n美观 ' + def.beauty : '') +
          buildInfoText(def) +
          (def.stuffCats && def.stuffCats.length ? '\n可换材质：' + stuffCatsText(def) : '') +
          (def.stuffCats && def.stuffCats.length ? '\n（长按左键选材质）' : '');
      } else if (item.floor) {
        var f = item.floor;
        label.innerHTML = '<b>' + esc(f.name) + '</b><i>地板</i>';
        el.title = f.name;
      }
      el.appendChild(label);
      // 收藏标记：点一下 ☆ 把它收进「★ 收藏」页签
      if (def) {
        var fav = document.createElement('em');
        var on = isFav(def.id);
        fav.className = 'favMark' + (on ? ' on' : '');
        fav.textContent = on ? '★' : '☆';
        fav.title = on ? '取消收藏' : '收藏（会出现在「★ 收藏」页签）';
        fav.onclick = function (e) {
          e.stopPropagation(); e.preventDefault();
          toggleFav(def.id);
        };
        label.appendChild(fav);
      }
      el.onclick = function () {
        if (item.def) RW.setBrush('building', item.def.id);
        else RW.setBrush('floor', item.floor.id);
        markActive(el);
        updateBrushInfo();
      };
      // 长按左键 = 弹出这个建筑的材质菜单（和游戏里一样）
      if (def && def.stuffCats && def.stuffCats.length) bindLongPress(el, def);
      el.dataset.kind = item.def ? 'building' : 'floor';
      el.dataset.id = item.def ? item.def.id : item.floor.id;
      box.appendChild(el);
      // 画缩略图
      if (item.def) {
        Art.renderThumb(cv, item.def, 38);
      } else {
        var fctx = cv.getContext('2d');
        if (fctx) {
          var dpr = global.devicePixelRatio || 1;
          cv.width = 38 * dpr; cv.height = 38 * dpr;
          cv.style.width = '38px'; cv.style.height = '38px';
          fctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          for (var a = 0; a < 2; a++) for (var b2 = 0; b2 < 2; b2++) Art.drawFloor(fctx, item.floor, a * 17 + 2, b2 * 17 + 2, 17);
        }
      }
    });
    syncActive();
    refreshStuffBadges();
  }

  function stuffCatsText(def) {
    var cats = Data.STUFF_CATS || [];
    return (def.stuffCats || []).map(function (c) {
      for (var i = 0; i < cats.length; i++) if (cats[i].id === c) return cats[i].name;
      return c;
    }).join('、');
  }

  /** 更新每个物品栏格子上的「当前材质」小标签 */
  function refreshStuffBadges() {
    Array.prototype.forEach.call(document.querySelectorAll('.pitem i.stuff'), function (el) {
      var id = el.dataset.stuff;
      var def = Data.byId[id];
      if (!def || !def.stuffCats || !def.stuffCats.length) { el.textContent = ''; return; }
      var cur = (state.brush && state.brush.kind === 'building' && state.brush.id === id)
        ? state.brush.stuff : RW.defaultStuff(def);
      var s = Data.stuffById(cur);
      el.textContent = s ? s.name : '';
    });
  }

  // ---- 长按左键弹材质菜单（和游戏里建筑师菜单的操作一致）----
  var stuffMenuEl = null;
  function closeStuffMenu() {
    if (stuffMenuEl && stuffMenuEl.parentNode) stuffMenuEl.parentNode.removeChild(stuffMenuEl);
    stuffMenuEl = null;
  }
  function bindLongPress(el, def) {
    var timer = null, fired = false;
    el.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      fired = false;
      clearTimeout(timer);
      timer = setTimeout(function () { fired = true; openStuffMenu(el, def); }, 380);
    });
    ['mouseup', 'mouseleave'].forEach(function (ev) {
      el.addEventListener(ev, function () { clearTimeout(timer); });
    });
    el.addEventListener('click', function (e) {
      if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
    }, true);
    el.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      clearTimeout(timer);
      openStuffMenu(el, def);
    });
  }

  function openStuffMenu(anchor, def) {
    closeStuffMenu();
    var list = Data.stuffsFor(def);
    if (!list.length) return;
    var cur = (state.brush && state.brush.kind === 'building' && state.brush.id === def.id)
      ? state.brush.stuff : RW.defaultStuff(def);
    var cats = Data.STUFF_CATS || [];
    var order = ['Woody', 'Stony', 'Metallic', 'Fabric', 'Leathery'];
    var groups = [];
    var byCat = {};
    list.forEach(function (s) {
      var cat = s.cats[0] || '';
      if (!byCat[cat]) { byCat[cat] = []; groups.push(cat); }
      byCat[cat].push(s);
    });
    groups.sort(function (a, b) {
      var ia = order.indexOf(a), ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });

    var menu = document.createElement('div');
    menu.className = 'stuffMenu';
    var head = document.createElement('div');
    head.className = 'smhead';
    head.textContent = def.name + ' · 选材质';
    menu.appendChild(head);
    groups.forEach(function (cat) {
      var catName = cat;
      for (var i = 0; i < cats.length; i++) if (cats[i].id === cat) catName = cats[i].name;
      var gt = document.createElement('div');
      gt.className = 'smcat';
      gt.textContent = catName;
      menu.appendChild(gt);
      byCat[cat].forEach(function (s) {
        var b = document.createElement('button');
        b.className = 'smitem' + (s.id === cur ? ' on' : '');
        b.innerHTML = '<span class="sw" style="background:' + esc(s.color || '#888') + '"></span>' + esc(s.name);
        b.onclick = function () {
          RW.setBrush('building', def.id, s.id);
          markActiveByDef(def.id);
          closeStuffMenu();
          refreshStuffBadges();
          updateBrushInfo();
          RW.render();
        };
        menu.appendChild(b);
      });
    });
    document.body.appendChild(menu);
    stuffMenuEl = menu;
    var r = anchor.getBoundingClientRect();
    var mw = menu.offsetWidth || 170, mh = menu.offsetHeight || 260;
    var left = Math.min(r.right + 6, global.innerWidth - mw - 8);
    var top = Math.min(r.top, global.innerHeight - mh - 8);
    if (left < 4) left = 4;
    if (top < 4) top = 4;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
  }
  function markActiveByDef(defId) {
    var el = document.querySelector('.pitem[data-id="' + defId + '"][data-kind="building"]');
    if (el) markActive(el);
  }
  document.addEventListener('mousedown', function (e) {
    if (stuffMenuEl && !stuffMenuEl.contains(e.target)) closeStuffMenu();
  }, true);

  function markActive(el) {
    var els = document.querySelectorAll('.pitem.on');
    for (var i = 0; i < els.length; i++) els[i].classList.remove('on');
    if (el) el.classList.add('on');
  }
  function syncActive() {
    if (!state.brush) return;
    var sel = '.pitem[data-id="' + state.brush.id + '"][data-kind="' + state.brush.kind + '"]';
    var el = document.querySelector(sel);
    if (el) el.classList.add('on');
  }

  var TOOL_NAME = { place: '放置', select: '框选 / 移动', erase: '橡皮' };

  function modeLabel() {
    // 绘制方式按建筑类型自动决定（墙→方框、门/家具→直线点、地面→填充）
    return RW.modeName ? RW.modeName() : '直线';
  }

  function updateBrushInfo() {
    var el = $('brushInfo');
    var mode = '<span class="muted">· 绘制 <b>' + modeLabel() + '</b></span>';
    if (!state.brush) {
      el.innerHTML = '<span class="muted">当前工具：</span><b>' + TOOL_NAME[state.tool] +
        '</b> <span class="muted">· 还没选建筑，左键点左边任意一格开始放</span>';
      return;
    }
    if (state.brush.kind === 'floor') {
      var f = Data.floorsById[state.brush.id];
      el.innerHTML = '地板：<b>' + esc(f.name) + '</b> ' + mode;
      return;
    }
    var d = Data.byId[state.brush.id];
    var fp = RW.footprint(d, state.rotation);
    var st = Data.stuffById(state.brush.stuff);
    var stuffTxt = st ? ' · 材质 <b>' + esc(st.name) + '</b>' +
      (d.stuffCats && d.stuffCats.length ? ' <span class="muted">(长按左键换)</span>' : '') : '';
    el.innerHTML = '放置：<b>' + esc(d.name) + '</b>' + stuffTxt + ' · 占地 <b>' + fp[0] + '×' + fp[1] +
      '</b> · 朝向 <b>' + state.rotation + '°</b> <span class="muted">(R 旋转)</span> ' + mode;
    refreshStuffBadges();
  }

  function esc(s) { return String(s).replace(/[&<>]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]; }); }


  // ------------------------------------------------------------------ 当前格 / 选中 信息
  var TAG_TEXT = {
    conduit: '导电', power: '用电', gen: '发电', store: '储电', under: '可埋进墙里',
    onwall: '贴墙件', solid: '阻挡通行', room: '参与围合', door: '门', light: '光源',
    temp: '温控', turret: '炮塔', bed: '床', roof: '可支撑屋顶', cover: '掩体',
    pass: '可通过', outdoor: '室外设施', floor: '地板'
  };

  function chip(text, cls) {
    return '<span class="chip' + (cls ? ' ' + cls : '') + '">' + esc(text) + '</span>';
  }

  function itemHTML(it) {
    var chips = '';
    if (it.locked) chips += chip('存档原有·已锁定', 'blue');
    else if (it.planned) chips += chip('蓝图/未建成', 'blue');
    if (it.stuffName) chips += chip(it.stuffName);
    if (it.powerGen) chips += chip('发电 ' + it.powerGen + 'W');
    if (it.powerUse) chips += chip('耗电 ' + it.powerUse + 'W');
    if (it.powerStore) chips += chip('储电 ' + it.powerStore + 'Wd');
    if (it.beauty) chips += chip('美观 ' + (it.beauty > 0 ? '+' : '') + it.beauty);
    if (it.work) chips += chip('工时 ' + it.work);
    if (it.aff) chips += chip('需要 ' + it.aff + ' 地形');
    if (it.skillReq) chips += chip('建造 ≥' + it.skillReq);
    if (it.dlc) chips += chip(it.dlc);
    (it.tags || []).forEach(function (t) {
      if (t === 'power' || t === 'conduit' || t === 'gen' || t === 'store') return;
      if (TAG_TEXT[t]) chips += chip(TAG_TEXT[t]);
    });
    return '<div class="iitem' + (it.selected ? ' sel' : '') + '" data-uid="' + it.uid + '">' +
      '<div class="nm">' + esc(it.name) + ' <span class="sz">' + it.fp[0] + '×' + it.fp[1] +
      (it.rot ? ' · ' + it.rot + '°' : '') + '</span></div>' +
      (chips ? '<div>' + chips + '</div>' : '') +
      '<div class="def">' + esc(it.defName || '') + '</div>' +
      '</div>';
  }

  function updateInspector() {
    var box = $('inspector');
    if (!box) return;
    var html = '';
    var info = state.hover ? RW.cellInfo(state.hover.x, state.hover.z) : null;

    if (info) {
      var fl = info.floor ? Data.floorsById[info.floor] : null;
      var pf = info.planned === 2 ? '（规划中·已禁用）' : info.planned === 1 ? '（规划中）' : '';
      html += '<div class="icell">格 (' + info.x + ', ' + info.z + ')' +
        (fl ? ' · 地板：' + esc(fl.name) + (info.lockedFloor ? '（存档原有）' : '') + pf : '') +
        '</div>';
      // 地形 / 山体
      var tparts = [];
      if (info.rock) tparts.push('<span class="chip red">山体 · ' + esc(info.rock.name) + '（先开采）</span>');
      else if (info.terrain) {
        var needHeavy = (info.terrain.aff || []).indexOf('Heavy') >= 0;
        tparts.push(chip('地形 ' + info.terrain.name + (needHeavy ? ' · 可承重' : '')));
        if (info.terrain.unknown) tparts.push(chip('未识别地形'));
      }
      if (info.roof === 2 || info.roof === 3) tparts.push(chip('头顶岩层'));
      if (info.home) tparts.push(chip('玩家区域', 'blue'));
      if (tparts.length) html += '<div style="margin-top:2px">' + tparts.join(' ') + '</div>';
      if (info.build && !info.build.ok) {
        html += '<div class="ihint" style="color:var(--err)">当前笔刷放不下：' + esc(info.build.why) + '</div>';
      }
      if (info.buildings.length) {
        html += info.buildings.map(itemHTML).join('');
      } else if (!fl) {
        html += '<div class="ihint">这一格是空的。点一下可以选中；用笔刷点就能放东西。</div>';
      }
      var rIdx = (state.rocks && state.rocks.cells) ? (state.rocks.cells[info.z * state.rocks.w + info.x] || 0) : 0;
      if (rIdx && !info.rock) html += '<div class="ihint">这一格有东西占着（碎石/植物等），游戏里要清掉再建。</div>';
    } else {
      html += '<div class="icell">把鼠标移到画布上看格信息</div>';
    }

    var sel = RW.selectedBuildings();
    var flSel = RW.selectedFloors();
    if (sel.length || flSel.length) {
      if (sel.length) {
        var byType = {};
        var cells = 0;
        sel.forEach(function (b) {
          var d = Data.byId[b.defId]; if (!d) return;
          byType[d.name] = (byType[d.name] || 0) + 1;
          var fp = RW.footprint(d, b.rot);
          cells += fp[0] * fp[1];
        });
        var parts = Object.keys(byType).map(function (k) { return k + ' ×' + byType[k]; });
        html += '<div class="icell" style="margin-top:6px">已选 <b>' + sel.length + '</b> 个建筑（共 ' + cells + ' 格）' +
          (flSel.length ? ' · <b>' + flSel.length + '</b> 格地板' : '') + '</div>';
        html += '<div class="meta" style="color:var(--fg2);font-size:11.5px">' + esc(parts.join('、')) + '</div>';
      } else {
        html += '<div class="icell" style="margin-top:6px">已选 <b>' + flSel.length + '</b> 格地板</div>';
      }
      // 改材质：只列出「选中建筑都能用」的材质
      var common = null;
      sel.forEach(function (b) {
        var d = Data.byId[b.defId]; if (!d) return;
        var list = Data.stuffsFor(d);
        if (!list.length) return;
        var ids = list.map(function (s) { return s.id; });
        common = common === null ? ids : common.filter(function (x) { return ids.indexOf(x) >= 0; });
      });
      if (common && common.length) {
        var curStuff = sel[0].stuff || null;
        var opts = common.map(function (id) {
          var s = Data.stuffById(id);
          return '<option value="' + esc(id) + '"' + (id === curStuff ? ' selected' : '') + '>' +
            esc(s ? s.name : id) + '</option>';
        }).join('');
        html += '<div class="icell" style="margin-top:6px">材质 ' +
          '<select id="selStuff" style="font-size:11.5px">' + opts + '</select>' +
          ' <span class="muted">（改选中建筑的材质）</span></div>';
      }
      // 床：医疗 / 囚犯开关（游戏里床的 Inspector 选项）
      var bedSel = sel.filter(function (b) {
        var d = Data.byId[b.defId];
        return d && d.bed && d.bed.human !== false;
      });
      if (bedSel.length) {
        var firstDef = Data.byId[bedSel[0].defId];
        var curBed = bedSel[0].bedMode || (firstDef.bed.medical ? 'medical' : 'normal');
        var bedOpts = [['normal', '普通'], ['medical', '医疗'], ['prison', '囚犯']].map(function (p) {
          return '<option value="' + p[0] + '"' + (p[0] === curBed ? ' selected' : '') + '>' + p[1] + '</option>';
        }).join('');
        html += '<div class="icell" style="margin-top:6px">床的用途 ' +
          '<select id="selBedMode" style="font-size:11.5px">' + bedOpts + '</select>' +
          ' <span class="muted">（影响房间角色判定）</span></div>';
      }
      if (flSel.length && !sel.length) {
        html += '<div class="ihint" style="margin-top:6px">按 <kbd>Delete</kbd> 或点「删除选中」就能把这些地板删掉。</div>';
      }
    } else {
      html += '<div class="ihint" style="margin-top:6px">未选中任何东西。左键点一个建筑就能选中，按住 <kbd>Shift</kbd> 加选，拖拽可框选（<b>地板也能框选</b>）。</div>';
    }
    box.innerHTML = html;

    // 点信息条 = 选中它
    Array.prototype.forEach.call(box.querySelectorAll('.iitem'), function (el) {
      el.onclick = function () {
        var uid = +el.dataset.uid;
        RW.setSelection([uid]); RW.render();
      };
    });
    var selStuffEl = $('selStuff');
    if (selStuffEl) {
      selStuffEl.onchange = function () {
        RW.setSelectionStuff(this.value);
        updateInspector();
        refreshStuffBadges();
      };
    }
    var bedModeEl = $('selBedMode');
    if (bedModeEl) {
      bedModeEl.onchange = function () {
        RW.setSelectionBedMode(this.value);
        updateInspector();
      };
    }

    var n = sel.length;
    var anySel = n > 0 || flSel.length > 0;
    $('btnSelRotate').disabled = !n;
    $('btnSelCopy').disabled = !anySel;
    $('btnSelPaste').disabled = !state.paste;
    $('btnSelDelete').disabled = !anySel;
    $('btnSelClear').disabled = !anySel;
  }

  // ------------------------------------------------------------------ 校验面板
  var lastReport = null;

  function runCheck() {
    lastReport = Checks.analyse(state);
    var box = $('issuesList');
    box.innerHTML = '';
    var issues = lastReport.issues;
    var showApprox = $('showApprox') ? $('showApprox').checked : true;
    var shown = issues.filter(function (it) { return showApprox || !it.approx; });
    if (!shown.length) {
      box.innerHTML = issues.length
        ? '<div class="muted">没有确定的问题（' + issues.length + ' 条近似提示已隐藏）</div>'
        : '<div class="ok">未发现问题 👍</div>';
    } else {
      shown.forEach(function (it) {
        var d = document.createElement('div');
        d.className = 'issue ' + it.level;
        var mark = it.approx
          ? '<span class="approxMark" title="这条来自本工具的近似模型，不完全等于游戏里的规则">≈</span>'
          : '';
        d.innerHTML = '<span class="dot"></span><span>' + mark + esc(it.msg) + '</span>';
        d.onclick = function () { focusCells(it.cells); };
        box.appendChild(d);
      });
    }
    // 电力概览
    var pw = $('powerSummary');
    if (lastReport.power.nets.length) {
      pw.innerHTML = lastReport.power.nets.map(function (n, i) {
        return '<div class="prow"><b>电网 #' + (i + 1) + '</b> 发电 ' + n.gen + 'W / 耗电 ' + n.use + 'W' +
          (n.store ? ' / 储电 ' + n.store + 'Wd' : '') +
          (n.deficit > 0 ? ' <span class="bad">缺口 ' + n.deficit + 'W</span>' : ' <span class="good">平衡</span>') +
          '</div>';
      }).join('');
    } else pw.innerHTML = '<div class="muted">还没有电力设备</div>';

    // 房间
    var rb = $('roomList');
    var roomRows = [];
    (lastReport.rooms || []).forEach(function (r, i) {
      if (!r.prefab) roomRows.push({ r: r, i: i });
    });
    var prefabN = (lastReport.rooms || []).length - roomRows.length;
    rb.innerHTML = (roomRows.length ? roomRows.map(function (row, n) {
      var r = row.r, i = row.i;
      var tempRow = '<label class="roomTemp" title="本工具的规划参数，不是游戏里的房间属性">目标 <input type="number" ' +
        'class="roomTempIn" data-idx="' + i + '" value="' + r.temp + '" min="-60" max="60" step="1"> °C</label>';
      var tempInfo = '';
      if (r.tempNeed && r.tempNeed.kind === 'cool' && r.tempNeed.need > 0) {
        tempInfo = ' · 需制冷 ' + r.coolers + '/' + r.tempNeed.need;
      } else if (r.tempNeed && r.tempNeed.kind === 'heat' && r.tempNeed.need > 0) {
        tempInfo = ' · 需加热 ' + r.heaters + '/' + r.tempNeed.need;
      }
      return '<div class="rrow roomBox" data-idx="' + i + '">' +
        '<div class="roomJump" data-idx="' + i + '" title="点击定位到这个房间"><b>房间 #' + (n + 1) + '</b> ' +
        r.area + ' 格 · 空间 ' + r.space + '（' + r.spaceText + '）· 门 ' + r.doors +
        tempInfo + ' ' + (r.reachable ? '' : '<span class="bad">不通</span>') + '</div>' +
        '<div class="roomRoleRow"><span class="roomRoleName" title="按房间里的内容自动判定：' +
        esc(r.roleWhy || r.roleName) + '">角色：<b>' + esc(r.roleName) + '</b></span>' + tempRow + '</div>' +
        '</div>';
    }).join('') : '<div class="muted">没有封闭的玩家房间</div>') +
      (prefabN ? '<div class="muted" style="font-size:11.5px;margin-top:4px">另有 ' + prefabN +
        ' 个地图预制建筑 / 遗迹（玩家区域外，未计入房间）</div>' : '');
    Array.prototype.forEach.call(rb.querySelectorAll('.roomJump'), function (el) {
      el.onclick = function () {
        var r = lastReport.rooms[+el.dataset.idx];
        if (r) focusCells(r.cells);
      };
    });
    Array.prototype.forEach.call(rb.querySelectorAll('.roomTempIn'), function (el) {
      el.onchange = function () {
        if (!Rooms) return;
        var r = lastReport.rooms[+el.dataset.idx];
        if (!r) return;
        var t = parseFloat(this.value);
        if (isNaN(t)) return;
        Rooms.setTemperature(state, r, t);
        savePrefs();
        runCheck();
      };
    });

    // 统计
    var st = lastReport.stats;
    $('statsList').innerHTML = '<div class="muted">建筑 ' + st.total + ' 个 · 地板 ' + st.floors + ' 格</div>' +
      st.byType.map(function (t) {
        return '<div class="srow" data-id="' + t.id + '"><span>' + esc(t.name) + '</span><span>' + t.n + '</span></div>';
      }).join('');
    Array.prototype.forEach.call($('statsList').querySelectorAll('.srow'), function (el) {
      el.onclick = function () { highlightType(el.dataset.id); };
    });
  }

  /** 编辑时合并多次 change，避免每落一格都跑一遍洪水填充 + 电力 */
  var checkTimer = null;
  function scheduleCheck() {
    if (checkTimer) return;
    checkTimer = setTimeout(function () {
      checkTimer = null;
      runCheck();
    }, 120);
  }

  function focusCells(cells) {
    if (!cells || !cells.length) return;
    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    cells.forEach(function (c) {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minZ = Math.min(minZ, c[1]); maxZ = Math.max(maxZ, c[1]);
    });
    var cv = $('canvas');
    var rect = cv.getBoundingClientRect();
    var w = maxX - minX + 3, h = maxZ - minZ + 3;
    state.cam.cell = Math.max(6, Math.min(60, Math.min(rect.width / w, rect.height / h)));
    state.cam.ox = rect.width / 2 - (minX + maxX + 1) / 2 * state.cam.cell;
    state.cam.oy = rect.height / 2 - (minZ + maxZ + 1) / 2 * state.cam.cell;
    RW.render();
  }

  function highlightType(defId) {
    var cells = [];
    state.buildings.forEach(function (b) {
      if (b.defId !== defId) return;
      var def = Data.byId[b.defId];
      var fp = RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) cells.push([b.x + i, b.z + j]);
    });
    if (cells.length) focusCells(cells);
  }

  // ------------------------------------------------------------------ 导入 / 导出
  function currentName() { return ($('mapName').value || '未命名布局').trim(); }

  // 直接写进用户选定的文件夹（Chrome/Edge 支持；省得手动找路径）
  function bpResult() {
    var cat = $('bpCategory') ? ($('bpCategory').value || '').trim() : '';
    return X.toBlueprintsXML(state, {
      name: currentName(), stuff: currentStuff,
      rotFix: state.rotFix !== false,
      excludeLocked: $('excludeLocked') ? $('excludeLocked').checked : true,
      gameVersion: (state.saveMeta && state.saveMeta.gameVersion) || state.saveVersion || '',
      meta: state.saveMeta || null,
      category: cat || '布局'
    });
  }

  function doExportBlueprint() {
    // 已经设过 Blueprints 文件夹：直接写进去，不再下载一份
    if (state.bpDir) { exportBlueprintToFolder(); return; }
    var r = bpResult();
    if (!r.count) { toast('画布上还没有可导出的建筑/地板' + (r.lockedSkipped ? '（存档原有建筑已按设置排除）' : '')); return; }
    X.download(safeName(currentName()) + '.xml', r.xml, 'application/xml');
    var msg = '已导出蓝图「' + safeName(currentName()) + '.xml」（' + r.count + ' 件，' + r.w + '×' + r.h + ' 格）';
    if (r.lockedSkipped) msg += '；已排除 ' + r.lockedSkipped + ' 个存档原有';
    msg += ' —— 放进 Blueprints 文件夹，游戏里点蓝图按钮载入';
    toast(msg);
    if (Object.keys(r.skipped).length) {
      openText('这些条目没有游戏 defName，已跳过',
        Object.keys(r.skipped).map(function (k) { return k + ' × ' + r.skipped[k]; }).join('\n'), null,
        '一般是因为它们只存在于内置参考表里（多为未安装的 DLC）。用 tools/extract_defs.py 提取本地游戏后就能补上。');
    }
  }

  async function exportBlueprintToFolder() {
    if (!global.showDirectoryPicker) { toast('这个浏览器不支持直接写文件夹，请用「导出蓝图 .xml」下载后手动放', true); return; }
    try {
      if (!state.bpDir) state.bpDir = await global.showDirectoryPicker({ mode: 'readwrite' });
      var dir = state.bpDir;
      if (dir.queryPermission) {
        var perm = await dir.queryPermission({ mode: 'readwrite' });
        if (perm !== 'granted') {
          perm = await dir.requestPermission({ mode: 'readwrite' });
          if (perm !== 'granted') { toast('没有写入权限，请重新选择文件夹', true); return; }
        }
      }
      var r = bpResult();
      if (!r.count) { toast('画布上还没有可导出的建筑/地板' + (r.lockedSkipped ? '（存档原有建筑已按设置排除）' : '')); return; }
      var name = safeName(currentName()) + '.xml';
      var fh = await dir.getFileHandle(name, { create: true });
      var w = await fh.createWritable();
      await w.write(r.xml);
      await w.close();
      toast('已写入「' + dir.name + '/' + name + '」（' + r.count + ' 件）—— 游戏里载入蓝图即可让小人开建');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      toast('写入失败：' + (e && e.message ? e.message : e) + '，改用下载方式', true);
    }
  }

  // ------------------------------------------------------------------ 模板
  /**
   * 模板 = 存起来的「剪贴板」。同一个标准卧室要画几十遍，
   * 存一次之后一键贴出来，省事也省心。
   */
  function loadTemplates() {
    var s = Io.loadSettings() || {};
    state.templates = Array.isArray(s.templates) ? s.templates : [];
  }
  function saveTemplates() {
    var s = Io.loadSettings() || {};
    s.templates = state.templates || [];
    return Io.saveSettings(s);
  }
  function renderTemplates() {
    var box = $('tplList');
    if (!box) return;
    var list = state.templates || [];
    if (!list.length) {
      box.innerHTML = '<div class="muted" style="font-size:11.5px">还没有模板。先框选一块区域，再点「存为模板」。</div>';
      return;
    }
    box.innerHTML = list.map(function (t, i) {
      var n = (t.clip && t.clip.items ? t.clip.items.length : 0);
      var f = (t.clip && t.clip.floors ? t.clip.floors.length : 0);
      return '<div class="tplRow" data-i="' + i + '">' +
        '<span class="tplName" title="点击贴到鼠标位置">' + esc(t.name) + '</span>' +
        '<span class="muted" style="font-size:11px">' + n + ' 建筑' + (f ? ' / ' + f + ' 地板' : '') + '</span>' +
        '<button class="tplDel ghost" data-i="' + i + '" title="删除这个模板">×</button>' +
        '</div>';
    }).join('');
    Array.prototype.forEach.call(box.querySelectorAll('.tplName'), function (el) {
      el.onclick = function () {
        var t = (state.templates || [])[+el.parentNode.dataset.i];
        if (!t || !t.clip) return;
        // 点模板 = 进入「粘贴」状态，再在画布上点一下决定位置。
        // 不能直接 pasteAt(state.hover)：鼠标移到右侧面板时 hover 已经变成 null，
        // 会贴到 (0,0)（通常还在屏幕外），看起来就像「点了没反应」。
        state.paste = t.clip;
        state.paste.at = {
          x: state.hover ? state.hover.x : Math.floor(state.cols / 2),
          z: state.hover ? state.hover.z : Math.floor(state.rows / 2)
        };
        RW.setTool('place');
        RW.render(); RW.emit('change');
        toast('已选择模板「' + t.name + '」，点击画布放置（右键取消）');
      };
    });
    Array.prototype.forEach.call(box.querySelectorAll('.tplDel'), function (el) {
      el.onclick = function (e) {
        e.stopPropagation();
        state.templates.splice(+el.dataset.i, 1);
        saveTemplates();
        renderTemplates();
      };
    });
  }

  function doExportJson() {
    X.download(safeName(currentName()) + '.rwplan.json', JSON.stringify(RW.exportProject(), null, 2), 'application/json');
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'layout'; }

  /** 当前选中的建筑 + 地板，在画布坐标里的包围盒。没选中返回 null */
  function selectionBoxEditor() {
    var minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    function add(x, z) {
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    RW.selectedBuildings().forEach(function (b) {
      var def = Data.byId[b.defId]; if (!def) return;
      var fp = RW.footprint(def, b.rot);
      for (var i = 0; i < fp[0]; i++) for (var j = 0; j < fp[1]; j++) add(b.x + i, b.z + j);
    });
    RW.selectedFloors().forEach(function (f) {
      var p = String(f.key).split(',');
      add(+p[0], +p[1]);
    });
    return isFinite(minX) ? [minX, minZ, maxX, maxZ] : null;
  }

  /**
   * 导出「基地简报」：优先用**框选区域**（边界明确），没框选就用当前视口。
   * 不额外加边距 —— 玩家框到哪，简报就到哪。
   */
  function doExportBrief() {
    var PI = global.RWPlanImport, Brief = global.RWBrief;
    if (!PI || !Brief) { toast('简报模块没加载', true); return; }

    // 优先用「最后一次框选的矩形」——框空地也算；没有再退回选中物体的包围盒
    var box = null;
    var br = state.briefRect;
    if (br) box = [br.x0, br.z0, br.x1, br.z1];
    else box = selectionBoxEditor();

    var rect, source;
    if (box) {
      var a0 = PI.cellToGame(state, box[0], box[1]);
      var c0 = PI.cellToGame(state, box[2], box[3]);
      rect = [Math.min(a0.x, c0.x), Math.min(a0.z, c0.z), Math.max(a0.x, c0.x), Math.max(a0.z, c0.z)];
      source = 'selection';
    } else {
      var v = RW.visibleRange();
      var a = PI.cellToGame(state, v.x0, v.z0);
      var c = PI.cellToGame(state, Math.max(v.x0, v.x1 - 1), Math.max(v.z0, v.z1 - 1));
      rect = [Math.min(a.x, c.x), Math.min(a.z, c.z), Math.max(a.x, c.x), Math.max(a.z, c.z)];
      source = 'viewport';
    }

    var brief = Brief.build(state, { rect: rect, source: source });
    var text = Brief.toMarkdown(brief);
    X.download(safeName(currentName()) + '.brief.md', text, 'text/markdown;charset=utf-8');

    var size = (rect[2] - rect[0] + 1) + '×' + (rect[3] - rect[1] + 1);
    toast((source === 'selection'
      ? '已导出简报：框选 ' + size + ' 格'
      : '未框选，已按当前视口导出 ' + size + ' 格') +
      '（x ' + rect[0] + '–' + rect[2] + '，z ' + rect[1] + '–' + rect[3] + '），' +
      Math.round(text.length / 1024) + ' KB');
  }

  function doImportPlan() { $('filePlan').click(); }

  /** 复制到剪贴板（file:// 下 navigator.clipboard 可能不可用，退回 textarea） */
  function copyText(text) {
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).catch(fallback);
    }
    fallback();
    return Promise.resolve();
  }

  function gameCellsText(cells) {
    var PI = global.RWPlanImport;
    var shown = cells.slice(0, 10).map(function (c) {
      var g = PI.cellToGame(state, c[0], c[1]);
      return '(' + g.x + ',' + g.z + ')';
    }).join(' ');
    return shown + (cells.length > 10 ? ' …共 ' + cells.length + ' 格' : '');
  }

  /** 生成一段可以直接发回给 AI 的报告 */
  function buildImportReport(planName, r, issues) {
    var errs = r.errors.map(function (e) { return e.at + '：' + e.msg; });
    (issues || []).forEach(function (it) {
      if (it.level !== 'error' || it.source === 'existing') return;
      errs.push(it.msg + (it.cells && it.cells.length ? '\n   格子：' + gameCellsText(it.cells) : ''));
    });
    var warns = r.warnings.slice();
    (issues || []).forEach(function (it) {
      if (it.level === 'warn' && it.source !== 'existing' && warns.length < 8) warns.push(it.msg);
    });

    var L = [];
    L.push('【RimWorld planner 导入报告】');
    L.push('方案：' + (planName || state.mapName || '未命名'));
    L.push('结果：' + errs.length + ' 个 error' + (warns.length ? ' / ' + warns.length + ' 条 warning' : ''));
    L.push('');
    L.push('错误（必须改）：');
    if (!errs.length) L.push('（无）');
    errs.forEach(function (e, i) { L.push((i + 1) + '. ' + e); });
    if (warns.length) {
      L.push('');
      L.push('警告（能建但会不舒服，尽量一起改）：');
      warns.forEach(function (w) { L.push('- ' + w); });
    }
    L.push('');
    L.push('请按上面的错误修改，重新输出**完整**的 plan.json：');
    L.push('- 标准 JSON：不要 // 注释、不要尾逗号');
    L.push('- 坐标用游戏坐标；def 用游戏 defName');
    L.push('- 不要只给改动片段');
    return L.join('\n');
  }

  /** 从剪贴板/文本粘贴 plan.json */
  function doPastePlan() {
    if (!global.RWPlanImport) { toast('导入模块没加载', true); return; }
    openText('粘贴 AI 规划', '', function (v) {
      if (!v || !v.trim()) { toast('还没有内容', true); return; }
      importPlanText(v);
    }, '把 AI 回复的 plan.json 整段粘进来（Ctrl+V），然后点「导入」', '导入');
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(function (txt) {
          if (txt && !$('ioText').value) $('ioText').value = txt;
        }).catch(function () {});
      }
    } catch (e) {}
    setTimeout(function () { try { $('ioText').focus(); } catch (e) {} }, 30);
  }

  /** 导入 AI 写的 plan.json（和命令行 apply 共用 js/planimport.js） */
  function importPlanText(t) {
    var PI = global.RWPlanImport;
    if (!PI) { toast('导入模块没加载', true); return; }
    var parsed;
    try { parsed = PI.parsePlan(t); }
    catch (e) { toast('plan.json 解析失败：' + e.message, true); return; }
    var plan = parsed.plan;

    var r = PI.apply(state, plan, { autoStuff: true });
    var issues = [];
    if (r.applied.buildings || r.applied.floors) {
      // 走一遍 export/load，触发 reindex / render / change，让房间、校验、面板同步
      RW.loadProject(RW.exportProject());
      $('mapName').value = state.mapName;
      RW.fitContent();
      updateSaveInfo();
      try { issues = Checks.analyse(state).issues || []; } catch (e) { issues = []; }
    }

    var softWarn = parsed.warnings.length ? parsed.warnings[0] : null;
    var msg = '导入 ' + r.applied.buildings + ' 件建筑、' + r.applied.floors + ' 格地板';
    if (softWarn) msg += '；' + softWarn;
    var assumed = Object.keys(r.stuffAssumed).length;
    if (assumed) msg += '；自动选材质 ' + assumed + ' 种';
    if (r.demolish.length) msg += '；' + r.demolish.length + ' 处压到存档原有建筑';
    if (r.roomTemp.length) msg += '；设了 ' + r.roomTemp.length + ' 个房间温度';

    // 应用错误 + 校验 error（存档原有的不算，别让玩家去改遗迹）
    var errCount = r.errors.length + issues.filter(function (it) {
      return it.level === 'error' && it.source !== 'existing';
    }).length;

    if (errCount) {
      var report = buildImportReport(plan.name, r, issues);
      openText('导入 AI 规划：' + errCount + ' 个错误', report, function (v) {
        copyText(v).then(function () { toast('错误信息已复制，发回给 AI 让它改'); });
      }, '点「复制错误信息」把这段发回给 AI；也可以先自己看一遍', '复制错误信息');
      toast(msg + '；' + errCount + ' 个错误，见弹窗', true);
      return;
    }
    toast(msg);
  }

  /** 导出 PNG（整个布局）。 */
  function doExportPng() {
    var name = safeName(currentName()) + '.png';
    var r;
    try {
      r = RW.exportPNG({
        filename: name,
        onDone: function (fn, w, h) { toast('已导出图片「' + fn + '」（' + w + '×' + h + ' 像素）'); },
        onError: function (e) { toast('导出图片失败：' + (e && e.message ? e.message : e), true); }
      });
    } catch (e) {
      toast('导出图片失败：' + (e && e.message ? e.message : e), true);
      return;
    }
    if (!r) { toast('画布上还没有东西可以导出'); return; }
  }

  function openText(title, text, onApply, hint, applyLabel) {
    $('ioTitle').textContent = title;
    $('ioHint').textContent = hint || '';
    $('ioText').value = text || '';
    $('ioApply').textContent = applyLabel || '应用';
    $('ioModal').classList.add('show');
    $('ioApply').onclick = function () {
      var v = $('ioText').value;
      $('ioModal').classList.remove('show');
      onApply && onApply(v);
    };
  }

  async function importSaveText(txt) {
    var res;
    try { res = await Io.parseSave(txt, { flipX: $('flipX').checked, flipZ: $('flipZ').checked }); }
    catch (e) { toast('读取存档失败：' + e.message, true); return; }

    var unk = Object.keys(res.unknown);
    if (!res.buildings.length) {
      toast('没在存档里找到可识别的建筑' + (unk.length ? '；未识别：' + unk.slice(0, 5).join(', ') : ''), true);
      return;
    }
    state.saveVersion = res.version || '';
    state.saveMeta = res.meta || null;
    var r = Io.importFromSave(res, {
      flipZ: $('flipZ').checked,
      flipX: $('flipX').checked,
      lockImported: $('lockImported') ? $('lockImported').checked : true
    });
    $('gridCols').value = state.cols;
    $('gridRows').value = state.rows;
    RW.fitContent();   // 适配到基地本身，否则 250x250 缩到每格 2 像素，什么都看不见

    // 同步「显示地形 / 玩家区域 / 标出不可建造 / 库存范围」勾选框
    if ($('lyTerrain')) $('lyTerrain').checked = !!state.layers.terrain;
    if ($('lyHome')) $('lyHome').checked = !!state.layers.home;
    if ($('lyBlocked')) $('lyBlocked').checked = !!state.layers.blocked;
    if ($('stockHome')) $('stockHome').checked = state.useHomeStock !== false;
    // 工程名默认用存档里的殖民地名（Blueprint 文件名也跟着变）
    if (r.colonyName) {
      state.mapName = r.colonyName;
      $('mapName').value = r.colonyName;
      document.title = r.colonyName + ' · RimWorld 布局规划器';
    }
    applyStockChoice();
    updateSaveInfo();

    var msg = '已导入 ' + (res.version ? 'v' + res.version.split(' ')[0] + ' 存档：' : '存档：') +
      (r.colonyName ? '「' + r.colonyName + '」 ' : '') + r.placed + ' 个建筑';
    if (r.planned) msg += '（其中 ' + r.planned + ' 个是蓝图/施工中，画成半透明虚线）';
    if (r.locked) msg += '；其中 ' + r.locked + ' 个标记为存档原有（导出蓝图时排除）';
    if (r.mapSize) msg += '；地图按存档设为 ' + r.mapSize.w + '×' + r.mapSize.h;
    if (r.failed) msg += '；' + r.failed + ' 个因越界/重合跳过';
    if (r.terrain) msg += '；读到地形（山体 ' + rockCount() + ' 格' + (r.home ? '，玩家区域 ' + r.home.count + ' 格' : '') + '）';
    if (r.pawns) msg += '；小人 ' + r.pawns + ' 名';
    if (r.resources) msg += '；玩家区域库存物资 ' + r.resources + ' 种（全地图 ' + r.resourcesAll + ' 种）';
    toast(msg);

    if (unk.length) {
      openText('存档里有未识别的建筑（多半是 mod 内容）',
        unk.map(function (k) { return k + ' × ' + res.unknown[k]; }).join('\n'),
        null,
        '这些 def 不在当前数据库里，已跳过。如果是你装的 mod，用 tools/extract_defs.py 提取本地游戏后就能识别；纯 mod 内容忽略即可。');
    }
  }

  function rockCount() {
    var n = 0;
    if (state.rocks && state.rocks.cells) {
      for (var i = 0; i < state.rocks.cells.length; i++) if (state.rocks.cells[i]) n++;
    }
    return n;
  }

  // ------------------------------------------------------------------ 存档情报面板
  function updateSaveInfo() {
    var box = $('saveInfo');
    if (!box) return;
    var si = state.saveInfo;
    if (!si) { box.innerHTML = '<div class="muted">读取 .rws 后显示地形 / 小人 / 科技 / 库存</div>'; return; }
    var html = '';
    // 地形
    if (state.terrain && global.RWSite) {
      var sum = global.RWSite.summarize();
      html += '<div class="si-block"><b>地形</b>：可承重(Heavy) ' + sum.heavy + ' 格 · 水 ' + sum.water +
        ' 格 · 沼泽/泥 ' + sum.marsh + ' 格 · <span class="bad">山体/矿石 ' + rockCount() + ' 格</span>' +
        (state.home ? ' · 玩家区域 <b>' + (state.home.count || 0) + '</b> 格' : '') + '</div>';
    } else {
      html += '<div class="si-block muted">没有读到地形网格（旧版存档可能在别的图里）</div>';
    }
    // 小人
    var pa = (si.pawns || []).filter(function (p) { return !p.dead; });
    if (pa.length) {
      html += '<div class="si-block"><b>小人</b> ' + pa.length + ' 名：</div>';
      html += pa.map(function (p) {
        var s = p.skills || {};
        function lv(k) { return (s[k] && s[k].level) || 0; }
        return '<div class="si-pawn">' + esc(p.name) +
          ' <span class="muted">' + esc(p.kindDef || '') + '</span>' +
          ' <span class="si-sk">建 ' + lv('Construction') + ' · 矿 ' + lv('Mining') +
          ' · 智 ' + lv('Intellectual') + '</span></div>';
      }).join('');
    }
    // 科技
    if (si.research && global.RWWork) {
      var res = si.research;
      var defs = Data.researches ? Data.researches() : {};
      var done = 0, prog = 0;
      Object.keys(res.progress || {}).forEach(function (k) {
        var info = defs[k];
        var v = res.progress[k];
        if (info && info.cost > 0 ? v >= info.cost - 0.001 : (v > 0 && k !== res.current)) done++;
        else if (v > 0) prog++;
      });
      var curInfo = res.current ? defs[res.current] : null;
      html += '<div class="si-block"><b>科技</b>：已完成 ' + done + ' 项' +
        (res.current ? ' · 研究中 <b>' + esc(curInfo ? curInfo.name : res.current) + '</b>' +
          (curInfo ? ' (' + Math.round((res.progress[res.current] || 0)) + '/' + curInfo.cost + ')' : '') : '') +
        (Object.keys(defs).length ? '' : ' <span class="muted">（导入游戏资源可显示中文名与前置）</span>') + '</div>';
    }
    // 库存
    var useHome = state.useHomeStock !== false && si.hasHome;
    var res2 = (useHome ? (si.resourcesHome || {}) : (si.resourcesAll || si.resources || {}));
    var keys = Object.keys(res2);
    var allN = Object.keys(si.resourcesAll || si.resources || {}).length;
    var homeN = Object.keys(si.resourcesHome || {}).length;
    if (keys.length) {
      keys.sort(function (a, b) { return res2[b] - res2[a]; });
      var top = keys.slice(0, 16);
      html += '<div class="si-block"><b>库存</b>（' + (useHome ? '玩家区域 ' + homeN + ' 种' : '全地图 ' + allN + ' 种') +
        '，显示前 ' + top.length + '/' + keys.length + '）：</div><div class="si-mat">' +
        top.map(function (k) {
          return '<span class="mat">' + esc(global.RWWork ? global.RWWork.materialName(k) : k) + ' <b>' + res2[k] + '</b></span>';
        }).join('') + '</div>';
    } else {
      html += '<div class="si-block muted">没有读到库存物资</div>';
    }
    box.innerHTML = html;
  }

  /** 切换「玩家区域库存 / 全地图库存」后，把估算用的库存同步过去 */
  function applyStockChoice() {
    var si = state.saveInfo;
    if (!si) return;
    si.resources = (state.useHomeStock !== false && si.hasHome) ? (si.resourcesHome || {}) : (si.resourcesAll || si.resources || {});
  }

  // ------------------------------------------------------------------ 工作量估算
  function runEstimate() {
    var box = $('estimateOut');
    if (!box) return;
    if (!global.RWWork) { box.innerHTML = '<div class="bad">估算模块没加载</div>'; return; }
    var opts = {
      builders: parseInt($('estBuilders').value, 10) || 1,
      miners: parseInt($('estMiners').value, 10) || 1,
      workHours: parseInt($('estHours').value, 10) || 16,
      haulOverhead: (parseInt($('estHaul').value, 10) || 0) / 100
    };
    var rep;
    try { rep = global.RWWork.analyse(state, opts); }
    catch (e) { box.innerHTML = '<div class="bad">估算失败：' + esc(e.message) + '</div>'; return; }
    window.__lastEstimate = rep;

    var w = rep.work, html = '';
    var cls = rep.verdict === 'ok' ? 'good' : rep.verdict === 'partial' ? 'warn' : 'bad';
    var label = rep.verdict === 'ok' ? '可以实现，材料/科技都够'
      : rep.verdict === 'partial' ? '可以建，但有缺口（材料或科技）' : '暂时建不了（地形/技能挡路）';
    html += '<div class="estHead ' + cls + '">' + label + '</div>';

    // 地形
    var tr = rep.terrain;
    if (tr.rockCells.length) {
      html += '<div class="estSec bad">山体/矿石：' + tr.rockCells.length + ' 格需要先开采</div>';
      html += '<div class="ihint" style="margin:2px 0 6px">点击定位：' +
        '<button class="mini" data-focus="rock">跳过去看看</button></div>';
    }
    if (tr.terrainCells.length) {
      html += '<div class="estSec bad">地形撑不住：' + tr.terrainCells.length + ' 格（沼泽/软沙/水面等）</div>';
      var rs = Object.keys(tr.reasons);
      if (rs.length) html += '<div class="meta">' + esc(rs.slice(0, 4).join('；')) + '</div>';
    }
    if (!tr.rockCells.length && !tr.terrainCells.length && (state.terrain || state.rocks)) {
      html += '<div class="estSec good">地形：全部格子都能建 ✓</div>';
    }
    if (!state.terrain && !state.rocks) html += '<div class="estSec muted">地形：没读存档，跳过地形检查</div>';

    // 科技
    if (rep.research.done) {
      html += '<div class="estSec good">科技：前置都解锁了 ✓</div>';
    } else {
      html += '<div class="estSec warn">科技：还缺 ' + rep.research.lines.length + ' 项，共 ' +
        Math.round(rep.research.remaining) + ' 点（约 ' + fmtDays(rep.research.ticks) + '）</div>';
      html += rep.research.lines.slice(0, 8).map(function (l) {
        var nm = (Data.research(l.def) || {}).name || l.name;
        return '<div class="estRow"><span>' + esc(nm) + '</span><span class="muted">' +
          Math.round(l.progress) + '/' + l.cost + '</span></div>';
      }).join('');
    }

    // 材料
    if (rep.materials.length) {
      if (rep.missingMats.length) {
        html += '<div class="estSec warn">材料：' + rep.missingMats.length + ' 种不够</div>';
      } else {
        html += '<div class="estSec good">材料：库存够 ✓</div>';
      }
      html += '<table class="estTable"><tr><th>材料</th><th>需要</th><th>库存</th><th>缺</th></tr>' +
        rep.materials.slice(0, 14).map(function (m) {
          return '<tr class="' + (m.short ? 'bad' : '') + '"><td>' + esc(m.name) + '</td><td>' + m.need +
            '</td><td>' + m.have + '</td><td>' + (m.short ? m.short : '') + '</td></tr>';
        }).join('') + '</table>';
      if (!state.saveInfo || !Object.keys(state.saveInfo.resources || {}).length) {
        html += '<div class="meta">（没有读到库存，库存列按 0 算；导入存档后更准）</div>';
      }
    }

    // 技能
    if (rep.skill.maxSkillReq) {
      html += '<div class="estSec ' + (rep.skill.ok ? 'good' : 'bad') + '">技能：' +
        esc(rep.skill.name) + ' 需要建造 ' + rep.skill.maxSkillReq + '，当前最高 ' + rep.skill.best +
        (rep.skill.ok ? ' ✓' : ' ✗ 没人能建') + '</div>';
    }

    // 工期
    html += '<div class="estSec">工期估算</div>';
    html += '<div class="estRow"><span>建造工时</span><span>' + Math.round(w.totalWork) + ' 点 · ' +
      fmtDays(w.buildTicks) + '（' + w.buildersUsed + ' 人）</span></div>';
    if (w.mineTicks) html += '<div class="estRow"><span>开采工时</span><span>' + w.mineHits + ' 次凿击 · ' +
      fmtDays(w.mineTicks) + '（' + w.minersUsed + ' 人）</span></div>';
    if (rep.research.ticks) html += '<div class="estRow"><span>研究工时</span><span>' + fmtDays(rep.research.ticks) + '</span></div>';
    html += '<div class="estRow total"><span>合计</span><span>' + fmtDays(w.totalTicks) + ' · 按每天 ' + w.workHours + ' 小时算约 ' +
      fmtWorkDays(w.totalTicks, w.workHours) + '</span></div>';

    // 小人
    function pawnTable(list, title) {
      if (!list.length) return '';
      return '<div class="estSec">' + title + '</div>' + list.slice(0, 8).map(function (p) {
        var sp = Math.round(p.speed * 100);
        return '<div class="estRow"><span>' + esc(p.name) + (p.passion && p.passion !== 'None' ? ' <span class="fire">🔥</span>' : '') +
          '</span><span class="muted">等级 ' + p.level + ' · 速度 ' + sp + '%</span></div>';
      }).join('');
    }
    html += pawnTable(rep.pawns.builders, '建造者（按建造等级）');
    if (rep.pawns.miners.length && w.mineTicks) html += pawnTable(rep.pawns.miners, '矿工（按采矿等级）');
    if (!rep.pawns.builders.length) {
      html += '<div class="estSec muted">没有读到小人属性（导入存档后可按技能估算）。当前按 100% 速度算。</div>';
    }
    html += '<div class="meta" style="margin-top:6px">算法：建造 0.3+0.0875×等级；开采 100/MiningSpeed tick/次；' +
      '研究 0.00825×速度×台' + (rep.research.bench) + '×难度' + (rep.research.factor) + '。1 日=60000 tick。仅供估算。</div>';

    box.innerHTML = html;
    // 点击定位
    Array.prototype.forEach.call(box.querySelectorAll('button[data-focus]'), function (b) {
      b.onclick = function () {
        if (b.dataset.focus === 'rock' && tr.rockCells.length) focusCells(tr.rockCells.map(function (c) { return [c.x, c.z]; }));
        else if (tr.terrainCells.length) focusCells(tr.terrainCells.map(function (c) { return [c.x, c.z]; }));
      };
    });
  }

  function fmtDays(ticks) {
    var d = ticks / 60000;
    if (d >= 1) return d.toFixed(d >= 10 ? 0 : 1) + ' 游戏日';
    return (ticks / 2500).toFixed(1) + ' 游戏小时';
  }
  function fmtWorkDays(ticks, hours) {
    var days = ticks / 2500 / Math.max(1, hours);
    if (days >= 1) return days.toFixed(days >= 10 ? 0 : 1) + ' 天';
    return (days * 24).toFixed(1) + ' 小时';
  }

  // ------------------------------------------------------------------ 提示
  var toastTimer = null;
  function toast(msg, isErr) {
    var el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (isErr ? ' err' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 4200);
  }

  // ------------------------------------------------------------------ 模组建筑
  // 玩家把 Mods 文件夹拖进来 → js/modimport.js 扫描模组里新增的可建造建筑和贴图。
  // modimport.js 可能不存在（单文件版 / 旧版本），所有入口都先判空。
  function modsApi() { return global.RWMods; }

  function hasModBuildings() { return modBuildings().length > 0; }

  function modBuildings() {
    return ((Data && Data.BUILDINGS) || []).filter(function (b) { return !!(b && b.mod); });
  }

  /** 把贴图清单应用到画布 / 物品栏（「导入游戏资源」和「导入模组建筑」共用） */
  function useManifest(manifest, note, setStatus) {
    if (!manifest) return false;
    Art.setSprites(manifest, global.RWGame ? global.RWGame.getImageURL : null);
    // 单文件版启动时没有 sprites.js，原版贴图开关默认是关闭/禁用的；
    // 导入（或从缓存恢复）贴图后要主动把它打开，否则画布仍然走矢量图。
    if (Art.setSpriteEnabled) Art.setSpriteEnabled(true);
    var spEl = $('useSprites');
    if (spEl) { spEl.disabled = false; spEl.checked = true; }
    var spRow = $('spriteRow');
    if (spRow) { spRow.classList.remove('muted'); spRow.removeAttribute('title'); }
    buildPalette();
    RW.render();
    var n = Object.keys(manifest.items || {}).length;
    var f = Object.keys(manifest.floors || {}).length;
    var html = '✅ ' + (note || '') + '已启用原版贴图：<b>' + n + '</b> 个建筑 · <b>' + f + '</b> 种地板';
    if (typeof setStatus === 'function') setStatus(html);
    else { var st = $('gameStatus'); if (st) st.innerHTML = html; }
    return true;
  }

  /** 模组操作返回的 manifest 生效：非 null 换贴图；null = 连基础清单都没了 → 退回矢量图 */
  function applyModManifest(res) {
    var manifest = res && res.manifest;
    if (manifest) { useManifest(manifest, ''); return true; }
    if (Art.clearCache) Art.clearCache();
    if (Art.setSpriteEnabled) Art.setSpriteEnabled(false);
    var sp = $('useSprites');
    if (sp) { sp.checked = false; sp.disabled = true; }
    var row = $('spriteRow');
    if (row) row.classList.add('muted');
    buildPalette();
    RW.render();
    return false;
  }

  /** 渲染模组列表，并同步「🧩 模组」页签 / 物品栏 */
  function updateModList() {
    var box = $('modList');
    var api = modsApi();
    var mods = (api && api.list) ? (api.list() || []) : [];
    if (box) {
      box.innerHTML = '';
      if (!mods.length) {
        var empty = document.createElement('div');
        empty.className = 'muted modempty';
        empty.textContent = '还没有导入模组（创意工坊的 mod 在 steamapps/workshop/content/294100/）';
        box.appendChild(empty);
      }
      mods.forEach(function (m) {
        var row = document.createElement('div');
        row.className = 'modrow';
        var name = document.createElement('span');
        name.className = 'modname';
        name.textContent = m.name || m.packageId || '（未命名模组）';
        name.title = (m.packageId || '') +
          '\n' + (m.count || 0) + ' 个建筑 · ' + (m.sprites || 0) + ' 张贴图' +
          (m.version ? '\n游戏版本 ' + m.version : '') +
          (m.steamId ? '\n工坊 ID ' + m.steamId : '');
        row.appendChild(name);
        var meta = document.createElement('span');
        meta.className = 'modmeta';
        meta.textContent = (m.count || 0) + ' 个建筑 · ' + (m.sprites || 0) + ' 张贴图';
        row.appendChild(meta);
        var del = document.createElement('button');
        del.className = 'ghost danger moddel';
        del.textContent = '✕';
        del.title = '移除「' + (m.name || m.packageId) + '」导入的建筑与贴图';
        del.onclick = function () { removeMod(m.packageId); };
        row.appendChild(del);
        box.appendChild(row);
      });
    }
    // 模组建筑清空后，别把玩家留在空的「模组」页签上
    if (activeCat === 'mod' && (!mods.length || !hasModBuildings())) activeCat = 'fav';
    buildTabs();
    buildPalette();
  }

  function removeMod(packageId) {
    var api = modsApi();
    if (!api || !api.remove) return;
    api.remove(packageId).then(function (res) {
      applyModManifest(res);
      updateModList();
    }, function (e) {
      toast('移除模组失败：' + ((e && e.message) || e), true);
    });
  }

  /** 启动时从 IndexedDB 恢复模组数据（核心缓存恢复与否都要调） */
  function restoreMods() {
    var api = modsApi();
    if (!api || !api.restore) { updateModList(); return; }
    api.restore().then(function (res) {
      if (res && res.manifest) {
        // 别把「已用缓存数据（替换 N 条…）」的详情冲掉，追加一行即可
        useManifest(res.manifest, '已恢复模组，', function (html) {
          var st = $('gameStatus');
          if (!st) return;
          st.innerHTML = st.innerHTML ? st.innerHTML + '<br>' + html : html;
        });
      }
      updateModList();
    }, function () { updateModList(); });
  }

  /** 游戏目录重新导入后：用新的核心数据重解析已存模组 */
  function refreshMods() {
    var api = modsApi();
    if (!api || !api.refresh) { updateModList(); return; }
    api.refresh().then(function (res) {
      // 不覆盖「导入完成」的详细状态，所以给 useManifest 传个空的状态回调
      if (res && res.manifest) useManifest(res.manifest, '', function () {});
      updateModList();
    }, function () { updateModList(); });
  }

  // ------------------------------------------------------------------ 导入游戏资源
  // 玩家把 RimWorld 安装目录拖进来 → 浏览器里现场解析数据 + 解出原版贴图 → 存 IndexedDB
  function initGameImport() {
    var drop = $('gameDrop'), pick = $('btnPickGame'), input = $('fileGameDir');
    var status = $('gameStatus'), clearBtn = $('btnGameClear');
    if (!drop || !global.RWGame) return;

    // ---- 首次打开时的导入提示弹窗 ----
    var prompt = $('gameImportModal');
    var noAsk = $('gameImportNoAsk');
    function promptDismissed() {
      var s = Io.loadSettings() || {};
      return !!s.noGamePrompt;
    }
    function rememberNoAsk() {
      if (!noAsk || !noAsk.checked) return;
      var s = Io.loadSettings() || {};
      s.noGamePrompt = true;
      Io.saveSettings(s);
    }
    function hidePrompt() { if (prompt) prompt.classList.remove('show'); }
    function showPrompt() {
      if (!prompt || promptDismissed()) return;
      if (noAsk) noAsk.checked = false;
      prompt.classList.add('show');
    }
    if ($('btnPromptLater')) $('btnPromptLater').onclick = function () { rememberNoAsk(); hidePrompt(); };
    if ($('btnPromptPickGame')) $('btnPromptPickGame').onclick = function () {
      rememberNoAsk(); hidePrompt(); input.click();
    };

    function setStatus(html) { if (status) status.innerHTML = html; }
    function humanSize(b) { return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB'; }
    /** 双击打开本地 html（file://）时，浏览器不允许网页读拖入的文件夹，只能走「选择目录」 */
    function localFilePage() {
      try { return !!(global.location && global.location.protocol === 'file:'); } catch (e) { return false; }
    }
    function localPickHint(subject, tip) {
      return '这个页面是双击打开的本机文件：浏览器不允许网页读取拖入的文件夹（macOS 的 Chrome / Edge / 豆包都这样），' +
        '请点「' + subject + '」把文件夹选进来。' +
        '<br><span class="muted">' + tip + '</span>';
    }

    function runImport(files) {
      if (!files || !files.length) {
        setStatus('没拿到文件：请点「选择模组文件夹」按钮（macOS 双击打开 html 时，浏览器不允许网页读拖进来的文件夹）');
        return;
      }
      drop.classList.add('busy');
      var imp = new global.RWGame.Importer();
      imp.onProgress = function (text, frac) {
        setStatus(text + ' <span class="muted">' + Math.round((frac || 0) * 100) + '%</span>');
      };
      setStatus('正在导入…');
      imp.run(files).then(function (res) {
        drop.classList.remove('busy');
        applyStuff();
        useManifest(res.manifest, '导入完成，');
        var mg = res.merged || {};
        setStatus('✅ 导入完成：已替换 <b>' + (mg.replaced || 0) + '</b> 条 / 新增 <b>' + (mg.added || 0) +
          '</b> 条建筑 · <b>' + res.info.sprites + '</b> 张贴图<br><span class="muted">中文名来源：' + (res.langSource || '内置对照表') +
          ' · 换游戏版本后重新拖一次目录即可更新</span>' +
          (res.info.skipped ? '<br><span class="muted">⚠️ 有 ' + res.info.skipped +
            ' 张贴图没解出来：这个浏览器不支持 BC7 压缩纹理（常见于关闭硬件加速或远程桌面）。这些建筑会改用矢量图，不影响布局。</span>' : '') +
          (res.info.mem ? '<br><span class="muted">⚠️ 这个浏览器不允许本地数据库，数据只在本次打开有效，刷新后需要重新拖一次</span>' : ''));
        rememberNoAsk();
        hidePrompt();
        toast('已导入 ' + res.info.sprites + ' 张贴图 · 建筑数据替换 ' + (mg.replaced || 0) + ' 条（下次打开直接可用）');
        // 核心数据换了，已存的模组要按新数据重解析一遍（ParentName 继承 / 贴图覆盖）
        refreshMods();
      }, function (e) {
        drop.classList.remove('busy');
        setStatus('❌ ' + ((e && e.message) || e));
      });
    }

    /** 拖拽拿不到文件时的引导：多半是「双击打开 html」（file://）时浏览器不让读目录 */
    function pickInstead() {
      setStatus('⚠️ ' + (localFilePage()
        ? '这个页面是双击打开的本机文件，浏览器不允许网页读取拖入的文件夹，已经帮你改走「选择目录」。'
        : '没读到拖入的文件夹，换用「选择目录」试试。') +
        '<br><span class="muted">选 <b>RimWorld 安装目录</b> 整层就好，工具会自动进 RimWorld.app 找 Core 贴图；也可以点上面的「选择游戏目录」。</span>');
      try { input.click(); } catch (e) { /* 没有手势就点不动，按钮还在 */ }
    }

    // 拖入
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add('over'); });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove('over'); });
    });
    drop.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt || !global.RWGame.dropHasFiles(dt)) return;
      global.RWGame.collectFromDrop(dt).then(function (files) {
        // 拖进来的不是游戏目录（比如 file:// 页面只掉出一两个假文件）就直接给选择目录的引导
        if (files && files.length && global.RWGame.looksLikeGameDir(files)) return runImport(files);
        pickInstead();
      }, function (err) {
        setStatus('❌ ' + ((err && err.message) || err));
      });
    });
    // 整个窗口也能拖（更好按）
    global.addEventListener('dragover', function (e) { e.preventDefault(); });
    global.addEventListener('drop', function (e) {
      if (drop.contains(e.target)) return;
      // 「导入模组建筑」有自己的拖拽区，别被这里当成游戏目录
      var modDrop = $('modDrop');
      if (modDrop && modDrop.contains(e.target)) return;
      e.preventDefault();
      var dt = e.dataTransfer;
      if (!dt || !global.RWGame.dropHasFiles(dt)) return;
      global.RWGame.collectFromDrop(dt).then(function (files) {
        // 拖进来的不是游戏目录（比如 file:// 页面只掉出一两个假文件）就直接给选择目录的引导
        if (files && files.length && global.RWGame.looksLikeGameDir(files)) return runImport(files);
        pickInstead();
      });
    });

    // 点按钮选目录
    pick.onclick = function () { input.click(); };
    input.onchange = function () {
      var list = global.RWGame.collectFromInput(this.files);
      this.value = '';
      runImport(list);
    };

    clearBtn.onclick = function () {
      global.RWGame.clearCache().then(function () {
        if (Art.clearCache) Art.clearCache();
        if (Art.setSpriteEnabled) Art.setSpriteEnabled(false);
        var sp = $('useSprites');
        if (sp) { sp.checked = false; sp.disabled = true; }
        // 模组数据依赖核心数据，核心缓存清了就把模组的内存状态也清掉
        if (global.RWMods && global.RWMods.reset) global.RWMods.reset();
        updateModList();
        // 顺手把已经合进 RWData 的模组建筑摘掉（否则搜索里还留着点不出来的建筑）
        if (global.RWMods && global.RWMods.removeAll) {
          global.RWMods.removeAll().then(function () {
            updateModList();
            buildPalette(); RW.render();
          }, function () { /* 数据库已经清空，失败也无所谓 */ });
        }
        buildPalette(); RW.render();
        setStatus('已清除浏览器里缓存的游戏数据');
        toast('已清除，刷新页面后回到内置数据 + 矢量图');
      });
    };

    // 启动时先看缓存
    global.RWGame.cacheInfo().then(function (info) {
      if (!info) {
        setStatus(localFilePage()
          ? localPickHint('选择游戏目录', '选 RimWorld 安装目录整层就好（Steam → 右键游戏 → 管理 → 浏览本地文件），工具会自动进 RimWorld.app 找原版贴图')
          : '还没导入。拖入游戏目录后，数据与贴图都会自动生成。');
        showPrompt();
        // 可能只存过模组数据、没有核心数据 —— 也恢复一下，列表里看得到
        restoreMods();
        return;
      }
      hidePrompt();
      global.RWGame.loadCache().then(function (cache) {
        if (!cache) { setStatus('缓存读取失败，请重新导入一次'); showPrompt(); restoreMods(); return; }
        applyStuff();
        useManifest(cache.manifest, '');
        var cm = cache.merged || {};
        var cacheTip = '<br><span class="muted">中文名来源：' + (info.langSource || '内置对照表') +
          ' · 换游戏版本后重新拖一次目录即可更新</span>';
        if (info.skipped) {
          cacheTip += '<br><span class="muted">⚠️ 有 ' + info.skipped +
            ' 张贴图没解出来：这个浏览器不支持 BC7 压缩纹理（常见于关闭硬件加速或远程桌面）。这些建筑会改用矢量图，不影响布局。</span>';
        }
        setStatus('✅ 已用浏览器里缓存的数据（建筑替换 ' + (cm.replaced || 0) + ' 条 · ' + info.sprites +
          ' 张贴图 · ' + humanSize(info.bytes || 0) + '）' + cacheTip);
        restoreMods();
      });
    });
  }

  // ------------------------------------------------------------------ 导入模组建筑
  // 把 Mods 文件夹（或单个模组文件夹）拖进来 → js/modimport.js 扫描模组新增的可建造建筑。
  // 数据要叠在游戏目录之上，所以没导入过游戏目录时先提示、不硬拦（模组可能自带全套贴图）。
  function initModImport() {
    var drop = $('modDrop');
    var pick = $('btnPickMod');
    var input = $('fileModDir');
    var status = $('modStatus');
    var clearBtn = $('btnModClear');
    if (!drop) return;
    var busy = false;

    function setStatus(html) { if (status) status.innerHTML = html; }
    function errText(e) { return (e && e.message) || e; }
    function setBusy(on) {
      busy = !!on;
      if (on) drop.classList.add('busy'); else drop.classList.remove('busy');
      if (pick) pick.disabled = !!on;
      if (clearBtn) clearBtn.disabled = !!on;
    }

    function reportResult(res) {
      applyStuff();
      // manifest 为 null 时说明这次没产出基础贴图清单，保留当前画布贴图不动
      if (res.manifest) useManifest(res.manifest, '');
      updateModList();
      var added = res.added || [];
      var warnings = res.warnings || [];
      var errors = res.errors || [];
      var html = (res.buildings || 0) > 0
        ? '✅ 新增 <b>' + res.buildings + '</b> 个建筑 · <b>' + (res.sprites || 0) + '</b> 张模组贴图'
        : '⚠️ 没有新增建筑 · <b>' + (res.sprites || 0) + '</b> 张模组贴图';
      if (added.length) {
        html += '<br><span class="muted">' + added.map(function (a) {
          return esc(a.name || a.packageId) + '（' + (a.count || 0) + '）';
        }).join(' · ') + '</span>';
      }
      // 没读到核心 Defs 时 ParentName 继承不完整，模组建筑可能缺字段（尺寸/材料/工作量）。
      // modimport 自己也会给出更具体的提示，别重复。
      if (res.hasCore === false && !warnings.some(function (w) { return /ParentName|游戏目录/.test(w.message || ''); })) {
        html += '<br><span class="muted">⚠️ 没读到游戏核心数据，ParentName 继承可能不完整 —— 建议先导入游戏目录</span>';
      }
      if (warnings.length) {
        // 一次拖入整个 294100 时「这个模组没有建筑」之类的提示可能几十条，只展开前几条
        var shown = warnings.slice(0, 5);
        html += '<br><span class="muted">⚠️ ' + shown.map(function (w) {
          return (w.name ? esc(w.name) + '：' : '') + esc(w.message || '');
        }).join('<br>');
        if (warnings.length > shown.length) html += '<br>…还有 ' + (warnings.length - shown.length) + ' 条同类提示（多数是模组里没有可建造建筑）';
        html += '</span>';
      }
      if (errors.length) {
        html += '<br><span class="muted">❌ ' + errors.length + ' 个模组没能导入：' +
          errors.map(function (er) { return esc(er.name || '（未知）') + '：' + esc(er.message || ''); }).join('；') +
          '</span>';
      }
      setStatus(html);
      if (res.buildings > 0) toast('已导入模组：新增 ' + res.buildings + ' 个建筑 · ' + (res.sprites || 0) + ' 张模组贴图');
      else toast('没有从这些文件夹里找到可建造建筑', true);
      if (errors.length) toast('有 ' + errors.length + ' 个模组没能导入，详情见右侧状态', true);
    }

    function runModImport(files) {
      var api = modsApi();
      if (!api || !api.importFiles) {
        setStatus('这个页面没有加载模组导入模块（js/modimport.js）');
        return;
      }
      if (!global.RWGame) {
        setStatus('请先在「导入游戏资源」里导入游戏目录，再导入模组');
        return;
      }
      if (!files || !files.length) {
        setStatus('没拿到文件：请点「选择模组文件夹」按钮（macOS 双击打开 html 时，浏览器不允许网页读拖进来的文件夹）');
        return;
      }
      if (busy) return;
      setBusy(true);
      setStatus('正在解析模组…');
      api.importFiles(files, function (text, frac) {
        setStatus(text + ' <span class="muted">' + Math.round((frac || 0) * 100) + '%</span>');
      }).then(function (res) {
        setBusy(false);
        try { reportResult(res); } catch (e) { setStatus('❌ ' + errText(e)); }
      }, function (e) {
        setBusy(false);
        setStatus('❌ ' + errText(e));
        toast('模组导入失败：' + errText(e), true);
      });
    }

    function localFilePage() {
      try { return !!(global.location && global.location.protocol === 'file:'); } catch (e) { return false; }
    }

    /** 拖拽拿不到文件时的引导（本地 file:// 打开时浏览器不让读目录） */
    function modPickInstead() {
      setStatus('⚠️ ' + (localFilePage()
        ? '这个页面是双击打开的本机文件，浏览器不允许网页读取拖入的文件夹，已经帮你改走「选择目录」。'
        : '没读到拖入的文件夹，换用「选择目录」试试。') +
        '<br><span class="muted">选 <b>Mods 文件夹</b> 整层（macOS：~/Library/Application Support/RimWorld/Mods），也可以点上面的「选择模组文件夹」。</span>');
      if (input) { try { input.click(); } catch (e) { /* 点不动就等用户点按钮 */ } }
    }

    // 拖入：这里必须 stopPropagation，否则外层 window 的兜底会把同一份文件当游戏目录再导一遍
    ['dragenter', 'dragover'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.add('over');
      });
    });
    ['dragleave', 'drop'].forEach(function (ev) {
      drop.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        drop.classList.remove('over');
      });
    });
    drop.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (!dt || busy) return;
      if (!global.RWGame) {
        setStatus('请先在「导入游戏资源」里导入游戏目录，再导入模组');
        return;
      }
      if (!global.RWGame.dropHasFiles(dt)) return;
      global.RWGame.collectFromDrop(dt).then(function (files) {
        if (files && files.length && global.RWGame.looksLikeModDir(files)) return runModImport(files);
        modPickInstead();
      }, function (err) {
        setStatus('❌ ' + errText(err));
      });
    });

    // 点按钮选目录
    if (pick && input) {
      pick.onclick = function () { if (!busy) input.click(); };
      input.onchange = function () {
        var list = global.RWGame ? global.RWGame.collectFromInput(this.files) : [];
        this.value = '';
        runModImport(list);
      };
    }

    // 清除全部
    if (clearBtn) clearBtn.onclick = function () {
      var api = modsApi();
      if (!api || !api.removeAll || busy) return;
      var mods = (api.list ? api.list() : []) || [];
      if (!mods.length) { setStatus('还没有导入任何模组'); return; }
      if (!confirm('清除全部 ' + mods.length + ' 个模组导入的建筑与贴图？')) return;
      setBusy(true);
      setStatus('正在清除…');
      api.removeAll().then(function (res) {
        setBusy(false);
        applyModManifest(res);
        updateModList();
        setStatus('已清除全部模组');
        toast('已清除全部模组建筑');
      }, function (e) {
        setBusy(false);
        setStatus('❌ ' + errText(e));
        toast('清除模组失败：' + errText(e), true);
      });
    };

    if (localFilePage() && status && !status.innerText.trim()) {
      setStatus('双击打开的本机页面里，浏览器不允许网页读取拖入的文件夹 —— 请点「选择模组文件夹」。' +
        '<br><span class="muted">macOS 的 Mods 在 ~/Library/Application Support/RimWorld/Mods；也可以先用「导入游戏资源」导入游戏目录。</span>');
    }
    updateModList();
  }

  // ------------------------------------------------------------------ 自定义提示框
  // 浏览器原生 title 提示框没法改样式，这里接管成游戏那种近黑提示框
  function initTooltips() {
    var tip = $('tip');
    if (!tip) return;
    var cur = null;
    function show(el) {
      var text = el.getAttribute('data-tip') || el.getAttribute('title');
      if (!text) return;
      if (el.hasAttribute('title')) { el.setAttribute('data-tip', text); el.removeAttribute('title'); }
      tip.textContent = text;
      tip.classList.add('show');
      var r = el.getBoundingClientRect();
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var x = Math.min(Math.max(6, r.left), global.innerWidth - tw - 8);
      var y = r.bottom + 6;
      if (y + th > global.innerHeight - 6) y = Math.max(6, r.top - th - 6);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
    }
    function hide() { tip.classList.remove('show'); cur = null; }
    document.addEventListener('mouseover', function (e) {
      var el = e.target && e.target.closest ? e.target.closest('[title],[data-tip]') : null;
      if (!el || el === cur) return;
      cur = el;
      show(el);
    });
    document.addEventListener('mouseout', function (e) {
      if (cur && (!e.relatedTarget || !cur.contains(e.relatedTarget))) hide();
    });
    document.addEventListener('mousedown', hide);
    document.addEventListener('scroll', hide, true);
    global.addEventListener('blur', hide);
  }

  // ------------------------------------------------------------------ 启动
  function boot() {
    var cv = $('canvas');
    RW.attach(cv);
    RW.reindex();
    applyStuff();
    // 读回上次收藏 / 最近使用 / 环境温度
    (function () {
      var s = Io.loadSettings() || {};
      if (s.favorites) state.favorites = s.favorites;
      if (s.recent) state.recent = s.recent;
      if (s.ambientTemp != null) state.ambientTemp = s.ambientTemp;
    })();
    loadTemplates();
    renderTemplates();
    buildTabs();
    buildPalette();
    initGameImport();
    initModImport();
    initTooltips();

    // 尺寸
    $('gridCols').value = state.cols; $('gridRows').value = state.rows;
    $('applyGrid').onclick = function () {
      RW.setGrid(parseInt($('gridCols').value, 10) || 60, parseInt($('gridRows').value, 10) || 60);
      toast('地图已调整为 ' + state.cols + '×' + state.rows);
    };

    // 工具
    Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) {
      b.onclick = function () {
        RW.setTool(b.dataset.tool);
        updateTools(); updateBrushInfo();
      };
    });
    function updateTools() {
      Array.prototype.forEach.call(document.querySelectorAll('[data-tool]'), function (b) {
        b.classList.toggle('on', b.dataset.tool === state.tool);
      });
    }

    // 绘制方式由建筑类型自动决定（墙→方框、门/家具→单点直线、地面→填充）

    // 拖动时的实时读数
    RW.on('hud', function (text) {
      var hud = $('drawHud'), info = $('rectInfo');
      if (text) { hud.textContent = text; hud.classList.add('show'); info.textContent = text; }
      else { hud.classList.remove('show'); info.textContent = ''; }
    });

    $('btnUndo').onclick = RW.undo; $('btnRedo').onclick = RW.redo;
    $('btnFit').onclick = function () { RW.fitView(); };
    $('btnZoomIn').onclick = function () { RW.zoomAt(1.2); };
    $('btnZoomOut').onclick = function () { RW.zoomAt(1 / 1.2); };
    $('btnClear').onclick = function (e) {
      var ok = false;
      if (e && e.shiftKey) {
        ok = confirm('连存档原有建筑一起清空？此操作可用 Ctrl+Z 撤销。');
        if (ok) RW.clearAll(true);
      } else {
        ok = confirm('清空你画的建筑/地板？存档原有建筑会保留（按住 Shift 点可连底图一起清）。');
        if (ok) RW.clearAll(false);
      }
      // 主动清空了，就别让自动保存又把它恢复回来
      if (ok) {
        Io.deleteNamed('（自动保存）');
        autoDirty = false;
      }
    };
    $('btnSelRotate').onclick = function () { RW.rotateSelection(); updateBrushInfo(); updateInspector(); };
    $('btnSelCopy').onclick = doCopy;
    $('btnSelPaste').onclick = doPaste;
    $('btnSelDelete').onclick = function () { RW.deleteSelection(); updateBrushInfo(); updateInspector(); };
    $('btnSelClear').onclick = function () { RW.setSelection([]); RW.render(); updateInspector(); };
    function doCopy() {
      var c = RW.copySelection();
      if (!c) { toast('先选中一些建筑或地板'); return; }
      state.paste = c; state.paste.at = { x: state.hover ? state.hover.x : 0, z: state.hover ? state.hover.z : 0 };
      RW.setTool('place'); updateTools();
      toast('已复制 ' + c.items.length + ' 个建筑' + (c.floors.length ? ' / ' + c.floors.length + ' 格地板' : '') + '，点击画布放置');
    }
    function doPaste() {
      var t = state.paste;
      if (!t) { toast('剪贴板是空的，先复制选中内容'); return; }
      RW.pasteAt(t, state.hover ? state.hover.x : 0, state.hover ? state.hover.z : 0);
    }

    // 模板
    if ($('btnTplSave')) {
      $('btnTplSave').onclick = function () {
        var clip = RW.copySelection();
        if (!clip || (!clip.items.length && !clip.floors.length)) { toast('先框选一块区域（建筑或地板都行）再存模板'); return; }
        var name = ($('tplName').value || '').trim() || ('模板 ' + ((state.templates || []).length + 1));
        var list = state.templates || (state.templates = []);
        var exist = -1;
        list.forEach(function (t, i) { if (t.name === name) exist = i; });
        var rec = { name: name, clip: clip };
        var prev = exist >= 0 ? list[exist] : null;
        if (exist >= 0) list[exist] = rec; else list.push(rec);
        if (!saveTemplates()) {
          if (prev) list[exist] = prev; else list.pop();
          toast('模板保存失败：浏览器存储空间不够（模板太大 / 存了太多工程）', true);
          return;
        }
        renderTemplates();
        $('tplName').value = '';
        toast('已保存模板「' + name + '」');
      };
    }

    // 图层
    [['lyGrid', 'grid'], ['lyFloors', 'floors'], ['lyBuildings', 'buildings'],
    ['lyPower', 'power'], ['lyRooms', 'rooms'], ['lyZones', 'zones'],
    ['lyTerrain', 'terrain'], ['lyHome', 'home'], ['lyBlocked', 'blocked']].forEach(function (p) {
      var el = $(p[0]);
      if (!el) return;
      el.checked = state.layers[p[1]];
      el.onchange = function () {
        state.layers[p[1]] = el.checked;
        if (el.checked && (p[1] === 'power' || p[1] === 'rooms')) runCheck();
        RW.render();
      };
    });
    var rt = $('respectTerrain');
    if (rt) { rt.checked = state.respectTerrain !== false; rt.onchange = function () { state.respectTerrain = this.checked; RW.render(); }; }
    var st2 = $('strictTerrain');
    if (st2) { st2.checked = !!state.strictTerrain; st2.onchange = function () { state.strictTerrain = this.checked; }; }
    var sh = $('stockHome');
    if (sh) {
      sh.checked = state.useHomeStock !== false;
      sh.onchange = function () {
        state.useHomeStock = this.checked;
        applyStockChoice();
        updateSaveInfo();
        if (window.__lastEstimate) runEstimate();
      };
    }
    var li = $('lockImported');
    if (li) li.onchange = function () { /* 只在导入存档时生效 */ };

    // 材质现在是逐物品的：在左侧物品栏长按左键（或右键）选材质
    // （旧的「统一材质」下拉已移除）

    // 原版贴图开关（js/sprites.js 存在时才可用）
    var spEl = $('useSprites');
    if (spEl) {
      var hasSprites = !!(Art.hasSprites && Art.hasSprites());
      spEl.checked = hasSprites;
      spEl.disabled = !hasSprites;
      if (Art.setSpriteEnabled) Art.setSpriteEnabled(hasSprites);
      if (!hasSprites) {
        var row = $('spriteRow');
        if (row) {
          row.classList.add('muted');
          row.title = '没有原版贴图清单（js/sprites.js）。用 tools/extract_textures.py 从本机 RimWorld 提取后刷新页面即可启用。';
        }
      }
      spEl.onchange = function () { Art.setSpriteEnabled(this.checked); RW.render(); };
    }
    // 贴图是异步加载的：加载完一批就刷新物品栏与画布（做个防抖）
    if (Art.onImagesLoaded) {
      var imgTimer = null;
      Art.onImagesLoaded(function () {
        if (imgTimer) return;
        imgTimer = setTimeout(function () {
          imgTimer = null;
          buildPalette();
          RW.render();
        }, 120);
      });
    }
    // 搜索
    $('search').oninput = function () { searchText = this.value; buildPalette(); };
    $('search').onkeydown = function (e) { if (e.key === 'Escape') { this.value = ''; searchText = ''; buildPalette(); } };

    // 帮助 / 路径提示
    function openHelp() { $('helpModal').classList.add('show'); }
    $('btnHelp').onclick = openHelp;
    $('btnHelpImport').onclick = openHelp;
    $('btnHelpImport2').onclick = openHelp;
    (function guessSavePath() {
      var ua = (navigator.userAgent || '') + ' ' + (navigator.platform || '');
      var el = $('savePathHint');
      if (!el) return;
      if (/Win/i.test(ua)) el.textContent = '%USERPROFILE%\\AppData\\LocalLow\\Ludeon Studios\\RimWorld by Ludeon Studios\\Saves';
      else if (/Mac/i.test(ua)) el.textContent = '~/Library/Application Support/RimWorld/Saves';
      else el.textContent = '~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Saves';
      el.title = '点右侧「详情」看完整说明';
    })();

    // 导出
    $('btnExportBp').onclick = doExportBlueprint;
    $('btnExportBpDir').onclick = exportBlueprintToFolder;
    $('btnExportJson').onclick = doExportJson;
    if ($('btnExportPng')) $('btnExportPng').onclick = doExportPng;
  if ($('btnBrief')) $('btnBrief').onclick = doExportBrief;
  if ($('btnImportPlan')) $('btnImportPlan').onclick = doImportPlan;
  if ($('btnPastePlan')) $('btnPastePlan').onclick = doPastePlan;
  if ($('filePlan')) $('filePlan').onchange = function () {
    var f = this.files[0]; if (!f) return;
    X.readFile(f).then(importPlanText);
    this.value = '';
  };

    // 锁定存档原有建筑
    if ($('btnLockSel')) $('btnLockSel').onclick = function () {
      var n = RW.setSelectionLocked(true); toast(n ? '已锁定 ' + n + ' 个（导出时排除）' : '先选中一些建筑'); updateInspector();
    };
    if ($('btnUnlockSel')) $('btnUnlockSel').onclick = function () {
      var n = RW.setSelectionLocked(false); toast(n ? '已解锁 ' + n + ' 个' : '先选中一些建筑'); updateInspector();
    };
    if ($('btnUnlockAll')) $('btnUnlockAll').onclick = function () {
      RW.setAllLocked(false); toast('已解锁全部存档原有建筑（现在导出会包含它们）');
    };

    // 工作量估算
    if ($('btnEstimate')) $('btnEstimate').onclick = runEstimate;

    // 导入
    $('btnOpenJson').onclick = function () { $('fileJson').click(); };
    $('fileJson').onchange = function () {
      var f = this.files[0]; if (!f) return;
      X.readFile(f).then(function (t) {
        try { RW.loadProject(JSON.parse(t)); $('mapName').value = state.mapName; RW.fitView(); updateSaveInfo(); toast('已打开工程'); }
        catch (e) { toast('打开失败：' + e.message, true); }
      });
      this.value = '';
    };
    $('btnImportSave').onclick = function () { $('fileSave').click(); };
    $('fileSave').onchange = function () {
      var f = this.files[0]; if (!f) return;
      X.readFile(f).then(importSaveText); this.value = '';
    };

    // ---- 与游戏视角一致的轴向设置 ----
    $('flipZ').checked = state.flipZ !== false;
    $('flipX').checked = !!state.flipX;
    $('flipZ').onchange = function () { state.flipZ = this.checked; RW.render(); };
    $('flipX').onchange = function () { state.flipX = this.checked; RW.render(); };

    // 本地保存
    $('btnSaveLocal').onclick = function () {
      if (!Io.lsAvailable()) { toast('这个浏览器不允许本地存储，请用「保存工程」导出文件', true); return; }
      state.mapName = currentName();
      if (Io.saveNamed(state.mapName, RW.exportProject())) { refreshSaved(); toast('已保存到浏览器：' + state.mapName); }
      else toast('保存失败', true);
    };
    $('btnLoadLocal').onclick = function () {
      var name = $('savedSel').value;
      var store = Io.loadStore();
      if (!name || !store[name]) { toast('没有这个存档'); return; }
      RW.loadProject(store[name]); $('mapName').value = state.mapName; RW.fitView(); updateSaveInfo(); toast('已载入：' + name);
    };
    $('btnDelLocal').onclick = function () {
      var name = $('savedSel').value;
      if (!name) return;
      Io.deleteNamed(name); refreshSaved(); toast('已删除：' + name);
    };
    function refreshSaved() {
      var sel = $('savedSel'); var store = Io.loadStore();
      var names = Object.keys(store);
      sel.innerHTML = names.length ? '' : '<option value="">（空）</option>';
      names.forEach(function (n) {
        var o = document.createElement('option'); o.value = n; o.textContent = n; sel.appendChild(o);
      });
    }
    refreshSaved();

    // ---- 自动保存 ----
    // 每隔一会儿把当前布局存一份到浏览器，浏览器崩了 / 误关窗口也不至于全丢。
    // 存的是一个固定名字的存档（不占「本地存档」列表），下次打开自动恢复。
    var AUTO_NAME = '（自动保存）';
    var autoTimer = null, autoDirty = false;
    function autoSaveNow(quiet) {
      if (!Io.lsAvailable()) return;
      if (!state.buildings.length && !Object.keys(state.floors || {}).length) return;
      state.mapName = currentName();
      var ok = Io.saveNamed(AUTO_NAME, RW.exportProject());
      if (!ok) return;
      autoDirty = false;
      var el = $('autoSaveInfo');
      if (el) {
        var d = new Date();
        el.textContent = '上次自动保存：' + d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0');
      }
      if (!quiet) toast('已自动保存到浏览器');
    }
    if ($('autoSave')) {
      $('autoSave').onchange = function () {
        var s = Io.loadSettings() || {};
        s.autoSave = this.checked;
        Io.saveSettings(s);
        if (this.checked) autoSaveNow(true);
      };
      var st0 = Io.loadSettings() || {};
      if (st0.autoSave === false) $('autoSave').checked = false;
      // 有自动保存、而当前画布是空的 → 直接恢复
      var store = Io.loadStore();
      if (store[AUTO_NAME] && !state.buildings.length && !Object.keys(state.floors || {}).length) {
        try {
          RW.loadProject(store[AUTO_NAME]);
          $('mapName').value = state.mapName;
          RW.fitView();
          updateSaveInfo();
          toast('已恢复上次自动保存的布局');
        } catch (e) { /* 存档坏了就当没有 */ }
      }
      autoTimer = setInterval(function () {
        if (!autoDirty) return;
        if ($('autoSave') && !$('autoSave').checked) return;
        autoSaveNow(true);
      }, 20000);
      RW.on('change', function () { autoDirty = true; });
      // 关页面 / 刷新前把最后一段改动落盘（localStorage 是同步的）
      global.addEventListener('beforeunload', function () {
        if (autoDirty) autoSaveNow(true);
      });
    }

    // 校验
    $('btnCheck2').onclick = runCheck;
    if ($('showApprox')) {
      $('showApprox').onchange = function () { runCheck(); };
    }

    // 环境温度（算制冷 / 加热需求用）
    if ($('ambientTemp')) {
      $('ambientTemp').value = state.ambientTemp == null ? 21 : state.ambientTemp;
      $('ambientTemp').onchange = function () {
        var t = parseFloat(this.value);
        if (isNaN(t)) { this.value = state.ambientTemp; return; }
        state.ambientTemp = t;
        savePrefs();
        runCheck();
      };
    }

    // 自动更新
    RW.on('change', function () {
      updateInspector();
      // 电力 / 房间图层开着就重跑校验；
      // 已经列出了房间时也要重跑 —— 否则撤销之后房间列表还是旧的。
      // 用 120ms 防抖，连续铺地板/拖框时不会每格都做一次完整分析。
      var rl = $('roomList');
      if (state.layers.power || state.layers.rooms || (rl && rl.children.length)) scheduleCheck();
    });
    // 收藏 / 最近使用记到本机（做个防抖，别每次改动都写一遍 localStorage）
    (function () {
      var t = null;
      RW.on('change', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () { t = null; savePrefs(); }, 800);
      });
    })();
    RW.on('hover', function (h) {
      $('coords').textContent = '(' + h.x + ', ' + h.z + ')';
      updateInspector();
    });
    RW.on('paintFail', function (r) { if (r && r.why) toast(r.why, true); });

    // 键盘
    global.addEventListener('keydown', function (e) {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      var k = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (k === 'z') { e.preventDefault(); e.shiftKey ? RW.redo() : RW.undo(); }
        else if (k === 'y') { e.preventDefault(); RW.redo(); }
        else if (k === 'c') { e.preventDefault(); doCopy(); }
        else if (k === 'v') { e.preventDefault(); doPaste(); }
        else if (k === 's') { e.preventDefault(); doExportJson(); }
        else if (k === 'a') { e.preventDefault(); RW.setSelection(state.buildings.map(function (b) { return b.uid; })); }
        return;
      }
      if (k === 'r') { RW.rotateSelection(); updateBrushInfo(); }
      else if (k === 'escape') {
      // Esc = 取消当前操作：有笔刷/粘贴时先取消它们；都空着就清掉「AI 简报区域」的框
      var hadTool = !!state.brush || !!state.paste;
      RW.setBrush(null); state.paste = null;
      var hadRect = false;
      if (!hadTool && state.briefRect) { delete state.briefRect; hadRect = true; }
      updateBrushInfo(); RW.render();
      if (hadRect) toast('已清除框选区域');
    }
      else if (k === 'delete' || k === 'backspace') { RW.deleteSelection(); }
      else if (k === 'f') { RW.fitView(); }
      else if (k === '1') { RW.setTool('place'); updateTools(); }
      else if (k === '2') { RW.setTool('select'); updateTools(); }
      else if (k === '3') { RW.setTool('erase'); updateTools(); }
    else if (k === '4') { RW.setTool('brief'); updateTools(); }
      else if (k === 'g') { state.layers.grid = !state.layers.grid; $('lyGrid').checked = state.layers.grid; RW.render(); }
      else if (k === 't') { state.layers.terrain = !state.layers.terrain; if ($('lyTerrain')) $('lyTerrain').checked = state.layers.terrain; RW.render(); }
      else if (k === 'b') { state.layers.blocked = !state.layers.blocked; if ($('lyBlocked')) $('lyBlocked').checked = state.layers.blocked; RW.render(); }
      else if (k === 'p') { state.layers.power = !state.layers.power; $('lyPower').checked = state.layers.power; if (state.layers.power) runCheck(); RW.render(); }
      else if (k === 'o') { state.layers.rooms = !state.layers.rooms; $('lyRooms').checked = state.layers.rooms; if (state.layers.rooms) runCheck(); RW.render(); }
    });

    // 初始化
    state.mapName = currentName();
    // 顶栏工程名：随手改了就要立刻生效，导出蓝图 / 保存工程都用它当名字
    $('mapName').addEventListener('input', function () {
      state.mapName = currentName();
      document.title = state.mapName + ' · RimWorld 布局规划器';
    });
    RW.resize();
    setTimeout(function () { RW.homeView(); }, 30);
    updateTools(); updateBrushInfo(); runCheck(); updateInspector(); updateSaveInfo();

    // 恢复设置
    var s = Io.loadSettings();
    if (s && (s.cols !== state.cols || s.rows !== state.rows)) { /* 保持默认 */ }
  }

  global.addEventListener('DOMContentLoaded', boot);
  global.RWApp = { toast: toast, runCheck: runCheck };
})(typeof window !== 'undefined' ? window : globalThis);
