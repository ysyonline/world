// ============================================================================
// state.js · 状态层（唯一数据源 + 数据层读写 + 存档）
// 职责：state 容器、日志、账本记账、总攻前夜存档/读档、资源读写与钳制。
// 约定：只改「状态是什么」，不改「状态怎么变」——行为规则一律在 sim.js。
// ============================================================================
'use strict';

// ============================ 全局状态 ============================
function makeGrid(cfg) {
  const g = [];
  for (let r = 0; r < cfg.rows; r++) { g.push([]); for (let c = 0; c < cfg.cols; c++) g[r].push(null); }
  return g;
}
const state = {
  day: CONFIG.startDay,
  dayProgress: 0,
  paused: false,
  speedIdx: 0,
  log: [],
  res: Object.assign({}, CONFIG.start), // 九项 + 政治点，唯一数据源
  outGrid: makeGrid(CONFIG.outGrid),    // 城外：{type, workers, stock:{...}}
  inGrid: makeGrid(CONFIG.inGrid),      // 关内：{type, workers, queue/product...}
  buildMode: null,
  selected: null,        // {zone:'in'|'out', r, c}
  hoverCell: null,
  mouse: { x: 0, y: 0 },
  famine: false,
  grainNeed: CONFIG.start.pop * CONFIG.grainPerCapita,
  troops: [],            // {prof:0~100, seg:null|0~3, type:'melee'|'archer'|'engineer'}
  unpaidDays: 0,
  // 实时战斗层（08 §6 第 4 步）：armed=总攻已至 / active=正在实时战斗中
  // pre = 战前快照（对账与归因链的基准：人口/兵力/门耐久/器械/物资）
  // skillUse = 战中消耗台账（檑木/火油/修门次数）——战后进账本与结算面板
  // settled：总攻已结算（禁止再进战场——否则可反复重开刷结果，stakes 归零）
  live: { armed: false, active: false, focusSeg: 0, result: null, pre: null, skillUse: null, waveSize: 0, settled: false },
  payNeed: 0,
  deserters: 0,
  selectedSeg: null,
  // 门耐久按段取上限：便门 9 < 正门 12（02 §3.1 定案；墙段无门，取 gateMaxHp 供回合制兜底）
  gateHp: CONFIG.map.segs.map(function (s) { return s.maxHp || CONFIG.gateMaxHp; }),
  segLogs: [0, 0, 0, 0],      // 已部署檑木
  segOil: [0, 0, 0, 0],       // 已部署火油
  segXbow: [0, 0, 0, 0],      // 已部署重弩
  inv: { log: 0, oil: 0, crossbow: 0 }, // 工匠坊产物库存（未部署）
  walkers: [],           // 走路实体 {kind:'carry'|'recall'|'resume'|'merchant', x,y, path:[{x,y}], t, speed, color, cargo?, from?, bRef?}
  curfewPolicy: 'ask',   // 宵禁三态政策：'open'常开 | 'closed'常闭 | 'ask'每晚询问（默认）
  taxLevel: 1,           // 口钱档位索引（CONFIG.taxLevels，默认 1=轻赋；v0.4.2 月度人头税）
  innStay: false,        // 商人昨夜是否宿驿站（次日商税减半）
  recalled: false,       // 收保状态：true=城外平民已撤回（停产安全）
  merchants: 0,          // 在岗商人（建市坊自动抽闲民）
  gateOpen: true,        // 城门状态（昼开夜闭为 flavor；骚扰波/宵禁另有决策）
  ledger: { yday: null, today: {} },   // 账本田鸡：昨日实结快照 + 今日按来源累计
  ledgerView: false,     // 账本明细浮层开关
  enemies: [],           // 关外敌情标记 {seg|null, n, siege, raid}
  waveFired: {},
  battle: null,          // 战斗续体上下文（stepBattle）
  battleReport: null,
  decisionQueue: [],     // 决策队列：骚扰开/关门、宵禁、皇帝任务、战中三决策点
  pendingDecision: null, // 当前待答决策 {kind, ...}
  captives: 0,
  pendingCaptives: 0,
  rngState: 20261004,    // 种子随机 mulberry32（可复现）
  task: null,            // 皇帝任务 {kind, amount, due, accepted}
  nextTaskDay: CONFIG.taskFirstDay,
  gameOver: null,        // {win, reason, detail}
};
// 开局自带建筑：粮仓+货仓（双仓入库点）+ 民房×6（住房上限 30 = 初始人口，满员开局）
// 仓放城内中部行（08 §6 第 2 步）：合图后「产地→门→仓」是真实距离，仓贴北侧会让前郊运输
// 距离 4 倍于后郊 → 前郊沦为陷阱选项。放中部把差距压到 ~1.5 倍，玩家仍可再往南迁做优化。
state.inGrid[2][2] = { type: 'granary', workers: 0 };
state.inGrid[2][3] = { type: 'depot', workers: 0 };
state.inGrid[0][4] = { type: 'house', workers: 0 };
state.inGrid[0][5] = { type: 'house', workers: 0 };
state.inGrid[0][6] = { type: 'house', workers: 0 };
state.inGrid[0][7] = { type: 'house', workers: 0 };
state.inGrid[1][4] = { type: 'house', workers: 0 };
state.inGrid[1][5] = { type: 'house', workers: 0 };

function pushLog(text) {
  state.log.push('第' + state.day + '日 · ' + text);
  if (state.log.length > CONFIG.maxLog) state.log.shift();
}

// ============================ 总攻前夜自动存档（00-总纲 §5：防"3 小时败于一次失误"） ============================
// 快照点：总攻日晨（当日首 tick 前）——此时骚扰已打完、布防未定，是"重打总攻"最干净的起点。
// 边界：战败/涌入判败后可读档；快照仅一份（新总攻覆盖旧档）；读档恢复全部 state（含 RNG 种子，可复现）。
function autoSaveCheck() {
  const nw = nextWave();
  if (!nw || !nw.wave.siege) return;
  if (nw.wave.day === state.day + 1 && !state.checkpoint) { // 总攻前夜（次日总攻）打一次快照
    try {
      state.checkpoint = JSON.parse(JSON.stringify({
        day: state.day, res: state.res, outGrid: state.outGrid, inGrid: state.inGrid,
        troops: state.troops, gateHp: state.gateHp, segLogs: state.segLogs, segOil: state.segOil, segXbow: state.segXbow,
        inv: state.inv, walkers: state.walkers, curfewPolicy: state.curfewPolicy, taxLevel: state.taxLevel, merchants: state.merchants,
        recalled: state.recalled, ledger: state.ledger, captives: state.captives, task: state.task,
        nextTaskDay: state.nextTaskDay, waveFired: state.waveFired, rngState: state.rngState, unpaidDays: state.unpaidDays,
      }));
      pushLog('【存档】总攻前夜——已自动存档（战败可读档重打）');
    } catch (e) { /* 快照失败不阻断游戏 */ }
  }
}
function loadCheckpoint() {
  const cp = state.checkpoint;
  if (!cp) return false;
  const keepLog = state.log.slice(-3); // 保留最近 3 条做上下文
  Object.assign(state, JSON.parse(JSON.stringify(cp)));
  state.log = keepLog;
  state.battle = null; state.battleReport = null; state.enemies = []; state.decisionQueue = []; state.pendingDecision = null;
  state.paused = true; state.gameOver = null; state.pendingCaptives = 0; state.checkpoint = cp; // 档保留（可反复读）
  pushLog('【读档】回到总攻前夜——胡骑将至，这次布好防');
  return true;
}

// ============================ 资源数据层（改造①） ============================
const RES_LABEL = { grain: '粮', wood: '木', soil: '土', iron: '铁', money: '钱', pop: '民', soldiers: '兵', prestige: '声望', political: '政' };
const RES_KEYS = Object.keys(RES_LABEL);
function getRes(k) { return state.res[k]; }
function setRes(k, v) {
  if (k === 'prestige') state.res[k] = Math.max(0, Math.min(100, Math.round(v)));
  else state.res[k] = Math.max(0, Math.round(v));
  if (k === 'soldiers') { // 计数与 troops[] 个体同步；减兵移除熟练度最低者（新兵先跑）
    while (state.troops.length < state.res.soldiers) state.troops.push({ prof: 0, seg: null, type: 'melee' });
    while (state.troops.length > state.res.soldiers) {
      let mi = 0;
      for (let i = 1; i < state.troops.length; i++) if (state.troops[i].prof < state.troops[mi].prof) mi = i;
      state.troops.splice(mi, 1);
    }
  }
  if (k === 'pop') shrinkJobsToPop(); // 人口减少 → 同步收缩超额岗位（防闲民为负，v0.3）
  // 胜负硬条件：声望归零即时判败（03 §3.3，用户拍板即时、不要日结算缓冲）
  if (k === 'prestige' && state.res.prestige <= 0 && !state.gameOver) {
    state.gameOver = { win: false, reason: '声望归零', detail: '民心尽失，关隘不战自溃。' };
    state.paused = true;
    pushLog('【败局】声望归零，民心尽失！');
  }
  return state.res[k];
}
// 人口减少时收缩岗位：assignedTotal 不得超过 pop（城外产线先撤 → 商人 → 城内）
function shrinkJobsToPop() {
  let over = assignedTotal() - getRes('pop');
  if (over <= 0) return;
  const outs = [];
  eachBuilding(function (b, zone, r, c) { if (zone === 'out' && b.workers > 0) outs.push({ b: b, zone: zone, r: r, c: c }); });
  for (const it of outs) {
    if (over <= 0) break;
    const cut = Math.min(it.b.workers, over);
    it.b.workers -= cut; over -= cut;
  }
  if (over > 0 && state.merchants > 0) { // 商人下岗（市坊停摆待补员）
    const cut = Math.min(state.merchants, over);
    state.merchants -= cut; over -= cut;
    let lk = cut;
    eachBuilding(function (b) { if (b.type === 'market' && b.merchant && lk > 0) { b.merchant = false; lk--; } });
  }
}
function addRes(k, delta) {
  // 账本田鸡：非整数与零变动不记（建造等手动操作由调用方 addLedger 专项记账）
  if (delta !== 0 && LEDGER_KEYS.indexOf(k) >= 0) addLedger(k, delta);
  return setRes(k, getRes(k) + delta);
}
// ---- 账本田鸡（v0.3）----
const LEDGER_KEYS = ['grain', 'wood', 'soil', 'iron', 'money'];
function addLedger(res, delta, src) {
  const L = state.ledger.today;
  if (!L[res]) L[res] = {};
  if (!src) { // 无来源标记 → 找当前调用栈里最近一个系统标签（由 LEDGER_SRC 上下文提供）
    src = LEDGER_SRC || '其他';
  }
  L[res][src] = (L[res][src] || 0) + delta;
}
let LEDGER_SRC = null; // 日结各步骤入口设置（produce/transport/consume/pay/tax/task/raid…）
function ledgerRollDay() {
  state.ledger.yday = { flows: state.ledger.today, net: {} };
  LEDGER_KEYS.forEach(function (k) {
    let n = 0;
    const f = state.ledger.today[k];
    if (f) Object.keys(f).forEach(function (s) { n += f[s]; });
    state.ledger.yday.net[k] = n;
  });
  state.ledger.today = {};
}
// ---- 住房（v0.4 模型）----
function houseCap() { return countBuilding('house') * CONFIG.houseCap; }
// ---- 双仓（v0.3）----
function warehouseOf(resKey) { // 粮→粮仓；木/土/铁→货仓；返回 {zone,r,c} 或 null
  const type = resKey === 'grain' ? 'granary' : 'depot';
  let found = null;
  eachBuilding(function (b, zone, r, c) { if (!found && b.type === type) found = { zone: zone, r: r, c: c }; });
  return found;
}
function resSummary() {
  return RES_KEYS.map(function (k) { return RES_LABEL[k] + getRes(k); }).join(' ');
}
