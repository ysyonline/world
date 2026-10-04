// 全流程拟人试玩：node slice/playtest.js
// 用固定「合理玩家策略」跑完 40+ 日，验证：①无死档无异常 ②正常经营可守过总攻获胜（04 v0.3 §8-3）
// v0.3 适配：脚夫废除（自运）；开局 30/30 满员 → 流民来投前需造民房；常闭宵禁免弹窗
// ⚠️ 数值观察（2026-10-05）：v0.3 占位数值下「大铺开」策略（D12 工匠坊+烽燧+二市坊）会拖慢兵营导致守不住总攻；
//    本脚本用最小获胜策略（田林矿+市坊+兵营+5 农田，器械靠工匠坊前置木材储备）。
//    正式调参轮应解决：①开局钱 180 对建筑链偏紧 ②常闭宵禁税减半进一步压钱。
// 调参入口：只改 index.html 的 CONFIG，本文件只读
const fs = require('fs');
const path = require('path');
const code = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : (p === 'measureText' ? (s) => ({ width: 7 }) : () => {})) });
globalThis.document = { getElementById: () => ({ getContext: () => ctxProxy, width: 1280, height: 720, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) }) };
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const run = `
AUTO = { curfew: true, emperor: true, gate: false, oil: true, sortie: false, block: true }; // 不出城：保近战堵门（v0.3 占位数值下出城折损耗近战）
state.curfewPolicy = 'closed'; // 合理玩家：常闭免打扰（宿驿站税减半是小代价）
function B(k, zone, r, c) { tryBuild(k, zone, r, c); return gridOf(zone)[r][c]; }
// 开局：2农田+1伐木（自运模型不需要配脚夫）
const f1 = B('farm', 'out', 0, 0), f2 = B('farm', 'out', 0, 1), lu = B('lumber', 'out', 1, 0);
f1.workers = 5; f2.workers = 5; lu.workers = 3;
for (let d = state.day; d <= 45 && !state.gameOver; d++) {
  if (state.day === 4) { const m = B('mine', 'out', 2, 0); if (m) m.workers = 3; }
  // 人口逼近上限先造民房（流民红利要接住）
  if (getRes('pop') >= houseCap() - 1) B('house', 'in', 3, 6);
  if (state.day >= 4) B('market', 'in', 3, 3);
  // 兵营：市坊建成+钱回 90 才建（商业优先：先有商税收入流再养军，防「建营即破产」死区）
  if (!state.inGrid[1][1] && countBuilding('market') > 0 && getRes('money') >= 90) B('barracks', 'in', 1, 1);
  if (state.day === 14) { const f3 = B('farm', 'out', 1, 1); if (f3) f3.workers = 5; }
  if (state.day >= 22) { const f4 = B('farm', 'out', 2, 1); if (f4) f4.workers = 5; }
  // 有兵营就持续送训（队列有空位才送）
  const br = state.inGrid[1][1];
  if (br && br.type === 'barracks' && state.day >= 11) {
    const want = ['melee', 'archer', 'melee', 'archer', 'engineer', 'melee', 'archer', 'engineer', 'melee', 'archer', 'melee', 'melee'];
    const trained = getRes('soldiers') + br.queue.length;
    if (trained < want.length && br.queue.length < CONFIG.buildings.barracks.capacity && idlePop() > 1) {
      sendTrainee(br, want[trained]);
    }
  }
  // 每天开工前补岗：农场优先，其次林/矿（失败即停防死循环：闲民>0 但占房满）
  [['out', 0, 0], ['out', 0, 1], ['out', 1, 1], ['out', 2, 1], ['out', 1, 0], ['out', 2, 0]].forEach(function (pos) {
    const b = state.outGrid[pos[1]][pos[2]];
    if (b && CONFIG.buildings[b.type].capacity > 0) {
      while (b.workers < CONFIG.buildings[b.type].capacity && idlePop() > 0 && assignWorker(b, 1)) {}
    }
  });
  // 布防：弓兵上墙分段（骚扰反击），近战+工兵留预备队——总攻方向不预告，堵门决策点拉预备队塞门洞（02 §4 官方对策）
  state.troops.forEach(function (t) { if (t.type === 'archer' && t.seg === null) t.seg = state.troops.filter(x => x.type === 'archer' && x.seg !== null).length % 4; });
  [0, 1, 2, 3].forEach(function (s) {
    while (state.inv.log > 0 && state.segLogs[s] < 2) deployGear(s, 'log');
    while (state.inv.oil > 0 && state.segOil[s] < 2) deployGear(s, 'oil');
    while (state.inv.crossbow > 0 && state.segXbow[s] < 1) deployGear(s, 'crossbow');
    if (state.gateHp[s] < CONFIG.gateMaxHp) repairGate(s);
  });
  // 圣旨接不接看家底（不接无罚；留军饷+口粮缓冲，防欠饷逃兵螺旋）
  AUTO.emperor = getRes('money') >= 25 + 30 && getRes('grain') >= 30 + Math.ceil(state.grainNeed * 2);
  // 关键地块每日补建（夜赌失火/被毁即重建）
  B('farm', 'out', 0, 0); B('farm', 'out', 0, 1); B('lumber', 'out', 1, 0);
  if (state.day >= 14) B('farm', 'out', 1, 1);
  if (state.day >= 22) B('farm', 'out', 2, 1);
  // 骚扰前 1 日收保，波次过后复工（关门外平民保命）
  const nw = nextWave();
  if (nw && !nw.wave.siege && nw.wave.day - state.day === 1 && !state.recalled) toggleRecall();
  if (state.recalled && (!nw || nw.wave.day - state.day > 1)) toggleRecall();
  advanceClock(31);
  if (state.day % 5 === 0) console.log('D' + state.day + ' 民' + getRes('pop') + ' 兵' + getRes('soldiers') + ' 粮' + getRes('grain') + ' 钱' + getRes('money') + ' 声望' + getRes('prestige') + ' 闲' + idlePop());
  if (state.battleReport) { state.battleReport = null; if (state.pendingCaptives > 0) imprisonCaptives(); state.paused = false; }
  if (state.paused) state.paused = false;
  render();
}
console.log('结局: ' + JSON.stringify(state.gameOver));
console.log('日' + state.day + ' 民' + getRes('pop') + '/上限' + houseCap() + ' 兵' + getRes('soldiers') + ' 声望' + getRes('prestige')
  + ' 钱' + getRes('money') + ' 粮' + getRes('grain') + ' 木' + getRes('wood') + ' 土' + getRes('soil') + ' 铁' + getRes('iron'));
console.log('最近日志:');
state.log.forEach(function (l) { console.log('  ' + l); });
console.assert(state.gameOver && state.gameOver.win === true, 'PLAYTEST 合理策略应能获胜');
if (state.gameOver && state.gameOver.win) console.log('PLAYTEST PASSED（合理策略守过总攻获胜）');
`;
eval(code + run);
