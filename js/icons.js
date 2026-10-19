/*
 * icons.js —— 原创矢量贴图（全部用代码绘制，不含任何游戏素材）
 *
 * 约定：每个绘制函数在「格」坐标系里作画，原点 (0,0) 为建筑未旋转时的左上角，
 * 单位为 1 格；调用方会先设置好 translate/rotate/scale。
 * 签名统一为 draw(ctx, def, w, h)，w/h 为该建筑未旋转时的宽/深（单位：格）。
 */

(function (global) {
  'use strict';

  // ---------- 调色板 ----------
  var C = {
    metal: '#79828d', metalD: '#565e6a', metalL: '#9aa3ae',
    wood: '#8b6a45', woodD: '#6a4e30', woodL: '#a8834f',
    fabric: '#6d7ba6', fabricD: '#4e5a80',
    stone: '#8d8d88', stoneD: '#6e6e69',
    plant: '#5f8b4a', plantD: '#3f6330',
    wire: '#d8c14a', wireD: '#8a7a20',
    glass: '#8fb6c9',
    accent: '#e0a23c',
    dark: '#2b2f36', outline: 'rgba(12,14,18,0.85)',
    soft: 'rgba(255,255,255,0.14)'
  };

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  function box(ctx, x, y, w, h, fill, stroke, lw) {
    rr(ctx, x, y, w, h, 0.06);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 0.05; ctx.stroke(); }
  }

  // 描边（保证在深色/浅色底图上都看得清）
  function ink(ctx, lw) { ctx.strokeStyle = C.outline; ctx.lineWidth = lw || 0.05; }

  var ART = {};

  // ---------------- 结构 ----------------
  ART.wall = function (ctx, def, w, h) {
    var fill = def._color || C.stone;
    box(ctx, 0.02, 0.02, w - 0.04, h - 0.04, fill, C.outline, 0.05);
    ctx.fillStyle = 'rgba(255,255,255,0.13)';
    ctx.fillRect(0.02, 0.02, w - 0.04, h * 0.30);
    ctx.fillStyle = 'rgba(0,0,0,0.14)';
    for (var i = 1; i < Math.max(w, h); i++) {
      if (w >= h) ctx.fillRect(i - 0.03, 0.05, 0.03, h - 0.10);
      else ctx.fillRect(0.05, i - 0.03, w - 0.10, 0.03);
    }
  };

  function doorBase(ctx, w, h, auto) {
    box(ctx, 0, 0, w, h, C.wood, C.outline, 0.06);
    ctx.fillStyle = C.woodD;
    ctx.fillRect(0.08, 0.10, w - 0.16, h * 0.06);
    ctx.fillRect(0.08, h * 0.44, w - 0.16, h * 0.06);
    ctx.fillRect(0.08, h * 0.80, w - 0.16, h * 0.06);
    ctx.fillStyle = auto ? C.accent : C.metalL;
    ctx.beginPath(); ctx.arc(w * 0.74, h * 0.5, 0.08, 0, 7); ctx.fill();
    if (auto) { ctx.strokeStyle = C.accent; ctx.lineWidth = 0.045; ctx.strokeRect(0.14, 0.14, w - 0.28, h - 0.28); }
  }
  ART.door = function (ctx, def, w, h) { doorBase(ctx, w, h, false); };
  ART.autodoor = function (ctx, def, w, h) { doorBase(ctx, w, h, true); };
  ART.flap = function (ctx, def, w, h) {
    box(ctx, 0, 0, w, h, C.woodD, C.outline, 0.06);
    ctx.fillStyle = '#3a2c1c';
    ctx.beginPath();
    ctx.moveTo(0.2, 0.12); ctx.lineTo(0.8, 0.12); ctx.lineTo(0.8, 0.72);
    ctx.quadraticCurveTo(0.5, 0.92, 0.2, 0.72); ctx.closePath(); ctx.fill();
  };

  function postRail(ctx, w, h, thick) {
    ctx.strokeStyle = C.woodD; ctx.lineWidth = thick || 0.09;
    if (w >= h) {
      ctx.beginPath(); ctx.moveTo(0.05, h * 0.33); ctx.lineTo(w - 0.05, h * 0.33); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0.05, h * 0.72); ctx.lineTo(w - 0.05, h * 0.72); ctx.stroke();
      ctx.fillStyle = C.wood; [0.16, w - 0.16].forEach(function (x) { ctx.fillRect(x - 0.06, 0.16, 0.12, h - 0.32); });
    } else {
      ctx.beginPath(); ctx.moveTo(w * 0.33, 0.05); ctx.lineTo(w * 0.33, h - 0.05); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(w * 0.72, 0.05); ctx.lineTo(w * 0.72, h - 0.05); ctx.stroke();
      ctx.fillStyle = C.wood; [0.16, h - 0.16].forEach(function (y) { ctx.fillRect(0.16, y - 0.06, w - 0.32, 0.12); });
    }
  }
  ART.fence = function (ctx, def, w, h) { postRail(ctx, w, h, 0.085); };
  ART.fencegate = function (ctx, def, w, h) { postRail(ctx, w, h, 0.085); ink(ctx, 0.05); ctx.strokeRect(0.14, 0.14, w - 0.28, h - 0.28); };

  ART.column = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.06, w - 0.12, h - 0.12, C.stone, C.outline, 0.05);
    ctx.fillStyle = C.stoneD;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.32, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath(); ctx.arc(w / 2 - 0.05, h / 2 - 0.05, Math.min(w, h) * 0.20, 0, 7); ctx.fill();
  };

  ART.sandbag = function (ctx, def, w, h) {
    var rows = 3;
    for (var r = 0; r < rows; r++) {
      var y = 0.08 + r * (h - 0.16) / rows;
      var bh = (h - 0.16) / rows;
      var off = (r % 2) * 0.5;
      for (var c2 = 0; c2 < 2; c2++) {
        var x = 0.04 + (c2 + off) * (w - 0.08) / 2;
        if (off && c2 === 1) continue;
        ctx.fillStyle = r % 2 ? '#9b9069' : '#8b815f';
        rr(ctx, x, y, (w - 0.08) / 2 - 0.02, bh - 0.02, 0.06); ctx.fill();
        ink(ctx, 0.03); ctx.stroke();
      }
    }
  };

  ART.barricade = function (ctx, def, w, h) {
    box(ctx, 0.04, 0.06, w - 0.08, h - 0.12, C.wood, C.outline, 0.05);
    ctx.strokeStyle = C.woodD; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.moveTo(0.06, 0.2); ctx.lineTo(w - 0.06, 0.2);
    ctx.moveTo(0.06, h - 0.2); ctx.lineTo(w - 0.06, h - 0.2); ctx.stroke();
  };

  ART.barrier = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.10, w - 0.12, h - 0.20, C.stone, C.outline, 0.05);
    ctx.fillStyle = C.accent; ctx.fillRect(0.14, h * 0.44, w - 0.28, h * 0.12);
  };

  ART.bridge = function (ctx, def, w, h) {
    ctx.fillStyle = C.wood; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = C.woodD; ctx.lineWidth = 0.035;
    for (var i = 1; i < w; i++) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke(); }
    ink(ctx, 0.05); ctx.strokeRect(0, 0, w, h);
  };

  ART.walllamp = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(255,214,140,0.30)';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.62, 0.42, 0, 7); ctx.fill();
    box(ctx, 0.28, 0.10, 0.44, 0.30, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#ffd88c';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.52, 0.14, 0, 7); ctx.fill();
  };

  // ---------------- 床 / 家具 ----------------
  ART.spot = function (ctx, def, w, h) {
    ctx.strokeStyle = 'rgba(220,220,220,0.55)'; ctx.lineWidth = 0.04;
    ctx.setLineDash([0.12, 0.1]);
    ctx.strokeRect(0.14, 0.14, w - 0.28, h - 0.28);
    ctx.setLineDash([]);
  };
  ART.spot2 = function (ctx, def, w, h) { ART.spot(ctx, def, w, h); ctx.beginPath(); ctx.moveTo(w / 2, 0.14); ctx.lineTo(w / 2, h - 0.14); ctx.stroke(); };

  function bedArt(ctx, def, w, h) {
    box(ctx, 0, 0, w, h, C.woodD, C.outline, 0.05);
    var head = h >= w ? h * 0.26 : w * 0.26;
    // 枕头
    ctx.fillStyle = '#e7e2d4';
    if (h >= w) rr(ctx, 0.10, 0.08, w - 0.20, head - 0.10, 0.05);
    else rr(ctx, 0.08, 0.10, head - 0.10, h - 0.20, 0.05);
    ctx.fill();
    // 被子
    ctx.fillStyle = (def && def._accent) || C.fabric;
    if (h >= w) rr(ctx, 0.06, head, w - 0.12, h - head - 0.06, 0.05);
    else rr(ctx, head, 0.06, w - head - 0.06, h - 0.12, 0.05);
    ctx.fill();
    ink(ctx, 0.04); ctx.stroke();
  }
  ART.bed = function (ctx, def, w, h) { bedArt(ctx, def, w, h); };
  ART.bed2 = function (ctx, def, w, h) { bedArt(ctx, def, w, h); };
  ART.bedroll = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.04, w - 0.12, h - 0.08, '#7d6a53', C.outline, 0.05);
    ctx.fillStyle = (def && def._accent) || C.fabric;
    rr(ctx, 0.10, h * 0.34, w - 0.20, h * 0.58, 0.08); ctx.fill();
  };
  ART.bedroll2 = function (ctx, def, w, h) { ART.bedroll(ctx, def, w, h); };
  ART.hospbed = function (ctx, def, w, h) {
    bedArt(ctx, def, w, h);
    ctx.fillStyle = '#dfe7ec';
    ctx.fillRect(w * 0.42, 0.06, w * 0.16, h * 0.2);
  };
  ART.animalbed = function (ctx, def, w, h) {
    bedArt(ctx, def, w, h);
    ctx.fillStyle = 'rgba(255,255,255,0.30)';
    ctx.beginPath(); ctx.arc(w * 0.72, h * 0.22, 0.10, 0, 7); ctx.fill();
  };
  ART.animalbox = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.06, w - 0.12, h - 0.12, C.wood, C.outline, 0.05);
    ctx.fillStyle = '#4a3a26';
    rr(ctx, 0.16, 0.22, w - 0.32, h - 0.44, 0.06); ctx.fill();
  };
  ART.crib = function (ctx, def, w, h) {
    box(ctx, 0.04, 0.04, w - 0.08, h - 0.08, C.woodL, C.outline, 0.05);
    ctx.strokeStyle = C.woodD; ctx.lineWidth = 0.035;
    for (var i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0.04, i * h / 4); ctx.lineTo(w - 0.04, i * h / 4); ctx.stroke(); }
  };

  ART.table = function (ctx, def, w, h) {
    box(ctx, 0.02, 0.02, w - 0.04, h - 0.04, def._color || C.woodL, C.outline, 0.06);
    ctx.fillStyle = 'rgba(0,0,0,0.16)';
    ctx.fillRect(0.02, h - 0.02 - h * 0.10, w - 0.04, h * 0.10);
  };
  ART.stool = function (ctx, def, w, h) {
    box(ctx, 0.14, 0.14, w - 0.28, h - 0.28, C.woodL, C.outline, 0.05);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2 + 0.04, 0.2, 0, 7); ctx.fill();
  };
  ART.chair = function (ctx, def, w, h) {
    box(ctx, 0.16, 0.20, w - 0.32, h - 0.34, C.woodL, C.outline, 0.05);
    ctx.fillStyle = C.woodD; ctx.fillRect(0.14, 0.08, w - 0.28, 0.14);
  };
  ART.dresser = function (ctx, def, w, h) {
    box(ctx, 0.03, 0.03, w - 0.06, h - 0.06, C.wood, C.outline, 0.05);
    ctx.strokeStyle = C.woodD; ctx.lineWidth = 0.04;
    for (var i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(0.06, i * h / 3); ctx.lineTo(w - 0.06, i * h / 3); ctx.stroke(); }
    ctx.fillStyle = C.metalL;
    ctx.fillRect(w * 0.4, h / 6 - 0.03, w * 0.2, 0.06);
    ctx.fillRect(w * 0.4, h / 2 - 0.03, w * 0.2, 0.06);
  };
  ART.shelf = function (ctx, def, w, h) {
    box(ctx, 0.03, 0.03, w - 0.06, h - 0.06, C.woodD, C.outline, 0.05);
    ctx.fillStyle = C.woodL;
    for (var i = 0; i < 3; i++) ctx.fillRect(0.06 + i * (w - 0.12) / 3 + 0.02, 0.08, (w - 0.12) / 3 - 0.04, h - 0.16);
  };
  ART.pot = function (ctx, def, w, h) {
    box(ctx, 0.24, 0.30, w - 0.48, h - 0.42, '#a05f3c', C.outline, 0.05);
    ctx.fillStyle = C.plant;
    ctx.beginPath(); ctx.arc(w / 2, h * 0.42, Math.min(w, h) * 0.24, 0, 7); ctx.fill();
    ctx.fillStyle = C.plantD;
    ctx.beginPath(); ctx.arc(w / 2 - 0.10, h * 0.36, Math.min(w, h) * 0.13, 0, 7); ctx.fill();
  };
  ART.statue = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.06, w - 0.12, h - 0.12, C.stoneD, C.outline, 0.05);
    ctx.fillStyle = def._color || C.stone;
    rr(ctx, w * 0.28, h * 0.18, w * 0.44, h * 0.64, 0.08); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    rr(ctx, w * 0.34, h * 0.24, w * 0.16, h * 0.24, 0.05); ctx.fill();
  };
  ART.throne = function (ctx, def, w, h) {
    box(ctx, 0.05, 0.05, w - 0.10, h - 0.10, '#7a4a3a', C.outline, 0.06);
    ctx.fillStyle = C.accent;
    ctx.fillRect(w * 0.18, h * 0.10, w * 0.64, h * 0.16);
    ctx.fillStyle = '#5a3529';
    ctx.fillRect(w * 0.30, h * 0.34, w * 0.40, h * 0.54);
  };
  ART.torch = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(255,170,60,0.30)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.42, 0, 7); ctx.fill();
    ctx.fillStyle = C.woodD; ctx.fillRect(w / 2 - 0.05, h * 0.4, 0.10, h * 0.5);
    ctx.fillStyle = '#ffb44d';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.38, 0.16, 0, 7); ctx.fill();
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.38, 0.08, 0, 7); ctx.fill();
  };
  ART.lamp = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(255,224,150,0.22)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.5, 0, 7); ctx.fill();
    box(ctx, w * 0.36, h * 0.42, w * 0.28, h * 0.46, C.metalD, C.outline, 0.04);
    ctx.fillStyle = '#ffe6a8';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.36, 0.18, 0, 7); ctx.fill();
  };
  ART.sunlamp = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(255,236,160,0.20)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.62, 0, 7); ctx.fill();
    box(ctx, w * 0.30, h * 0.30, w * 0.40, h * 0.40, C.metal, C.outline, 0.05);
    ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 0.05;
    for (var i = 0; i < 8; i++) {
      var a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(w / 2 + Math.cos(a) * 0.24, h / 2 + Math.sin(a) * 0.24);
      ctx.lineTo(w / 2 + Math.cos(a) * 0.44, h / 2 + Math.sin(a) * 0.44);
      ctx.stroke();
    }
  };
  ART.brazier = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(255,150,60,0.28)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.4, 0, 7); ctx.fill();
    box(ctx, w * 0.24, h * 0.24, w * 0.52, h * 0.52, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.14, 0, 7); ctx.fill();
  };

  // ---------------- 生产 ----------------
  function benchArt(ctx, w, h, accent) {
    box(ctx, 0.04, 0.04, w - 0.08, h - 0.08, C.woodD, C.outline, 0.06);
    ctx.fillStyle = C.wood;
    ctx.fillRect(0.04, 0.10, w - 0.08, h * 0.30);
    ctx.fillStyle = accent || C.metal;
    var n = Math.max(1, Math.round(Math.max(w, h) / 2));
    for (var i = 0; i < n; i++) {
      if (w >= h) ctx.fillRect(0.14 + i * (w - 0.28) / n, h * 0.52, (w - 0.28) / n * 0.6, h * 0.30);
      else ctx.fillRect(w * 0.14, 0.14 + i * (h - 0.28) / n + h * 0.3, w * 0.72, (h - 0.28) / n * 0.5);
    }
  }
  ART.bench = function (ctx, def, w, h) { benchArt(ctx, w, h, C.metalL); };
  ART.bench2 = function (ctx, def, w, h) { benchArt(ctx, w, h, '#9fb4c4'); };
  ART.analyzer = function (ctx, def, w, h) { benchArt(ctx, w, h, '#8fd0e0'); };
  ART.butcher = function (ctx, def, w, h) {
    benchArt(ctx, w, h, C.metalL);
    ctx.fillStyle = '#b8544f';
    ctx.fillRect(w * 0.20, h * 0.20, w * 0.16, h * 0.16);
  };
  ART.statuebench = function (ctx, def, w, h) {
    benchArt(ctx, w, h, C.stone);
    ctx.fillStyle = C.stoneL || C.stone;
    ctx.beginPath(); ctx.arc(w * 0.5, h * 0.42, Math.min(w, h) * 0.16, 0, 7); ctx.fill();
  };
  ART.stove = function (ctx, def, w, h) {
    box(ctx, 0.04, 0.04, w - 0.08, h - 0.08, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#2c2f34';
    var n = Math.max(2, Math.round(w));
    for (var i = 0; i < n; i++) {
      ctx.beginPath(); ctx.arc(0.14 + i * (w - 0.28) / (n - 1), h * 0.5, Math.min(w, h) * 0.15, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = '#d0642a'; ctx.lineWidth = 0.04;
    for (var j = 0; j < n; j++) {
      ctx.beginPath(); ctx.arc(0.14 + j * (w - 0.28) / (n - 1), h * 0.5, Math.min(w, h) * 0.11, 0, 7); ctx.stroke();
    }
  };
  ART.smelter = function (ctx, def, w, h) {
    box(ctx, 0.04, 0.04, w - 0.08, h - 0.08, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#d0642a';
    ctx.fillRect(w * 0.16, h * 0.30, w * 0.24, h * 0.42);
    ctx.fillStyle = C.metal;
    ctx.fillRect(w * 0.58, h * 0.34, w * 0.26, h * 0.34);
    ctx.fillStyle = '#33363c';
    ctx.fillRect(w * 0.60, h * 0.06, w * 0.12, h * 0.26);
  };
  ART.refinery = function (ctx, def, w, h) {
    box(ctx, 0.04, 0.04, w - 0.08, h - 0.08, C.metalD, C.outline, 0.05);
    ctx.fillStyle = C.metal;
    ctx.beginPath(); ctx.arc(w * 0.32, h * 0.5, Math.min(w, h) * 0.22, 0, 7); ctx.fill();
    ctx.fillStyle = '#5aa06e';
    ctx.fillRect(w * 0.58, h * 0.22, w * 0.26, h * 0.56);
  };
  ART.barrel = function (ctx, def, w, h) {
    ctx.fillStyle = C.wood; rr(ctx, w * 0.22, h * 0.16, w * 0.56, h * 0.68, 0.1); ctx.fill();
    ink(ctx, 0.05); ctx.stroke();
    ctx.fillStyle = C.metalD;
    ctx.fillRect(w * 0.22, h * 0.34, w * 0.56, 0.05);
    ctx.fillRect(w * 0.22, h * 0.62, w * 0.56, 0.05);
  };
  ART.dispenser = function (ctx, def, w, h) {
    box(ctx, 0.10, 0.06, w - 0.20, h - 0.12, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#cbd2d8';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.44, Math.min(w, h) * 0.16, 0, 7); ctx.fill();
    ctx.fillStyle = '#d8b06a';
    ctx.fillRect(w * 0.30, h * 0.70, w * 0.40, h * 0.14);
  };
  ART.hydro = function (ctx, def, w, h) {
    box(ctx, 0.02, 0.02, w - 0.04, h - 0.04, '#3b4a52', C.outline, 0.05);
    ctx.fillStyle = C.plantD;
    for (var i = 0; i < Math.max(1, Math.round(w)); i++)
      ctx.fillRect(0.06 + i * (w - 0.12) / Math.max(1, Math.round(w)), 0.12, (w - 0.12) / Math.max(1, Math.round(w)) * 0.7, h - 0.24);
    ctx.fillStyle = C.plant;
    for (var j = 0; j < Math.max(1, Math.round(w)); j++) {
      var x = 0.06 + j * (w - 0.12) / Math.max(1, Math.round(w)) + (w - 0.12) / Math.max(1, Math.round(w)) * 0.35;
      ctx.beginPath(); ctx.arc(x, h / 2, Math.min(w, h) * 0.13, 0, 7); ctx.fill();
    }
  };
  ART.drill = function (ctx, def, w, h) {
    ctx.fillStyle = '#3f4650';
    rr(ctx, 0.06, 0.06, w - 0.12, h - 0.12, 0.1); ctx.fill();
    ink(ctx, 0.06); ctx.stroke();
    ctx.fillStyle = C.metal;
    rr(ctx, w * 0.30, h * 0.30, w * 0.40, h * 0.40, 0.06); ctx.fill();
    ctx.strokeStyle = C.accent; ctx.lineWidth = 0.07;
    ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.5); ctx.lineTo(w * 0.5, h * 0.14); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.5, h * 0.5); ctx.lineTo(w * 0.82, h * 0.66); ctx.stroke();
  };
  ART.scanner = function (ctx, def, w, h) {
    ctx.fillStyle = '#3f4650';
    rr(ctx, 0.06, 0.06, w - 0.12, h - 0.12, 0.1); ctx.fill();
    ink(ctx, 0.06); ctx.stroke();
    ctx.fillStyle = C.metalL;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.26, 0, 7); ctx.fill();
    ctx.strokeStyle = '#8fd0e0'; ctx.lineWidth = 0.05;
    for (var r = 1; r <= 2; r++) { ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.26 * (1 + r * 0.5), 0, 7); ctx.stroke(); }
  };
  ART.console = function (ctx, def, w, h) {
    box(ctx, 0.05, 0.05, w - 0.10, h - 0.10, C.metalD, C.outline, 0.06);
    ctx.fillStyle = '#243040';
    ctx.fillRect(w * 0.12, h * 0.16, w * 0.52, h * 0.68);
    ctx.fillStyle = '#5fd0e8';
    ctx.fillRect(w * 0.16, h * 0.22, w * 0.44, h * 0.10);
    ctx.fillStyle = '#7ee08a';
    ctx.fillRect(w * 0.16, h * 0.40, w * 0.44, h * 0.08);
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(w * 0.80, h * 0.30, 0.10, 0, 7); ctx.fill();
  };

  // ---------------- 电力 ----------------
  // info.conn 是 4 位掩码：1=上(-z) 2=右(+x) 4=下(+z) 8=左(-x)
  function conduitLine(ctx, w, h, conn) {
    var cx = w / 2, cy = h / 2;
    if (!conn) {
      // 孤立的一格：画一个小接线盒
      ctx.strokeStyle = 'rgba(40,36,20,0.9)'; ctx.lineWidth = 0.10;
      ctx.beginPath(); ctx.arc(cx, cy, 0.13, 0, 7); ctx.stroke();
      ctx.strokeStyle = C.wire; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.arc(cx, cy, 0.13, 0, 7); ctx.stroke();
      return;
    }
    // 深色底 + 亮色线，保证在任何底图上都看得清
    [[0.13, 'rgba(40,36,20,0.85)'], [0.07, C.wire]].forEach(function (p) {
      ctx.strokeStyle = p[1]; ctx.lineWidth = p[0];
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (conn & 1) { ctx.moveTo(cx, cy); ctx.lineTo(cx, 0); }
      if (conn & 4) { ctx.moveTo(cx, cy); ctx.lineTo(cx, h); }
      if (conn & 8) { ctx.moveTo(cx, cy); ctx.lineTo(0, cy); }
      if (conn & 2) { ctx.moveTo(cx, cy); ctx.lineTo(w, cy); }
      ctx.stroke();
    });
    ctx.lineCap = 'butt';
  }
  ART.conduit = function (ctx, def, w, h, info) {
    conduitLine(ctx, w, h, (info && info.conn != null) ? info.conn : 15);
  };
  ART.switch = function (ctx, def, w, h, info) {
    conduitLine(ctx, w, h, (info && info.conn != null) ? info.conn : 15);
    box(ctx, w * 0.24, h * 0.24, w * 0.52, h * 0.52, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#7ee08a';
    ctx.fillRect(w * 0.35, h * 0.34, w * 0.30, h * 0.14);
    ctx.fillStyle = '#d0642a';
    ctx.fillRect(w * 0.35, h * 0.53, w * 0.30, h * 0.14);
  };
  ART.battery = function (ctx, def, w, h) {
    box(ctx, w * 0.12, h * 0.16, w * 0.76, h * 0.68, C.metalD, C.outline, 0.05);
    ctx.fillStyle = '#7ee08a';
    for (var i = 0; i < 3; i++) ctx.fillRect(w * 0.20, h * (0.24 + i * 0.18), w * 0.60, h * 0.10);
    ctx.fillStyle = C.metalL;
    ctx.fillRect(w * 0.34, h * 0.06, w * 0.12, h * 0.12);
    ctx.fillRect(w * 0.54, h * 0.06, w * 0.12, h * 0.12);
  };
  ART.generator = function (ctx, def, w, h) {
    box(ctx, 0.04, 0.04, w - 0.08, h - 0.08, C.metal, C.outline, 0.06);
    ctx.fillStyle = C.metalD;
    ctx.fillRect(0.04, h * 0.24, w - 0.08, h * 0.10);
    ctx.fillRect(0.04, h * 0.62, w - 0.08, h * 0.10);
    ctx.fillStyle = '#33363c';
    ctx.fillRect(w * 0.62, 0.02, w * 0.16, h * 0.30);
    ctx.fillStyle = C.accent;
    bolt(ctx, w * 0.34, h * 0.5, Math.min(w, h) * 0.34);
  };
  function bolt(ctx, cx, cy, s) {
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.10, cy - s * 0.55);
    ctx.lineTo(cx - s * 0.28, cy + s * 0.08);
    ctx.lineTo(cx - s * 0.02, cy + s * 0.08);
    ctx.lineTo(cx - s * 0.12, cy + s * 0.55);
    ctx.lineTo(cx + s * 0.30, cy - s * 0.10);
    ctx.lineTo(cx + s * 0.02, cy - s * 0.10);
    ctx.closePath();
    ctx.fill();
  }
  ART.solar = function (ctx, def, w, h) {
    box(ctx, 0.03, 0.03, w - 0.06, h - 0.06, '#2a3b52', C.outline, 0.06);
    ctx.strokeStyle = '#6fa8d0'; ctx.lineWidth = 0.035;
    var cols = Math.max(2, Math.round(w)), rows = Math.max(2, Math.round(h));
    for (var i = 1; i < cols; i++) { ctx.beginPath(); ctx.moveTo(0.03 + i * (w - 0.06) / cols, 0.03); ctx.lineTo(0.03 + i * (w - 0.06) / cols, h - 0.03); ctx.stroke(); }
    for (var j = 1; j < rows; j++) { ctx.beginPath(); ctx.moveTo(0.03, 0.03 + j * (h - 0.06) / rows); ctx.lineTo(w - 0.03, 0.03 + j * (h - 0.06) / rows); ctx.stroke(); }
    ctx.fillStyle = 'rgba(150,205,240,0.16)';
    ctx.fillRect(0.03, 0.03, w - 0.06, h - 0.06);
  };
  ART.wind = function (ctx, def, w, h) {
    box(ctx, w * 0.40, h * 0.34, w * 0.20, h * 0.60, C.metalL, C.outline, 0.05);
    var cx = w * 0.5, cy = h * 0.42, r = Math.min(w, h) * 0.34;
    ctx.strokeStyle = C.metalD; ctx.lineWidth = Math.min(w, h) * 0.10;
    for (var i = 0; i < 3; i++) {
      var a = i * 2.094 + 0.4;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
    }
    ctx.fillStyle = C.metalL;
    ctx.beginPath(); ctx.arc(cx, cy, Math.min(w, h) * 0.09, 0, 7); ctx.fill();
  };
  ART.geo = function (ctx, def, w, h) {
    ctx.fillStyle = '#4a4238';
    rr(ctx, 0.06, 0.06, w - 0.12, h - 0.12, 0.12); ctx.fill();
    ink(ctx, 0.07); ctx.stroke();
    ctx.fillStyle = C.metalD;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.26, 0, 7); ctx.fill();
    ctx.fillStyle = '#d0642a';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.12, 0, 7); ctx.fill();
    ctx.strokeStyle = C.metalL; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.38, 0, 7); ctx.stroke();
  };
  ART.vanometric = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(120,200,255,0.25)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.45, 0, 7); ctx.fill();
    box(ctx, w * 0.24, h * 0.24, w * 0.52, h * 0.52, '#2f4a63', '#8fd0e0', 0.05);
    ctx.fillStyle = '#8fd0e0';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.14, 0, 7); ctx.fill();
  };

  // ---------------- 温控 ----------------
  ART.cooler = function (ctx, def, w, h) {
    box(ctx, 0.08, 0.06, w - 0.16, h - 0.12, C.metal, C.outline, 0.05);
    ctx.strokeStyle = C.metalL; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.22, 0.6, 0.6 + 4.2); ctx.stroke();
    ctx.fillStyle = '#7ec8e8';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.07, 0, 7); ctx.fill();
  };
  ART.heater = function (ctx, def, w, h) {
    box(ctx, 0.08, 0.06, w - 0.16, h - 0.12, C.metalD, C.outline, 0.05);
    ctx.strokeStyle = '#e07a3c'; ctx.lineWidth = 0.05;
    for (var i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.moveTo(w * (0.26 + i * 0.24), h * 0.24);
      ctx.lineTo(w * (0.26 + i * 0.24), h * 0.76);
      ctx.stroke();
    }
  };
  ART.vent = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.10, w - 0.12, h - 0.20, '#4a5058', C.outline, 0.05);
    ctx.strokeStyle = C.metalL; ctx.lineWidth = 0.045;
    for (var i = 1; i < 4; i++) { ctx.beginPath(); ctx.moveTo(0.10, 0.10 + i * (h - 0.20) / 4); ctx.lineTo(w - 0.10, 0.10 + i * (h - 0.20) / 4); ctx.stroke(); }
  };
  ART.campfire = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(255,150,60,0.30)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, 0.45, 0, 7); ctx.fill();
    ctx.strokeStyle = C.woodD; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.moveTo(w * 0.24, h * 0.72); ctx.lineTo(w * 0.76, h * 0.38); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.76, h * 0.72); ctx.lineTo(w * 0.24, h * 0.38); ctx.stroke();
    ctx.fillStyle = '#ff9a3c';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.5, 0.16, 0, 7); ctx.fill();
  };

  // ---------------- 防御 ----------------
  ART.turret = function (ctx, def, w, h) {
    ctx.fillStyle = '#3f4650';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.42, 0, 7); ctx.fill();
    ink(ctx, 0.06); ctx.stroke();
    ctx.fillStyle = C.metal;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.28, 0, 7); ctx.fill();
    ctx.fillStyle = C.metalD;
    ctx.fillRect(w * 0.5 - Math.min(w, h) * 0.06, h * 0.5 - Math.min(w, h) * 0.55, Math.min(w, h) * 0.12, Math.min(w, h) * 0.5);
  };
  ART.mortar = function (ctx, def, w, h) {
    ctx.fillStyle = '#3f4650';
    rr(ctx, 0.08, 0.08, w - 0.16, h - 0.16, 0.1); ctx.fill();
    ink(ctx, 0.06); ctx.stroke();
    ctx.strokeStyle = C.metalL; ctx.lineWidth = Math.min(w, h) * 0.14;
    ctx.beginPath(); ctx.moveTo(w * 0.30, h * 0.74); ctx.lineTo(w * 0.70, h * 0.26); ctx.stroke();
  };
  ART.trap = function (ctx, def, w, h) {
    ctx.fillStyle = '#6b5a45'; ctx.fillRect(0.06, 0.06, w - 0.12, h - 0.12);
    ctx.fillStyle = '#c9c2ad';
    for (var i = 0; i < 4; i++)
      for (var j = 0; j < 4; j++) {
        ctx.beginPath();
        ctx.moveTo(0.14 + i * (w - 0.28) / 3, 0.14 + j * (h - 0.28) / 3 + 0.1);
        ctx.lineTo(0.20 + i * (w - 0.28) / 3, 0.14 + j * (h - 0.28) / 3 + 0.1);
        ctx.lineTo(0.17 + i * (w - 0.28) / 3, 0.06 + j * (h - 0.28) / 3 + 0.1);
        ctx.closePath(); ctx.fill();
      }
    ink(ctx, 0.05); ctx.strokeRect(0.06, 0.06, w - 0.12, h - 0.12);
  };

  // ---------------- 杂项 ----------------
  ART.grave = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.04, w - 0.12, h - 0.08, '#5c5850', C.outline, 0.05);
    ctx.fillStyle = C.stone;
    rr(ctx, w * 0.20, h * 0.14, w * 0.60, h * 0.72, 0.10); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(w * 0.36, h * 0.36, w * 0.28, 0.05);
    ctx.fillRect(w * 0.46, h * 0.28, 0.05, h * 0.22);
  };
  ART.sarcophagus = function (ctx, def, w, h) {
    box(ctx, 0.10, 0.10, w - 0.20, h - 0.20, C.stone, C.outline, 0.06);
    ctx.strokeStyle = C.stoneD; ctx.lineWidth = 0.05;
    ctx.strokeRect(w * 0.22, h * 0.20, w * 0.56, h * 0.60);
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.08, 0, 7); ctx.fill();
  };
  ART.horseshoes = function (ctx, def, w, h) {
    ctx.strokeStyle = 'rgba(220,220,200,0.5)'; ctx.lineWidth = 0.04;
    ctx.setLineDash([0.12, 0.1]); ctx.strokeRect(0.12, 0.12, w - 0.24, h - 0.24); ctx.setLineDash([]);
    ctx.strokeStyle = '#b9b2a0'; ctx.lineWidth = 0.09;
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.16, 0.9, 0.9 + 4.5); ctx.stroke();
  };
  ART.altar = function (ctx, def, w, h) {
    box(ctx, 0.12, 0.16, w - 0.24, h - 0.32, C.stoneD, C.outline, 0.05);
    ctx.fillStyle = def._color || C.stone;
    ctx.fillRect(0.12, 0.16, w - 0.24, h * 0.14);
    ctx.fillStyle = C.accent;
    ctx.beginPath(); ctx.arc(w / 2, h * 0.56, Math.min(w, h) * 0.12, 0, 7); ctx.fill();
  };
  ART.pod = function (ctx, def, w, h) {
    ctx.fillStyle = 'rgba(140,140,140,0.12)';
    ctx.beginPath(); ctx.arc(w / 2, h / 2, Math.min(w, h) * 0.46, 0, 7); ctx.fill();
    box(ctx, w * 0.34, h * 0.30, w * 0.32, h * 0.48, C.metalL, C.outline, 0.06);
    ctx.fillStyle = C.metalD;
    ctx.beginPath();
    ctx.moveTo(w * 0.34, h * 0.30); ctx.lineTo(w * 0.5, h * 0.10); ctx.lineTo(w * 0.66, h * 0.30);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#8fd0e0';
    ctx.beginPath(); ctx.arc(w / 2, h * 0.56, Math.min(w, h) * 0.09, 0, 7); ctx.fill();
  };
  ART.generic = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.06, w - 0.12, h - 0.12, '#7a8490', C.outline, 0.06);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0.06, 0.06, w - 0.12, (h - 0.12) * 0.3);
  };

  // ---- 补充画法 ----
  ART.drape = function (ctx, def, w, h) {
    box(ctx, 0.10, 0.06, w - 0.20, h - 0.12, '#8a3f4a', C.outline, 0.05);
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    for (var i = 1; i < 4; i++) ctx.fillRect(0.10 + i * (w - 0.20) / 4 - 0.02, 0.10, 0.04, h - 0.20);
    ctx.fillStyle = C.accent;
    ctx.fillRect(0.10, 0.06, w - 0.20, h * 0.10);
  };
  ART.screen = function (ctx, def, w, h) {
    box(ctx, 0.06, 0.06, w - 0.12, h - 0.12, '#2c3138', C.outline, 0.05);
    ctx.fillStyle = '#6fc4e8';
    ctx.fillRect(0.16, 0.16, w - 0.32, h * 0.52);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fillRect(0.16, 0.16, (w - 0.32) * 0.5, h * 0.20);
    ctx.fillStyle = C.metalD;
    ctx.fillRect(w * 0.42, h * 0.72, w * 0.16, h * 0.20);
  };
  ART.hopper = function (ctx, def, w, h) {
    ctx.fillStyle = C.metalD;
    ctx.beginPath();
    ctx.moveTo(0.10, 0.14); ctx.lineTo(w - 0.10, 0.14);
    ctx.lineTo(w * 0.68, h - 0.14); ctx.lineTo(w * 0.32, h - 0.14);
    ctx.closePath(); ctx.fill();
    ink(ctx, 0.05); ctx.stroke();
    ctx.strokeStyle = C.metalL; ctx.lineWidth = 0.04;
    ctx.beginPath(); ctx.moveTo(0.16, 0.30); ctx.lineTo(w - 0.16, 0.30); ctx.stroke();
  };
  ART.watermill = function (ctx, def, w, h) {
    ctx.fillStyle = '#3f6f8a';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = C.wood; ctx.lineWidth = Math.min(w, h) * 0.10;
    var cx = w / 2, cy = h / 2, r = Math.min(w, h) * 0.34;
    for (var i = 0; i < 6; i++) {
      var a = i * Math.PI / 3;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); ctx.stroke();
    }
    ink(ctx, 0.05); ctx.strokeRect(0.02, 0.02, w - 0.04, h - 0.04);
  };

  // ---------------- 地板 ----------------
  function fillFloor(ctx, x, y, s, color, lw) {
    ctx.fillStyle = color; ctx.fillRect(x, y, s, s);
    ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = lw || 0.02;
    ctx.strokeRect(x + lw / 2, y + lw / 2, s - lw, s - lw);
  }
  var FLOOR_ART = {
    dirt: function (ctx, x, y, s) {
      ctx.fillStyle = '#4a4034'; ctx.fillRect(x, y, s, s);
      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      ctx.fillRect(x + s * 0.2, y + s * 0.3, s * 0.15, s * 0.1);
      ctx.fillRect(x + s * 0.6, y + s * 0.6, s * 0.12, s * 0.12);
    },
    planks: function (ctx, x, y, s) {
      fillFloor(ctx, x, y, s, '#8a6a45', 0.015);
      ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 0.015;
      for (var i = 1; i < 3; i++) { ctx.beginPath(); ctx.moveTo(x, y + i * s / 3); ctx.lineTo(x + s, y + i * s / 3); ctx.stroke(); }
      ctx.beginPath(); ctx.moveTo(x + s * 0.5, y); ctx.lineTo(x + s * 0.5, y + s / 3); ctx.stroke();
    },
    tile: function (ctx, x, y, s) {
      fillFloor(ctx, x, y, s, '#8d8d88', 0.02);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(x + 0.02, y + 0.02, s - 0.04, s - 0.04);
    },
    concrete: function (ctx, x, y, s) {
      fillFloor(ctx, x, y, s, '#9a9a97', 0.02);
      ctx.fillStyle = 'rgba(0,0,0,0.05)';
      ctx.fillRect(x + s * 0.55, y + s * 0.15, s * 0.2, s * 0.2);
    },
    carpet: function (ctx, x, y, s) {
      fillFloor(ctx, x, y, s, '#7a4a52', 0.015);
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      ctx.beginPath(); ctx.arc(x + s / 2, y + s / 2, s * 0.18, 0, 7); ctx.fill();
    },
    water: function (ctx, x, y, s) {
      fillFloor(ctx, x, y, s, '#2f5a7a', 0.015);
      ctx.strokeStyle = 'rgba(180,220,255,0.25)'; ctx.lineWidth = 0.02;
      ctx.beginPath(); ctx.moveTo(x + s * 0.15, y + s * 0.45); ctx.quadraticCurveTo(x + s * 0.4, y + s * 0.3, x + s * 0.7, y + s * 0.5); ctx.stroke();
    },
    // 桥：木地板 + 一道桥墩（矢量兜底；有贴图时用真图）
    bridge: function (ctx, x, y, s) {
      fillFloor(ctx, x, y, s, '#6c4e37', 0.015);
      ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 0.02;
      for (var i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(x, y + i * s / 4); ctx.lineTo(x + s, y + i * s / 4); ctx.stroke();
      }
      ctx.fillStyle = '#4a3626';
      ctx.fillRect(x + s * 0.1, y, s * 0.8, s * 0.26);
    }
  };

  /** 绘制一个建筑（cell 坐标系）；info 可选，用于电缆自动衔接等 */
  function drawBuilding(ctx, def, w, h, info) {
    var fn = ART[def.art] || ART.generic;
    ctx.save();
    fn(ctx, def, w, h, info || {});
    ctx.restore();
  }

  function drawFloor(ctx, floor, x, y, s) {
    var fn = FLOOR_ART[floor.art] || FLOOR_ART.dirt;
    fn(ctx, x, y, s);
  }

  // ================================================================
  //  原版贴图层
  //  清单由 tools/extract_textures.py 生成（js/sprites.js），图片在 img/ 下。
  //  没有清单、或某张图还没加载好时，自动回退到上面的矢量画法。
  // ================================================================
  var SP = null;            // RWSprites 清单
  var imgCache = {};        // 文件名 -> {el, ok}
  var tintCache = {};       // 文件名|颜色 -> canvas
  var spriteOn = true;      // 用户开关（原版贴图 / 矢量）
  var material = 'stone';
  var materialColor = '#8d8d88';
  var onChange = null;      // 贴图加载完成后回调（让画布重绘）
  var imgSource = null;     // 自定义取图方式（浏览器导入游戏贴图时用）

  function sprites() {
    if (SP === null) {
      SP = global.RWSprites || false;
      if (SP) warmUp();
    }
    return SP || null;
  }

  function warmUp() {
    // 预载建筑贴图（最多 400 张），加载完一批就重绘一次
    var n = 0, t = 0;
    for (var id in SP.items) {
      var e = SP.items[id];
      if (n++ > 400) break;
      if (e.kind === 'linked') {
        for (var k in e.sheets) { imgFor(e.sheets[k]); t++; }
      } else {
        for (var s in e.imgs) { imgFor(e.imgs[s]); t++; }
      }
      if (e.ov) { for (var q in e.ov.imgs) { imgFor(e.ov.imgs[q]); t++; } }
    }
    for (var f in SP.floors) { imgFor(SP.floors[f].img); t++; }
    if (global.console) console.log('[sprites] 预载 ' + t + ' 张贴图');
  }

  function imgFor(file) {
    var it = imgCache[file];
    if (it) return it;
    it = imgCache[file] = { el: null, ok: false };
    var im = new global.Image();
    im.onload = function () { it.ok = true; if (onChange) onChange(); };
    im.onerror = function () { it.ok = false; };
    it.el = im;
    if (imgSource) {
      // 贴图来自浏览器里导入的游戏资源（IndexedDB），不是文件路径
      Promise.resolve(imgSource(file)).then(function (url) {
        if (url) im.src = url; else it.ok = false;
      }, function () { it.ok = false; });
    } else {
      im.src = (SP.base || 'img/') + file;
    }
    return it;
  }

  /** 贴图是否存在且已加载好（决定这一帧用贴图还是矢量） */
  function imgReady(file) { var it = imgCache[file]; return !!(it && it.ok && it.el); }

  /** 按材质色染色（RimWorld 的 CutoutComplex 就是把灰度贴图乘上材质色） */
  function tinted(file, color) {
    if (!color) return imgReady(file) ? imgCache[file].el : null;
    var k = file + '|' + color;
    if (tintCache[k]) return tintCache[k];
    if (!imgReady(file)) return null;
    var img = imgCache[file].el;
    var c = document.createElement('canvas');
    c.width = img.naturalWidth || img.width;
    c.height = img.naturalHeight || img.height;
    var cx = c.getContext('2d');
    cx.drawImage(img, 0, 0);
    cx.globalCompositeOperation = 'multiply';
    cx.fillStyle = color;
    cx.fillRect(0, 0, c.width, c.height);
    cx.globalCompositeOperation = 'destination-in';
    cx.drawImage(img, 0, 0);
    tintCache[k] = c;
    return c;
  }

  function normName(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

  // 没有材质表时的兜底：老式的「材质键 → 游戏外观名」
  var FALLBACK_APP = {
    wood: 'Planks', stone: 'Bricks', steel: 'Metal', plasteel: 'Metal',
    uranium: 'Metal', silver: 'Metal', gold: 'Metal'
  };
  /** 材质 → {id, name, color, app}；app 是游戏里的 StuffAppearanceDef 名（决定用哪张图集） */
  function stuffInfoFor(id) {
    if (!id) return null;
    var D = global.RWData;
    if (D && D.stuffById) {
      var s = D.stuffById(id);
      if (s) return s;
    }
    var S = sprites();
    var col = S && S.stuff && S.stuff[id];
    if (!col) return null;
    return { id: id, color: col, app: FALLBACK_APP[id] || '' };
  }

  /** 取一个建筑的贴图条目（按 defName / id / 归一化名字） */
  function entryFor(def) {
    if (!def) return null;
    var S = sprites();
    if (!S) return null;
    if (def._sp !== undefined) return def._sp;
    var key = def.def || def.id;
    var e = S.items[key] || S.items[def.id] || (S.byName && S.items[S.byName[normName(key)]]);
    def._sp = e || null;
    return def._sp;
  }

  function slotOf(rot) {
    var r = ((rot || 0) % 360 + 360) % 360;
    return r === 90 ? 'e' : r === 180 ? 's' : r === 270 ? 'w' : 'n';
  }

  /** 该建筑在某个朝向 + 某个材质下要用的图片（+ 需要的 drawSize 朝向） */
  function computePlan(e, rot, app) {
    // 按材质换图的（Graphic_Appearances：墙 / 栅栏）：挑对应「外观」的那张图集
    if (e.sheets) {
      var f = (app && e.sheets[app]) || e.sheets['Smooth'] || e.sheets['default'] ||
              e.sheets[Object.keys(e.sheets)[0]];
      if (!f) return null;
      if (e.kind === 'linked') return { file: f, ds: e.ds, link: true };
      return { file: f, ds: e.ds.slice() };
    }
    var slot = e.kind === 'multi' ? slotOf(rot) : 'n';
    var file = e.imgs[slot];
    var ds = e.ds.slice();
    if (!file && slot === 'w') file = e.imgs.e;            // 西向缺失时用东向镜像
    if (!file && slot === 's') file = e.imgs.n;
    if (!file) file = e.imgs[Object.keys(e.imgs)[0]];
    if (!file) return null;
    // Graphic_Multi 的东/西向贴图本身就是横过来的，尺寸也要换
    if (e.kind === 'multi' && (slot === 'e' || slot === 'w')) ds = [ds[1], ds[0]];
    return { file: file, ds: ds, mirror: (!e.imgs[slot] && slot === 'w') };
  }

  /** 带缓存（每帧会调用很多次，避免反复分配对象） */
  function planFor(e, rot, app) {
    var k = (rot || 0) + '|' + (app || '') + '|' + material;
    if (e.__plan && e.__plan.k === k) return e.__plan.v;
    var v = computePlan(e, rot, app);
    e.__plan = { k: k, v: v };
    return v;
  }

  /** 这个建筑该染什么色：'stuff' 用当前材质色，固定色直接用，不染返回 null */
  function colorOf(e, si) {
    if (!e.tint) return null;
    if (e.tint !== 'stuff') return e.tint;
    if (si && si.color) return si.color;
    return materialColor;
  }

  /** 这个建筑在某个朝向下要用的绘制偏移（游戏 drawOffsetNorth/…，x 向右、z 向北） */
  function offFor(e, rot) {
    var o = e.off;
    if (!o) return null;
    if (o.length) return o;                       // 老格式：[x, z]
    var slot = slotOf(rot);
    return o[slot] || o.g || null;
  }

  /** 把（可能带朝向的）建筑贴图画到 (x,z) 左上角、占地 fp 的格子里 */
  function drawSpriteAt(ctx, def, rot, x, z, fp, info) {
    var e = entryFor(def);
    if (!e) return false;
    var si = stuffInfoFor(info && info.stuff);
    var app = si ? si.app : '';
    var p = planFor(e, rot, app);
    if (!p) return false;
    var col = colorOf(e, si);
    if (e.kind === 'linked') {
      var img = tinted(p.file, col);
      if (!img) return false;
      drawLinkAtlas(ctx, img, x, z, info, e);
      return true;
    }
    var img2 = tinted(p.file, col);
    if (!img2) return false;
    var ds = p.ds;
    var cx = x + fp[0] / 2, cz = z + fp[1] / 2;
    var of = offFor(e, e.mir ? ((info && info.drot) || 0) : rot);
    var ox = of ? of[0] : 0;
    var oz = of ? -of[1] : 0;   // 游戏 +z 是北（屏幕上方），本编辑器 z 向下

    if (e.mir) {
      // 门：游戏里同一张贴图「正着画一次 + 镜像画一次」拼成完整的一扇门，
      // 而且朝向由邻居决定（只可能是北/东），和存档里存的 rot 无关。
      var dr = ((info && info.drot) || 0) * Math.PI / 180;
      ctx.save();
      ctx.translate(cx + ox, cz + oz);
      ctx.rotate(dr);
      ctx.drawImage(img2, -ds[0] / 2, -ds[1] / 2, ds[0], ds[1]);
      ctx.scale(-1, 1);
      ctx.drawImage(img2, -ds[0] / 2, -ds[1] / 2, ds[0], ds[1]);
      ctx.restore();
    } else if (p.mirror) {
      ctx.save();
      ctx.translate(cx + ox, cz + oz);
      ctx.scale(-1, 1);
      ctx.drawImage(img2, -ds[0] / 2, -ds[1] / 2, ds[0], ds[1]);
      ctx.restore();
    } else {
      ctx.drawImage(img2, cx - ds[0] / 2 + ox, cz - ds[1] / 2 + oz, ds[0], ds[1]);
    }
    // 炮塔的炮身（朝上不动，和游戏一致：炮塔本身不可旋转）
    if (e.ov) {
      var oi = tinted(e.ov.imgs.n, col);
      if (oi) {
        var ocx = x + fp[0] / 2, ocz = z + fp[1] / 2;
        ctx.drawImage(oi, ocx - e.ov.ds[0] / 2, ocz - e.ov.ds[1] / 2, e.ov.ds[0], e.ov.ds[1]);
      }
    }
    return true;
  }

  /** 连接图集：4×4 子图，索引 = 北1 东2 南4 西8（第 0 行在图集底部） */
  var DIAG = [[-1, 1], [-1, -1], [1, -1], [1, 1]];
  function drawLinkAtlas(ctx, img, x, z, info, e) {
    var A = (SP && SP.atlas) || { cols: 4, rows: 4, inset: 0.03125 };
    var W = img.width, H = img.height;
    var cw = W / A.cols, ch = H / A.rows;
    var ix = A.inset * W, iy = A.inset * H;
    var sw = cw - 2 * ix, sh = ch - 2 * iy;
    var mask = (info && info.mask) || 0;
    var col = mask % A.cols, rb = Math.floor(mask / A.cols);
    var row = A.rows - 1 - rb;                       // Unity 的 v=0 在图片底部
    var sx = col * cw + ix, sy = row * ch + iy;
    ctx.drawImage(img, sx, sy, sw, sh, x, z, 1, 1);

    // 墙体转角填充：取子图 UV(0.5,0.6) 那一个像素，拉伸到 0.5×0.5 补角
    if (e && e.link === 'corner') {
      var dm = (info && info.dmask) || 0;
      if (!dm) return;
      var px = sx + sw * 0.5, py = sy + sh * 0.4;
      for (var i = 0; i < 4; i++) {
        if (!(dm & (1 << i))) continue;
        var dx = DIAG[i][0], dz = DIAG[i][1];
        ctx.drawImage(img, px, py, 1, 1,
          x + (dx < 0 ? 0 : 0.5), z + (dz < 0 ? 0 : 0.5), 0.5, 0.5);
      }
    }
  }

  /** 地板贴图（1 格 1 张） */
  function drawFloorSprite(ctx, floor, x, z, s) {
    var S = sprites();
    if (!S || !S.floors) return false;
    var F = S.floors[floor.id];
    if (!F) return false;
    var img = tinted(F.img, F.tint);
    if (!img) return false;
    ctx.drawImage(img, x, z, s, s);
    return true;
  }

  /** 这个建筑这一帧能用贴图吗（图没加载好就先用矢量兜底） */
  function useSprite(def, rot, stuff) {
    if (!spriteOn) return false;
    var e = entryFor(def);
    if (!e) return false;
    var si = stuffInfoFor(stuff);
    var p = planFor(e, rot, si ? si.app : '');
    if (!p || !imgReady(p.file)) return false;
    return true;
  }

  /** 贴图里「不透明内容」的边界（缩略图用，避免留白把家具显示得很小）。
   *  优先用提取脚本写进清单的归一化边界；没有就现测一次（file:// 下可能测不了，那就退化为整图）。 */
  var boxCache = {};
  function contentBox(file) {
    if (boxCache[file] !== undefined) return boxCache[file];
    if (!imgReady(file)) return null;
    var img = imgCache[file].el;
    var W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
    var r = null;
    var pre = sprites() && sprites().boxes && sprites().boxes[file];
    if (pre) {
      r = { x: pre[0] * W, y: pre[1] * H, w: pre[2] * W, h: pre[3] * H, iw: W, ih: H };
    } else {
      var c = document.createElement('canvas');
      c.width = W; c.height = H;
      var cx = c.getContext('2d');
      try {
        cx.drawImage(img, 0, 0);
        var d = cx.getImageData(0, 0, W, H).data;
        var minx = W, miny = H, maxx = -1, maxy = -1;
        for (var y = 0; y < H; y++) {
          for (var x = 0; x < W; x++) {
            if (d[(y * W + x) * 4 + 3] > 24) {
              if (x < minx) minx = x; if (x > maxx) maxx = x;
              if (y < miny) miny = y; if (y > maxy) maxy = y;
            }
          }
        }
        if (maxx >= 0) r = { x: minx, y: miny, w: maxx - minx + 1, h: maxy - miny + 1, iw: W, ih: H };
      } catch (e) { r = null; }
    }
    boxCache[file] = r;
    return r;
  }

  /** 把建筑画到一个独立 canvas 上（用于左侧物品栏缩略图） */
  function renderThumb(canvas, def, px) {
    var dpr = global.devicePixelRatio || 1;
    var size = px || 40;
    canvas.width = size * dpr; canvas.height = size * dpr;
    canvas.style.width = size + 'px'; canvas.style.height = size + 'px';
    var ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);

    var e = entryFor(def);
    // 缩略图用这个建筑「最常用」的那种材质（花岗岩墙 / 钢铁…），和游戏菜单图标一致
    var dStuff = null;
    if (global.RWData && global.RWData.stuffsFor) {
      var list = global.RWData.stuffsFor(def);
      if (list.length) dStuff = list[0].id;
    }
    if (e && useSprite(def, 0, dStuff)) {
      var p = planFor(e, 0, (stuffInfoFor(dStuff) || {}).app || '');
      if (p) {
        var dsx = p.ds[0], dsy = p.ds[1];
        var box = contentBox(p.file);
        var w = dsx, h = dsy;
        // 内容左上角在「本地格坐标」里的位置（drawSpriteAt 会把贴图居中到占地中心）
        var leftC = def.size[0] / 2 - dsx / 2;
        var topC = def.size[1] / 2 - dsy / 2;
        if (box) {
          // 按「实际内容」尺寸缩放到画布，让家具尽量占满
          w = dsx * box.w / box.iw;
          h = dsy * box.h / box.ih;
          leftC += box.x * dsx / box.iw;
          topC += box.y * dsy / box.ih;
        }
        var sc = (size - 4) / Math.max(w, h, 0.001);
        ctx.save();
        ctx.translate((size - w * sc) / 2 - leftC * sc, (size - h * sc) / 2 - topC * sc);
        ctx.scale(sc, sc);
        drawSpriteAt(ctx, def, 0, 0, 0, def.size, { stuff: dStuff });
        ctx.restore();
        return;
      }
    }

    var w2 = def.size[0], h2 = def.size[1];
    // 尽量让长边占满
    var cell = (size - 8) / Math.max(w2, h2);
    var cw = w2 * cell, ch = h2 * cell;
    ctx.translate((size - cw) / 2, (size - ch) / 2);
    ctx.scale(cell, cell);
    ctx.lineJoin = 'round';
    drawBuilding(ctx, def, w2, h2);
  }

  global.RWArt = {
    ART: ART, FLOOR_ART: FLOOR_ART, C: C,
    drawBuilding: drawBuilding, drawFloor: drawFloor, renderThumb: renderThumb,
    // —— 原版贴图层 ——
    hasSprites: function () { return !!sprites() && Object.keys(sprites().items).length > 0; },
    spriteCount: function () { var S = sprites(); return S ? Object.keys(S.items).length : 0; },
    entryFor: entryFor,
    useSprite: useSprite,
    drawSpriteAt: drawSpriteAt,
    drawFloorSprite: drawFloorSprite,
    linkFlagsOf: function (def) { var e = entryFor(def); return e && e.link ? (e.lf || []) : null; },
    linkKindOf: function (def) { var e = entryFor(def); return e && e.link ? e.link : null; },
    isLinked: function (def) { var e = entryFor(def); return !!(e && e.kind === 'linked'); },
    spriteEnabled: function () { return spriteOn; },
    setSpriteEnabled: function (v) { spriteOn = !!v; },
    /** 全局兜底材质（老工程文件里没记材质的建筑用它）；传材质 id，颜色自动查表 */
    setMaterial: function (key) {
      if (key) material = key;
      var si = stuffInfoFor(material);
      if (si && si.color) materialColor = si.color;
      tintCache = {};
    },
    materialKey: function () { return material; },
    stuffInfoFor: stuffInfoFor,
    /** 换一套贴图清单（浏览器导入游戏贴图时用；base 为空表示走自定义取图方式） */
    setSprites: function (manifest, source) {
      SP = manifest || false;
      imgSource = source || null;
      imgCache = {}; tintCache = {}; boxCache = {};
      if (SP) {
        var defs = global.RWData && global.RWData.BUILDINGS;
        if (defs) defs.forEach(function (d) { d._sp = undefined; d.__plan = null; });
        warmUp();     // 重新预载（走自定义取图方式）
      }
    },
    hasCustomSource: function () { return !!imgSource; },
    onImagesLoaded: function (fn) { onChange = fn; },
    clearCache: function () { imgCache = {}; tintCache = {}; boxCache = {}; SP = null; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
