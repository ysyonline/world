// ============================================================================
// config.js · 配置层（一处调参，全局生效）
// 纯数据：全部可调数值集中于此。除 CONFIG 外不含任何逻辑，不依赖其它模块。
// 对应 08 §6 第 1 步模块化重构：把「调参」与「逻辑」彻底分开，
// 便于第 2~4 步合图缩放/战斗层移植时，数值只有一个改动入口。
// ============================================================================
'use strict';

// ============================ 配置区（一处调参，全局生效） ============================
const CONFIG = {
  dayLengthSec: 30,     // 1 游戏日 = 30 真实秒（待原型验证）
  startDay: 1,
  // 开局资源（九项 + 政治点，全部占位，待原型验证）
  start: { grain: 120, wood: 80, soil: 20, iron: 10, money: 200, pop: 30, soldiers: 0, prestige: 50, political: 0 },
  // 网格：城外田区（3×10，cell56，x280~840 / y120~288）；关内（4×10，cell64，x280~920 / y340~596）
  outGrid: { rows: 3, cols: 10, cell: 56, x0: 280, y0: 120 },
  inGrid:  { rows: 4, cols: 10, cell: 64, x0: 280, y0: 340 },
  // 岗位效率曲线（01 §3.2）：x≤N → x/N；超员默认禁塞
  overstaffK: 2.5,
  hardCapJobs: true,
  // 人口耗粮与饥荒（03 §3.2，占位）
  grainPerCapita: 1,
  soldierGrainMult: 1.5,
  famineBufferDays: 3,
  faminePrestigeDrain: 1,
  starvePopLoss: 2,
  // 三营训练（02 §1.5，占位）：满训 5 日 +16%/日 → 出营 80%；搏杀补（存活+3%/杀敌分摊+0.5%）
  trainingDays: 4,
  trainProfPerDay: 20,
  profPowerBase: 0.6,
  profPowerSpan: 0.4,
  profBattleSurvive: 3,   // 存活一场 +3%
  profPerKill: 0.5,       // 每杀敌 +0.5%（参与者分摊；器械击杀归操作工兵——P2⑥占位）
  // 军饷与欠缴（占位）
  soldierPayPerDay: 1,
  desertBase: 0.10,
  desertPerDay: 0.05,
  // 城墙分段（占位：甲乙丙丁四门）
  wall: { segNames: ['甲', '乙', '丙', '丁'], logMaxPerSeg: 2, oilMaxPerSeg: 2, xbowMaxPerSeg: 1 },
  gateMaxHp: 12,
  gateRepairSoil: 20,     // 修门：土20+木5（用户定：土多木少），一次修满
  gateRepairWood: 5,
  // 敌波次日程（02 §3 三层节奏，占位）
  waves: [
    { day: 15, size: 6,  siege: false, label: '小股骚扰' },
    { day: 26, size: 8,  siege: false, label: '小股骚扰' },
    { day: 33, size: 10, siege: false, label: '大股袭扰' },
    { day: 40, size: 14, siege: true,  label: '总攻' },
  ],
  raidWarnDays: 3,        // 基础预警提前日；有烽燧再 +1（01 §7 烽燧驱雾预警）
  assaultMultiP: 0.5,     // 总攻多门齐攻概率（否则猛攻一门；方向不预告，挂 P2①）
  // 敌方兵种（02 §1.2）：骚扰=游骑/铁骑/弩骑；总攻+步兵(云梯)/冲车/井阑
  enemyHp: 3,             // 敌方人员单位生命（占位）
  ramHp: 12, towerHp: 8,  // 器械生命（占位）
  raidRounds: 3,          // 骚扰波抢掠轮数（抢完即走）
  siegeRounds: 10,        // 总攻轮次上限（兜底防死循环）
  // 器械克制环（02 §3.2，占位系数）
  archerCoef: 1.5,        // 弓兵齐射输出系数（对人员）
  arrowVsEngine: 0.1,     // 普通箭对器械 ×0.1（刮痧）
  xbowDmg: 3,             // 重弩每架每轮输出（需工兵操作，1 工兵至多操 2 架）
  xbowVsEngine: 0.3,      // 重弩对器械 ×0.3
  logDmg: 2,              // 檑木每座每轮输出（需工兵操作）
  logVsEngine: 2.0,       // 檑木对器械 ×2
  oilKillP: 0.5,          // 火油倾倒：每台器械点燃概率（点燃=摧毁）
  oilDot: 4,              // 未点燃的持续灼伤（次轮结算）
  sortieKillP: 0.7,       // 出城拆除：每台器械拆除概率（最可靠）
  sortieIronLoss: 0.5,    // 出城折损：每存活铁骑截杀 0.5 出城兵（占位）
  sortieRiderLoss: 0.2,   // 每存活游骑截杀 0.2 出城兵
  ramGateDmg: 4,          // 冲车每轮撞门伤害
  towerKillP: 0.3,        // 井阑每轮点杀城头兵概率（每台）
  infantryMeleeCoef: 0.34,// 敌步兵登城/涌入杀近战系数（最低熟练先死=永久减人口）
  meleeCoef: 1.0,         // 我方近战互搏输出系数
  // 骚扰波（02 §4，占位）
  raidLootGrainCap: 0.10, // 开门：铁骑入城抢粮上限=城内库存 10%
  raidLootMoneyCap: 0.15, // 抢钱上限=15%
  raidLootGrainPerRider: 20, // 每入城铁骑携粮上限
  raidLootMoneyPerRider: 30,
  raidKillPopPerRider: 1, // 入城铁骑杀人（上限 3）
  raidKillPopMax: 3,
  raidLootPrestige: 3,    // 被抢掠声望损失
  interceptCoef: 0.5,     // 城内拦截系数 I（02 §4.1）：预备近战以逸待劳吃掉一半铁骑 [PLACEHOLDER]
  interceptLoss: 0.4,     // 拦截交换损耗：每拦 K 骑阵亡 ⌊K×0.4⌋ 近战（永久减人口）[PLACEHOLDER]
  raidFieldRobRate: 0.25, // 关门：劫粮道=城外各产地存量被抢比例
  raidFieldKillRate: 0.3, // 关门：城外平民被杀比例（收保可免）
  // 俘虏处置（03 §4 最简版；种子随机可复现）
  captiveRate: 0.5,
  captiveKillPrestige: 2,
  captiveConvertRate: 0.2,
  captiveEscapeRate: 0.1,
  // 运输线（v0.3 产者自运，01 §5 v0.4，占位）
  carryLoad: 5,           // 单人单趟负重 5 担
  walkSpeed: 60,          // walker 步速 60 像素/秒（占用真实帧时间，与倍速同步）
  // 商人与宵禁（01 §7 v0.4，占位）
  marketTax: 10,          // 市坊商税 10 钱/日直入库（坊5/肆12 占位上调，试玩后定）
  innTaxFactor: 0.5,      // 驿站过夜：次日商税 ×0.5（误早市）
  nightTheftP: 0.15,      // 夜赌·偷盗概率（放行才触发）
  nightTheftMoney: 0.10,  // 偷盗：钱 -10%
  nightTheftGrain: 0.05,  // 粮 -5%
  nightFireP: 0.08,       // 夜赌·失火概率：烧随机一座建筑（豁免粮仓/货仓）
  // 住房（01 §2.1 v0.4，占位）
  houseCap: 5,            // 每座民房容 5 名平民
  startHouses: 6,         // 开局送 6 座 = 上限 30 = 初始人口（满员开局）
  // 皇帝任务（07 最简版，占位）
  taskFirstDay: 6, taskEvery: 7, taskDueDays: 3,
  taskAmounts: { grain: 30, money: 25 },
  taskRewardMoney: 60, taskRewardPolitical: 5, taskFailPrestige: 5,
  // 流民来投（03 §3，沿用阈值驱动）
  refugeePrestige1: 45, refugeePrestige2: 70, // 且需粮存≥9天口粮（无粮不来投——自平衡闸门）
  // 胜负硬条件（03 §3.3、02 §4）
  winPrestige: 20,        // 守过总攻且声望达标（占位）
  assaultWinPrestige: 10, // 打退总攻声望 +10
  prestigeWarnLine: 10,   // 声望红色预警线（00-总纲 §5：归零即时判败前的最后提示）
  // 建筑造价表（01 §4.3 全表；zone: in=关内/out=城外）
  buildings: {
    // 城外产线：产出秒级累积产地存量，由在岗工人自运回城入库（v0.3 产者自运）
    farm:   { label: '农田',   zone: 'out', cost: { money: 20, wood: 5 },            capacity: 5, output: { grain: 20 } },
    lumber: { label: '伐木场', zone: 'out', cost: { money: 30, wood: 10 },           capacity: 3, output: { wood: 12 } },
    mine:   { label: '矿洞',   zone: 'out', cost: { money: 50, wood: 20 },           capacity: 3, output: { soil: 4, iron: 2 } },
    beacon: { label: '烽燧',   zone: 'out', cost: { money: 30, wood: 5, soil: 15 },  capacity: 0 }, // 无人驻守、驱雾、预警+1日
    // 关内
    granary:  { label: '粮仓',   zone: 'in', cost: { money: 40, wood: 20, soil: 10 }, capacity: 0, stores: ['grain'] },        // 粮入库点（限1座）
    depot:    { label: '货仓',   zone: 'in', cost: { money: 40, wood: 20, soil: 10 }, capacity: 0, stores: ['wood','soil','iron'] }, // 木土铁入库点（限1座）
    house:    { label: '民房',   zone: 'in', cost: { money: 20, wood: 10 },           capacity: 0 }, // 每座容5平民
    workshop: { label: '工匠坊', zone: 'in', cost: { money: 60, wood: 30, iron: 5 },  capacity: 3 }, // 产檑木/火油/重弩
    barracks: { label: '兵营',   zone: 'in', cost: { money: 60, wood: 30 },           capacity: 6 }, // 三营同建，全关隘限一座（v0.3 调参：70→60 保 D8~D12 可建成）
    market:   { label: '市坊',   zone: 'in', cost: { money: 50, wood: 20 },           capacity: 0 }, // 商人自动经营，税直入库
  },
  // 工匠坊产物（切换生产；耗料/个，满岗日产）
  workshopProducts: {
    log:      { label: '檑木', perDay: 1, cost: { wood: 8 } },
    oil:      { label: '火油', perDay: 1, cost: { wood: 6 } },
    crossbow: { label: '重弩', perDay: 0.5, cost: { wood: 12, iron: 4 } },
  },
  speeds: [1, 2, 4],
  maxLog: 8,
};
