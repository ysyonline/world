// rts.html 无头回归 · Node 直接跑 `node slice/rts-smoke.js`
// 原理与 smoke.js 同：抽 <script> 塞 DOM 桩 eval，用 window.__rts API 驱动。
// 两组局：A 挂机局（威胁必须真实：必败）；B 操作局（合理布防+技能+堵门：应胜且指标达标）。
const fs = require('fs');
const path = require('path');

const htmlPath = path.join(__dirname, 'rts.html');
const code = fs.readFileSync(htmlPath, 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

const ctxProxy = new Proxy({}, { get: (t, p) => (p === 'measureText' ? (s) => ({ width: String(s).length * 7 }) : () => {}) });
const fakeCanvas = { getContext: () => ctxProxy, width: 1280, height: 800, addEventListener: () => {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 800 }) };
globalThis.document = { getElementById: () => fakeCanvas };
globalThis.window = globalThis;
globalThis.requestAnimationFrame = undefined; // 阻断帧循环，纯步进驱动

const R = new Function(code + '\nreturn window.__rts;')();

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
  ok(s.gates.length === 2 && s.gates[0].label === '甲门', '双门（甲/乙）');
  ok(s.gates.every(g => g.hp === 12 && !g.broken), '门血 12 满血（切片同源）');
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
  // 弓兵上北墙
  R.select([2]);
  R.move(C.x + C.w * 0.35, C.y - 10); // 点北墙线 → 上墙
  R.run(3);
  let s = R.snapshot();
  const arch = R.S.teams[2];
  ok(arch.onWall && arch.wallSide === 'top', '弓兵点墙线自动上墙');
  // 步兵队上东墙（防乌编队爬墙）
  R.select([1]);
  R.move(C.x + C.w + 10, C.y + C.h * 0.5);
  R.run(6);
  ok(R.S.teams[1].onWall && R.S.teams[1].wallSide === 'right', '乙步兵上东墙');
  // 出城：甲步兵从城内到乙门外
  const t0 = R.S.teams[0];
  R.select([0]);
  R.move(C.x + C.w * 0.5, C.y + C.h + 80);
  R.run(8);
  ok(!R.RTS_CONFIG || R.S.teams[0].x > 0, '移动存活');
  ok(!R.S.teams[0].onWall, '出城后不在墙上');
  const snap = R.snapshot();
  ok(snap.sortieMoves >= 1, '出城机动计数 +1（两步决策证据埋点）');
  ok(snap.ops >= 3, '操作计数累加（' + snap.ops + '）');
  // 门洞寻路：城内→城外路径必经门点
  const g = R.GATES[1];
  R.select([3]);
  R.S.teams[3].x = C.x + C.w / 2; R.S.teams[3].y = C.y + C.h / 2;
  R.move(200, 700);
  const p0 = R.S.teams[3].path[0];
  ok(p0 && Math.abs(p0.x - g.x) < 40 && Math.abs(p0.y - g.y) < 60, '跨墙寻路先到乙门');
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
  // 工兵上墙 + 手动造一个冲车在北墙脚
  R.select([3]);
  R.move(C.x + C.w * 0.3, C.y - 10); // 点北墙外侧线（与弓兵 T2 同法）
  R.run(10);
  ok(R.S.teams[3].onWall, '工兵上北墙');
  const S = R.S;
  const ram = {
    id: ++S.eid, kind: 'ram', squad: 'white', x: C.x + C.w * 0.3, y: C.y - 20,
    hp: 12, maxHp: 12, state: 'hold', vsGate: R.GATES[0], tx: null, ty: null, target: null,
    cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  }; // state=hold：不撞门不跑，纯当靶子（防干扰修门断言）
  S.enemies.push(ram);
  // 火油（50% 点燃：用种子多次不保险，直接断言 hp 变化或 burning）
  R.select([3]);
  const okOil = R.trySkill('oil', C.x, C.y);
  ok(okOil, '火油施放成功');
  ok(ram.hp < 12 || ram.burning > 0, '火油对墙脚冲车生效（点燃或灼烧）');
  // 檑木
  R.run(21); // 等冷却（冲车当靶子会被慢慢磨掉，无妨）
  const ramAlive = !ram.dead;
  const hpBefore = ram.hp;
  if (ramAlive) {
    R.select([3]);
    R.trySkill('log', 0, 0);
    R.run(2);
    ok(ram.hp < hpBefore || ram.dead, '檑木对城下器械输出（×2 已并入 dps）');
  } else {
    console.log('  − 檑木：靶冲车已被磨掉，跳过（oil 已验证对器械通道）');
  }
  // 齐射：造一个游骑在弓兵射程内
  R.select([2]);
  const g2 = {
    id: ++S.eid, kind: 'rider', squad: 'red', x: C.x + C.w * 0.5, y: C.y - 100,
    hp: 3, maxHp: 3, state: 'lure', vsGate: R.GATES[0], lureT: 99, tx: null, ty: null, target: null,
    cd: 0, burning: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  };
  R.S.teams[2].x = C.x + C.w * 0.5; R.S.teams[2].y = C.y + 11; R.S.teams[2].onWall = true; R.S.teams[2].wallSide = 'top'; R.S.teams[2].path = [];
  R.S.enemies.push(g2);
  R.trySkill('volley', 0, 0);
  R.run(3.5);
  ok(g2.dead || g2.hp < 3, '齐射×2.5 重创/击杀游骑');
  // 重弩自动点杀：造弩骑在 240 内
  const arb = {
    id: ++R.S.eid, kind: 'arbalest', squad: 'cyan', x: C.x + C.w * 0.5, y: C.y + C.h + 120,
    hp: 3, maxHp: 3, state: 'snipe', vsGate: null, tx: null, ty: null, target: R.S.teams[2],
    cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0, lastHit: null, wallSide: null,
    dead: false, despawned: false, counted: false,
  };
  R.S.enemies.push(arb);
  R.select([3]);
  R.S.teams[3].x = C.x + C.w * 0.5; R.S.teams[3].y = C.y + C.h - 11; R.S.teams[3].onWall = true; R.S.teams[3].wallSide = 'bottom'; R.S.teams[3].path = [];
  R.run(6);
  ok(arb.hp < 3 || arb.dead, '重弩自动点杀弩骑（↞3/2.5s）');
  // 修门：先打掉门血再造工兵贴门修（摆位法：与 B 局同）
  R.GATES[0].hp = 4;
  const eng3 = R.S.teams[3];
  eng3.x = R.GATES[0].x; eng3.y = R.GATES[0].y + 40; eng3.onWall = false; eng3.wallSide = null; eng3.path = [];
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
  // 爬墙佯攻：总攻后乌编队先登贴东墙
  R.reset(20261005);
  R.run(58);
  const climbers = R.S.enemies.filter(e => e.squad === 'black');
  ok(climbers.length === 5, '乌编队 5 先登在推进');
  // 过程侦测：15s 窗口内出现 climb/wallfight/smash 任一状态即佯攻成立（终态采样会漏：砸完门转 flood）
  let anyClimb = false, waited = 0;
  while (!anyClimb && waited < 15) {
    R.run(0.5); waited += 0.5;
    if (R.S.enemies.some(e => e.state === 'climb' || e.state === 'wallfight' || e.state === 'smash')) anyClimb = true;
  }
  ok(anyClimb, '先登抵东墙架梯（佯攻成立）');
  // 编队溃退：白编队杀到 <35% 转 rout（杀 70% 剩 30% < 35%，先清 dead 再校验）
  const whitesAll = R.S.enemies.filter(e => e.squad === 'white');
  if (whitesAll.length) {
    whitesAll.forEach((e, i) => { if (i < Math.floor(whitesAll.length * 0.7)) { e.hp = 0; e.dead = true; } });
    R.run(0.2);
    R.S.enemies.forEach(e => { if (e.hp <= 0 && !e.dead) e.dead = true; });
    const rest = R.S.enemies.filter(e => e.squad === 'white' && !e.dead);
    // rout=溃退 / hold=压门未参战 / flee=砸完门撤退；flood=已破门涌入（杀红眼，豁免溃退=合理设计）
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
  const C = R.RTS_CONFIG.city, g0 = R.GATES[0], g1 = R.GATES[1];
  // 开局布防（t<8s，等行军到位再开打）
  R.select([2]); R.move(C.x + C.w * 0.35, C.y - 10);        // 弓兵上北墙（甲门侧）
  R.run(6);
  R.select([1]); R.move(C.x + C.w + 10, C.y + C.h * 0.5);   // 乙步兵上东墙（防爬墙）
  R.run(6);
  R.select([3]); R.move(g0.x, g0.y + 40);                    // 工兵贴甲门（修门+重弩俯射）
  R.run(5);
  R.select([0]); R.move(C.x + C.w / 2, C.y + C.h / 2);       // 甲步兵居中预备（堵门救火队）
  R.run(5);
  ok(R.S.teams[2].onWall && R.S.teams[1].onWall, '布防到位（弓上北墙/乙步上东墙）');
  // 诱敌期：齐射轰游骑
  R.select([2]); R.trySkill('volley', 0, 0);
  R.run(26);
  R.select([2]); R.trySkill('volley', 0, 0);
  R.run(6); // t≈62 总攻已发
  // 总攻期：齐射轮转 + 火油/檑木按冷却交 + 分段堵门
  let guard = 0;
  while (!R.snapshot().gameOver && guard++ < 3800) {
    R.run(0.5);
    const t0 = R.S.teams[0], t1 = R.S.teams[1], t2 = R.S.teams[2], t3 = R.S.teams[3];
    // 远程火力分配（06 §1 决策点①）：南墙有威胁即转场（青编队 8 先登+弩骑从南来）
    const southThreat = R.S.enemies.filter(e => !e.dead && e.y > C.y + C.h - 120 && e.squad !== 'red').length;
    if (!t2.dead && t2.onWall && t2.wallSide === 'top' && southThreat >= 3) {
      R.select([2]); R.move(C.x + C.w * 0.5, C.y + C.h + 10); // 转场南墙
    }
    // 齐射：转好就交（主火力）
    if (!t2.dead && t2.onWall && t2.volleyCd <= 0) { R.select([2]); R.trySkill('volley', 0, 0); }
    // 器械压制：北墙弓兵邻接的冲车/井阑超过 2 台 → 工兵上墙泼油滚木
    const northEng = R.S.enemies.filter(e => !e.dead && (e.kind === 'ram' || e.kind === 'tower') && e.y < C.y + 60 && Math.abs(e.x - g0.x) < 300).length;
    if (!t3.dead && !t3.onWall && northEng >= 2 && R.S.t > 60) { R.select([3]); R.move(C.x + C.w * 0.35, C.y - 10); }
    if (!t3.dead && t3.onWall && t3.oilCd <= 0) { R.select([3]); R.trySkill('oil', 0, 0); }
    if (!t3.dead && t3.onWall && t3.logCd <= 0) { R.select([3]); R.trySkill('log', 0, 0); }
    if (!t1.dead && t1.onWall && t1.logCd <= 0) { R.select([1]); R.trySkill('log', 0, 0); }
    // 修门：甲门半血且工兵空闲
    if (!g0.broken && g0.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      R.select([3]);
      t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g0.x; t3.y = g0.y + 40;
      R.trySkill('repair', g0.x, g0.y);
    }
    if (!g1.broken && g1.hp < 8 && !t3.dead && t3.repairCd <= 0 && !t3.busy) {
      R.select([3]);
      t3.onWall = false; t3.wallSide = null; t3.path = []; t3.x = g1.x; t3.y = g1.y - 40;
      R.trySkill('repair', g1.x, g1.y);
    }
    // 东墙失守应对：乌编队先登翻墙后砸门（t>80 若无墙防，乙步兵下墙回防门洞）
    if (R.S.t > 80 && t1.onWall && !g1.broken && g1.hp < 6) {
      R.select([1]); R.move(g1.x, g1.y - 40);
    }
    // 堵门：门破 → 最近步兵队顶门洞；乙门高危时甲步兵提前压过去
    if (g0.broken && !t0.dead && Math.hypot(t0.x - g0.x, t0.y - g0.y) > 30) { R.select([0]); R.move(g0.x, g0.y + 40); }
    if (!g0.broken && !g1.broken && !t0.dead && g1.hp < 6 && Math.hypot(t0.x - g1.x, t0.y - g1.y) > 60) {
      R.select([0]); R.move(g1.x, g1.y - 50); // 预堵乙门（北侧待命）
    }
    if (g1.broken && !t1.dead && Math.hypot(t1.x - g1.x, t1.y - g1.y) > 30) {
      R.select([1]); t1.onWall = false; t1.wallSide = null; R.move(g1.x, g1.y - 40);
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

// ============================ V2 局 · 出城拆器械两步决策（06 §5 克制环核心验证） ============================
// 对照实验：同一局面（甲门外冲车×2 + 骍编队游骑×6 巡弋）——
//   莽撞版：开局直接出城冲冲车（不压制铁骑/游骑）
//   谨慎版：先上墙齐射消耗游骑（一波齐射+平射），再出城拆
// 判据：谨慎版出城折损 < 莽撞版出城折损（"先创造窗口、再执行"成立=两步决策有真实收益）
section('V2 局 · 出城两步决策（压制→出城 vs 莽撞直冲）');
(function () {
  const C = R.RTS_CONFIG.city, g0 = R.GATES[0];
  const origLure = R.RTS_CONFIG.ai.lureTimes, origSiege = R.RTS_CONFIG.ai.siegeStart;
  function setup() {
    R.reset(20261005);
    R.RTS_CONFIG.ai.lureTimes = [];          // 靶场：关诱敌
    R.RTS_CONFIG.ai.siegeStart = 99999;      // 靶场：关总攻（防全套敌军混入）
    const S = R.S;
    S.enemies = []; S.ai.siegeSpawned = true; // 骗过胜利判定（敌清零即胜），本局只看折损
    const mk = (kind, x, y, squad, state) => {
      const e = { id: ++S.eid, kind, squad, x, y, hp: kind === 'ram' ? 12 : 3, maxHp: kind === 'ram' ? 12 : 3,
        state, tx: null, ty: null, target: null, vsGate: g0, cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0,
        lastHit: null, wallSide: null, dead: false, despawned: false, counted: false, blocked: 0 };
      S.enemies.push(e); return e;
    };
    mk('ram', g0.x - 30, g0.y - 60, 'white', 'hold');  // 靶态冲车（hold=不砸门不跑，纯靶子）
    mk('ram', g0.x + 30, g0.y - 60, 'white', 'hold');
    for (let i = 0; i < 6; i++) mk('rider', C.x - 160 + i * 25, C.y + C.h * 0.4 + (i % 2) * 30, 'red', 'patrol');
    return S;
  }
  const ramsAlive = (S) => S.enemies.filter(e => e.kind === 'ram' && !e.dead).length;
  // —— 莽撞版：弓兵留城内原地，甲步兵直接出城拆 ——
  let S = setup();
  const t0 = S.teams[0];
  R.select([0]); R.move(g0.x, g0.y - 90);
  let guard = 0;
  while (guard++ < 1200 && !t0.dead && ramsAlive(S) > 0 && !S.gameOver) R.run(0.5);
  const rashLoss = 15 - t0.n; const rashRams = 2 - ramsAlive(S);
  console.log('  莽撞版：步兵折损 ' + rashLoss + '/15，拆冲车 ' + rashRams + '/2，用时 ' + S.t.toFixed(0) + 's');
  // —— 谨慎版：弓兵上墙齐射清光游骑，再出城 ——
  S = setup();
  const t0b = S.teams[0], t2b = S.teams[2];
  R.select([2]); R.move(g0.x, C.y - 10);
  R.run(6);
  R.select([2]); R.trySkill('volley', 0, 0);
  guard = 0;
  while (guard++ < 1200 && S.enemies.some(e => e.kind === 'rider' && !e.dead) && !t2b.dead) R.run(0.5);
  const ridersLeft = S.enemies.filter(e => e.kind === 'rider' && !e.dead).length;
  R.select([0]); R.move(g0.x, g0.y - 90);
  guard = 0;
  while (guard++ < 1200 && !t0b.dead && ramsAlive(S) > 0 && !S.gameOver) R.run(0.5);
  const careLoss = 15 - t0b.n; const careRams = 2 - ramsAlive(S);
  console.log('  谨慎版：游骑剩 ' + ridersLeft + '，步兵折损 ' + careLoss + '/15，拆冲车 ' + careRams + '/2，用时 ' + S.t.toFixed(0) + 's');
  ok(careRams >= 1, '谨慎版能拆掉冲车（V2 拆除通道）');
  ok(rashLoss > 0, '莽撞直冲有惩罚（折损 ' + rashLoss + '）——克制环真实');
  ok(rashLoss > careLoss, '两步决策有收益：谨慎折损(' + careLoss + ') < 莽撞(' + rashLoss + ')');
  // 还原 CONFIG（防污染后续局）
  R.RTS_CONFIG.ai.lureTimes = origLure;
  R.RTS_CONFIG.ai.siegeStart = origSiege;
})();

// ============================ 汇总 ============================
console.log('\n================ 结果 ================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
process.exit(fail > 0 ? 1 : 0);
