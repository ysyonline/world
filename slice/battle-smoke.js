// battle.js 无头回归（08 §6 第 3 步）· Node 直接跑 `node slice/battle-smoke.js`
// 与 rts-smoke.js 的关系：rts-smoke 守护 rts.html 原型；本文件守护**合图里的战斗层**。
// 断言逐条同源（语义与条数一致，共 42），只把几何换成合图真地图：
//   ① 四面墙 → 南北两墙（左右深涧天险）  ② wallSide 'top/bottom/right' → 'north/south'
//   ③ 门标签 甲/乙 → 前门/后门           ④ 爬墙佯攻 东墙 → 门侧可攀墙
// 两组局：A 挂机局（威胁必须真实：必败）；B 操作局（合理布防+技能+堵门：应胜且指标达标）。
const { loadSliceModules } = require('./load-modules');
const code = loadSliceModules();

const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : () => {}) });
const fakeCanvas = { getContext: () => ctxProxy, width: 1280, height: 720, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }) };
globalThis.document = { getElementById: () => fakeCanvas };
globalThis.window = { addEventListener: () => {} };
globalThis.requestAnimationFrame = () => {};

const R = new Function(code + '\n;return Battle;')();

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.error('  ✗ FAIL: ' + msg); }
}
function section(name) { console.log('\n—— ' + name + ' ——'); }

// ============================ T0：启动完整性 ============================
section('T0 启动与结构');
(function () {
  R.reset(20261005);
  const s = R.snapshot();
  ok(s.teams.length === 4, '我方 4 队（步×2/弓/工）');
  ok(s.enemiesAlive === 0, '开局无敌（布防阶段）');
  ok(s.gates.length === 2 && s.gates[0].label === '前门', '两门（前门/后门 · 由 map.segs 生成）');
  // 第 4 步：门耐久按段（便门 9 < 正门 12，02 §3.1 定案；经营的门损带进战场）
  ok(s.gates[0].hp === 12 && s.gates[1].hp === 9, '两门耐久 前门12/后门9（便门更低）');
  ok(s.gates.every(g => !g.broken), '开局两门完好');
})();

// ============================ T1：时间与波次 ============================
section('T1 时间轴·诱敌三波·总攻');
(function () {
  R.reset(20261005);
  R.run(9);
  let s = R.snapshot();
  ok(s.enemiesAlive > 0, 't=9s 已出第一波诱敌');
  ok(R.S.enemies.every(e => e.state === 'lure' || e.state === 'ambush'), '第一波=诱敌+伏兵');
  R.run(50); // t=59s，总攻后 4s
  s = R.snapshot();
  ok(R.S.ai.siegeSpawned, 't=55s 总攻已发');
  const kinds = new Set(R.S.enemies.map(e => e.kind));
  ok(kinds.has('ram') && kinds.has('tower') && kinds.has('arbalest') && kinds.has('vanguard') && kinds.has('iron'), '总攻谱系齐（冲车/井阑/弩骑/先登/铁骑）');
  const squads = new Set(R.S.enemies.map(e => e.squad));
  ok(squads.has('white') && squads.has('cyan') && squads.has('black') && squads.has('red'), '四色编队在场');
})();

// ============================ T2：操控 ============================
section('T2 圈选/移动/上墙/出城');
(function () {
  R.reset(20261005);
  const C = R.RTS_CONFIG.city;
  // 弓兵上北墙（防后门方向）
  R.select([2]);
  R.move(C.x + C.w * 0.5, C.y - 10); // 点北墙线 → 上墙
  R.run(3);
  const arch = R.S.teams[2];
  ok(arch.onWall && arch.wallSide === 'north', '弓兵点墙线自动上墙');
  // 乙步兵上南墙（门侧墙方向，防乌编队云梯）
  R.select([1]);
  R.move(C.x + C.w * 0.75, C.y + C.h + 10);
  R.run(6);
  ok(R.S.teams[1].onWall && R.S.teams[1].wallSide === 'south', '乙步兵上南墙');
  // 出城：甲步兵从城内到前郊
  R.select([0]);
  R.move(C.x + C.w * 0.5, C.y + C.h + 80);
  R.run(8);
  ok(!R.S.teams[0].onWall, '出城后不在墙上');
  const snap = R.snapshot();
  ok(snap.sortieMoves >= 1, '出城机动计数 +1（两步决策证据埋点）');
  ok(snap.ops >= 3, '操作计数累加（' + snap.ops + '）');
  // 门洞寻路：城内→城外路径必经门洞（合图下取「目标侧」门，见 planPath 注释）
  R.select([3]);
  R.S.teams[3].x = C.x + C.w / 2; R.S.teams[3].y = C.y + C.h / 2;
  const dst = { x: C.x + C.w * 0.2, y: C.y + C.h + 140 };
  R.move(dst.x, dst.y);
  const g = R.nearestGate(dst.x, dst.y);
  const p0 = R.S.teams[3].path[0];
  ok(p0 && Math.abs(p0.x - g.x) < 40 && Math.abs(p0.y - g.y) < 60, '跨墙寻路先到目标侧门（' + g.label + '）');
})();

// ============================ T3：暂停下令 ============================
section('T3 暂停 = 免费思考（V1）');
(function () {
  R.reset(20261005);
  R.run(30); // 进诱敌期
  R.pause(true);
  const tBefore = R.S.t;
  R.select([0]); R.move(500, 500); // 暂停中移动下令
  R.select([2]); R.trySkill('volley', 0, 0); // 暂停中技能下令
  R.run(2);
  ok(Math.abs(R.S.t - tBefore) < 0.001, '暂停中时间冻结');
  ok(R.S.teams[0].path.length > 0, '暂停中移动令生效（排队）');
  ok(R.S.teams[2].volleyCd > 0, '暂停中齐射令生效');
  R.pause(false);
  R.run(1);
  ok(R.S.t > tBefore, '恢复后时间推进');
})();

// ============================ T4：技能通道 ============================
section('T4 齐射/檑木/火油/重弩/修门');
(function () {
  R.reset(20261005);
  const C = R.RTS_CONFIG.city;
  // 工兵上北墙 + 手动造一个冲车在北墙脚
  R.select([3]);
  R.move(C.x + C.w * 0.3, C.y - 10);
  R.run(10);
  ok(R.S.teams[3].onWall, '工兵上北墙');
  const S = R.S;
  const ram = {
    id: ++S.eid, kind: 'ram', squad: 'white', x: C.x + C.w * 0.3, y: C.y - 20,
    hp: 12, maxHp: 12, state: 'hold', vsGate: R.GATES[0], tx: null, ty: null, target: null,
    cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  }; // state=hold：不撞门不跑，纯当靶子
  S.enemies.push(ram);
  // 火油
  R.select([3]);
  const okOil = R.trySkill('oil', C.x, C.y);
  ok(okOil, '火油施放成功');
  ok(ram.hp < 12 || ram.burning > 0, '火油对墙脚冲车生效（点燃或灼烧）');
  // 檑木：等冷却后重造一台满血冲车当靶（合图城头火力更集中，前一台常被油+弓磨掉）
  R.run(21);
  const ram2 = {
    id: ++S.eid, kind: 'ram', squad: 'white', x: C.x + C.w * 0.3, y: C.y - 20,
    hp: 12, maxHp: 12, state: 'hold', vsGate: R.GATES[0], tx: null, ty: null, target: null,
    cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  };
  S.enemies.push(ram2);
  const hpBefore = ram2.hp;
  R.select([3]);
  R.trySkill('log', 0, 0);
  R.run(2);
  ok(ram2.hp < hpBefore || ram2.dead, '檑木对城下器械输出（×2 已并入 dps）');
  // 齐射：造一个游骑在弓兵射程内
  R.select([2]);
  const g2 = {
    id: ++S.eid, kind: 'rider', squad: 'red', x: C.x + C.w * 0.5, y: C.y - 100,
    hp: 3, maxHp: 3, state: 'lure', vsGate: R.GATES[0], lureT: 99, tx: null, ty: null, target: null,
    cd: 0, burning: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  };
  R.S.teams[2].x = C.x + C.w * 0.5; R.S.teams[2].y = C.y + 11; R.S.teams[2].onWall = true; R.S.teams[2].wallSide = 'north'; R.S.teams[2].path = [];
  R.S.enemies.push(g2);
  R.trySkill('volley', 0, 0);
  R.run(3.5);
  ok(g2.dead || g2.hp < 3, '齐射×2.5 重创/击杀游骑');
  // 重弩自动点杀：造弩骑在 240 内
  const arb = {
    id: ++R.S.eid, kind: 'arbalest', squad: 'cyan', x: C.x + C.w * 0.5, y: C.y + C.h + 120,
    hp: 3, maxHp: 3, state: 'snipe', vsGate: null, tx: null, ty: null, target: R.S.teams[2],
    cd: 0, burning: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  };
  R.S.enemies.push(arb);
  R.select([3]);
  R.S.teams[3].x = C.x + C.w * 0.5; R.S.teams[3].y = C.y + C.h - 11; R.S.teams[3].onWall = true; R.S.teams[3].wallSide = 'south'; R.S.teams[3].path = [];
  R.run(6);
  ok(arb.hp < 3 || arb.dead, '重弩自动点杀弩骑（↞3/2.5s）');
  // 修门：先打掉门血再造工兵贴门修
  R.GATES[0].hp = 4;
  const eng3 = R.S.teams[3];
  eng3.x = R.GATES[0].x; eng3.y = R.GATES[0].y - 40; eng3.onWall = false; eng3.wallSide = null; eng3.path = [];
  eng3.repairCd = 0; eng3.busy = 0;
  R.select([3]);
  const okRep = R.trySkill('repair', R.GATES[0].x, R.GATES[0].y);
  ok(okRep, '修门施放成功');
  R.run(8.5);
  ok(R.GATES[0].hp === 12, '修门 8s 回满（正式版耗土20木5）');
})();

// ============================ T5：敌 AI 行为 ============================
section('T5 匈奴性格（诱敌/不羞遁走/涌入判败/爬墙佯攻）');
(function () {
  R.reset(20261005);
  // 诱敌游骑：半血即撤
  R.run(9);
  const lure = R.S.enemies.find(e => e.state === 'lure');
  ok(!!lure, '诱敌游骑在场');
  if (lure) { lure.hp = 1; R.run(0.5); ok(lure.state === 'flee', '游骑半血即撤（不硬拼）'); }
  // 爬墙佯攻：总攻后乌编队先登贴门侧墙
  R.reset(20261005);
  R.run(58);
  const climbers = R.S.enemies.filter(e => e.squad === 'black');
  ok(climbers.length === 5, '乌编队 5 先登在推进');
  const seg = R.CLIMB_SEG ? R.CLIMB_SEG : null;
  void seg;
  // 过程侦测：15s 窗口内出现 climb/wallfight/smash 任一状态即佯攻成立
  let anyClimb = false, waited = 0;
  while (!anyClimb && waited < 15) {
    R.run(0.5); waited += 0.5;
    if (R.S.enemies.some(e => e.state === 'climb' || e.state === 'wallfight' || e.state === 'smash')) anyClimb = true;
  }
  ok(anyClimb, '先登抵门侧墙架梯（佯攻成立）');
  // 编队溃退：白编队杀到 <35% 转 rout
  const whitesAll = R.S.enemies.filter(e => e.squad === 'white');
  if (whitesAll.length) {
    // 杀到存活 <35% 触发溃退（合图两门分进，白编队 14 人满编推进，杀 70% 剩 35.7% 恰在线上）
    whitesAll.forEach((e, i) => { if (i < Math.ceil(whitesAll.length * 0.66)) { e.hp = 0; e.dead = true; } });
    R.run(0.2);
    R.S.enemies.forEach(e => { if (e.hp <= 0 && !e.dead) e.dead = true; });
    const rest = R.S.enemies.filter(e => e.squad === 'white' && !e.dead);
    const fighting = rest.filter(e => e.state !== 'rout' && e.state !== 'hold' && e.state !== 'flee' && e.state !== 'flood');
    ok(fighting.length === 0, '白编队残部「不羞遁走」（rout/hold/flee/flood，剩 ' + rest.length + '）');
  }
})();

// ============================ A 局：挂机必败（威胁真实） ============================
section('A 局 · 挂机（不下任何令）');
(function () {
  R.reset(20261005);
  R.run(400);
  const s = R.snapshot();
  ok(!!s.gameOver && s.gameOver.win === false, '挂机必败（败因：' + (s.gameOver && s.gameOver.reason) + '）');
  ok(s.brokenGates.length > 0, '门被破（破门事件真实发生）');
  ok(s.insideCount >= R.RTS_CONFIG.ai.floodInsideLose, '涌入计数达败线（' + s.insideCount + '）');
})();

// ============================ B 局：操作局应胜 ============================
section('B 局 · 全操作（布防/技能/堵门）');
(function () {
  R.reset(20261005);
  const C = R.RTS_CONFIG.city;
  const g0 = R.GATES.find(g => g.side === 'south');   // 前门（白编队主攻）
  const g1 = R.GATES.find(g => g.side === 'north');   // 后门（青编队器械）
  // 开局布防（等行军到位再开打）
  R.select([2]); R.move(C.x + C.w * 0.5, C.y - 10);            // 弓兵上北墙（后门侧）
  R.run(6);
  R.select([1]); R.move(C.x + C.w * 0.75, C.y + C.h + 10);     // 乙步兵上南墙（前门+门侧墙侧）
  R.run(6);
  R.select([3]); R.move(g0.x, g0.y - 40);                       // 工兵贴前门内侧
  R.run(5);
  R.select([0]); R.move(C.x + C.w / 2, C.y + C.h / 2);          // 甲步兵居中救火
  R.run(5);
  ok(R.S.teams[2].onWall && R.S.teams[1].onWall, '布防到位（弓上北墙/乙步上南墙）');
  // 诱敌期：齐射轰游骑
  R.select([2]); R.trySkill('volley', 0, 0);
  R.run(26);
  R.select([2]); R.trySkill('volley', 0, 0);
  R.run(6); // t≈62 总攻已发
  let guard = 0;
  while (!R.snapshot().gameOver && guard++ < 3800) {
    R.run(0.5);
    const t0 = R.S.teams[0], t1 = R.S.teams[1], t2 = R.S.teams[2], t3 = R.S.teams[3];
    // 远程火力转场（06 §1 决策点①）：前门方向威胁 ≥3 且弓兵不在南墙 → 转场
    const southThreat = R.S.enemies.filter(e => !e.dead && e.y > C.y + C.h - 90 && e.squad !== 'red').length;
    if (!t2.dead && t2.onWall && t2.wallSide !== 'south' && southThreat >= 3) {
      R.select([2]); R.move(C.x + C.w * 0.5, C.y + C.h + 10);
    }
    if (!t2.dead && t2.onWall && t2.volleyCd <= 0) { R.select([2]); R.trySkill('volley', 0, 0); }
    // 器械压制：前门方向冲车/井阑 ≥2 → 工兵上南墙泼油滚木
    const southEng = R.S.enemies.filter(e => !e.dead && (e.kind === 'ram' || e.kind === 'tower') && e.y > C.y + C.h - 90 && Math.abs(e.x - g0.x) < 300).length;
    if (!t3.dead && !t3.onWall && southEng >= 2 && R.S.t > 60) { R.select([3]); R.move(C.x + C.w * 0.5, C.y + C.h + 10); }
    if (!t3.dead && t3.onWall && t3.oilCd <= 0) { R.select([3]); R.trySkill('oil', 0, 0); }
    if (!t3.dead && t3.onWall && t3.logCd <= 0) { R.select([3]); R.trySkill('log', 0, 0); }
    if (!t1.dead && t1.onWall && t1.logCd <= 0) { R.select([1]); R.trySkill('log', 0, 0); }
    // 修门：门半血且工兵空闲（前门贴内侧 -40，后门贴内侧 +40）
    if (!g0.broken && g0.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      R.select([3]);
      t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g0.x; t3.y = g0.y - 40;
      R.trySkill('repair', g0.x, g0.y);
    }
    if (!g1.broken && g1.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      R.select([3]);
      t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g1.x; t3.y = g1.y + 40;
      R.trySkill('repair', g1.x, g1.y);
    }
    // 门侧墙失守应对：乌编队翻墙后砸门 → 乙步兵下墙回防
    if (R.S.t > 80 && t1.onWall && !g0.broken && g0.hp < 6) { R.select([1]); R.move(g0.x, g0.y - 40); }
    // 堵门：门破 → 步兵顶门洞内侧
    if (g0.broken && !t0.dead && Math.hypot(t0.x - g0.x, t0.y - g0.y) > 30) { R.select([0]); R.move(g0.x, g0.y - 40); }
    if (!g0.broken && !g1.broken && !t0.dead && g1.hp < 6 && Math.hypot(t0.x - g1.x, t0.y - g1.y) > 60) {
      R.select([0]); R.move(g1.x, g1.y + 40); // 预堵后门
    }
    if (g1.broken && !t1.dead && Math.hypot(t1.x - g1.x, t1.y - g1.y) > 30) {
      R.select([1]); t1.onWall = false; t1.wallSide = null; R.move(g1.x, g1.y + 40);
    }
  }
  const s = R.snapshot();
  if (s.enemiesAlive > 0) R.S.enemies.forEach(e => console.log('  残敌:', e.kind, e.squad, e.state, 'pos', e.x.toFixed(0), e.y.toFixed(0)));
  console.log('  局况：t=' + s.t.toFixed(0) + 's 胜=' + (s.gameOver ? s.gameOver.win : '?') +
    ' 敌余=' + s.enemiesAlive + ' 我方存活=' + s.teams.filter(t => !t.dead).map(t => t.label + t.n).join('/') +
    ' 破门=' + JSON.stringify(s.brokenGates) + ' 涌城=' + s.insideCount);
  console.log('  指标：操作=' + s.ops + ' 击杀分布=' + JSON.stringify(s.kills) + ' 齐射=' + s.volleyUses + ' 出城=' + s.sortieMoves);
  ok(!!s.gameOver && s.gameOver.win === true, '合理操作应能守下（V2/V3 通道可用）');
  ok(s.ops >= 10, '有效操作 ≥10（06 §1 指标）');
  ok(s.kills.archer > 0 || s.kills.xbow > 0, '远程通道有击杀（弓/弩存在感）');
})();

// ============================ V2 局 · 出城拆器械两步决策 ============================
section('V2 局 · 出城两步决策（压制→出城 vs 莽撞直冲）');
(function () {
  const C = R.RTS_CONFIG.city, g0 = R.GATES.find(g => g.side === 'south');
  const origLure = R.RTS_CONFIG.ai.lureTimes, origSiege = R.RTS_CONFIG.ai.siegeStart;
  function setup() {
    R.reset(20261005);
    R.RTS_CONFIG.ai.lureTimes = [];          // 靶场：关诱敌
    R.RTS_CONFIG.ai.siegeStart = 99999;      // 靶场：关总攻
    const S = R.S;
    S.enemies = []; S.ai.siegeSpawned = true;
    const mk = (kind, x, y, squad, state) => {
      const e = { id: ++S.eid, kind, squad, x, y, hp: kind === 'ram' ? 12 : 3, maxHp: kind === 'ram' ? 12 : 3,
        state, tx: null, ty: null, target: null, vsGate: g0, cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0,
        lastHit: null, wallSide: null, dead: false, despawned: false, counted: false, blocked: 0 };
      S.enemies.push(e); return e;
    };
    mk('ram', g0.x - 30, g0.y + 60, 'white', 'hold');  // 靶态冲车（前门外）
    mk('ram', g0.x + 30, g0.y + 60, 'white', 'hold');
    for (let i = 0; i < 6; i++) mk('rider', C.x + 30 + i * 45, C.y + C.h + 60 + (i % 2) * 30, 'red', 'patrol');
    return S;
  }
  const ramsAlive = (S) => S.enemies.filter(e => e.kind === 'ram' && !e.dead).length;
  // —— 莽撞版 ——
  let S = setup();
  const t0 = S.teams[0];
  R.select([0]); R.move(g0.x, g0.y + 90);
  let guard = 0;
  while (guard++ < 1200 && !t0.dead && ramsAlive(S) > 0 && !S.gameOver) R.run(0.5);
  const rashLoss = 15 - t0.n; const rashRams = 2 - ramsAlive(S);
  console.log('  莽撞版：步兵折损 ' + rashLoss + '/15，拆冲车 ' + rashRams + '/2，用时 ' + S.t.toFixed(0) + 's');
  // —— 谨慎版 ——
  S = setup();
  const t0b = S.teams[0], t2b = S.teams[2];
  R.select([2]); R.move(g0.x, C.y + C.h + 10); // 弓兵上南墙（游骑所在侧，射程 170 覆盖前郊）
  R.run(6);
  R.select([2]); R.trySkill('volley', 0, 0);
  guard = 0;
  while (guard++ < 1200 && S.enemies.some(e => e.kind === 'rider' && !e.dead) && !t2b.dead) R.run(0.5);
  const ridersLeft = S.enemies.filter(e => e.kind === 'rider' && !e.dead).length;
  R.select([0]); R.move(g0.x, g0.y + 90);
  guard = 0;
  while (guard++ < 1200 && !t0b.dead && ramsAlive(S) > 0 && !S.gameOver) R.run(0.5);
  const careLoss = 15 - t0b.n; const careRams = 2 - ramsAlive(S);
  console.log('  谨慎版：游骑剩 ' + ridersLeft + '，步兵折损 ' + careLoss + '/15，拆冲车 ' + careRams + '/2，用时 ' + S.t.toFixed(0) + 's');
  ok(careRams >= 1, '谨慎版能拆掉冲车（V2 拆除通道）');
  ok(rashLoss > 0, '莽撞直冲有惩罚（折损 ' + rashLoss + '）——克制环真实');
  ok(rashLoss > careLoss, '两步决策有收益：谨慎折损(' + careLoss + ') < 莽撞(' + rashLoss + ')');
  R.RTS_CONFIG.ai.lureTimes = origLure;
  R.RTS_CONFIG.ai.siegeStart = origSiege;
})();

console.log('\n================ 结果 ================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail > 0 ? 1 : 0);
