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
// 注意：M6 推进时钟跨过第 15 日，波次战斗会自动 paused=true，后续 advanceClock 前必须复位
state.paused = false;
setRes('money', 300); setRes('wood', 200); setRes('grain', 500); setRes('pop', 20); setRes('soldiers', 0); setRes('weapons', 10);
console.assert(tryBuild('barracks', 2, 4) === true, 'M7 建军营');
const bar = state.grid[2][4];
const idleA = idlePop();
console.assert(sendTrainee(bar, 'melee') === true && idlePop() === idleA - 1 && bar.queue[0].left === CONFIG.trainingDays && bar.queue[0].type === 'melee', 'M7 送训占闲民、进队列、选营');
console.assert(getRes('weapons') === 9, 'M7 送训耗武器 1');
sendTrainee(bar, 'archer');
console.assert(bar.queue.length === 2, 'M7 再送训 1 人');
console.assert(sendTrainee(bar, 'melee') === true && removeTrainee(bar) === true && bar.queue.length === 2, 'M7 退训回池');
const s0 = getRes('soldiers'), p0 = getRes('pop');
advanceClock(31 * CONFIG.trainingDays); // 5 天期满
console.assert(getRes('soldiers') === s0 + 2 && getRes('pop') === p0 - 2, 'M7 期满成兵 民-2 兵+2');
console.assert(bar.queue.length === 0, 'M7 队列清空');
console.assert(state.troops.length === 2 && state.troops.every(t => t.prof === CONFIG.trainProfPerDay * CONFIG.trainingDays), 'R 满训出营熟练度 80%，got ' + JSON.stringify(state.troops.map(t => t.prof)));
console.assert(state.troops[0].type === 'melee' && state.troops[1].type === 'archer', 'M11 三营制：出营即定兵种');
// 提前征召：训 1 日后征召 → 熟练度 16%（士气已退役，无打击项）
sendTrainee(bar, 'crew');
advanceClock(31); // 训 1 日
console.assert(rushConscript(bar) === true, 'R 提前征召');
console.assert(state.troops[state.troops.length - 1].prof === CONFIG.trainProfPerDay * 1, 'R 训1日征召熟练度 16%，got ' + state.troops[state.troops.length - 1].prof);
console.assert(state.troops[state.troops.length - 1].type === 'crew', 'M11 征召兵带营种=普通营');
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
console.assert(sendTrainee(bar, 'melee') === true, 'FIX 队列空送训');
render();
const lbl = buttons.map(b => b.label);
console.assert(lbl.indexOf('+弓') >= 0 && lbl.indexOf('+近') >= 0 && lbl.indexOf('+普') >= 0 && lbl.indexOf('− 退训') >= 0, 'M11 军营三营按钮并存');
console.assert(lbl.some(x => x.indexOf('提前征召') >= 0), 'FIX 提前征召按钮');
console.assert(sendTrainee(bar, 'archer') === true, 'FIX 队列非空仍可继续送训');
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
// 补钱 → 欠饷清零（此日跨第 26 日波次，战斗后时钟被暂停，后续推进前先复位）
setRes('money', 50);
advanceClock(31);
console.assert(state.unpaidDays === 0, 'M8 补钱后欠饷清零');
state.paused = false;
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
// 职责划分：M10 只断言「日程触发/去重/推进」，战斗结算细节由 M11 场景负责——不造兵，无人防守必破门
const base = state.day;
CONFIG.waves = [
  { day: base + 1, size: 4,  siege: false, label: '小股骚扰' },
  { day: base + 5, size: 5,  siege: false, label: '大股袭扰' },
  { day: base + 9, size: 12, siege: true,  label: '总攻' },
];
state.waveFired = {}; state.enemies = [];
state.gateHp = [CONFIG.gateMaxHp, CONFIG.gateMaxHp, CONFIG.gateMaxHp, CONFIG.gateMaxHp]; // 复位：前面默认波次已耗损城门
state.cityFallen = false; state.battleReport = null;
setRes('grain', 5000); setRes('money', 5000); setRes('soldiers', 0); state.unpaidDays = 0;
advanceClock(31); state.paused = false; // base+1 日：第 1 波触发并当日结算（空防被破门）
console.assert(state.waveFired[0] === true && state.battleReport && state.battleReport.enemySize === 4, 'M10 第1波触发并结算');
console.assert(state.log.some(x => x.indexOf('【小股骚扰】') >= 0), 'M10 骚扰日志');
const rep1 = state.battleReport;
advanceClock(31); state.paused = false; // base+2 日：不重复触发
console.assert(state.battleReport === rep1, 'M10 每波只触发一次（无新战报）');
console.assert(nextWave().wave.day === base + 5, 'M10 下一波日程正确');
advanceClock(31 * 3); state.paused = false; // base+5：第 2 波（拆步推进，防日志环形缓冲挤出波次日志）
console.assert(state.waveFired[1] === true && state.battleReport.enemySize === 5, 'M10 第2波触发');
console.assert(state.log.some(x => x.indexOf('【大股袭扰】') >= 0), 'M10 第2波日志');
advanceClock(31 * 3); state.paused = false; // base+8
advanceClock(31); state.paused = false; // base+9：总攻（空防必破）
console.assert(state.waveFired[2] === true && state.battleReport.siege === true, 'M10 总攻触发');
console.assert(state.log.some(x => x.indexOf('【总攻】') >= 0), 'M10 总攻日志');
console.assert(state.cityFallen === true, 'M10 空防总攻=城破');
console.assert(nextWave() === null, 'M10 全部波次已触发');
render();

// ---- 模块11：守城战结算（RTS 塔防式） ----
state.paused = false;
// 场景A：弓兵营+檑木（有普通营操作员，无近战）全歼 4 敌小股骚扰，零伤亡
state.troops.forEach(function (t) { t.seg = null; });
state.enemies = []; state.cityFallen = false; state.captives = 0; state.pendingCaptives = 0; state.battleReport = null;
state.gateHp = [CONFIG.gateMaxHp, CONFIG.gateMaxHp, CONFIG.gateMaxHp, CONFIG.gateMaxHp];
setRes('soldiers', 0); setRes('grain', 500); setRes('money', 500); setRes('pop', 20);
// 造兵：2 弓（80%）、1 普通营（80%）守甲段
setRes('soldiers', 3);
state.troops[0] = { prof: 80, seg: 0, type: 'archer' };
state.troops[1] = { prof: 80, seg: 0, type: 'archer' };
state.troops[2] = { prof: 80, seg: 0, type: 'crew' };
state.segLogs[0] = 2; // 2 座檑木，普通营兵驻守 → 生效
const repA = resolveBattle(0, { siege: false, size: 4, day: state.day });
// 血池承伤：每轮 2×0.92×1.5+2×1=4.76 伤 → 12 血池 3 轮清空
console.assert(repA.kills === 4 && !repA.breached, 'M11-A 全歼 4 敌，got kills=' + repA.kills);
console.assert(repA.captives === Math.ceil(4 * CONFIG.captiveRate), 'M11-A 俘虏 2 人');
console.assert(repA.meleeDead === 0, 'M11-A 无近战参战，零伤亡');
console.assert(state.pendingCaptives === 2, 'M11-A 俘虏入待处置（模块12 接管），got ' + state.pendingCaptives);
// 无近战堵门：残敌每轮砸门——第1轮 3 敌×2=6、第2轮 1 敌×2=2，共 8 伤（塔防竞速正确行为）
console.assert(state.gateHp[0] === CONFIG.gateMaxHp - 8 && repA.gateDmg === 8, 'M11-A 无近战堵门门损 8，got ' + state.gateHp[0]);
// 场景B：空防段（无兵无檑木）被 4 敌破门 → 抢粮杀民降声望
state.gateHp[1] = 4; // 乙段门只剩 4 血
const grainB = getRes('grain'), popB = getRes('pop'), presB = getRes('prestige');
const repB = resolveBattle(1, { siege: false, size: 4, day: state.day });
// 4 敌 × 2 伤/轮 = 8 伤 > 4 血 → 第 1 轮破门；残敌 4 人抢掠
console.assert(repB.breached && repB.gateDmg >= 4, 'M11-B 空防段被破门');
console.assert(repB.lootGrain === 4 * CONFIG.lootGrainPerEnemy && getRes('grain') === grainB - 20, 'M11-B 抢粮 20');
console.assert(repB.lootPop === 4 * CONFIG.lootPopPerEnemy && getRes('pop') === popB - 4, 'M11-B 杀民 4');
console.assert(repB.lootPrestige === CONFIG.lootPrestigeLoss && getRes('prestige') === presB - 3, 'M11-B 声望 -3');
// 场景C：总攻破门 → 城破标记
state.gateHp[2] = 2;
const repC = resolveBattle(2, { siege: true, size: 12, day: state.day });
console.assert(repC.breached && state.cityFallen === true, 'M11-C 总攻破门=城破标记');
// 场景D：开战检溃——段均熟练 < 25% → 低熟练兵临阵脱逃
state.cityFallen = false;
setRes('soldiers', 3);
state.troops[0] = { prof: 16, seg: 3, type: 'melee' };
state.troops[1] = { prof: 16, seg: 3, type: 'archer' };
state.troops[2] = { prof: 16, seg: 3, type: 'crew' };
const desB = state.deserters;
const repD = resolveBattle(3, { siege: false, size: 4, day: state.day });
console.assert(repD.fled === 3 && state.deserters === desB + 3, 'M11-D 全员低熟练临阵脱逃，got fled=' + repD.fled);
console.assert(getRes('soldiers') === 0, 'M11-D 逃兵永久减兵');
// 场景E：近战堵门互搏——敌杀近战最低熟练先死，永久减人口
setRes('soldiers', 2); setRes('pop', 20);
state.troops[0] = { prof: 80, seg: 0, type: 'melee' };
state.troops[1] = { prof: 16, seg: 0, type: 'melee' };
state.gateHp[0] = CONFIG.gateMaxHp;
const popE = getRes('pop');
const repE = resolveBattle(0, { siege: false, size: 4, day: state.day });
// 无弓无檑木：近战输出 0.92+0.664=1.584 伤/轮 < 12 血 → 杀不光；敌杀近战 floor(4×0.34)=1/轮
console.assert(repE.meleeDead > 0 && getRes('pop') === popE - repE.meleeDead, 'M11-E 近战互搏死人=永久减人口');
console.assert(state.troops.every(t => t.prof >= 16), 'M11-E 低熟练先死');
// 修城门：扣钱木恢复满血
setRes('money', 100); setRes('wood', 50);
state.gateHp[0] = 4; // 缺 6 血 → 钱12 木6
console.assert(repairGate(0) === true && state.gateHp[0] === CONFIG.gateMaxHp && getRes('money') === 88 && getRes('wood') === 44, 'M11 修城门扣费回血');
console.assert(repairGate(0) === false, 'M11 门完好拒修');
// 檑木无普通营兵=死木头：移除普通营，同配置再打输出腰斩
setRes('soldiers', 2);
state.troops[0] = { prof: 80, seg: 0, type: 'archer' };
state.troops[1] = { prof: 80, seg: 0, type: 'archer' };
state.gateHp[0] = CONFIG.gateMaxHp; state.segLogs[0] = 2;
const repF = resolveBattle(0, { siege: false, size: 4, day: state.day });
// 弓 2×0.92×1.5=2.76 伤/轮：第1轮杀0（池 9.24→4 敌），门 10−8=2；第2轮杀1（池 6.48→3 敌），门 2−6 破 → 仅杀 1 敌
console.assert(repF.kills === 1 && repF.breached, 'M11 无普通营兵檑木不生效：输出腰斩被破门，got kills=' + repF.kills);
// 战报驱动暂停与关闭
state.battleReport = repA; state.paused = true;
render();
console.assert(buttons.some(b => b.label === '关 闭'), 'M11 战报面板关闭按钮');
render();

// ---- 模块12：战后俘虏处置 ----
state.paused = false; state.battleReport = null;
state.pendingCaptives = 0; state.captives = 0;
// 处决：每名 声望-2，整批，处决后恢复走日
setRes('prestige', 50);
state.pendingCaptives = 3;
console.assert(executeCaptives() === true && state.pendingCaptives === 0 && getRes('prestige') === 44, 'M12 处决 3 俘虏声望 -6，got ' + getRes('prestige'));
console.assert(state.paused === false, 'M12 处决后恢复走日');
console.assert(executeCaptives() === false, 'M12 无待处置拒处决');
console.assert(state.log.some(x => x.indexOf('【处置】') >= 0), 'M12 处决日志');
// 关押：整批入押、保声望
setRes('pop', 20); setRes('soldiers', 0); setRes('grain', 5000); setRes('money', 5000);
state.pendingCaptives = 4;
const presM12 = getRes('prestige');
console.assert(imprisonCaptives() === true && state.captives === 4 && state.pendingCaptives === 0, 'M12 关押 4 俘虏入押');
console.assert(getRes('prestige') === presM12, 'M12 关押不扣声望');
// 处置面板：有待处置时出两按钮；无待处置不出
state.pendingCaptives = 1; state.paused = true;
render();
console.assert(buttons.some(b => b.label === '全部处决') && buttons.some(b => b.label === '全部关押'), 'M12 处置面板两按钮');
state.pendingCaptives = 0; state.paused = false;
render();
console.assert(!buttons.some(b => b.label === '全部处决'), 'M12 无待处置不出处置面板');
// 逐日判定（种子随机确定性）：60 日内 4 名俘虏必然全部转化/逃跑；归化进平民不进兵
const popM12 = getRes('pop'), solM12 = getRes('soldiers');
let daysM12 = 0;
while (state.captives > 0 && daysM12 < 60) { advanceClock(31); state.paused = false; daysM12++; }
console.assert(state.captives === 0, 'M12 在押俘虏 ' + daysM12 + ' 日内全部转化/逃跑（种子确定性）');
const convM12 = getRes('pop') - popM12;
console.assert(convM12 >= 0 && convM12 <= 4, 'M12 归化平民 0~4 人，got ' + convM12);
console.assert(getRes('soldiers') === solM12, 'M12 归化是平民不直接成兵');
console.assert(state.log.some(x => x.indexOf('俘虏营') >= 0), 'M12 转化/逃跑日志');
// 种子随机可复现：同种子同序列
state.rngState = 42; const r1 = rand(), r2 = rand();
state.rngState = 42;
console.assert(rand() === r1 && rand() === r2, 'M12 种子随机可复现');
render();
console.log('ALL SMOKE PASSED (模块1~8 + 士气重构 + 军营限建 + 模块9 布防 + 模块10 波次 + 模块11 守城战 + 模块12 俘虏处置)');
`;

eval(code + test);
