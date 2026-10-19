#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_single.py —— 把 index.html + css + js 打包成一个自包含的单文件 HTML。

用法：
    python3 tools/build_single.py
    python3 tools/build_single.py --out /path/to/rimworld-planner.single.html

特点：
    * CSS 与所有 JS 内联，双击即可用（file:// 下也没有任何路径/模块限制）
    * js/buildings.generated.js 若存在会被内联；不存在就自动跳过
    * js/sprites.js（原版贴图清单）若存在也会内联。注意它指向的 img/ 贴图**不会**被内联，
      所以要么把 img/ 一起拷走放在 HTML 旁边，要么就享受矢量图兜底。
    * 内联的脚本里出现 "</script" 会被安全转义，避免提前结束脚本块
    * 输出文件自带一行注释标明构建时间与包含的模块，方便核对
"""

import argparse
import os
import re
import sys
from datetime import datetime

# 内联顺序必须与 index.html 中的 <script src> 顺序一致
SCRIPT_ORDER = [
    'js/data.js',
    'js/zh-names.js',
    'js/buildings.generated.js',   # 可选
    'js/sprites.js',               # 可选：原版贴图清单（图片仍在 img/ 下，需一起带走）
    'js/vendor/fzstd.js',          # zstd 解码（浏览器内导入游戏贴图时用）
    'js/gamezip.js',               # zip + DDS 解码
    'js/gamedefs.js',              # 解析游戏 Defs
    'js/gameimport.js',            # 导入编排 + IndexedDB 缓存
    'js/icons.js',
    'js/engine.js',
    'js/checks.js',
    'js/exporters.js',
    'js/io.js',
    'js/main.js',
]


def read(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def safe_inline_js(code):
    """防止脚本内容里的 </script> 提前结束脚本块"""
    return code.replace('</script', '<\\/script')


def build(root, out_path):
    index_path = os.path.join(root, 'index.html')
    if not os.path.isfile(index_path):
        print('找不到 index.html：%s' % index_path, file=sys.stderr)
        return 1
    html = read(index_path)

    # ---- 内联 CSS ----
    def css_repl(m):
        href = m.group(1)
        path = os.path.join(root, href)
        if not os.path.isfile(path):
            print('  ! 缺少样式文件 %s' % href, file=sys.stderr)
            return m.group(0)
        print('  内联 %s (%d 字节)' % (href, os.path.getsize(path)))
        return '<style>\n/* ==== %s ==== */\n%s\n</style>' % (href, read(path))

    html = re.sub(r'<link[^>]*href="([^"]+\.css)"[^>]*>', css_repl, html)

    # ---- 内联 JS（按固定顺序，跳过不存在的可选文件）----
    inline = []
    for rel in SCRIPT_ORDER:
        path = os.path.join(root, rel)
        if not os.path.isfile(path):
            print('  跳过不存在的 %s' % rel)
            continue
        print('  内联 %s (%d 字节)' % (rel, os.path.getsize(path)))
        inline.append('<script>\n/* ==== %s ==== */\n%s\n</script>' % (rel, safe_inline_js(read(path))))

    # 把所有 <script src="js/..."> 标签整体替换掉
    html = re.sub(r'<script[^>]*src="js/[^"]+"[^>]*>\s*</script>\s*', '', html)
    block = '\n'.join(inline)
    stamp = '<!-- 单文件构建：%s  内联模块：%s -->' % (
        datetime.now().strftime('%Y-%m-%d %H:%M'), ', '.join(SCRIPT_ORDER))
    if '</body>' in html:
        html = html.replace('</body>', block + '\n</body>', 1)
    else:
        html += '\n' + block + '\n'
    html = html.replace('</head>', stamp + '\n</head>', 1)

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write(html)
    print('已生成：%s (%d 字节)' % (out_path, os.path.getsize(out_path)))
    return 0


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    default_root = os.path.dirname(here)
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', default=default_root, help='项目根目录（含 index.html）')
    ap.add_argument('--out', default=None, help='输出文件路径')
    args = ap.parse_args()
    out = args.out or os.path.join(args.root, 'rimworld-planner.single.html')
    return build(args.root, out)


if __name__ == '__main__':
    sys.exit(main())
