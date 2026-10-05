// slice/trace.js · 经济轨迹录制（08 §6 第 2 步「经济回归等价」的判据工具）
// 作用：用与 playtest.js 完全相同的拟人策略跑满 45 日，逐日输出
//       ①主指标行（资源/人口/兵力/声望/岗位）②建筑明细（在岗 + 产地存量水位）。
// 用法：node slice/trace.js > slice/trace-baseline.txt（改造前基线）
//       node slice/trace.js > slice/trace-after.txt（改造后）
//       diff 两者 —— 主指标与存量水位一致 = 经营层零行为改动的最硬证据。
// ⚠️ 策略与 playtest.js 同步维护：改 playtest 的策略必须同步此处，否则 diff 无意义。
// 调参入口：只改 CONFIG，本文件只读。
const { loadSliceModules } = require('./load-modules');
const code = loadSliceModules();
const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : (p === 'measureText' ? (s) => ({ width: 7 }) : () => {})) });
globalThis.document = { getElementById: () => ({ getContext: () => ctxProxy, width: 1280, height: 720, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }) };
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const run = `
const SW = Number((typeof process !== 'undefined' && process.argv && process.argv[2]) || 0); // 扫参用：node slice/trace.js 24
if (SW) CONFIG.walkSpeed = SW;
AUTO = { curfew: true, emperor: true, gate: false, oil: true, sortie: false, block: true };
state.curfewPolicy = 'closed';
function B(k, zone, r, c) { tryBuild(k, zone, r, c); return gridOf(zone)[r][c]; }
function R1(v) { return Math.round(v * 10) / 10; }
const LINES = [];
function snap() {
  let s = 'D' + state.day
    + ' 民' + getRes('pop') + '/' + houseCap()
    + ' 兵' + getRes('soldiers')
    + ' 岗' + assignedTotal() + ' 闲' + idlePop()
    + ' 粮' + R1(getRes('grain')) + ' 木' + R1(getRes('wood')) + ' 土' + R1(getRes('soil'))
    + ' 铁' + R1(getRes('iron')) + ' 钱' + R1(getRes('money'))
    + ' 望' + R1(getRes('prestige')) + ' 政' + getRes('political')
    + ' 走' + state.walkers.length;
  LINES.push(s);
  const bs = [];
  eachBuilding(function (b, zone, r, c) {
    let st = 0;
    if (b.stock) for (const k of Object.keys(b.stock)) st += b.stock[k];
    bs.push(zone[0] + r + ',' + c + ' ' + b.type + ' w' + (b.workers || 0) + ' s' + R1(st));
  });
  bs.sort();
  LINES.push('  [' + bs.join(' | ') + ']');
}
const f1 = B('farm', 'out', 0, 0), f2 = B('farm', 'out', 0, 1), lu = B('lumber', 'out', 1, 0);
f1.workers = 5; f2.workers = 5; lu.workers = 3;
for (let d = state.day; d <= 45 && !state.gameOver; d++) {
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
    if (trained < want.length && br.queue.length < CONFIG.buildings.barracks.capacity && idlePop() > 1) {
      sendTrainee(br, want[trained]);
    }
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
    if (state.gateHp[s] < CONFIG.gateMaxHp) repairGate(s);
  });
  AUTO.emperor = getRes('money') >= 25 + 30 && getRes('grain') >= 30 + Math.ceil(state.grainNeed * 2);
  B('farm', 'out', 0, 0); B('farm', 'out', 0, 1); B('lumber', 'out', 1, 0);
  if (state.day >= 14) B('farm', 'out', 1, 1);
  if (state.day >= 22) B('farm', 'out', 2, 1);
  const nw = nextWave();
  if (nw && !nw.wave.siege && nw.wave.day - state.day === 1 && !state.recalled) toggleRecall();
  if (state.recalled && (!nw || nw.wave.day - state.day > 1)) toggleRecall();
  advanceClock(31);
  snap();
  if (state.battleReport) { state.battleReport = null; if (state.pendingCaptives > 0) imprisonCaptives(); state.paused = false; }
  if (state.paused) state.paused = false;
  render();
}
LINES.push('END ' + JSON.stringify(state.gameOver) + ' 日' + state.day);
console.log(LINES.join('\\n'));
`;
eval(code + run);
