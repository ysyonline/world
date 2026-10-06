// settle-smoke.js · 08 §6 第 4 步「接口结算」对账回归 · Node 直接跑 `node slice/settle-smoke.js`
// 守护的是**失败信号 A（整合失败）**：战前快照 → 实时战斗 → 战后回写，全程数值必须守恒。
// 判据不是"看着对"，是恒等式：
//   ① Δpop == 战报殉国数        ② soldiers == troops.length
//   ③ state.gateHp == 战斗层 GATES.hp（门耐久只有一个真相源）
//   ④ 檑木/火油减少 == 战中投放次数（按段扣）  ⑤ 粮/铁/钱不动，土/木只因修门减少
//   ⑥ 声望 == +10 − 破门×2      ⑦ 同种子两次跑结果逐位一致（接口不漂移）
// 另有两组场景：挂机局（威胁真实 + 败局同样守恒）、总攻日自动接管（不再走回合制续体）。
const { loadSliceModules } = require('./load-modules');
const code = loadSliceModules();

const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : () => {}) });
const fakeCanvas = { getContext: () => ctxProxy, width: 1280, height: 720, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
globalThis.document = { getElementById: () => fakeCanvas };
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const run = `
CONFIG.assaultMode = 'live';   // 本文件守护的就是实时战斗路径（回合制由 smoke/playtest 守护）
CONFIG.waves = [];             // 波次手工触发，防误入
CONFIG.refugeePrestige1 = 999; CONFIG.refugeePrestige2 = 999; state.nextTaskDay = 9999;
const RESK = ['grain', 'wood', 'soil', 'iron', 'money'];
const sum = (a) => a.reduce((x, y) => x + y, 0);
const stepGame = (sec) => { for (let i = 0; i < Math.ceil(sec); i++) advanceClock(Math.min(1, sec - i)); };
let pass = 0, fail = 0;
function ok(c, m) { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.error('  ✗ FAIL: ' + m); } }
function section(n) { console.log('\\n—— ' + n + ' ——'); }

function seedEcon(cfg) { // 构造一个可读的经营态（不走 45 天：接口测试只关心两端数值）
  setRes('pop', cfg.pop); setRes('prestige', 50); setRes('soldiers', 0);
  const want = [];
  for (let i = 0; i < cfg.melee; i++) want.push('melee');
  for (let i = 0; i < cfg.archer; i++) want.push('archer');
  for (let i = 0; i < cfg.eng; i++) want.push('engineer');
  setRes('soldiers', want.length);
  state.troops.forEach(function (t, i) { t.type = want[i]; t.prof = cfg.prof; t.seg = null; });
  setRes('grain', 2000); setRes('wood', 300); setRes('soil', 300); setRes('iron', 60); setRes('money', 400);
  state.inv = { log: 6, oil: 4, crossbow: 2 };
  state.segLogs = [2, 0, 1, 0]; state.segOil = [1, 0, 1, 0]; state.segXbow = [1, 0, 0, 0];
  state.gateHp = [cfg.gate0 === undefined ? 12 : cfg.gate0, 12, 9, 12];
  state.battle = null; state.battleReport = null; state.gameOver = null; state.pendingCaptives = 0;
  state.live.pre = null; state.live.result = null; state.live.active = false; state.live.settled = false;
}
function econSnap() {
  const o = { res: {}, troops: state.troops.length };
  RESK.forEach(function (k) { o.res[k] = getRes(k); });
  o.pop = getRes('pop'); o.soldiers = getRes('soldiers'); o.prestige = getRes('prestige');
  o.gateHp = state.gateHp.slice(); o.inv = Object.assign({}, state.inv);
  o.logs = sum(state.segLogs); o.oil = sum(state.segOil); o.xbow = sum(state.segXbow);
  let n = 0, ps = 0;
  eachBuilding(function (b, z) { if (z === 'in') n++; });
  state.troops.forEach(function (t) { ps += t.prof; });
  o.inB = n; o.profAvg = state.troops.length ? ps / state.troops.length : 0;
  return o;
}
// 拟人操作：移植 battle-smoke B 局策略（布防→转场→器械→修门→堵门），
// 只把 R.trySkill 换成 sim 的 useBattleSkill（扣经营库存）、R.run 换成 advanceClock。
function playBattle(active) {
  const C = CONFIG.map.city;
  const g0 = Battle.GATES.filter(function (g) { return g.side === 'south'; })[0];
  const g1 = Battle.GATES.filter(function (g) { return g.side === 'north'; })[0];
  const wyN = C.y - 10, wyS = C.y + C.h + 10;
  Battle.select([2]); Battle.move(C.x + C.w * 0.5, wyN);        // 弓兵上北墙（后门侧）
  advanceClock(6);
  Battle.select([1]); Battle.move(C.x + C.w * 0.75, wyS);       // 乙步兵上南墙（门侧墙）
  advanceClock(6);
  Battle.select([3]); Battle.move(g0.x, g0.y - 40);             // 工兵贴前门内侧
  advanceClock(5);
  Battle.select([0]); Battle.move(C.x + C.w / 2, C.y + C.h / 2); // 甲步兵居中救火
  advanceClock(5);
  if (!active) { // 挂机局：布防完就摆烂（不操作 = 不修门不堵门不放器械）
    Battle.setPaused(false);
    let g2 = 0;
    while (!Battle.S.gameOver && g2++ < 3600) advanceClock(0.5);
    return g2;
  }
  Battle.select([2]); useBattleSkill('volley', 0, 0);
  advanceClock(26);
  Battle.select([2]); useBattleSkill('volley', 0, 0);
  advanceClock(6);
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
      Battle.select([3]);
      t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g0.x; t3.y = g0.y - 40;
      useBattleSkill('repair', g0.x, g0.y);
    }
    if (!g1.broken && g1.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      Battle.select([3]);
      t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g1.x; t3.y = g1.y + 40;
      useBattleSkill('repair', g1.x, g1.y);
    }
    if (Battle.S.t > 80 && t1.onWall && !g0.broken && g0.hp < 6) { Battle.select([1]); Battle.move(g0.x, g0.y - 40); }
    if (g0.broken && !t0.dead && Math.hypot(t0.x - g0.x, t0.y - g0.y) > 30) { Battle.select([0]); Battle.move(g0.x, g0.y - 40); }
    if (!g0.broken && !g1.broken && !t0.dead && g1.hp < 6 && Math.hypot(t0.x - g1.x, t0.y - g1.y) > 60) { Battle.select([0]); Battle.move(g1.x, g1.y + 40); }
    if (g1.broken && !t1.dead && Math.hypot(t1.x - g1.x, t1.y - g1.y) > 30) {
      Battle.select([1]); t1.onWall = false; t1.wallSide = null; Battle.move(g1.x, g1.y + 40);
    }
  }
  return guard;
}

// ==================== 场景 0：门带伤注入（经营 → 战斗方向） ====================
section('S0 战前快照注入（经营 → 战斗）');
seedEcon({ pop: 40, melee: 14, archer: 13, eng: 6, prof: 70, gate0: 7 }); // 前门带伤
const b0 = econSnap();
state.live.waveSize = 14;
enterBattle(0);
ok(Battle.GATES[0].hp === 7 && !Battle.GATES[0].broken, '前门带伤注入战斗层（7/12——经营的门血带进战场）');
ok(Battle.GATES[1].hp === 9, '后门按便门上限注入（9/9）');
ok(Battle.S.teams.reduce(function (a, t) { return a + t.maxN; }, 0) === b0.troops, '兵员快照直通：战斗总人数 == 经营在编数（' + b0.troops + '）');
ok(Battle.RTS_CONFIG.player.xbows === Math.max(1, b0.xbow), '重弩架数 = 已部署数（布防决策带进战场）');
ok(state.live.pre && state.live.pre.pop === b0.pop, '战前快照已存（对账基准 + 归因素材）');
ok(Battle.S.paused === true, '进战场先暂停（开战前可布防下令）');
Battle.S.gameOver = { win: true, reason: '注入检查', detail: '' };
advanceClock(0.1); // 触发回写
ok(state.gateHp[0] === Math.round(Battle.GATES[0].hp), '门耐久回写与战斗层一致（带伤 7 状态守恒）');

// ==================== 场景 1：操作局（满编应胜 + 全程守恒） ====================
section('S1 操作局：满编布防应胜，且回写守恒');
seedEcon({ pop: 70, melee: 24, archer: 21, eng: 10, prof: 70 }); // 55 兵 = 编队基准（k=1.0）
const before = econSnap();
state.live.waveSize = 14;
enterBattle(0);
const G0 = Battle.GATES.filter(function (g) { return g.side === 'south'; })[0];
const GN = Battle.GATES.filter(function (g) { return g.side === 'north'; })[0];
playBattle(true);
ok(!!Battle.S.gameOver, '战斗分出胜负（' + (Battle.S.gameOver && Battle.S.gameOver.win ? '胜' : '败') + '，t=' + Math.round(Battle.S.t) + 's）');
ok(state.live.active === false, '分出胜负后自动退出战斗模式');
const rep = state.battleReport;
ok(!!(rep && rep.live === true), '战报为实时战斗口径（live=true）');
ok(state.gameOver && state.gameOver.reason !== undefined, '已给出最终胜负（' + (state.gameOver && state.gameOver.reason) + '）');
// —— 守恒恒等式 ——
ok(before.pop - getRes('pop') === rep.dead, '① 人口守恒：Δpop(' + (before.pop - getRes('pop')) + ') == 殉国数(' + rep.dead + ')');
ok(state.res.soldiers === state.troops.length, '② 兵数守恒：soldiers(' + state.res.soldiers + ') == troops.length(' + state.troops.length + ')');
ok(state.gateHp[0] === (G0.broken ? 0 : Math.min(12, Math.round(G0.hp))), '③ 前门耐久回写一致（经营 ' + state.gateHp[0] + ' / 战斗 ' + Math.round(G0.hp) + '）');
ok(state.gateHp[2] === (GN.broken ? 0 : Math.min(9, Math.round(GN.hp))), '③ 后门耐久回写一致（经营 ' + state.gateHp[2] + ' / 战斗 ' + Math.round(GN.hp) + '）');
ok(before.logs - sum(state.segLogs) === rep.skillUse.log, '④ 檑木按段扣：减少 ' + (before.logs - sum(state.segLogs)) + ' == 投放 ' + rep.skillUse.log + ' 次');
ok(before.oil - sum(state.segOil) === rep.skillUse.oil, '④ 火油按段扣：减少 ' + (before.oil - sum(state.segOil)) + ' == 投放 ' + rep.skillUse.oil + ' 次');
ok(before.res.grain === getRes('grain'), '⑤ 战斗期经营冻结：粮不动');
ok(before.res.iron === getRes('iron'), '⑤ 铁不动');
ok(before.res.money === getRes('money') + 0, '⑤ 钱不动（战利品默认 0，挂 EA）');
ok(before.res.soil - getRes('soil') === rep.skillUse.repair * CONFIG.gateRepairSoil, '⑤ 土只因抢修减少（' + rep.skillUse.repair + '×' + CONFIG.gateRepairSoil + '）');
ok(before.res.wood - getRes('wood') === rep.skillUse.repair * CONFIG.gateRepairWood, '⑤ 木只因抢修减少（' + rep.skillUse.repair + '×' + CONFIG.gateRepairWood + '）');
const brokenN = rep.gates.filter(function (g) { return g.broken; }).length;
if (rep.win) {
  const expect = Math.min(100, Math.max(0, before.prestige + CONFIG.assaultWinPrestige - brokenN * CONFIG.assaultGateBrokenPrestige));
  ok(getRes('prestige') === expect, '⑥ 声望口径：' + before.prestige + ' +' + CONFIG.assaultWinPrestige + ' − 破门' + brokenN + '×' + CONFIG.assaultGateBrokenPrestige + ' = ' + getRes('prestige'));
} else {
  ok(getRes('prestige') === before.prestige, '⑥ 败局不结算声望（城陷即终局）');
}
ok(state.troops.length === 0 || state.troops.every(function (t) { return t.prof > before.profAvg; }), '⑦ 存活者熟练度高于战前均值（搏杀补 +' + rep.profGain + '%）');
// —— 归因链（支柱 3 / 信号 C 的呈现载体）——
ok(rep.attrib.length >= 4, '⑧ 归因链 ≥4 条（实得 ' + rep.attrib.length + '）');
ok(rep.attrib.some(function (a) { return a.text.indexOf('【门】') === 0; }), '⑧ 归因含【门】→ 挂到土木/修门决策');
ok(rep.attrib.some(function (a) { return a.text.indexOf('【兵】') === 0; }), '⑧ 归因含【兵】→ 挂到训练/布防决策');
ok(rep.attrib.some(function (a) { return a.text.indexOf('【械】') === 0; }), '⑧ 归因含【械】→ 挂到工匠坊产能决策');
ok(rep.attrib[rep.attrib.length - 1].tone === 'note', '⑧ 归因链以总评句收尾');

// —— C 信号机器可判部分：归因链【覆盖性】——
// 支柱3/信号 C 的判定标准不是「链里有几条」，而是「**实际发生的每一类损失都被归到了一条**」。
// 只列 happened=true 的类目 = 漏归因 = 玩家输了但看不到哪一环 → C 信号成立。
// 反之链上有类目但对应损失没发生，那是噪声（虚报），同样要抓。
section('C 信号：归因链覆盖性（漏归因 / 虚报双向检测）');
function hasTag(rep2, tag) { return rep2.attrib.some(function (a) { return a.text.indexOf(tag) === 0; }); }
const lostProf = rep.profGain > 0;
const lostBuilding = rep.demolished > 0;
ok(lostProf === hasTag(rep, '【练】'), '⑩ 熟练度变化' + (lostProf ? '发生' : '未发生') + ' → 【练】条目' + (hasTag(rep, '【练】') ? '在' : '不在') + '（无虚报/无漏报）');
ok(lostBuilding === hasTag(rep, '【毁】'), '⑩ 设施损毁' + (lostBuilding ? '发生' : '未发生') + ' → 【毁】条目' + (hasTag(rep, '【毁】') ? '在' : '不在') + '（无虚报/无漏报）');
const anyGateLoss = rep.gates.some(function (gl) { return gl.after !== gl.before; });
ok(hasTag(rep, '【门】'), '⑩ 门条目恒在（无论损毁与否都要给玩家「门这条线没问题」的确认）');
// 每条归因都必须指向一个可操作的量——纯陈述句（无数字/无物料名）不构成归因
rep.attrib.forEach(function (a, i) {
  const actionable = /[0-9]|土木|檑木|火油|工匠坊|熟练度|布防|训练/.test(a.text);
  ok(actionable, '⑩ 归因[' + i + '] 指向可操作量：' + a.text.slice(0, 28) + '…');
});
// 总评句必须给出「下次怎么做」而非只描述现象
const verdict = rep.attrib[rep.attrib.length - 1].text;
ok(/下次|把|留|压到|拉长|备足/.test(verdict), '⑩ 总评句含行动建议（下次…）');
ok(rep.win === true, '满编 + 合理操作应能守住（兵不够/不操作就是输——支柱 3 的因果链方向正确）');

ok(enterBattle(0) === false && state.live.active === false, '⑨ 结算后禁止再进战场（防反复重开刷结果）');
const digest = { kills: rep.kills, dead: rep.dead, prest: getRes('prestige'), g0: state.gateHp[0], g2: state.gateHp[2],
  use: rep.skillUse.log + '/' + rep.skillUse.oil + '/' + rep.skillUse.repair, pop: getRes('pop') };

// ==================== 场景 2：挂机局（威胁真实 + 败局同样守恒） ====================
section('S2 挂机局：不操作必败，且败局回写守恒');
seedEcon({ pop: 40, melee: 14, archer: 13, eng: 6, prof: 70 });
const b2 = econSnap();
state.live.waveSize = 14;
enterBattle(0);
playBattle(false);
const rep2 = state.battleReport;
ok(!!(rep2 && rep2.win === false), '挂机局必败（威胁真实：不操作守不住——' + (Battle.S.gameOver && Battle.S.gameOver.reason) + '）');
ok(!!(state.gameOver && state.gameOver.win === false), '败局写入 state.gameOver（' + (state.gameOver && state.gameOver.reason) + '）');
ok(b2.pop - getRes('pop') === rep2.dead, '败局仍守恒：Δpop == 殉国数(' + rep2.dead + ')');
ok(state.res.soldiers === state.troops.length, '败局仍守恒：soldiers == troops.length');
ok(getRes('prestige') === b2.prestige, '败局不加声望');
ok(b2.res.soil === getRes('soil') && b2.res.wood === getRes('wood'), '败局无抢修（无操作即无消耗）');

// ==================== 场景 3：总攻日自动接管（不再走回合制续体） ====================
section('S3 总攻日由实时战斗接管');
seedEcon({ pop: 40, melee: 14, archer: 13, eng: 6, prof: 70 });
state.paused = false; state.day = 39;
CONFIG.waves = [{ day: 40, size: 14, siege: true, label: '总攻' }];
state.waveFired = {};
stepGame(31);
ok(state.live.active === true, '总攻日自动进入实时战场（相机推近由主循环触发）');
ok(state.battle === null, '不再创建回合制战斗续体（beginAssault 未被调用）');
ok(state.live.waveSize === 14, '总攻规模传入战斗层（俘虏口径分母）');
Battle.S.gameOver = { win: true, reason: '测试强制结束', detail: '' };
advanceClock(0.1);
ok(state.live.active === false && state.battleReport && state.battleReport.live, '战斗结束即自动回写（无需手动 Esc）');

console.log('\\n================ 结果 ================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
return { pass: pass, fail: fail, digest: digest };
`;

const out = new Function(code + run)();
const out2 = new Function(code + run)(); // 同种子跑第二遍：接口数值不得漂移
const same = JSON.stringify(out.digest) === JSON.stringify(out2.digest);
console.log('\n—— 确定性：同种子两次跑（接口不漂移） ——');
if (same) console.log('  ✓ 两次结果逐位一致 ' + JSON.stringify(out.digest));
else console.error('  ✗ FAIL: 两次结果不一致\n    ' + JSON.stringify(out.digest) + '\n    ' + JSON.stringify(out2.digest));
const fail = out.fail + (same ? 0 : 1);
console.log('\n================ 总计 ================');
console.log('PASS ' + out.pass + ' / FAIL ' + fail);
if (fail > 0) process.exitCode = 1;
