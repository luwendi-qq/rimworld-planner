'use strict';
/* 临时脚本：对比 sprites.js 的 boxes 段 vs 建筑库 */
const fs = require('fs');
const path = require('path');
const H = require(path.join(__dirname, 'harness.js'));

const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sprites.js'), 'utf8');

function grab(name) {
  const key = '"' + name + '":{';
  const i = src.indexOf(key);
  if (i < 0) return null;
  const j = src.indexOf('{', i + key.length - 1);
  let depth = 0, k = j;
  for (; k < src.length; k++) {
    const c = src[k];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { k++; break; } }
  }
  return JSON.parse(src.slice(j, k));
}

const app = H.loadApp();
const D = app.RWData;
const have = new Set(Object.keys(D.byId));
Object.keys(D.byId).forEach((id) => { if (D.byId[id].def) have.add(D.byId[id].def); });

for (const sec of ['boxes', 'byName', 'items']) {
  const o = grab(sec);
  if (!o) continue;
  const missing = Object.keys(o).filter((k) => !have.has(k));
  console.log('=== ' + sec + ' (' + Object.keys(o).length + ') 缺 ' + missing.length + ' ===');
  console.log(missing.map((k) => k + (o[k] && o[k].ds ? '(' + o[k].ds.join('x') + ')' : '')).join(' '));
  console.log('');
}
