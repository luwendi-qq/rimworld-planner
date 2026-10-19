/*
 * zh-names.js —— 建筑中文名对照表（简体中文）
 *
 * 两种来源，优先级从高到低：
 *   1. 游戏自带的官方简中语言包（Languages/ChineseSimplified/DefInjected），
 *      只要用 tools/extract_defs.py 提取过，就会自动用它，名字 100% 和游戏一致。
 *   2. 下面这份内置对照表（覆盖原版常用建筑），用于没有语言包时兜底。
 *
 * 键是游戏的 defName，值是游戏内显示名。
 */
(function (global) {
  'use strict';

  var ZH = {
    /* ---------- 结构 ---------- */
    Wall: '墙', Door: '门', Autodoor: '自动门', OrnateDoor: '华丽门',
    Fence: '栅栏', FenceGate: '栅栏门', Column: '柱子', AnimalFlap: '动物门',
    WallLamp: '壁灯', TorchWallLamp: '壁挂火把', Bridge: '桥',

    /* ---------- 家具 ---------- */
    Bed: '床', DoubleBed: '双人床', RoyalBed: '皇家床', HospitalBed: '病床',
    Bedroll: '睡袋', BedrollDouble: '双人睡袋', Crib: '婴儿床',
    SleepingSpot: '睡眠点', DoubleSleepingSpot: '双人睡眠点',
    AnimalBed: '动物床', AnimalSleepingBox: '动物睡箱', AnimalSleepingSpot: '动物睡眠点',
    SlabBed: '石板床',
    Table1x2c: '桌子（1x2）', Table2x2c: '桌子（2x2）',
    Table2x4c: '桌子（2x4）', Table3x3c: '桌子（3x3）',
    Stool: '凳子', DiningChair: '餐椅', Armchair: '扶手椅', Couch: '长沙发',
    Dresser: '梳妆台', EndTable: '床头柜', Shelf: '置物架', ShelfSmall: '小型置物架',
    Bookcase: '书架', BookcaseSmall: '小型书架', PlantPot: '花盆',
    SculptureSmall: '小型雕塑', SculptureLarge: '大型雕塑', SculptureGrand: '巨型雕塑',
    TorchLamp: '火把', StandingLamp: '立灯', SunLamp: '太阳灯', FloodLight: '泛光灯',
    Brazier: '火盆', DarklightBrazier: '暗光火盆',
    Throne: '冥想王座', GrandThrone: '大冥想王座',
    ChessTable: '象棋桌', PokerTable: '扑克桌', BilliardsTable: '台球桌',
    GameOfUrBoard: '乌尔王棋棋盘', HoopstoneRing: '投环石阵', HorseshoesPin: '马蹄铁桩',
    TubeTelevision: '显像管电视', FlatscreenTelevision: '平板电视', Drape: '帷幔',
    SchoolDesk: '课桌',

    /* ---------- 生产 ---------- */
    CraftingSpot: '制作点', ButcherSpot: '屠宰点', TableButcher: '屠宰台',
    TableStonecutter: '切石台', TableSculpting: '雕塑台', TableMachining: '机械加工台',
    HandTailoringBench: '手工缝纫台', ElectricTailoringBench: '电动缝纫台',
    FueledSmithy: '燃料锻造台', ElectricSmithy: '电动锻造台',
    FueledStove: '燃料灶', ElectricStove: '电灶',
    SimpleResearchBench: '简单研究台', HiTechResearchBench: '高科技研究台',
    DrugLab: '药物实验室', FabricationBench: '装配台',
    ElectricSmelter: '电动熔炼器', ElectricCrematorium: '电动火葬炉',
    BiofuelRefinery: '生物燃料精炼厂', Brewery: '酿造台', FermentingBarrel: '发酵桶',
    NutrientPasteDispenser: '营养膏机', Hopper: '料斗', HydroponicsBasin: '水栽培盆',
    DeepDrill: '深钻井',

    /* ---------- 电力 ---------- */
    PowerConduit: '电缆', HiddenConduit: '隐蔽电缆', WaterproofConduit: '防水电缆',
    PowerSwitch: '电源开关', Battery: '电池',
    WoodFiredGenerator: '木柴发电机', ChemfuelPoweredGenerator: '化学燃料发电机',
    SolarGenerator: '太阳能发电机', WindTurbine: '风力发电机',
    GeothermalGenerator: '地热发电机', WatermillGenerator: '水车发电机',
    VanometricPowerCell: '万用发电机',

    /* ---------- 温控 ---------- */
    Cooler: '制冷器', Heater: '加热器', Vent: '通风格栅',
    PassiveCooler: '被动散热器', Campfire: '营火',

    /* ---------- 防御 ---------- */
    Turret_MiniTurret: '迷你炮塔', Turret_Autocannon: '自动加农炮塔',
    Turret_Sniper: '狙击炮塔', Turret_Mortar: '迫击炮',
    Turret_FoamTurret: '泡沫炮塔', Turret_RocketswarmLauncher: '火箭集群发射器',
    TrapSpike: '尖刺陷阱',
    TrapIED_HighExplosive: '高爆诡雷', TrapIED_Incendiary: '燃烧诡雷',
    TrapIED_EMP: '电磁脉冲诡雷', TrapIED_Firefoam: '泡沫灭火诡雷',
    TrapIED_Smoke: '烟雾诡雷', TrapIED_AntigrainWarhead: '反粒子弹头诡雷',
    Barricade: '路障', Sandbags: '沙袋', Barrier: '混凝土护栏',
    SpikeTrap: '尖刺陷阱',

    /* ---------- 杂项 ---------- */
    CommsConsole: '通讯台', MultiAnalyzer: '多重分析仪', VitalsMonitor: '生命体征监测仪',
    ToolCabinet: '工具柜', Grave: '坟墓', Sarcophagus: '石棺',
    SteleSmall: '小型石碑', SteleLarge: '大型石碑', SteleGrand: '巨型石碑',
    NatureShrine_Small: '小型自然神殿', NatureShrine_Large: '大型自然神殿',
    Altar: '祭坛', MeditationSpot: '冥想地点', MarriageSpot: '婚礼地点',
    PartySpot: '聚会点', PenMarker: '牧场标记', CaravanPackingSpot: '商队集合点',
    OrbitalTradeBeacon: '轨道贸易信标', FirefoamPopper: '泡沫灭火器',
    MoisturePump: '排水泵', GroundPenetratingScanner: '地质扫描仪',
    LongRangeMineralScanner: '远程矿物扫描仪', EggBox: '卵箱',
    CryptosleepCasket: '低温休眠舱', TransportPod: '运输舱',
    PodLauncher: '运输舱发射器',
    Ship_Beam: '飞船结构梁', Ship_Reactor: '飞船反应堆', Ship_Engine: '飞船引擎',
    Ship_ComputerCore: '飞船计算机核心', Ship_SensorCluster: '飞船传感器集群',
    Ship_CryptosleepCasket: '飞船低温休眠舱', ShipLandingBeacon: '飞船着陆信标',

    /* ---------- DLC 常用 ---------- */
    MeditationThrone: '冥想王座',
    DeathrestCasket: '死眠棺材',
    GeneBank: '基因库',
    GenepackAssembler: '基因组装订器',
    GeneExtractor: '基因提取器',
    GrowthVat: '培育舱',
    NeuralSupercharger: '神经增压器',
    MechGestator: '机械培育器',
    MechRecharger: '机械充能站',
    BandNode: '频段节点',
    Relay: '中继站',
    AncientSpotlight: '古代聚光灯',
    DarklightTorch: '暗火把',
    FungusDarktorch: '真菌暗火把',
    ArchotechSpire: '远古科技尖塔',
    HoldingSpot: '囚禁点',
    RechargeStation: '充能站'
  };

  function hasCJK(s) { return /[\u4e00-\u9fff]/.test(s || ''); }

  /** 用 defName 或本库 id 反查中文名；没有就返回 null */

  /* ---------- 材质 / 材质分类（官方语言包缺失时兜底） ---------- */
  var STUFF_ZH = {
    Bioferrite: '活铁',
    Leather_Dread: '骇人皮革',
    Silver: '白银',
    Gold: '黄金',
    Steel: '钢铁',
    Plasteel: '玻璃钢',
    WoodLog: '原木',
    Uranium: '铀',
    Jade: '翡翠',
    Cloth: '布',
    Synthread: '合成纤维',
    DevilstrandCloth: '魔菇布',
    Hyperweave: '超织物',
    WoolSheep: '羊毛',
    WoolAlpaca: '羊驼毛',
    WoolMegasloth: '大地懒毛',
    WoolMuffalo: '雪牛毛',
    WoolBison: '野牛毛',
    Leather_Plain: '普通皮革',
    Leather_Dog: '狗皮',
    Leather_Wolf: '狼皮',
    Leather_Panthera: '豹皮',
    Leather_Camel: '驼皮',
    Leather_Bluefur: '蓝色毛皮',
    Leather_Bear: '熊皮',
    Leather_GuineaPig: '豚鼠皮',
    Leather_Human: '人皮',
    Leather_Pig: '猪皮',
    Leather_Light: '轻薄皮革',
    Leather_Bird: '鸟皮',
    Leather_Chinchilla: '栗鼠皮',
    Leather_Fox: '狐皮',
    Leather_Lizard: '蜥蜴皮',
    Leather_Elephant: '象皮',
    Leather_Heavy: '厚重毛皮',
    Leather_Rhinoceros: '犀牛皮',
    Leather_Thrumbo: '敲击兽皮',
    Leather_Patch: '杂皮',
    BlocksSandstone: '砂岩砖',
    BlocksGranite: '花岗岩砖',
    BlocksLimestone: '石灰岩砖',
    BlocksSlate: '板岩砖',
    BlocksMarble: '大理石砖',
    WoolMastodon: '乳齿象毛',
    WoolMuskox: '麝牛毛',
    Obsidian: '黑曜石',
    Leather_Mastodon: '乳齿象皮',
    Leather_Sealskin: '海豹皮',
    Leather_AlphaThrumbo: '阿尔法敲击兽皮',
    Leather_Mink: '水貂皮',
    Leather_Hippo: '河马皮',
    Leather_Armadillo: '犰狳皮',
    BlocksVacstone: '真空岩砖',
  };
  var CAT_ZH = {
    Bioferrite: '活铁',
    Metallic: '金属类',
    Woody: '木材类',
    Stony: '石材类',
    Fabric: '纤维类',
    Leathery: '皮革类',
  };
  for (var sk in STUFF_ZH) ZH[sk] = STUFF_ZH[sk];
  for (var ck in CAT_ZH) ZH[ck] = CAT_ZH[ck];

  function zhName(defName) {
    if (!defName) return null;
    if (ZH[defName]) return ZH[defName];
    // 允许大小写/下划线差异
    var k = String(defName);
    if (ZH[k]) return ZH[k];
    for (var key in ZH) {
      if (key.toLowerCase() === k.toLowerCase()) return ZH[key];
    }
    return null;
  }

  global.RWData = global.RWData || {};
  global.RWData.ZH_NAMES = ZH;
  global.RWData.zhName = zhName;
  global.RWData.hasCJK = hasCJK;
})(typeof window !== 'undefined' ? window : globalThis);
