/*
 * data.js —— 建筑数据库 + 地板 + 计划配色
 *
 * 说明（重要）：
 *   这里的格子尺寸/电力数值是「手工整理的参考值」，方向(横/竖)可以用 R 键旋转调整。
 *   标了 v:1 的条目表示「尺寸可能随版本变动，请以游戏内为准」。
 *   想要 100% 精确的完整数据（原版+全 DLC+所有 mod），请运行：
 *       python3 tools/extract_defs.py "<RimWorld 安装目录>"
 *   生成的 buildings.generated.js 会被 index.html 自动优先加载。
 *
 * tags 图例：
 *   solid   实体障碍（阻挡通行）
 *   room    参与房间围合（墙 / 门 / 栅栏一类）
 *   door    门（可通行）
 *   roof    可支撑屋顶
 *   cover   提供掩体
 *   conduit 电缆，参与电网
 *   power   用电/发电设备，参与电网
 *   gen     发电
 *   store   储电
 *   light   光源
 *   temp    温控设备
 *   turret  炮塔
 *   bed     床
 *   onwall  可贴墙安装（与墙共存同一格）
 *   outdoor 室外设施（不围合房间）
 */

(function (global) {
  'use strict';

  // 分类完全对应游戏建筑师菜单（DesignationCategoryDef）
  // 结构 / 生产 / 家具 / 电力 / 防卫 / 杂项 / 地板 / 娱乐 / 温度 / 区域
  var CATEGORIES = [
    { id: 'structure', name: '结构' },
    { id: 'production', name: '生产' },
    { id: 'furniture', name: '家具' },
    { id: 'power', name: '电力' },
    { id: 'security', name: '防卫' },
    { id: 'temperature', name: '温度' },
    { id: 'joy', name: '娱乐' },
    { id: 'statue', name: '雕像纪念' },
    { id: 'ritual', name: '仪式祭祀' },
    { id: 'funeral', name: '丧葬' },
    { id: 'tech', name: '科幻科技' },
    { id: 'misc', name: '杂项' }
  ];

  // 常用「地板层」贴图（只影响观感，不参与校验）
  //   def   = 游戏里的 TerrainDef（导入游戏资源 / 存档地形都用它对齐）
  //   aff   = 建造这块地板需要的地形 affordance（游戏里地板默认 Heavy，桥是 Bridgeable）
  //   cost / work = 没有导入游戏数据时的参考造价与工时
  var FLOORS = [
    { id: 'none', name: '无（泥土）', color: '#4a4034', art: 'dirt', def: 'Soil', aff: null },
    { id: 'wood', name: '木地板', color: '#8a6a45', art: 'planks', def: 'WoodPlankFloor', aff: 'Heavy', cost: { WoodLog: 3 }, work: 85 },
    { id: 'stone', name: '石砖', color: '#8d8d88', art: 'tile', def: 'FlagstoneGranite', aff: 'Heavy', cost: { BlocksGranite: 1 }, work: 100 },
    { id: 'tileSandstone', name: '砂岩砖', color: '#b9a882', art: 'tile', def: 'TileSandstone', aff: 'Heavy', cost: { BlocksSandstone: 1 }, work: 200 },
    { id: 'tileGranite', name: '花岗岩砖', color: '#8f8b8b', art: 'tile', def: 'TileGranite', aff: 'Heavy', cost: { BlocksGranite: 1 }, work: 200 },
    { id: 'tileLimestone', name: '石灰岩砖', color: '#c0bda8', art: 'tile', def: 'TileLimestone', aff: 'Heavy', cost: { BlocksLimestone: 1 }, work: 200 },
    { id: 'tileSlate', name: '板岩砖', color: '#6f7378', art: 'tile', def: 'TileSlate', aff: 'Heavy', cost: { BlocksSlate: 1 }, work: 200 },
    { id: 'tileMarble', name: '大理石砖', color: '#d8d6cf', art: 'tile', def: 'TileMarble', aff: 'Heavy', cost: { BlocksMarble: 1 }, work: 200 },
    { id: 'tileAncient', name: '远古砖', color: '#9a8f7a', art: 'tile', def: 'AncientTile', aff: null },
    { id: 'metalTile', name: '金属砖', color: '#8fa0ad', art: 'tile', def: 'MetalTile', aff: 'Heavy', cost: { Steel: 1 }, work: 200 },
    { id: 'goldTile', name: '金砖', color: '#c9a63c', art: 'tile', def: 'GoldTile', aff: 'Heavy', cost: { Gold: 1 }, work: 200 },
    { id: 'silverTile', name: '银砖', color: '#b9c2c9', art: 'tile', def: 'SilverTile', aff: 'Heavy', cost: { Silver: 1 }, work: 200 },
    { id: 'concrete', name: '混凝土', color: '#9a9a97', art: 'concrete', def: 'Concrete', aff: 'Heavy', cost: { Steel: 1 }, work: 100 },
    { id: 'steel', name: '钢制地板', color: '#6f7883', art: 'tile', def: 'MetalTile', aff: 'Heavy', cost: { Steel: 1 }, work: 200 },
    { id: 'sterile', name: '无菌地板', color: '#c9d4dc', art: 'tile', def: 'SterileTile', aff: 'Heavy', cost: { Steel: 1, ComponentIndustrial: 1 }, work: 400 },
    { id: 'carpet', name: '地毯', color: '#7a4a52', art: 'carpet', def: 'Carpet_Mindbend', aff: 'Heavy', cost: { Cloth: 7 }, work: 100 },
    { id: 'paved', name: '铺装砖', color: '#7d7367', art: 'tile', def: 'PavedTile', aff: 'Heavy', cost: { Steel: 2 }, work: 300 },
    { id: 'bridge', name: '桥', color: '#6c4e37', art: 'bridge', def: 'Bridge', aff: 'Bridgeable', cost: { WoodLog: 12 }, work: 1500 },
    // 以下三条按游戏 1.7 的 TerrainDef 补齐（Odyssey / Biotech）
    { id: 'heavyBridge', name: '重型桥', color: '#808080', art: 'bridge', def: 'HeavyBridge', aff: 'Bridgeable', cost: { Steel: 14 }, work: 2500, research: ['HeavyBridges'], dlc: 'Odyssey' },
    { id: 'bioferritePlate', name: '活铁板', color: '#645050', art: 'tile', def: 'BioferritePlate', aff: 'Heavy', cost: { Bioferrite: 4 }, work: 800, skillReq: 3, research: ['BioferriteShaping'], dlc: 'Biotech' },
    { id: 'substructure', name: '逆重亚结构', color: '#6a6f74', art: 'tile', def: 'Substructure', aff: 'Heavy', cost: { GravlitePanel: 1, Steel: 4 }, work: 600, dlc: 'Odyssey' },
    { id: 'water', name: '水面', color: '#2f5a7a', art: 'water', def: 'WaterShallow', aff: null }
  ];

  // ------------------------------------------------------------------
  // 地形（TerrainDef）与山体（自然岩石 ThingDef）
  // 存档里的地形是「defName 的短哈希」：hash = hash*31 + charCode，再 % 65535。
  // 这里内置一份常见地形兜底；导入游戏资源后会被完整表覆盖。
  // ------------------------------------------------------------------
  var L = ['Light'], LM = ['Light', 'Medium'], LMH = ['Light', 'Medium', 'Heavy'];
  var TERRAIN_FALLBACK = [
    { def: 'Soil', name: '土壤', color: '#4a4034', aff: LMH.concat(['GrowSoil', 'Diggable']) },
    { def: 'SoilRich', name: '肥沃土壤', color: '#3f3a2c', aff: LMH.concat(['GrowSoil', 'Diggable']) },
    { def: 'Gravel', name: '碎石地', color: '#5d5a52', aff: LMH.concat(['GrowSoil', 'Diggable']) },
    { def: 'MossyTerrain', name: '苔藓地', color: '#46503c', aff: LMH.concat(['GrowSoil', 'Diggable']) },
    { def: 'Riverbank', name: '河岸', color: '#6b5c44', aff: LMH.concat(['GrowSoil', 'Diggable']) },
    { def: 'Sand', name: '沙地', color: '#b6a077', aff: LMH.concat(['Diggable']) },
    { def: 'SoftSand', name: '软沙', color: '#c2ad84', aff: L.concat(['Diggable']) },
    { def: 'MarshyTerrain', name: '沼泽', color: '#3d4a32', aff: L.concat(['GrowSoil', 'Diggable', 'Bridgeable']) },
    { def: 'Mud', name: '泥地', color: '#4a3d2f', aff: ['Bridgeable', 'WaterproofConduitable'] },
    { def: 'Marsh', name: '浅滩', color: '#2f4a4f', aff: ['Bridgeable', 'WaterproofConduitable'] },
    { def: 'Ice', name: '冰面', color: '#b9d4dd', aff: LMH },
    { def: 'IceDeep', name: '厚冰', color: '#a9c8d4', aff: [] },
    { def: 'IceSheet', name: '冰原', color: '#c4dde5', aff: LMH },
    { def: 'WaterShallow', name: '浅水', color: '#2f5a7a', aff: ['ShallowWater', 'WaterproofConduitable', 'Bridgeable', 'Walkable'] },
    { def: 'WaterDeep', name: '深水', color: '#1e3c55', aff: [] },
    { def: 'WaterOceanShallow', name: '浅海', color: '#2a5a78', aff: ['ShallowWater', 'WaterproofConduitable', 'Bridgeable', 'Walkable'] },
    { def: 'WaterOceanDeep', name: '深海', color: '#17344d', aff: [] },
    { def: 'WaterMovingShallow', name: '浅流动水', color: '#2b617f', aff: ['ShallowWater', 'WaterproofConduitable', 'Bridgeable', 'Walkable', 'MovingFluid'] },
    { def: 'WaterMovingChestDeep', name: '齐胸流动水', color: '#224f6b', aff: ['Bridgeable', 'Walkable', 'MovingFluid'] },
    { def: 'LavaShallow', name: '浅岩浆', color: '#8a3a14', aff: [] },
    { def: 'LavaDeep', name: '深岩浆', color: '#6d2a0d', aff: [] },
    { def: 'Bridge', name: '木桥', color: '#6c4e37', aff: L },
    { def: 'HeavyBridge', name: '重型桥', color: '#6a4c35', aff: L },
    { def: 'AncientHeavyBridge', name: '远古重型桥', color: '#5f5244', aff: L },
    { def: 'Concrete', name: '混凝土', color: '#8c8c8c', aff: LMH },
    { def: 'PavedTile', name: '铺装砖', color: '#8c8c8c', aff: LMH },
    { def: 'WoodPlankFloor', name: '木地板', color: '#6c4e37', aff: LMH },
    { def: 'SterileTile', name: '无菌地板', color: '#b9c4cc', aff: LMH },
    { def: 'MetalTile', name: '金属砖', color: '#8fa0ad', aff: LMH },
    { def: 'GoldTile', name: '金砖', color: '#c9a63c', aff: LMH },
    { def: 'SilverTile', name: '银砖', color: '#b9c2c9', aff: LMH },
    { def: 'AncientTile', name: '远古砖', color: '#9a8f7a', aff: LMH },
    { def: 'AncientConcrete', name: '远古混凝土', color: '#8a857a', aff: LMH },
    { def: 'BrokenAsphalt', name: '破损沥青', color: '#4a4a4a', aff: LMH.concat(['Walkable']) },
    { def: 'PackedDirt', name: '压实土', color: '#5a4b3a', aff: LMH.concat(['Walkable']) },
    { def: 'RockFloor', name: '岩地', color: '#5b5854', aff: LMH },
    { def: 'VolcanicRock', name: '火山岩', color: '#3f3a38', aff: LMH.concat(['SmoothableStone']) },
    { def: 'FungalGravel', name: '真菌碎石', color: '#4d4a3a', aff: LMH.concat(['GrowSoil', 'Diggable']) },
    { def: 'ToxicMarsh', name: '毒沼泽', color: '#3f4a28', aff: L.concat(['Bridgeable']) },
    { def: 'Underwall', name: '墙下', color: '#2a2a2a', aff: [] },
    { def: 'Space', name: '太空', color: '#0a0a12', aff: [] },
    { def: 'Substructure', name: '支撑结构', color: '#555b60', aff: LMH }
  ];
  // 地板砖的 defName（导入游戏数据后会补全所有石材）
  ['Sandstone', 'Granite', 'Limestone', 'Slate', 'Marble'].forEach(function (s) {
    TERRAIN_FALLBACK.push({ def: 'Tile' + s, name: s + '砖', color: '#8d8d88', aff: LMH });
    TERRAIN_FALLBACK.push({ def: 'Flagstone' + s, name: s + '石板', color: '#8d8d88', aff: LMH });
    TERRAIN_FALLBACK.push({ def: 'FineTile' + s, name: '精致' + s + '砖', color: '#8d8d88', aff: LMH });
  });

  // 自然岩石：山体。hp 用来估开采时间；mineableThing 是挖出来的东西。
  var ROCK_FALLBACK = [
    { def: 'Sandstone', name: '砂岩', hp: 400, mineableThing: 'ChunkSandstone', color: '#7e685e' },
    { def: 'Granite', name: '花岗岩', hp: 900, mineableThing: 'ChunkGranite', color: '#695f61' },
    { def: 'Limestone', name: '石灰岩', hp: 700, mineableThing: 'ChunkLimestone', color: '#a49e8c' },
    { def: 'Slate', name: '板岩', hp: 500, mineableThing: 'ChunkSlate', color: '#464646' },
    { def: 'Marble', name: '大理石', hp: 600, mineableThing: 'ChunkMarble', color: '#b8b4a8' },
    { def: 'MineableSteel', name: '压缩钢', hp: 1500, mineableThing: 'Steel', yield: 40, resource: true },
    { def: 'MineableSilver', name: '银矿', hp: 1500, mineableThing: 'Silver', yield: 40, resource: true },
    { def: 'MineableGold', name: '金矿', hp: 1500, mineableThing: 'Gold', yield: 40, resource: true },
    { def: 'MineableUranium', name: '铀矿', hp: 1500, mineableThing: 'Uranium', yield: 40, resource: true },
    { def: 'MineablePlasteel', name: '玻璃钢矿', hp: 1500, mineableThing: 'Plasteel', yield: 40, resource: true },
    { def: 'MineableJade', name: '玉矿', hp: 1500, mineableThing: 'Jade', yield: 40, resource: true },
    { def: 'MineableComponentsIndustrial', name: '压缩零部件', hp: 1500, mineableThing: 'ComponentIndustrial', yield: 1, resource: true }
  ];

  // 建筑数据。size:[宽, 深]（未旋转时）。power* 单位为 W。
  var BUILDINGS = [
    /* ---------------- 结构 ---------------- */
    { id: 'wall', name: '墙', en: 'Wall', cat: 'structure', size: [1, 1], art: 'wall', tags: ['solid', 'room', 'roof'], hp: 100, stuff: true, beauty: 0 },
    { id: 'door', name: '门', en: 'Door', cat: 'structure', size: [1, 1], art: 'door', tags: ['door', 'room', 'roof'], hp: 100, stuff: true },
    { id: 'autodoor', name: '自动门', en: 'Autodoor', cat: 'structure', size: [1, 1], art: 'autodoor', tags: ['door', 'room', 'roof', 'power'], powerUse: 25, hp: 140, stuff: true },
    { id: 'fence', name: '栅栏', en: 'Fence', cat: 'structure', size: [1, 1], art: 'fence', tags: ['solid', 'room'], hp: 80, stuff: true },
    { id: 'fence_gate', name: '栅栏门', en: 'Fence Gate', cat: 'structure', size: [1, 1], art: 'fencegate', tags: ['door', 'room'], hp: 80, stuff: true },
    { id: 'column', name: '柱子', en: 'Column', cat: 'structure', size: [1, 1], art: 'column', tags: ['solid', 'roof'], hp: 150, stuff: true },
    { id: 'sandbags', name: '沙袋', en: 'Sandbags', cat: 'structure', size: [1, 1], art: 'sandbag', tags: ['solid', 'cover', 'outdoor'], hp: 60 },
    { id: 'barricade', name: '路障', en: 'Barricade', cat: 'structure', size: [1, 1], art: 'barricade', tags: ['solid', 'cover', 'outdoor'], hp: 70 },
    // 桥在 1.7 里是「地形」（从地板菜单造），所以归到地板层，见 FLOORS
    { id: 'animal_flap', name: '动物通道门', en: 'Animal Flap', cat: 'structure', size: [1, 1], art: 'flap', tags: ['door', 'room'], hp: 60, stuff: true },
    { id: 'wall_lamp', name: '壁灯', en: 'Wall Lamp', cat: 'structure', size: [1, 1], art: 'walllamp', tags: ['light', 'power', 'onwall'], powerUse: 21, beauty: 0 },

    /* ---------------- 家具 ---------------- */
    { id: 'sleeping_spot', name: '睡眠点', en: 'Sleeping Spot', cat: 'furniture', size: [1, 1], art: 'spot', tags: ['bed'], beauty: 0, v: 1 },
    { id: 'double_sleeping_spot', name: '双人睡眠点', en: 'Double Sleeping Spot', cat: 'furniture', size: [2, 2], art: 'spot2', tags: ['bed'], beauty: 0, v: 1 },
    { id: 'bed', name: '床', en: 'Bed', cat: 'furniture', size: [1, 2], art: 'bed', tags: ['bed'], beauty: 4, hp: 100, stuff: true },
    { id: 'double_bed', name: '双人床', en: 'Double Bed', cat: 'furniture', size: [2, 2], art: 'bed2', tags: ['bed'], beauty: 6, hp: 100, stuff: true },
    { id: 'royal_bed', name: '皇家床', en: 'Royal Bed', cat: 'furniture', size: [2, 3], art: 'bed2', tags: ['bed'], beauty: 40, dlc: 'Royalty', v: 1, stuff: true },
    { id: 'hospital_bed', name: '病床', en: 'Hospital Bed', cat: 'furniture', size: [1, 2], art: 'hospbed', tags: ['bed'], beauty: 4, hp: 100, stuff: true },
    { id: 'crib', name: '婴儿床', en: 'Crib', cat: 'furniture', size: [1, 1], art: 'crib', tags: ['bed'], beauty: 8, dlc: 'Biotech', stuff: true },
    { id: 'bedroll', name: '睡袋', en: 'Bedroll', cat: 'furniture', size: [1, 2], art: 'bedroll', tags: ['bed'], beauty: 0 },
    { id: 'double_bedroll', name: '双人睡袋', en: 'Double Bedroll', cat: 'furniture', size: [2, 2], art: 'bedroll2', tags: ['bed'], beauty: 0, v: 1 },
    { id: 'animal_bed', name: '动物床', en: 'Animal Bed', cat: 'furniture', size: [1, 2], art: 'bed', tags: ['bed'], beauty: 4, stuff: true, v: 1 },
    { id: 'animal_sleeping_box', name: '动物睡箱', en: 'Animal Sleeping Box', cat: 'furniture', size: [1, 2], art: 'crib', tags: ['bed'], beauty: 2, stuff: true, v: 1 },
    { id: 'slab_bed', name: '石板床', en: 'Slab Bed', cat: 'furniture', size: [1, 2], art: 'bed', tags: ['bed'], beauty: 0, v: 1, dlc: 'Odyssey' },

    { id: 'table_1x2', name: '桌子 1x2', en: 'Table (1x2)', cat: 'furniture', size: [1, 2], art: 'table', tags: ['solid'], beauty: 6, stuff: true },
    { id: 'table_2x2', name: '桌子 2x2', en: 'Table (2x2)', cat: 'furniture', size: [2, 2], art: 'table', tags: ['solid'], beauty: 8, stuff: true },
    { id: 'table_2x4', name: '桌子 2x4', en: 'Table (2x4)', cat: 'furniture', size: [2, 4], art: 'table', tags: ['solid'], beauty: 10, stuff: true },
    { id: 'table_3x3', name: '桌子 3x3', en: 'Table (3x3)', cat: 'furniture', size: [3, 3], art: 'table', tags: ['solid'], beauty: 12, stuff: true },
    { id: 'stool', name: '凳子', en: 'Stool', cat: 'furniture', size: [1, 1], art: 'stool', beauty: 4, stuff: true },
    { id: 'dining_chair', name: '餐椅', en: 'Dining Chair', cat: 'furniture', size: [1, 1], art: 'chair', beauty: 6, stuff: true },
    { id: 'armchair', name: '扶手椅', en: 'Armchair', cat: 'furniture', size: [1, 1], art: 'chair', beauty: 20, stuff: true },
    { id: 'dresser', name: '梳妆台', en: 'Dresser', cat: 'furniture', size: [1, 2], art: 'dresser', beauty: 12, stuff: true, v: 1 },
    { id: 'end_table', name: '床头柜', en: 'End Table', cat: 'furniture', size: [1, 1], art: 'table', beauty: 8, stuff: true },
    { id: 'shelf', name: '置物架', en: 'Shelf', cat: 'furniture', size: [2, 1], art: 'shelf', beauty: 0, stuff: true, v: 1 },
    { id: 'plant_pot', name: '花盆', en: 'Plant Pot', cat: 'furniture', size: [1, 1], art: 'pot', beauty: 8 },
    { id: 'sculpture_small', name: '小型雕塑', en: 'Small Sculpture', cat: 'furniture', size: [1, 1], art: 'statue', tags: ['solid'], beauty: 30, stuff: true },
    { id: 'sculpture_large', name: '大型雕塑', en: 'Large Sculpture', cat: 'furniture', size: [2, 2], art: 'statue', tags: ['solid'], beauty: 100, stuff: true, v: 1 },
    { id: 'sculpture_grand', name: '巨型雕塑', en: 'Grand Sculpture', cat: 'furniture', size: [3, 3], art: 'statue', tags: ['solid'], beauty: 220, stuff: true, v: 1 },
    { id: 'torch_lamp', name: '火把', en: 'Torch Lamp', cat: 'furniture', size: [1, 1], art: 'torch', tags: ['light'], beauty: 4 },
    { id: 'standing_lamp', name: '立灯', en: 'Standing Lamp', cat: 'furniture', size: [1, 1], art: 'lamp', tags: ['light', 'power'], powerUse: 21, beauty: 4 },
    { id: 'sun_lamp', name: '太阳灯', en: 'Sun Lamp', cat: 'furniture', size: [1, 1], art: 'sunlamp', tags: ['light', 'power'], powerUse: 1600, beauty: 0, v: 1 },
    { id: 'brazier', name: '火盆', en: 'Brazier', cat: 'furniture', size: [1, 1], art: 'brazier', tags: ['light', 'temp'], beauty: 4, stuff: true },
    { id: 'meditation_throne', name: '冥想王座', en: 'Meditation Throne', cat: 'furniture', size: [1, 1], art: 'throne', tags: ['solid'], beauty: 15, dlc: 'Royalty', stuff: true },
    { id: 'grand_meditation_throne', name: '大冥想王座', en: 'Grand Meditation Throne', cat: 'furniture', size: [3, 2], art: 'throne', tags: ['solid'], beauty: 30, dlc: 'Royalty', stuff: true },
    { id: 'school_desk', name: '课桌', en: 'School Desk', cat: 'furniture', size: [2, 1], art: 'table', tags: ['solid'], beauty: 0, dlc: 'Biotech', stuff: true },

    /* ---------------- 生产 ---------------- */
    { id: 'crafting_spot', name: '手工制作点', en: 'Crafting Spot', cat: 'production', size: [1, 1], art: 'spot', beauty: 0, v: 1 },
    { id: 'stonecutter', name: '切石台', en: "Stonecutter's Table", cat: 'production', size: [2, 1], art: 'bench', beauty: 0, stuff: true, v: 1 },
    { id: 'butcher_table', name: '屠宰台', en: 'Butcher Table', cat: 'production', size: [3, 1], art: 'butcher', beauty: 0, stuff: true, v: 1 },
    { id: 'hand_tailor_bench', name: '手工缝纫台', en: 'Hand Tailoring Bench', cat: 'production', size: [2, 1], art: 'bench', beauty: 0, stuff: true, v: 1 },
    { id: 'electric_tailor_bench', name: '电动缝纫台', en: 'Electric Tailoring Bench', cat: 'production', size: [2, 1], art: 'bench', tags: ['power'], powerUse: 210, beauty: 0, stuff: true, v: 1 },
    { id: 'sculpting_table', name: '雕塑台', en: 'Sculpting Table', cat: 'production', size: [3, 1], art: 'statuebench', tags: ['solid'], beauty: 0, stuff: true, v: 1 },
    { id: 'research_bench', name: '研究台', en: 'Simple Research Bench', cat: 'production', size: [2, 1], art: 'bench', beauty: 0, stuff: true, v: 1 },
    { id: 'hi_tech_research_bench', name: '高科技研究台', en: 'Hi-Tech Research Bench', cat: 'production', size: [3, 2], art: 'bench2', tags: ['power'], powerUse: 250, beauty: 0, stuff: true, v: 1 },
    { id: 'multi_analyzer', name: '多重分析仪', en: 'Multi Analyzer', cat: 'production', size: [2, 1], art: 'analyzer', tags: ['power'], powerUse: 100, beauty: 0, v: 1 },
    { id: 'drug_lab', name: '制药台', en: 'Drug Lab', cat: 'production', size: [2, 1], art: 'bench', beauty: 0, stuff: true, v: 1 },
    { id: 'stove_fuel', name: '燃料灶', en: 'Fueled Stove', cat: 'production', size: [2, 1], art: 'stove', beauty: 0, stuff: true, v: 1 },
    { id: 'stove_electric', name: '电灶', en: 'Electric Stove', cat: 'production', size: [2, 1], art: 'stove', tags: ['power'], powerUse: 350, beauty: 0, stuff: true, v: 1 },
    { id: 'smithy', name: '锻造台', en: 'Fueled Smithy', cat: 'production', size: [3, 1], art: 'bench', beauty: 0, stuff: true, v: 1 },
    { id: 'electric_smithy', name: '电动锻造台', en: 'Electric Smithy', cat: 'production', size: [3, 1], art: 'bench', tags: ['power'], powerUse: 210, beauty: 0, stuff: true, v: 1 },
    { id: 'machining_table', name: '机械加工台', en: 'Machining Table', cat: 'production', size: [3, 1], art: 'bench2', tags: ['power'], powerUse: 210, beauty: 0, stuff: true, v: 1 },
    { id: 'fabrication_bench', name: '装配台', en: 'Fabrication Bench', cat: 'production', size: [3, 1], art: 'bench2', tags: ['power'], powerUse: 210, beauty: 0, stuff: true, v: 1 },
    { id: 'electric_smelter', name: '电熔炼器', en: 'Electric Smelter', cat: 'production', size: [3, 1], art: 'smelter', tags: ['power'], powerUse: 700, beauty: 0, stuff: true, v: 1 },
    { id: 'crematorium', name: '火葬炉', en: 'Electric Crematorium', cat: 'production', size: [3, 1], art: 'smelter', tags: ['power'], powerUse: 250, beauty: 0, stuff: true, v: 1 },
    { id: 'refinery', name: '炼油厂', en: 'Biofuel Refinery', cat: 'production', size: [2, 2], art: 'refinery', tags: ['power'], powerUse: 200, beauty: 0, stuff: true, v: 1 },
    { id: 'fermenting_barrel', name: '发酵桶', en: 'Fermenting Barrel', cat: 'production', size: [1, 1], art: 'barrel', beauty: 0 },
    { id: 'nutrient_dispenser', name: '营养膏机', en: 'Nutrient Paste Dispenser', cat: 'production', size: [1, 1], art: 'dispenser', tags: ['power', 'onwall'], powerUse: 200, beauty: 0, v: 1 },
    { id: 'hydroponics', name: '水栽培盆', en: 'Hydroponics Basin', cat: 'production', size: [4, 1], art: 'hydro', tags: ['power'], powerUse: 70, beauty: 0, v: 1 },
    { id: 'deep_drill', name: '深钻井', en: 'Deep Drill', cat: 'production', size: [3, 3], art: 'drill', tags: ['power'], powerUse: 200, beauty: 0, v: 1 },
    { id: 'ground_scanner', name: '地质扫描仪', en: 'Ground-Penetrating Scanner', cat: 'production', size: [2, 2], art: 'scanner', tags: ['power'], powerUse: 200, beauty: 0, v: 1 },
    { id: 'long_range_scanner', name: '远程矿物扫描仪', en: 'Long-Range Mineral Scanner', cat: 'production', size: [3, 3], art: 'scanner', tags: ['power'], powerUse: 200, beauty: 0, v: 1 },
    { id: 'comms_console', name: '通讯台', en: 'Comms Console', cat: 'production', size: [3, 2], art: 'console', tags: ['power'], powerUse: 150, beauty: 0, stuff: true, v: 1 },

    /* ---------------- 电力 ---------------- */
    { id: 'conduit', name: '电缆', en: 'Power Conduit', cat: 'power', size: [1, 1], art: 'conduit', tags: ['conduit', 'power', 'under'], beauty: -1, hp: 50, stuff: true },
    { id: 'power_switch', name: '电源开关', en: 'Power Switch', cat: 'power', size: [1, 1], art: 'switch', tags: ['conduit', 'power', 'under'], beauty: 0, stuff: true },
    { id: 'battery', name: '电池', en: 'Battery', cat: 'power', size: [1, 1], art: 'battery', tags: ['power', 'store'], powerStore: 1000, beauty: -5, stuff: true },
    { id: 'wood_generator', name: '木柴发电机', en: 'Wood-Fired Generator', cat: 'power', size: [2, 2], art: 'generator', tags: ['power', 'gen'], powerGen: 1000, beauty: -5, stuff: true, v: 1 },
    { id: 'chemfuel_generator', name: '化学燃料发电机', en: 'Chemfuel Powered Generator', cat: 'power', size: [3, 2], art: 'generator', tags: ['power', 'gen'], powerGen: 1000, beauty: -5, stuff: true, v: 1 },
    { id: 'solar_generator', name: '太阳能板', en: 'Solar Generator', cat: 'power', size: [3, 3], art: 'solar', tags: ['power', 'gen'], powerGen: 1600, beauty: -1, v: 1 },
    { id: 'wind_turbine', name: '风力发电机', en: 'Wind Turbine', cat: 'power', size: [7, 2], art: 'wind', tags: ['power', 'gen'], powerGen: 2300, beauty: -5, v: 1,
      // 照 WindTurbineUtility.CalculateWindCells：迎风侧（叶片那侧）10 格、背风侧 6 格，共 7×18
      zones: [
        { x: 0, z: -10, w: 7, h: 10, kind: 'clear', label: '迎风区（叶片侧，需清空高处）' },
        { x: 0, z: 2, w: 7, h: 6, kind: 'clear2', label: '背风区（需清空高处）' }
      ] },

    { id: 'geothermal_generator', name: '地热发电机', en: 'Geothermal Generator', cat: 'power', size: [6, 6], art: 'geo', tags: ['power', 'gen'], powerGen: 3600, beauty: -10, v: 1 },
    { id: 'vanometric_cell', name: '万用发电机', en: 'Vanometric Power Cell', cat: 'power', size: [1, 1], art: 'vanometric', tags: ['power', 'gen'], powerGen: 1000, beauty: 0, dlc: 'Royalty', v: 1 },

    /* ---------------- 温控 ---------------- */
    { id: 'cooler', name: '制冷器', en: 'Cooler', cat: 'temperature', size: [1, 1], art: 'cooler', tags: ['temp', 'power', 'onwall'], powerUse: 200, beauty: 0, v: 1 ,
      zones: [{ x: 0, z: -1, w: 1, h: 1, kind: 'hot', label: '热端（朝外）' }, { x: 0, z: 1, w: 1, h: 1, kind: 'cold', label: '冷端（朝内）' }] },
    { id: 'heater', name: '加热器', en: 'Heater', cat: 'temperature', size: [1, 1], art: 'heater', tags: ['temp', 'power'], powerUse: 175, beauty: 0, v: 1 },
    { id: 'vent', name: '通风格栅', en: 'Vent', cat: 'temperature', size: [1, 1], art: 'vent', tags: ['temp', 'onwall'], beauty: 0, stuff: true,
      zones: [{ x: 0, z: -1, w: 1, h: 1, kind: 'interact', label: '连通 A 侧' }, { x: 0, z: 1, w: 1, h: 1, kind: 'interact', label: '连通 B 侧' }] },
    { id: 'passive_cooler', name: '被动散热器', en: 'Passive Cooler', cat: 'temperature', size: [1, 1], art: 'cooler', tags: ['temp', 'onwall'], beauty: -3, v: 1 },
    { id: 'campfire', name: '篝火', en: 'Campfire', cat: 'temperature', size: [1, 1], art: 'campfire', tags: ['light', 'temp'], beauty: -2, v: 1 },

    /* ---------------- 防御 ---------------- */
    { id: 'mini_turret', name: '迷你炮塔', en: 'Mini-Turret', cat: 'security', size: [1, 1], art: 'turret', tags: ['turret', 'power'], powerUse: 100, beauty: 0, v: 1 },
    { id: 'autocannon_turret', name: '自动加农炮塔', en: 'Autocannon Turret', cat: 'security', size: [3, 3], art: 'turret', tags: ['turret', 'power'], powerUse: 300, beauty: 0, v: 1 },
    { id: 'uranium_turret', name: '铀弹炮塔', en: 'Uranium Slug Turret', cat: 'security', size: [3, 3], art: 'turret', tags: ['turret', 'power'], powerUse: 300, beauty: 0, v: 1 },
    { id: 'mortar', name: '迫击炮', en: 'Mortar', cat: 'security', size: [2, 2], art: 'mortar', tags: ['solid'], beauty: 0, v: 1 },
    { id: 'spike_trap', name: '尖刺陷阱', en: 'Deadfall Trap', cat: 'security', size: [1, 1], art: 'trap', tags: ['pass'], beauty: -5, stuff: true, v: 1 },

    /* ---------------- 杂项 ---------------- */
    { id: 'grave', name: '坟墓', en: 'Grave', cat: 'misc', size: [1, 2], art: 'grave', beauty: -5, stuff: true, v: 1 },
    { id: 'sarcophagus', name: '石棺', en: 'Sarcophagus', cat: 'misc', size: [2, 2], art: 'sarcophagus', beauty: 8, stuff: true, v: 1 },
    { id: 'horseshoes_pin', name: '马蹄铁桩', en: 'Horseshoes Pin', cat: 'joy', size: [1, 1], art: 'horseshoes', beauty: 4, v: 0,
      // 实测（游戏内红线）：四个方向、间隔 4 格、作用区 3 格长 × 1 格深
      zones: [
        { x: -1, z: -5, w: 3, h: 1, kind: 'joy', label: '北侧使用区' },
        { x: -1, z: 5, w: 3, h: 1, kind: 'joy', label: '南侧使用区' },
        { x: -5, z: -1, w: 1, h: 3, kind: 'joy', label: '西侧使用区' },
        { x: 5, z: -1, w: 1, h: 3, kind: 'joy', label: '东侧使用区' }
      ] },

    { id: 'billiards_table', name: '台球桌', en: 'Billiards Table', cat: 'misc', size: [3, 2], art: 'table', beauty: 20, stuff: true, v: 1 },
    { id: 'poker_table', name: '扑克桌', en: 'Poker Table', cat: 'misc', size: [2, 2], art: 'table', beauty: 15, stuff: true, v: 1 },
    { id: 'altar', name: '祭坛', en: 'Altar', cat: 'misc', size: [1, 1], art: 'altar', tags: ['solid'], beauty: 15, dlc: 'Ideology', stuff: true, v: 1 },
    { id: 'transport_pod_launcher', name: '运输舱发射器', en: 'Transport Pod Launcher', cat: 'misc', size: [3, 3], art: 'pod', tags: ['solid'], beauty: 0, v: 1 },
    { id: 'animal_spot', name: '动物活动点', en: 'Animal Sleeping Spot', cat: 'misc', size: [1, 1], art: 'spot', beauty: 0, v: 1 }
  ];

  // 索引
  var byId = {};
  for (var i = 0; i < BUILDINGS.length; i++) byId[BUILDINGS[i].id] = BUILDINGS[i];

  /**
   * 规范化：保证每条都有 tags / size / cat / art。
   * 少一个 tags 就会让 render() 每帧抛异常、整个画布不刷新，所以必须兜住。
   */
  /**
   * 手绘图标映射。
   * 提取脚本只能从 defName 猜图标，猜不出来的就留成「通用方块」——
   * 物品栏里几十个东西长得一模一样。这里按 defName 指定一个像样的手绘图标
   * （js/icons.js 里那几十个），让它们至少能分辨出来。
   */
  var ART_MAP = {
    // 家具 / 摆件
    Building_KidOutfitStand: 'statue', Building_OutfitStand: 'statue',
    BabyDecoration: 'pot', ToyBox: 'barrel', Blackboard: 'shelf',
    HoopstoneRing: 'horseshoes', GameOfUrBoard: 'table',
    CannibalPlatter: 'table',
    // 仪式 / 丧葬
    GibbetCage: 'barrel', EggBox: 'barrel', Reliquary: 'bench2',
    ChristmasTree: 'statue', Effigy: 'statue', Skullspike: 'statue',
    Ideogram: 'statue', Pyre: 'brazier', SacrificialFlag: 'torch',
    Autobong: 'torch', Burnbong: 'torch', Lectern: 'bench',
    KneelSheet: 'bench', KneelPillow: 'pot', Pew: 'bench',
    RitualSpot: 'altar', PsychicRitualSpot: 'altar',
    // 生化 / 科幻
    WastepackAtomizer: 'bench2', GeneProcessor: 'bench', GeneBank: 'shelf',
    GeneExtractor: 'bench2', GeneAssembler: 'bench2',
    LargeChemfuelTank: 'barrel', ChemfuelTank: 'barrel',
    LargeThruster: 'generator', SmallThruster: 'generator',
    BurnoutMechlinkBooster: 'analyzer', ToolCabinet: 'shelf',
    PsychofluidPump: 'dispenser', MoisturePump: 'dispenser',
    HoldingPlatform: 'bench', StylingStation: 'dresser',
    SubcoreEncoder: 'scanner', DeathrestAccelerator: 'bench2',
    OxygenPump: 'dispenser', Electroharvester: 'scanner',
    BioferriteShaper: 'bench', BioferriteHarvester: 'drill',
    PollutionPump: 'dispenser', ProximityDetector: 'scanner',
    LightBall: 'lamp', FrenzyInducer: 'analyzer',
    VitalsMonitor: 'scanner', ElectricInhibitor: 'analyzer',
    SleepSuppressor: 'bench2', ShardInhibitor: 'analyzer',
    MechbandDish: 'scanner', NeuralSupercharger: 'bench2',
    GlucosoidPump: 'dispenser', HemogenAmplifier: 'bench2',
    Hemopump: 'dispenser', SerumCentrifuge: 'bench',
    MechBooster: 'analyzer', SignalJammer: 'scanner',
    SleepAccelerator: 'bench2', Loudspeaker: 'console', BandNode: 'console',
    Drum: 'bench',
    // 墙体 / 雕像板 / 地毯
    AncientFortifiedWall: 'wall', OrbitalAncientFortifiedWall: 'wall',
    GrayWall: 'wall',
    TotemicSlab_Medium: 'statue', TotemicSlab_Broad: 'statue',
    SpikecoreFloorStar_Medium: 'statue', SpikecoreFloorStar_Broad: 'statue',
    AnimalistSlab_Medium: 'statue', AnimalistSlab_Broad: 'statue',
    MorbidSlab_Medium: 'statue', MorbidSlab_Broad: 'statue',
    RusticRug_Medium: 'pot', RusticRug_Broad: 'pot'
  };

  /**
   * 分类细化：游戏把很多东西都塞在「Miscellaneous」里，
   * 这里按性质分开，找东西方便得多。
   */
  var CAT_RULES = [
    { cat: 'statue', re: /^(Sculpture|Statue|Ideogram|Stele|TotemicSlab|SpikecoreFloorStar|RusticRug|AnimalistSlab|MorbidSlab|ChristmasTree)/ },
    { cat: 'funeral', re: /^(Grave|Sarcophagus|Pyre|Reliquary)/ },
    { cat: 'ritual', re: /^(Altar|RitualSpot|PsychicRitualSpot|MeditationSpot|MarriageSpot|PartySpot|CannibalPlatter|Effigy|GibbetCage|Skullspike|SacrificialFlag|IncenseShrine|NatureShrine|Autobong|Burnbong|BurnoutMechlinkBooster|Darktorch|Lectern|KneelSheet|KneelPillow|Pew|SanguphageMeetingTorch)/ },
    { cat: 'tech', re: /(Mech|GeneAssembler|GeneBank|GeneExtractor|GeneProcessor|Biosculpter|GrowthVat|Hemogen|Hemopump|GlucosoidPump|SerumCentrifuge|Subcore|Psychofluid|Bioferrite|VacBarrier|ShardBeacon|ShardInhibitor|VitalsMonitor|Electroharvester|AtmosphericHeater|FrenzyInducer|ProximityDetector|SleepAccelerator|SleepSuppressor|ElectricInhibitor|PollutionPump|Recharger|WastepackAtomizer|OxygenPump|MoisturePump|Thruster|Deathrest|NeuralSupercharger|GravAnchor|GravFieldExtender|GravcorePowerCell|Vanometric)/ },
    { cat: 'production', re: /(ChemfuelTank|MultiAnalyzer|PodLauncher|ToolCabinet|EggBox|Hopper|Brewery|DeepDrill)/ },
    { cat: 'security', re: /(Scanner|FirefoamPopper|TrapIED|HunterDroneTrap)/ },
    { cat: 'joy', re: /(Loudspeaker|LightBall|Drum)/ }
  ];

  function normalizeDefs() {
    for (var n = 0; n < BUILDINGS.length; n++) {
      var b = BUILDINGS[n];
      if (!Array.isArray(b.tags)) b.tags = [];
      if (!Array.isArray(b.size) || b.size.length < 2) b.size = [1, 1];
      if (!b.cat) b.cat = 'misc';
      if (!b.art) b.art = 'generic';
      if (!b.name) b.name = b.en || b.id || '?';
      // 猜不出专属图标的手绘映射（别让一堆东西都长成通用方块）
      if (b.art === 'generic') {
        var am = ART_MAP[b.def || b.id];
        if (am) b.art = am;
      }
      // 杂项太杂，按性质再分一分
      if (b.cat === 'misc') {
        for (var r = 0; r < CAT_RULES.length; r++) {
          if (CAT_RULES[r].re.test(b.def || b.id || '')) { b.cat = CAT_RULES[r].cat; break; }
        }
      }
    }
    nameIndex = null;
  }
  normalizeDefs();

  var floorsById = {};
  for (var j = 0; j < FLOORS.length; j++) floorsById[FLOORS[j].id] = FLOORS[j];

  // 存档 defName / 界面名 → 本库 id 的归一化匹配
  function normDef(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  // 游戏 defName 与界面名不一致时的别名兜底
  var ALIAS = {
    tablebutcher: 'butcher_table', tabletailor: 'electric_tailor_bench',
    tableelectrictailor: 'electric_tailor_bench', tablestonecutter: 'stonecutter',
    tableresearch: 'research_bench', tableelectricresearch: 'electric_research_bench',
    tablesmithy: 'smithy', tableelectricsmithy: 'electric_smithy',
    tablemachining: 'machining_table', tablefabrication: 'fabrication_bench',
    tableelectricstove: 'stove_electric', stove: 'stove_fuel', tableelectricdruglab: 'drug_lab',
    tableelectriccrematorium: 'crematorium', tableelectricsmelter: 'electric_smelter',
    tableelectricrefinery: 'refinery', tableelectricsculpting: 'sculpting_table',
    sculptingtable: 'sculpting_table', tableart: 'sculpting_table',
    standinglamp: 'standing_lamp', sunlamp: 'sun_lamp', torchlamp: 'torch_lamp',
    doublesleepingspot: 'double_sleeping_spot', sleepingspot: 'sleeping_spot',
    royalbed: 'royal_bed', doublebed: 'double_bed', hospitalbed: 'hospital_bed',
    woodfiredgenerator: 'wood_generator', chemfuelpoweredgenerator: 'chemfuel_generator',
    solargenerator: 'solar_generator', windturbine: 'wind_turbine',
    geothermalgenerator: 'geothermal_generator', vanometricpowercell: 'vanometric_cell',
    powerconduit: 'conduit', battery: 'battery', powerswitch: 'power_switch',
    nutrientpastedispenser: 'nutrient_dispenser', hydroponicsbasin: 'hydroponics',
    deepdrill: 'deep_drill', groundpenetratingscanner: 'ground_scanner',
    longrangedmineralscanner: 'long_range_scanner', commsconsole: 'comms_console',
    miniturret: 'mini_turret', autocannonturret: 'autocannon_turret',
    uraniumslugturret: 'uranium_turret', deadfalltrap: 'spike_trap',
    fence: 'fence', fencegate: 'fence_gate', animalflap: 'animal_flap',
    concretebarrier: 'concrete_barrier', walllamp: 'wall_lamp', plantpot: 'plant_pot',
    horseshoespin: 'horseshoes_pin', billiardstable: 'billiards_table', pokertable: 'poker_table',
    schooldesk: 'school_desk', dresser: 'dresser', endtable: 'end_table',
    sculpturegrand: 'sculpture_grand', sculpturesmall: 'sculpture_small',
    sculpturelarge: 'sculpture_large',
    grandmeditationthrone: 'grand_meditation_throne', meditationthrone: 'meditation_throne',
    transportpodlauncher: 'transport_pod_launcher',
    slabbed: 'slab_bed', slabwall: 'wall', slabdoor: 'door',
    butchertable: 'butcher_table', tailoringbench: 'electric_tailor_bench',
    electricsmelter: 'electric_smelter', crematorium: 'crematorium',
    solargen: 'solar_generator', fuelledstove: 'stove_fuel', fueledstove: 'stove_fuel',
    // 1.7 官方 defName 与内置条目名对不上的，补上（否则会另建一条重复条目）
    bedrolldouble: 'double_bedroll',
    table1x2c: 'table_1x2', table2x2c: 'table_2x2',
    table2x4c: 'table_2x4', table3x3c: 'table_3x3',
    sculpturesmall: 'sculpture_small', sculpturelarge: 'sculpture_large',
    sculpturegrand: 'sculpture_grand',
    throne: 'meditation_throne', grandthrone: 'grand_meditation_throne',
    tablesculpting: 'sculpting_table', artbench: 'sculpting_table',
    vanometricpowercell: 'vanometric_cell',
    turretminiturret: 'mini_turret', turretautocannon: 'autocannon_turret',
    turretsniper: 'uranium_turret', turretmortar: 'mortar', trapspike: 'spike_trap',
    podlauncher: 'transport_pod_launcher', altarsmall: 'altar'
  };

  var nameIndex = null;
  function buildNameIndex() {
    if (nameIndex) return nameIndex;
    nameIndex = {};
    for (var i = 0; i < BUILDINGS.length; i++) {
      var b = BUILDINGS[i];
      nameIndex[normDef(b.id)] = b.id;
      if (b.en) nameIndex[normDef(b.en)] = b.id;
      if (b.def) nameIndex[normDef(b.def)] = b.id;
    }
    return nameIndex;
  }

  /** 用游戏 defName（或界面名）反查本库 id */
  function matchDefName(defName) {
    var n = normDef(defName);
    var idx = buildNameIndex();
    if (idx[n]) return idx[n];
    if (ALIAS[n]) return ALIAS[n];
    var stripped = n.replace(/^building/, '').replace(/^frame/, '');
    if (idx[stripped]) return idx[stripped];
    if (ALIAS[stripped]) return ALIAS[stripped];
    return null;
  }

  /**
   * 合并从游戏 defs 提取的精确数据库（不覆盖没提取到的条目）。
   * 已存在的条目：沿用本库 id（保证旧工程文件仍能打开），用精确值覆盖尺寸/电力等，
   *               并保留手工挑选的图标（生成的图标是通用图形时才覆盖）。
   * 新条目：直接追加。
   */
  function mergeBuildings(list) {
    var replaced = 0, added = 0, keptArt = 0;
    for (var i = 0; i < list.length; i++) {
      var g = list[i];
      if (!g || !g.id) continue;
      var targetId = matchDefName(g.def || g.id || g.en) || g.id;
      var old = byId[targetId];

      // 名字优先级：官方简中语言包（提取时就写进 name 了） > 内置中文对照表 > 英文 label
      if (global.RWData.hasCJK && !global.RWData.hasCJK(g.name)) {
        var zh = global.RWData.zhName ? global.RWData.zhName(g.def || g.id || g.en) : null;
        if (zh) g.name = zh;
        else if (old && global.RWData.hasCJK(old.name)) g.name = old.name;
      }

      if (old) {
        // 提取脚本的图标是启发式猜的；猜成通用图形时保留手工挑选的图标
        if ((!g.art || g.art === 'generic') && old.art) { g.art = old.art; keptArt++; }
        if (old.beauty != null && g.beauty == null) g.beauty = old.beauty;
        if (old.stuff && !g.stuff) g.stuff = true;
        // 用精确值覆盖旧对象的所有字段
        for (var k in g) if (Object.prototype.hasOwnProperty.call(g, k)) old[k] = g[k];
        old.id = targetId;
        old.exact = true;
        replaced++;
      } else {
        g.id = targetId;
        g.exact = true;
        BUILDINGS.push(g);
        byId[g.id] = g;
        added++;
      }
      nameIndex = null;
    }
    normalizeDefs();
    buildNameIndex();
    return { replaced: replaced, added: added, keptArt: keptArt, total: BUILDINGS.length };
  }

  // ------------------------------------------------------------------
  // 地形 / 山体 / 科技树 索引
  // ------------------------------------------------------------------

  /** 存档里的地形哈希：hash*31 + char，最后 % 65535（和游戏 TerrainGrid 的写法一致） */
  function terrainHash(defName) {
    var h = 23, s = String(defName || '');
    for (var i = 0; i < s.length; i++) h = ((h * 31 + s.charCodeAt(i)) >>> 0);
    return h % 65535;
  }

  var terrains = {};       // defName -> { def, name, color, aff[], smoothTo, isWater, isRock }
  var terrainByHash = {};  // 哈希 -> defName
  var rocks = {};          // 自然岩石 defName -> { def, name, hp, mineableThing, yield }
  var rockByTerrain = {};  // 地形 defName（X_Rough）-> 岩石 defName（X）
  var researches = {};     // defName -> { def, name, cost, prereq[], techLevel }

  function terrainName(def) {
    var t = terrains[def];
    return t ? t.name : def;
  }
  function terrainAff(def) {
    var t = terrains[def];
    return (t && t.aff) || null;
  }

  /** 重建地形索引（内置兜底 + 从游戏 defs 导入的数据） */
  function indexTerrains() {
    terrains = {};
    terrainByHash = {};
    TERRAIN_FALLBACK.forEach(function (t) {
      terrains[t.def] = {
        def: t.def, name: t.name, color: t.color, aff: (t.aff || []).slice(),
        isWater: /^(Water|Marsh|Mud|Lava|HotSpring)/.test(t.def),
        isRock: /_(Rough|RoughHewn|Smooth)$/.test(t.def)
      };
    });
    Object.keys(terrains).forEach(function (d) { terrainByHash[terrainHash(d)] = d; });
    return terrains;
  }

  /** 从游戏 defs 合并地形表（gamedefs.js 解析出来的 terrain 对象） */
  function mergeTerrains(list) {
    if (!list) return 0;
    var n = 0;
    list.forEach(function (t) {
      if (!t || !t.def) return;
      var old = terrains[t.def] || {};
      terrains[t.def] = {
        def: t.def,
        name: t.name || old.name || t.def,
        color: t.color || old.color || '#777',
        aff: t.aff || old.aff || [],
        need: t.need || old.need || null,
        work: t.work != null ? t.work : old.work,
        cost: t.cost || old.cost || null,
        research: t.research || old.research || null,
        smoothTo: t.smoothTo || old.smoothTo || null,
        isWater: t.isWater != null ? t.isWater : (old.isWater != null ? old.isWater : /^(Water|Marsh|Mud|Lava|HotSpring)/.test(t.def)),
        isRock: /_(Rough|RoughHewn|Smooth)$/.test(t.def)
      };
      terrainByHash[terrainHash(t.def)] = t.def;
      n++;
    });
    return n;
  }

  function indexRocks() {
    rocks = {};
    rockByTerrain = {};
    ROCK_FALLBACK.forEach(function (r) { rocks[r.def] = r; });
    Object.keys(rocks).forEach(function (d) {
      rockByTerrain[d + '_Rough'] = d;
      rockByTerrain[d + '_RoughHewn'] = d;
    });
    return rocks;
  }

  /** 从游戏 defs 合并自然岩石表 */
  function mergeRocks(list) {
    if (!list) return 0;
    var n = 0;
    list.forEach(function (r) {
      if (!r || !r.def) return;
      rocks[r.def] = {
        def: r.def, name: r.name || (rocks[r.def] && rocks[r.def].name) || r.def,
        hp: r.hp || (rocks[r.def] && rocks[r.def].hp) || 400,
        mineableThing: r.mineableThing || (rocks[r.def] && rocks[r.def].mineableThing) || null,
        yield: r.yield || (rocks[r.def] && rocks[r.def].yield) || 1,
        resource: !!(r.resource || (rocks[r.def] && rocks[r.def].resource)),
        color: r.color || (rocks[r.def] && rocks[r.def].color) || null
      };
      rockByTerrain[r.def + '_Rough'] = r.def;
      rockByTerrain[r.def + '_RoughHewn'] = r.def;
      n++;
    });
    return n;
  }

  indexTerrains();
  indexRocks();

  global.RWData = {
    CATEGORIES: CATEGORIES,
    BUILDINGS: BUILDINGS,
    FLOORS: FLOORS,
    byId: byId,
    floorsById: floorsById,
    normDef: normDef,
    matchDefName: matchDefName,
    mergeBuildings: mergeBuildings,
    // ---- 地形 / 山体 / 科技树 ----
    terrainHash: terrainHash,
    terrains: function () { return terrains; },
    terrain: function (def) { return terrains[def] || null; },
    terrainName: terrainName,
    terrainAff: terrainAff,
    terrainByHash: function (h) { return terrainByHash[h] || null; },
    mergeTerrains: mergeTerrains,
    rocks: function () { return rocks; },
    rock: function (def) { return rocks[def] || null; },
    rockByTerrain: function (terrainDef) { return rockByTerrain[terrainDef] || null; },
    mergeRocks: mergeRocks,
    researches: function () { return researches; },
    research: function (def) { return researches[def] || null; },
    mergeResearches: function (list) {
      if (!list) return 0;
      var n = 0;
      list.forEach(function (r) {
        if (!r || !r.def) return;
        researches[r.def] = r; n++;
      });
      return n;
    },
    // ---- 材质（逐物品；由 tools/extract_defs.py 生成，缺失时为空数组）----
    STUFFS: [],
    STUFF_CATS: [],
    allStuffs: function () { return global.RWData.STUFFS || []; },
    stuffById: function (id) {
      if (!id) return null;
      var all = global.RWData.STUFFS || [];
      for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
      return null;
    },
    /** 某个建筑能用的材质（按游戏 stuffCategories 过滤，常用的排前面） */
    stuffsFor: function (def) {
      var all = global.RWData.STUFFS || [];
      if (!def || !def.stuffCats || !def.stuffCats.length || !all.length) return [];
      var out = [];
      for (var i = 0; i < all.length; i++) {
        var s = all[i];
        for (var j = 0; j < s.cats.length; j++) {
          if (def.stuffCats.indexOf(s.cats[j]) >= 0) { out.push(s); break; }
        }
      }
      out.sort(function (a, b) { return (b.common || 0) - (a.common || 0); });
      return out;
    },
    // 兼容旧调用
    replaceBuildings: function (list) { return mergeBuildings(list); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
