/*
 * main.js —— 界面装配与事件绑定
 */
(function (global) {
  'use strict';

  var RW = global.RW, Data = global.RWData, Art = global.RWArt, X = global.RWExport, Io = global.RWIo, Checks = global.RWChecks;
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

  function buildTabs() {
    var box = $('catTabs');
    box.innerHTML = '';
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

  function buildPalette() {
    var box = $('palette');
    box.innerHTML = '';
    var q = searchText.trim().toLowerCase();
    var list;
    if (activeCat === 'floor') {
      list = Data.FLOORS.map(function (f) { return { floor: f }; });
    } else {
      list = Data.BUILDINGS.filter(function (b) {
        if (b.cat !== activeCat) return false;
        if (!q) return true;
        return (b.name + ' ' + (b.en || '') + ' ' + b.id).toLowerCase().indexOf(q) >= 0;
      }).map(function (b) { return { def: b }; });
    }
    if (q && activeCat !== 'floor') {
      // 搜索时跨类别
      list = Data.BUILDINGS.filter(function (b) {
        return (b.name + ' ' + (b.en || '') + ' ' + b.id).toLowerCase().indexOf(q) >= 0;
      }).map(function (b) { return { def: b }; });
    }
    if (!list.length) { box.innerHTML = '<div class="empty">没有匹配项</div>'; return; }

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
          (def.v && !def.exact ? ' <em title="尺寸可能随版本变动，请以游戏内为准">?</em>' : '') + '</i>' +
          '<i class="stuff" data-stuff="' + esc(def.id) + '"></i>';
        var dn = def.def || def.id;
        var en = def.en || '';
        el.title = def.name +
          (en && en !== def.name && en.toLowerCase() !== String(dn).toLowerCase() ? '（' + en + '）' : '') +
          (def.dlc ? '　[' + def.dlc + ']' : '') +
          '\nid: ' + dn +
          '\n占地 ' + def.size[0] + '×' + def.size[1] +
          (def.powerGen ? '\n发电 ' + def.powerGen + 'W' : '') +
          (def.powerUse ? '\n耗电 ' + def.powerUse + 'W' : '') +
          (def.beauty ? '\n美观 ' + def.beauty : '') +
          (def.stuffCats && def.stuffCats.length ? '\n可换材质：' + stuffCatsText(def) : '') +
          (def.stuffCats && def.stuffCats.length ? '\n（长按左键选材质）' : '');
      } else if (item.floor) {
        var f = item.floor;
        label.innerHTML = '<b>' + esc(f.name) + '</b><i>地板</i>';
        el.title = f.name;
      }
      el.appendChild(label);
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

    var n = sel.length;
    $('btnSelRotate').disabled = !n;
    $('btnSelCopy').disabled = !n;
    $('btnSelPaste').disabled = !state.paste;
    $('btnSelDelete').disabled = !n;
    $('btnSelClear').disabled = !n;
  }

  // ------------------------------------------------------------------ 校验面板
  var lastReport = null;

  function runCheck() {
    lastReport = Checks.analyse(state);
    var box = $('issuesList');
    box.innerHTML = '';
    var issues = lastReport.issues;
    if (!issues.length) {
      box.innerHTML = '<div class="ok">未发现问题 👍</div>';
    } else {
      issues.forEach(function (it) {
        var d = document.createElement('div');
        d.className = 'issue ' + it.level;
        d.innerHTML = '<span class="dot"></span><span>' + esc(it.msg) + '</span>';
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
    rb.innerHTML = lastReport.rooms.length ? lastReport.rooms.map(function (r, i) {
      return '<div class="rrow roomJump" data-idx="' + i + '" title="点击定位到这个房间"><b>房间 #' + (i + 1) + '</b> ' + r.area + ' 格 · 空间 ' + r.space +
        '（' + r.spaceText + '）· 门 ' + r.doors + ' · 制冷器 ' + r.coolers + '/' + r.cooling +
        ' ' + (r.reachable ? '' : '<span class="bad">不通</span>') + '</div>';
    }).join('') : '<div class="muted">没有封闭的房间</div>';
    Array.prototype.forEach.call(rb.querySelectorAll('.roomJump'), function (el) {
      el.onclick = function () {
        var r = lastReport.rooms[+el.dataset.idx];
        if (r) focusCells(r.cells);
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
    return X.toBlueprintsXML(state, {
      name: currentName(), stuff: currentStuff,
      rotFix: state.rotFix !== false,
      excludeLocked: $('excludeLocked') ? $('excludeLocked').checked : true,
      gameVersion: (state.saveMeta && state.saveMeta.gameVersion) || state.saveVersion || '',
      meta: state.saveMeta || null
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

  function doExportJson() {
    X.download(safeName(currentName()) + '.rwplan.json', JSON.stringify(RW.exportProject(), null, 2), 'application/json');
  }
  function safeName(s) { return String(s).replace(/[\\/:*?"<>|]/g, '_').slice(0, 60) || 'layout'; }

  /** 导出 PNG。scope: view=当前视图 / all=全部内容 */
  function doExportPng(scope) {
    var name = safeName(currentName()) + '.png';
    var r;
    try {
      r = RW.exportPNG({
        scope: scope || 'view',
        filename: name,
        onDone: function (fn, w, h) { toast('已导出图片「' + fn + '」（' + w + '×' + h + ' 像素）'); },
        onError: function (e) { toast('导出图片失败：' + (e && e.message ? e.message : e), true); }
      });
    } catch (e) {
      toast('导出图片失败：' + (e && e.message ? e.message : e), true);
      return;
    }
    if (r) toast('正在导出图片…');
  }
  function doExportPngAll() { doExportPng('all'); }

  function openText(title, text, onApply, hint) {
    $('ioTitle').textContent = title;
    $('ioHint').textContent = hint || '';
    $('ioText').value = text || '';
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
      html += '<div class="si-block"><b>科技</b>：已完成 ' + done + ' 项' +
        (res.current ? ' · 研究中 <b>' + esc(res.current) + '</b>' +
          (defs[res.current] ? ' (' + Math.round((res.progress[res.current] || 0)) + '/' + defs[res.current].cost + ')' : '') : '') +
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

    function useManifest(manifest, note) {
      Art.setSprites(manifest, global.RWGame.getImageURL);
      // 单文件版启动时没有 sprites.js，原版贴图开关默认是关闭/禁用的；
      // 导入（或从缓存恢复）贴图后要主动把它打开，否则画布仍然走矢量图。
      if (Art.setSpriteEnabled) Art.setSpriteEnabled(true);
      var spEl = $('useSprites');
      if (spEl) { spEl.disabled = false; spEl.checked = true; }
      var spRow = $('spriteRow');
      if (spRow) { spRow.classList.remove('muted'); spRow.removeAttribute('title'); }
      buildPalette();
      RW.render();
      var n = Object.keys(manifest.items).length;
      var f = Object.keys(manifest.floors).length;
      setStatus('✅ ' + (note || '') + '已启用原版贴图：<b>' + n + '</b> 个建筑 · <b>' + f + '</b> 种地板');
    }

    function runImport(files) {
      if (!files || !files.length) { setStatus('没拿到文件，换个方式再试一次'); return; }
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
          (res.info.mem ? '<br><span class="muted">⚠️ 这个浏览器不允许本地数据库，数据只在本次打开有效，刷新后需要重新拖一次</span>' : ''));
        rememberNoAsk();
        hidePrompt();
        toast('已导入 ' + res.info.sprites + ' 张贴图 · 建筑数据替换 ' + (mg.replaced || 0) + ' 条（下次打开直接可用）');
      }, function (e) {
        drop.classList.remove('busy');
        setStatus('❌ ' + ((e && e.message) || e));
      });
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
      if (!dt) return;
      global.RWGame.collectFromDrop(dt).then(runImport, function (err) {
        setStatus('❌ ' + ((err && err.message) || err));
      });
    });
    // 整个窗口也能拖（更好按）
    global.addEventListener('dragover', function (e) { e.preventDefault(); });
    global.addEventListener('drop', function (e) {
      if (drop.contains(e.target)) return;
      e.preventDefault();
      var dt = e.dataTransfer;
      if (dt && dt.items && dt.items.length) global.RWGame.collectFromDrop(dt).then(runImport);
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
        buildPalette(); RW.render();
        setStatus('已清除浏览器里缓存的游戏数据');
        toast('已清除，刷新页面后回到内置数据 + 矢量图');
      });
    };

    // 启动时先看缓存
    global.RWGame.cacheInfo().then(function (info) {
      if (!info) {
        setStatus('还没导入。拖入游戏目录后，数据与贴图都会自动生成。');
        showPrompt();
        return;
      }
      hidePrompt();
      global.RWGame.loadCache().then(function (cache) {
        if (!cache) { setStatus('缓存读取失败，请重新导入一次'); showPrompt(); return; }
        applyStuff();
        useManifest(cache.manifest, '');
        var cm = cache.merged || {};
        setStatus('✅ 已用浏览器里缓存的数据（建筑替换 ' + (cm.replaced || 0) + ' 条 · ' + info.sprites +
          ' 张贴图 · ' + humanSize(info.bytes || 0) + '）<br><span class="muted">中文名来源：' +
          (info.langSource || '内置对照表') + ' · 换游戏版本后重新拖一次目录即可更新</span>');
      });
    });
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
    buildTabs();
    buildPalette();
    initGameImport();
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
      if (e && e.shiftKey) {
        if (confirm('连存档原有建筑一起清空？此操作可用 Ctrl+Z 撤销。')) RW.clearAll(true);
      } else if (confirm('清空你画的建筑/地板？存档原有建筑会保留（按住 Shift 点可连底图一起清）。')) RW.clearAll(false);
    };
    $('btnSelRotate').onclick = function () { RW.rotateSelection(); updateBrushInfo(); updateInspector(); };
    $('btnSelCopy').onclick = doCopy;
    $('btnSelPaste').onclick = doPaste;
    $('btnSelDelete').onclick = function () { RW.deleteSelection(); updateBrushInfo(); updateInspector(); };
    $('btnSelClear').onclick = function () { RW.setSelection([]); RW.render(); updateInspector(); };
    function doCopy() {
      var c = RW.copySelection();
      if (!c) { toast('先选中一些建筑'); return; }
      state.paste = c; state.paste.at = { x: state.hover ? state.hover.x : 0, z: state.hover ? state.hover.z : 0 };
      RW.setTool('place'); updateTools();
      toast('已复制 ' + c.items.length + ' 个建筑，点击画布放置');
    }
    function doPaste() {
      var t = state.paste;
      if (!t) { toast('剪贴板是空的，先复制选中内容'); return; }
      RW.pasteAt(t, state.hover ? state.hover.x : 0, state.hover ? state.hover.z : 0);
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
    if ($('btnExportPngAll')) $('btnExportPngAll').onclick = doExportPngAll;

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

    // 校验
    $('btnCheck2').onclick = runCheck;

    // 自动更新
    RW.on('change', function () {
      updateInspector();
      if (state.layers.power || state.layers.rooms) runCheck();
    });
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
      else if (k === 'escape') { RW.setBrush(null); state.paste = null; updateBrushInfo(); RW.render(); }
      else if (k === 'delete' || k === 'backspace') { RW.deleteSelection(); }
      else if (k === 'f') { RW.fitView(); }
      else if (k === '1') { RW.setTool('place'); updateTools(); }
      else if (k === '2') { RW.setTool('select'); updateTools(); }
      else if (k === '3') { RW.setTool('erase'); updateTools(); }
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
