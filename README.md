# RimWorld 布局规划器（本地离线版）

一个**纯本地、不需要联网、不需要开游戏**的 RimWorld 基地布局规划工具。
用浏览器直接打开 `index.html` 就能用，所有数据都存你自己电脑上。

```
rimworld-planner/
├── index.html                  ← 双击这个就能用
├── css/app.css
├── img/                        ← 可选：由脚本从你本机游戏提取的原版贴图
├── js/
│   ├── data.js                 建筑数据库（尺寸 / 电力 / 分类）+ 地板 + 计划配色
│   ├── buildings.generated.js  由脚本生成的「精确数据库」，会自动覆盖上面的内置库
│   ├── sprites.js              由脚本生成的「原版贴图清单」（图片在 img/ 下）
│   ├── vendor/fzstd.js         纯 JS 的 zstd 解压（浏览器内导入游戏贴图用，MIT）
│   ├── gamezip.js              读 Assets.zip + 解 DDS（BC7 走 WebGL2 / BC4 纯 JS）
│   ├── gamedefs.js             在浏览器里解析游戏 Defs（= extract_defs.py 的 JS 版）
│   ├── gameimport.js           导入编排 + IndexedDB 缓存
│   ├── icons.js                贴图渲染（原版贴图优先，缺失时用原创矢量图兜底）
│   ├── engine.js               网格 / 相机 / 编辑 / 撤销 / 渲染
│   ├── checks.js               布局校验（重叠·电力·房间·连通·温控）
│   ├── exporters.js            蓝图 .xml / 工程 JSON
│   ├── io.js                   本地存档 / RimWorld 存档读取
│   └── main.js                 界面装配
└── tools/
    ├── extract_defs.py         从本地游戏目录生成精确尺寸表（命令行路线，可选）
    ├── extract_textures.py     从本地游戏目录提取原版贴图（命令行路线，可选）
    └── build_single.py         打包单文件版
```

---

## 快速开始

1. 用 **Chrome / Edge / Firefox** 打开 `index.html`（双击即可，`file://` 协议下可用，无需装服务器）。
2. 左边选建筑 → 在网格上点/拖动摆放。
3. 右侧勾选 **电力 / 房间** 图层，点 **运行校验**，就能看到布局问题。

> 建议用 Chrome/Edge：本地文件存储（localStorage）在 `file://` 下更稳定。Firefox 也支持，但如果发现「保存到浏览器」不可用，用 **保存工程** 导出文件即可。

---

## 获取更新

本仓库只包含**代码和文档**，不含任何游戏美术资源（`img/` 已排除），所以体积很小，clone 很快。

```bash
git clone https://github.com/luwendi-qq/rimworld-planner.git
```

之后作者更新了，你在仓库目录里拉一下就同步了：

```bash
git pull
```

不装 Git 也行：在仓库页面点 **Code → Download ZIP**，解压覆盖旧目录即可
（你自己的存档和 `img/` 贴图不在仓库里，不会被覆盖）。

> clone 下来后 `img/` 是空的，画布会显示**代码绘制的矢量图**（功能完全一样）。
> 想换成游戏原版贴图，按下面「原版贴图」一节做一次即可，产物留在你本地、不需要也不应该提交回仓库。
>
> 如果你的本地改动和作者的更新冲突，先 `git stash` 再 `git pull`，或者干脆把改动留在自己的分支上。

---

## 功能

### 绘制
- 网格画布，支持缩放（滚轮）、平移（中键 / 空格拖 / Alt 拖）
- 默认地图 **250×250**（和游戏标准地图一致），可在顶部改
- 建筑按正确的**格子占地**摆放，`R` 旋转，占地尺寸随朝向自动变化
- **可选原版贴图**：跑一次 `tools/extract_textures.py` 就显示游戏原版美术
  （墙体连接图集、床/桌朝向、地板材质、按材质染色），没有贴图时自动退回矢量图
- **绘制方式按建筑类型自动切换**（和游戏一致，不需要手动设）：
  - **墙 / 栅栏 / 沙袋** → **方框**：拖一个矩形只画最外一圈（画房间最快）
  - **门 / 家具 / 生产设施 / 电器** → **直线**：点一下放一个
  - **地面** → **填充**：拖一个矩形整片铺满
  - 拖动过程中画布正中实时显示 **`宽 × 高`** 和本次将绘制的**格子数**
- **只能拉横线 / 竖线 / 点，不能拉斜线**（和游戏一致）：斜着拖会自动取位移较大的那一轴，
  另一轴锁在起点，不会出现锯齿状斜线；多格建筑（床、桌子…）一次只放一个
- **原地替换**（默认开启，顶栏可关）：直接画在已有建筑上就会替换掉它——
  在画好的围墙上用「门」一点，那一格墙就变成门；把制冷器画到墙上则是「墙 + 制冷器」共存
  （贴墙件与实体可以同格）。关掉后则会提示「与某某重合」。
- **电缆自动衔接**：电线按四周邻居画出连向上/下/左/右的线，而不是固定一个十字；孤立的一格画成接线盒
- **全中文命名**，和游戏内一致（内置对照表；若提取了官方简中语言包则使用官方名）
- 框选、多选、拖动移动、复制粘贴、删除、撤销/重做（**框选连地板一起选**，按 `Delete` 一次删掉；拖已选中的东西就是移动）
- 打开时默认按「看得清网格」的缩放居中（250×250 的空地图不再缩成一片小点）
- **地板层**：木地板 / 石砖 / 混凝土 / 无菌地板 / 地毯 等
- 按分类浏览 + 搜索（中文 / 英文 / id）
- **材质是逐物品的**（和游戏一样）：在左侧物品栏 **长按左键**（或右键）某个建筑 → 弹出材质菜单
  （按木材/石材/金属/纤维/皮革分类，共 53 种，从游戏 defs 提取）→ 选好后放到画布上。
  已放好的可以选中后在右下角批量改。**导入存档时每个建筑的材质会一起带进来**
### 界面
- **配色和控件观感都取自游戏本体**（不是凭感觉配的）：
  按钮用游戏那种暖棕 `#6A512E`（悬停 `#886432`／按下 `#624927`，取自 `UI/Widgets/ButtonBG*`），
  命令按钮用建筑师菜单的深蓝灰 `#395365`（`DesButBG`），次级按钮是暗底细边（游戏里大量用这种），
  面板底 `#0C0F11`（`TooltipBG`）+ 暗绿灰 `#333F33`（`TexUI.GrayBg`），
  **选中高亮是游戏里的暖黄 `#FFF080`**（`TexUI.HighlightSelectedTex`），强调色用青 `#33CDD9`，
  校验提示用 `ColorLibrary` 里的红/金/绿；UI 文字带一层深色描影（和游戏一致）
- **画布左下角是游戏那种大方块工具条**（放置/框选/橡皮，带图标；框选工具兼移动），选中项描暖黄边
- **分类是连成一排的标签条**（照 `UI/Widgets/TabAtlas`：暗底 + 上缘高光，当前页签带暖黄顶边）
- **物品栏是建筑师菜单式的方格**（深蓝灰渐变 + 上缘高光 + 悬停变亮 + 选中暖黄边）
- **提示框是自己画的**（近黑底 + 细亮边，照 `TooltipBG`），浏览器原生那种灰框看不到了
- 字体用 Arial（游戏 UI 用的就是 Arial，Windows/macOS 都自带；中文走系统字体）
- 顶栏 **? 帮助**：三步上手、绘制规则、材质怎么选、导出路径（按系统自动显示）

### 校验（核心）
| 项目 | 说明 |
| --- | --- |
| 占地冲突 | 同一格被两个建筑占用；贴地图边缘的「不可建造区」 |
| 电力网络 | 照游戏 `PowerConnectionMaker` 的规则连网：**输电建筑（电缆/开关/发电机/电池）和 6 格内的用电器相连**，算出每张网的发电·耗电·储电与缺口 |
| 房间识别 | 自动 flood-fill 出封闭房间，显示面积、**空间评分**（拥挤/较紧/一般/…/极其宽敞，按游戏阈值）、门数量 |
| 通路可达性 | 从室外出发经门 BFS，找出「密封房间」「到不了室外」的区域 |
| 温控估算 | 按面积估算冷库需要几台制冷器，对比当前数量 |

### 导出 / 导入
- **真蓝图 `.xml`（Blueprints 模组）** ← 主推。工人会消耗材料去建，**带每个建筑的材质与朝向**
- 工程 JSON、Blueprints 模组蓝图 .xml
- 导入：工程 JSON、**RimWorld 存档 `.rws`**（把已建好的基地读进来当底图，含每件家具的材质）

---

## 把布局导回游戏

点顶栏「**导出蓝图**」得到一个 `.xml`，放进 RimWorld 的 **Blueprints** 文件夹：

| 平台 | 路径 |
| --- | --- |
| Windows | `%USERPROFILE%\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Blueprints\` |
| Linux | `~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Blueprints/` |
| macOS | `~/Library/Application Support/RimWorld/Blueprints/` |

游戏里用蓝图按钮载入即可，工人会消耗材料开建。需要 **Blueprints** 模组（1.7 用
`Blueprints - 1.7 Waylith (Unofficial)`，工坊 ID `3819556044`）。

> 更省事：顶栏点「**存入 Blueprints**」，选一次那个文件夹，之后一键直接写进去，不用自己翻路径。
> 文件夹和 `Saves` 在同一层，游戏里 **选项 → 常规 → 打开存档数据文件夹** 就能看到。

---

## 关于数据准确性（重要）

内置数据库（99 条常用建筑）是**人工整理的参考值**：格子尺寸基本可靠，但少数条目方向/数值可能随版本变化。
跑过 `tools/extract_defs.py` 之后，凡是能从游戏里对上的条目都会标为「精确」，**界面上不再显示 `?`**；
只有对不上的老条目（例如 1.7 已移除的混凝土护栏）才继续标 `?` 提醒你核对。电力数值同样是参考值。

**想要精确数据（尺寸/耗电/发电/储电直接来自游戏 defs）：**

RimWorld 的 `Defs` 是平台无关的 XML 文本，Windows / macOS / Linux 版内容一模一样，
所以**不需要在跑脚本的机器上运行游戏**，把文件弄过来就行。三选一：

**方案 A（最省事，推荐）：在 Windows 上跑脚本，只把生成的一个文件拷过来**

Windows 装个 Python，然后在 Win 机器上：

```powershell
python tools\extract_defs.py "C:\Program Files (x86)\Steam\steamapps\common\RimWorld"
```

把生成的 `js\buildings.generated.js` 拷到本机 `rimworld-planner/js/` 即可。**只传几十 KB。**

**方案 B：只拷 XML（占地很小）**

`Defs` 全是纯文本，先只把 XML 挑出来，再整体拷：

```powershell
# Windows(PowerShell)，结果大约几 MB
robocopy "C:\Program Files (x86)\Steam\steamapps\common\RimWorld\Data" "$env:USERPROFILE\Desktop\rwdefs\Data" *.xml /S
```

然后把 `rwdefs` 整个拷到本机，运行：

```bash
python3 tools/extract_defs.py ~/rwdefs
```

**方案 C：直接拷整个 RimWorld 文件夹**

一样能跑（只是多了几十 MB 到几百 MB 的贴图，脚本不会读它们）：

```bash
python3 tools/extract_defs.py "/path/to/os/RimWorld"
```

**想要 100% 官方的中文名**：把游戏里的中文语言包也拷过来，脚本会自动读取并优先使用它：

```powershell
robocopy "C:\Program Files (x86)\Steam\steamapps\common\RimWorld\Data\Core\Languages" "$env:USERPROFILE\Desktop\rwdefs\Data\Core\Languages" ChineseSimplified* /S
```

（各 DLC 的 `Data\<DLC>\Languages\ChineseSimplified` 同理。）
没拷也没关系——内置了一份简中名对照表兜底，界面上仍然是中文。

脚本能自动识别三种结构：完整安装目录、直接指向 `Data`、或只拷了 XML 的目录。

脚本会扫描 `Data/**/Defs/**/*.xml`（含 Royalty / Ideology / Biotech / Anomaly / Odyssey），
解析 `ThingDef`、处理 `ParentName` 继承，生成 `js/buildings.generated.js`。刷新页面后自动生效，无需改代码。

**它采取「合并」而不是「覆盖」策略**，所以你没买全 DLC 也没关系：

| 情况 | 结果 |
| --- | --- |
| 内置库里有这个建筑 | 用精确值更新尺寸/电力等，**保留手工挑选的图标** |
| 本库没有、但游戏里有（比如你装的 mod） | 作为新条目追加 |
| **你未安装的 DLC** | 保留内置参考值，界面上仍标 `?` 提醒你核对 |

也就是说：装本体 → 本体部分全部精确；装了某几个 DLC → 那几个 DLC 也精确；没装的保持可用但标注待核对。

> 装了全部 DLC 时实测：277 条内置参考 → 拆成 262 条（77 条被精确覆盖、178 条来自游戏、其余合并去重），
> 其中 259 条能用上原版贴图。桥在 1.7 里已经是**地形**（从地板菜单造），所以本工具也把它放进了地板层；
> 混凝土护栏 / 电动研究台这两条是 1.7 里已经不存在的老条目，保留矢量图兜底。

脚本处理的要点：
- 继承链（`ParentName` / `Name`，含抽象父类）
- `<size>`、`passability`、`holdsRoof`、`fillPercent`
- `<comps>` 里的 `CompProperties_Power` / `PowerPlant` / `Battery` / `Door`
- `<statBases><Beauty>`、`stuffCategories`、`designationCategory`、所属 DLC

> 脚本只读取你本机的数值定义，输出的是尺寸/电力表格，**不包含也不分发任何游戏美术资源**。

---

## 原版贴图（可选，观感提升最大的一步）

默认画的是**纯代码绘制的矢量图**（形状对，但比较抽象）。想让画布直接显示**游戏原版贴图**，
有两条路，任选其一：

### 路线 A：在网页里直接导入（推荐，零安装）

把 **RimWorld 安装目录**拖到右侧「导入游戏资源」那个框里（或点「选择游戏目录」）。
浏览器会自己完成：

1. 读 `Data` 下所有 Defs，现场算出**精确数据**（尺寸 / 电力 / 材质表 / 通行性 / 门…）；
2. 顺便读官方简中语言包（`Languages/ChineseSimplified*.tar`，解包成文件夹的形式也认），
   建筑名 / 材质名直接用游戏里的官方中文名；万一没找到，就退回内置对照表（导入状态里会写清楚用的是哪种）；
3. 从 `Assets.zip`（含各 DLC 的）里取出贴图，**在浏览器里解码**（BC7 走显卡、BC4 用 JS、zstd 内置解码器）；
4. 结果存进浏览器的 IndexedDB，**下次打开直接可用**，不用再拖。

整个过程只读你本机文件、不上传任何东西。第一次大概要几十秒到一两分钟（取决于你装了几个 DLC），
**别切走标签页**（浏览器会节流后台页面的任务，变慢）。

> 技术要点：新版 RimWorld 的贴图是 **BC7/BC4 压缩的 DDS**，而且打包用的是 **zstd** ——
> 浏览器的 `DecompressionStream` 至今不支持 zstd，所以内置了一份纯 JS 解码器（fzstd，MIT）；
> BC7 则借 WebGL2 的 `EXT_texture_compression_bptc`（Windows 桌面支持率 99.7%）在显卡上解，
> 解出来的结果和官方工具**逐字节一致**。

### 路线 B：跑一次 Python 脚本（高级用户 / 其它平台）

```powershell
pip install pillow zstandard
python tools\extract_textures.py "D:\Program Files (x86)\Steam\steamapps\common\RimWorld"
```

生成 `img/` + `js/sprites.js`，刷新页面即可。适合：想用命令行、想自己控制产物、
或者浏览器不支持 BC7（约 0.3% 的桌面环境）。数据那边同理：

```powershell
python tools\extract_defs.py "D:\Program Files (x86)\Steam\steamapps\common\RimWorld"
```

刷新页面后，右侧「计划设置」里可以随时勾掉 **原版贴图** 换回矢量图对比。

### 还原到什么程度

不是「拿 north 贴图拉一下」那么简单，而是照着游戏的绘制规则来的：

| 项目 | 做法 |
| --- | --- |
| 占地 ≠ 绘制尺寸 | 用游戏真实的 `drawSize`（例：床占地 1×2，贴图实际是 2×2）、`drawOffset` |
| 朝向 | 和游戏一致（**不再有 +180° 修正**）：`Graphic_Multi` 按 `_north/_east/_south/_west` 换图；东西向还会交换绘制尺寸；缺西向时用东向镜像 |
| 门 / 栅栏门 | 复刻 `Building_Door.Draw()`：同一张贴图**正着画一次 + 镜像画一次**拼成完整的一扇门；朝向也照 `Building_Door.DoorRotationAt()` 由左右邻居算（只可能是北/东），**存档里的 rot 对门无效**（游戏也是自己算的） |
| 存档坐标 | 完全照搬 `GenAdj.OccupiedRect` + `AdjustForRotation`（含「偶数尺寸按朝向平移中心」那一步），实测在真实存档 764 个建筑上**冲突 0 格** |
| 墙体 / 栅栏 / 沙袋 / 路障 / 电缆 | 用游戏的 **4×4 连接图集**：索引 = `北1 + 东2 + 南4 + 西8`，并正确处理「第 0 行在图集底部」这个 Unity UV 约定；电缆只和电缆相连 |
| 墙体转角 | 复刻 `Graphic_LinkedCornerFiller`：取子图 UV `(0.5, 0.6)` 的单像素拉伸成 0.5×0.5 补角，所以厚墙不会有缝 |
| 材质 | `Graphic_Appearances` 按材质外观换图集（木→Planks / 石→Bricks / 金属→Metal，缺 Metal 时退回 Smooth），并用游戏 `StuffDef` 里的**真实颜色**染色（乘算）。**每个建筑各用各的材质** |
| 炮塔的炮身 | 炮塔在游戏里是「底盘 + 炮身」两层，`turretGunDef` 指向的那个 def 的贴图会被叠加上去（迷你炮塔 / 加农炮塔 / 铀弹炮塔 / 迫击炮…） |
| 地板 | `TerrainDef` 的 `texturePath` + `color`（石砖是用同一张 TileStone 按石料颜色染出来的）。**桥在 1.7 里是地形**，所以归到地板层（木地板 + 桥墩叠出来的） |
| 贴图缺失时 | 自动退回矢量图，所以只装了一部分 DLC / 装了 mod 也不会开天窗 |

实测：全部 DLC 下 259/262 个建筑、18 种地板都有原版贴图，`img/` 约 9 MB。
觉得太大可以用 `--max-px 384` 之类的参数压一压。

```powershell
python tools\extract_textures.py "<游戏目录>" --max-px 384   # 控制单张最长边
python tools\extract_textures.py "<游戏目录>" --only-atlas   # 只提取墙/栅栏/电缆等连接图集
```

### 版权

这些贴图是 Ludeon 的美术资源。本工具**不带**任何游戏贴图：

- 脚本只在你本机运行，从**你自己买的游戏**里提取到本地 `img/`；
- `js/sprites.js` 只是清单（文件名 + 尺寸），里面没有图像数据；
- **别把 `img/` 连同工具一起分发**，也别忘了单文件版如果拷走就要连 `img/` 一起拷（否则自动用矢量图兜底）。

---

## 校验模型说明

校验都是本工具自己实现的**近似模型**，目的是「不开游戏就能判断大致是否可行」，不是游戏内物理的精确复刻：

- **房间**：把不可通行建筑与门视为分界线做 flood-fill；与地图边界相连的区域算「室外」。
- **空间评分**：`1.4 × 房间格数 − 0.9 × 被占格数`，再套用游戏的分档阈值。
- **电力**：把电力建筑占的格做正交相邻并查集，连通分量即一张电网，直接累加发电/耗电/储电。
- **温控**：经验公式，按面积估算制冷器数量，只做量级参考。

---

## 快捷键

| 键 | 作用 |
| --- | --- |
| `1` `2` `3` | 放置 / 框选 / 橡皮 |
| `R` | 旋转选中（没选中时旋转当前笔刷） |
| `Delete` | 删除选中 |
| `Esc` | 取消笔刷 / 粘贴 |
| `G` / `P` / `O` | 网格 / 电力层 / 房间层 |
| `F` | 适配视图 |
| `Ctrl+Z` / `Ctrl+Y` | 撤销 / 重做 |
| `Ctrl+A` / `Ctrl+C` / `Ctrl+V` | 全选 / 复制 / 粘贴 |
| `Ctrl+S` | 保存工程文件 |
| 滚轮 / 中键拖 / 右键 | 缩放 / 平移 / 删除 |

---

## 版权说明

- 本项目**不包含任何 RimWorld 游戏素材**。左侧图标默认全部是用代码绘制的原创矢量图形，
  只是形状上参考「俯视格子」的常规表现方式。
- 可选的**原版贴图**功能由 `tools/extract_textures.py` 在你本机、从你**自己安装的游戏**里提取，
  产出物留在本地 `img/` 下，**请勿随工具一起分发**（详见上面的「原版贴图 → 版权」）。
- 建筑名称、格子尺寸、耗电数值等属于事实性数据，用于兼容性目的。
- 蓝图 `.xml` 格式参考 Blueprints 模组（Fluffy，MIT 许可）的公开实现。
- RimWorld 及相关名称是 Ludeon Studios 的商标，本工具是非官方玩家工具。

---

## 单文件版（推荐）

除了多文件版，还提供了一个**自包含单文件**：

```
rimworld-planner.single.html     ← 双击即用，没有任何外部依赖
```

CSS 和全部 JS 都内联在里面（约 240 KB）。**性能没有差别**：代码总量 ~200 KB，解析是毫秒级，
真正的开销在画布渲染上，两个版本完全一样。实测（jsdom 冷启动）单文件甚至更快一点，
因为不用逐个读取 9 个脚本文件。

> 如果你提取过原版贴图，`js/sprites.js` 清单也会被一起内联，但它指向的 `img/` **不会**被内联。
> 想用贴图就把 `img/` 文件夹跟单文件放在同一目录；不想带就放着不管，会自动用矢量图。

**重新生成单文件**（比如你用 `extract_defs.py` 更新了数据库之后）：

```bash
python3 tools/build_single.py
# 或指定输出位置
python3 tools/build_single.py --out ~/rimworld-planner.single.html
```

两个版本可以并存：多文件版方便改代码，单文件版方便拷来拷去。
