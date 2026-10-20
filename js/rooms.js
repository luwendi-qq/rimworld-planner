/*
 * rooms.js —— 房间角色推导（和游戏一样自动判定）与温控估算
 *
 * 游戏里没有「给房间指定用途」这回事：
 *   · 房间由墙 / 门围出来，RoomManager 在运行时用 flood-fill 计算，不进存档；
 *   · 房间角色（卧室 / 兵营 / 厨房 / 工坊…）由 RoomRoleWorker 按房间里的东西打分自动选出；
 *   · 玩家能改的只有床的「医疗 / 囚犯」开关、桌椅朝向之类的内容，不是角色本身。
 *
 * 所以这里不再保存 roomRole，而是每次校验时按房间内容重新推导。
 * 判定规则尽量对齐 1.7 的 RoomRoleWorker（见 Data/Core/Defs/Rooms/RoomRoles.xml）：
 *   Bedroom        1 张普通床（医疗 / 囚犯床不算）
 *   Barracks       2 张以上普通床
 *   Hospital       有医疗床
 *   PrisonCell     1 张囚犯床
 *   PrisonBarracks 2 张以上囚犯床
 *   Kitchen        有炉灶 / 食品工作台（workTableRoomRole=Kitchen）
 *   Workshop       有 workTableRoomRole=Workshop 的工作台
 *   Laboratory     有 workTableRoomRole=Laboratory 的研究台
 *   DiningRoom     有 surfaceType=Eat 的餐桌
 *   RecRoom        有娱乐设施
 *   StoreRoom      有储物架
 *   Tomb           有棺材
 *   Barn           有动物床
 *   Nursery        2 张以上婴儿床
 *   Classroom      有课桌 / 黑板
 *   ThroneRoom     有王座
 *   CeremonialChamber / DeathrestChamber / ContainmentCell / WorshipRoom 等 DLC 角色也做了近似
 *
 * 和游戏的差距：
 *   · 游戏看床的「归属 / 恋人 / 孩子」来决定一张床算不算卧室，规划器没有小人，只按床数近似；
 *   · 祭坛要求 Ideology 的 meme，规划器只看有没有祭坛；
 *   · 房间必须有屋顶才算「室内」这一点，只有导入存档时才知道屋顶；手画时按墙围合判断。
 *   这些差距只影响「角色名」，不影响占地 / 建造校验，所以统一算近似提示。
 *
 * 温控仍然是本工具自己的近似模型（不是游戏物理的精确复刻）：
 *   冷（热）量需求 ∝ 面积 × |环境温度 − 目标温度|
 *   一台制冷机 ≈ 30 格 × 21°C 温差当量；一台加热器 ≈ 25 格 × 21°C
 *   需要台数 = ceil(面积 × ΔT / (每台的格数 × 21))
 */
(function (global) {
  'use strict';

  var Data = global.RWData;

  // ---------------------------------------------------------------- 角色表
  // 顺序和游戏 RoomRoles.xml 大致一致；分数相同时靠前的优先。
  var ROLES = [
    { id: 'none',          name: '无',       desc: '不是一个封闭房间' },
    { id: 'room',          name: '房间',     desc: '没有匹配到更具体的用途' },
    { id: 'bedroom',       name: '卧室',     desc: '1 张普通床' },
    { id: 'prison',        name: '囚室',     desc: '1 张囚犯床' },
    { id: 'dining',        name: '餐厅',     desc: '有餐桌' },
    { id: 'rec',           name: '娱乐室',   desc: '有娱乐设施' },
    { id: 'hospital',      name: '病房',     desc: '有医疗床' },
    { id: 'lab',           name: '实验室',   desc: '有研究台' },
    { id: 'workshop',      name: '工坊',     desc: '有工作台' },
    { id: 'storage',       name: '储藏室',   desc: '有储物架' },
    { id: 'barracks',      name: '兵营',     desc: '2 张以上普通床' },
    { id: 'prisonBarracks',name: '囚犯兵营', desc: '2 张以上囚犯床' },
    { id: 'kitchen',       name: '厨房',     desc: '有炉灶 / 食品工作台' },
    { id: 'tomb',          name: '陵墓',     desc: '有棺材' },
    { id: 'barn',          name: '畜栏',     desc: '有动物床' },
    { id: 'nursery',       name: '育儿室',   desc: '2 张以上婴儿床' },
    { id: 'classroom',     name: '教室',     desc: '有课桌 / 黑板' },
    { id: 'throne',        name: '王座厅',   desc: '有王座' },
    { id: 'ceremonial',    name: '仪式厅',   desc: '有心灵仪式点' },
    { id: 'deathrest',     name: '死眠室',   desc: '有死眠棺 / 死眠设备' },
    { id: 'containment',   name: '收容室',   desc: '有收容平台 / 汲电器' },
    { id: 'worship',       name: '礼拜室',   desc: '有祭坛' }
  ];

  var byId = {};
  ROLES.forEach(function (r) { byId[r.id] = r; });

  function roleById(id) { return byId[id] || byId.room; }

  // ---------------------------------------------------------------- 床
  /**
   * 床的「实际状态」。游戏里床可以随时切成医疗 / 囚犯；
   * 规划器把这两个开关存在建筑对象的 bedMode 上（normal / medical / prison）。
   */
  function bedOf(b) {
    var def = Data.byId[b.defId];
    if (!def || !def.bed) return null;
    var info = {
      human: def.bed.human !== false,
      medical: def.bed.medical === true,
      counts: def.bed.counts !== false,
      maxBody: def.bed.maxBody == null ? 1.5 : def.bed.maxBody,
      prisoner: false
    };
    if (info.human && b.bedMode) {
      if (b.bedMode === 'medical') { info.medical = true; info.prisoner = false; }
      else if (b.bedMode === 'prison') { info.medical = false; info.prisoner = true; }
      else { info.medical = false; info.prisoner = false; }
    }
    return info;
  }

  // ---------------------------------------------------------------- 推导
  /**
   * 按房间里的东西推导角色。返回 { role, name, def, score, why }。
   * room.things 是去重后的建筑对象（同一张 1×2 的床只算一个）。
   */
  function deriveRole(room) {
    var c = {
      adultBeds: 0, medBeds: 0, prisonBeds: 0, prisonMedBeds: 0,
      babyBeds: 0, animalBeds: 0,
      kitchen: 0, workshop: 0, lab: 0, dining: 0, rec: 0, storage: 0,
      tomb: 0, throne: 0, altar: 0, classroom: 0, ceremonial: 0,
      deathrest: 0, containment: 0, entityHolder: 0
    };

    (room.things || []).forEach(function (b) {
      var def = Data.byId[b.defId];
      if (!def) return;

      var bed = bedOf(b);
      if (bed) {
        if (bed.human) {
          c.humanBeds = (c.humanBeds || 0) + 1;
          if (bed.prisoner) {
            if (bed.medical) c.prisonMedBeds++;
            else c.prisonBeds++;
          } else if (bed.medical) {
            c.medBeds++;
          } else if (bed.maxBody < 0.9) {
            c.babyBeds++;
          } else if (bed.counts) {
            c.adultBeds++;
          }
        } else {
          c.animalBeds++;
        }
      }

      if (def.surfaceEat) c.dining++;
      if (def.workRole === 'Kitchen' || def.foodPrep) c.kitchen++;
      else if (def.workRole === 'Workshop') c.workshop++;
      else if (def.workRole === 'Laboratory') c.lab++;
      if (def.cat === 'joy') c.rec++;
      if (def.storage) c.storage++;
      if (def.sarcophagus) c.tomb++;
      if (def.throne) c.throne++;
      if (def.altar) c.altar++;
      if (def.classroom) c.classroom++;
      if (def.ceremonial) c.ceremonial++;
      if (def.deathrest) c.deathrest++;
      if (def.containment) c.containment++;
      if (def.entityHolder) c.entityHolder++;
    });

    var best = { id: 'room', score: 0.99, why: '没有匹配到更具体的用途' };
    function consider(id, score, why) {
      if (score > best.score) best = { id: id, score: score, why: why };
    }

    consider('none', -1, '不是一个封闭房间');
    // 床：游戏里医疗床会压过普通床；囚犯床单独算
    if (c.prisonBeds === 1 && c.prisonMedBeds === 0) {
      consider('prison', 170000, '1 张囚犯床');
    }
    if (c.prisonMedBeds === 1 && c.prisonBeds === 0) {
      consider('prison', 100000, '1 张医疗囚犯床');
    }
    if (c.prisonBeds + c.prisonMedBeds > 1) {
      consider('prisonBarracks', 100100 * c.prisonBeds + 50001 * c.prisonMedBeds,
        (c.prisonBeds + c.prisonMedBeds) + ' 张囚犯床');
    }
    if (c.medBeds > 0) {
      consider('hospital', 100000, c.medBeds + ' 张医疗床');
    }
    if (c.adultBeds === 1 && c.medBeds === 0) {
      consider('bedroom', 100000, '1 张普通床');
    }
    if (c.adultBeds > 1 && c.medBeds === 0) {
      consider('barracks', 100100 * c.adultBeds, c.adultBeds + ' 张普通床');
    }
    if (c.babyBeds >= 2) {
      consider('nursery', 100200 * c.babyBeds, c.babyBeds + ' 张婴儿床');
    }
    if (c.animalBeds > 0) {
      consider('barn', 7.6 * c.animalBeds, c.animalBeds + ' 张动物床');
    }
    if (c.kitchen > 0) {
      consider('kitchen', 28 * c.kitchen, c.kitchen + ' 个炉灶 / 食品工作台');
    }
    if (c.workshop > 0) {
      consider('workshop', 27 * c.workshop, c.workshop + ' 个工作台');
    }
    if (c.lab > 0) {
      consider('lab', 60 * c.lab, c.lab + ' 个研究台');
    }
    if (c.dining > 0) {
      consider('dining', 12 * c.dining, c.dining + ' 张餐桌');
    }
    if (c.rec > 0) {
      consider('rec', 7 * c.rec, c.rec + ' 个娱乐设施');
    }
    if (c.storage > 0) {
      consider('storage', 1 * c.storage, c.storage + ' 个储物架');
    }
    if (c.tomb > 0) {
      consider('tomb', 50 * c.tomb, c.tomb + ' 口棺材');
    }
    if (c.throne > 0) {
      consider('throne', 10000, '有王座');
    }
    if (c.ceremonial > 0) {
      consider('ceremonial', 200 * c.ceremonial, c.ceremonial + ' 个心灵仪式点');
    }
    if (c.deathrest > 0) {
      consider('deathrest', 100 * c.deathrest, c.deathrest + ' 个死眠棺 / 死眠设备');
    }
    if (c.containment + c.entityHolder > 0) {
      consider('containment', 100 * c.entityHolder + 50 * c.containment, '有收容 / 汲电设备');
    }
    if (c.altar > 0) {
      consider('worship', Math.max(2000, 75 * c.altar), c.altar + ' 个祭坛');
    }
    if (c.classroom > 0 && !c.humanBeds) {
      consider('classroom', 8 * c.classroom, c.classroom + ' 个课桌 / 黑板');
    }

    var def = roleById(best.id);
    return { role: def.id, name: def.name, def: def, score: best.score, why: best.why };
  }

  // ---------------------------------------------------------------- 目标温度
  /**
   * 房间的目标温度（规划用）。默认 21°C，存在 roomTemp 的每一格上。
   * 这是本工具的规划参数，不是游戏里的房间属性。
   */
  function temperatureOf(state, room) {
    var temps = state.roomTemp || {};
    for (var i = 0; i < room.cells.length; i++) {
      var k = room.cells[i][0] + ',' + room.cells[i][1];
      if (temps[k] != null) return temps[k];
    }
    return 21;
  }

  /** 给房间设目标温度。21°C 视为默认值，直接清掉。 */
  function setTemperature(state, room, temp) {
    if (!state.roomTemp) state.roomTemp = {};
    var t = Number(temp);
    var value = (isFinite(t) && t !== 21) ? Math.max(-60, Math.min(60, Math.round(t))) : null;
    var mods = [];
    room.cells.forEach(function (c) {
      var k = c[0] + ',' + c[1];
      var was = state.roomTemp[k] === undefined ? null : state.roomTemp[k];
      if (was === value) return;
      mods.push({ k: k, from: was, to: value });
      if (value === null) delete state.roomTemp[k];
      else state.roomTemp[k] = value;
    });
    if (mods.length) {
      var RW = global.RW;
      if (RW && RW.pushHistory) RW.pushHistory({ rtMod: mods });
    }
    return value;
  }

  // ---------------------------------------------------------------- 温控
  var COOLER_CELLS = 30;   // 一台制冷机在「温差 21°C」时能压住的格数
  var HEATER_CELLS = 25;   // 一台加热器的当量格数
  var REF_DELTA = 21;      // 参考温差（常温 21°C → 0°C）

  /**
   * 这个房间要达到目标温度，需要几台制冷机 / 加热器。
   * 返回 { kind: 'cool'|'heat'|'none', need: 台数, delta: 温差 }
   */
  function temperatureNeed(room, ambient, target) {
    var delta = (ambient == null ? 21 : ambient) - (target == null ? 21 : target);
    if (delta > 0) {
      return { kind: 'cool', need: Math.ceil(room.area * delta / (COOLER_CELLS * REF_DELTA)), delta: delta };
    }
    if (delta < 0) {
      return { kind: 'heat', need: Math.ceil(room.area * (-delta) / (HEATER_CELLS * REF_DELTA)), delta: delta };
    }
    return { kind: 'none', need: 0, delta: 0 };
  }

  global.RWRooms = {
    ROLES: ROLES,
    roleById: roleById,
    bedOf: bedOf,
    deriveRole: deriveRole,
    temperatureOf: temperatureOf,
    setTemperature: setTemperature,
    temperatureNeed: temperatureNeed,
    COOLER_CELLS: COOLER_CELLS,
    HEATER_CELLS: HEATER_CELLS
  };
})(typeof window !== 'undefined' ? window : globalThis);
