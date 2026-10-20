'use strict';
/* 临时脚本：看 sprites.js 的结构 */
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'js', 'sprites.js'), 'utf8');

const keys = [];
const re = /"([A-Za-z_0-9]+)":\{/g;
let m;
while ((m = re.exec(src)) !== null) keys.push(m[1]);
console.log('顶层段:', keys.join(', '));

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
for (const k of keys) {
  const o = grab(k);
  console.log(' ', k, '→', o ? Object.keys(o).length : '?', '项');
}
