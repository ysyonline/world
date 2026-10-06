// ============================================================================
// battle.js · 战斗层（08 §6 第 3 步：把 rts.html 的战斗核心移植进合图）
// 来源：rts.html 行 31~820（配置/工具/地图/实体/状态/移动/指令/敌AI/我方AI/主循环）
//       + 825~826（编队色/兵种色）——机械搬运，非重写。
// 封装：整个模块包进 IIFE，只暴露 Battle 对象。理由：rts 原型有大量通用名
//       （S/reset/step/render/clamp/dist2d/rnd/pick/fmtT/frame…），与切片模块重名会
//       静默互相覆盖。IIFE 内的顶层声明全部是局部的，外部冲突风险归零。
// 依赖：CONFIG / MAP（config.js + sim.js 的全局词法环境）；不触碰 state，不写经营数据。
// 边界：第 3 步只做「快照直通」——经营侧把部队/城墙数值映射成战斗单位，战斗结果
//       **不回写**（回写是第 4 步接口结算的事）。
// ============================================================================
'use strict';

const Battle = (function () {
'use strict';
// ============================ 配置（数值出处逐一标注；未标注均为 [PLACEHOLDER·待原型验证]） ============================
const RTS_CONFIG = {
  fixedDt: 0.1,
  speeds: [1, 2, 3],
  // 第 3 步合图：地图/城/墙厚一律从 CONFIG.map 派生——几何只有一个事实源，不在此另写一份
  map: { w: MAP.worldW, h: MAP.worldH, fog: MAP.fog, battle: MAP.battle },
  city: { x: MAP.city.x, y: MAP.city.y, w: MAP.city.w, h: MAP.city.h },
  gates: [],             // 门由 CONFIG.map.segs 中 climb=false 的段生成（见 initMap）
  wallThick: MAP.wallThick,
  gateMaxHp: 12,                       // 切片 gateMaxHp 同值
  player: {
    teams: [
      { id: 0, type: 'melee',     n: 15, prof: 60, label: '甲步兵', x: 250, y: 351 },
      { id: 1, type: 'melee',     n: 15, prof: 60, label: '乙步兵', x: 450, y: 351 },
      { id: 2, type: 'archer',    n: 15, prof: 70, label: '弓兵队', x: 350, y: 300 },
      { id: 3, type: 'engineer',  n: 10, prof: 50, label: '工兵队', x: 350, y: 420 },
    ],
    manHp: 3,                          // 我方单兵生命=敌同档（10-05 试玩反馈「太难」：hp2 隐藏 1.5 倍交换劣势，删除）
    speed: 46,
    profPowerBase: 0.6, profPowerSpan: 0.4,   // 切片同名同值：战力=0.6+0.4×prof/100
    xbows: 1,                          // 工兵队携重弩架数（切片 xbowMaxPerSeg=1 同源）
  },
  enemy: {
    hp: 3, ramHp: 12, towerHp: 8,     // 切片 enemyHp / ramHp / towerHp 同值
    speed: { rider: 55, iron: 50, arbalest: 40, vanguard: 30, ram: 20, tower: 12 },
    manMelee: 0.22,                    // 先登对搏输出（10-05 调参 0.25→0.22）
    ironVsSortie: 0.75,                // 铁骑截杀出城部队（06 §5；0.9→0.75：出城有风险但可生还）
    riderShot: 0.3,                    // 游骑抛射
    arbalestShot: 0.3,               // 弩骑点杀城头（0.35→0.3：城头压力降档）
    towerShot: 0.3,                   // 井阑对城头（0.35→0.3 同上）
    ramGate: 4 / 2.5,                  // 切片 ramGateDmg=4/轮（冲车身份=砸门主力，不动）
    vanguardVsGate: 0.12,              // 蚁附砸门（10 人≈1.2/s，蚁附无器械效率应远低于冲车）
    range: { archer: 170, xbow: 240, rider: 150, arbalest: 210, tower: 200, melee: 28 },
  },
  dps: {
    // 切片按轮结算（全队集火同一目标池），实时化后火力自然分散，系数按节奏折半校准 [PLACEHOLDER·试玩后调]
    archerVsTroop: 0.75 / 2.5,               // 切片 archerCoef=1.5/轮 ×power/人，折半
    archerVsEngine: 0.75 * 0.1 / 2.5,        // 切片 arrowVsEngine=0.1（刮痧）
    xbowBolt: 3, xbowVsEngineMult: 0.3, xbowCd: 2.5, // 切片 xbowDmg=3、xbowVsEngine=0.3（单发点杀制）
    meleeVsTroop: 1.0 / 2.5,                // 切片 meleeCoef=1.0/轮 ×power/人
    meleeVsEngine: 0.5,                     // 出城拆除（切片 sortieKillP=0.7/台 的连续化，占位）
    highGround: 1.2, lowGround: 0.7,        // 06 §3 俯仰修正（占位）
    archerMelee: 0.1,                       // 弓兵被贴身反击力（占位）
  },
  volley: { dmgMult: 2.5, duration: 3, cooldown: 25 },     // 06 §3 齐射+装填真空（倍率占位）
  logroll: { dps: 2 * 2 / 2.5, radius: 95, duration: 4, cooldown: 18 }, // 切片 logDmg=2×logVsEngine=2 → 4/轮
  oil: { killP: 0.5, dot: 4 / 2.5, radius: 85, duration: 5, cooldown: 20 }, // 切片 oilKillP=0.5、oilDot=4/轮
  repair: { duration: 5, cooldown: 18 },   // 修门：无经济层技能化（正式版耗土20木5；10-05 调参 8s/25s→5s/18s：修得没砸得快=挫败感）
  climb: { time: 4, contestTime: 8 },      // 敌爬墙用时 / 无人争夺至「夺墙」时长
  ai: {
    lureTimes: [8, 26, 44],          // 三波诱敌（06 §6「善为诱兵以冒敌」）
    lureRiders: 3, ambushIrons: 3,   // 每波伴生伏兵（10-05 调参 4→3：伏兵过厚堵死出城决策）
    siegeStart: 55,
    retreatFrac: 0.35,               // 编队存活 <35% 溃退（06 §6「不羞遁走」）
    riderFleeHp: 0.5,                // 游骑半血即撤（佯攻不硬拼）
    towerStop: 195, arbalestStop: 205,
    floodInsideLose: 5,              // 涌入城内 ≥5 = 败（02 v0.4：门破≠败、涌入才败）
  },
  metrics: { minEffectiveOps: 10 },  // 06 §1 验证指标
};

// ============================ 工具 ============================
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function dist2d(x1, y1, x2, y2) { return Math.hypot(x2 - x1, y2 - y1); }
let _seed = 20261005;
function srand() { _seed = (_seed * 1664525 + 1013904223) % 4294967296; return _seed / 4294967296; }
function rnd(a, b) { return a + srand() * (b - a); }
function pick(arr) { return arr[Math.floor(srand() * arr.length)]; }
function fmtT(s) { const m = Math.floor(s / 60), r = Math.floor(s % 60); return m + ':' + (r < 10 ? '0' : '') + r; }
function profP(prof) { return RTS_CONFIG.player.profPowerBase + RTS_CONFIG.player.profPowerSpan * (prof / 100); }

// ============================ 地图 ============================
// 合图只有南北两道墙（左右是深涧天险：不可建造、不可进攻、不可布防——08 §3）
const WALLS = [];
const GATES = [];
const WALL_SIDES = ['north', 'south'];
// 墙线 y：north=城上沿，south=城下沿（与 CONFIG.map.city 对齐，几何同源）
function wallY(side) { return side === 'north' ? RTS_CONFIG.city.y : RTS_CONFIG.city.y + RTS_CONFIG.city.h; }
function gatePoint(g) { return { x: g.x, y: wallY(g.side) }; }
function initMap() {
  const C = RTS_CONFIG.city;
  WALLS.length = 0; GATES.length = 0;
  WALL_SIDES.forEach(side => WALLS.push({ side, x1: C.x, y1: wallY(side), x2: C.x + C.w, y2: wallY(side) }));
  // 门 = segs 中不可攀的两段（前门 south / 后门 north）；可攀段是云梯靶子不是门
  CONFIG.map.segs.forEach((sg, i) => {
    if (sg.climb) return;
    GATES.push({ id: i, seg: i, side: sg.side, label: sg.name, x: sg.x + sg.w / 2, y: wallY(sg.side),
      w: sg.w, hp: RTS_CONFIG.gateMaxHp, maxHp: RTS_CONFIG.gateMaxHp, broken: false });
  });
}
function insideCity(x, y) { const C = RTS_CONFIG.city; return x > C.x && x < C.x + C.w && y > C.y && y < C.y + C.h; }
function onWallLine(x, y, tol) {
  const C = RTS_CONFIG.city; tol = tol || 20;
  if (Math.abs(y - C.y) <= tol && x >= C.x - tol && x <= C.x + C.w + tol) return 'north';
  if (Math.abs(y - (C.y + C.h)) <= tol && x >= C.x - tol && x <= C.x + C.w + tol) return 'south';
  return null;
}
function nearestGate(x, y) {
  let best = GATES[0], bd = 1e9;
  GATES.forEach(g => { const d = dist2d(x, y, g.x, g.y); if (d < bd) { bd = d; best = g; } });
  return best;
}
function nearestBrokenGate(x, y) {
  let best = null, bd = 1e9;
  S.brokenGates.forEach(g => { const d = dist2d(x, y, g.x, g.y); if (d < bd) { bd = d; best = g; } });
  return best || nearestGate(x, y);
}
// 线段是否穿墙（我方：门洞永远放行=我方城门自由出入；敌方：只放行已破之门，防穿门）
function crossesWall(x1, y1, x2, y2, enemyPass) {
  const C = RTS_CONFIG.city, T = RTS_CONFIG.wallThick / 2 + 2;
  const inGap = (side, x) => GATES.some(g => {
    if (g.side !== side) return false;
    if (enemyPass && !g.broken) return false; // 敌军：完好门不可穿
    return Math.abs(x - g.x) < g.w / 2 - 4;
  });
  const hCross = (wl, side) => {
    if ((y1 - wl) * (y2 - wl) >= 0) return false;
    const t = (wl - y1) / (y2 - y1), xc = x1 + (x2 - x1) * t;
    return xc > C.x - T && xc < C.x + C.w + T && !inGap(side, xc);
  };
  return hCross(C.y, 'north') || hCross(C.y + C.h, 'south');
}

// ============================ 实体 ============================
function makeTeam(cfg) {
  return {
    id: cfg.id, type: cfg.type, label: cfg.label, n: cfg.n, maxN: cfg.n, prof: cfg.prof,
    x: cfg.x, y: cfg.y, path: [], speed: RTS_CONFIG.player.speed,
    onWall: false, wallSide: null, wantWall: null,
    busy: 0, busyKind: null, repairGate: null,
    volleyCd: 0, volleyT: 0, logCd: 0, logT: 0, oilCd: 0, oilT: 0, repairCd: 0,
    shotCd: 0, xbowCd: 0, dmg: 0, dead: false, selected: false, chip: null,
  };
}
function teamPower(t) { return t.n * profP(t.prof); }
function makeEnemy(kind, x, y, squad) {
  const E = RTS_CONFIG.enemy;
  const hp = (kind === 'ram') ? E.ramHp : (kind === 'tower') ? E.towerHp : E.hp;
  return {
    id: ++S.eid, kind, squad, x, y, hp, maxHp: hp,
    state: 'advance', tx: null, ty: null, target: null, vsGate: null,
    cd: 0, burning: 0, lureT: 0, climbT: 0, contestT: 0, smashT: 0,
    lastHit: null, wallSide: null, dead: false, despawned: false, counted: false,
  };
}

// ============================ 状态 ============================
const S = {
  eid: 0, t: 0, paused: false, speedIdx: 0,
  teams: [], enemies: [], fx: [], banners: [],
  selected: new Set(),
  gameOver: null, brokenGates: [], insideEnemies: new Set(),
  ops: 0, opLog: [], activeTime: 0, pausedTime: 0,
  killsByType: { archer: 0, melee: 0, xbow: 0, log: 0, oil: 0 },
  volleyUses: 0, sortieMoves: 0,
  ai: { luresDone: 0, siegeSpawned: false },
  mouse: { x: 0, y: 0 },
};
const SQUADS = [
  { key: 'white', label: '白编队（前门正攻）' }, { key: 'cyan', label: '青编队（后门器械）' },
  { key: 'black', label: '乌编队（门侧墙云梯）' }, { key: 'red', label: '骍编队（游骑截杀）' },
];
function reset(seed) {
  if (seed !== undefined) _seed = seed;
  S.eid = 0; S.t = 0; S.paused = false; S.speedIdx = 0;
  S.enemies = []; S.fx = []; S.banners = [];
  S.selected = new Set();
  S.gameOver = null; S.brokenGates = []; S.insideEnemies = new Set();
  S.ops = 0; S.opLog = []; S.activeTime = 0; S.pausedTime = 0;
  S.killsByType = { archer: 0, melee: 0, xbow: 0, log: 0, oil: 0 };
  S.volleyUses = 0; S.sortieMoves = 0;
  S.ai = { luresDone: 0, siegeSpawned: false };
  SQUADS.forEach(sq => { sq.total = 0; sq.routed = false; });
  initMap();
  S.teams = RTS_CONFIG.player.teams.map(makeTeam);
  banner('布防阶段 · 敌游骑将至（总攻 ' + RTS_CONFIG.ai.siegeStart + 's）——弓兵上墙，工兵备械');
}
function banner(text) { S.banners.push({ text, t: 3 }); if (S.banners.length > 3) S.banners.shift(); }
function countOp(kind) { S.ops++; S.opLog.push({ t: S.t, kind }); }
function fxRing(x, y, color, r) { S.fx.push({ type: 'ring', x, y, r: r || 24, t: 0, dur: 0.6, color }); }
function fxText(x, y, text, color) { S.fx.push({ type: 'text', x, y, text, t: 0, dur: 1.1, color: color || '#ffd8a0' }); }
function fxBeam(x1, y1, x2, y2, color, w) { S.fx.push({ type: 'beam', x1, y1, x2, y2, t: 0, dur: 0.16, color: color || '#ffe9a0', w: w || 1 }); }

// ============================ 移动与寻路 ============================
function planPath(t, to) {
  const fin = insideCity(t.x, t.y), tin = insideCity(to.x, to.y);
  if (fin === tin) return [{ x: to.x, y: to.y }];
  // 出口选「目标侧」的门，不是离出发地最近的门：
  // 合图两门分处南北，若按出发点取门，点南边目标会绕到北门出去，再撞南墙被 crossesWall 拦死（实测卡到超时）。
  const g = nearestGate(to.x, to.y);
  const offy = (g.side === 'north') ? -26 : 26; // 门点外侧 26（跨墙必经门洞）
  return [{ x: g.x, y: g.y + offy }, { x: to.x, y: to.y }];
}
function moveEntity(t, dt) {
  if (!t.path || t.path.length === 0) return;
  const wp = t.path[0];
  const d = dist2d(t.x, t.y, wp.x, wp.y);
  if (d < 6) {
    t.path.shift();
    if (t.path.length === 0 && t.wantWall) { t.onWall = true; t.wallSide = t.wantWall; t.wantWall = null; fxRing(t.x, t.y, '#d8cfb8', 26); }
    return;
  }
  const step = Math.min(d, t.speed * dt);
  const nx = t.x + (wp.x - t.x) / d * step, ny = t.y + (wp.y - t.y) / d * step;
  if (crossesWall(t.x, t.y, nx, ny)) { t.path = []; t.wantWall = null; return; } // 兜底：撞墙即停
  t.x = nx; t.y = ny;
}
function moveToward(e, tx, ty, dt) {
  const d = dist2d(e.x, e.y, tx, ty);
  if (d < 2) return true;
  const sp = RTS_CONFIG.enemy.speed[e.kind] || 30;
  const step = Math.min(d, sp * dt);
  const nx = e.x + (tx - e.x) / d * step, ny = e.y + (ty - e.y) / d * step;
  if (crossesWall(e.x, e.y, nx, ny, true)) return false;
  e.x = nx; e.y = ny;
  return true;
}

// ============================ 指令（玩家 API；暂停中同样可用 = RTK12 灵魂） ============================
function orderMove(x, y) {
  if (S.selected.size === 0) return;
  let any = false;
  S.selected.forEach(id => {
    const t = S.teams[id];
    if (!t || t.dead || t.busy > 0) return;
    const side = onWallLine(x, y, 16);
    // 可活动范围：横向不进深涧天险（08 §3），纵向留 8 边距
    let to = { x: clamp(x, MAP.cliffW + 8, RTS_CONFIG.map.w - MAP.cliffW - 8), y: clamp(y, 8, RTS_CONFIG.map.h - 8) };
    t.wantWall = null;
    if (side) { // 点墙线 = 上墙驻防（贴内侧站位）
      const C = RTS_CONFIG.city;
      to = { x: clamp(to.x, C.x + 20, C.x + C.w - 20), y: side === 'north' ? C.y + 11 : C.y + C.h - 11 };
      t.wantWall = side;
    }
    const wasIn = insideCity(t.x, t.y);
    t.path = planPath(t, to);
    t.onWall = false; t.wallSide = null;
    any = true;
    if (wasIn && !insideCity(to.x, to.y)) S.sortieMoves++;
    fxRing(t.x, t.y, '#7ec8ff');
  });
  if (any) { countOp('move'); fxRing(x, y, '#ffe08a'); }
}
function selTeams() { return [...S.selected].map(i => S.teams[i]).filter(t => t && !t.dead && t.n > 0); }
function trySkill(k, x, y) {
  const sel = selTeams();
  if (sel.length === 0) { banner('未选中部队'); return false; }
  if (k === 'volley') {
    const arch = sel.filter(t => t.type === 'archer' && t.volleyCd <= 0);
    if (arch.length === 0) { banner('齐射不可用（需弓兵队 · 冷却中）'); return false; }
    arch.forEach(t => { t.volleyT = RTS_CONFIG.volley.duration; t.volleyCd = RTS_CONFIG.volley.cooldown; });
    S.volleyUses++; countOp('volley');
    fxRing(x, y, '#ffd24a', 60);
    banner('【齐射】「材官驺发，矢道同的」——之后装填 ' + RTS_CONFIG.volley.cooldown + 's');
    return true;
  }
  if (k === 'log') {
    const eng = sel.filter(t => (t.type === 'engineer' || t.type === 'melee') && t.onWall && t.logCd <= 0);
    if (eng.length === 0) { banner('檑木不可用（需城头工兵/步兵 · 冷却中）'); return false; }
    eng.forEach(t => { t.logT = RTS_CONFIG.logroll.duration; t.logCd = RTS_CONFIG.logroll.cooldown; });
    countOp('log'); fxRing(x, y, '#b98a4e', 70);
    banner('【檑木】滚落城下（对器械 ×2）');
    return true;
  }
  if (k === 'oil') {
    const eng = sel.filter(t => t.type === 'engineer' && t.onWall && t.oilCd <= 0);
    if (eng.length === 0) { banner('火油不可用（需城头工兵 · 冷却中）'); return false; }
    eng.forEach(t => { t.oilT = RTS_CONFIG.oil.duration; t.oilCd = RTS_CONFIG.oil.cooldown; });
    countOp('oil'); fxRing(x, y, '#ff7a3c', 70);
    const R = RTS_CONFIG.oil.radius;
    const wallsHit = new Set(eng.map(t => t.wallSide)); // 只作用于工兵所在墙侧，防跨墙泼油
    S.enemies.forEach(e => {
      if (e.dead) return;
      const near = nearestWallPointTo(e);
      if (!near || dist2d(e.x, e.y, near.x, near.y) >= R) return;
      const nSide = near.y === RTS_CONFIG.city.y ? 'north' : 'south';
      if (!wallsHit.has(nSide)) return;
      e.burning = RTS_CONFIG.oil.duration;
      if ((e.kind === 'ram' || e.kind === 'tower') && srand() < RTS_CONFIG.oil.killP) { e.hp = 0; e.lastHit = 'oil'; }
    });
    banner('【火油】城头倾倒——近墙器械 50% 直接点燃');
    return true;
  }
  if (k === 'repair') {
    const g = GATES.reduce((b, gg) => dist2d(x, y, gg.x, gg.y) < dist2d(x, y, b.x, b.y) ? gg : b, GATES[0]);
    const eng = sel.filter(t => t.type === 'engineer' && t.repairCd <= 0 && dist2d(t.x, t.y, g.x, g.y) < 80 && !g.broken);
    if (eng.length === 0) { banner('修门不可用（需工兵贴未破之门 · 冷却中）'); return false; }
    eng.forEach(t => { t.busy = RTS_CONFIG.repair.duration; t.busyKind = 'repair'; t.repairGate = g; t.repairCd = RTS_CONFIG.repair.cooldown; t.path = []; t.wantWall = null; });
    countOp('repair');
    banner('【修门】' + g.label + ' 抢修中 ' + RTS_CONFIG.repair.duration + 's（正式版耗土20木5）');
    return true;
  }
  return false;
}

// ============================ 敌 AI ============================
function spawnGroup(squad, cx, cy, kinds, spread) {
  kinds.forEach((k, i) => {
    const ang = i * 2.4;
    S.enemies.push(makeEnemy(k, clamp(cx + Math.cos(ang) * spread, MAP.cliffW + 10, RTS_CONFIG.map.w - MAP.cliffW - 10),
      clamp(cy + Math.sin(ang) * spread * 0.6, 15, RTS_CONFIG.map.h - 15), squad));
  });
}
function spawnLure() {
  const g = pick(GATES);
  const off = g.side === 'north' ? -1 : 1; // 城外方向：北门往上、南门往下
  for (let i = 0; i < RTS_CONFIG.ai.lureRiders; i++) {
    const e = makeEnemy('rider', clamp(g.x + rnd(-90, 90), MAP.cliffW + 10, RTS_CONFIG.map.w - MAP.cliffW - 10), g.y + off * rnd(140, 200), 'lure');
    e.state = 'lure'; e.vsGate = g; e.lureT = rnd(6, 9);
    S.enemies.push(e);
  }
  for (let i = 0; i < RTS_CONFIG.ai.ambushIrons; i++) {
    // 伏兵埋在更远的迷雾带里（合图城外纵深浅：接战区外即迷雾）
    const e = makeEnemy('iron', clamp(g.x + rnd(-120, 120), MAP.cliffW + 10, RTS_CONFIG.map.w - MAP.cliffW - 10), g.y + off * rnd(200, 230), 'ambush');
    e.state = 'ambush'; e.vsGate = g;
    S.enemies.push(e);
  }
  banner('游骑佯动（诱敌）· 远处有伏兵烟尘');
}
function spawnSiege() {
  const g0 = GATES.find(g => g.side === 'south') || GATES[0];                 // 前门（主攻方向）
  const g1 = GATES.find(g => g.side === 'north') || GATES[GATES.length - 1];  // 后门（器械方向）
  const outY = (g, d) => g.y + (g.side === 'north' ? -d : d);                 // 沿城外纵深方向取点
  // 白编队（前门·正攻）：冲车×2 + 铁骑×4 + 先登×8（10-05 调参：攻方 58→46）
  spawnGroup('white', g0.x, outY(g0, 190), ['ram', 'ram', 'iron', 'iron', 'iron', 'iron',
    'vanguard', 'vanguard', 'vanguard', 'vanguard', 'vanguard', 'vanguard', 'vanguard', 'vanguard'], 55);
  // 青编队（后门·器械）：井阑×2 + 弩骑×3 + 先登×6
  spawnGroup('cyan', g1.x, outY(g1, 190), ['tower', 'tower', 'arbalest', 'arbalest', 'arbalest',
    'vanguard', 'vanguard', 'vanguard', 'vanguard', 'vanguard', 'vanguard'], 55);
  // 乌编队（门侧墙·云梯佯攻）：先登×5
  // 08 §3：左右是深涧天险不可攻，所以「爬墙」只能落在与正门同向的门侧可攀段上——
  // 这正是「放门还是放墙」这个决策成立的前提：两点同侧、一个屏幕看得见。
  let ci = CONFIG.map.segs.findIndex(s => s.climb && s.side === g0.side);
  if (ci < 0) ci = CONFIG.map.segs.findIndex(s => s.climb);
  const cs = CONFIG.map.segs[ci];
  const cx = cs.x + cs.w / 2, cy = wallY(cs.side) + (cs.side === 'north' ? -150 : 150);
  spawnGroup('black', cx, cy, Array(5).fill('vanguard'), 50);
  S.enemies.forEach(e => { if (e.squad === 'black') e.climbSeg = ci; });
  // 骍编队（机动游骑×6 城外游弋截杀）；前波伏兵铁骑并入
  spawnGroup('red', MAP.cliffW + 70, cy, Array(6).fill('rider'), 70);
  S.enemies.forEach(e => { if (e.state === 'ambush') { e.state = 'hunt'; e.squad = 'red'; } });
  SQUADS.forEach(sq => { if (!sq.total) sq.total = S.enemies.filter(e => e.squad === sq.key).length; });
  banner('【总攻】四色分进——白攻' + g0.label + ' · 青逼' + g1.label + ' · 乌爬' + cs.name + ' · 骍骑游弋');
}
function nearestWallPointTo(e) {
  const C = RTS_CONFIG.city;
  const cands = [
    { x: clamp(e.x, C.x, C.x + C.w), y: C.y }, { x: clamp(e.x, C.x, C.x + C.w), y: C.y + C.h },
  ];
  let best = null, bd = 1e9;
  cands.forEach(p => { const d = dist2d(e.x, e.y, p.x, p.y); if (d < bd) { bd = d; best = p; } });
  return best;
}
function nearestWallPointOn(side, e) {
  const C = RTS_CONFIG.city;
  return { x: clamp(e.x, C.x, C.x + C.w), y: side === 'north' ? C.y : C.y + C.h };
}
function aliveTeamsOnWall(side) { return S.teams.filter(t => !t.dead && t.n > 0 && t.onWall && (side == null || t.wallSide === side)); }
function outsideTeams() { return S.teams.filter(t => !t.dead && t.n > 0 && !insideCity(t.x, t.y) && !t.onWall); }
function nearestOf(pool, x, y) { return pool.reduce((b, t) => dist2d(x, y, t.x, t.y) < dist2d(x, y, b.x, b.y) ? t : b, pool[0]); }
function dpsMeleeOf(t) {
  const per = t.type === 'archer' ? RTS_CONFIG.dps.archerMelee : RTS_CONFIG.dps.meleeVsTroop;
  return t.n * per * profP(t.prof);
}

function updateEnemy(e, dt) {
  const E = RTS_CONFIG.enemy, C = RTS_CONFIG.city;
  if (e.burning > 0) { // 火油 DoT（切片 oilDot 次轮结算的实时化）
    e.burning -= dt;
    e.hp -= RTS_CONFIG.oil.dot * dt; e.lastHit = 'oil';
  }
  // —— 逃逸类 ——
  if (e.state === 'flee' || e.state === 'rout') {
    if (insideCity(e.x, e.y)) { // 城内败兵：经破口出城再走
      const g = nearestBrokenGate(e.x, e.y);
      if (!moveToward(e, g.x, g.y, dt)) { e.blocked = (e.blocked || 0) + 1; if (e.blocked > 2) { e.tx = null; e.blocked = 0; e.state = 'patrol'; } }
    } else {
      const ty = e.y > C.y + C.h / 2 ? RTS_CONFIG.map.h + 60 : -60;
      if (!moveToward(e, e.x, ty, dt)) {
        // 贴墙卡住（x 落在墙带容差内垂直撤退被拦）：先横向离开城墙带再走
        moveToward(e, e.x < C.x + C.w / 2 ? e.x - 50 : e.x + 50, e.y, dt);
      }
      if (e.y < 15 || e.y > RTS_CONFIG.map.h - 5) { e.dead = true; e.despawned = true; }
    }
    return;
  }
  if (e.state === 'lure') { // 诱敌游骑：逼近城头抛射，计时/半血即撤
    e.lureT -= dt;
    const g = e.vsGate;
    if (dist2d(e.x, e.y, g.x, g.y) > 120) moveToward(e, g.x, g.y, dt);
    else shootTeams(e, dt, E.riderShot, E.range.rider);
    if (e.lureT <= 0 || e.hp < e.maxHp * RTS_CONFIG.ai.riderFleeHp) e.state = 'flee';
    return;
  }
  if (e.state === 'ambush') { // 伏兵铁骑：出城部队靠近即暴起
    if (outsideTeams().some(t => dist2d(e.x, e.y, t.x, t.y) < 240)) e.state = 'hunt';
    return;
  }
  if (e.state === 'hunt') { // 铁骑截杀：追出城部队；无猎物则绕城巡逻
    const out = outsideTeams();
    if (out.length) {
      const prey = nearestOf(out, e.x, e.y);
      if (dist2d(e.x, e.y, prey.x, prey.y) > E.range.melee) {
        if (!moveToward(e, prey.x, prey.y, dt)) { e.blocked = (e.blocked || 0) + 1; if (e.blocked > 2) { e.state = 'patrol'; e.tx = null; e.blocked = 0; } }
        else e.blocked = 0;
      }
      else hitTeam(prey, E.ironVsSortie * dt);
    } else {
      if (e.tx == null || dist2d(e.x, e.y, e.tx, e.ty) < 30) {
        e.tx = clamp(C.x + rnd(0, C.w), C.x + 10, C.x + C.w - 10);
        e.ty = srand() < 0.5 ? rnd(MAP.fog + 10, C.y - 30) : rnd(C.y + C.h + 30, RTS_CONFIG.map.h - MAP.fog - 10);
      }
      if (!moveToward(e, e.tx, e.ty, dt)) { e.blocked = (e.blocked || 0) + 1; if (e.blocked > 2) { e.tx = null; e.blocked = 0; } }
    }
    return;
  }
  // —— 总攻推进 ——
  if (e.state === 'patrol') { // 城外游弋：被墙挡/到点即换路点；发现猎物回 advance
    const out = outsideTeams();
    if (out.length) { e.state = 'advance'; return; }
    if (e.tx == null || dist2d(e.x, e.y, e.tx, e.ty) < 30 || e.blocked) {
      e.blocked = 0;
      e.tx = rnd(MAP.cliffW + 15, RTS_CONFIG.map.w - MAP.cliffW - 15);
      e.ty = srand() < 0.5 ? rnd(MAP.fog + 10, C.y - 30) : rnd(C.y + C.h + 30, RTS_CONFIG.map.h - MAP.fog - 10);
    }
    if (!moveToward(e, e.tx, e.ty, dt)) e.blocked = (e.blocked || 0) + 1; // 撞墙计数，下次换点
    return;
  }
  if (e.state === 'advance') {
    if (e.kind === 'ram') {
      const g = nearestGate(e.x, e.y);
      if (dist2d(e.x, e.y, g.x, g.y) < 30) { e.state = 'ram'; e.vsGate = g; banner('冲车抵' + g.label + '！'); }
      else moveToward(e, g.x, g.y, dt);
    } else if (e.kind === 'tower' || e.kind === 'arbalest') {
      const isTower = e.kind === 'tower';
      const stop = isTower ? RTS_CONFIG.ai.towerStop : RTS_CONFIG.ai.arbalestStop;
      const range = isTower ? E.range.tower : E.range.arbalest;
      const wallTeams = aliveTeamsOnWall();
      const aim = wallTeams.length ? wallTeams : S.teams.filter(t => !t.dead && t.n > 0);
      if (!aim.length) { moveToward(e, nearestGate(e.x, e.y).x, nearestGate(e.x, e.y).y, dt); return; }
      const tw = isTower ? aim[0] : (aim.find(t => t.type === 'archer') || aim[0]); // 弩骑优先点弓兵
      if (dist2d(e.x, e.y, tw.x, tw.y) > stop) moveToward(e, tw.x, tw.y, dt);
      else {
        e.state = isTower ? 'tower-fire' : 'snipe';
        e.target = tw;
      }
      void range;
    } else if (e.kind === 'iron') {
      const out = outsideTeams();
      if (out.length && dist2d(e.x, e.y, nearestOf(out, e.x, e.y).x, nearestOf(out, e.x, e.y).y) < 400) { e.state = 'hunt'; return; }
      const g = nearestGate(e.x, e.y);
      if (dist2d(e.x, e.y, g.x, g.y) > 90) moveToward(e, g.x, g.y, dt);
      else { e.state = 'hold'; e.vsGate = g; }
    } else if (e.kind === 'rider') {
      const out = outsideTeams();
      const wallTeams = aliveTeamsOnWall();
      const prey = out.length ? nearestOf(out, e.x, e.y) : (wallTeams.length ? nearestOf(wallTeams, e.x, e.y) : null);
      if (prey) {
        const d = dist2d(e.x, e.y, prey.x, prey.y);
        let moved = true;
        if (d > E.range.rider * 0.8) moved = moveToward(e, prey.x, prey.y, dt);
        else if (d < 90) moved = moveToward(e, e.x * 2 - prey.x, e.y * 2 - prey.y, dt); // 风筝拉开
        if (!moved) { e.blocked = (e.blocked || 0) + 1; if (e.blocked > 2) { e.state = 'patrol'; e.tx = null; e.blocked = 0; } }
        else e.blocked = 0;
        shootTeams(e, dt, E.riderShot, E.range.rider);
      } else {
        e.state = 'patrol'; // 无猎物：城外游弋（不打无谓消耗，防被城头白嫖到溃）
      }
      if (e.hp < e.maxHp * RTS_CONFIG.ai.riderFleeHp) e.state = 'flee';
    } else { // vanguard
      if (e.squad === 'black') { // 乌编队：云梯爬门侧墙（左右是深涧天险，无从下梯）
        const sg = CONFIG.map.segs[e.climbSeg === undefined ? 1 : e.climbSeg];
        const wx = clamp(e.x, sg.x + 10, sg.x + sg.w - 10);
        const wy = wallY(sg.side) + (sg.side === 'north' ? -12 : 12); // 贴墙外侧架梯
        if (Math.abs(e.x - wx) > 10 || Math.abs(e.y - wy) > 14) moveToward(e, wx, wy, dt);
        else { e.state = 'climb'; e.climbT = RTS_CONFIG.climb.time; e.wallSide = sg.side; e.climbX = wx; }
      } else {
        const g = nearestGate(e.x, e.y);
        if (dist2d(e.x, e.y, g.x, g.y) > 30) moveToward(e, g.x, g.y, dt);
        else { e.state = 'gate-assault'; e.vsGate = g; }
      }
    }
    return;
  }
  if (e.state === 'ram') {
    const g = e.vsGate;
    if (g.broken) { e.state = 'flee'; return; } // 门破=任务完成，撤退（「抢完即走」）
    g.hp -= E.ramGate * dt;
    if (g.hp <= 0) breakGate(g);
    return;
  }
  if (e.state === 'gate-assault') {
    const g = e.vsGate;
    if (g.broken) { e.state = 'flood'; return; }
    g.hp -= E.vanguardVsGate * dt;
    if (g.hp <= 0) breakGate(g);
    return;
  }
  if (e.state === 'climb') {
    e.climbT -= dt;
    if (e.climbT <= 0) { // 登城：站上墙内侧（墙线内 11px），与守军互搏
      e.state = 'wallfight'; e.contestT = RTS_CONFIG.climb.contestTime;
      if (e.climbX !== undefined) e.x = e.climbX;
      e.y = wallY(e.wallSide) + (e.wallSide === 'north' ? 11 : -11);
      const sn2 = CONFIG.map.segs.find(s => s.climb && s.side === e.wallSide);
      banner((sn2 ? sn2.name : '门侧墙') + '云梯已架——敌先登登城！');
    }
    return;
  }
  if (e.state === 'wallfight') {
    const defenders = aliveTeamsOnWall(e.wallSide);
    if (defenders.length) {
      const d = defenders[0];
      hitTeam(d, E.manMelee * dt);
      e.hp -= dpsMeleeOf(d) * dt; e.lastHit = 'melee';
    } else {
      e.contestT -= dt;
      if (e.contestT <= 0) { // 夺墙 → 翻入城内砸门
        e.state = 'smash';
        e.x = clamp(e.x, C.x + 30, C.x + C.w - 30);
        e.y = e.wallSide === 'north' ? C.y + 30 : C.y + C.h - 30;
        e.smashT = 6;
        const sn2 = CONFIG.map.segs.find(s => s.climb && s.side === e.wallSide);
        banner('⚠ ' + (sn2 ? sn2.name : '门侧墙') + '失守！敌翻墙入城砸门——速杀！');
      }
    }
    return;
  }
  if (e.state === 'smash') {
    e.smashT -= dt;
    if (e.smashT <= 0) {
      const g = nearestGate(e.x, e.y);
      if (!g.broken) breakGate(g, true);
      e.state = 'flood';
    }
    return;
  }
  if (e.state === 'tower-fire' || e.state === 'snipe') {
    const isTower = e.state === 'tower-fire';
    const dps = isTower ? E.towerShot : E.arbalestShot;
    const range = isTower ? E.range.tower : E.range.arbalest;
    const wallTeams = aliveTeamsOnWall();
    const pool = wallTeams.length ? wallTeams : S.teams.filter(t => !t.dead && t.n > 0);
    if (!pool.length) { e.state = 'advance'; return; }
      const tw = isTower ? nearestOf(pool, e.x, e.y) : (pool.find(t => t.type === 'archer') || nearestOf(pool, e.x, e.y));
      const d = dist2d(e.x, e.y, tw.x, tw.y);
      if (d > range) { if (!moveToward(e, tw.x, tw.y, dt)) e.state = 'patrol', e.tx = null; } // 被墙挡：先绕行
      else shootTeam(e, tw, dps * dt, range);
      return;
  }
  if (e.state === 'hold') { // 总攻铁骑压门待机：破门即涌、出城即追
    const out = outsideTeams();
    if (out.length) { e.state = 'hunt'; return; }
    const g = e.vsGate || nearestGate(e.x, e.y);
    if (g.broken) e.state = 'flood';
    return;
  }
  if (e.state === 'flood') { // 涌入：经破口进城；堵门队拦住则互搏（02 v0.4 最后窗口）
    // 找任意已破之门（不限距离——破口的消息会传开；原 120px 限制致东墙 smash 兵找不到门无限循环爬墙）
    let g = null, bd = 1e9;
    S.brokenGates.forEach(gg => { const d = dist2d(e.x, e.y, gg.x, gg.y); if (d < bd) { bd = d; g = gg; } });
    if (!g) { e.state = 'advance'; return; } // 无破口：回头继续攻门
    if (insideCity(e.x, e.y)) { // 已进城：攻击最近的城内我方队（不再空走向城中心）
      const inTeams = S.teams.filter(t => !t.dead && t.n > 0 && !t.onWall && insideCity(t.x, t.y));
      if (inTeams.length) {
        const prey = nearestOf(inTeams, e.x, e.y);
        if (dist2d(e.x, e.y, prey.x, prey.y) > RTS_CONFIG.enemy.range.melee) moveToward(e, prey.x, prey.y, dt);
        else { hitTeam(prey, (e.kind === 'iron' ? E.ironVsSortie : E.manMelee) * dt); e.hp -= dpsMeleeOf(prey) * dt; e.lastHit = 'melee'; }
      } else {
        defeat('匈奴涌入城内', '城内已无可战之兵。');
      }
      return;
    }
    // 城外：径直冲破口内侧点（目标必须在城内——门点在墙线上会造成「永远到不了」死锁）
    const inX = g.x;                                        // 门开在南北墙上，x 不偏移
    const inY = g.y + (g.side === 'north' ? 46 : -46);      // 目标点必须落在城内
    const blockers = S.teams.filter(t => !t.dead && t.n > 0 && !t.onWall && insideCity(t.x, t.y) && dist2d(t.x, t.y, g.x, g.y) < 50);
    const dGate = dist2d(e.x, e.y, g.x, g.y);
    if (blockers.length && dGate < 64) {
      const b = nearestOf(blockers, e.x, e.y);
      hitTeam(b, (e.kind === 'iron' ? E.ironVsSortie : E.manMelee) * dt);
      // 堵门队火力按涌入者人数分摊（一人难敌群殴）
      const floodersHere = Math.max(1, S.enemies.filter(x => !x.dead && x.state === 'flood' && dist2d(x.x, x.y, g.x, g.y) < 64).length);
      e.hp -= dpsMeleeOf(b) * dt / floodersHere;
      e.lastHit = 'melee';
      return;
    }
    moveToward(e, inX, inY, dt);
    return;
  }
}
function shootTeams(e, dt, dps, range) { // 对射程内最近可打队输出（城上目标吃俯仰 ×0.7）
  const pool = S.teams.filter(t => !t.dead && t.n > 0 && (t.onWall || !insideCity(t.x, t.y)));
  if (!pool.length) return;
  shootTeam(e, nearestOf(pool, e.x, e.y), dps * dt, range);
}
function shootTeam(e, t, dmg, range) {
  if (dist2d(e.x, e.y, t.x, t.y) > range) return;
  const mult = t.onWall ? RTS_CONFIG.dps.lowGround : 1; // 城下射城上 ×0.7（06 §3）
  hitTeam(t, dmg * mult);
  if (srand() < 0.25) fxBeam(e.x, e.y, t.x + rnd(-8, 8), t.y + rnd(-8, 8), '#ff9a6a');
}
function hitTeam(t, dmg) {
  if (t.dead) return;
  t.dmg += dmg;
  while (t.dmg >= RTS_CONFIG.player.manHp && t.n > 0) {
    t.dmg -= RTS_CONFIG.player.manHp; t.n--;
    fxText(t.x + rnd(-10, 10), t.y - 14, '✝', '#e06a5a');
  }
  if (t.n <= 0) {
    t.dead = true; t.n = 0;
    banner('【' + t.label + '】全军覆没');
    if (S.teams.every(x => x.dead)) defeat('全军覆没', '四支队伍全灭，城头再无人影。');
  }
}
function breakGate(g, fromInside) {
  if (g.broken) return;
  g.hp = 0; g.broken = true;
  S.brokenGates.push(g);
  banner('⚠ ' + g.label + (fromInside ? '被敌从内砸开' : '被撞破') + '！步兵堵门 = 最后窗口');
  fxRing(g.x, g.y, '#e06a5a', 60);
}
function defeat(reason, detail) { if (!S.gameOver) S.gameOver = { win: false, reason, detail: detail || '' }; }
function victory() { if (!S.gameOver) S.gameOver = { win: true, reason: '击退总攻', detail: '「利则进，不利则退，不羞遁走」——匈奴弃械北遁，城头旌旗未倒。' }; }

// ============================ 我方自动行为 ============================
function updateTeam(t, dt) {
  if (t.dead) return;
  t.volleyCd = Math.max(0, t.volleyCd - dt); t.logCd = Math.max(0, t.logCd - dt);
  t.oilCd = Math.max(0, t.oilCd - dt); t.repairCd = Math.max(0, t.repairCd - dt);
  t.volleyT = Math.max(0, t.volleyT - dt); t.logT = Math.max(0, t.logT - dt); t.oilT = Math.max(0, t.oilT - dt);
  if (t.busy > 0) { // 修门通道
    t.busy -= dt;
    if (t.busy <= 0) {
      if (t.busyKind === 'repair' && t.repairGate) {
        const g = t.repairGate;
        if (!g.broken) {
          g.hp = g.maxHp;
          banner('【修门】' + g.label + ' 抢修完毕');
          fxRing(g.x, g.y, '#8ad08a', 50);
        }
        t.repairGate = null;
      }
      t.busyKind = null;
    }
    return;
  }
  if (t.path.length) { moveEntity(t, dt); if (t.path.length) return; }
  const stationary = t.path.length === 0 && t.wantWall == null;
  if (!stationary) return;
  // 弓兵自动射击：优先有生力量，对器械天然刮痧（逼玩家用技能/出城）
  if (t.type === 'archer' && t.n > 0) {
    const mult = (t.volleyT > 0 ? RTS_CONFIG.volley.dmgMult : 1) * (t.onWall ? RTS_CONFIG.dps.highGround : 1);
    const range = RTS_CONFIG.enemy.range.archer;
    let best = null, bd = 1e9, bestEng = null, bde = 1e9;
    S.enemies.forEach(e => {
      if (e.dead || e.state === 'ambush' || e.state === 'climb') return;
      const d = dist2d(t.x, t.y, e.x, e.y);
      if (d > range) return;
      if (e.kind === 'ram' || e.kind === 'tower') { if (d < bde) { bde = d; bestEng = e; } }
      else if (d < bd) { bd = d; best = e; }
    });
    const tgt = best || bestEng;
    if (tgt) {
      const engine = tgt.kind === 'ram' || tgt.kind === 'tower';
      const perMan = engine ? RTS_CONFIG.dps.archerVsEngine : RTS_CONFIG.dps.archerVsTroop;
      tgt.hp -= perMan * profP(t.prof) * t.n * mult * dt;
      tgt.lastHit = 'archer';
      t.shotCd -= dt;
      if (t.shotCd <= 0) { fxBeam(t.x, t.y, tgt.x, tgt.y, t.volleyT > 0 ? '#ffd24a' : '#ffe9a0'); t.shotCd = 0.4; }
    }
  }
  // 重弩自动点杀（工兵队；优先弩骑>井阑>冲车>游骑>铁骑>先登）
  if (t.type === 'engineer' && t.n > 0) {
    t.xbowCd -= dt;
    if (t.xbowCd <= 0) {
      const prio = { arbalest: 0, tower: 1, ram: 2, rider: 3, iron: 4, vanguard: 5 };
      let best = null, bp = 99, bdd = 1e9;
      S.enemies.forEach(e => {
        if (e.dead || e.state === 'ambush') return;
        const d = dist2d(t.x, t.y, e.x, e.y);
        if (d > RTS_CONFIG.enemy.range.xbow) return;
        const p = (prio[e.kind] !== undefined) ? prio[e.kind] : 9;
        if (p < bp || (p === bp && d < bdd)) { bp = p; bdd = d; best = e; }
      });
      if (best) {
        const engine = best.kind === 'ram' || best.kind === 'tower';
        best.hp -= RTS_CONFIG.dps.xbowBolt * (engine ? RTS_CONFIG.dps.xbowVsEngineMult : 1);
        best.lastHit = 'xbow';
        fxBeam(t.x, t.y - 6, best.x, best.y, '#bcd8ff', 2);
        fxText(best.x, best.y - 18, '↯', '#bcd8ff');
        t.xbowCd = RTS_CONFIG.dps.xbowCd / RTS_CONFIG.player.xbows;
      }
    }
  }
  // 檑木通道：本队所在墙侧的墙脚 radius 内持续输出（对器械 ×2 已并入 dps 值）
  if (t.logT > 0 && t.onWall) {
    const R = RTS_CONFIG.logroll.radius;
    S.enemies.forEach(e => {
      if (e.dead) return;
      const near = nearestWallPointOn(t.wallSide, e);
      if (dist2d(e.x, e.y, near.x, near.y) < R) {
        const engine = e.kind === 'ram' || e.kind === 'tower';
        e.hp -= RTS_CONFIG.logroll.dps * (engine ? 1 : 0.5) * dt;
        e.lastHit = 'log';
      }
    });
  }
  // 近战/工兵自动接敌：贴身互搏；邻接器械 = 拆除 DPS（须同侧：都在城内或都在城外）
  // 火力分摊：被 N 个敌人围攻时输出 ÷N（群殴劣势——堵门队顶不住人海，逼玩家用弓火支援）
  if (t.n > 0) {
    const tIn = insideCity(t.x, t.y);
    const adjEnemies = [], adjEngs = [];
    S.enemies.forEach(e => {
      if (e.dead || e.state === 'ambush' || e.state === 'climb') return;
      const d = dist2d(t.x, t.y, e.x, e.y);
      if (e.kind === 'ram' || e.kind === 'tower') {
        if (d < 42 && insideCity(e.x, e.y) === tIn) adjEngs.push(e);
      } else if (d < RTS_CONFIG.enemy.range.melee + 6 && insideCity(e.x, e.y) === tIn) adjEnemies.push(e);
    });
    adjEngs.forEach(e => { e.hp -= RTS_CONFIG.dps.meleeVsEngine * t.n * 0.6 / adjEngs.length * dt; e.lastHit = 'melee'; });
    if (adjEnemies.length) {
      const per = dpsMeleeOf(t) / adjEnemies.length;
      adjEnemies.forEach(e => { e.hp -= per * dt; e.lastHit = 'melee'; });
      const back = adjEnemies.reduce((s, e) => s + (e.kind === 'iron' ? RTS_CONFIG.enemy.ironVsSortie : RTS_CONFIG.enemy.manMelee), 0);
      hitTeam(t, back * dt);
    }
  }
}

// ============================ 主循环 ============================
function checkSquadRout() {
  SQUADS.forEach(sq => {
    if (sq.routed || !sq.total) return;
    const alive = S.enemies.filter(e => e.squad === sq.key && !e.dead).length;
    if (alive > 0 && alive / sq.total < RTS_CONFIG.ai.retreatFrac) {
      sq.routed = true;
      S.enemies.forEach(e => {
        if (e.squad === sq.key && !e.dead && e.state !== 'flood' && e.state !== 'smash' && e.state !== 'wallfight') e.state = 'rout';
      });
      banner(sq.label + ' 溃退——「利则进，不利则退，不羞遁走」');
    }
  });
  // 前波伏兵/诱敌残部并入骍编队计数：总攻后若只剩 hunt/flee/patrol 之类散兵且主力已溃 → 一并转入溃退
  if (S.ai.siegeSpawned && !S.gameOver) {
    const stragglers = S.enemies.filter(e => !e.dead && (e.state === 'hunt' || e.state === 'flee' || e.state === 'ambush' || e.state === 'patrol'));
    const fighters = S.enemies.filter(e => !e.dead && e.state !== 'hunt' && e.state !== 'flee' && e.state !== 'ambush' && e.state !== 'patrol' && e.state !== 'rout');
    if (fighters.length === 0 && stragglers.length > 0 && S.t > RTS_CONFIG.ai.siegeStart + 30) {
      stragglers.forEach(e => { e.state = 'rout'; });
    }
    // 「利则进，不利则退」：残敌 ≤3 且远离我方与城门（无利可图）→ 收兵（防巡逻残局拖满兜底线）
    const alive = S.enemies.filter(e => !e.dead);
    if (alive.length > 0 && alive.length <= 3 && S.t > RTS_CONFIG.ai.siegeStart + 60) {
      const nearAnything = alive.some(e => {
        const nearTeam = S.teams.some(t => !t.dead && t.n > 0 && dist2d(e.x, e.y, t.x, t.y) < 300);
        const nearGate = GATES.some(g => dist2d(e.x, e.y, g.x, g.y) < 300);
        return nearTeam || nearGate;
      });
      if (!nearAnything) alive.forEach(e => { if (e.state !== 'flood') e.state = 'rout'; });
    }
  }
}
function step(dt) {
  if (S.gameOver) return;
  if (S.paused) { S.pausedTime += dt; return; }
  S.activeTime += dt; S.t += dt;
  const AI = RTS_CONFIG.ai;
  if (S.ai.luresDone < AI.lureTimes.length && S.t >= AI.lureTimes[S.ai.luresDone]) { S.ai.luresDone++; spawnLure(); }
  if (!S.ai.siegeSpawned && S.t >= AI.siegeStart) { S.ai.siegeSpawned = true; spawnSiege(); }
  S.teams.forEach(t => updateTeam(t, dt));
  S.enemies.forEach(e => { if (!e.dead) updateEnemy(e, dt); });
  // 死亡扫描：hp 归零即阵亡（燃烧/技能将 hp 直接扣穿也在此收口）
  S.enemies.forEach(e => { if (!e.dead && e.hp <= 0) e.dead = true; });
  // 击杀记账（按来源兵种）
  S.enemies.forEach(e => {
    if (e.dead && !e.counted) {
      e.counted = true;
      if (!e.despawned && e.lastHit) S.killsByType[e.lastHit] = (S.killsByType[e.lastHit] || 0) + 1;
    }
  });
  S.enemies = S.enemies.filter(e => !e.dead);
  // 涌入判败（只统计真正进入墙内围合区的敌：爬墙者/墙上互搏者不计）
  S.insideEnemies = new Set(S.enemies.filter(e => e.state !== 'climb' && e.state !== 'wallfight' && e.state !== 'smash' && insideCity(e.x, e.y)).map(e => e.id));
  if (S.insideEnemies.size >= AI.floodInsideLose) { defeat('匈奴涌入城内', '破口涌入者众（不做巷战），城陷。'); return; }
  checkSquadRout();
  if (S.ai.siegeSpawned && S.enemies.length === 0) victory();
  // 兜底：总攻后 3 分钟仍未分胜负（敌残部逃不出去等）→ 按击退算，防测试挂死
  if (!S.gameOver && S.ai.siegeSpawned && S.t > RTS_CONFIG.ai.siegeStart + 180) victory();
  S.fx.forEach(f => { f.t += dt; });
  S.fx = S.fx.filter(f => f.t < f.dur);
  S.banners.forEach(b => { b.t -= dt; });
  S.banners = S.banners.filter(b => b.t > 0);
}
const COLORS = { white: '#e8e4da', cyan: '#6fd8e8', black: '#8a8a96', red: '#e07a5a', lure: '#c8b88a', ambush: '#b89a6a' };
const TEAM_COLORS = { melee: '#c9a55a', archer: '#7ec8a9', engineer: '#9ab0d8' };

// ============================ 对外 API（替代 rts.html 的 window.__rts） ============================
  reset(); // 启动时先建一次（与 rts.html 一致：加载即可用，GATES/teams 不为空）
  return {
    S, RTS_CONFIG, GATES, WALLS, SQUADS, COLORS, TEAM_COLORS,
    reset, step, orderMove, trySkill, selTeams,
    insideCity, onWallLine, nearestGate, nearestWallPointTo,
    select(ids) { S.selected = new Set(ids); },
    selectAll() { S.selected = new Set(S.teams.filter(t => !t.dead).map(t => t.id)); },
    selectNone() { S.selected = new Set(); },
    isSelected(id) { return S.selected.has(id); },
    togglePause() { S.paused = !S.paused; return S.paused; },
    setPaused(v) { S.paused = !!v; },
    cycleSpeed() { S.speedIdx = (S.speedIdx + 1) % RTS_CONFIG.speeds.length; return RTS_CONFIG.speeds[S.speedIdx]; },
    move: orderMove,
    skill: trySkill,
    run(sec) { let left = sec; while (left > 0 && !S.gameOver) { const d = Math.min(RTS_CONFIG.fixedDt, left); step(d); left -= d; } },
    pause(v) { S.paused = v; },
    speed(i) { S.speedIdx = i; },
    alive() { return S.teams.some(t => !t.dead && t.n > 0); },
    snapshot() {
      return {
        t: S.t, gameOver: S.gameOver, ops: S.ops, activeTime: S.activeTime, pausedTime: S.pausedTime,
        kills: Object.assign({}, S.killsByType), volleyUses: S.volleyUses, sortieMoves: S.sortieMoves,
        brokenGates: S.brokenGates.map(g => g.label),
        gates: GATES.map(g => ({ label: g.label, hp: Math.round(g.hp * 10) / 10, broken: g.broken })),
        teams: S.teams.map(t => ({ label: t.label, n: t.n, dead: t.dead, onWall: t.onWall, busy: Math.round(t.busy * 10) / 10 })),
        enemiesAlive: S.enemies.length,
        enemiesByState: S.enemies.reduce((m, e) => { m[e.state] = (m[e.state] || 0) + 1; return m; }, {}),
        insideCount: S.insideEnemies.size,
      };
    },
  };
})();
