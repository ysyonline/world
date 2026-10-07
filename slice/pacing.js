// pacing.js · 08 §6 第 5 步「对照测试」B 信号检测器（经营:战斗 时间比实测）
// 跑法：node slice/pacing.js
//
// ============================ 为什么要这个文件 ============================
// 65:35（00 §5 裁定 1）是个**注意力时间**预算，不是游戏内时长预算。两种口径天差地别：
//   ✗ 游戏内时长：经营 40 日 × 30 秒 = 1200 秒 vs 一场总攻几十秒 → 恒 95:5，永远不可能达标
//   ✓ 注意力时间：玩家**在做什么的那几秒**。经营期玩家挂加速/发呆，只在决策瞬间消耗注意力；
//     战斗期玩家 100% 在场（1:1 实时、不能跳），全程消耗注意力。
// 只有后者是设计意图真正指向的东西（商业游戏讲 pacing 讲的就是玩家投入）。
//
// ============================ 测量模型（自洽性论证） ============================
//   战斗侧 = 实时战场总时长（含暂停思考）  ← 硬数据，不依赖任何假设
//   经营侧 = 决策点数 × 每决策耗时          ← 软数据，含一个 PLACEHOLDER 假设
// 两侧不对称是**对的**，不是 bug：战斗期玩家全程盯着所以用墙钟；经营期玩家多数时间不盯，
// 只有决策瞬间才消耗注意力——把 1200 秒全算进去等于假设玩家一直盯着资源栏发呆。
//
//   不重复计：战斗中的微操**不再计入经营决策**（已含在 activeTime 墙钟里）。
//
// ============================ 为什么输出区间而不是单点 ============================
// 「每决策耗时」是玩家行为假设，快手 4 秒 / 慢手 10 秒都合理。所以：
//   - 区间整体偏离 65±10pp  → B 信号确定触发，无争议
//   - 区间整体落在带内      → B 通过
//   - 区间跨越带边          → 取决于玩家风格，**必须实机采样才能定**，工具如实这么说
// 另给「严/宽」两种决策计数口径（轻决策是否折算），用于检验结论是否对口径敏感。
//
// ============================ 埋点方式 ============================
// 决策计数用 monkey-patch 包装 sim 的动作函数，**sim.js 一行不改** → trace 基线零漂移，
// smoke/playtest/settle-smoke 全部零影响。计数不写 state.log（所以不进 trace 输出）。
const { loadSliceModules } = require('./load-modules');
const code = loadSliceModules();

const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : () => {}) });
const fakeCanvas = { getContext: () => ctxProxy, width: 1280, height: 720, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
globalThis.document = { getElementById: () => fakeCanvas };
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const run = `
CONFIG.assaultMode = 'live';   // 走真实路径：总攻日进实时战场（这是 B 信号要测的那条路）
CONFIG.refugeePrestige1 = 999; CONFIG.refugeePrestige2 = 999; state.nextTaskDay = 9999; // 去流民/圣旨干扰：只测经营-战斗骨架

// ============================ 决策计数器（monkey-patch，不改 sim.js） ============================
// 轻决策 = 单次点击即完成（上岗/撤岗/送训/撤训）；重决策 = 需要想清楚（建造/布防/器械/修门/收保/答决策）
//
// 关键：只计**成功**的决策。失败点击（钱不够/岗位已满/无兵可撤）玩家不会重复点，
// 把它们算进决策点会系统性高估经营侧——实测发现全计会虚高到 222 次建房子。
const DEC = { total: 0, heavy: 0, light: 0, byKind: {}, fail: 0 };
function noteDec(kind, isLight, okFlag) {
  // 返回值语义：true/undefined=成功，false=被规则拒绝（部分函数成功时不显式 return true → 记成功）
  if (okFlag === false) { DEC.fail++; return; }
  DEC.total++; if (isLight) DEC.light++; else DEC.heavy++;
  DEC.byKind[kind] = (DEC.byKind[kind] || 0) + 1;
}
function patch(name, isLight) {
  const orig = eval(name);
  eval(name + ' = function () { const r = orig.apply(this, arguments); noteDec("' + name + '", ' + !!isLight + ', r); return r; }');
}
['tryBuild:0', 'demolish:0', 'hireMerchant:0', 'rushConscript:0',
 'deployTroop:0', 'withdrawTroop:0', 'deployGear:0', 'withdrawGear:0', 'repairGate:0',
 'toggleRecall:0', 'answerDecision:0', 'enterBattle:0',
 'assignWorker:1', 'sendTrainee:1', 'removeTrainee:1'].forEach(function (s) {
  const p = s.split(':'); patch(p[0], p[1] === '1');
});

// ============================ 实时战斗计时（墙钟，硬数据） ============================
// 战斗期玩家全程在场：activeTime（推进中）+ pausedTime（暂停思考，玩家在读战况）
// 注意：战斗结束瞬间 exitBattle() 会把 live.active 置 false，所以**不能**在收尾时靠 live.active 守卫读时钟——
// 改为进战场时记基线、结束读差值。
const BT = { battles: 0, active: 0, paused: 0, ops: 0, wins: 0 };
function readBattleClock(base) {
  BT.active += Math.max(0, Battle.S.activeTime - base.atk);
  BT.paused += Math.max(0, Battle.S.pausedTime - base.pau);
  BT.ops += Math.max(0, Battle.S.ops - base.ops);
}

// ============================ 经营期策略（移植 playtest 的最小获胜策略） ============================
// 关键：策略只负责"做什么"，不负责"用多久想"——后者是折算参数（见 PER_DECISION 档）。
AUTO = { curfew: true, emperor: true, gate: false, oil: true, sortie: false, block: true };
state.curfewPolicy = 'closed';
function B(k, zone, r, c) { tryBuild(k, zone, r, c); return gridOf(zone)[r][c]; }

function buildEconDay() {
  if (state.day === 4) { const m = B('mine', 'out', 2, 0); if (m) m.workers = 3; }
  if (getRes('pop') >= houseCap() - 1) B('house', 'in', 3, 6);
  if (state.day >= 4) B('market', 'in', 3, 3);
  if (!state.inGrid[1][1] && countBuilding('market') > 0 && getRes('money') >= 90) B('barracks', 'in', 1, 1);
  if (state.day === 14) { const f3 = B('farm', 'out', 1, 1); if (f3) f3.workers = 5; }
  if (state.day >= 22) { const f4 = B('farm', 'out', 2, 1); if (f4) f4.workers = 5; }
  const br = state.inGrid[1][1];
  if (br && br.type === 'barracks' && state.day >= 11) {
    const want = ['melee', 'archer', 'melee', 'archer', 'engineer', 'melee', 'archer', 'engineer', 'melee', 'archer', 'melee', 'melee'];
    const trained = getRes('soldiers') + br.queue.length;
    if (trained < want.length && br.queue.length < CONFIG.buildings.barracks.capacity && idlePop() > 1) sendTrainee(br, want[trained]);
  }
  [['out', 0, 0], ['out', 0, 1], ['out', 1, 1], ['out', 2, 1], ['out', 1, 0], ['out', 2, 0]].forEach(function (pos) {
    const b = state.outGrid[pos[1]][pos[2]];
    if (b && CONFIG.buildings[b.type].capacity > 0) {
      while (b.workers < CONFIG.buildings[b.type].capacity && idlePop() > 0 && assignWorker(b, 1)) {}
    }
  });
  state.troops.forEach(function (t) { if (t.type === 'archer' && t.seg === null) t.seg = state.troops.filter(x => x.type === 'archer' && x.seg !== null).length % 4; });
  [0, 1, 2, 3].forEach(function (s) {
    while (state.inv.log > 0 && state.segLogs[s] < 2) deployGear(s, 'log');
    while (state.inv.oil > 0 && state.segOil[s] < 2) deployGear(s, 'oil');
    while (state.inv.crossbow > 0 && state.segXbow[s] < 1) deployGear(s, 'crossbow');
    if (state.gateHp[s] < gateMaxOf(s)) repairGate(s);
  });
  AUTO.emperor = getRes('money') >= 25 + 30 && getRes('grain') >= 30 + Math.ceil(state.grainNeed * 2);
  B('farm', 'out', 0, 0); B('farm', 'out', 0, 1); B('lumber', 'out', 1, 0);
  if (state.day >= 14) B('farm', 'out', 1, 1);
  if (state.day >= 22) B('farm', 'out', 2, 1);
  const nw = nextWave();
  if (nw && !nw.wave.siege && nw.wave.day - state.day === 1 && !state.recalled) toggleRecall();
  if (state.recalled && (!nw || nw.wave.day - state.day > 1)) toggleRecall();
}

// ============================ 战斗操作（移植 settle-smoke 的拟人微操） ============================
function playBattleReal() {
  const base = { atk: Battle.S.activeTime, pau: Battle.S.pausedTime, ops: Battle.S.ops };
  const C = CONFIG.map.city;
  const g0 = Battle.GATES.filter(function (g) { return g.side === 'south'; })[0];
  const g1 = Battle.GATES.filter(function (g) { return g.side === 'north'; })[0];
  const wyN = C.y - 10, wyS = C.y + C.h + 10;
  Battle.select([2]); Battle.move(C.x + C.w * 0.5, wyN); advanceClock(6);
  Battle.select([1]); Battle.move(C.x + C.w * 0.75, wyS); advanceClock(6);
  Battle.select([3]); Battle.move(g0.x, g0.y - 40); advanceClock(5);
  Battle.select([0]); Battle.move(C.x + C.w / 2, C.y + C.h / 2); advanceClock(5);
  Battle.select([2]); useBattleSkill('volley', 0, 0); advanceClock(26);
  Battle.select([2]); useBattleSkill('volley', 0, 0); advanceClock(6);
  Battle.setPaused(false);
  let guard = 0;
  while (!Battle.S.gameOver && guard++ < 3800) {
    advanceClock(0.5);
    const t0 = Battle.S.teams[0], t1 = Battle.S.teams[1], t2 = Battle.S.teams[2], t3 = Battle.S.teams[3];
    const southThreat = Battle.S.enemies.filter(function (e) { return !e.dead && e.y > C.y + C.h - 90 && e.squad !== 'red'; }).length;
    if (!t2.dead && t2.onWall && t2.wallSide !== 'south' && southThreat >= 3) { Battle.select([2]); Battle.move(C.x + C.w * 0.5, wyS); }
    if (!t2.dead && t2.onWall && t2.volleyCd <= 0) { Battle.select([2]); useBattleSkill('volley', 0, 0); }
    const southEng = Battle.S.enemies.filter(function (e) { return !e.dead && (e.kind === 'ram' || e.kind === 'tower') && e.y > C.y + C.h - 90 && Math.abs(e.x - g0.x) < 300; }).length;
    if (!t3.dead && !t3.onWall && southEng >= 2 && Battle.S.t > 60) { Battle.select([3]); Battle.move(C.x + C.w * 0.5, wyS); }
    if (!t3.dead && t3.onWall && t3.oilCd <= 0) { Battle.select([3]); useBattleSkill('oil', 0, 0); }
    if (!t3.dead && t3.onWall && t3.logCd <= 0) { Battle.select([3]); useBattleSkill('log', 0, 0); }
    if (!t1.dead && t1.onWall && t1.logCd <= 0) { Battle.select([1]); useBattleSkill('log', 0, 0); }
    if (!g0.broken && g0.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      Battle.select([3]); t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g0.x; t3.y = g0.y - 40;
      useBattleSkill('repair', g0.x, g0.y);
    }
    if (!g1.broken && g1.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      Battle.select([3]); t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g1.x; t3.y = g1.y + 40;
      useBattleSkill('repair', g1.x, g1.y);
    }
    if (Battle.S.t > 80 && t1.onWall && !g0.broken && g0.hp < 6) { Battle.select([1]); Battle.move(g0.x, g0.y - 40); }
    if (g0.broken && !t0.dead && Math.hypot(t0.x - g0.x, t0.y - g0.y) > 30) { Battle.select([0]); Battle.move(g0.x, g0.y - 40); }
    if (!g0.broken && !g1.broken && !t0.dead && g1.hp < 6 && Math.hypot(t0.x - g1.x, t0.y - g1.y) > 60) { Battle.select([0]); Battle.move(g1.x, g1.y + 40); }
    if (g1.broken && !t1.dead && Math.hypot(t1.x - g1.x, t1.y - g1.y) > 30) {
      Battle.select([1]); t1.onWall = false; t1.wallSide = null; Battle.move(g1.x, g1.y + 40);
    }
  }
  readBattleClock(base);
  BT.battles++;
  if (Battle.S.gameOver && Battle.S.gameOver.win) BT.wins++;
}

// ============================ 跑一整局 ============================
function runOne(seed) {
  // 重置到干净开局（同 seed 复用 rand 流）
  location_reload_soft(seed);
  BT.battles = 0; BT.active = 0; BT.paused = 0; BT.ops = 0; BT.wins = 0;
  DEC.total = 0; DEC.heavy = 0; DEC.light = 0; DEC.byKind = {}; DEC.fail = 0;
  let guard = 0;
  const f1 = B('farm', 'out', 0, 0), f2 = B('farm', 'out', 0, 1), lu = B('lumber', 'out', 1, 0);
  f1.workers = 5; f2.workers = 5; lu.workers = 3;
  // 开局这几下算「开局一次性布置」，不计入节奏预算（新手前 60 秒不算 pacing）
  const bootCount = DEC.total;
  let peakTroops = 0, troopsAtAssault = 0;
  while (!state.gameOver && guard++ < 200) {
    if (state.live.active) {
      if (!troopsAtAssault) troopsAtAssault = getRes('soldiers');   // 记录总攻日真实带兵量
      playBattleReal();
    } else { buildEconDay(); advanceClock(31); }
    if (state.battleReport) { state.battleReport = null; if (state.pendingCaptives > 0) imprisonCaptives(); state.paused = false; }
    if (state.paused) state.paused = false;
    if (getRes('soldiers') > peakTroops) peakTroops = getRes('soldiers');
  }
  return {
    seed: seed, days: state.day, win: !!(state.gameOver && state.gameOver.win),
    decTotal: DEC.total - bootCount, decHeavy: DEC.heavy, decLight: DEC.light, decFail: DEC.fail,
    battleSec: BT.active + BT.paused, battleActive: BT.active, battlePaused: BT.paused,
    battleOps: BT.ops, battles: BT.battles, peakTroops: peakTroops, troopsAtAssault: troopsAtAssault,
    over: state.gameOver ? state.gameOver.reason : '（未分胜负）',
    byKind: Object.assign({}, DEC.byKind),
  };
}
function location_reload_soft(seed) {
  // 软重开：只重置会被测到的字段（完整重开需重跑 eval，代价大且与节奏无关）
  state.day = CONFIG.startDay; state.dayProgress = 0; state.paused = false; state.speedIdx = 0;
  state.res = Object.assign({}, CONFIG.start);
  state.outGrid = makeGrid(CONFIG.outGrid); state.inGrid = makeGrid(CONFIG.inGrid);
  state.troops = []; state.buildMode = null; state.selected = null; state.selectedSeg = null;
  state.rngState = seed; state.famine = false; state.grainNeed = CONFIG.start.pop * CONFIG.grainPerCapita;
  state.segLogs = [0, 0, 0, 0]; state.segOil = [0, 0, 0, 0]; state.segXbow = [0, 0, 0, 0];
  state.inv = { log: 0, oil: 0, crossbow: 0 }; state.walkers = []; state.curfewPolicy = 'ask';
  state.innStay = false; state.recalled = false; state.merchants = 0; state.gateOpen = true;
  state.ledger = { yday: null, today: {} }; state.ledgerView = false; state.enemies = [];
  state.waveFired = {}; state.battle = null; state.battleReport = null; state.decisionQueue = [];
  state.pendingDecision = null; state.captives = 0; state.pendingCaptives = 0;
  state.gameOver = null; state.checkpoint = null; state.live = { armed: false, active: false, focusSeg: 0, result: null, pre: null, skillUse: null, waveSize: 0, settled: false };
  state.unpaidDays = 0; state.task = null; state.nextTaskDay = CONFIG.taskFirstDay; state.payNeed = 0; state.deserters = 0;
  state.gateHp = CONFIG.map.segs.map(function (s) { return s.maxHp || CONFIG.gateMaxHp; });
  state.inGrid[2][2] = { type: 'granary', workers: 0 };
  state.inGrid[2][3] = { type: 'depot', workers: 0 };
  for (let c = 4; c <= 7; c++) state.inGrid[0][c] = { type: 'house', workers: 0 };
  state.inGrid[1][4] = { type: 'house', workers: 0 }; state.inGrid[1][5] = { type: 'house', workers: 0 };
  CONFIG.assaultMode = 'live';
}

// ============================ 折算与判定 ============================
// 每决策耗时假设（秒）——玩家行为假设，非测量值。给三档做区间。
const PER_DECISION = { fast: 4, normal: 7, slow: 11 };
// 轻决策折算系数（严口径 1.0 = 每次点击都算一次完整决策；宽口径 0.4 = 连点批量上岗算 0.4 次）
const LIGHT_W = { strict: 1.0, loose: 0.4 };
const TARGET_ECON = 65, TOL_PP = 10;   // 00 §5裁定 1 + 08 §5 信号 B 的 ±10pp
const SEEDS = [20261004, 20261005, 20261006, 771113, 424242];

const runs = SEEDS.map(runOne);
console.log('\\n========== B 信号实测：经营:战斗 注意力时间比 ==========');
console.log('口径：战斗=实时战场墙钟（含暂停思考，硬数据）｜经营=决策点数×每决策耗时（软数据）');
console.log('目标 65:35，容差 ±' + TOL_PP + 'pp\\n');
console.log('种子\\t结局\\t日数\\t决策数\\t重\\t轻\\t战斗秒\\t有效操作\\t总攻带兵');
runs.forEach(function (r) {
  console.log(r.seed + '\\t' + (r.win ? '胜' : '败:' + r.over) + '\\t' + r.days + '\\t' + r.decTotal + '\\t' + r.decHeavy + '\\t' + r.decLight
    + '\\t' + r.battleSec.toFixed(0) + '\\t' + r.battleOps + '\\t' + r.troopsAtAssault);
});

function avgOf(f) { return runs.reduce(function (s, r) { return s + f(r); }, 0) / runs.length; }
const decStrict = avgOf(function (r) { return r.decHeavy + r.decLight * LIGHT_W.strict; });
const decLoose  = avgOf(function (r) { return r.decHeavy + r.decLight * LIGHT_W.loose; });
const battleSec = avgOf(function (r) { return r.battleSec; });
const battlePerRun = avgOf(function (r) { return r.battles; });

console.log('\\n平均：决策点 ' + decStrict.toFixed(0) + '（严口径）/ ' + decLoose.toFixed(0) + '（宽口径）· 战斗 '
  + battleSec.toFixed(0) + ' 秒/局（' + battlePerRun.toFixed(1) + ' 场）');

console.log('\\n--- 比值区间（每决策耗时 × 决策计数口径）---');
const rows = [];
['fast', 'normal', 'slow'].forEach(function (tk) {
  ['strict', 'loose'].forEach(function (ck) {
    const dec = ck === 'strict' ? decStrict : decLoose;
    const econ = dec * PER_DECISION[tk];
    const ratio = econ / (econ + battleSec) * 100;
    const pp = ratio - TARGET_ECON;
    rows.push({ tk: tk, ck: ck, ratio: ratio, pp: pp });
    console.log('  每决策' + PER_DECISION[tk] + 's × ' + ck + '\\t→ 经营 ' + (econ / 60).toFixed(1) + '分 : 战斗 '
      + (battleSec / 60).toFixed(1) + '分 = ' + ratio.toFixed(1) + ':' + (100 - ratio).toFixed(1)
      + '\\t偏离 ' + (pp >= 0 ? '+' : '') + pp.toFixed(1) + 'pp');
  });
});

const pps = rows.map(function (r) { return r.pp; });
const lo = Math.min.apply(null, pps), hi = Math.max.apply(null, pps);
const allIn = lo >= -TOL_PP && hi <= TOL_PP;
const allOut = hi < -TOL_PP || lo > TOL_PP;
console.log('\\n--- B 信号判定 ---');
console.log('区间：' + lo.toFixed(1) + 'pp ～ ' + hi.toFixed(1) + 'pp（带内 -' + TOL_PP + '～+' + TOL_PP + '）');
if (allIn) {
  console.log('判定：【B 未触发】全区间落在 65±10pp 内 —— 节奏预算成立');
} else if (allOut) {
  console.log('判定：【B 触发】全区间在带外（' + (hi < 0 ? '战斗偏少：经营太重 / 战斗太短' : '战斗偏多：战斗太长 / 经营太空') + '）');
  console.log('含义：这不是调参能解决的量级差，是关卡长度 / 战斗烈度 / 决策密度的结构问题。');
} else {
  console.log('判定：【B 结论待定】区间跨越带边 → 取决于玩家决策快慢，工具无法单方裁定。');
  console.log('需要：用户实机跑一局报「实际用时」，或收窄 PER_DECISION 假设（改本文件顶部常量）。');
}
console.log('\\n决策点分布：' + JSON.stringify(runs[0].byKind));
console.log('失败点击（未计入决策点）：' + avgOf(function (r) { return r.decFail; }).toFixed(0) + ' 次/局');

// ============================ 附带发现（2026-10-07 已修）：经济产出 vs 战斗烈度断层 ============================
// 历史背景：第 5 步对照测试发现——同一套最小获胜经济策略 40 日只能养 4~7 兵，
//   而总攻写死 36 单位 → 实时战斗 5/5 种子全败（回合制却 4 兵可守）。
// 2026-10-07 用户裁决修法②+任务异构化：spawnSiege 按守军×0.65×声望系数缩放（钳 12~46），
//   皇帝任务奖励去钱改声望（声望越高总攻越大——03 §3.4 双刃剑接通）。
// 本段保留为断层口径监视器：若胜率回撤或攻守比再失衡，此处报警。
const atkTroops = avgOf(function (r) { return r.troopsAtAssault; });
const peakTroops = avgOf(function (r) { return r.peakTroops; });
console.log('\\n========== 断层监视（修法②已落地）：总攻规模 vs 守军 ==========');
console.log('总攻日实际带兵：' + atkTroops.toFixed(1) + ' 人（全程峰值 ' + peakTroops.toFixed(1) + ' 人）');
console.log('总攻规模：spawnSiege 按守军×0.65×声望系数缩放（钳 12~46；满编 55 兵→36 敌=旧规模）');
console.log('实时总攻胜率：' + runs.filter(r => r.win).length + '/' + runs.length
  + (runs.every(r => r.win) ? ' —— 断层已关闭（修复前同一策略 5/5 全败）' : ' —— ⚠ 有种子告负，攻守比锚 0.65 或声望系数需复查'));

console.log('\\n注意：C 信号（认知断裂）不由本文件判定——它需要玩家主观反馈，见 08 文档 §5。');
`;

eval(code + run);
