# Blueprints 模组是否支持「其它 mod 新增物品」——调研

调研日期 2026-10-26。对象：本机安装的 1.7 非官方维护版 `nova.Blueprints.Waylith17`（创意工坊 3819556044，DLL `.../3819556044/1.7/Assemblies/Blueprints.dll`）。该版本 DLL 里没有任何源码，可公开对照的上游是 [fluffy-mods/Blueprints](https://github.com/fluffy-mods/Blueprints)（master 分支 = 1.5，Fluffy 原作；Defi fork 与 1.7 维护版都在它之上改动）。本文只做调研，未改动代码。

## 结论摘要

1. 蓝图 XML 里存的是 **defName 字符串**：`Scribe_Defs.Look` 写 `<ThingDef>Wall</ThingDef>`，读时按 defName 去 `DefDatabase<ThingDef>` 里查（`GetNamed`），不写 ID/序号/mod 偏移。→ **任何「已加载 mod」的建筑 def 天然支持**，不存在 Core 白名单（DLL 里除类型名外没有任何 Core defName 字面量）。
2. 唯一的硬门槛是 **`designationCategory != null`**（即该 def 在建造菜单里有分类）。家具、生产设施、门、墙、地板/地形全部满足；纯生成物、菜单外的 prop/遗迹/事件建筑不满足。
3. `meta` 里的 `modIds` / `modSteamIds` / `modNames` 是 RimWorld 标准存档头（`ScribeMetaHeaderUtility.WriteMetaHeader`）写的 **packageId / 工坊 id / 显示名** 三件套，语义是「写这份文件时启用了哪些 mod」，供读档时做 **mod 差异提示**。它 **不参与 def 解析**：meta 不全不会阻止加载，meta 齐全也不保证加载成功。
4. 真正的「缺 mod」发生在逐条解析时：`Scribe_Defs` 查不到 → 该字段为 null + 日志 `Def named ... not found.`。1.7 维护版据此计算 `HasMissingItems` / `MissingItemCount`，加载时弹 `Dialog_MissingMods` 让玩家选「更新（删掉缺失项）」或「保留（放置时跳过）」。
5. 对我们：`meta.modIds` 应写 **实际提供这些 def 的 mod 的 packageId（小写）**，但更关键的是每个 `ThingDef`/`TerrainDef`/`Stuff` 的 defName 与目标 mod 包完全一致，并在 UI 里提示「放置前必须启用对应 mod」。

## 1. XML 存什么、怎么解析（问题 1）

1.7 维护版 DLL 反汇编（`Blueprints.BuildableInfo::ExposeData`，128 字节）与上游源码完全一致：

```csharp
// BuildableInfo.cs:150-157 (fluffy-mods/Blueprints, master)
Scribe_Defs.Look( ref _thingDef,   "ThingDef" );
Scribe_Defs.Look( ref _stuff,      "Stuff" );
Scribe_Defs.Look( ref _terrainDef, "TerrainDef" );
Scribe_Values.Look( ref _position, "Position" );
Scribe_Values.Look( ref _rotation, "Rotation" );
```

- 1.7 版把 `Rotation` 改成先读 int（默认 `-1`），再在 `LoadSaveMode.PostLoadInit` 里 `_rotation = rot == -1 ? default : new Rot4(rot)`——这正是发行说明里的「旋转数据不再静默损坏」修复。写 `0..3` 或 `-1` 都安全。
- 容器与头部（`Blueprints.Blueprint::ExposeData`，与 `Blueprint.cs:111-117` 对应）：`Scribe_Collections.Look(ref contents, "BuildableThings", LookMode.Deep, this)`、`"Name"`、`"Category"`、`"Size"`、`"Exported"`。
- `Scribe` 是按节点名匹配的，元素顺序无所谓；根节点必须是 `<Blueprint>`，因为 `LoadFromXML` 里先 `Scribe.EnterNode("Blueprint")` 再 `blueprint.ExposeData()`（`BlueprintController.cs:184-220`），而 `SaveToXML` 是 `InitSaving(file, "Blueprint")` + `Scribe_Deep.Look(ref blueprint, "Blueprint")`（`:222-250`）——所以文件里是「外层 `<Blueprint>` + 内层 `<Blueprint>`」。
- defName 解析的语义由 `Scribe_Defs` 决定：写入 `def.defName`，读取时 `DefDatabase<T>.GetNamed(name, errorOnFail: false)`（游戏 DLL 里能看到 `GetNamed` / `GetNamedSilentFail` 与 `Def named ... not found.` 两处字符串）。同一份存档里原生 `Scribe_Defs` 的输出形态可直接对照：`/Users/xuchaonan/Library/Application Support/RimWorld/Saves/奇数派.rws` 里 `<def>MineVein</def>` 就是 defName。

结论：**按 defName 解析，所以 mod def 与 Core def 走完全相同的路径**。只要该 def 在游戏里被加载，蓝图就能读到它。

## 2. 是否支持非 Core 模组建筑、有无 Core 名单（问题 2）

- 没有任何 defName 白名单。代码里唯一相关的判断是 `designationCategory != null`（见第 4 节），这是 def 的通用字段，与来源 mod 无关。
- 家具 / 生产设施 / 门 / 墙：都是带 `designationCategory` 的 `ThingDef`，支持。
- 地板 / 地形：走 `TerrainDef` 分支，`IsValidBlueprintTerrain` 同样只要求 `designationCategory != null`（原版地板都满足；自然土壤、岩石、水面没有分类，因此不会被收录——这与本仓库 `floorTerrainOf()` 只映射可铺设地形一致）。
- 1.7 维护版还带了 `Patch_BuildableDef_BuildableByPlayer`、`Patch_DesignationCategory_ResolveDesignators` 与 `VFEProps.PropDef` 字符串，说明它进一步放宽了「玩家不可建造」的 def（例如 VFE Props 的装饰物）在菜单/设计器里的可见性。这是该 fork 的增强，属于「额外能收」，不影响我们「只要 defName 对就能放」的结论。

## 3. meta 与缺失 mod 机制（问题 3）

`meta` 的三个列表就是 RimWorld 存档头，取自本机存档 `奇数派.rws`（第 4-45 行）的真实样本：

```xml
<meta>
  <gameVersion>1.7.4985 rev1269</gameVersion>
  <modIds><li>brrainz.harmony</li><li>ludeon.rimworld</li>...<li>nova.blueprints.waylith17</li></modIds>
  <modSteamIds><li>0</li><li>0</li>...<li>0</li></modSteamIds>
  <modNames><li>Harmony</li><li>Core</li>...<li>Blueprints - 1.7 Waylith (Unofficial)</li></modNames>
</meta>
```

- `modIds` = `ModMetaData.PackageId`，**全小写**（`nova.Blueprints.Waylith17` 在文件里写作 `nova.blueprints.waylith17`），顺序 = 游戏加载顺序；`modSteamIds` = 工坊 published file id，本地/非工坊 mod 写 `0`；`modNames` = `About.xml` 的 `name`。三者等长、逐位对应。
- 这份 meta 由 `ScribeMetaHeaderUtility.WriteMetaHeader()`（`BlueprintController.cs:236`）写出，读取是 `ScribeMetaHeaderUtility.LoadGameDataHeader(ScribeHeaderMode.Map, true)`（`:197`）。`Map` 模式意味着它走「非存档文件」路径：只解析比对 mod 清单，不做「版本不匹配就拒绝加载」的处理，之后照常 `ExposeData()`。RimWorld 侧相关 UI 字符串：`ModsMismatchWarningTitle` / `ModsMismatchWarningText` / `ModsMismatchOrderChanged` / `MissingModsList`。
- **缺 mod 时不会静默跳过，也不会整体报错退出**：`Scribe_Defs` 逐条解析失败 → 该条目 def 为 null + 一条错误日志；上游随后 `blueprint.contents = contents.Where(item => item.BuildableDef != null)` 把坏条目删掉（`:184-220`，注释明说「def 不存在时 ExposeData 会报错，这没关系，字段会被置 null」）。
- 1.7 维护版把「删掉」改成玩家可选：`get_HasMissingItems` / `get_MissingItemCount`（IL 证据：`_contents.Any(...)` / `Count(...)`）→ `BlueprintController::ExposeData` 的 `PostLoadInit` 里 `foreach (bp) if (bp.HasMissingItems) Find.WindowStack.Add(new Dialog_MissingMods(bp))`。弹窗文案（本机 `Languages/English/Keyed/Translations.xml`）：
  - `MissingModsDesc`：`Blueprint "{0}" contains items from mods that are no longer active.`
  - `UpdateBlueprint`：`Update: Remove missing items`
  - `KeepBlueprint`：`Keep: Skip missing during placement`
  - `MissingModsNote`：`Missing items will be automatically skipped during placement if you choose to keep them.`
- 即：**缺失条目默认保留在数据里，只是放置时被跳过**；玩家也可以选「更新」把它们永久删掉。meta 只影响提示的准确性，不影响条目能否被解析。

## 4. 校验条件：哪些物品会被拒绝（问题 4）

创建蓝图时对地图上选中的物体做校验（上游 `Source/Blueprints/Extensions.cs:8-22`，1.7 版 DLL 保留了同名方法）：

```csharp
public static bool IsValidBlueprintTerrain( this TerrainDef terrain )
    => terrain.designationCategory != null;

public static bool IsValidBlueprintThing( this Thing thing )
{
    if ( thing is RimWorld.Blueprint blueprint )
        return blueprint.def.entityDefToBuild.designationCategory != null && thing.Faction == Faction.OfPlayer;
    if ( thing is Frame frame )
        return frame.def.entityDefToBuild.designationCategory != null && thing.Faction == Faction.OfPlayer;
    return thing.def.designationCategory != null && thing.Faction == Faction.OfPlayer;
}
```

- 条件只有两条：**有 `designationCategory`**（在建造菜单里）+ **属于玩家阵营**（后者只影响「从地图复制」，与我们导入 XML 无关）。
- 被拒绝的典型：纯生成物（矿脉、远古残骸、地形石块）、菜单外的 prop/装饰、事件建筑、以及任何 mod 里没给 `designationCategory` 的 def。
- 放置侧另有一层过滤：`AvailableContents = contents.Where(item => item.Designator.Visible)`（`Blueprint.cs:60-70`），`Designator` 是复刻的 `Designator_Build`（`BuildableInfo.cs:185-204`）。科技未解锁时条目不可见，于是：
  - 全部不可见 → `NothingAvailableInBlueprint`「None of the items in {0} can be build with the current technology.」
  - 部分不可见 → `XNotAvailableInBlueprint`「Some of the items in {0} can not be build with the current technology: {1}」
  - 解锁后 `RecacheBuildables()` 会重新计算，条目恢复（`Blueprint.cs:190-198`）。
- 放置时逐格再问一次 `Designator.CanDesignateCell(cell)`；不可放则整个蓝图显示为红/不可放（`Blueprint.cs:141-148`）。

## 5. Stuff（材质）（问题 5）

- `Stuff` 存的是 **StuffDef 的 defName**，同样走 `Scribe_Defs.Look`，所以 **mod 新增材质与 Core 材质没有区别**：只要该 StuffDef 已加载、且其 `stuffProps.categories` 与建筑的 `stuffCategories` 相交，就能正常映射。
- 解析不到时（材质来源 mod 被移除）`_stuff == null`，`CreateDesignatorCopy` 会回落 `GenStuff.DefaultStuffFor(_thingDef)`（`BuildableInfo.cs:191-197`）——不会崩，只是材质变成默认。Defi fork 的说明里专门修过「建筑材质所属 mod 被移除时出错」，1.7 维护版也有 `SetStuffDef` / `DefaultStuffFor` 相关字符串。
- 建筑不吃材质（`stuffCategories` 为空）时不要写 `<Stuff>`：写了不会崩，但没有意义，还会让日志/比对更难读。

## 6. 失败场景与规避（问题 6）

| 场景 | 实际发生什么 | 规避 |
| --- | --- | --- |
| 读蓝图时提供该 def 的 mod 未启用 | 逐条 `Def named ... not found.` 日志；条目 def=null；弹 `Dialog_MissingMods`；选 Keep 则放置时跳过该条目，选 Update 则永久删除 | 导出时把该 mod 的 packageId 写进 `meta.modIds`，并在 UI 明确提示「必须先启用 X mod」 |
| 同一 defName 被多个 mod 注册 | RimWorld 加载期报 duplicate defName，只有一个进入 `DefDatabase`；蓝图会按「胜出的那个」放，可能放成另一个东西 | XML 层无法规避；`meta.modIds` 记录来源 mod 便于事后排查 |
| mod 建筑「不可建造」（菜单外 / 仅生成 / prop） | 创建蓝图时被 `IsValidBlueprintThing` 拒绝；手写进 XML 也过不了 `Designator.Visible`，被 `AvailableContents` 静默跳过，可能整张蓝图变空 | 导出时对这类 def 给出警告；不要指望它们能放 |
| 科技/研究未解锁 | 不报错，条目被过滤；提示 `XNotAvailableInBlueprint`；研究完成后自动恢复 | 无需处理，属正常玩法 |
| `blueprintCategory` 差异 | 不存在这个 def。`Category` 是**自由文本**（`Fluffy.Blueprints.Category` = `Category (optional):`），只用于导入/编辑界面的分组排序，写中文、写任意字符串都行 | 保持现状（`<Category>布局</Category>` 合法，可省略） |
| `Name` 非法 | 模组用 `^[\w]+$` 校验（.NET 的 `\w` 含中日韩字符，但**不含空格和标点**）；文件名是 `<Name>.xml`。非法名会导致改名/再次导出失败 | 导出前净化名字：去掉空格与标点 |
| 材质来源 mod 缺失 | `_stuff` 为 null → 回落默认材质，仍可放置 | 可接受；`meta.modIds` 里写全便于提示 |

另外两个实操点：导出的 XML 必须落在 **`<RimWorld 用户数据>/Blueprints/`**（macOS：`~/Library/Application Support/RimWorld/Blueprints/`；模组用 `GenFilePaths.FolderUnderSaveData("Blueprints")` 取得该目录，`BlueprintController.cs:140-151`），本机目前还没有这个目录，需要手动创建；导入入口是蓝图分类里的 Import（`Fluffy.Blueprints.LoadFromXML` = `Import blueprint "{0}"`，没有可导入文件时提示 `NoStoredBlueprints`）。

## 7. 对本工具导出实现的明确要求（问题 7）

对应 `js/exporters.js:137-200` 的 `toBlueprintsXML`：

1. **`meta.modIds` 写 packageId，全小写，顺序≈加载顺序**：至少包含 `ludeon.rimworld`、`brrainz.harmony`、`nova.blueprints.waylith17`，**再加上蓝图里出现的每个 mod 建筑的所属 mod packageId**（例如家具来自 A mod 就加 A 的 packageId）。`modSteamIds` 逐位对应 published file id（未知写 `0`），`modNames` 用 `About.xml` 的 `name`。三者等长。
2. **meta 不是通行证**：它只影响读档时的 mod 差异提示。真正决定成败的是 `ThingDef`/`TerrainDef`/`Stuff` 的 defName 与目标 mod 包里的 defName 逐字一致，以及用户放置时确实启用了这些 mod——UI 上应把「需要启用的 mod 清单」直接展示出来。
3. **只导出可建造的 def**：跳过没有 `designationCategory` 的 def（纯装饰 prop、仅生成物）。我们目前只能用 defName 硬编码表兜底（`STUFF_DEF` / `FLOOR_TERRAIN`），建议对建筑 def 也保留一份「是否可建造」的白名单/数据字段。
4. **Stuff 按建筑判断**：仅当建筑的 `stuffCats` 非空时写 `<Stuff>`，且写合法 StuffDef defName；否则省略（游戏会回落到默认材质）。mod 材质与 Core 材质同等对待。
5. **`Name` 净化成 `^[\w]+$`**（中文可以，空格/标点不行），默认值别直接用带空格的 `state.mapName`。
6. **`Size` 保持为条目外接盒（宽, 高）**，`Position` 用相对原点的 `(x, 0, z)`，`Rotation` 写 `0..3` 整数（地形写 `0` 即可），这几项当前实现已正确，改动时别破坏。
7. 文件仍保持 BOM + CRLF（当前 `:196` 已如此），并落到 `Blueprints/` 目录后再让玩家点 Import。

## 8. 证据与参考

- 上游源码（唯一公开源码，1.5）：`https://github.com/fluffy-mods/Blueprints` —— `Source/Blueprints/BuildableInfo.cs:150-157`（ExposeData）、`Extensions.cs:8-22`（校验）、`Blueprint.cs:60-70,111-117,141-148`（可见性/序列化/放置）、`BlueprintController.cs:140-151,184-220,222-250`（目录、加载、保存）。
- 本机 DLL 反汇编：`.../3819556044/1.7/Assemblies/Blueprints.dll` 的 `Blueprints.BuildableInfo::ExposeData`、`Blueprints.Blueprint::ExposeData`、`BlueprintController::ExposeData`、`get_HasMissingItems`、`get_MissingItemCount`（工具：`dnfile` + 自写 IL 解码器，产物 `/tmp/bp/il2.txt`）。
- 本机 1.7 版文案：`.../3819556044/Languages/English/Keyed/Translations.xml`、`Languages/ChineseSimplified/Keyed/Translations.xml`。
- meta 真实样本：`/Users/xuchaonan/Library/Application Support/RimWorld/Saves/奇数派.rws`（第 4-45 行）。
- 游戏侧字符串：`RimWorld.app/Contents/MacOS/Assembly-CSharp.dll` 中的 `GetNamed` / `GetNamedSilentFail` / `Def named ... not found.` / `ModsMismatchWarningTitle` / `MissingModsList`。
- 创意工坊：维护版 `https://steamcommunity.com/sharedfiles/filedetails/?id=3819556044`；被 fork 的 1.6 版 `https://steamcommunity.com/sharedfiles/filedetails/?id=3718830257`（其说明列出 fork 改动与「缺失 mod 检测」）。
