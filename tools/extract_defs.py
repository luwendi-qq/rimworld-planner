#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
extract_defs.py —— 从本地 RimWorld 安装目录读取 Defs，生成精确的建筑数据库。

用法：
    python3 tools/extract_defs.py                       # 自动探测常见安装路径
    python3 tools/extract_defs.py "/path/to/RimWorld"   # 指定安装目录
    python3 tools/extract_defs.py "/path" --out js/buildings.generated.js

它会扫描 Data/ 以及各 DLC 目录（Royalty / Ideology / Biotech / Anomaly / Odyssey）下的
所有 Defs/**/*.xml，解析 ThingDef，处理 ParentName 继承，提取：
    defName / label / 占地尺寸 / 电力(耗电·发电·储电) / 美观 / 是否可更换材质 /
    通行性 / 是否持顶 / 建造分类 / 所属 DLC

生成的文件会被 index.html 自动加载，从而覆盖内置的参考数据。
本脚本只读取你本机的游戏数据文件用于生成尺寸表，不会复制任何美术资源。
"""

import argparse
import glob
import os
import re
import sys
import tarfile
import xml.etree.ElementTree as ET

DLC_DIRS = ['Royalty', 'Ideology', 'Biotech', 'Anomaly', 'Odyssey']

# 设计分类 → 本工具的类别
CAT_MAP = {
    'structure': 'structure', 'orders': 'structure', 'floors': 'structure',
    'zone': 'structure',
    'furniture': 'furniture', 'joy': 'joy', 'recreation': 'joy',
    'production': 'production', 'power': 'power', 'temperature': 'temperature',
    'security': 'security', 'misc': 'misc', 'ship': 'misc', 'ideology': 'misc',
    'royalty': 'misc', 'biotech': 'misc', 'anomaly': 'misc', 'odyssey': 'misc',
    'medical': 'furniture', 'furniturearchitecture': 'furniture',
}


def strip_ns(tag):
    return tag.split('}', 1)[1] if '}' in tag else tag


def norm(s):
    return re.sub(r'[^a-z0-9]', '', (s or '').lower())


def has_defs(base, depth=3):
    """base 下（若干层内）是否存在 Defs 目录"""
    if not os.path.isdir(base):
        return False
    for cur, dirs, _ in os.walk(base):
        rel = os.path.relpath(cur, base)
        if rel == '.':
            lvl = 0
        else:
            lvl = rel.count(os.sep) + 1
        if lvl > depth:
            dirs[:] = []
            continue
        if 'Defs' in dirs:
            return True
    return False


def find_data_root(root):
    """容忍多种目录结构，返回「包含 Core/ 与各 DLC 的 Data 目录」

    支持：
      <RimWorld>/                      -> <RimWorld>/Data
      <RimWorld>/Data                  -> 自己
      任意只拷贝了 XML 的目录           -> 自己
    """
    cand = os.path.join(root, 'Data')
    if os.path.isdir(cand) and has_defs(cand):
        return cand
    if has_defs(root):
        return root
    # 再往下找一层
    try:
        for name in sorted(os.listdir(root)):
            sub = os.path.join(root, name)
            if os.path.isdir(sub) and (name == 'Data' or has_defs(sub, depth=2)):
                if has_defs(sub):
                    return sub
    except OSError:
        pass
    return None


RE_WITH_TYPE = re.compile(r'^(?:ThingDef|StuffCategoryDef)\.([^.]+)\.(label|labelNoun)$')
# DefInjected/ThingDef/ 目录下的文件省略了类型前缀，标签形如 <Beer.label>
RE_BARE = re.compile(r'^([A-Za-z0-9_]+)\.(label|labelNoun)$')


def _collect_labels(root, labels, nouns, bare=False):
    """从一份 LanguageData XML 里收集建筑名。

    bare=True 表示文件位于 DefInjected/ThingDef/ 下，标签省略了 "ThingDef." 前缀。
    只取「正好一层」的 <名字>.label，跳过 Beer.tools.bottle.label 这类子字段。
    """
    rx = RE_BARE if bare else RE_WITH_TYPE
    for el in root.iter():
        tag = strip_ns(el.tag)
        m = rx.match(tag)
        if not m or not (el.text and el.text.strip()):
            continue
        (labels if m.group(2) == 'label' else nouns)[m.group(1)] = el.text.strip()


def _is_chinese_simplified(name):
    n = re.sub(r'[^a-z]', '', name.lower())
    return n.startswith('chinesesimplified')


def parse_lang_labels(data_root):
    """读取官方简中语言包里的建筑名。

    官方非英文语言有两种存在形式，两种都要认：
      1. 解压好的文件夹：Languages/ChineseSimplified/DefInjected/ThingDef/*.xml
      2. 原版游戏自带的 .tar 包：Languages/ChineseSimplified (简体中文).tar
         （游戏启动时才解包，所以直接翻文件夹是找不到的）
    标签形如 <ThingDef.Wall.label>墙</ThingDef.Wall.label>，优先 label，其次 labelNoun。
    """
    labels, nouns = {}, {}
    tars = 0

    for base, dirs, files in os.walk(data_root):
        low = base.lower()
        in_lang = ('languages' in low) or ('definjected' in low)

        # --- 形式 1：已解包的文件夹 ---
        if in_lang and 'definjected' in low:
            for f in files:
                if not f.lower().endswith('.xml'):
                    continue
                full = os.path.join(base, f).lower().replace('\\', '/')
                bare = 'definjected/thingdef' in full or 'definjected/stuffcategorydef' in full
                if not bare:
                    continue        # 只要 ThingDef / StuffCategoryDef 的，别的 def 类型没用
                try:
                    tree = ET.parse(os.path.join(base, f))
                except (ET.ParseError, OSError):
                    continue
                _collect_labels(tree.getroot(), labels, nouns, bare=True)

        # --- 形式 2：官方 .tar 语言包 ---
        if 'languages' in low:
            for f in files:
                if not f.lower().endswith('.tar'):
                    continue
                if not _is_chinese_simplified(f):
                    continue
                path = os.path.join(base, f)
                try:
                    with tarfile.open(path) as tf:
                        for m in tf.getmembers():
                            if not m.isfile():
                                continue
                            nm = m.name.lower().replace('\\', '/')
                            if not nm.endswith('.xml'):
                                continue
                            if 'definjected/thingdef' not in nm and 'definjected/stuffcategorydef' not in nm:
                                continue
                            fh = tf.extractfile(m)
                            if fh is None:
                                continue
                            try:
                                _collect_labels(ET.fromstring(fh.read()), labels, nouns, bare=True)
                            except ET.ParseError:
                                continue
                    tars += 1
                except (tarfile.TarError, OSError):
                    continue

    out = dict(nouns)
    out.update(labels)   # label 优先
    if tars:
        print('  已从 %d 个官方语言 .tar 包里读取中文名' % tars)
    return out


def parse_defs(data_root):
    """返回 (named, thing_defs, color_defs)"""
    named = {}       # Name 属性 -> element
    thing_defs = []  # 所有 ThingDef
    color_defs = []

    search_roots = []
    dlc_abs = set()
    for d in DLC_DIRS:
        p = os.path.join(data_root, d)
        if os.path.isdir(p):
            dlc_abs.add(os.path.abspath(p))
    search_roots.append(('', data_root))
    for dlc in sorted(dlc_abs):
        search_roots.append((os.path.basename(dlc), dlc))

    seen = set()
    for dlc, base in search_roots:
        for path in glob.glob(os.path.join(base, '**', '*.xml'), recursive=True):
            norm_path = os.path.abspath(path)
            if norm_path in seen:
                continue
            # 核心目录的递归扫描会覆盖到 DLC 子目录，交给 DLC 那轮处理以保留来源标记
            if dlc == '' and any(norm_path.startswith(d + os.sep) for d in dlc_abs):
                continue
            seen.add(norm_path)
            if os.sep + 'Defs' + os.sep not in norm_path + os.sep:
                continue
            try:
                tree = ET.parse(path)
            except ET.ParseError as e:
                print('  ! 跳过无法解析的文件 %s (%s)' % (path, e), file=sys.stderr)
                continue
            for el in tree.getroot().iter():
                tag = strip_ns(el.tag)
                name = el.get('Name')
                if name:
                    named[name] = el
                if tag == 'ThingDef':
                    thing_defs.append((dlc, el))
                elif tag == 'ColorDef':
                    color_defs.append(el)
    return named, thing_defs, color_defs


def child(el, tag):
    for c in el:
        if strip_ns(c.tag) == tag:
            return c
    return None


def text_of(el, tag, default=None):
    c = child(el, tag)
    return c.text.strip() if (c is not None and c.text) else default


def collect_parents(el, named, acc=None, depth=0):
    """沿 ParentName 往上收集（祖父在前）"""
    if acc is None:
        acc = []
    if depth > 12:
        return acc
    pn = el.get('ParentName')
    if pn and pn in named:
        parent = named[pn]
        collect_parents(parent, named, acc, depth + 1)
        acc.append(parent)
    pn2 = el.get('ParentName')
    if pn2 and pn2 not in named:
        # 可能是另一个文件里的 Name，忽略
        pass
    return acc


def resolve(el, named):
    """把继承链摊平成一个 dict：标量字段子覆盖父，list 字段（comps/stuffCategories）父在前"""
    chain = collect_parents(el, named) + [el]
    merged = {'comps': [], 'stuffCategories': [], 'statBases': {}, 'building': {}}
    scalars = ['defName', 'label', 'category', 'designationCategory', 'passability',
               'holdsRoof', 'fillPercent', 'size', 'thingClass', 'terrainAffordanceNeeded',
               'blockPlants', 'blockLight', 'altitudeLayer', 'hasInteractionCell',
               'rotatable', 'specialDisplayRadius', 'buildingSize', 'uiOrder']
    # 先全部置 None，避免调用方 .get() 之外的下标取值踩空
    for s in scalars:
        merged[s] = None
    for node in chain:
        for s in scalars:
            v = text_of(node, s)
            if v is not None:
                merged[s] = v
        st = child(node, 'statBases')
        if st is not None:
            for c in st:
                if c.text:
                    merged['statBases'][strip_ns(c.tag)] = c.text.strip()
        bd = child(node, 'building')
        if bd is not None:
            for c in bd:
                if c.text:
                    merged['building'][strip_ns(c.tag)] = c.text.strip()
        comps = child(node, 'comps')
        if comps is not None:
            # 子节点的 comps 若显式 Inherit=false 则整体替换
            if comps.get('Inherit') == 'false':
                merged['comps'] = []
            for li in comps:
                merged['comps'].append(li)
        sc = child(node, 'stuffCategories')
        if sc is not None:
            if sc.get('Inherit') == 'false':
                merged['stuffCategories'] = []
            for li in sc:
                if li.text:
                    merged['stuffCategories'].append(li.text.strip())
    return merged


def safe_float(v, default=0.0):
    """defs 里的数值偶尔为空/带占位符，容错解析"""
    if v is None:
        return default
    try:
        return float(str(v).strip())
    except (TypeError, ValueError):
        return default


def safe_int(v, default=0):
    return int(safe_float(v, default))


def parse_size(raw):
    """兼容 (1,1) / (1, 1) / 1,1 / 1x1 等写法"""
    if not raw:
        return (1, 1)
    s = str(raw).strip()
    m = re.match(r'^\(?\s*(\d+)\s*[,xX]\s*(\d+)\s*\)?$', s)
    if not m:
        return (1, 1)
    w, h = int(m.group(1)), int(m.group(2))
    if w < 1 or h < 1:
        return (1, 1)
    return (w, h)


def pick_art(def_name, label, tags, cat):
    """按名字猜一个图标画法。规则从「具体」到「笼统」排列，避免误匹配。"""
    n = norm(def_name)
    rules = [
        # 结构
        (r'walllamp|torchwalllamp', 'walllamp'),
        (r'^wall$|slabwall|ship_beam', 'wall'),
        (r'autodoor', 'autodoor'),
        (r'door|flap(?!.*animal)|animalflap', 'door'),
        (r'fencegate', 'fencegate'),
        (r'fence', 'fence'),
        (r'column|pillar', 'column'),
        (r'sandbag', 'sandbag'),
        (r'barricade', 'barricade'),
        (r'barrier', 'barrier'),
        (r'^bridge', 'bridge'),
        # 床类（必须在通用 bed 之前）
        (r'bedroll', 'bedroll'),
        (r'hospitalbed|medicalbed', 'hospbed'),
        (r'crib', 'crib'),
        (r'animalbed', 'animalbed'),
        (r'animalsleepingbox', 'animalbox'),
        (r'bed$|bed(?!roll)', 'bed'),
        (r'sleepingspot$|animalsleepingspot|sleepingspot', 'spot'),
        (r'^spot$', 'spot'),
        # 家具
        (r'stool', 'stool'),
        (r'chair|throne|armchair|couch', 'chair'),
        (r'dresser', 'dresser'),
        (r'shelf|bookcase', 'shelf'),
        (r'plantpot', 'pot'),
        (r'statue|sculpture', 'statue'),
        (r'torch', 'torch'),
        (r'sunlamp', 'sunlamp'),
        (r'lamp|floodlight|glow', 'lamp'),
        (r'brazier|campfire|fire', 'brazier'),
        (r'drape', 'drape'),
        (r'television|tv$', 'screen'),
        # 生产
        (r'butcher', 'butcher'),
        (r'stonecutter', 'bench'),
        (r'sculpt', 'statuebench'),
        (r'tailor|smithy|machining|fabrication|research|drug|crafting|^table', 'bench'),
        (r'stove|cook', 'stove'),
        (r'smelt|cremator|furnace', 'smelter'),
        (r'refiner|refinery|brewery', 'refinery'),
        (r'barrel', 'barrel'),
        (r'dispenser', 'dispenser'),
        (r'hydroponic', 'hydro'),
        (r'deepdrill|drill', 'drill'),
        (r'scanner|analyzer', 'scanner'),
        (r'console|comms', 'console'),
        (r'hopper', 'hopper'),
        # 电力
        (r'conduit|cable|powerline', 'conduit'),
        (r'powerswitch|switch', 'switch'),
        (r'battery', 'battery'),
        (r'solar', 'solar'),
        (r'windturbine|wind', 'wind'),
        (r'watermill', 'watermill'),
        (r'geothermal|^geo', 'geo'),
        (r'generator|reactor|powercell', 'generator'),
        # 温控
        (r'cooler|radiator', 'cooler'),
        (r'heater', 'heater'),
        (r'vent', 'vent'),
        # 防御
        (r'turret|autocannon|foamturret|sniper', 'turret'),
        (r'mortar|rocket|artillery', 'mortar'),
        (r'trap|mine', 'trap'),
        # 杂项
        (r'grave|sarcophag|tomb', 'grave'),
        (r'horseshoe', 'horseshoes'),
        (r'altar|shrine|stele|monolith', 'altar'),
        (r'pod|launcher', 'pod'),
        (r'cryptosleep|vat|gestator|recharger|casket', 'pod'),
        (r'beacon|relay|marker|spot$', 'spot'),
        (r'table', 'table'),
    ]
    for pat, art in rules:
        if re.search(pat, n):
            return art
    return 'generic'


def parse_hex(raw):
    """'(133,97,67)' / '(0.65,0.65,0.35)' → '#856143'"""
    if not raw:
        return None
    nums = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?', str(raw))]
    if len(nums) < 3:
        return None
    if max(nums[:3]) <= 1.0:
        nums = [n * 255.0 for n in nums]
    return '#%02x%02x%02x' % tuple(int(max(0, min(255, round(n)))) for n in nums[:3])


def collect_stuffs(named, thing_defs, lang_labels, data_root):
    """提取全部可用于建筑的材质 (StuffDef) 与材质分类 (StuffCategoryDef)。

    只保留「至少有一种建筑用得上」的材质，并按 def 文件顺序输出（和游戏菜单顺序接近）。
    """
    used = set()
    for dlc, el in thing_defs:
        try:
            m = resolve(el, named)
        except Exception:
            continue
        for c in m['stuffCategories']:
            used.add(c)

    cats, stuffs = [], []
    seen_cat = set()
    for path in glob.glob(os.path.join(data_root, '**', '*.xml'), recursive=True):
        if os.sep + 'Defs' + os.sep not in path + os.sep:
            continue
        try:
            root = ET.parse(path).getroot()
        except (ET.ParseError, OSError):
            continue
        for el in root.iter():
            tag = strip_ns(el.tag)
            if tag == 'StuffCategoryDef':
                dn = text_of(el, 'defName')
                if dn and dn not in seen_cat:
                    seen_cat.add(dn)
                    cats.append({'id': dn, 'name': lang_labels.get(dn) or text_of(el, 'label') or dn})
            elif tag == 'ThingDef':
                chain = collect_parents(el, named) + [el]
                cc, app, color, common = [], None, None, None
                for node in chain:
                    sp = child(node, 'stuffProps')
                    if sp is None:
                        continue
                    box = child(sp, 'categories')
                    if box is not None and len(box):
                        cc = [x.text.strip() for x in box if x.text]
                    v = text_of(sp, 'appearance')
                    if v:
                        app = v
                    v = text_of(sp, 'color')
                    if v:
                        color = v
                    v = text_of(sp, 'commonality')
                    if v:
                        common = v
                if not cc or not (set(cc) & used):
                    continue
                dn = text_of(el, 'defName')
                if not dn:
                    continue
                stuffs.append({
                    'id': dn, 'def': dn,
                    'name': lang_labels.get(dn) or text_of(el, 'label') or dn,
                    'color': parse_hex(color),
                    'cats': cc,
                    'app': app or '',
                    'common': safe_float(common, 0.0),
                })
    return cats, stuffs


def builtin_names():
    """内置条目名 + 别名表里的 defName（归一化），用来判断「是不是本工具关心的建筑」"""
    import json
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, '..', 'js', 'data.js')
    names = set()
    try:
        src = open(path, encoding='utf-8').read()
        for m in re.finditer(r"id:\s*'([^']+)'", src):
            names.add(norm(m.group(1)))
        for m in re.finditer(r"en:\s*'([^']+)'", src):
            names.add(norm(m.group(1)))
        m = re.search(r'var ALIAS = \{(.*?)\n  \};', src, re.S)
        if m:
            for k in re.findall(r"(\w+):\s*'[^']+'", m.group(1)):
                names.add(norm(k))
    except OSError:
        pass
    return names


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('root', nargs='?', help='RimWorld 安装目录（含 Data 子目录）')
    ap.add_argument('--out', default=None, help='输出文件路径')
    ap.add_argument('--include-unbuildable', action='store_true', help='包含非玩家可建造的 ThingDef')
    args = ap.parse_args()

    root = args.root
    if not root:
        candidates = [
            os.path.expanduser('~/.local/share/Steam/steamapps/common/RimWorld'),
            os.path.expanduser('~/.var/app/com.valvesoftware.Steam/.local/share/Steam/steamapps/common/RimWorld'),
            os.path.expanduser('~/Library/Application Support/Steam/steamapps/common/RimWorld'),
            r'C:\Program Files (x86)\Steam\steamapps\common\RimWorld',
            r'C:\Program Files\Steam\steamapps\common\RimWorld',
        ]
        for c in candidates:
            if find_data_root(c):
                root = c
                break
    if not root:
        print('找不到 RimWorld 数据目录。用法：\n'
              '    python3 tools/extract_defs.py "<含 Data 的安装目录，或只拷了 XML 的目录>"',
              file=sys.stderr)
        return 1

    data_root = find_data_root(root)
    if not data_root:
        print('在 "%s" 里没找到任何 Defs 目录。\n'
              '提示：可以直接把 Windows 版的 RimWorld 文件夹（或只把里面的 Data 文件夹）拷过来，'
              '脚本只读取 XML 文本，不需要运行游戏。' % root, file=sys.stderr)
        return 1

    print('数据目录：', data_root)
    named, thing_defs, color_defs = parse_defs(data_root)
    lang_labels = parse_lang_labels(data_root)
    if lang_labels:
        print('  读取到官方简中语言包：%d 条建筑名' % len(lang_labels))
    else:
        print('  未找到官方简中语言包（Languages/ChineseSimplified）；'
              '名字将回退到内置中文对照表 / 英文 label')
    print('  找到 %d 个带 Name 的定义、%d 个 ThingDef' % (len(named), len(thing_defs)))

    out_dir = os.path.dirname(os.path.abspath(args.out or os.path.join(os.path.dirname(__file__), '..', 'js', 'buildings.generated.js')))
    out_path = args.out or os.path.join(out_dir, 'buildings.generated.js')

    entries, seen_ids = [], set()
    builtin_names_set = builtin_names()
    for dlc, el in thing_defs:
        merged = resolve(el, named)
        def_name = merged.get('defName')
        if not def_name or def_name in seen_ids:
            continue
        # 只要建筑类
        cat = merged.get('category', '')
        if cat != 'Building' and not args.include_unbuildable:
            continue
        size = parse_size(merged.get('size'))

        # ---- comps：按类去重，子层级覆盖父层级（和游戏一致）----
        comp_by_class = {}
        for li in merged['comps']:
            comp_by_class[li.get('Class', '')] = li

        power_use = power_gen = power_store = 0
        is_door = False
        has_power_comp = False
        transmits = False
        no_wire = False

        def take_power(consumption):
            """原版用负的 basePowerConsumption 表示发电（太阳能 -1700、风力 -2300）"""
            if consumption < 0:
                return 0, -consumption
            return (consumption, 0)

        for cls, li in comp_by_class.items():
            cons = 0
            # 输电标记：电缆/开关/发电机/电池…（PowerConnectionMaker 靠它决定能不能当「中转站」）
            if (text_of(li, 'transmitsPower') or '').lower() == 'true':
                transmits = True
            if cls.endswith('CompProperties_PowerPlant'):
                has_power_comp = True
                gen = safe_int(text_of(li, 'basePowerGeneration'), 0)
                cons = safe_int(text_of(li, 'basePowerConsumption'), 0)
                power_gen = max(power_gen, gen if gen > 0 else 0)
            elif cls.endswith('CompProperties_Battery'):
                has_power_comp = True
                power_store = max(power_store, safe_int(text_of(li, 'storedEnergyMax'), 0))
                continue
            elif cls.endswith('CompProperties_Power'):
                has_power_comp = True
                cons = safe_int(text_of(li, 'basePowerConsumption'), 0)
            else:
                if cls.endswith('CompProperties_Door'):
                    is_door = True
                continue
            use, gen = take_power(cons)
            power_use = max(power_use, use)
            power_gen = max(power_gen, gen)
            if cls.endswith('CompProperties_Door'):
                is_door = True

        # 原版的门是 ThingClass（Building_Door）而不是组件
        if 'Door' in (merged.get('thingClass') or ''):
            is_door = True
        if (merged['building'].get('allowWireConnection') or '').lower() == 'false':
            no_wire = True

        passability = (merged.get('passability') or 'Walkable')
        holds_roof = (merged.get('holdsRoof') == 'true')
        beauty = safe_float(merged['statBases'].get('Beauty'), 0.0)
        stuff = bool(merged['stuffCategories'])
        fill = safe_float(merged.get('fillPercent'), 1.0)

        design_cat = merged.get('designationCategory')
        # 玩家可建造的建筑一定有 designationCategory（建筑师菜单分类）；
        # 遗迹 / 船骸 / 无法建造的东西没有，默认过滤掉。
        # 例外：本工具内置库里已有的条目（比如雕塑要在雕塑台上做、万用发电机只能任务获得）
        # 也要收进来，否则它们的尺寸永远是人工参考值。
        if not design_cat and not args.include_unbuildable and norm(def_name) not in builtin_names_set:
            continue

        tags = []
        if passability in ('Impassable', 'PassThroughOnly') and not is_door:
            tags.append('solid')
        if is_door:
            tags.append('door')
        if has_power_comp or 'PowerConduit' in def_name:
            tags.append('power')
        if power_gen > 0:
            tags.append('gen')
        if power_store > 0:
            tags.append('store')
        if def_name == 'PowerConduit' or 'conduit' in norm(def_name):
            tags.append('conduit')
            tags.append('under')      # 电缆可以埋在墙里
        if passability == 'Walkable' or passability == 'Standable':
            tags.append('pass')
        if holds_roof:
            tags.append('roof')
        # 房间围合：门，或「不可通行 + 持顶」的实体；再兜底看名字
        if is_door or (holds_roof and passability == 'Impassable') or re.search(r'wall|fence|embrasure', norm(def_name)):
            tags.append('room')
        if 'walllamp' in norm(def_name) or 'cooler' in norm(def_name) or 'vent' in norm(def_name):
            tags.append('onwall')
        if 'lamp' in norm(def_name) or 'torch' in norm(def_name):
            tags.append('light')
        if 'turret' in norm(def_name):
            tags.append('turret')
        if re.search(r'^(bed|doublebed|royalbed|hospitalbed|crib|bedroll)', norm(def_name)):
            tags.append('bed')

        category = CAT_MAP.get(norm(design_cat)) if design_cat else None
        if category is None:
            category = CAT_MAP.get(norm(cat), 'misc')

        entry = {
            'id': def_name,
            'name': lang_labels.get(def_name) or merged.get('label') or def_name,
            'en': def_name,
            'cat': category,
            'size': [size[0], size[1]],
            'art': pick_art(def_name, merged.get('label', ''), tags, category),
            'tags': sorted(set(tags)),
            'def': def_name,
        }
        if round(beauty, 2) != 0:
            entry['beauty'] = round(beauty, 2)
        if power_use:
            entry['powerUse'] = power_use
        if power_gen:
            entry['powerGen'] = power_gen
        if power_store:
            entry['powerStore'] = power_store
        # 输电（电缆/开关/发电机/电池…）：电网连通性靠它判断
        if transmits:
            entry['tx'] = 1
        if no_wire:
            entry['awc'] = 0
        if stuff:
            entry['stuff'] = True
        if merged['stuffCategories']:
            entry['stuffCats'] = merged['stuffCategories']
        # 游戏里 Building_Door 会自己画「正着 + 镜像」两半，并且朝向由邻居决定
        if 'Building_Door' in (merged.get('thingClass') or ''):
            entry['door'] = 1
        # 不可旋转的建筑（发电机/太阳能/地热…）：游戏永远按 Rotation=0 放，导出时不能用朝向换算
        if (merged.get('rotatable') or '').lower() in ('false', '0'):
            entry['rotatable'] = False
        r = safe_float(merged.get('specialDisplayRadius'), 0)
        if r > 0:
            entry['radius'] = r      # 游戏里会画一个圆形作用范围（如太阳灯）
        if dlc:
            entry['dlc'] = dlc
        entries.append(entry)
        seen_ids.add(def_name)

    entries.sort(key=lambda e: (e['cat'], e['name']))

    # 材质表（供界面按分类列出，和游戏一样逐物品选材质）
    stuff_cats, stuffs = collect_stuffs(named, thing_defs, lang_labels, data_root)

    # 计划颜色（ColorDef colorType=Structure）
    colors = []
    for cd in color_defs:
        ct = text_of(cd, 'colorType')
        dn = text_of(cd, 'defName')
        if ct == 'Structure' and dn:
            colors.append(dn)
    colors = sorted(set(colors), key=lambda s: (s != 'Structure_White', s))

    js = []
    js.append('/* 由 tools/extract_defs.py 自动生成，请勿手改。')
    js.append(' * 数据来源：本机 RimWorld 安装目录的 Defs（仅提取尺寸/电力等数值，不含美术资源）。')
    js.append(' * 生成时间：%s' % __import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M:%S'))
    js.append(' * 本次提取到 %d 个建筑，以「合并」方式更新内置库：' % len(entries))
    js.append(' *   - 内置库已有的条目 → 用精确值更新（保留手工挑选的图标）')
    js.append(' *   - 内置库没有的条目 → 追加')
    js.append(' *   - 本次没提取到的条目（例如你未安装的 DLC）→ 保留内置参考值，界面上仍标 ?')
    js.append(' */')
    js.append('(function(g){')
    js.append('  if (!g.RWData) return;')
    js.append('  var r = g.RWData.mergeBuildings(%s);' % to_js(entries))
    js.append('  g.RWData.generated = { at: "%s", extracted: %d, replaced: r.replaced, added: r.added, total: r.total };'
              % (__import__('datetime').datetime.now().strftime('%Y-%m-%d %H:%M'), len(entries)))
    if colors:
        js.append('  g.RWData.PLAN_COLORS = %s;' % to_js([{'id': c, 'name': c.replace('Structure_', ''), 'hex': '#cccccc'} for c in colors]))
    if stuffs:
        js.append('  g.RWData.STUFF_CATS = %s;' % to_js(stuff_cats))
        js.append('  g.RWData.STUFFS = %s;' % to_js(stuffs))
    js.append('  if (g.console) g.console.log("[extract_defs] 精确更新 " + r.replaced + " 条，新增 " + r.added + " 条，共 " + r.total + " 条建筑");')
    js.append('})(typeof window!=="undefined"?window:globalThis);')

    with open(out_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(js) + '\n')

    builtin = builtin_ids()
    hit = sum(1 for e in entries if match_builtin(e, builtin))
    print('已写入：', out_path)
    print('  本次提取 %d 个建筑（其中 %d 个能对上内置库）' % (len(entries), hit))
    print('  没有提取到的内置条目（多为未安装的 DLC / 未识别名字）会保留参考值')
    if colors:
        print('  计划颜色 %d 种' % len(colors))
    if stuffs:
        print('  材质 %d 种（%d 个分类）' % (len(stuffs), len(stuff_cats)))
    print('  用浏览器打开 index.html 即会生效。')
    return 0


def builtin_ids():
    """读取 js/data.js 里的内置条目 id / def / 英文名，用于统计命中情况"""
    import json
    here = os.path.dirname(os.path.abspath(__file__))
    path = os.path.join(here, '..', 'js', 'data.js')
    ids = set()
    try:
        src = open(path, encoding='utf-8').read()
        for m in re.finditer(r"id:\s*'([^']+)'", src):
            ids.add(norm(m.group(1)))
        for m in re.finditer(r"en:\s*'([^']+)'", src):
            ids.add(norm(m.group(1)))
        for m in re.finditer(r"def:\s*'([^']+)'", src):
            ids.add(norm(m.group(1)))
    except OSError:
        pass
    return ids


def match_builtin(entry, builtin):
    return norm(entry['id']) in builtin or norm(entry.get('en', '')) in builtin


def to_js(obj):
    """紧凑的 JSON（JS 字面量兼容）"""
    import json
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))


if __name__ == '__main__':
    sys.exit(main())
