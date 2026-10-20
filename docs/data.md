# 关于数据准确性

[← 返回 README](../README.md)

内置数据库（99 条常用建筑 + 22 条地板）是**人工整理的参考值**：格子尺寸基本可靠，但少数条目方向/数值可能随版本变化。
跑过提取（网页导入或 `tools/extract_defs.py`）之后，凡是能从游戏里对上的条目都会标为「精确」，**界面上不再显示 `?`**；
只有对不上的老条目（例如 1.7 已移除的混凝土护栏）才继续标 `?` 提醒你核对。电力数值同样是参考值。

**想要精确数据（尺寸/耗电/发电/储电直接来自游戏 defs）：**

RimWorld 的 `Defs` 是平台无关的 XML 文本，Windows / macOS / Linux 版内容一模一样，
所以**不需要在跑脚本的机器上运行游戏**，把文件弄过来就行。三选一：

## 方案 A（最省事，推荐）：在 Windows 上跑脚本，只把生成的一个文件拷过来

Windows 装个 Python，然后在 Win 机器上：

```powershell
python tools\extract_defs.py "C:\Program Files (x86)\Steam\steamapps\common\RimWorld"
```

把生成的 `js\buildings.generated.js` 拷到本机 `rimworld-planner/js/` 即可。**只传几十 KB。**

## 方案 B：只拷 XML（占地很小）

`Defs` 全是纯文本，先只把 XML 挑出来，再整体拷：

```powershell
# Windows(PowerShell)，结果大约几 MB
robocopy "C:\Program Files (x86)\Steam\steamapps\common\RimWorld\Data" "$env:USERPROFILE\Desktop\rwdefs\Data" *.xml /S
```

然后把 `rwdefs` 整个拷到本机，运行：

```bash
python3 tools/extract_defs.py ~/rwdefs
```

## 方案 C：直接拷整个 RimWorld 文件夹

一样能跑（只是多了几十 MB 到几百 MB 的贴图，脚本不会读它们）：

```bash
python3 tools/extract_defs.py "/path/to/os/RimWorld"
```

## 想要 100% 官方的中文名

把游戏里的中文语言包也拷过来，脚本会自动读取并优先使用它：

```powershell
robocopy "C:\Program Files (x86)\Steam\steamapps\common\RimWorld\Data\Core\Languages" "$env:USERPROFILE\Desktop\rwdefs\Data\Core\Languages" ChineseSimplified* /S
```

（各 DLC 的 `Data\<DLC>\Languages\ChineseSimplified` 同理。）

没拷也没关系 —— 内置了一份简中名对照表兜底，界面上仍然是中文。

## 脚本认得的目录结构

脚本能自动识别三种结构：完整安装目录、直接指向 `Data`、或只拷了 XML 的目录。

它会扫描 `Data/**/Defs/**/*.xml`（含 Royalty / Ideology / Biotech / Anomaly / Odyssey），
解析 `ThingDef`、处理 `ParentName` 继承，生成 `js/buildings.generated.js`。刷新页面后自动生效，无需改代码。

## 合并而不是覆盖

**它采取「合并」策略**，所以你没买全 DLC 也没关系：

| 情况 | 结果 |
| --- | --- |
| 内置库里有这个建筑 | 用精确值更新尺寸/电力等，**保留手工挑选的图标** |
| 本库没有、但游戏里有（比如你装的 mod） | 作为新条目追加 |
| **你未安装的 DLC** | 保留内置参考值，界面上仍标 `?` 提醒你核对 |

也就是说：装本体 → 本体部分全部精确；装了某几个 DLC → 那几个 DLC 也精确；没装的保持可用但标注待核对。

> 装了全部 DLC 时实测：277 条内置参考 → 拆成 262 条（77 条被精确覆盖、178 条来自游戏、其余合并去重），
> 其中 259 条能用上原版贴图。桥在 1.7 里已经是**地形**（从地板菜单造），所以本工具也把它放进了地板层；
> 混凝土护栏 / 电动研究台这两条是 1.7 里已经不存在的老条目，保留矢量图兜底。

## 脚本处理的要点

- 继承链（`ParentName` / `Name`，含抽象父类）
- `<size>`、`passability`、`holdsRoof`、`fillPercent`
- `<comps>` 里的 `CompProperties_Power` / `PowerPlant` / `Battery` / `Door`
- `<statBases>` 里的 `Beauty` / `MaxHitPoints`（耐久）/ `WorkToBuild`（工时）
- `<costList>` / `<costStuffCount>`（造价）、`<researchPrerequisites>`（科技前置）、
  `<constructionSkillPrerequisite>`（建造技能）、`<terrainAffordanceNeeded>`（地基要求）
- `stuffCategories`（可换材质的分类）、`designationCategory`（**在不在建筑师菜单里**）、
  `specialDisplayRadius`（作用范围）、所属 DLC

提取出来的每条建筑会带这些字段，物品栏的悬停提示里就能看到造价 / 工时 / 科技 / 技能 / 耐久。

> 装了全部 6 个 DLC 的 1.7 实测：游戏建筑师菜单里的东西 **一条不缺**（260 条），
> 其中只有 5 条不在菜单里（三个雕塑 + 万用电池 + 雕像，都是"做出来的"）。
> 可建造的地形（桥 / 重型桥 / 活铁板 / 逆重亚结构等）也在地板层里。

> 脚本只读取你本机的数值定义，输出的是尺寸/电力表格，**不包含也不分发任何游戏美术资源**。
