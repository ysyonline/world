// 无头冒烟回归 v0.3：Node 直接跑 `node slice/smoke.js`，不需要浏览器
// 覆盖 04-垂直切片 v0.3 裁决：数据层/建造/产者自运walker/双仓/收保/住房软上限/三态宵禁驿站/账本/三营/波次/守城/决策点/皇帝任务/胜负
// 原理：按 index.html 的 <script src> 顺序加载 config/state/sim/render/ui 五模块塞进 DOM 桩 eval，再跑断言；AUTO 全局自动应答决策点
const { loadSliceModules } = require('./load-modules');
const code = loadSliceModules();

const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'canvas' ? {} : (p === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : () => {})) });
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
// ==================== 测试环境：AUTO 自动应答 + 屏蔽日程干扰 ====================
CONFIG.assaultMode = 'turnbased'; // 无头回归走委托结算（实时战斗路径由 settle-smoke.js 守护）
AUTO = { curfew: false, emperor: true, gate: false, oil: true, sortie: true, block: true };
CONFIG.waves = [];              // 波次在 W/S 专项配置，前期清空防误触发
state.nextTaskDay = 9999;       // 皇帝任务在 E 专项测，前期屏蔽
CONFIG.refugeePrestige1 = 999;  // 流民阈值拉高：除专项外隔离流入干扰
CONFIG.refugeePrestige2 = 999;
const near = (a, b) => Math.abs(a - b) < 0.01;
const stepGame = (sec) => { for (let i = 0; i < Math.ceil(sec); i++) advanceClock(Math.min(1, sec - i)); };

// ---- M1/M2：时钟 + 数据层（沿用回归） ----
stepGame(31);
console.assert(state.day === 2, 'M1 30s/日');
togglePause(); stepGame(31);
console.assert(state.day === 2, 'M1 暂停不推进');
togglePause(); state.speedIdx = 2; stepGame(7.5);
console.assert(state.day === 3, 'M1 4倍速');
state.speedIdx = 0;
setRes('grain', 100); setRes('prestige', 50); setRes('political', 0);
addRes('grain', -200); console.assert(getRes('grain') === 0, 'M2 钳 0');
addRes('prestige', 200); console.assert(getRes('prestige') === 100, 'M2 声望钳 100');
console.assert(getRes('soil') === 20 && getRes('iron') === 10, 'M2 初始库存含土铁');
setRes('prestige', 1); setRes('prestige', 0);
console.assert(state.gameOver && state.gameOver.reason === '声望归零', 'M2 声望归零即时败');
state.gameOver = null; state.paused = false; setRes('prestige', 50); setRes('grain', 100);

// ---- M3：分区建造 + 造价 + 双仓/民房限制 ----
setRes('money', 300); setRes('wood', 150); setRes('soil', 60); setRes('iron', 30);
console.assert(tryBuild('farm', 'in', 2, 0) === false, 'M3 农田不能建关内');
console.assert(tryBuild('farm', 'out', 0, 0) === true && getRes('money') === 280 && getRes('wood') === 145, 'M3 农田造价 钱20木5');
console.assert(countBuilding('granary') === 1 && countBuilding('depot') === 1, 'M3 开局自带粮仓+货仓');
console.assert(countBuilding('house') === 6, 'M3 开局6座民房（上限30）');
console.assert(tryBuild('granary', 'in', 2, 0) === false, 'M3 粮仓限一座');
console.assert(tryBuild('depot', 'in', 2, 1) === false, 'M3 货仓限一座');
console.assert(houseCap() === 30, 'M3 住房上限=民房×5=30');
console.assert(tryBuild('house', 'in', 3, 0) === true && houseCap() === 35 && getRes('money') === 260 && getRes('wood') === 135, 'M3 民房造价 钱20木10，上限+5'); // 合图后粮仓在 in(2,2)，测试格改 3,0
console.assert(demolish('in', 3, 0) === false, 'M3 民房不可拆');
console.assert(demolish('in', 2, 2) === false, 'M3 粮仓不可拆');
console.assert(tryBuild('barracks', 'in', 1, 1) === true, 'M3 建兵营');
console.assert(tryBuild('barracks', 'in', 1, 2) === false, 'M3 兵营限一座');
demolish('out', 0, 0); // 清场给运输测试重建

// ---- T：产者自运（秒级产出→存量→walker背回→入库；无折损） ----
tryBuild('farm', 'out', 0, 0);
const farm = state.outGrid[0][0];
for (let i = 0; i < 5; i++) assignWorker(farm, 1);
console.assert(farm.workers === 5, 'T0 五农上岗');
setRes('grain', 100);
// 攒满 5 担 → 自动派 1 人背回（直接给存量，避免断言受「当日产出速率 × 单程耗时」时序影响）
farm.stock = { grain: 6 };
stepGame(1); // 1 秒：触发派趟且未到达（合图后最短单程 ≈130 世界单位，步速 30 → 4.3s）
console.assert(state.walkers.some(w => w.kind === 'carry'), 'T1 攒满5担自动派趟');
console.assert(farm.workers === 4, 'T1 背货人离岗（在岗4，got ' + farm.workers + '）');
// 推完一整日：入库 + 回岗
stepGame(31);
console.assert(farm.workers === 5 || state.walkers.some(w => w.kind === 'carry'), 'T2 背货人回岗（或又出发，got ' + farm.workers + '）');
// 无折损：停工状态存量不变
farm.workers = 0; state.walkers.length = 0;
const s0 = farm.stock.grain || 0;
stepGame(31);
console.assert(near(farm.stock.grain || 0, s0), 'T3 无折损（v0.3 删除1%/日），got ' + (farm.stock.grain || 0));
console.assert(CONFIG.carryLoad === 5 && CONFIG.walkSpeed === 30, 'T4 负重5担/趟·步速30（合图几何补偿后的标定值）');

// ---- T5：收保（walker 撤离→到达变闲民） ----
farm.workers = 4;
toggleRecall();
console.assert(state.recalled === true && farm.workers === 0, 'T5 收保停工撤人');
console.assert(state.walkers.filter(w => w.kind === 'recall').length === 4, 'T5 撤离 walker ×4 在途');
stepGame(12); // 走到城门（距离约500px，12秒足够）
console.assert(state.walkers.filter(w => w.kind === 'recall').length === 0, 'T5 撤离到达入城（walker 清空）');
console.assert(idlePop() === getRes('pop') - state.merchants, 'T5 到达后全员闲民（got 闲' + idlePop() + '/民' + getRes('pop') + '）');
toggleRecall();
console.assert(state.recalled === false, 'T5 复工开关');
farm.workers = 4; // 玩家重新上岗

// ---- H：住房软上限 ----
// 规则：在岗+商人占房；占满 houseCap 后闲民不可再派工（住房满=流落街头者不能上岗）
setRes('pop', 40);
// 当前 assignedTotal：farm 0 + merchants 0（市坊未建）——先造满员场景
farm.workers = 0;
let okN = 0;
while (assignWorker(farm, 1) && okN < 60) okN++; // 岗位上限 5 会先到
console.assert(farm.workers === 5, 'H0 岗位上限先到（5/5，got ' + farm.workers + '）');
// 用兵营送训把占房数顶到 houseCap（7 座=35）：当前在岗 5 + 市坊商人后续
// 直接断言规则本体：
state.inGrid[1][1] && (state.inGrid[1][1].queue = []);
setRes('pop', 36); // 超 35
// 在岗 5 < 35 → 仍可派工（流落街头的 1 人是闲民，但有房者在岗未满）
console.assert(assignWorker(farm, 1) === true || farm.workers >= 5, 'H1 住房未满时岗满不可派（岗位上限优先）');
farm.workers = 0;
// 构造占房满：临时把 farm workers 直接设满 35（绕过岗位上限，验证住房闸门）
farm.workers = 35;
console.assert(canAssignWorkers() === false, 'H2 在岗=住房上限 → 不可再派');
farm.workers = 0;
console.assert(canAssignWorkers() === true, 'H3 在岗回落 → 可派');
setRes('pop', 30); // 复位

// ---- M7：商人 / 三态宵禁 / 驿站 ----
setRes('wood', 100); setRes('money', 500);
CONFIG.nightTheftP = 0; CONFIG.nightFireP = 0;
console.assert(tryBuild('market', 'in', 3, 3) === true && state.merchants === 1, 'M7 市坊建成抽商人');
// 1) 常闭：宿驿站 → 次日税减半（相位：commerce 先于 curfew；advanceClock(15)×2 恰满一日）
state.curfewPolicy = 'closed';
setRes('money', 100); setRes('soldiers', 0); setRes('grain', 2000);
const d0 = state.day;
advanceClock(15); advanceClock(15); // 恰满一日：全额税 + innStay 置位（M7 场景 30 人有闲民，税后同日闲工另入——断言用区间含闲工）
console.assert(state.day === d0 + 1, 'M7 相位：恰跨一日（got day' + state.day + '）');
console.assert(getRes('money') === 100 + CONFIG.marketTax + 6, 'M7 宿驿当晚全额税（+闲工6，got ' + getRes('money') + '）');
advanceClock(15); advanceClock(15); // 第二日：减半税（+闲工）
console.assert(getRes('money') === 100 + CONFIG.marketTax + Math.round(CONFIG.marketTax * CONFIG.innTaxFactor) + 12, 'M7 驿站次日税减半（+闲工12，got ' + getRes('money') + '）');
console.assert(state.log.some(x => x.indexOf('宿') >= 0 && x.indexOf('驿站') >= 0), 'M7 宿驿站日志');
console.assert(state.merchants === 1, 'M7 宿驿商人无恙');
// 2) 常开：夜赌（闲工可能同日入账，断言只验"被偷"方向性：钱 < 100+税+闲工）
state.curfewPolicy = 'open';
CONFIG.nightTheftP = 1; CONFIG.nightFireP = 0;
setRes('money', 100); setRes('grain', 1000);
const popT = getRes('pop');
stepGame(31);
console.assert(getRes('money') < 100 + CONFIG.marketTax + 5, 'M7 常开夜赌被偷（钱-10%，got ' + getRes('money') + '）');
console.assert(getRes('pop') === popT, 'M7 夜赌不死人');
// 3) 询问态：AUTO 不放行=宿驿站
state.curfewPolicy = 'ask';
CONFIG.nightTheftP = 0;
stepGame(31);
console.assert(state.log.some(x => x.indexOf('驿站') >= 0), 'M7 询问态不放行→宿驿站日志');
// 夜赌·失火：必烧一座非仓/非民房建筑
CONFIG.nightFireP = 1; state.curfewPolicy = 'open';
let bCount = 0; eachBuilding(() => bCount++);
stepGame(31);
let bCount2 = 0; eachBuilding(() => bCount2++);
console.assert(bCount2 === bCount - 1 && countBuilding('granary') === 1 && countBuilding('depot') === 1 && countBuilding('house') === 7, 'M7 失火烧一座且豁免两仓/民房');
CONFIG.nightFireP = 0;
for (let r = 0; r < 4; r++) for (let c = 0; c < 10; c++) if (state.inGrid[r][c] && state.inGrid[r][c].type === 'market') demolish('in', r, c);
console.assert(state.merchants === 0, 'M7 拆市坊商人遣散');

// ---- M8：饥荒 + 军饷（v0.4.2 军饷三日一结） ----
setRes('pop', 10); setRes('soldiers', 0); setRes('grain', 0); setRes('prestige', 50);
stepGame(31);
console.assert(state.famine === true && getRes('prestige') === 49 && getRes('pop') === 8, 'M8 饥荒掉声望+断粮饿死');
setRes('grain', 2000); setRes('prestige', 50); setRes('pop', 20);
// 军饷：先对齐到「明天是发饷日」，再设兵清钱（顺序要紧：对齐循环里闲工天天进钱，先清零会被灌满）
while ((state.day + 1 - CONFIG.startDay) % CONFIG.soldierPayEveryDays !== 0) stepGame(1);
setRes('soldiers', 2); setRes('money', 0);
stepGame(31); // 跨入发饷日：闲工 +4（20 闲民）→ 钱 4 < 3日饷 6 → 欠饷 1 期 → 逃兵 ⌈2×0.1⌉=1
console.assert(state.unpaidDays === 1 && getRes('soldiers') === 1, 'M8 欠饷逃兵10%（三日一结口径，got unpaid=' + state.unpaidDays + ' sol=' + getRes('soldiers') + '）');
setRes('money', 100);
while ((state.day + 1 - CONFIG.startDay) % CONFIG.soldierPayEveryDays !== 0) stepGame(1);
stepGame(31); // 发饷日：钱 100+ >> 1 兵 3 钱 → 补齐
console.assert(state.unpaidDays === 0, 'M8 补饷清零');
setRes('soldiers', 0);

// ---- M6：三营 + 熟练度（沿用） ----
setRes('pop', 20); setRes('grain', 2000); setRes('money', 500);
const bar2 = state.inGrid[1][1];
console.assert(sendTrainee(bar2, 'melee') && sendTrainee(bar2, 'archer') && sendTrainee(bar2, 'engineer'), 'M6 三营送训');
stepGame(31 * 5);
console.assert(getRes('soldiers') === 3 && getRes('pop') === 17, 'M6 满训5日出营');
console.assert(state.troops.every(t => t.prof === 80), 'M6 出营熟练度80%');
sendTrainee(bar2, 'engineer');
stepGame(31);
console.assert(rushConscript(bar2) === true && state.troops[3].prof === 20, 'M6 提前出营折算20%');

// ---- M9：经济断层修复（v0.4.2：三日一结 / 粜粮 / 闲工）——放段尾自隔离，污染不到上游 ----
// ①军饷三日一结：发饷日一次扣 3 日饷，非发饷日分文不动
setRes('prestige', 50); setRes('pop', 10); setRes('grain', 2000); setRes('money', 100); setRes('soldiers', 2);
state.troops.length = 0; state.troops.push({ prof: 0, seg: null, type: 'melee' }, { prof: 0, seg: null, type: 'melee' });
state.res.soldiers = 2;
while ((state.day + 1 - CONFIG.startDay) % CONFIG.soldierPayEveryDays !== 0) stepGame(1);
const mPay = getRes('money');
stepGame(31); // 跨入发饷日：扣 2兵×1钱×3=6；同日闲工 10人×0.2=+2、商税 0（市坊已拆）
console.assert(getRes('money') === mPay - 6 + 2, 'M9 发饷日一次扣 3 日饷（' + mPay + '→' + getRes('money') + '，含闲工+2）');
stepGame(31);
const mMid = getRes('money');
stepGame(31);
console.assert(getRes('money') === mMid + 2, 'M9 非发饷日不扣饷（只进闲工 +2）');
setRes('soldiers', 0);
// ②粜粮：口粮线以上余粮变现，日限封顶；关仓即停
state.sellGrain = true;
setRes('pop', 10); setRes('grain', 1000); setRes('money', 100); // 有钱：市坊若缺则补建
if (countBuilding('market') === 0) { setRes('wood', 100); tryBuild('market', 'in', 3, 4); }
console.assert(countBuilding('market') > 0, 'M9 前置：市坊在场');
state.curfewPolicy = 'closed'; CONFIG.nightTheftP = 0; CONFIG.nightFireP = 0; // 排除夜赌干扰
stepGame(31); // 跨日：日结跑完后 ledgerRollDay 把当日流水结转成 yday——从 yday.flows 断言
{
  const flows = (state.ledger.yday && state.ledger.yday.flows && state.ledger.yday.flows.money) || {};
  const gflows = (state.ledger.yday && state.ledger.yday.flows && state.ledger.yday.flows.grain) || {};
  console.assert(flows['粜粮'] === 5, 'M9 粜粮入账 +5（日限 20 粮÷4=5，got ' + flows['粜粮'] + '）');
  console.assert(gflows['粜粮'] === -20, 'M9 粜粮出粮 -20（got ' + gflows['粜粮'] + '）');
  console.assert(flows['闲工'] !== undefined, 'M9 闲工进账本来源（got ' + flows['闲工'] + '）');
}
state.sellGrain = false;
state.ledger.today = {};
stepGame(31);
{
  const flows = (state.ledger.yday && state.ledger.yday.flows && state.ledger.yday.flows.money) || {};
  console.assert(flows['粜粮'] === undefined, 'M9 关仓后不再卖粮（粜粮流水消失）');
}
// ③国库空虚提示（钱=0+无商人）：触发 commerce 结算验证。
// 坑：市坊日结自动补员（闲民>0 就重招商人）——先抽干闲民（全员上岗的 farm 满塞）再断商人，防补员干扰判定
{
  const savedPop = getRes('pop');
  const mkt = [];
  eachBuilding(function (b, z, r, c) { if (b.type === 'market') mkt.push({ b: b, r: r, c: c }); });
  mkt.forEach(function (m) { if (m.b.merchant) { m.b.merchant = false; state.merchants--; } });
  setRes('money', 0);
  setRes('pop', 0); // 闲民清零 → hireMerchant 无从补员；粮耗 need=0 无副作用
  state.log.length = 0;
  state.day += 1; onNewDay(state.day);
  console.assert(state.log.some(x => x.indexOf('国库空虚') >= 0), 'M9 国库空虚提示触发（merchants=' + state.merchants + '）');
  // 复位
  setRes('pop', savedPop);
  mkt.forEach(function (m) { m.b.merchant = true; });
  state.merchants = mkt.length;
}

// ---- W：骚扰波（关门：劫存量+杀暴露含背货者） ----
setRes('grain', 2000); setRes('money', 100); setRes('pop', 20); setRes('prestige', 44); setRes('soldiers', 0);
if (!state.outGrid[0][0]) tryBuild('farm', 'out', 0, 0);
state.outGrid[0][0].stock = { grain: 40 };
state.outGrid[0][0].workers = 1; // 只 1 人：不触发派趟（需 >1），单测劫掠率与本波产出
state.walkers.length = 0;
// 手造一个背货 walker（1 农背 5 粮在途）：世界坐标走「产地 → 便门」
state.walkers.push({ kind: 'carry', x: cellCenter('out', 0, 0).x, y: cellCenter('out', 0, 0).y,
  path: [{ x: gatePos(2).x, y: gatePos(2).y }], seg: 0, segT: 0, speed: CONFIG.walkSpeed,
  color: '#7ec850', cargo: { grain: 5 }, bRef: { zone: 'out', r: 0, c: 0, type: 'farm' }, day: state.day });
state.recalled = false;
const base = state.day;
CONFIG.waves = [{ day: base + 1, size: 6, siege: false, label: '小股骚扰' }];
state.waveFired = {}; state.enemies = []; state.battleReport = null;
AUTO.gate = false;
stepGame(31);
// 关门：暴露=1在田+1背货=2 → 杀 round(2×0.3)=1；产地存量被劫25%（存量含当日秒级产出，断言区间）
const sW1 = state.outGrid[0][0].stock.grain;
console.assert(sW1 >= 29 && sW1 <= 37, 'W1 关门后存量在劫后区间（got ' + sW1.toFixed(1) + '）');
console.assert(state.battleReport && state.battleReport.gateOpen === false && state.battleReport.fieldKilled === 1, 'W1 关门杀暴露1人');
console.assert(getRes('pop') === 19, 'W1 遇害1人（got ' + getRes('pop') + '）');
state.paused = false; state.battleReport = null; state.walkers.length = 0;
// 开门端（沿用断言）
setRes('grain', 100); setRes('money', 100); setRes('pop', 20); setRes('prestige', 44);
setRes('soldiers', 2);
state.troops[0] = { prof: 80, seg: 0, type: 'archer' };
state.troops[1] = { prof: 80, seg: 0, type: 'archer' };
state.outGrid[0][0].workers = 0; state.outGrid[0][0].stock = {};
CONFIG.waves = [{ day: state.day + 1, size: 6, siege: false, label: '小股骚扰' }];
state.waveFired = {}; AUTO.gate = true;
stepGame(31);
console.assert(state.battleReport.kills === 2, 'W2 弓兵3轮歼敌2，got ' + state.battleReport.kills);
// v0.4.2 缴获先入账再被抢：抢掠上限 15% 的基数含缴获（100+2kills×2=104 → ⌊104×0.15⌋=15... 实际上限还受 30/骑×1 骑约束）
// 基数与上限双约束下 lootMoney=16（104×0.15=15.6→16），lootGrain 仍按纯库存 100 算=8
console.assert(state.battleReport.lootGrain === 8 && state.battleReport.lootMoney === 16, 'W2 开门抢掠上限（含缴获基数，got ' + state.battleReport.lootMoney + '）');
state.paused = false; state.battleReport = null;
// W3：城内拦截（02 §4.1）——size=6 骚扰波 iron=⌈6×0.25⌉=2 → 入城 R=max(1,⌈2/2⌉)=1 骑；4 预备近战 K=min(⌊4×0.5⌋,1)=1 全拦
setRes('grain', 100); setRes('money', 100); setRes('pop', 20); setRes('prestige', 44);
setRes('soldiers', 6);
state.troops.length = 0;
for (let i = 0; i < 2; i++) state.troops.push({ prof: 80, seg: 0, type: 'archer' });
for (let i = 0; i < 4; i++) state.troops.push({ prof: 60, seg: null, type: 'melee' }); // 4 近战预备队
CONFIG.waves = [{ day: state.day + 1, size: 6, siege: false, label: '小股骚扰' }];
state.waveFired = {}; state.checkpoint = null;
stepGame(31);
const repW3 = state.battleReport;
console.assert(repW3 && repW3.interceptKilled === 1, 'W3 拦截击杀 K=min(⌊4×0.5⌋,1)=1 全拦, got ' + (repW3 && repW3.interceptKilled));
console.assert(repW3 && repW3.interceptLoss === 0, 'W3 拦截阵亡 ⌊1×0.4⌋=0, got ' + (repW3 && repW3.interceptLoss));
console.assert(repW3 && repW3.lootGrain === 0 && repW3.lootMoney === 0 && repW3.lootPrestige === 0, 'W3 全拦=零损失（relief=0）, got ' + (repW3 && repW3.lootGrain + '/' + repW3.lootMoney + '/' + repW3.lootPrestige));
state.paused = false; state.battleReport = null;

// W4：出城迎击（v0.4.2）——胜端：8 满训近战击退 size6 骚扰（D15 合理兵力，产地无损+缴获）
// 战力：8×0.92×1.0=7.36 vs 敌池 6×3×0.4=7.2 → 险胜（锚见 CONFIG 注释：门槛故意卡在"合理中期配置"）
setRes('grain', 5000); setRes('money', 100); setRes('pop', 40); setRes('prestige', 50);
setRes('soldiers', 8);
state.troops.length = 0;
for (let i = 0; i < 8; i++) state.troops.push({ prof: 80, seg: null, type: 'melee' });
state.outGrid[0][0].stock = { grain: 40 }; state.outGrid[0][0].workers = 1;
state.walkers.length = 0; state.recalled = false;
CONFIG.waves = [{ day: state.day + 1, size: 6, siege: false, label: '小股骚扰' }];
state.waveFired = {}; state.enemies = []; state.battleReport = null;
AUTO.gate = 'sortie';
stepGame(31);
const repW4 = state.battleReport;
console.assert(repW4 && repW4.sortie === true && repW4.sortieWon === true, 'W4 迎击胜利（sent ' + (repW4 && repW4.sortieSent) + '，won=' + (repW4 && repW4.sortieWon) + '）');
console.assert(repW4 && repW4.fieldRobbed === 0 && repW4.fieldKilled === 0, 'W4 迎击胜=产地无损（劫掠 ' + (repW4 && repW4.fieldRobbed) + '/杀 ' + (repW4 && repW4.fieldKilled) + '）');
console.assert(repW4 && repW4.loot > 0, 'W4 迎击胜=缴获 ' + (repW4 && repW4.loot) + ' 钱');
state.paused = false; state.battleReport = null;
// W4b：迎击败端——2 老弱出城 vs size10 骚扰 → 折损+照常被劫（走关门分支）
setRes('pop', 40); setRes('soldiers', 2);
state.troops.length = 0;
state.troops.push({ prof: 10, seg: null, type: 'melee' }, { prof: 10, seg: null, type: 'melee' });
state.outGrid[0][0].stock = { grain: 40 }; state.outGrid[0][0].workers = 1;
CONFIG.waves = [{ day: state.day + 1, size: 10, siege: false, label: '大股袭扰' }];
state.waveFired = {}; state.enemies = []; state.battleReport = null;
AUTO.gate = 'sortie';
stepGame(31);
const repW4b = state.battleReport;
console.assert(repW4b && repW4b.sortie === true && repW4b.sortieWon === false, 'W4b 迎击失利（won=' + (repW4b && repW4b.sortieWon) + '）');
console.assert(repW4b && repW4b.sortieLoss === 1, 'W4b 败=折损 ⌊2×0.5⌋=1（got ' + (repW4b && repW4b.sortieLoss) + '）');
console.assert(repW4b && repW4b.fieldRobbed > 0, 'W4b 败=照常被劫（劫 ' + Math.round(repW4b && repW4b.fieldRobbed) + '）');
state.paused = false; state.battleReport = null;
AUTO.gate = false;

// ---- V：预警与存档（00-总纲 §5 实装项） ----
// V1：声望<10 红色预警日志
setRes('prestige', 9); state.day += 1; onNewDay(state.day);
console.assert(state.log.some(x => x.indexOf('声望濒危') >= 0), 'V1 声望濒危日志');
setRes('prestige', 50);
// V2：总攻预警带规模情报（声望≥70 → "塞上肥关"文案；预警窗口 raidWarnDays=3 内）
setRes('prestige', 75);
CONFIG.waves = [{ day: state.day + 2, size: 10, siege: true, label: '总攻' }];
state.waveFired = {}; state.checkpoint = null;
state.day += 1; onNewDay(state.day);
console.assert(state.log.some(x => x.indexOf('塞上肥关') >= 0), 'V2 高声望总攻情报含"塞上肥关"');
// V3：总攻前夜自动存档（day+1=总攻日 → 今日晨即前夜快照）+ 读档往返
// 注意：快照打在 onNewDay 开头（日结算前），所以 cp 粮=前夜值 100；断言以 cp 内容为准（读档后=前夜）
console.assert(state.checkpoint && state.checkpoint.day === state.day, 'V3 总攻前夜快照已打（day=' + (state.checkpoint && state.checkpoint.day) + '）');
const cpDay = state.checkpoint.day, cpGrain = state.checkpoint.res.grain, rngBefore = state.rngState;
addRes('grain', -50); state.day = 99; setRes('prestige', 1); setRes('prestige', 0); // 破坏现场
console.assert(state.gameOver && state.gameOver.win === false, 'V3 现场已败');
const okLoad = loadCheckpoint();
console.assert(okLoad && state.day === cpDay && getRes('grain') === cpGrain && state.rngState === rngBefore, 'V3 读档恢复（day/粮=前夜值/RNG种子一致）');
console.assert(state.gameOver === null && state.battle === null && state.paused === true, 'V3 读档清战斗态并暂停');
CONFIG.waves = []; state.checkpoint = null;
state.paused = false;
setRes('prestige', 50);

// ---- S：总攻（决策点×3 + 门破≠败 + 胜利判定，沿用） ----
setRes('grain', 5000); setRes('money', 500); setRes('pop', 50); setRes('prestige', 50);
setRes('soldiers', 12);
for (let s = 0; s < 4; s++) {
  state.troops[s * 3]     = { prof: 80, seg: s, type: 'archer' };
  state.troops[s * 3 + 1] = { prof: 80, seg: s, type: 'engineer' };
  state.troops[s * 3 + 2] = { prof: 80, seg: s, type: 'melee' };
}
state.segOil = [1, 1, 1, 1]; state.segLogs = [0, 0, 0, 0]; state.segXbow = [0, 0, 0, 0];
state.gateHp = [12, 12, 12, 12];
CONFIG.assaultMultiP = 0;
CONFIG.oilKillP = 1; CONFIG.sortieKillP = 1; CONFIG.towerKillP = 0;
CONFIG.waves = [{ day: state.day + 1, size: 16, siege: true, label: '总攻' }];
state.waveFired = {}; state.enemies = []; state.battle = null; state.gameOver = null;
stepGame(31);
console.assert(state.battle === null && state.gameOver && state.gameOver.win === true, 'S1 守过总攻=胜利，got ' + JSON.stringify(state.gameOver));
console.assert(state.log.some(x => x.indexOf('堵门洞') >= 0), 'S1 门破≠败');
state.paused = false; state.battleReport = null; state.pendingCaptives = 0;
setRes('soldiers', 0);
state.segOil = [0, 0, 0, 0]; state.gateHp = [12, 12, 12, 12];
CONFIG.waves = [{ day: state.day + 1, size: 16, siege: true, label: '总攻' }];
state.waveFired = {}; state.enemies = []; state.gameOver = null;
setRes('prestige', 50);
stepGame(31);
console.assert(state.gameOver && !state.gameOver.win && state.gameOver.reason === '匈奴涌入城内', 'S2 无兵堵门=涌入判败');
state.gameOver = null; state.paused = false; state.battleReport = null; state.enemies = [];
CONFIG.oilKillP = 0.5; CONFIG.sortieKillP = 0.7; CONFIG.towerKillP = 0.3; CONFIG.assaultMultiP = 0.5;
CONFIG.waves = [];

// ---- E：皇帝任务（沿用） ----
state.nextTaskDay = state.day; state.task = null;
setRes('grain', 100); setRes('money', 100); setRes('pop', 5); setRes('prestige', 50); setRes('political', 0); setRes('soldiers', 0);
stepGame(31);
console.assert(state.task && state.task.accepted === true, 'E1 接旨');
stepGame(31 * 3);
console.assert(getRes('political') === 5, 'E2 完成得政治点+5');
state.nextTaskDay = state.day;
stepGame(31);
setRes('grain', 0); setRes('money', 0); setRes('pop', 0); setRes('prestige', 44);
const presE = getRes('prestige');
stepGame(31 * 3);
console.assert(getRes('prestige') === presE - 5, 'E3 误期扣声望5');
setRes('pop', 20); setRes('grain', 2000); setRes('money', 500); setRes('prestige', 50);

// ---- C：俘虏（沿用） ----
state.pendingCaptives = 3; setRes('prestige', 50);
console.assert(executeCaptives() === true && getRes('prestige') === 44, 'C1 处决3俘虏声望-6');
state.pendingCaptives = 4;
console.assert(imprisonCaptives() === true && state.captives === 4, 'C2 关押入押');
state.rngState = 42; const r1 = rand(), r2 = rand();
state.rngState = 42;
console.assert(rand() === r1 && rand() === r2, 'C4 种子随机可复现');
state.captives = 0;

// ---- L：账本田鸡 ----
setRes('pop', 20); setRes('grain', 500); setRes('money', 200); setRes('soldiers', 0);
state.ledger.today = {}; state.walkers.length = 0;
stepGame(31);
const yd = state.ledger.yday;
console.assert(yd && typeof yd.net.grain === 'number', 'L1 昨日实结滚动');
console.assert(yd.net.grain < 0, 'L1 口粮为负记录（got ' + yd.net.grain + '）');
const est = todayEstimate();
console.assert(est.grain === -20, 'L2 今日预估=口粮-20（got ' + est.grain + '）');
state.ledgerView = true;
render();
console.assert(buttons.some(b => b.label === '账 本'), 'L3 账本按钮');
state.ledgerView = false;

// ---- R：渲染与按钮 ----
setRes('prestige', 50);
state.selectedSeg = 0; setRes('soldiers', 2);
state.troops[0] = { prof: 80, seg: 0, type: 'melee' };
state.troops[1] = { prof: 80, seg: null, type: 'archer' };
render();
console.assert(buttons.some(b => b.label.indexOf('宵禁') >= 0), 'R1 宵禁政策按钮');
console.assert(buttons.some(b => b.label.indexOf('修城门') >= 0 || b.label.indexOf('城门完好') >= 0), 'R1 修门按钮');
state.selectedSeg = null;
render();
const palN = buttons.filter(b => Object.keys(CONFIG.buildings).some(k => CONFIG.buildings[k].label === b.label));
console.assert(palN.length === 10, 'R3 建造面板 10 建筑齐全，got ' + palN.length);
render();

console.log('ALL SMOKE PASSED (v0.3：自运walker/双仓/住房软上限/三态宵禁驿站/账本/收保/骚扰/总攻/皇帝任务/俘虏)');
`;

eval(code + test);
