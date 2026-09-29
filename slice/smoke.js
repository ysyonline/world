// 无头冒烟回归：Node 直接跑 `node slice/smoke.js`，不需要浏览器
// 用途：每加一个新模块就在这里追加断言，防止改新功能打挂旧功能
// 原理：把 index.html 里的 <script> 抽出来，塞进 DOM 桩后 eval，再跑断言
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'index.html');
const code = fs.readFileSync(htmlPath, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

// DOM 桩：canvas 的 2D context 用 Proxy 吞掉所有绘制调用
const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : () => {}) });
const fakeCanvas = {
  getContext: () => ctxProxy,
  width: 1280,
  height: 720,
  addEventListener: () => {},
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
};
globalThis.document = { getElementById: () => fakeCanvas };
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const test = `
// ---- 模块1：时钟 ----
advanceClock(31);
console.assert(state.day === 2, 'M1 30s/日');
togglePause(); advanceClock(31);
console.assert(state.day === 2, 'M1 暂停不推进');
togglePause(); state.speedIdx = 2; advanceClock(7.5);
console.assert(state.day === 3, 'M1 4倍速');
state.speedIdx = 0;

// ---- 模块2：资源数据层 ----
setRes('grain', 100); setRes('prestige', 50); setRes('money', 120); setRes('wood', 60);
addRes('grain', -200); console.assert(getRes('grain') === 0, 'M2 钳 0');
addRes('prestige', 200); console.assert(getRes('prestige') === 100, 'M2 声望钳 100');
setRes('prestige', 50); setRes('grain', 100);
let settled = 0; dailySettlers.push(() => { settled++; });
advanceClock(31);
console.assert(settled === 1 && state.log[state.log.length - 1].indexOf('日结') >= 0, 'M2 日结管线');

// ---- 模块3：网格与建造 ----
console.assert(tryBuild('farm', 0, 0) === true && getRes('money') === 100 && getRes('wood') === 50, 'M3 建造扣费');
console.assert(state.buildMode === null && state.selected.c === 0, 'M3 建成自动选中');
console.assert(tryBuild('lumber', 0, 0) === false, 'M3 占地拒绝');
console.assert(tryBuild('mine', 1, 1) === false, 'M3 矿洞离矿点');
console.assert(tryBuild('mine', 0, 8) === true, 'M3 矿洞在矿点');
console.assert(tryBuild('farm', 2, 1) === false, 'M3 矿点只收矿洞');
console.assert(demolish(0, 0) === true && getRes('money') === 70 && getRes('wood') === 25, 'M3 拆除返还一半');

// ---- 模块4：岗位与效率 ----
setRes('money', 200); setRes('wood', 100); // 补足前面测试消耗，确保能建两块
tryBuild('farm', 0, 0); tryBuild('lumber', 0, 1);
const f = state.grid[0][0], l = state.grid[0][1];
console.assert(effOf(f) === 0, 'M4 空缺 0%');
render();
const plusBtn = buttons.filter(b => b.label === '+ 上岗')[0];
console.assert(!!plusBtn, 'M4 面板按钮已注册');
for (let i = 0; i < 5; i++) assignWorker(f, 1);
console.assert(Math.abs(effOf(f) - 1) < 1e-9, 'M4 满岗 100%');
console.assert(assignWorker(f, 1) === false && f.workers === 5, 'M4 硬上限：满岗拒塞');
console.assert(effOf(f) === 1, 'M4 满岗产出不回落');
for (let i = 0; i < 4; i++) assignWorker(l, 1);
console.assert(idlePop() === 20 - 5 - 4, 'M4 闲民账目');
console.assert(assignWorker(l, 1) === false, 'M4 闲尽/岗满拒塞');
setRes('grain', 100); setRes('wood', 0);
advanceClock(31); // 产 12、耗 20：粮 100+12-20=92，无人挨饿
console.assert(getRes('grain') === 92 && getRes('wood') === 8, 'M4 满岗产出+耗粮 粮92 木8');
render();

// ---- 模块5：耗粮 + 饥荒动态阈值 ----
f.workers = 0; l.workers = 0; // 停产，纯耗粮推演：民20 × 1粮/日，饥荒线 60
setRes('pop', 20); setRes('grain', 100); setRes('prestige', 50); setRes('soldiers', 0);
advanceClock(31 * 6); // 推进 6 天 → 第 11 日
console.assert(getRes('grain') === 0, 'M5 粮尽，got ' + getRes('grain'));
console.assert(getRes('pop') === 18, 'M5 断粮饿死 2 人，got ' + getRes('pop'));
console.assert(getRes('prestige') === 42, 'M5 饥荒 4 天声望 -8，got ' + getRes('prestige'));
console.assert(state.famine === true, 'M5 饥荒态');
console.assert(state.log.some(x => x.indexOf('【饥荒】') >= 0), 'M5 饥荒日志');
console.assert(state.log.some(x => x.indexOf('【断粮】') >= 0), 'M5 断粮日志');
// 满产农田解饥荒：+12/日 vs 耗 18/日，粮存回升过线
f.workers = 5;
setRes('grain', 100);
advanceClock(31);
console.assert(getRes('grain') === 94, 'M5 产12耗18，got ' + getRes('grain'));
console.assert(state.famine === false, 'M5 脱离饥荒');
console.assert(getRes('prestige') === 42, 'M5 脱饥荒后不再流失');
render();

// ---- 模块6：铁匠铺武器产出（耗木4矿4 → 武器2，满岗） ----
setRes('money', 300); setRes('wood', 100); setRes('ore', 0); setRes('weapons', 0);
console.assert(tryBuild('smith', 1, 2) === true, 'M6 建铁匠铺');
const m = state.grid[0][8], s = state.grid[1][2]; // 矿洞 + 铁匠铺
for (let i = 0; i < 4; i++) assignWorker(m, 1);
for (let i = 0; i < 3; i++) assignWorker(s, 1);
console.assert(Math.abs(effOf(s) - 1) < 1e-9, 'M6 铁匠铺满岗');
setRes('grain', 500); // 备足口粮，隔离饥荒干扰
const wood0 = getRes('wood'), ore0 = getRes('ore');
advanceClock(31); // 第1天：矿还 没 库存 → 铁匠铺限产 0，矿洞 +6 入库
console.assert(getRes('weapons') === 0 && getRes('ore') === ore0 + 6, 'M6 首日矿未入库，铁匠铺限产');
advanceClock(31); // 第2天：用首日矿库存开炉 → 武器 +2
console.assert(getRes('weapons') === 2, 'M6 日产武器 2，got ' + getRes('weapons'));
console.assert(getRes('wood') === wood0 - 4, 'M6 两日耗木 4（首日限产未耗）');
console.assert(getRes('ore') === ore0 + 6 + 6 - 4, 'M6 矿 库存推演');
// 原料不足限产：矿清零 → 铁匠铺停工，武器不再增加
setRes('ore', 0);
advanceClock(31);
console.assert(getRes('weapons') === 2, 'M6 缺矿限产，武器不增，got ' + getRes('weapons'));
console.assert(getRes('ore') === 6, 'M6 矿洞照常产矿');
render();

// ---- 模块7+重构：军营 + 训练 + 个体熟练度 ----
setRes('money', 300); setRes('wood', 200); setRes('grain', 500); setRes('pop', 20); setRes('soldiers', 0);
console.assert(tryBuild('barracks', 2, 4) === true, 'M7 建军营');
const bar = state.grid[2][4];
const idleA = idlePop();
console.assert(sendTrainee(bar) === true && idlePop() === idleA - 1 && bar.queue[0] === CONFIG.trainingDays, 'M7 送训占闲民、进队列');
sendTrainee(bar);
console.assert(bar.queue.length === 2, 'M7 再送训 1 人');
console.assert(sendTrainee(bar) === true && removeTrainee(bar) === true && bar.queue.length === 2, 'M7 退训回池');
const s0 = getRes('soldiers'), p0 = getRes('pop');
advanceClock(31 * CONFIG.trainingDays); // 5 天期满
console.assert(getRes('soldiers') === s0 + 2 && getRes('pop') === p0 - 2, 'M7 期满成兵 民-2 兵+2');
console.assert(bar.queue.length === 0, 'M7 队列清空');
console.assert(state.troops.length === 2 && state.troops.every(t => t.prof === CONFIG.trainProfPerDay * CONFIG.trainingDays), 'R 满训出营熟练度 80%，got ' + JSON.stringify(state.troops.map(t => t.prof)));
// 提前征召：训 1 日后征召 → 熟练度 16%（士气已退役，无打击项）
sendTrainee(bar);
advanceClock(31); // 训 1 日
console.assert(rushConscript(bar) === true, 'R 提前征召');
console.assert(state.troops[state.troops.length - 1].prof === CONFIG.trainProfPerDay * 1, 'R 训1日征召熟练度 16%，got ' + state.troops[state.troops.length - 1].prof);
console.assert(state.morale === 100, 'R 士气退役：征召后士气字段恒 100');
// 减兵移除最低熟练度（新兵先跑语义）
const profsBefore = state.troops.map(t => t.prof);
setRes('soldiers', getRes('soldiers') - 1);
console.assert(state.troops.length === profsBefore.length - 1 && !state.troops.some(t => t.prof === Math.min.apply(null, profsBefore)) || profsBefore.every(t => t === profsBefore[0]), 'R 减兵移除最低熟练度者');
// 兵吃粮 ×2：全员停产
eachBuilding(function (b) { b.workers = 0; b.queue = []; });
const p1 = getRes('pop'), s1 = getRes('soldiers');
setRes('grain', 1000);
advanceClock(31);
console.assert(getRes('grain') === 1000 - (p1 + s1 * 2), 'M7 兵耗粮×2 生效，got ' + getRes('grain'));
// ---- 反馈修复（2026-09-29）：军营三按钮 / 收支看板 / 建造面板不溢出 ----
state.selected = { r: 2, c: 4 }; // 选中军营
console.assert(sendTrainee(bar) === true, 'FIX 队列空送训');
render();
const lbl = buttons.map(b => b.label);
console.assert(lbl.indexOf('+ 送训') >= 0 && lbl.indexOf('提前征召') >= 0 && lbl.indexOf('− 退训') >= 0, 'FIX 军营三按钮并存');
console.assert(sendTrainee(bar) === true, 'FIX 队列非空仍可继续送训（旧版按钮会变成提前征召）');
state.grid[0][0].workers = 5; // 满岗农田，验证看板数据源
const d = dailyFlows();
console.assert(Math.round(d.flows.grain.i) === 12, 'FIX 看板：满岗农田粮收入 12，got ' + d.flows.grain.i);
console.assert(Math.round(d.flows.grain.o) === state.grainNeed, 'FIX 看板：粮支出 = 全员口粮 ' + state.grainNeed);
const bldLbls = Object.keys(CONFIG.buildings).map(k => CONFIG.buildings[k].label);
const palBtns = buttons.filter(b => bldLbls.indexOf(b.label) >= 0);
console.assert(palBtns.length === 5, 'FIX 建造面板 5 按钮齐全，got ' + palBtns.length);
console.assert(palBtns.every(b => b.y + b.h <= 600), 'FIX 建造面板不溢出日志区');

// ---- 模块8+重构：军饷 + 欠缴天数梯度 ----
// 正常发饷：钱够 → 扣饷、无欠饷
setRes('money', 100);
const money0 = getRes('money');
advanceClock(31);
console.assert(state.unpaidDays === 0, 'M8 钱足发饷，无欠饷');
console.assert(getRes('money') === money0 - s1 * CONFIG.soldierPayPerDay, 'M8 日扣军饷，got ' + (money0 - getRes('money')));
// 欠饷第 1 日：逃兵率 10%；士气退役不再扣
setRes('money', 0);
const sol0 = getRes('soldiers');
advanceClock(31);
const expectFlee1 = Math.min(sol0, Math.ceil(sol0 * CONFIG.desertBase));
console.assert(state.unpaidDays === 1, 'M8 欠饷日数 1，got ' + state.unpaidDays);
console.assert(getRes('soldiers') === sol0 - expectFlee1, 'M8 逃兵 ceil(' + sol0 + '×0.10)=' + expectFlee1 + '，got ' + (sol0 - getRes('soldiers')));
console.assert(state.morale === 100, 'R 士气退役：欠饷不扣士气');
// 欠饷第 2 日：逃兵率升级 15%
const sol1 = getRes('soldiers');
advanceClock(31);
const expectFlee2 = Math.min(sol1, Math.ceil(sol1 * (CONFIG.desertBase + CONFIG.desertPerDay * 1)));
console.assert(state.unpaidDays === 2, 'M8 欠饷日数 2');
console.assert(getRes('soldiers') === sol1 - expectFlee2, 'M8 逃兵率升级：ceil(' + sol1 + '×0.15)=' + expectFlee2 + '，got ' + (sol1 - getRes('soldiers')));
// 补钱 → 欠饷清零
setRes('money', 50);
advanceClock(31);
console.assert(state.unpaidDays === 0, 'M8 补钱后欠饷清零');
// 无兵不欠饷：清空受训队列（FIX 段塞的人会到期毕业干扰计数）→ 全撤后 unpaidDays 归零、troops 同步清空
bar.queue = []; bar.workers = 0;
setRes('soldiers', 0); state.unpaidDays = 3;
advanceClock(31);
console.assert(state.unpaidDays === 0, 'M8 无兵不欠饷');
console.assert(state.troops.length === 0, 'R 兵清零 troops 同步清空');

// ---- 军营限建一座（2026-09-29 用户裁定）----
console.assert(tryBuild('barracks', 1, 5) === false, 'RULE 已有军营，第二座被拒');
console.assert(canBuildAt('barracks', 1, 5).reason.indexOf('仅可设一座') >= 0, 'RULE 拒绝原因正确');
console.assert(tryBuild('farm', 1, 5) === true, 'RULE 其他建筑不受军营限建影响');
render();

// ---- 模块9：城墙分段 + 布防 ----
// 准备：清场（全部撤防回池），造 3 兵熟练度 80/60/16 作布防对象
state.troops.forEach(function (t) { t.seg = null; });
setRes('soldiers', 3);
state.troops[0].prof = 80; state.troops[0].seg = null; // 满训
state.troops[1].prof = 60; state.troops[1].seg = null; // 中间档
state.troops[2].prof = 16; state.troops[2].seg = null; // 仓促
console.assert(reserveTroops().length === 3, 'M9 未布防池 3 人，got ' + reserveTroops().length);
// 上墙：取熟练度最高者（80），seg 写入
console.assert(deployTroop(0) === true, 'M9 甲段上墙');
console.assert(troopsInSeg(0).some(i => state.troops[i].prof === 80), 'M9 高熟练先上墙');
// 段战力公式：80% 兵 = 0.6+0.4×0.8 = 0.92
console.assert(Math.abs(segPower(0) - 0.92) < 1e-9, 'M9 段战力 0.92，got ' + segPower(0));
console.assert(deployTroop(0) === true && deployTroop(0) === true, 'M9 再上墙 2 人');
console.assert(troopsInSeg(0).length === 3 && reserveTroops().length === 0, 'M9 池空段满 3 人');
// 撤防：撤该段熟练度最低者（16 回池，80/60 留墙）
console.assert(withdrawTroop(0) === true, 'M9 撤防');
console.assert(!troopsInSeg(0).some(i => state.troops[i].prof === 16) && reserveTroops().some(i => state.troops[i].prof === 16), 'M9 低熟练先撤回池');
console.assert(withdrawTroop(1) === false, 'M9 空段撤防拒绝');
// 檑木：扣木、上限、返还一半（两次放置 20→15→10，撤除 +2 → 12）
setRes('wood', 20);
console.assert(placeLog(0) === true && getRes('wood') === 15 && state.segLogs[0] === 1, 'M9 檑木扣木 5');
console.assert(placeLog(0) === true && placeLog(0) === false && state.segLogs[0] === 2, 'M9 檑木上限 2');
console.assert(removeLog(0) === true && state.segLogs[0] === 1 && getRes('wood') === 12, 'M9 撤除返还一半，got ' + getRes('wood'));
setRes('wood', 0);
console.assert(placeLog(1) === false, 'M9 木不足拒放');
// 墙段命中：墙体区间 y∈[wallY-12, wallY+26]（wallY≈284.5），横切 4 段
console.assert(wallSegAt(100, 290) === 0 && wallSegAt(700, 290) === 2 && wallSegAt(700, 400) === null, 'M9 墙段命中检测');
// 无兵可上墙拒绝
setRes('soldiers', 0);
console.assert(deployTroop(2) === false, 'M9 无兵拒上墙');
// 面板渲染：选中墙段 → 三按钮 + 撤除檑木按钮注册，且不与建筑面板（py=70~246）重叠
state.selectedSeg = 0; state.selected = null;
setRes('soldiers', 2); state.troops[0].seg = 0; // 甲段留人，面板走有兵分支
render();
const segBtns = buttons.filter(b => ['− 撤防', '+ 驻兵', '+ 檑木', '− 撤除檑木'].indexOf(b.label) >= 0);
console.assert(segBtns.length >= 3, 'M9 布防面板按钮注册，got ' + segBtns.length);
console.assert(segBtns.every(b => b.y >= 258 && b.y + b.h <= 600), 'M9 布防面板不溢出、不压建筑面板');
state.selectedSeg = null;
render();

// ---- 模块10：敌波次系统 ----
// 最弱段策略：清空防御、给乙段上 1 兵 → 乙段战力最高，最弱段必须不是乙
state.troops.forEach(function (t) { t.seg = null; });
state.segLogs = [0, 0, 0, 0];
setRes('soldiers', 1); state.troops[0].prof = 80; state.troops[0].seg = 1; // 乙段 0.92
const wk = pickTargetSeg();
console.assert(wk !== 1 && segDefScore(wk) <= segDefScore(0) && segDefScore(wk) <= segDefScore(2) && segDefScore(wk) <= segDefScore(3), 'M10 最弱段避开有防段，got ' + wk);
// 檑木加权：只给丙段放檑木 → 最弱段不选丙（丙被檑木抬离最低）
state.segLogs[2] = 2;
const wk2 = pickTargetSeg();
console.assert(wk2 !== 2, 'M10 檑木抬升防御评分，最弱段不选丙，got ' + wk2);
state.segLogs[2] = 0;
// 波次触发（自备日程：前面模块测试已把时钟推过默认波次日）：
const base = state.day;
CONFIG.waves = [
  { day: base + 1, size: 4,  siege: false, label: '小股骚扰' },
  { day: base + 5, size: 5,  siege: false, label: '大股袭扰' },
  { day: base + 9, size: 12, siege: true,  label: '总攻' },
];
state.waveFired = {}; state.enemies = [];
setRes('grain', 5000); setRes('money', 5000); setRes('soldiers', 0); state.unpaidDays = 0;
advanceClock(31); // base+1 日：第 1 波触发
console.assert(state.enemies.length === 4, 'M10 第1波 4 敌集结，got ' + state.enemies.length);
console.assert(state.enemies.every(e => e.seg === state.enemies[0].seg && !e.siege), 'M10 骚扰波同段、非总攻');
console.assert(state.log.some(x => x.indexOf('【小股骚扰】') >= 0), 'M10 骚扰日志');
advanceClock(31); // base+2 日：不重复触发
console.assert(state.enemies.length === 4, 'M10 每波只触发一次');
console.assert(nextWave().wave.day === base + 5, 'M10 下一波日程正确');
advanceClock(31 * 4); // base+5：第 2 波
console.assert(state.enemies.length === 9, 'M10 第2波后累计 9 敌，got ' + state.enemies.length);
advanceClock(31 * 4); // base+9：总攻
console.assert(state.enemies.length === 21 && state.enemies.filter(e => e.siege).length === 12, 'M10 总攻 12 敌入列');
console.assert(state.log.some(x => x.indexOf('【总攻】') >= 0), 'M10 总攻日志');
console.assert(nextWave() === null, 'M10 全部波次已触发');
render();
console.log('ALL SMOKE PASSED (模块1~8 + 士气重构 + 军营限建 + 模块9 布防 + 模块10 波次)');
`;

eval(code + test);
