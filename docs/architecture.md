# 代码结构

[← 返回 README](../README.md)

纯前端，无构建步骤、无依赖、无框架。所有脚本按顺序用 `<script src>` 加载，通过 `window.RW*` 这几个全局对象互相通信。

```
rimworld-planner/
├── index.html                  ← 双击这个就能用（界面骨架）
├── css/app.css
├── img/                        ← 可选：由脚本从你本机游戏提取的原版贴图（不进仓库）
├── docs/                       ← 你正在看的文档
├── js/
│   ├── data.js                 建筑数据库（尺寸 / 电力 / 分类）+ 地板 + 计划配色
│   ├── zh-names.js             简中名对照表（兜底用）
│   ├── buildings.generated.js  由脚本生成的「精确数据库」，会自动覆盖上面的内置库
│   ├── sprites.js              由脚本生成的「原版贴图清单」（图片在 img/ 下，不进仓库）
│   ├── vendor/fzstd.js         纯 JS 的 zstd 解压（浏览器内导入游戏贴图用，MIT）
│   ├── gamezip.js              读 Assets.zip + 解 DDS（BC7 走 WebGL2 / BC4 纯 JS）
│   ├── gamedefs.js             在浏览器里解析游戏 Defs（= extract_defs.py 的 JS 版）
│   ├── gameimport.js           导入编排 + IndexedDB 缓存
│   ├── icons.js                贴图渲染（原版贴图优先，缺失时用原创矢量图兜底）
│   ├── engine.js               网格 / 相机 / 编辑 / 撤销 / 渲染
│   ├── site.js                 存档地形 / 山体 / 可建造性（affordance 校验、离屏地形画布）
│   ├── rooms.js                房间角色推导（按游戏 RoomRoleWorker）+ 温控估算模型
│   ├── checks.js               布局校验（重叠·地形·电力·房间·连通·温控）
│   ├── workload.js             可行性 / 工作量 / 工期估算（小人技能·科技·库存）
│   ├── exporters.js            蓝图 .xml / 工程 JSON
│   ├── buildops.js             规划 → 游戏侧 build() 调用（CLI / MCP 落地）
│   ├── io.js                   本地存档 / RimWorld 存档读取（地形网格·小人·科技·库存）
│   └── main.js                 界面装配
└── tools/
    ├── plan.js                 命令行入口（读档 / 校验 / 估算 / build-ops）
    ├── lib/dom.js              极简 XML DOM（Node 里顶替 DOMParser）
    ├── lib/load.js             在 Node 里加载 js/*.js（复用 tests/harness.js）
    ├── extract_defs.py         从本地游戏目录生成精确尺寸表（命令行路线，可选）
    ├── extract_textures.py     从本地游戏目录提取原版贴图（命令行路线，可选）
    ├── build_single.py         打包单文件版
    └── README.md               脚本说明
tests/                          纯逻辑断言测试（node 自带测试运行器，零依赖）
├── harness.js                  在 Node 里加载浏览器端脚本的沙箱
├── geometry.test.js            占地 / 朝向 / 坐标换算
├── blueprint.test.js           蓝图 XML 结构与内容
├── checks.test.js              冲突 / 电力 / 房间 / 可达性
├── rooms.test.js               房间角色自动推导 / 目标温度 / 温控需求
├── site.test.js                地形 / 山体 / 可建造性
├── workload.test.js            材料 / 科技 / 工期估算
├── history.test.js             撤销 / 重做（增量式历史）
├── export-png.test.js          导出 PNG
└── data.test.js                建筑数据库的完整性
```

> `js/buildings.generated.js` 和 `js/sprites.js` 都是 `tools/` 里脚本的产物。
> 前者（尺寸/电力/造价/工时/科技表格，无美术数据）在仓库里；后者只在本机提取过贴图时才有，不进仓库。

## 全局对象

| 对象 | 来源 | 职责 |
| --- | --- | --- |
| `RWData` | `data.js` + `buildings.generated.js` | 建筑定义表（`byId`）、地板、材质表 |
| `RWArt` | `icons.js` + `sprites.js` | 绘制：原版贴图 / 矢量图兜底、连接图集、材质染色 |
| `RW` | `engine.js` | 状态机 + 相机 + 编辑操作 + 撤销栈 + 渲染循环 |
| `RWSite` | `site.js` | 存档地形 / 山体查询、affordance 可建造性、地形离屏画布 |
| `RWRooms` | `rooms.js` | 房间角色自动推导、目标温度读写、温控需求估算 |
| `RWChecks` | `checks.js` | 布局校验（重叠·地形·电力·房间·连通·温控·角色） |
| `RWWork` | `workload.js` | 蓝图材料 / 科技 / 工时 / 工期估算 |
| `RWExport` | `exporters.js` | 蓝图 `.xml` / 工程 JSON 序列化；`blueprintEntries()` 是唯一的坐标换算入口 |
| `RWBuild` | `buildops.js` | 规划 → `build()` 调用（合并矩形、排除锁定、分层排序） |
| `RWIo` | `io.js` | 本地存档、`.rws` 解析（建筑 / 地形 / 小人 / 科技 / 库存） |

## 命令行入口（tools/plan.js）

内核是浏览器端的 IIFE，但 `tests/harness.js` 早就证明它能在一个 `node:vm` 沙箱里跑起来。
`tools/plan.js` 就把这条路做成了正式入口，浏览器里没有的三样东西由 `tools/lib/` 补：

| 缺什么 | 补法 |
| --- | --- |
| `DOMParser` | `tools/lib/dom.js` —— 只实现 `io.js` 用到的 API，迭代式解析，16 MB 存档不爆栈 |
| `Blob.stream()` / `Response` | `tools/lib/load.js` —— 用 `Readable.toWeb()` 喂给 `DecompressionStream`，地形网格才解得开 |
| `atob` / `btoa` | `Buffer` base64 |

**同一份代码，两种脸**：`plan.js` 不重新实现任何业务逻辑，`validate` 直接调 `RWChecks.analyse`，
`build-ops` 直接调 `RWBuild.toBuildOps`。所以「网页里通过」和「命令行通过」不会分叉。

坐标在这条链路上只换算一次：

```
存档 (x,z)  ──io.importFromSave──▶  画布 (z 翻转)  ──exporters.blueprintEntries──▶  游戏 (x,z)
                                          ▲                    │
                                          └──── plan.js apply ──┘  (gameThingToEditor)
```

`plan.js` 对外的输入输出**一律是游戏坐标**，翻转只发生在读写缓存的那一刻。
`tests/buildops.test.js` 会断言「合并矩形之后覆盖的格子 = 蓝图条目」，防止哪天改了合并逻辑漏几格。

## 撤销栈（增量式）

`engine.js` 里的历史**不存整张图的快照**，而是记「这次改了什么」的增量：

```js
{
  bAdd:  [building],                 // 新增的建筑
  bDel:  [building],                 // 删除的建筑（撤销时原样放回，uid 不变）
  bMod:  [{uid, from:{...}, to:{...}}],  // 属性变化（旋转 / 材质 / 位置 / 锁定）
  fMod:  [{k, from, to}],            // 地板
  lfMod: [{k, from, to}],            // 锁定的地板
  pfMod: [{k, from, to}],            // 规划层
  rtMod: [{k, from, to}],            // 房间目标温度（规划参数）
  grid:  {from:{cols,rows}, to:{...}},
  all:   {from: 快照, to: 快照}       // 整体替换（清空 / 导入存档）
}
```

撤销就是把 `to` 换回 `from`，重做再换回去。好处是撤销栈的体积是 **O(改动量)** 而不是
**O(整张图)**：250×250 的基地铺满地板，50 步编辑从 15.5 MB 降到 8.1 KB。

## 单文件版

除了多文件版，还提供了一个**自包含单文件**：

```
rimworld-planner.single.html     ← 双击即用，没有任何外部依赖
```

CSS 和全部 JS 都内联在里面（约 750 KB）。**性能没有差别**：代码总量 ~330 KB，解析是毫秒级，
真正的开销在画布渲染上，两个版本完全一样。实测（jsdom 冷启动）单文件甚至更快一点，
因为不用逐个读取十几个脚本文件。

> 仓库里这份单文件版是**不带贴图清单**构建的（对应地，`js/sprites.js` 也没进仓库），
> 所以它启动时不会去请求任何图片、零 404，直接用矢量图。
> 如果你本地已经提取过贴图（有 `img/` 和 `js/sprites.js`），自己跑一次 `build_single.py`，
> 清单会被内联进去，把 `img/` 放在单文件旁边就能显示原版贴图（`img/` 本身仍然不会被内联）。

**重新生成单文件**（比如你用 `extract_defs.py` 更新了数据库之后）：

```bash
python3 tools/build_single.py
# 或指定输出位置
python3 tools/build_single.py --out ~/rimworld-planner.single.html
```

两个版本可以并存：多文件版方便改代码，单文件版方便拷来拷去。

> 仓库里带了 [GitHub Actions](../.github/workflows/)，每次改到源码就会自动重跑
> `build_single.py` 并把新的单文件版提交回来，所以 `rimworld-planner.single.html` 永远和源码同步。
> 你本地改完源码想立刻生效，自己跑一次上面的命令即可。

## 测试

浏览器端脚本是纯前端 IIFE，没有模块系统，所以测试用一个 `node:vm` 沙箱把它们加载起来
（`tests/harness.js` 补了几个最小 DOM 存根），然后对纯逻辑做断言：

```bash
node --test        # 或 npm test
```

覆盖的是最容易出「游戏里摆歪了」这类隐性 bug 的地方：

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/geometry.test.js` | `footprint()` 旋转占地、`anchorOffset()` 锚点偏移、flipX/flipZ 坐标翻转、存档 → 编辑器 → 蓝图的往返一致性 |
| `tests/blueprint.test.js` | 蓝图 XML 骨架、`ThingDef`/`TerrainDef`/`Stuff`/`Position`/`Rotation` 字段、「只导出新增」 |
| `tests/checks.test.js` | 占地冲突、电力组网与缺口（6 格边界 / 跨分桶的大建筑）、房间识别与可达性、作用范围遮挡 |
| `tests/rooms.test.js` | 房间角色自动推导（卧室/兵营/病房/囚室/厨房/工坊/餐厅…）、目标温度与撤销、温控需求 |
| `tests/site.test.js` | `terrainAffordance` 可建造性、山体需先开采 |
| `tests/workload.test.js` | 材料缺口、科技前置、技能门槛、「能建/有条件/建不了」结论 |
| `tests/history.test.js` | 撤销/重做：建筑、地板、旋转、材质、床的医疗/囚犯开关、网格、导入快照 |
| `tests/export-png.test.js` | PNG 导出的包围盒、尺寸上限、导出后画布状态不被改坏 |
| `tests/data.test.js` | 建筑库完整性：可建造建筑不被误标、房间推导字段、分类不许再是大杂烩、常用建筑必须有造价或工时 |

> 改 `anchorOffset()` 之前请先看 [import-export.md 的「坐标与朝向」](import-export.md#坐标与朝向)，
> 那套偏移在真实存档的 764 个建筑上验证过「冲突 0 格」。
