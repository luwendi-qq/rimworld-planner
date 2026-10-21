'use strict';
/*
 * brief.test.js —— 给没有存档访问权的 AI 的「基地简报」
 *
 * 重点不是排版，是**精确度**：
 *   - 区域裁剪正确（给的是游戏坐标）
 *   - 五类地形的计数加起来等于区域面积
 *   - 障碍矩形覆盖的格子数 = 实际障碍格数（不多不少）
 *   - ASCII 的行数 / 坐标标尺和区域一致
 *   - 新规划与存档原有建筑在图上用不同字符
 */

const test = require('node:test');
const assert = require('node:assert');
const H = require('./harness.js');

const app = H.loadApp();
const RW = app.RW;

function add(defId, x, z, locked, extra) {
  const s = RW.state;
  s.buildings.push(Object.assign({
    uid: s.nextUid++, defId: defId, x: x, z: z, rot: 0,
    color: null, stuff: null, bedMode: null, locked: !!locked
  }, extra || {}));
}

function areaOf(rects, kind) {
  return (rects || []).filter(function (r) { return r.kind === kind; })
    .reduce(function (a, r) { return a + (r.x1 - r.x0 + 1) * (r.z1 - r.z0 + 1); }, 0);
}

test('简报：区域、分类计数、障碍矩形、ASCII 全部对得上', function () {
  H.resetMap(30, 30);
  const s = RW.state;

  // 29 格土壤 + 1 格沼泽（Light）
  H.setTerrain(30, 30, {
    MarshyTerrain: function (x, z) { return x === 3 && z === 4; },
    Soil: function () { return true; }
  });
  // 两块花岗岩
  H.setRocks(30, 30, { '10,10': 'Granite', '10,11': 'Granite' });

  add('wall', 6, 6, true);     // 存档原有
  add('wall', 8, 8, false);    // 新规划
  s.floors['9,9'] = 'wood';

  const b = app.RWBrief.build(s, { rect: [0, 0, 29, 29] });

  assert.deepStrictEqual(H.plain(b.region.rect), [0, 0, 29, 29]);
  assert.strictEqual(b.region.step, 1, '小区域应该逐格');

  const counts = b.terrain.regionCounts;
  const sum = counts.heavy + counts.light + counts.water + counts.rock + counts.none;
  assert.strictEqual(sum, 30 * 30, '五类加起来必须等于区域面积');
  assert.strictEqual(counts.rock, 2);
  assert.strictEqual(counts.light, 1, '沼泽有 Light，应该算 light 而不是 water');
  assert.strictEqual(counts.water, 0);
  assert.strictEqual(counts.heavy, 897);

  assert.strictEqual(areaOf(b.terrain.rects, 'rock'), 2, '岩石矩形不多不少 2 格');
  assert.strictEqual(areaOf(b.terrain.rects, 'light'), 1, 'Light 地形 1 格');
  const lightRect = b.terrain.rects.filter(function (r) { return r.kind === 'light'; })[0];
  assert.strictEqual(lightRect.def, 'MarshyTerrain', '要带地形 def，AI 才知道是沼泽还是浅水');

  // ASCII：2 行标尺 + 30 行
  assert.strictEqual(b.ascii.lines.length, 32);
  const body = b.ascii.lines.slice(2).join('');
  assert.ok(body.indexOf('%') >= 0, '存档原有建筑要用 %');
  assert.ok(body.indexOf('#') >= 0, '新规划建筑要用 #');
  assert.ok(body.indexOf('^') >= 0, '岩石要画出来');
  assert.ok(body.indexOf(':') >= 0, 'Light 地形要画出来');

  assert.strictEqual(b.existing.count, 1);
  assert.strictEqual(b.existing.inRegion, 1);
});

test('简报：大区域自动降采样，但坐标标尺仍对', function () {
  H.resetMap(400, 400);
  const b = app.RWBrief.build(RW.state, { rect: [0, 0, 399, 399], maxWidth: 100 });
  assert.strictEqual(b.region.step, 4);           // ceil(400/100)
  assert.strictEqual(b.ascii.lines.length, 102);  // 2 行标尺 + 100 行
  const body = b.ascii.lines[2];
  assert.ok(/^\s*\d+ /.test(body), '每行要有 z 坐标');
});

test('markdown 里有坐标、规则、建筑表和 plan 格式', function () {
  H.resetMap(30, 30);
  H.setTerrain(30, 30, { Soil: function () { return true; } });
  add('wall', 5, 5, true);
  const b = app.RWBrief.build(RW.state, { rect: [2, 2, 20, 20] });
  const md = app.RWBrief.toMarkdown(b);

  assert.ok(md.indexOf('x 向右为 +x') >= 0);
  assert.ok(md.indexOf('`[' + b.region.rect.join(', ') + ']`') >= 0);
  assert.ok(md.indexOf('## 0. 开工前先问清楚') >= 0, '要先引导提问');
  assert.ok(md.indexOf('## 3. 地形分类（精确）') >= 0);
  assert.ok(md.indexOf('## 6. 建筑表') >= 0);
  assert.ok(md.indexOf('`Wall`') >= 0);
  assert.ok(md.indexOf('## 7. plan.json 格式') >= 0);
  assert.ok(md.indexOf('## 8. 摆放注意') >= 0);
  assert.ok(md.indexOf('## 9. 硬规则') >= 0);
  assert.ok(md.indexOf('roomTemp') >= 0);
  assert.ok(md.indexOf('木墙/木家具只要 light') >= 0, '地形规则要说明材质差异');
  assert.ok(md.indexOf('地图边界') >= 0, '最外圈规则要说明不是框选边界');
  assert.strictEqual(b.questions.length, 8);
  assert.ok(b.placement.length >= 10);

  const W = app.RWData.byId['wall'];
  assert.ok(W, '数据库里要有墙');
  const wp = b.defs.filter(function (d) { return d.def === 'WaterproofConduit'; })[0];
  if (wp) assert.strictEqual(wp.terrain, 'WaterproofConduitable', '建筑表要带地形要求');
});

test('简报：科技只算真正完成的（progress 里没研究的记 0）', function () {
  H.resetMap(30, 30);
  H.setTerrain(30, 30, { Soil: function () { return true; } });
  const s = RW.state;
  s.saveInfo = {
    research: {
      current: 'Electricity',
      progress: {
        Batteries: 400,          // cost 400 → 完成
        ComplexFurniture: 300,   // cost 300 → 完成
        PsychoidBrewing: 0       // 没研究
      }
    },
    pawns: [],
    resources: {}
  };
  const b = app.RWBrief.build(s, { rect: [0, 0, 19, 19] });
  assert.strictEqual(b.research.completed.length, 2);
  assert.strictEqual(b.research.current, 'Electricity');
});
