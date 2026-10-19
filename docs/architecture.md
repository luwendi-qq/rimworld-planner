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
│   ├── checks.js               布局校验（重叠·地形·电力·房间·连通·温控）
│   ├── workload.js             可行性 / 工作量 / 工期估算（小人技能·科技·库存）
│   ├── exporters.js            蓝图 .xml / 工程 JSON
│   ├── io.js                   本地存档 / RimWorld 存档读取（地形网格·小人·科技·库存）
│   └── main.js                 界面装配
└── tools/
    ├── extract_defs.py         从本地游戏目录生成精确尺寸表（命令行路线，可选）
    ├── extract_textures.py     从本地游戏目录提取原版贴图（命令行路线，可选）
    └── build_single.py         打包单文件版
```

> `js/buildings.generated.js` 和 `js/sprites.js` 都是 `tools/` 里脚本的产物。
> 前者（尺寸/电力表格，无美术数据）在仓库里；后者只在本机提取过贴图时才有，不进仓库。

## 全局对象

| 对象 | 来源 | 职责 |
| --- | --- | --- |
| `RWData` | `data.js` + `buildings.generated.js` | 建筑定义表（`byId`）、地板、材质表 |
| `RWArt` | `icons.js` + `sprites.js` | 绘制：原版贴图 / 矢量图兜底、连接图集、材质染色 |
| `RW` | `engine.js` | 状态机 + 相机 + 编辑操作 + 撤销栈 + 渲染循环 |
| `RWSite` | `site.js` | 存档地形 / 山体查询、affordance 可建造性、地形离屏画布 |
| `RWChecks` | `checks.js` | 六项布局校验（含地形 / 山体） |
| `RWWork` | `workload.js` | 蓝图材料 / 科技 / 工时 / 工期估算 |
| `RWExport` | `exporters.js` | 蓝图 `.xml` / 工程 JSON 序列化 |
| `RWIo` | `io.js` | 本地存档、`.rws` 解析（建筑 / 地形 / 小人 / 科技 / 库存） |

## 单文件版

除了多文件版，还提供了一个**自包含单文件**：

```
rimworld-planner.single.html     ← 双击即用，没有任何外部依赖
```

CSS 和全部 JS 都内联在里面（约 390 KB）。**性能没有差别**：代码总量 ~200 KB，解析是毫秒级，
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

> 仓库里带了 [GitHub Actions](.github/workflows/)，每次改到源码就会自动重跑
> `build_single.py` 并把新的单文件版提交回来，所以 `rimworld-planner.single.html` 永远和源码同步。
> 你本地改完源码想立刻生效，自己跑一次上面的命令即可。
