# 导出 / 导入

[← 返回 README](../README.md)

## 导出

| 格式 | 用途 |
| --- | --- |
| **蓝图 `.xml`** | ← 主推。Blueprints 模组的真蓝图，游戏里工人会消耗材料去建，**带每个建筑的材质与朝向** |
| **工程 JSON** | 完整保存你的规划（含地板、规划层、材质记忆），之后可以再打开继续改 |

## 导入

| 来源 | 用途 |
| --- | --- |
| **工程 JSON** | 恢复之前保存的规划 |
| **RimWorld 存档 `.rws`** | 把已经建好的基地读进来当底图（含每件家具的材质） |

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

### 更省事的做法

顶栏点「**存入 Blueprints**」，选一次那个文件夹，之后**一键直接写进去**，不用自己翻路径。

文件夹和 `Saves` 在同一层，游戏里 **选项 → 常规 → 打开存档数据文件夹** 就能看到。

> 浏览器安全限制：首次必须你手动选一次目录，之后浏览器会记住授权。
> 如果浏览器不支持目录写入（Firefox 部分版本），用「导出蓝图」下载再手动拷进去即可。

## 坐标与朝向

存档坐标完全照搬游戏的 `GenAdj.OccupiedRect` + `AdjustForRotation`（含「偶数尺寸按朝向平移中心」那一步），
实测在真实存档 **764 个建筑上冲突 0 格**。细节见 [textures.md 的「还原到什么程度」](textures.md#还原到什么程度)（绘制规则部分同理）。
