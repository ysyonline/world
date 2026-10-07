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
  // ---- 网格：旧「抽象横带」布局已作废，改用合图真地图（08 §6 第 2 步）----
  // 城外分前郊/后郊两区（左右是深涧天险，城外只剩南北可用）：行 0~1 = 后郊（北），行 2~3 = 前郊（南）
  outGrid: { rows: 4, cols: 8, cell: 52, x0: 142, y0North: 135, y0South: 483, splitRow: 2 },
  inGrid:  { rows: 4, cols: 10, cell: 50, x0: 90, y0: 261 },
  // ---- 合图地图（08 §6 第 2 步）：世界坐标；zoom=1 时 1 世界单位 = 1px ----
  // 垂直（合计 722）：迷雾60 | 北接战75 | 后郊产业104 | 北墙22 | 城内200 | 南墙22 | 前郊产业104 | 南接战75 | 迷雾60
  // 水平（合计 700）：左天险90 | 城520 | 右天险90
  // 尺寸由来（反向推导，非拍脑袋）：①硬约束1 全景须装下 城内+城墙+城外产业+近郊接战
  //   ②硬约束2 战斗档单兵屏幕直径 ≥12px ③城内格屏幕 ≥38px 才放得下三行标签
  map: {
    worldW: 700, worldH: 722,
    fog: 60,        // 迷雾带（单侧）：商人进货去向 / 敌来向 / 烽燧驱散
    battle: 75,     // 近郊接战区（单侧）：敌集结与我军出城拆除器械的战场
    cliffW: 90,     // 左右深涧天险：不可建造 / 不可进攻 / 不可布防（08 §3 侧翼天险）
    wallThick: 22,
    city: { x: 90, y: 261, w: 520, h: 200 },
    // 两门 + 各自门侧一段可攀墙 = 每方向 2 攻击点 = 全域 4 段布防（08 §3 进攻面方案②）
    segs: [
      { name: '前门',   side: 'south', x: 320, w: 60,  climb: false, maxHp: 12 }, // 正门
      { name: '前侧墙', side: 'south', x: 420, w: 120, climb: true,  maxHp: 12 }, // 云梯可攀（无门，耐久仅供回合制兜底）
      { name: '后门',   side: 'north', x: 190, w: 60,  climb: false, maxHp: 9  }, // 便门：耐久更低（02 §3.1 定案，第 4 步实装）
      { name: '后侧墙', side: 'north', x: 300, w: 120, climb: true,  maxHp: 12 },
    ],
  },
  // 视口与相机：右栏常驻 280 + 顶 HUD 56 + 底日志 80 → 地图视口 1000×584
  view: { x: 0, y: 56, w: 1000, h: 584, panelW: 280, logH: 80 },
  camera: {
    // 全景档 zoom 运行时按 fit 算出（0.81），不写死；战斗档为验收值：
    // 下界 = 单兵≥12px（世界直径 13 → zoom≥0.92），上界 = 一方向「门+门侧墙」同屏（→zoom≤1.56）
    battleZoom: 1.4, // [PLACEHOLDER 区间中值偏上，实测后回填]
  },
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
  // 城墙分段（08 §3 定案：两门 + 门侧可攀墙 = 4 段；左右天险不设段）；几何见 map.segs
  wall: { segNames: ['前门', '前侧墙', '后门', '后侧墙'], logMaxPerSeg: 2, oilMaxPerSeg: 2, xbowMaxPerSeg: 1 },
  gateMaxHp: 12,
  gateRepairSoil: 20,     // 修门：土20+木5（用户定：土多木少），一次修满
  gateRepairWood: 5,
  // —— 08 §6 第 4 步：跨层接口（战前快照 / 战后回写）——
  assaultMode: 'live',    // 'live'=总攻进实时战场（浏览器默认）｜'turnbased'=委托将领回合制结算（无头回归 playtest/trace 走这条）
  assaultGateBrokenPrestige: 2, // 每破一门额外扣声望 [PLACEHOLDER：取打赢声望 +10 的 1/5，避免"破一门=等于白打"]
  assaultLootPerKill: 0,        // 战利品：每歼敌缴获钱 [PLACEHOLDER·挂 EA，与俘虏机制联动；默认 0=只留接口不进水]
  invaderDemolishP: 0.25,       // 入城敌每名毁 1 座城内建筑的概率 [PLACEHOLDER]
  liveSkillCost: { log: 1, oil: 1 }, // 战中技能消耗工匠坊库存：檑木/火油各 1 份；修门同 repairGate 价（土20木5）
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
  // 步速（世界单位/秒）：合图后真实几何让「产地→最近门→仓」平均单程由 ~660 降到 ~258（-61%），
  // 故 60 → 30 等比下调，维持运输税留在原 13~19% 区间（否则运输线不再构成约束）。[PLACEHOLDER·按 trace 复测]
  walkSpeed: 30,
  // 商人与宵禁（01 §7 v0.4，占位）
  marketTax: 10,          // 市坊商税 10 钱/日直入库（坊5/肆12 占位上调，试玩后定）
  // ---- 月度人头税·口钱（v0.4.2，2026-10-07 用户裁决实装；01 §3.4.3）----
  // 每 30 游戏日按人口征一次（税基=平民全员含闲民/商人；士兵纳粮不纳税=汉制戍卒廪食）。
  // 滑杆五档：钱×声望反向对冲（Stronghold 制衡环 + 汉制算赋120钱/年·口赋23钱/年按月敛）。
  // 锚：30人×轻赋1钱=30钱/月，平赋=60——接住任务异构化砍掉的钱口（原-35钱/7日），形态从脉冲改基线。
  // 制衡：重赋-3声望/月 → 2个月跌破流民线45 → 税基萎缩（收税自杀）；免赋+1声望=花钱买人口增速。
  taxMonthDays: 30,
  taxLevels: [
    { key: 'none',   label: '免赋', perHead: 0, prestige: +1, note: '休养生息（声望+1/月）' },
    { key: 'light',  label: '轻赋', perHead: 1, prestige: 0,  note: '常态（默认）' },
    { key: 'fair',   label: '平赋', perHead: 2, prestige: -1, note: '民有微词' },
    { key: 'heavy',  label: '重赋', perHead: 3, prestige: -3, note: '民怨渐起' },
    { key: 'harsh',  label: '苛赋', perHead: 4, prestige: -6, note: '亡者相随' },
  ],
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
  // 皇帝任务奖励（2026-10-07 用户裁决·异构化）：交 A 类型换 B 类型——同类型奖励（交钱换更多钱）不构成决策，"想都不用想做"。
  // 缴军粮/税钱 → 声望+3（流民阈值活收益）+ 政治点+5（EA 消费口）；钱奖励删除。经济总水源 -35钱/7日 由断层修法②（总攻随守军缩放）对冲。
  taskRewardPrestige: 3, taskRewardPolitical: 5, taskFailPrestige: 5,
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
