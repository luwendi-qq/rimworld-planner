# 原版贴图（可选，观感提升最大的一步）

[← 返回 README](../README.md)

默认画的是**纯代码绘制的矢量图**（形状对，但比较抽象）。想让画布直接显示**游戏原版贴图**，有两条路，任选其一。

> ⚠️ 这些贴图是 Ludeon 的美术资源。**本仓库不含任何游戏贴图**（`img/` 与 `js/sprites.js` 已被 `.gitignore` 排除），
> 需要你自己在本地从**你购买的游戏**里提取。见文末[版权](#版权)。

## 路线 A：在网页里直接导入（推荐，零安装）

把 **RimWorld 安装目录**拖到右侧「导入游戏资源」那个框里（或点「选择游戏目录」）。浏览器会自己完成：

> 🍎 **macOS**：安装目录在 `~/Library/Application Support/Steam/steamapps/common/RimWorld`；
> 核心贴图不在 `Data/Core/`，而在 `RimWorld.app/Contents/MacOS/Assets.zip` —— 选安装目录整层就好，工具会自己进去找。
> 另外，**双击打开 html（`file://`）时浏览器不允许网页读拖进来的文件夹**，请点「选择游戏目录」（或「选择模组文件夹」）。

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

## 路线 B：跑一次 Python 脚本（高级用户 / 其它平台）

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

## 还原到什么程度

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

## 版权

这些贴图是 Ludeon 的美术资源。本工具**不带**任何游戏贴图：

- 脚本只在你本机运行，从**你自己买的游戏**里提取到本地 `img/`；
- `js/sprites.js` 只是清单（文件名 + 尺寸 + UV），里面没有图像数据；
- **别把 `img/` 连同工具一起分发**，也别忘了单文件版如果拷走就要连 `img/` 一起拷（否则自动用矢量图兜底）；
- 本仓库的 `.gitignore` 已经排除了 `/img/` 和 `/js/sprites.js`，所以 clone 下来是干净的。
