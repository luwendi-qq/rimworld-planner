# tools —— 脚本说明

这个目录里的脚本都是**可选**的：网页本身双击就能用，不需要跑任何脚本。
它们只是帮你在本机把游戏数据 / 美术资源接进来。

| 脚本 | 作用 | 需要 |
| --- | --- | --- |
| `plan.js` | **命令行规划 / 校验 / 导出**：读存档 → 规划 → 校验 → 生成游戏侧 `build()` 调用。给没有浏览器、只有 shell 的调用方（比如在玩游戏的 AI）用 | Node 18+，无依赖 |
| `build_single.py` | 把 `index.html` + CSS + JS 打包成一个自包含的单文件 HTML | Python 3，无依赖 |
| `extract_defs.py` | 从本机游戏目录读 `Defs`，生成精确的建筑数据库（尺寸 / 耗电 / 造价 / 科技前置） | Python 3，无依赖 |
| `extract_textures.py` | 从本机游戏目录提取原版建筑贴图，生成 `img/` 和 `js/sprites.js` 清单 | Python 3 + `pillow` + `zstandard` |

> ⚠️ **版权提醒**：`extract_textures.py` 的产物（`img/`、`js/sprites.js`）属于 RimWorld 的美术资源，
> **不要提交到仓库、也不要随工具一起分发**（`.gitignore` 已经把它们排除）。
> 脚本只在你自己的电脑上跑，读的是你自己买的游戏。

---

## plan.js —— 命令行规划（给 AI / 自动化用）

```bash
node tools/plan.js doctor                   # 环境自检：Node / 内核 / 存档目录
node tools/plan.js import "Saves/xxx.rws"   # 读存档 → .planner/state.rwplan.json
node tools/plan.js describe                 # 契约：def 表 + 规则 + 示例（约 16 KB）
node tools/plan.js apply plan.json          # 把新规划叠到存档上
node tools/plan.js validate                 # 冲突 / 地形 / 电力 / 房间 / 可达
node tools/plan.js estimate                 # 材料缺口 / 科技缺口 / 工期
node tools/plan.js render --width 100       # ASCII 图（游戏坐标）
node tools/plan.js build-ops                # 直接喂给游戏侧 build() 的调用列表
node tools/plan.js project --out a.rwplan.json   # 网页能直接打开的工程（交给玩家微调）
node tools/plan.js brief --out a.brief.md   # 给没有存档访问权的 AI 的基地简报
node tools/plan.js blueprint --out a.xml    # 传统出口：Blueprints 模组蓝图
```

- 内核和网页是**同一份代码**（`tools/lib/harness.js` 的沙箱 + `js/*.js`），不是另写一套，
  所以「网页里校验通过」和「命令行校验通过」不会分叉。
- 坐标全部是游戏坐标，和存档 / `build(x,z)` / `get_area` 一致。
- `build-ops` 会把同 def / 同材质 / 同朝向的相邻格合并成矩形：43 件家具墙体的屋子 → 9 次调用。
- 缓存写在 `.planner/`，已 gitignore。
- 完整说明（含和 RimMolt 这类游戏侧 MCP 的配合顺序）→ [docs/for-llm.md](../docs/for-llm.md)
- **分发给别人**：只要 `js/` + `tools/`（约 584 KB / 18 个文件，Node 18+，零依赖），
  不需要 `tests/`，也不需要单文件 HTML。对方先跑 `node tools/plan.js doctor` 自检。
  详见 [docs/for-llm.md 的第 0 节](../docs/for-llm.md#0-拿到这套东西先把环境跑通)。

> 浏览器里没有的东西：`tools/lib/dom.js` 是一个极简 XML DOM，顶替 `DOMParser`；
> `tools/lib/load.js` 补 `Blob.stream()` / `Response`，让存档里的地形网格能解压；
> `tools/lib/harness.js` 是和测试共用的 `node:vm` 沙箱。
> 加载器从 `tests/` 挪到了 `tools/lib/`，所以运行时不再依赖测试目录。

---

## build_single.py —— 打包单文件版

```bash
python tools/build_single.py                      # 输出到仓库根目录
python tools/build_single.py --out ~/rw.html      # 输出到别处
```

- 会把 `index.html` 里所有 `<link>` / `<script src>` 换成内联的 `<style>` / `<script>`
- 内联顺序固定在脚本里的 `SCRIPT_ORDER`，**新增 js 文件时要同步改这里**
- 找不到的可选文件（`js/sprites.js` 等）会自动跳过
- 设 `SOURCE_DATE_EPOCH` 环境变量可以做出「相同源码 → 相同产物」的可复现构建
  （GitHub Actions 里就是这么用的，避免每次构建都产生一个假 diff）

GitHub Actions 会在每次改动源码后自动跑它，并把新的单文件版提交回仓库。

---

## extract_defs.py —— 生成精确建筑数据库

```bash
python tools/extract_defs.py                       # 自动探测常见安装路径
python tools/extract_defs.py "/path/to/RimWorld"
python tools/extract_defs.py "/path" --out js/buildings.generated.js
```

它扫描 `Data/` 和各 DLC 目录（Royalty / Ideology / Biotech / Anomaly / Odyssey）下的
`Defs/**/*.xml`，处理 `ParentName` 继承，提取：

- 占地尺寸、电力（耗电 / 发电 / 储电）、美观值、耐久（hp）、占格率（fill）
- 能不能换材质、通行性、是否持顶、建造分类、所属 DLC、是否在建筑师菜单里（menu）
- 房间角色推导字段：`bed`（人床 / 医疗 / 最大体型）、`workRole`、`surfaceEat`、
  `storage`、`sarcophagus`、`throne`、`altar` 等

产物 `js/buildings.generated.js` 会被 `index.html` 自动加载，
**和内置的参考值合并**（精确值覆盖参考值，你没装的 DLC 的条目保留参考值并标 `?`）。

> 网页里也能做同样的事：右侧「导入游戏资源」把游戏目录拖进去就行，
> 效果一样而且不用装 Python。这个脚本是给喜欢命令行的人准备的。

---

## extract_textures.py —— 提取原版贴图

```bash
pip install pillow zstandard
python tools/extract_textures.py
python tools/extract_textures.py "D:\...\RimWorld" --max-px 384 --only-atlas
```

流程：

1. 读 `Data/**/Defs` 里的 `ThingDef` / `TerrainDef` / `StuffDef`，
   拿到每个建筑真实的 `texPath` / `graphicClass` / `drawSize` / `linkType` / `stuffCategories`
2. 从游戏资源里取贴图：新版把贴图打包在 `<游戏目录>/Assets.zip` 和各 DLC 的
   `Data/<DLC>/Assets.zip` 里（BC7 压缩的 DDS，zip 用 zstd）；老版本 / Mod 是散装 PNG
3. 解码、按需缩放 → `<仓库>/img/*.png`，同时生成 `<仓库>/js/sprites.js` 清单

产物留在本地，`.gitignore` 里已经排除了 `/img/` 和 `/js/sprites.js`。

---

## 网页里做同样的事

不想碰命令行的话，**右侧「导入游戏资源」面板**把 RimWorld 安装目录拖进去就行：

- 精确的建筑尺寸 / 耗电 / 造价 / 工时 / 科技前置
- 地形与可建造性、地图自带山体识别
- 原版建筑贴图（只从你本机的游戏读取，不上传）

结果缓存在浏览器的 IndexedDB 里，下次打开直接可用。
第一次可能要几十秒到一两分钟，**别切走标签页**（浏览器会节流后台页面）。
