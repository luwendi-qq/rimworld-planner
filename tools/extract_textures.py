#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_textures.py —— 从本地 RimWorld 安装目录提取「原版建筑贴图」，供本工具使用。

用法：
    python3 tools/extract_textures.py                      # 自动探测常见安装路径
    python3 tools/extract_textures.py "D:\\...\\RimWorld"    # 指定安装目录
    python3 tools/extract_textures.py "<游戏目录>" --max-px 384 --only-atlas

流程：
  1. 读取 Data/**/Defs 里的 ThingDef / TerrainDef / StuffDef，拿到每个建筑真实的
     texPath / graphicClass / drawSize / drawOffset / linkType / shaderType / stuffCategories，
     以及炮塔的 turretGunDef（炮身是另一个 def）；
  2. 从游戏资源里取对应贴图。新版 RimWorld 把贴图打包在
     <游戏目录>/Assets.zip 以及各 DLC 的 Data/<DLC>/Assets.zip 里，
     是 BC7 压缩的 DDS，zip 用 zstd 压缩；老版本/Mod 则是散装 PNG/DDS 文件夹；
  3. 解码 + 按需缩放 → <仓库>/img/*.png，并生成 <仓库>/js/sprites.js 清单。

依赖：pip install pillow zstandard

版权：
  本脚本只在你本机运行，把你**自己游戏**里的贴图转成 PNG 供本工具显示。
  产出的 img/ 与 js/sprites.js 都留在你本地，**请勿随工具一起分发**。
"""

import argparse
import datetime
import glob
import io
import json
import os
import re
import struct
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import extract_defs as ED  # 复用：目录探测 / Defs 解析 / 继承 / 工具函数

from PIL import Image

try:
    import zstandard
except ImportError:
    zstandard = None

CORNER, BASIC, TRANSMIT = 'corner', 'basic', 'transmitter'

LINK_KIND = {
    'cornerfiller': CORNER,
    'basic': BASIC,
    'transmitter': TRANSMIT,
    'transmitteroverlay': TRANSMIT,
    'asymmetric': BASIC,        # 栅栏的不对称连接：这里按普通连接近似
}

# 本工具材质键 → 游戏中 StuffAppearanceDef 名的优先顺序
STUFF_APPEARANCE = {
    'wood': ['Planks'],
    'stone': ['Bricks'],
    'steel': ['Metal', 'Smooth'],
    'plasteel': ['Metal', 'Smooth'],
    'uranium': ['Metal', 'Smooth'],
    'silver': ['Metal', 'Smooth'],
    'gold': ['Metal', 'Smooth'],
}
# 游戏 StuffDef → 本工具材质键（用来取真实的材质颜色）
# 注意顺序：同一个材质键取「第一个命中」的颜色。石砖用花岗岩（中性灰）而不是砂岩（偏棕）。
STUFF_DEF_KEY = {
    'WoodLog': 'wood', 'Steel': 'steel', 'Plasteel': 'plasteel',
    'Uranium': 'uranium', 'Silver': 'silver', 'Gold': 'gold',
    'BlocksGranite': 'stone', 'BlocksSandstone': 'stone', 'BlocksLimestone': 'stone',
    'BlocksSlate': 'stone', 'BlocksMarble': 'stone',
}
# 本工具地板 id → (游戏 TerrainDef, 兜底贴图路径)
FLOOR_MAP = {
    'none': ('Soil', 'Terrain/Surfaces/Soil'),
    'wood': ('WoodPlankFloor', 'Terrain/Surfaces/WoodFloor'),
    'stone': ('TileGranite', 'Terrain/Surfaces/TileStone'),
    'tileSandstone': ('TileSandstone', 'Terrain/Surfaces/TileStone'),
    'tileGranite': ('TileGranite', 'Terrain/Surfaces/TileStone'),
    'tileLimestone': ('TileLimestone', 'Terrain/Surfaces/TileStone'),
    'tileSlate': ('TileSlate', 'Terrain/Surfaces/TileStone'),
    'tileMarble': ('TileMarble', 'Terrain/Surfaces/TileStone'),
    'tileAncient': ('AncientTile', 'Terrain/Surfaces/AncientTile'),
    'metalTile': ('MetalTile', 'Terrain/Surfaces/GenericFloorTile'),
    'goldTile': ('GoldTile', 'Terrain/Surfaces/GenericFloorTile'),
    'silverTile': ('SilverTile', 'Terrain/Surfaces/GenericFloorTile'),
    'concrete': ('Concrete', 'Terrain/Surfaces/Concrete'),
    'steel': ('MetalTile', 'Terrain/Surfaces/GenericFloorTile'),
    'sterile': ('SterileTile', 'Terrain/Surfaces/GenericFloorTile'),
    'carpet': ('Carpet', 'Terrain/Surfaces/Carpet'),
    'paved': ('PavedTile', 'Terrain/Surfaces/PavedTile'),
    'water': ('WaterShallow', 'Terrain/Surfaces/WaterShallowRamp'),
    'bridge': ('Bridge', 'Terrain/Surfaces/WoodFloor'),
}

DIR_SLOT = {'north': 'n', 'back': 'n', 'east': 'e', 'side': 'e',
            'south': 's', 'front': 's', 'west': 'w'}
SKIP_TAIL = ('m', 'menuicon', 'blueprint')


# ------------------------------------------------------------------ 贴图来源

class _ZipSource(object):
    def __init__(self, path):
        import zipfile
        self.zf = zipfile.ZipFile(path)
        self.label = path

    def read(self, rel):
        # 本体用 Resources/Textures/ 前缀，DLC 常直接是 Textures/
        return _zip_read(self.zf, 'Resources/Textures/' + rel, 'Textures/' + rel)


class _DirSource(object):
    def __init__(self, path):
        self.dir = path
        self.label = path

    def read(self, rel):
        with open(os.path.join(self.dir, rel.replace('/', os.sep)), 'rb') as f:
            return f.read()


class TextureSource(object):
    """多来源合并：本体 Assets.zip + 各 DLC/Mod 的 Assets.zip + 散装 Textures 文件夹。"""

    def __init__(self, root):
        self.sources = []
        self.rel = []
        self.owner = {}
        self.labels = []

        zips = [os.path.join(root, 'Assets.zip')]
        zips += sorted(glob.glob(os.path.join(root, '**', 'Assets.zip'), recursive=True))
        seen = set()
        for zp in zips:
            zp = os.path.abspath(zp)
            if zp in seen or not os.path.isfile(zp):
                continue
            seen.add(zp)
            try:
                src = _ZipSource(zp)
            except Exception:
                continue
            idx = len(self.sources)
            self.sources.append(src)
            self.labels.append(os.path.relpath(zp, root))
            for n in src.zf.namelist():
                n = n.lstrip('/')
                if n.startswith('Resources/'):
                    n = n[len('Resources/'):]
                if n.startswith('Textures/'):
                    self._add(n[len('Textures/'):], idx)

        dirs = []
        for p in glob.glob(os.path.join(root, '**', 'Textures'), recursive=True):
            if os.path.isdir(p):
                dirs.append(p)
        for cand in (os.path.join(root, 'Textures'),
                     os.path.join(root, 'Data', 'Core', 'Textures')):
            if os.path.isdir(cand):
                dirs.append(cand)
        for tdir in sorted(set(os.path.abspath(d) for d in dirs)):
            src = _DirSource(tdir)
            idx = len(self.sources)
            self.sources.append(src)
            self.labels.append(os.path.relpath(tdir, root))
            for base, _d, files in os.walk(tdir):
                for fn in files:
                    if not fn.lower().endswith(('.dds', '.png', '.psd', '.jpg', '.jpeg', '.tga')):
                        continue
                    rel = os.path.relpath(os.path.join(base, fn), tdir).replace('\\', '/')
                    self._add(rel, idx)

        self.rel = sorted(self.owner)

    def _add(self, rel, idx):
        if rel not in self.owner:
            self.owner[rel] = idx

    def __len__(self):
        return len(self.rel)

    def find(self, tex_path):
        """返回同前缀 / 同子目录下的贴图（含 _north / _Atlas_Smooth / .psd.dds 等）"""
        import bisect
        p = tex_path.replace('\\', '/').strip('/')
        out = []
        lo = bisect.bisect_left(self.rel, p)
        while lo < len(self.rel):
            r = self.rel[lo]
            if not r.startswith(p):
                break
            if len(r) > len(p) and r[len(p)] in '._/':
                out.append(r)
            lo += 1
        return out

    def read(self, rel):
        return self.sources[self.owner[rel]].read(rel)

    def load_image(self, rel):
        im = Image.open(io.BytesIO(self.read(rel)))
        im.load()
        return im.convert('RGBA')


def _zip_read(zf, *candidates):
    """zip 里的贴图有两种前缀（本体 Resources/Textures/，DLC 常是 Textures/）"""
    zi = None
    for name in candidates:
        try:
            zi = zf.getinfo(name)
            break
        except KeyError:
            continue
    if zi is None:
        raise KeyError(candidates[0])
    if zi.compress_type in (0, 8):          # stored / deflate
        return zf.read(zi)
    if zi.compress_type == 93:              # zstd
        if zstandard is None:
            raise RuntimeError('Assets.zip 用了 zstd 压缩，请先：pip install zstandard')
        f = zf.fp
        f.seek(zi.header_offset)
        hdr = f.read(30)
        n, m = struct.unpack('<HH', hdr[26:30])
        f.seek(zi.header_offset + 30 + n + m)
        return zstandard.ZstdDecompressor().decompress(
            f.read(zi.compress_size), max_output_size=zi.file_size)
    raise RuntimeError('不支持的压缩方式 %s：%s' % (zi.compress_type, zi.filename))


def strip_tex_ext(s):
    """去掉贴图扩展名（psd/png/dds…），保留 _north 之类的后缀"""
    s = re.sub(r'\.(psd|png|jpg|jpeg|tga)\.dds$', '', s, flags=re.I)
    s = re.sub(r'\.(dds|png|jpg|jpeg|tga|psd)$', '', s, flags=re.I)
    return s


def classify(paths, base):
    """把一组贴图路径按方向后缀归类。
    返回 {'n':path,'e':path,'s':path,'w':path,'plain':path,'variants':[paths]}"""
    lastseg = base.rsplit('/', 1)[-1]
    out = {'variants': []}
    for p in paths:
        stem = strip_tex_ext(p)
        if stem.startswith(base + '/'):
            rest = stem[len(base) + 1:]
            tail = rest[len(lastseg):] if rest.startswith(lastseg) else rest
        elif stem.startswith(base):
            tail = stem[len(base):]
        else:
            continue
        t = tail.lstrip('_').lower()
        if not t:
            out.setdefault('plain', p)
            continue
        if t in DIR_SLOT:
            out.setdefault(DIR_SLOT[t], p)
            continue
        if t in SKIP_TAIL:
            continue
        out['variants'].append(p)
    return out


# ------------------------------------------------------------------ defs

def child(el, tag):
    for c in el:
        if ED.strip_ns(c.tag) == tag:
            return c
    return None


def children_text(el, tag):
    out = []
    c = child(el, tag)
    if c is not None:
        for li in c:
            if li.text and li.text.strip():
                out.append(li.text.strip())
    return out


def parse_vec3(raw):
    """RimWorld 的 drawOffset 是三维 (x, y高度, z)；只取 x 和 z"""
    if not raw:
        return None
    nums = re.findall(r'-?\d+(?:\.\d+)?', str(raw))
    if len(nums) >= 3:
        return (float(nums[0]), float(nums[2]))
    if len(nums) == 2:
        return (float(nums[0]), float(nums[1]))
    return None


def resolve_graphic(el, named):
    g = {'texPath': None, 'graphicClass': None, 'drawSize': None, 'drawOffset': None,
         'linkType': None, 'shaderType': None, 'color': None, 'drawRotated': None,
         'stuffCategories': [], 'uiIconPath': None, 'category': None, 'linkFlags': [],
         'turretGunDef': None, 'thingClass': None,
         'drawOffsetNorth': None, 'drawOffsetEast': None,
         'drawOffsetSouth': None, 'drawOffsetWest': None}
    for node in ED.collect_parents(el, named) + [el]:
        gd = child(node, 'graphicData')
        if gd is not None:
            for k in ('texPath', 'graphicClass', 'drawSize', 'drawOffset', 'linkType',
                      'shaderType', 'color', 'drawRotated',
                      'drawOffsetNorth', 'drawOffsetEast', 'drawOffsetSouth', 'drawOffsetWest'):
                v = ED.text_of(gd, k)
                if v is not None:
                    g[k] = v
            lf = children_text(gd, 'linkFlags')
            if lf:
                g['linkFlags'] = lf
        bd = child(node, 'building')
        if bd is not None:
            v = ED.text_of(bd, 'turretGunDef')     # 炮塔的「炮身」是另一个 def
            if v is not None:
                g['turretGunDef'] = v
        for k in ('uiIconPath', 'category', 'thingClass'):
            v = ED.text_of(node, k)
            if v is not None:
                g[k] = v
        sc = child(node, 'stuffCategories')
        if sc is not None and len(sc):
            g['stuffCategories'] = [x.text.strip() for x in sc if x.text]
    return g


def parse_graphics(data_root):
    named, thing_defs, _ = ED.parse_defs(data_root)
    out = {}
    for dlc, el in thing_defs:
        dn = ED.text_of(el, 'defName')
        if not dn or dn in out:
            continue
        try:
            out[dn] = resolve_graphic(el, named)
        except Exception:
            continue
    return out


def parse_terrains(data_root):
    """TerrainDef → {texPath, color}，会沿 ParentName 继承贴图"""
    raw = {}
    by_name = {}
    for path in glob.glob(os.path.join(data_root, '**', '*.xml'), recursive=True):
        if os.sep + 'Defs' + os.sep not in path + os.sep:
            continue
        try:
            root = ET.parse(path).getroot()
        except (ET.ParseError, OSError):
            continue
        for el in root.iter():
            if ED.strip_ns(el.tag) != 'TerrainDef':
                continue
            node = {
                'parent': el.get('ParentName'),
                'texPath': ED.text_of(el, 'texturePath') or ED.text_of(el, 'texPath'),
                'color': ED.text_of(el, 'color'),
                'name': el.get('Name'),
                'def': ED.text_of(el, 'defName'),
            }
            if node['name']:
                by_name[node['name']] = node
            if node['def']:
                raw[node['def']] = node

    def resolve_name(nm, depth=0):
        n = by_name.get(nm)
        if not n or depth > 8:
            return {}
        base = resolve_name(n['parent'], depth + 1) if n['parent'] else {}
        out = dict(base)
        for k in ('texPath', 'color'):
            if n.get(k):
                out[k] = n[k]
        return out

    def resolve(dn, depth=0):
        n = raw.get(dn)
        if not n or depth > 8:
            return {}
        base = resolve_name(n['parent'], depth + 1) if n['parent'] else {}
        out = dict(base)
        for k in ('texPath', 'color'):
            if n.get(k):
                out[k] = n[k]
        return out

    return {dn: resolve(dn) for dn in raw}


def parse_stuffs(data_root):
    out = {}
    for path in glob.glob(os.path.join(data_root, '**', '*.xml'), recursive=True):
        if os.sep + 'Defs' + os.sep not in path + os.sep:
            continue
        try:
            root = ET.parse(path).getroot()
        except (ET.ParseError, OSError):
            continue
        for el in root.iter():
            if ED.strip_ns(el.tag) != 'ThingDef':
                continue
            sp = child(el, 'stuffProps')
            dn = ED.text_of(el, 'defName')
            if sp is None or not dn:
                continue
            out[dn] = {'color': ED.text_of(sp, 'color'),
                       'appearance': ED.text_of(sp, 'appearance')}
    return out


# ------------------------------------------------------------------ 工具

def parse_vec(raw, default=(1.0, 1.0)):
    if not raw:
        return default
    nums = re.findall(r'-?\d+(?:\.\d+)?', str(raw))
    if not nums:
        return default
    if len(nums) == 1:
        v = float(nums[0])
        return (v, v)
    return (float(nums[0]), float(nums[1]))


def parse_color(raw):
    if not raw:
        return None
    nums = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', str(raw))]
    if len(nums) < 3:
        return None
    if max(nums[:3]) <= 1.0:
        nums = [n * 255.0 for n in nums]
    return '#%02x%02x%02x' % tuple(int(max(0, min(255, round(n)))) for n in nums[:3])


def is_grayscale(im):
    """判断贴图是不是「灰度待染色」（游戏会把材质色乘上去）"""
    w = min(im.width, 48) or 1
    h = min(im.height, 48) or 1
    small = im.convert('RGB').resize((w, h))
    px = list(small.get_flattened_data()) if hasattr(small, 'get_flattened_data') \
        else list(small.getdata())
    if not px:
        return False
    sat = 0.0
    n = 0
    for p in px:
        r, g, b = p[0], p[1], p[2]
        mx, mn = max(r, g, b), min(r, g, b)
        if mx == 0:
            continue
        sat += (mx - mn) / float(mx)
        n += 1
    return (sat / n if n else 0.0) < 0.15


def alpha_bbox(im, thresh=24):
    """不透明内容的归一化边界（缩略图用，避免贴图留白把家具显示得很小）。
    完全铺满整张图时返回 None（省体积）。"""
    try:
        a = im.getchannel('A').point(lambda v: 255 if v > thresh else 0)
        bb = a.getbbox()
    except Exception:
        return None
    if not bb:
        return None
    w, h = im.size
    x0, y0, x1, y1 = bb
    nx, ny = x0 / float(w), y0 / float(h)
    nw, nh = (x1 - x0) / float(w), (y1 - y0) / float(h)
    if nx < 0.005 and ny < 0.005 and nw > 0.99 and nh > 0.99:
        return None
    return [round(nx, 4), round(ny, 4), round(nw, 4), round(nh, 4)]


def load_planner_data(repo):
    """返回 (idx, alias, known_defs)：内置 id 索引、别名表、已知 defName 集合"""
    src = open(os.path.join(repo, 'js', 'data.js'), encoding='utf-8').read()
    ids = set(re.findall(r"id:\s*'([^']+)'", src))
    ens = set(re.findall(r"en:\s*'([^']+)'", src))
    defs = set(re.findall(r"def:\s*'([^']+)'", src))
    alias = {}
    m = re.search(r'var ALIAS = \{(.*?)\n  \};', src, re.S)
    if m:
        for k, v in re.findall(r"(\w+):\s*'([^']+)'", m.group(1)):
            alias[k] = v
    idx = {}
    for s in ids:
        idx.setdefault(ED.norm(s), s)
    known = set(defs) | ids | ens

    gen = os.path.join(repo, 'js', 'buildings.generated.js')
    if os.path.isfile(gen):
        gsrc = open(gen, encoding='utf-8').read()
        for k in ('def', 'id', 'en'):
            for v in re.findall(r'"%s":"([^"]+)"' % k, gsrc):
                known.add(v)
    return idx, alias, known


# ------------------------------------------------------------------ 主流程

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', help='RimWorld 安装目录（含 Data / Assets.zip）')
    ap.add_argument('--repo', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'),
                    help='本工具仓库目录')
    ap.add_argument('--max-px', type=int, default=512, help='单张贴图最长边上限（默认 512）')
    ap.add_argument('--only-atlas', action='store_true', help='只提取连接图集（墙/栅栏/电缆…）')
    args = ap.parse_args()

    repo = os.path.abspath(args.repo)
    root = args.root
    if not root:
        for c in [r'D:\Program Files (x86)\Steam\steamapps\common\RimWorld',
                  r'C:\Program Files (x86)\Steam\steamapps\common\RimWorld',
                  r'C:\Program Files\Steam\steamapps\common\RimWorld',
                  os.path.expanduser('~/.local/share/Steam/steamapps/common/RimWorld'),
                  os.path.expanduser('~/Library/Application Support/Steam/steamapps/common/RimWorld')]:
            if os.path.isdir(c):
                root = c
                break
    if not root or not os.path.isdir(root):
        print('找不到 RimWorld 安装目录，请显式传入，例如：\n'
              '    python tools/extract_textures.py "D:\\Program Files (x86)\\Steam\\steamapps\\common\\RimWorld"',
              file=sys.stderr)
        return 1

    data_root = ED.find_data_root(root)
    if not data_root:
        print('在 "%s" 里没找到 Defs 目录。' % root, file=sys.stderr)
        return 1

    print('游戏目录：', root)
    tex = TextureSource(root)
    if not len(tex):
        print('没找到贴图。新版 RimWorld 在 Assets.zip / Data/<DLC>/Assets.zip，'
              '老版本在 Data/Core/Textures。', file=sys.stderr)
        return 1
    print('  贴图来源 %d 个：%s（共 %d 个文件）'
          % (len(tex.sources), '、'.join(tex.labels[:6]), len(tex)))

    graphics = parse_graphics(data_root)
    terrains = parse_terrains(data_root)
    stuffs = parse_stuffs(data_root)
    idx, alias, known = load_planner_data(repo)
    known_norm = set(ED.norm(k) for k in known)

    def match_pid(def_name):
        n = ED.norm(def_name)
        return idx.get(n) or alias.get(n)

    print('  ThingDef %d · TerrainDef %d · StuffDef %d · 已知 defName %d'
          % (len(graphics), len(terrains), len(stuffs), len(known_norm)))

    # 材质颜色（用游戏里的真实值）
    stuff_colors = {}
    for sdef, key in STUFF_DEF_KEY.items():
        c = parse_color((stuffs.get(sdef) or {}).get('color'))
        if c and key not in stuff_colors:
            stuff_colors[key] = c
    stuff_colors.setdefault('stone', '#8d8d88')

    img_dir = os.path.join(repo, 'img')
    os.makedirs(img_dir, exist_ok=True)

    written = []
    boxes = {}
    items = {}
    by_name = {}
    verbose_skip = []

    def save(im, name):
        if args.max_px and max(im.size) > args.max_px:
            r = args.max_px / float(max(im.size))
            im = im.resize((max(1, int(round(im.width * r))), max(1, int(round(im.height * r)))),
                           Image.LANCZOS)
        im.save(os.path.join(img_dir, name), 'PNG', optimize=True)
        written.append(name)
        bb = alpha_bbox(im)
        if bb:
            boxes[name] = bb
        return name

    # ---------------- 建筑 ----------------
    for def_name, g in sorted(graphics.items()):
        if ED.norm(def_name) not in known_norm:
            continue
        if (g.get('category') or '') != 'Building':
            continue
        tp = g.get('texPath')
        if not tp:
            continue
        gc = (g.get('graphicClass') or '').split('.')[-1]
        link = LINK_KIND.get(ED.norm(g.get('linkType') or ''))
        if args.only_atlas and not link:
            continue
        files = tex.find(tp)
        if not files:
            verbose_skip.append((def_name, tp, 'no-texture'))
            continue
        got = classify(files, tp)

        ds = parse_vec(g.get('drawSize'), (1.0, 1.0))
        off = parse_vec(g.get('drawOffset'), (0.0, 0.0))
        stuffable = bool(g.get('stuffCategories'))
        fixed = parse_color(g.get('color'))
        tint = fixed or ('stuff' if stuffable else None)

        entry = {'ds': [round(ds[0], 4), round(ds[1], 4)]}
        # 绘制偏移：优先用逐朝向的 drawOffsetNorth/East/South/West（壁灯/壁挂火把靠它贴到墙上）
        offs = {}
        for slot, key in (('n', 'drawOffsetNorth'), ('e', 'drawOffsetEast'),
                          ('s', 'drawOffsetSouth'), ('w', 'drawOffsetWest')):
            v = parse_vec3(g.get(key))
            if v and (abs(v[0]) > 1e-6 or abs(v[1]) > 1e-6):
                offs[slot] = [round(v[0], 4), round(v[1], 4)]
        gv = parse_vec3(g.get('drawOffset'))
        if gv and (abs(gv[0]) > 1e-6 or abs(gv[1]) > 1e-6):
            offs['g'] = [round(gv[0], 4), round(gv[1], 4)]
        if offs:
            entry['off'] = offs
        elif off != (0.0, 0.0):
            entry['off'] = {'g': [round(off[0], 4), round(off[1], 4)]}

        if link:
            sheets = {}
            if gc == 'Graphic_Appearances':
                # 按游戏 StuffAppearanceDef 命名存图：Planks / Bricks / Metal / Smooth
                avail = {}
                for app in ('Planks', 'Bricks', 'Metal', 'Smooth'):
                    hit = tex.find(tp + '/' + tp.rsplit('/', 1)[-1] + '_Atlas_' + app)
                    if hit:
                        avail[app] = hit[0]
                if not avail:
                    verbose_skip.append((def_name, tp, 'appearances-missing'))
                    continue
                any_gray = False
                for app, path in avail.items():
                    im = tex.load_image(path)
                    if is_grayscale(im):
                        any_gray = True
                    sheets[app] = save(im, '%s__%s.png' % (def_name, app))
                if not any_gray:
                    tint = None
            else:
                im = tex.load_image(got.get('plain') or files[0])
                if not is_grayscale(im):
                    tint = None
                sheets['default'] = save(im, '%s__atlas.png' % def_name)
            entry.update({'kind': 'linked', 'link': link, 'sheets': sheets})
            if g.get('linkFlags'):
                entry['lf'] = g['linkFlags']
            if tint:
                entry['tint'] = tint

        elif gc == 'Graphic_Multi':
            imgs = {}
            for slot in ('n', 'e', 's', 'w'):
                if got.get(slot):
                    imgs[slot] = save(tex.load_image(got[slot]), '%s__%s.png' % (def_name, slot))
            if not imgs:
                p = got.get('plain') or (got.get('variants') or files)[0]
                imgs['n'] = save(tex.load_image(p), '%s__n.png' % def_name)
            probe = got.get('n') or got.get('plain') or files[0]
            if tint and not is_grayscale(tex.load_image(probe)):
                tint = None
            entry.update({'kind': 'multi', 'imgs': imgs})

        else:
            # Graphic_Single / Graphic_Random / 其它
            if gc == 'Graphic_Random' and got.get('variants'):
                p = sorted(got['variants'])[0]
            else:
                p = got.get('plain') or (got.get('variants') or files)[0]
            if not p:
                verbose_skip.append((def_name, tp, 'no-plain-file'))
                continue
            im = tex.load_image(p)
            if tint and not is_grayscale(im):
                tint = None
            entry.update({'kind': 'single', 'imgs': {'n': save(im, '%s__n.png' % def_name)}})

        if tint:
            entry['tint'] = tint

        # 门（thingClass=Building_Door）：游戏把同一张贴图「正着 + 镜像」画两次，
        # 而且朝向由左右邻居决定 —— 记个标记，交给运行时处理
        if 'Building_Door' in (g.get('thingClass') or ''):
            entry['mir'] = 1

        # 炮塔：底盘之外还有一层「炮身」（turretGunDef 引用的那个 def 的贴图）
        gun = g.get('turretGunDef')
        if gun:
            gg = graphics.get(gun)
            gtp = gg and gg.get('texPath')
            gfiles = tex.find(gtp) if gtp else []
            if gfiles:
                ggot = classify(gfiles, gtp)
                gp = ggot.get('plain') or (ggot.get('variants') or gfiles)[0]
                gds = parse_vec(gg.get('drawSize'), (1.0, 1.0))
                entry['ov'] = {'ds': [round(gds[0], 4), round(gds[1], 4)],
                               'imgs': {'n': save(tex.load_image(gp), '%s__top.png' % def_name)}}

        items[def_name] = entry
        by_name[ED.norm(def_name)] = def_name
        # 再按「本工具里的条目 id」记一份，方便运行时用 id 反查
        pid = match_pid(def_name)
        if pid:
            by_name[ED.norm(pid)] = def_name

    # ---------------- 地板 ----------------
    floors = {}
    for fid, (terrain, fallback) in FLOOR_MAP.items():
        t = terrains.get(terrain) or {}
        tp = t.get('texPath') or fallback
        files = tex.find(tp)
        if not files:
            continue
        got = classify(files, tp)
        p = got.get('plain') or (got.get('variants') or files)[0]
        im = tex.load_image(p)
        # 桥在 1.7 里是地形（TerrainDef）：地面是木地板，另外叠一层桥墩
        if fid == 'bridge':
            props = tex.find('Terrain/Misc/BridgeProps_Loop')
            if props:
                im = im.copy()
                prop_im = tex.load_image(props[0]).resize(im.size, Image.LANCZOS)
                im.alpha_composite(prop_im)
        fe = {'img': save(im, 'floor__%s.png' % fid)}
        color = parse_color(t.get('color'))
        if color and is_grayscale(im):
            fe['tint'] = color
        floors[fid] = fe

    # ---------------- 输出 sprites.js ----------------
    meta = {
        'base': 'img/',
        'atlas': {'cols': 4, 'rows': 4, 'inset': 0.03125},
        'stuff': stuff_colors,
        'byName': by_name,
        'boxes': boxes,
        'items': items,
        'floors': floors,
    }
    out_js = os.path.join(repo, 'js', 'sprites.js')
    with open(out_js, 'w', encoding='utf-8') as f:
        f.write('/* 由 tools/extract_textures.py 自动生成，请勿手改。\n'
                ' * 内容：从「本机 RimWorld 安装目录」提取的建筑贴图清单（图片在 img/ 下）。\n'
                ' * 这些图片是游戏美术资源，仅供本机使用，**请勿随工具分发**。\n'
                ' * 生成时间：%s\n */\n' % datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
        f.write('(function (g) {\n  g.RWSprites = %s;\n'
                '})(typeof window !== "undefined" ? window : globalThis);\n'
                % json.dumps(meta, ensure_ascii=False, separators=(',', ':')))

    total_kb = sum(os.path.getsize(os.path.join(img_dir, n)) for n in written) / 1024.0
    print('\n完成：建筑 %d · 地板 %d · 贴图 %d 张（约 %.0f KB）'
          % (len(items), len(floors), len(written), total_kb))
    print('  图片 → %s' % img_dir)
    print('  清单 → %s' % out_js)
    if verbose_skip:
        print('  没找到贴图的条目（用矢量兜底）：')
        for dn, tp, why in verbose_skip[:20]:
            print('    %-24s %-46s %s' % (dn, tp, why))
    return 0


if __name__ == '__main__':
    sys.exit(main())
