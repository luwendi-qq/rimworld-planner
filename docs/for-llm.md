# 给模型看的接入说明（CLI）

这份文档写给**要落地的那个模型**，不是写给人类的。人类版见 [README](../README.md)。

场景：某个 AI 正在通过 Mod 的 MCP 玩 RimWorld，动手盖之前应该先用这个工具把布局算一遍。
它不需要浏览器、不需要鼠标，只需要 shell 和一个可写的目录。

---

## 0. 拿到这套东西（先把环境跑通）

把 **`js/` + `tools/`** 拷过去就够了 —— **不需要 `tests/`，不需要 `npm install`，没有第三方依赖。**

```
rimworld-planner/
├── js/                 内核（浏览器端 IIFE，12 个文件，约 520 KB）
├── tools/plan.js       CLI 入口
├── tools/lib/          harness.js / load.js / dom.js（Node 沙箱 + XML 解析）
├── docs/for-llm.md     本文
└── package.json        可选（只为了 npm test）
```

整包约 **584 KB / 18 个文件**。要求 **Node 18+**（要 `DecompressionStream`、`Response`、
`Readable.toWeb`），实测 Node 24。

```bash
node tools/plan.js doctor
```

`doctor` 会一次性回答「装好没有」：

```json
{ "ok": true, "node": "24.14.0", "nodeOk": true,
  "core": { "defs": 260, "missing": [] },
  "generatedDefs": "js/buildings.generated.js",
  "stateWritable": true,
  "saveDirs": [ { "path": "…/RimWorld by Ludeon Studios/Saves", "count": 9,
                  "newest": [ { "name": "xx.rws", "mtime": "…", "mb": 16.4 } ] } ],
  "next": "跑 node tools/plan.js import \"<存档.rws>\" 开始" }
```

`ok: true` 就可以开工。它还会直接把本机存档目录和新存档列出来，省得手动找路径。

> **单文件 HTML 不参与这条链路。** `rimworld-planner.single.html` 是给人双击用的 GUI，
> 里面没有 CLI，也不能被 Node 直接执行。**给 AI 用就发目录，给人类看才发 HTML。**

> `js/buildings.generated.js` 是从作者本机游戏（1.7.4982 + 6 DLC）提取的 def 表。
> 对方版本 / Mod 不同时，缺的 def 会让 `apply` 报「不认识」。补法：
> `python tools/extract_defs.py "<游戏目录>"`。
> 注意网页里的「导入游戏资源」只写浏览器 IndexedDB，**CLI 读不到**，所以 CLI 用户请跑那个 Python 脚本。

---

## 0.1 一句话

```bash
node tools/plan.js import "<存档.rws>"   # 读地形/小人/科技/库存
node tools/plan.js apply  plan.json      # 写上你想盖的东西
node tools/plan.js validate              # error 必须清零
node tools/plan.js build-ops             # 拿到 build() 调用列表
```

`build-ops` 的输出可以直接展开成游戏侧的 `build(...)` 调用，字段一一对应。

---

## 1. 坐标约定（最容易错的地方）

| | 规则 |
| --- | --- |
| `x` | 向右为 +x，和存档、`get_area` 的 x 一致 |
| `z` | **向上为 +z**，和存档、`build(x,z)` 的 z 一致 |
| `rot` | `0`=北 `1`=东 `2`=南 `3`=西 |
| 多格建筑 | 只给 **Position**（游戏里的锚点） |

**关于 Position，别按「左下角」算**：游戏用 `anchorOffset` 从 Position 推出占地，
奇数尺寸时锚点是中心格，偶数尺寸时偏向一侧。所以：
- 从游戏里读到的 Position，**原样填**进 plan.json；
- 自己设计布局时，用 `build-ops` 输出的坐标（它已经算好了），或者只填 1×1 的格子。

这是本项目早期文档写错过的点（写成「左下角」），实测 2×3 的床会整体偏 1 格。

本工具输入输出**全部是游戏坐标**。画布内部那套 z 翻转只发生在读写缓存时，
不会漏到 JSON 里 —— 所以你不用做任何翻转，除非你自己去改了 `.planner/state.rwplan.json`。

**验证方法**：拿一座你已经在游戏里存在的建筑，把它的 `Position` 填进 plan.json，
`build-ops` 出来的坐标应该和游戏里一模一样。第一次接的时候值得花 30 秒做这个测试。

---

## 2. plan.json

```json
{
  "name": "基地 v1",
  "materials": { "Wall": "WoodLog", "Door": "WoodLog", "Bed": "Cloth" },
  "buildings": [
    { "def": "Wall",  "x": 100, "z": 100 },
    { "def": "Door",  "x": 110, "z": 100 },
    { "def": "Bed",   "x": 104, "z": 104, "rot": 1, "stuff": "Cloth" }
  ],
  "floors": { "100,100": "WoodPlankFloor" },
  "roomTemp": [ { "at": [105,105], "c": -10 } ]
}
```

- `def` / `stuff` / 地板名都写**游戏 defName**（`Wall`、`Bed`、`WoodLog`、`WoodPlankFloor`），
  不是中文名、也不是内部 id。不确定就 `node tools/plan.js describe` 查表。
- `materials` 是每个 def 的默认材质，**key 必须是你实际用的 defName**（用 `GrayWall` 就写 `GrayWall`）：
  写成 `Wall` 不会生效，会退回自动选材，导入时会给你一条 warning。
  `buildings[].stuff` 可以逐件覆盖。
  **不写材质时**，`apply` 会自动从库存里挑一个（优先木头/布料，钢留给急用），
  并在输出的 `stuffAssumed` 里告诉你挑了啥 —— 想自己定就写 `materials`，或加 `--no-auto-stuff`。
- `floors` 的 key 是 `"x,z"`（游戏坐标），value 是 TerrainDef。**可以为空**：地板不保温，
  只影响美观 / 清洁 / 移速；冷库、工坊可以不铺，木地板还会烧。
- `roomTemp` 用来规划冷冻库：`at` 是房间里的任意一格，`c` 是目标温度（°C）。
  不写的话所有房间按 21°C 算，**冷冻库会显示「不需要制冷」**。
- **plan.json 必须是标准 JSON**：不能写 `//` 注释、不能有尾逗号。
  工具会宽容读取（并给一条 warning），但别依赖它 —— 别的工具不一定容忍。
- 每次 `apply` 会**先撤掉上一次 apply 的东西再重放**，所以可以反复改同一份 plan.json，
  不会越叠越多。存档里原有的建筑带锁定标记，永远不会被动到。
  也正因如此，**plan.json 只保留当前版本**：不要 `plan-v13.json`、`plan-v14.json` 地堆，
  要留档就复制到别的目录。

---

## 3. 各命令的输出怎么读

### `apply`

```json
{ "ok": true,
  "applied": { "buildings": 43, "floors": 12 },
  "stuffAssumed": { "Wall": "WoodLog", "Bed": "WoodLog" },
  "demolish": [ { "def": "Wall", "x": 249, "z": 8, "rot": 0, "cells": 1 } ],
  "cleared": 1,
  "roomTemp": [ { "at": [33,242], "c": -10, "area": 80 } ] }
```

- `demolish`：新规划压到了**存档里已有的建筑**。这些建筑通常是「已经标了拆除但还没拆完」的，
  游戏里拆完前一直挡着。两条路：先用 `designate Designator_Deconstruct` 把它们拆掉，或者
  加 `--clear` 让规划器直接无视这些格（`cleared` 是实际让路的数量）。
  **不加 `--clear` 时它们仍然算重叠**，`validate` 会报 error。
  `--clear` 只改本地缓存，重新 `import` 会把存档里的事实恢复回来。
- `stuffAssumed`：没写材质时自动选的，不想要就写 `materials` 覆盖。
- `roomTemp`：目标温度实际设到了哪个房间、多少格。

### `validate`

```json
{ "ok": false,
  "counts": { "error": 1, "warn": 2, "approx": 1 },
  "issues": [
    { "kind": "terrain", "level": "error", "msg": "有 12 格地形撑不住蓝图…",
      "n": 12, "cells": [ {"x":104,"z":97} ] }
  ] }
```

- `level: "error"` → **必须先改**，游戏里会放不下。
- `level: "warn"` → 能盖，但会不舒服（贴边、电力缺口、房间不可达）。
- `approx: true` → 近似模型（电力 6 格规则、房间角色、温控），不是游戏精确规则。
- `source: "existing" | "plan" | "mixed"` → 这个问题来自存档原有建筑 / 你的新规划 / 两者都有。
  `edge`（贴边）这类 warn 十有八九是老建筑造成的，`source: "existing"` 的直接忽略。
- `cells` 默认最多 12 个，`n` 是真实数量；需要全部就加 `--limit 1000`。
- `rooms[].targetC` 是**规划**用的目标温度（默认 21）。游戏里不会自动同步：
  制冷机装好后还要在游戏里把目标温度设上，否则等于白装。

### `estimate`

```json
{ "verdict": "partial",
  "materials": { "missing": [ {"def":"Cloth","need":45,"have":0,"short":45} ] },
  "research":  { "done": false, "missing": ["蓄电池"], "days": 0.7 },
  "work":      { "buildDays": 0.1, "totalDays": 0.8 },
  "terrain":   { "rockCells": 0, "blockedCells": 0 } }
```

- `verdict`: `ok`（现在就能盖） / `partial`（缺材料或科技） / `blocked`（地形或技能挡路）。
- `rockCells > 0` 表示要先 `designate` 开采；`blockedCells > 0` 表示要先铺桥 / 垫地基。

### `build-ops`

```json
{ "stats": { "ops": 9, "cells": 43, "lockedSkipped": 395 },
  "prep": {
    "deconstruct": [ { "designator": "Designator_Deconstruct", "def": "Wall", "x": 249, "z": 8 } ],
    "mine": [ { "designator": "Designator_Mine", "fill": "filled",
                "minX": 118, "minZ": 107, "maxX": 120, "maxZ": 109 } ],
    "blocked": null
  },
  "roomTempToSet": { "rooms": [ { "area": 80, "role": "bedroom", "c": -10 } ] },
  "overlaps": { "n": 1, "cells": [ { "x": 30, "z": 247, "defs": ["墙","制冷机"] } ] },
  "ops": [
    { "def": "PowerConduit", "x": 35, "z": 238 },
    { "def": "Wall", "fill": "filled",
      "minX": 28, "minZ": 238, "maxX": 32, "maxZ": 238, "stuff": "WoodLog" },
    { "def": "Bed", "x": 30, "z": 244, "rot": 0, "stuff": "Cloth" }
  ] }
```

- `prep` 是**施工前**要下的指令：
  - `deconstruct` → 先用 `Designator_Deconstruct` 拆掉（不然蓝图放不下）。
  - `mine` → 先用 `Designator_Mine` 挖开（规划盖在山体上时）。已经按矩形合并。
  - `blocked` → 有非山体的坏地形（沼泽/水面），挖不动，要先垫地基/铺桥。
- `roomTempToSet` → 规划的目标温度。游戏里装完制冷机**要自己再设一次**，planner 不会替你设。
- `overlaps` → 墙和制冷机/通风格栅同格，先改 plan 再放。
- 顺序：先 `prep.deconstruct`、再 `prep.mine`、然后 `ops`（地板→电缆→建筑→门）。

> `prep` 需要在缓存里重跑一遍工作量分析，`build-ops` 会慢一点点（实测 0.24 秒 vs 0.15 秒）。
> 只要坐标、不要这些分析就用 `--no-prep`。

- 一面墙 / 一片地板会被合并成矩形，**一次调用顶几十格**。
- 顺序是：地板 → 电缆（要埋在墙下，必须先放）→ 其他建筑 → 门。按顺序放就不会互相挡。
- 默认只导**新规划**；加 `--all` 会连存档里已有的建筑一起导（几乎不会需要）。

飞到你用的游戏侧工具上就是：

| build-ops 字段 | RimMolt `build` 参数 |
| --- | --- |
| `def` | `def` |
| `x` / `z` | `x` / `z` |
| `minX…maxZ` + `fill:"filled"` | `minX` / `minZ` / `maxX` / `maxZ` + `fill:"filled"` |
| `rot` | `rot` |
| `stuff` | `stuff` |

**不要相信 `rejected` 是空的**：矩形放置可能局部失败，失败会带 `failedCells[{x,z,reason}]`。
把失败的格子收集起来，要么改 plan.json 重跑 `validate`，要么单独补放。

另外看 `overlaps`：它列出「同一格既有墙又有贴墙件」的格子。规划器允许这么画
（画起来方便），但游戏里**制冷机 / 通风格栅 / 被动散热器自己就占掉那格墙**，
通常要把那格墙从 plan 里删掉；壁灯 / 壁挂火把才是真的能贴在墙上不占格。出现次数多就先改 plan 再放，
不然会在 `rejected` 里逐格报。

### `render`

```json
{ "cellPerChar": 1, "labels": true, "origin": {"x":0,"z":249},
  "legend": { "#":"新规划·墙", "%":"存档原有·墙", "+":"新规划·门", "&":"存档原有·门",
              "o":"新规划·建筑", "0":"存档原有·建筑", ".":"新规划·地板", ",":"存档原有·地板",
              "~":"水", "^":"山体" },
  "ascii": ["    |         | ...",
            "    0         10 ...",
            "249 ...",
            "248 ..."] }
```

- 左边一列是 **z 坐标**，上面两行是 **x 标尺**；直接用这两条读数，别自己数格子。
- `#%+&o0.,` 分得很清楚：哪些是这次要盖的，哪些是存档里已经有的。
- `origin` 是左上角那格对应的游戏坐标：往右 +x，往下 **-z**。
- 一格代表 `cellPerChar × cellPerChar` 个游戏格（取块内最高优先级的字符）。
- 嫌占地方就 `--no-labels`，只要纯图。

### `project`（把结果交给人类）

```bash
node tools/plan.js project --out 基地v1.rwplan.json
```

输出的是**网页能直接打开的工程文件**（裸 `rwplan`），玩家双击 `rimworld-planner.single.html`
→ 顶栏「打开工程」→ 选这个文件就行：

- **存档里原有的建筑是 `locked`**：网页里淡显 + 左上角锁，一眼能分出「AI 新画的」和「本来就有的」
- 玩家随便改（拖、旋转、换材质、调房间温度、跑校验、套模板）
- 点「导出蓝图」时 **locked 的部分自动排除**，只打包新规划——和 `build-ops` 的口径一致
- 文件里自带地形 / 小人 / 科技 / 库存快照，**玩家不需要原始存档也能打开**

实测：395 个存档建筑 + 41 件新规划 → 290 KB，网页打开后导出蓝图正好 41 件。

> **别把 `.planner/state.rwplan.json` 发给玩家。** 那是 `{meta, project}` 信封，网页打开会**静默变成空图**
> （`loadProject` 读不到 `buildings` 就当 0 件）。`project` 命令写的是裸工程，两者不一样。
>
> 工程里带 `saveInfo.tick`：它标明「这个设计基于哪一版存档」。玩家的存档如果又跑了很久，
> 地形没变但库存/已有建筑可能变了，导入后先看 `validate` 的 `source`。

### `describe`

输出契约本身：坐标规则、plan.json 示例、硬规则、以及**全部建筑表**
（defName / 中文名 / 占地 / 能否旋转 / 是否吃材质 / 电力）。约 16 KB。
开工前读一次就够，不用每次读。

---

## 4. 硬规则（都是真会挡住建造的）

1. **门要留在墙的缺口里**，不要和墙画在同一格。
2. 地图**最外圈 1 格**不可建造（`x=0` / `x=cols-1` / `z=0` / `z=rows-1`）。这是地图边界，**不是**框选区域边界。
   门必须放在**墙线上**：上下或左右至少有一对可通行格；放在墙角（两面墙夹着）= 过不去，校验会报 `door` error。
3. **地形要求由材质决定**：木墙 / 木家具只要 `Light`；石头 / 钢 / 玻璃钢要 `Heavy`。
   `Light` 里的浅水要铺桥、沼泽要垫地基；`water`（深水）什么墙都放不了；`rock` 要先开采。
4. 跨格建筑不能重叠。例外：电缆可埋墙下；壁灯 / 壁挂火把可以贴墙共存；
   制冷机 / 通风格栅 / 被动散热器会**占掉**那格墙（别把墙和它画在同一格）。
5. 房间必须能走进去，否则房间判定、温控、空间评分都不成立。
6. 电力按 6 格连接规则组网：发电 → 电缆/输电设备 → 用电器，**电池要接进同一张网**。
7. 制冷机 / 加热器的台数按 `ceil(面积 × 温差 ÷ 630)` 估。

---

## 5. 和游戏侧配合的正确顺序

```
get_status                          # 确认已载入，记下当前 tick
save_game({ overwrite: true })      # 存档！否则 planner 读的是旧地形/旧库存
plan.js import <Saves/xxx.rws>
                                    # 对比 import 输出的 tick 和 get_status 的 tick
plan.js describe                    # 第一次会话读一遍契约
   ┌──────────────────────────────┐
   │ 写 plan.json（冷冻库写 roomTemp）│
   │ plan.js apply plan.json       │ ← demolish 非空就先拆，或加 --clear
   │ plan.js validate              │ ← error 没清零就回到上面
   │ plan.js estimate              │ ← 缺材料/科技就先别开工
   └──────────────────────────────┘
plan.js build-ops                   # 拿到 ops[]；overlaps 非空先改 plan
                                    # prep.deconstruct / prep.mine 先当 designate 下发
designate Designator_Mine ...       # （或直接用 prep.mine 的矩形）
build(...) × N                      # 按 ops 顺序下发，检查 rejected
screenshot({x,z,w,h,include_ui:false})  # 盖完看一眼（不会动玩家镜头）
set_speed unpause

# 需要玩家自己检查/微调时：
plan.js project --out 基地v1.rwplan.json   # 网页「打开工程」直接打开
```

### 存档新鲜度是个坑

RimMolt 的 `save_game` **默认拒绝覆盖已存在的存档**，同名时会报错而不是静默保存。
如果你忽略了那个错误，planner 读到的就是上一次的旧存档 —— 地形没变但库存、已完成建筑全是旧的，
规划出来的东西可能盖在已经盖好的地方上。

所以：`save_game` 一定要带 `overwrite: true`（或者每次用新名字），并且检查返回。

**用 tick 判断比看时间准**：`import` 会打印存档里的 `tick`（游戏内 tick）。
拿它和 `get_status` 返回的当前 tick 比一下：

- 相等 → 是最新存档，放心规划；
- `import` 的 tick 比游戏小 → 存档是旧的，中间游戏又跑了若干 tick，重新存一次；
- 差得越多，库存和已完成建筑越不可信。

`ageMinutes`（存档文件的写入时间）只是兜底参考。

### planner 不知道、只有游戏知道的事

- 建筑的**交互格 / 工作范围 / 排烟口**（RimMolt `list_architect` 的 `placement`）。
  比如迫击炮要有空袭死角、太阳能板前面不能有高墙。
- 屋顶、已完成的科技在游戏里的真实状态（planner 只按存档快照算）。
- Mod 新增的 def：`plan.js describe` 的表来自内置数据库 + 本机提取的 defs；
  纯 Mod 建筑如果没导入过，`apply` 会报「不认识的建筑」。

这些不冲突，但**规划器和游戏对同一格给出不同结论时，以游戏的 `rejected` 为准**，
然后把那个格子加进 plan.json 的重试列表。

---

## 6. 可以直接粘进系统提示词的一段

```text
在动手盖任何东西之前，先用本地规划器把布局算一遍：
1. save_game({ overwrite: true })，确认成功。
2. node tools/plan.js import "<存档绝对路径>"
   —— 对比输出里的 tick 和 get_status 的 tick，不一致就重新存档再读。
3. 写 plan.json（坐标用游戏坐标，def 用游戏 defName；字段见 node tools/plan.js describe 的输出）。
   冷冻库写 "roomTemp": [{"at":[x,z],"c":-10}]，否则规划器按 21°C 算、不会给你数制冷机。
4. node tools/plan.js apply plan.json && node tools/plan.js validate
   —— 只要还有 level="error" 就改 plan.json 重来，不要带着 error 开工。
   demolish 非空说明压到了旧建筑：先拆，或者加 --clear 让规划器无视那几格。
5. node tools/plan.js estimate —— 材料缺口大或缺关键科技时，先补再盖。
6. node tools/plan.js build-ops，然后按 ops 的顺序逐条调 build()，
   检查每一条返回的 rejected / failedCells，失败的格子记下来重规划。
   输出里的 overlaps 是「墙和制冷机/通风格栅同格」，先改 plan 再放。
7. 玩家想自己看/微调时：node tools/plan.js project --out 基地名.rwplan.json，
   他在网页顶栏「打开工程」就能打开；locked 的是存档原有建筑，导出蓝图时自动排除。
规划器只负责「摆得对不对、够不够料」，游戏里的交互格、工作范围以 list_architect 为准。
```

---

## 7. 排错

| 现象 | 原因 / 处理 |
| --- | --- |
| `还没有读存档` | 先跑 `import`。缓存默认在 `.planner/state.rwplan.json`，可用 `--state` 改 |
| `不认识的建筑：XXX` | def 名写错了（要 defName 不是中文名），或 Mod def 没导入。查 `describe` |
| `地形网格没读出来` | 存档格式不兼容 / 文件不完整；此时地形校验会跳过，别在这个状态下开工 |
| 同一格被放两次 | 门和墙画在同一格了（门要占墙的缺口） |
| `validate` 报 overlap | 多半是存档原有建筑挡着（`source: "mixed"/"existing"`）。先拆，或 `apply --clear` |
| `validate` 报贴边 warning | 看 `source`：`existing` 是存档原有的，不用管 |
| `estimate` 全是「(未选材质)」 | 升级前的输出。现在会自动选，见 `stuffAssumed`；也可以自己写 `materials` |
| 冷冻库显示「不需要制冷」 | 没写 `roomTemp`。默认 21°C 没有温差，自然不需要制冷 |

## 8. 性能参考（本机实测）

| 命令 | 耗时 |
| --- | --- |
| `import`（16 MB 存档 / 250×250） | **约 1.5 秒**（解析 0.3–1 秒，其余是解压地形/山体/屋顶网格） |
| `validate` | 约 0.3 秒 |
| `build-ops` / `render` | 约 0.3 秒 |
| `describe` | 约 0.2 秒（输出 16 KB） |

所以「改一次 plan → 重新 validate」的循环很快，不要为了省时间跳过校验。

---

## 9. 没有 shell 的 AI：网页简报 → plan.json

前面所有命令都要求 AI 能读本地存档（有 shell / 有文件系统）。如果玩家用的是网页版聊天 AI，
它看不到 `.rws`，那就走这条：

```
玩家：网页打开存档
      → 用「简报区域」工具（快捷键 4）拖出要规划的范围
        （和框选分开：不会改动选中；拖完画布上留下青色虚线框，Esc 清除）
      → 顶栏「AI 简报」
        ↓ 得到一个 .brief.md（约 30–40 KB），第一段就写着区域坐标
玩家：把简报整个贴给聊天 AI
        ↓ AI 先问清楚需求，再按第 7 节的格式返回 plan.json
玩家：网页顶栏「导入 AI 规划」选文件，或「粘贴 AI 规划」直接粘（Ctrl+V）
        ↓ 画布立刻出现方案，可以拖/改/跑校验
        ↓ 有 error 会弹窗：点「复制错误信息」，整段发回给 AI 让它改
玩家：导出蓝图（或继续微调）
```

**区域就是玩家框选的那个矩形，不加边距**。没框选时才退回「当前视口」，
导出的提示会写明 `框选 44×37 格（x 100–143，z 107–143）` 这样的信息。
区域边界和地图边界无关；地图最外圈 1 格才不可建造。

### 简报里有什么（精确度契约）

| 内容 | 精度 |
| --- | --- |
| **细区** | **玩家框选的矩形**（没框选才用视口），**逐格**（1 字符 = 1 格），带 x 标尺 / 每行 z 坐标 |
| **地形** | 五类：`heavy`（可承重）/ `light`（木墙可以、石钢墙不行；含沼泽·浅水）/ `water`（深水要桥）/ `rock`（要挖）/ `none` |
| **障碍矩形** | 区域内的 rock/water/light 按「类别 + 地形 def」合并成矩形，x0/z0/x1/z1 含端点，**能直接下笔核对** |
| **计数** | 五类在细区 + 全图各多少格（交叉验证用） |
| **已有建筑** | 图上 `% & 0 ,`，并给出总数 / 细区内数量 / 全图包围盒 |
| **库存** | 精确数量，标明是「玩家区域」还是「全地图」 |
| **科技** | 当前研究（含进度/成本）+ 已完成列表（只算真正做完的，存档里没研究的项目会记 0） |
| **殖民者** | 建造 / 采矿 / 智识等级（估工期用） |
| **建筑表** | 全部可用 def：尺寸、可旋转、吃材质、**地形要求**、电力、造价、科技前置 |
| **规则** | 8 条硬规则（门要留缺口、木墙/石墙地形要求不同、6 格电力…） |
| **摆放注意** | 制冷机朝向、马蹄铁/电视的使用区、象棋桌配椅子、风机风道、工作台交互格… |
| **引导提问** | 8 条需求问题（住几个人、要哪些功能间、预算、科技、防御、位置、温控、占地） |

**区域外只有统计、没有逐格**，并在文首写清楚了。所以如果方案要跨出框选范围，
让玩家重新框一份，不要拿「全图统计」去猜格子。

### 先问清楚，再动手

简报开头就有一节「开工前先问清楚」。如果玩家只说「造个房子」，**不要直接给方案**——
先问完这几类问题（一次问 3–4 条）：

1. 给谁用？几个人、几张床（单/双人）？
2. 要哪些功能间？卧室 / 厨房+冷库 / 工坊 / 研究室 / 餐厅 / 娱乐 / 医务 / 监狱 / 畜栏
3. 预算与材料：木头 / 石头 / 钢各多少，优先用哪种？
4. 科技阶段：电力、自动门、太阳能、空调、机枪塔有没有？
5. 防御强度：围墙 / 沙袋 / 陷阱 / 机枪塔 / 逃生通道？
6. 位置：贴现有基地扩建、靠山、靠水，还是独立新建？
7. 温控：卧室 21°C？冷库 -10°C？要不要无菌？
8. 占地上限、以及有没有不能动的东西（电缆、矿脉、遗迹、树）

拿不准的就按保守值做，并在方案里标「这里假设了 X」。

### 摆放时要注意（planner 不校验）

- 制冷机 / 加热器：`rot` 决定冷端朝向，冷端朝室内；两端的格子都不能堵。制冷机自己就是那格墙。
- 壁灯 / 壁挂火把：真正贴在墙上，不占墙格。
- 马蹄铁 / 电视 / 台球桌：要有使用区（watch area），至少一侧留空；电视要椅子或床朝向它。
- 象棋桌 / 餐桌：要配套座位，座位朝桌子。
- 风力发电机：前后风道不能有建筑、山体或高墙遮挡。
- 太阳能板：不能有屋顶或遮挡。
- 工作台 / 研究台：交互格（通常正面一格）要留空；高级研究台旁要留多分析仪。
- 医疗床：旁边留生命维持仪；床两侧要能走。
- 冷库：制冷机热端朝室外或大空间。
- 地板不是必须的：不保温，只影响美观 / 清洁 / 移速；冷库、工坊可以不铺，木地板还会烧。
- 门：上下或左右要有一对可通行格；墙角放门 = 过不去。

游戏侧的 `list_architect` 会给出每件建筑的 `placement`（交互格、watch area、排烟口、射程），
能查就查。

### 这个模式下 AI 的职责边界

- 只能从简报的建筑表里选 def；写别的 def，导入时会报「不认识」。
- 坐标一律游戏坐标；多格建筑给 Position（中心锚点）。
- 简报是**某一 tick 的快照**：玩家的游戏如果又跑了，库存/已有建筑可能变了。
  导入后网页会跑校验，`error` 就是唯一的裁判。
- 冷冻库记得写 `roomTemp`，否则按 21°C 算，不给你数制冷机。
