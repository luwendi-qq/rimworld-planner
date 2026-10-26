# 导出 / 导入

[← 返回 README](../README.md)

## 导出

| 格式 | 用途 |
| --- | --- |
| **蓝图 `.xml`** | ← 主推。Blueprints 模组的真蓝图，游戏里工人会消耗材料去建，**带每个建筑的材质与朝向** |
| **工程 JSON** | 完整保存你的规划（含地板、规划层、材质记忆、各房间目标温度、床的普通/医疗/囚犯状态），之后可以再打开继续改 |
| **PNG 图片** | 把整个布局（自动算包围盒）导出成图片，方便分享 / 存档 |

## 导入

| 来源 | 用途 |
| --- | --- |
| **工程 JSON** | 恢复之前保存的规划（含地形底图、屋顶、锁定状态、目标温度、床的状态、存档情报） |
| **RimWorld 存档 `.rws`** | 把已经建好的基地读进来当底图（含每件家具的材质），并读出地形/山体、殖民者、科技、库存 |
| **模组文件夹** | 右侧「导入模组建筑」把 `Mods/` 或单个模组文件夹拖进来，扫描模组新增的可建造建筑（见下） |
| **RimWorld 安装目录** | 右侧「导入游戏资源」拖入 / 选择目录，得到精确数值 + 原版贴图（见下；**macOS 上请点「选择游戏目录」，不支持拖拽**） |

> 读取存档时，原有建筑会标记为**已锁定·底图**（图上淡显 + 小锁）。它们不能误删/误移，导出蓝图时也默认排除；
> 想连它们一起导出，点顶栏「只导出新增」取消勾选，或点「全部解锁」。

> 「自动保存」存在浏览器本地的另一个位置，导出成文件的是「保存工程」（`.rwplan.json`）——
> 两者互不覆盖，详见 [usage.md 的「自动保存」](usage.md#自动保存)。

### 导入游戏资源（原版数据与贴图）

右侧「导入游戏资源」把 **RimWorld 安装目录**整层拖进去（或点「选择游戏目录」），浏览器在本地解析 Defs、官方简中语言包和 `Assets.zip` 里的贴图，结果存进 IndexedDB，下次打开直接可用。

| 平台 | 安装目录 |
| --- | --- |
| Windows（Steam） | `…\steamapps\common\RimWorld` |
| Windows（GOG 等） | 游戏安装根目录：里面有 `Data\` 和 `Mods\` 就行 |
| **macOS（Steam）** | `~/Library/Application Support/Steam/steamapps/common/RimWorld` |

**macOS 特别注意**

- **双击打开 html（`file://` 页面）时拖拽读不到文件夹**：浏览器不允许网页遍历拖进来的目录，只会掉出一两个假文件。面板会立刻提示，并直接把你引到「选择游戏目录」——点按钮选目录就行（macOS 的 Chrome / Edge / 豆包都一样，这是浏览器的限制）。
- macOS 上核心贴图不在 `Data/Core/`，而在 **`RimWorld.app/Contents/MacOS/Assets.zip`**；选安装目录**整层**就好，工具会自己进 `.app` 里找，各 DLC 的 `Data/<DLC>/Assets.zip` 也会一起读。
- 状态里出现「⚠️ 有 N 张贴图没解出来」说明这个浏览器拿不到 BC7 压缩纹理（常见于关了硬件加速、远程桌面或虚拟机）：这些建筑会改用矢量图，尺寸 / 造价 / 校验都不受影响；打开硬件加速后重新导入一次即可。
- 浏览器禁用本地数据库（隐私模式）时，状态会提示「数据只在本次打开有效」，刷新后需要重新导入。

导入完成后，已存的模组建筑会自动按新的核心数据重解析一遍。

### 导入模组建筑

内置建筑表只覆盖原版 + DLC。装了模组后，把 `Mods` 文件夹（或单个模组文件夹）拖进右侧「导入模组建筑」：

1. 按 `About/About.xml` 认出每个模组（packageId / 名字 / 版本 / 工坊 id）
2. 只读**当前游戏版本生效**的文件夹：有 `LoadFolders.xml` 按它挑；没有就回退到「不高于当前版本的 `1.x/` 目录」+ 根目录
3. 把模组 Defs 和之前导入的**核心 Defs XML** 拼在一起解析（`ParentName` 能跨原版/跨模组继承）
4. 只把**该模组自己声明**的建筑并进数据库，打上 `mod` / `modName` 标记，并解出 `Textures/` 里的贴图
5. 物品栏出现「🧩 模组」页签；每个模组在导入面板里单独一行，可单独 `✕` 移除或「清除全部」

#### 创意工坊的 mod 在哪？

订阅的 mod **不在** `RimWorld/Mods`，而在 Steam 库的 `steamapps/workshop/content/294100/`（`294100` 是 RimWorld 的 AppID）：

| 平台 | 路径 |
| --- | --- |
| Windows | `C:\Program Files (x86)\Steam\steamapps\workshop\content\294100` |
| macOS | `~/Library/Application Support/Steam/steamapps/workshop/content/294100` |
| Linux | `~/.local/share/Steam/steamapps/workshop/content/294100` |

- 把整个 `294100` 文件夹拖进「导入模组建筑」= 一次导入全部订阅 mod；每个子文件夹名就是工坊 ID（缺失 `PublishedFileId.txt` 的老 mod 会自动用文件夹名当工坊 ID 写进蓝图 meta）
- 手动安装 / 本地开发的 mod 在 `<游戏目录>/Mods/`，两种可以分两次拖
- 找不到 Steam 库：Steam 客户端 → 库 → 右键 RimWorld → 管理 → 浏览本地文件，再退回 `steamapps/workshop`；换过库位置的去 Steam 设置 → 存储 里看每个库的路径
- 🍎 macOS 双击打开 html（`file://`）时浏览器会拦住拖进来的文件夹，改点「选择模组文件夹」按钮

注意事项：

- **先导入游戏目录**。没导过核心数据也能导模组，但 `ParentName` 指向原版抽象 def 的继承会缺字段（尺寸/材料/工时），面板会提示
- **macOS 的模组目录**：`~/Library/Application Support/RimWorld/Mods`；Steam 创意工坊的模组在 `…/steamapps/workshop/content/294100/<数字>/`，可以选整个 `Mods`，也可以单独选某个工坊模组文件夹。同样，双击打开（`file://`）时拖拽不行，用「选择模组文件夹」
- 建筑只收有 `designationCategory`（建筑师菜单）的 `Building`；纯物品、菜单外 prop、只生成物不会进来
- 贴图只在 `<模组>/Textures/**.png|.dds` 里找；打包进 Unity `AssetBundles`（`.assets`）或 `Assets.zip` 的模组解不出来，回退矢量图标
- 只收 `Defs/` 里直接声明的 `ThingDef`：通过 `Patches/` 的 XML Patch 或 C# 代码（`DefGenerator` / Harmony）动态加的建筑扫不到 —— 这是浏览器里做静态解析的边界，不是漏读文件
- 模组数据存在 IndexedDB：下次打开自动恢复；重新导入游戏目录后会用新核心数据自动重解析；「清除游戏缓存」会连模组导入一起清掉

---

## 把布局导回游戏

点顶栏「**导出蓝图**」得到一个 `.xml`，放进 RimWorld 的 **Blueprints** 文件夹：

| 平台 | 路径 |
| --- | --- |
| Windows | `%USERPROFILE%\AppData\LocalLow\Ludeon Studios\RimWorld by Ludeon Studios\Blueprints\` |
| Linux | `~/.config/unity3d/Ludeon Studios/RimWorld by Ludeon Studios/Blueprints/` |
| macOS | `~/Library/Application Support/RimWorld/Blueprints/` |

游戏里用蓝图按钮载入即可，工人会消耗材料开建。

需要 **Blueprints** 模组（1.7 用 `Blueprints - 1.7 Waylith (Unofficial)`，工坊 ID `3819556044`）。

### 模组建筑与 Blueprints

蓝图里存的是 `defName` 字符串（`Scribe_Defs`），游戏读蓝图时按 defName 去 `DefDatabase` 查，
所以**任何已加载 mod 的建筑、地板、材质都能映射**，没有 Core 白名单。唯一的硬门槛是
`designationCategory != null`（在建筑师菜单里），这个条件与来源 mod 无关。

导出时 `<meta>` 会自动写「蓝图里**实际用到**的模组」的 packageId（小写）/ 工坊 id / 名字三件套。
但 meta 只影响游戏的 mod 差异提示，**不是通行证**：真正决定能否放的是 defName 逐字一致 + 放置时启用了对应模组。
缺 mod 时游戏会逐条报 `Def named ... not found.`，1.7 维护版会弹「Update / Keep」让你选删除缺失项或放置时跳过。

完整证据链（上游源码 [fluffy-mods/Blueprints](https://github.com/fluffy-mods/Blueprints) + 本机 1.7 DLL 反汇编 + 真实存档 meta 样本）→
[blueprints-mod-support.md](blueprints-mod-support.md)。

### 更省事的做法

顶栏点「**存入 Blueprints**」，选一次那个文件夹，之后**一键直接写进去**，不用自己翻路径。
设定过文件夹之后，再点「**导出蓝图**」也会直接写进同一个文件夹，不会同时再下载一份。

蓝图文件名默认用工程名；**读取存档后会自动改成存档里的殖民地名**（例如「洛加人民协会」），不会一直是「未命名布局」。

文件夹和 `Saves` 在同一层，游戏里 **选项 → 常规 → 打开存档数据文件夹** 就能看到。

> 浏览器安全限制：首次必须你手动选一次目录，之后浏览器会记住授权。
> 如果浏览器不支持目录写入（Firefox 部分版本），用「导出蓝图」下载再手动拷进去即可。

## 坐标与朝向

存档坐标完全照搬游戏的 `GenAdj.OccupiedRect` + `AdjustForRotation`（含「偶数尺寸按朝向平移中心」那一步），
实测在真实存档 **764 个建筑上冲突 0 格**。细节见 [textures.md 的「还原到什么程度」](textures.md#还原到什么程度)（绘制规则部分同理）。
