---
name: rimworld-autoplay
description: AI 自动游玩 RimWorld 的操作手册：暂停优先、小人安全、规划器配合、开局流程与踩过的坑。当要自己玩 RimWorld（通过 RimMolt MCP）时加载。
---

# RimWorld 自动游玩手册（实战总结）

## 0. 铁律

1. **落地先暂停。** 拿到殖民地第一件事 `set_speed pause`，把地形、小人、库存、装备全看清楚再动。
2. **有威胁立刻暂停 + 手动征召。** 只要出现「敌对」「猎杀人类」「袭击」字样：
   - `set_speed pause`
   - `draft({action:'draft', ids:'<具体 id>'})` —— **必须带 `ids`**，不带就是全殖民地一起征召。
   - **战斗用 `Auto attack (AI)` 派发**：`draft` → `inspect_thing <小人>` → `do_thing_action label='Auto attack (AI)' targetId=<敌人>`。小人会自己找掩体/保持射程，不用每 tick 手点。
   - 撤退时手动 `order_pawn` 往**队友/门/掩体**方向拉，一步一暂停。
   - **绝不让小人自己「逃跑」。** 原版的 Flee 会往远离威胁的方向直线跑，经常跑进地图角落被堵死。
3. **火力不足不打大动物。** 见第 6 节。
4. **每个大动作之前先存档 + 用规划器算。** `save_game({overwrite:true})` → `plan.js import` → 改 plan.json → `apply` / `validate` → `build-ops` → 逐条 `build()`。
5. **定期写日记。** 用 `say()` 发到游戏内，同时把文本落到本地 `diary/`（一个文件一段，别覆盖）。
6. **警报即任务**（见 0.5）。不处理就等着团灭。

---

## 0.5 警报即任务：把「苗头」当「事故」处理

**这是最容易犯、代价最大的错：等事件变严重才动手。**
Mod 本身**没有**给你优先级 SOP（`Knowledge.xml` 只有查表，`hints.xml` 只有单条工具提示），
所以这套节奏必须自己带。**唯一的优先级信号是 `get_alerts` 返回的 `priority` 和 `_threatWarning`。**

### 三条硬规则

1. **`get_alerts` 里出现的东西 = 待办事项，不是通知。** 每次轮询第一件事就是读它。
2. **Medium 级必须当天处理，High 级必须当场处理。** 不允许「等它变成 High 再说」。
3. **同一个警报连续出现 3 次 = 立刻停工。** 放下手上所有建造/研究，全员转去解决它，直到它从列表里消失。

### 阈值表（看到就动手，不要看它涨到多少）

| 信号 | 动手阈值 | 当次循环内就该做的事 |
|---|---|---|
| 食物 | 库存 < **6 天**口粮 | 加种速生作物（水稻）+ 采集野果 + 猎**小型**动物；< 3 天则全员食物优先 |
| 食物（已报警） | 任意 | 当天必须有至少一条产粮线在跑（田/猎/交易） |
| 防御 | 有围墙但**没有内层射击位/陷阱** | 当天补沙袋 + 陷阱 + 门后集火位 |
| 武器 | 任何**能战斗的人** `equipment` 为空 | 立刻 `manage_gear equip` + 30 秒内 `get_pawn tab=gear` 复核 |
| 护甲 | 前线无甲 | 优先给格斗/前排；`force` 锁住衣服 |
| 心情 | 任一 < **55**，或出现「崩溃风险」字样 | 补娱乐设施（象棋/马蹄钉）、单人卧室、地板、雕塑；查 `get_pawn tab=needs` 的减分项 |
| 娱乐/美观需求 | < 30% | 当天加娱乐类型（需要 3 种以上） |
| 医疗 | 有人受伤未治疗 / 感染 | 立刻 `order_pawn 救援/治疗`（**自动救援经常不触发，要手动下令**） |
| 电力 | 电网 0W、电池 0、发电机无燃料 | 当天补燃料或加发电；冷库断电 1 小时就要处理 |
| 冷库 | > −2°C | 查制冷机方向/功率/门是否漏气 |
| 建材 | 库存 < 下一个工程用量 | 先砍树/采石再下蓝图，不要造一堆空蓝图 |
| 蓝图滞留 | 有蓝图 **> 1 天**没建完 | 查材料、可达性、建造优先级、是否被墙挡住操作位 |
| 敌对生物 | 任何 `_threatWarning` | 暂停 → 判断能不能打 → 能打就 Auto attack 集火，不能打就全员进屋关门 |
| 捕食者/发疯动物 | 进入基地 30 格 | 同上；**不要用「逃跑」当方案** |

### 每天固定的三次体检

在 `wait_for_event` 之间，至少每游戏半天跑一次：

```
get_alerts            # 有没有新待办
get_resources         # 食物/木材/钢材/零部件
list_colonists        # 心情、健康、在干什么
```

**出现以下任意一条，立即插队处理，不要继续盖房子：**
- 食物 < 6 天
- 有人 equipment 为空
- 有人受伤/倒地
- 有敌对单位在 50 格内
- 冷库温度 > −2°C
- 任一殖民者心情 < 55

### 预防优先于补救

- 第 1–3 天就要有：**水/粮田 + 冷库 + 围墙 + 两把枪**
- 第 4–6 天就要有：**单人卧室（或至少不挤）+ 娱乐设施 + 陷阱/射击位**
- 每次招到新人、每次打完仗、每次换季，都重跑一遍上面的体检。
- **宁可少盖一间房，也不要让警报挂着。** 补一间房的成本，远低于团灭重开。

---

## 1. 新开局的顺序（照抄）

```
game_setup_status → main_menu new_colony
select_scenario 迫降
select_storyteller Randy / Rough / reloadAnytime:false
create_world → 轮询 game_setup_status
find_world_tiles biome=温带森林 maxHilliness=LargeHills tempMin=5 tempMax=22
get_world_tile <tile> → select_starting_site{tile} → 再调一次 confirm:true
choose_ideoligion fluid → edit_ideoligion next_step ×N → finalize
edit_starting_pawn：reorder 把想要的人换进前三位 → confirm
start_game → 轮询到 programState=Playing
```

**开局人选**（3 人）：射击 + 建造/手工、医疗 + 智识、种植 + 烹饪 + 采矿。
避开：纵火狂（会放火）、脆弱、脑子慢（组合太多就换人）。

**落地立刻做的事（都在暂停下完成）：**
1. `Designator_Unforbid` 扫一遍坠机区（**坠机物资默认是「禁止」的**，不解禁就永远缺木头缺钢）。
2. `list_things item verbose` 找出枪/甲，`manage_gear` 给每个人装上。

### ⚠️ 装备武器（最容易翻车的一步，必须反复确认）

**踩过两次的坑：`manage_gear op:equip` 返回 `ok:true … walking to it`，
几小时后一查 `get_pawn(tab:'gear')`，三个人`equipment: []`——枪还在原地躺着。**
装备是「一次性指令」，任何打断（睡觉、吃饭、建造、征召）都可能让它作废。

规则：
1. **先 `set_speed pause`**，在暂停状态下发 `equip`，再 unpause，让它专心走过去。
2. 发完 **30 秒内用 `get_pawn({id, tab:'gear'})` 复核 `equipment` 字段**。
3. **没装上就再发一次**，直到 `equipment` 里出现枪为止。
4. 之后**每次 `wait_for_event` 返回有 letter / 打完仗 / 换班之后，都抽查一次 gear**。
5. 弹药不存在的时代，枪就是命。宁可少建一面墙，也不能让殖民地两个能打的人空手。
6. `op:'force'` **只对衣服有效**（"force/unforce only apply to worn apparel"），
   武器只能 `equip`，衣服用 `force` 才能真正锁住不被换掉。
7. 装备前确认物件 `allowed:true`（在 `Designator_Unforbid` 之后），否则会静默失败。
3. 建储存区（`Designator_ZoneAddStockpile_Resources`）+ 种植区（`Designator_ZoneAdd_Growing`，默认土豆，改成 `Plant_Rice`）。
4. Work 优先级（见第 2 节）。
5. 砍树：`Designator_PlantsHarvestWood` 扫大矩形，`applied` 是实际树数。

---

## 2. 工作优先级（3 人标准配置）

| 工作 | 建造手 | 医生/研究 | 农夫/厨师 |
|---|---|---|---|
| Firefighter | 1 | 1 | 1 |
| Doctor | – | 1 | 3 |
| Research | 4 | 1 | – |
| Construction | 1 | 4 | 2 |
| Growing | 3 | 3 | 1 |
| Cooking | – | – | 1 |
| Mining | 3 | 2 | 2 |
| PlantCutting | 3 | 4 | 2 |
| Hauling | 1~2 | 2 | 2 |
| Cleaning | 3 | 2 | 2 |

**坑：WorkTypeDef 用英文原名**：`Construction / Growing / Mining / PlantCutting / Crafting / Hauling / Cleaning / Hunting / Cooking / Doctor / Research / Firefighter`。

**坑：同优先级时按工作列表顺序取活，PlantCutting 永远压过 Hauling。**
所以「砍树」和「搬运」都设 1 级时，木头只会躺在地上，储存区永远空。
要么把搬运设 1、砍树设 2；要么就别指望仓库里有东西（地上有木头其实也能直接盖）。

**坑：研究永远排不上。** 医生/研究者把 Research 设 1、Construction 设 4，否则他一辈子在搬砖。

---

## 3. 建造的坑

- **工作台有「操作位 / interactionCell」**，被墙挡住就放不下去，报「操作点被木墙挡住」。放之前看 `build()` 返回的 `placement.interactionCell`，或者干脆让 `rot` 转 180° 把操作位翻进屋里。
- **同一个操作位不能给两个工作台用**（「互动区会与…重叠」）。挪位置。
- **制冷机方向**：`inspect_thing` 返回 `directionalHint`：`coldSideCell` 是蓝色出冷端，`exhaustSideCell` 是排热端。**冷端必须朝房间内**，热端朝室外。装反了拆了重装（游戏里没有旋转按钮）。
  - 经验值：墙在 z=101、房间在 z<101 时，`rot=0` 冷端在 z-1（朝房间），`rot=2` 冷端在 z+1（朝外）。
- **制冷机目标温度不会自动设**，要 `do_thing_action` 点 `-10C` / `-1C` 的 gizmo。
- **屠宰台别放冷库**：太冷 → 工作速度暴跌、小人难受。放厨房/工坊。
- 制冷机耗电 200W。木柴发电机 1000W 但要**烧木头**，没木头 = 0W。太阳能要 `SolarPanels` 科技 + 蓄电池。
- 建造**会失败**（随机），失败浪费材料。手艺人建造等级低时更频繁，重要建筑多备料。

---

## 4. 规划器（planner）配合

`D:\Downloads\play\rimworld-planner.single.html` 是网页版；命令行更快：

```bash
node tools/plan.js import "<Saves/xxx.rws>"   # 读地形/小人/科技/库存
node tools/plan.js apply plan.json
node tools/plan.js validate                   # error 必须 0
node tools/plan.js build-ops --no-prep        # → build() 调用列表
```

- **plan.json 里必须一格一条** `{def,x,z}`。`fill:"filled"` 只是 `build-ops` 的输出格式，**写进 plan.json 会被忽略**。矩形墙用脚本生成。
- 坐标就是游戏坐标（x 右，z 上）。**别自己算多格建筑的锚点**，用 build-ops 给的。
- 存档必须新：`save_game({overwrite:true})` 后再 `import`，比对 `tick`。
- 规划器不认识的 def（如 `Table2x2` 实际叫 `Table2x2c`）会报错，用 `plan.js describe` 查真名，或者直接在游戏里 `build()`。

---

## 5. 食物与心情

- 开局 5 份包装食物只够 1 天。**第一天就要种水稻**（3 天成熟），并安排搬运。
- 坠机地图上除了残骸还会有别的货舱，`list_things item summary` 别只看脚下一块。
- 丧气来源：可怕的多人宿舍 −7、丑陋的环境 −5、睡眠被打扰（多人同房）。
  → 尽早每人一间 4×5 卧室，床 `assign_building action:assign` 指定主人。
- 娱乐类型不足会报警：象棋桌（益智）+ 马蹄钉（灵巧）便宜好用。
- 昼夜：作物夜里休眠，`已生长 27%` 在凌晨是正常的，别慌。

---

## 6. 战斗：血的教训

**事件：第 1 卷，第 8 天，一头大地懒被猎枪打伤后进入「猎杀人类」，追着 Jet 跑遍半张地图，Jet 倒在 210,199，左臂左腿全身抓伤，殖民地差点崩。**
**事件二：第 2 卷开局，两把枪在地上躺了两天没人拿——因为 equip 指令被打断后没有复核。**

**规则：**
0. **开打前先 `get_pawn(tab:'gear')` 确认每个人都真的拿着枪。** 空手的人不许上前线。
1. **火力不足（只有 1~2 把低阶枪、没有护甲、没人医疗跟队）时，不猎大型/高血量动物。**
   - 大地懒 450 HP、獠牙 30 伤害；狼獾、熊、犀牛同理。
   - 安全目标：兔子、松鼠、火鸡、羊驼、鹿这类，且**离基地 20 格以内**。
   - 打猎前 `get_pawn` 看一眼目标血量/种类，`list_things category:pawn faction:wild` 看距离。
2. **猎人不要单独跑远。** 超过 30 格的目标不值得。
3. **动物一旦「猎杀人类」，它就不再怕人，会追到天涯海角。** 这时：
   - 暂停，征召**所有**能打的人，集火；或者
   - 全员拉进房间关门（它会拆门，所以要么能打死，要么放弃基地躲远）。
4. **征召走位**：一步一暂停。远程站成一线（沙袋后），近战蹲门口。**永远往队友方向撤，不要背对地图边缘跑。**
5. **倒地的小人**：`list_colonists` 看 `downed`，立刻派医生 `救援`（Doctor 优先级 1，AI 会自动去）。**救援路线要避开威胁**，必要时先派人把威胁引开。
6. 日常就要准备：沙袋、地板门、陷阱走廊。警报「缺少防御工事」出现时，当天就该动手。

---

## 7. 常用工具速查

| 目的 | 工具 |
|---|---|
| 读全图地形 | `get_area render:'ascii' scale:5`（粗）/ 规划器 `render`（精确到格） |
| 找敌人 | `list_things category:'pawn' faction:'hostile'` |
| 看小人 | `list_colonists` / `get_pawn tab:'health'/'needs'/'gear'` |
| 征召 | `draft {action:'draft', ids:'Human776'}` |
| 走位/交互 | `order_pawn {id, x, z}` 先返回选项列表，再带 `index` 执行 |
| 建东西 | `build {def, x, z, rot, stuff}` 看 `reason` / `rejected` |
| 区域 | `designate Designator_ZoneAddStockpile_Resources / _Growing / AreaHomeExpand` |
| 解禁 | `designate Designator_Unforbid` 矩形 |
| 工作台清单 | `list_recipes{id}` → `add_bill` |
| 电力 | `list_power_grids`（看谁没电、谁没接上） |
| 事件 | `wait_for_event{seconds:60}`，返回 letter 就 `read_letter` |
| 截图 | `screenshot{include_ui:false}`（很吃上下文，少用） |

---

## 8. 节奏建议

- 每次 `wait_for_event` 45~60 秒（约 1 个游戏小时），有 letter / forcePaused 立刻处理。
- 每天至少一次：看 `get_alerts`（食物/防御/娱乐报警）、`get_resources`、`list_colonists` 的心情。
- 每 2~3 天写一篇日记。
- 大工程（宿舍、围墙、冷库、电站）走规划器；小家具直接 `build()`。
