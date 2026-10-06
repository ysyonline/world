// ============================================================================
// sim.js · 逻辑层（经营循环 + 战斗结算，零渲染依赖）
// 职责：网格建造、日结管线、岗位与产出、产者自运 walker、收保、商贸宵禁、
//       饥荒军饷、兵营三营、城墙布防、敌波次、骚扰/总攻结算、皇帝任务、俘虏、
//       决策队列、advanceClock 时钟推进。
// 约定：可读可改 state 与 CONFIG，但绝不触碰 ctx / W / H / buttons——那是 render/ui 的地盘。
// ============================================================================
'use strict';

// ============================ 网格与建造（改造②） ============================
// 坐标体系（08 §6 第 2 步）：sim 层一律用「世界坐标」，屏幕↔世界的换算归 render/ui。
const OUT = CONFIG.outGrid, IN = CONFIG.inGrid, MAP = CONFIG.map;
function gridOf(zone) { return zone === 'out' ? state.outGrid : state.inGrid; }
function cfgOf(zone) { return zone === 'out' ? OUT : IN; }
// 城外分区：行 < splitRow = 后郊（北），否则前郊（南）——左右是天险，城外只剩南北
function outRowY0(r) { return r < OUT.splitRow ? OUT.y0North + r * OUT.cell : OUT.y0South + (r - OUT.splitRow) * OUT.cell; }
function cellCenter(zone, r, c) {
  const cfg = cfgOf(zone);
  return { x: cfg.x0 + c * cfg.cell + cfg.cell / 2, y: (zone === 'out' ? outRowY0(r) : cfg.y0 + r * cfg.cell) + cfg.cell / 2 };
}
function cellAt(wx, wy) {
  const oc = Math.floor((wx - OUT.x0) / OUT.cell);
  const orN = Math.floor((wy - OUT.y0North) / OUT.cell);
  if (oc >= 0 && oc < OUT.cols && orN >= 0 && orN < OUT.splitRow) return { zone: 'out', r: orN, c: oc };
  const orS = Math.floor((wy - OUT.y0South) / OUT.cell);
  if (oc >= 0 && oc < OUT.cols && orS >= 0 && orS < OUT.rows - OUT.splitRow) return { zone: 'out', r: OUT.splitRow + orS, c: oc };
  const ic = Math.floor((wx - IN.x0) / IN.cell), ir = Math.floor((wy - IN.y0) / IN.cell);
  if (ir >= 0 && ir < IN.rows && ic >= 0 && ic < IN.cols) return { zone: 'in', r: ir, c: ic };
  return null;
}
// 墙段几何（08 §3：两门 + 各自门侧一段可攀墙；左右天险无段）
function segRect(s) {
  const g = MAP.segs[s], t = MAP.wallThick;
  const y = g.side === 'north' ? MAP.city.y - t : MAP.city.y + MAP.city.h;
  return { x: g.x, y: y - 8, w: g.w, h: t + 16, side: g.side };
}
function gatePos(s) { // 段 s 的门洞中心（默认前门 s=0）
  const g = MAP.segs[s === undefined ? 0 : s];
  return { x: g.x + g.w / 2, y: g.side === 'north' ? MAP.city.y - MAP.wallThick / 2 : MAP.city.y + MAP.city.h + MAP.wallThick / 2 };
}
function nearestGate(from) { // 城外产地按就近门入城（后郊→便门，前郊→正门）
  const backY = MAP.city.y, frontY = MAP.city.y + MAP.city.h;
  const useBack = Math.abs(from.y - backY) < Math.abs(from.y - frontY);
  return gatePos(useBack ? 2 : 0); // 段 2 = 后门（便门），段 0 = 前门（正门）
}
function wallSegAt(wx, wy) {
  for (let s = 0; s < MAP.segs.length; s++) {
    const r = segRect(s);
    if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) return s;
  }
  return null;
}
function eachBuilding(fn) {
  for (let r = 0; r < OUT.rows; r++) for (let c = 0; c < OUT.cols; c++)
    if (state.outGrid[r][c]) fn(state.outGrid[r][c], 'out', r, c);
  for (let r = 0; r < IN.rows; r++) for (let c = 0; c < IN.cols; c++)
    if (state.inGrid[r][c]) fn(state.inGrid[r][c], 'in', r, c);
}
function countBuilding(type) {
  let n = 0;
  eachBuilding(function (b) { if (b.type === type) n++; });
  return n;
}
function costStr(cost) {
  return Object.keys(cost).map(function (k) { return RES_LABEL[k] + cost[k]; }).join(' ');
}
function canBuildAt(key, zone, r, c) {
  const def = CONFIG.buildings[key];
  if (def.zone !== zone) return { ok: false, reason: def.label + '只能建在' + (def.zone === 'out' ? '城外' : '关内') };
  if (gridOf(zone)[r][c]) return { ok: false, reason: '此地已有建筑' };
  if (key === 'barracks' && countBuilding('barracks') > 0) return { ok: false, reason: '全关隘仅可设一座兵营' };
  if (key === 'granary' && countBuilding('granary') > 0) return { ok: false, reason: '粮仓全关隘仅一座（仓储上限出切片）' };
  if (key === 'depot' && countBuilding('depot') > 0) return { ok: false, reason: '货仓全关隘仅一座（仓储上限出切片）' };
  for (const k of Object.keys(def.cost)) {
    if (getRes(k) < def.cost[k]) return { ok: false, reason: RES_LABEL[k] + '不足（需 ' + def.cost[k] + '）' };
  }
  return { ok: true, reason: '' };
}
function tryBuild(key, zone, r, c) {
  const def = CONFIG.buildings[key];
  const chk = canBuildAt(key, zone, r, c);
  if (!chk.ok) { pushLog('建造【' + def.label + '】失败：' + chk.reason); return false; }
  LEDGER_SRC = '建造·' + def.label;
  for (const k of Object.keys(def.cost)) addRes(k, -def.cost[k]);
  LEDGER_SRC = null;
  const b = { type: key, workers: 0 };
  if (def.zone === 'out') { b.stock = {}; }
  if (key === 'barracks') b.queue = [];       // 受训队列 {left, type}
  if (key === 'workshop') b.product = 'log';  // 工匠坊当前产物
  if (key === 'market') hireMerchant(b);      // 市坊建成即抽商人
  gridOf(zone)[r][c] = b;
  state.buildMode = null;
  state.selected = { zone: zone, r: r, c: c };
  pushLog('建成【' + def.label + '】（' + costStr(def.cost) + '）');
  return true;
}
function demolish(zone, r, c) {
  const g = gridOf(zone), b = g[r][c];
  if (!b) return false;
  const def = CONFIG.buildings[b.type];
  if (b.type === 'granary' && countBuilding('granary') <= 1) { pushLog('粮仓不可拆（粮食入库点）'); return false; }
  if (b.type === 'depot' && countBuilding('depot') <= 1) { pushLog('货仓不可拆（木土铁入库点）'); return false; }
  if (b.type === 'house') { pushLog('民房不可拆（拆屋赶民，关隘不容）'); return false; }
  if (b.type === 'market' && b.merchant) state.merchants -= 1; // 拆市坊商人遣散回闲民
  LEDGER_SRC = '拆除返还·' + def.label;
  for (const k of Object.keys(def.cost)) addRes(k, Math.floor(def.cost[k] / 2));
  LEDGER_SRC = null;
  g[r][c] = null;
  if (state.selected && state.selected.zone === zone && state.selected.r === r && state.selected.c === c) state.selected = null;
  pushLog('拆除【' + def.label + '】，返还一半造价');
  return true;
}

// ============================ 游戏日时钟与日结管线 ============================
const dailySettlers = [];
function settleDay(day) {
  for (const fn of dailySettlers) fn(day);
  ledgerRollDay(); // 账本田鸡：今日流水结转昨日（v0.3）
  pushLog('日结：' + resSummary());
}
function onNewDay(day) {
  autoSaveCheck(); // 总攻前夜快照（在 settleDay 前打：拿的是"总攻日晨、当日结算前"的干净状态）
  settleDay(day);
}

// ============================ 岗位与产出（v0.3：秒级实时 + 产者自运） ============================
function effOf(b) {
  const N = CONFIG.buildings[b.type].capacity, x = b.workers;
  if (x <= 0) return 0;
  if (x <= N) return x / N;
  return Math.max(0, 1 - CONFIG.overstaffK * (x - N) / N);
}
function assignedTotal() {
  // 在岗工人 + 商人 + 走路中的工人（背货/收保往返，身份仍占岗位账目）
  let n = state.merchants;
  eachBuilding(function (b) { n += b.workers; });
  state.walkers.forEach(function (w) { if (w.kind === 'carry' || w.kind === 'recall' || w.kind === 'resume') n++; });
  return n;
}
function idlePop() { return getRes('pop') - assignedTotal(); }
function canAssignWorkers() { // 住房软上限：在岗+商人占房，占满后闲民不可派工（v0.4）
  return assignedTotal() < houseCap();
}
function assignWorker(b, d) {
  if (d > 0) {
    if (CONFIG.hardCapJobs && b.workers >= CONFIG.buildings[b.type].capacity) { pushLog('岗位已满'); return false; }
    if (idlePop() <= 0) { pushLog('闲民不足，无法上岗'); return false; }
    if (!canAssignWorkers()) { pushLog('住房不足：无房平民流落街头，不能上工（造民房）'); return false; }
  }
  if (d < 0 && b.workers <= 0) return false;
  b.workers += d;
  return true;
}
// ---- walker 系统（v0.3）：统一走路实体 ----
const WALKER_COLOR = { farm: '#7ec850', lumber: '#b08050', mine: '#9aa0aa', merchant: '#e0c060' }; // 农绿/伐木棕/矿灰/商人黄
function spawnWalker(kind, from, path, opts) {
  const w = Object.assign({ kind: kind, x: from.x, y: from.y, path: path, seg: 0, segT: 0,
    speed: CONFIG.walkSpeed, color: '#c9bd9e' }, opts || {});
  state.walkers.push(w);
  return w;
}
function stepWalkers(dtGameSec) { // dtGameSec：已乘倍速的游戏秒
  for (let i = state.walkers.length - 1; i >= 0; i--) {
    const w = state.walkers[i];
    let move = w.speed * dtGameSec;
    while (move > 0 && w.seg < w.path.length) {
      const tgt = w.path[w.seg];
      const dx = tgt.x - w.x, dy = tgt.y - w.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist <= move) { w.x = tgt.x; w.y = tgt.y; move -= dist; w.seg++; }
      else { w.x += (dx / dist) * move; w.y += (dy / dist) * move; move = 0; }
    }
    if (w.seg >= w.path.length) { // 到达
      state.walkers.splice(i, 1);
      if (w.onArrive) w.onArrive(w);
    }
  }
}
// ---- 产者自运（v0.3 核心重写）----
function buildingAt(bRef) { return state[bRef.zone === 'out' ? 'outGrid' : 'inGrid'][bRef.r] && gridOf(bRef.zone)[bRef.r][bRef.c]; }
function sameBuilding(b, bRef) { return b && bRef && b.type === bRef.type && gridOf(bRef.zone)[bRef.r][bRef.c] === b; }
function tryDispatchHaul(b, zone, r, c) { // 存量攒够一担 → 派 1 名在岗工人背回对应仓库
  if (zone !== 'out' || !b.workers || state.recalled) return;
  const total = Object.keys(b.stock).reduce(function (s, k) { return s + b.stock[k]; }, 0);
  if (total < CONFIG.carryLoad) return;
  // 并发限流：至少留 1 人在岗干活；在途趟数 ≤ 3（防满屏 walker）
  const onTrip = state.walkers.filter(function (w) { return w.kind === 'carry' && w.bRef && sameBuilding(b, w.bRef); }).length;
  if (b.workers <= 1 || onTrip >= 3) return;
  const wh = warehouseOf(Object.keys(b.stock).find(function (k) { return b.stock[k] >= CONFIG.carryLoad; }) || Object.keys(b.stock)[0]);
  if (!wh) return; // 无对应仓库（理论上有开局保底，防御）
  // 取 5 担（多物资按存量比例）
  const cargo = {};
  let left = CONFIG.carryLoad;
  const keys = Object.keys(b.stock).sort(function (a, b2) { return b.stock[b2] - b.stock[a]; });
  for (const k of keys) {
    const take = Math.min(b.stock[k], left);
    if (take > 0) { b.stock[k] -= take; cargo[k] = take; left -= take; }
  }
  const from = cellCenter(zone, r, c);
  const gate = nearestGate(from);
  const to = cellCenter(wh.zone, wh.r, wh.c);
  b.workers -= 1; // 抽 1 人背货（走路误工）
  const bRef = { zone: zone, r: r, c: c, type: b.type };
  const day = state.day;
  spawnWalker('carry', from, [{ x: gate.x, y: from.y }, gate, to], {
    color: WALKER_COLOR[b.type] || '#c9bd9e',
    cargo: cargo, bRef: bRef,
    onArrive: function (w) {
      // 入库才算玩家收入（v0.3.1：直接按产地记来源，废弃「先记其他再冲销」垫片——它会残留"其他 0"脏条目）
      const srcMap = { farm: '农田', lumber: '伐木场', mine: '矿洞' };
      LEDGER_SRC = srcMap[w.bRef.type] || '自运';
      Object.keys(w.cargo).forEach(function (k) { addRes(k, w.cargo[k]); });
      LEDGER_SRC = null;
      const b = gridOf(w.bRef.zone)[w.bRef.r][w.bRef.c];
      if (b && b.type === w.bRef.type && b.workers < CONFIG.buildings[b.type].capacity) {
        b.workers += 1; // 回岗继续干活（岗满则退回闲民池——离开期间被顶替）
      }
      // 建筑被拆/被烧或岗满：该工人自然回落闲民（不丢人）
    },
    day: day,
  });
}
// ---- 秒级实时 tick：产出累积 + 自运调度（v0.3）----
function tickWorld(dtGameSec) {
  const rate = dtGameSec / CONFIG.dayLengthSec; // 折算为「日比例」
  eachBuilding(function (b, zone) {
    const def = CONFIG.buildings[b.type];
    if (!def.capacity || !def.output) return;
    if (zone !== 'out') return; // 城内产线（工匠坊）仍走日结（耗料结算简单）
    if (state.recalled) return; // 收保中：城外停产（人员在途/已回城）
    const e = effOf(b);
    if (e <= 0) return;
    for (const k of Object.keys(def.output)) b.stock[k] = (b.stock[k] || 0) + def.output[k] * e * rate;
  });
  // 调度自运（每帧检查，已有限流：每产地同时最多 1 趟）
  eachBuilding(function (b, zone, r, c) { tryDispatchHaul(b, zone, r, c); });
  stepWalkers(dtGameSec);
}
// ---- 收保（v0.3：走路回城，到达变闲民；复工按记忆自动归岗）----
let recallMemo = []; // 撤离时的岗位记忆 {bRef, n}
function toggleRecall() {
  if (!state.recalled) {
    recallMemo = [];
    eachBuilding(function (b, zone, r, c) {
      if (zone !== 'out' || !b.workers) return;
      const from = cellCenter(zone, r, c), gate = nearestGate(from);
      const bRef = { zone: zone, r: r, c: c, type: b.type };
      recallMemo.push({ bRef: bRef, n: b.workers });
      const n = b.workers;
      b.workers = 0; // 停工撤人（walkers 在途占岗；到达城门变闲民）
      for (let i = 0; i < n; i++) {
        spawnWalker('recall', from, [{ x: gate.x, y: from.y }, gate], {
          color: WALKER_COLOR[b.type] || '#c9bd9e', bRef: bRef,
          onArrive: function () { /* 到达即闲民（workers 已清零，pop 不变） */ },
        });
      }
    });
    state.recalled = true;
    pushLog('【收保】城外平民停工撤离，步行回城（在途人员不可被劫杀）');
  } else {
    // 复工：按记忆派回（人员从闲民池按原岗位归位，缺额=伤亡所致不再补）
    let restored = 0;
    recallMemo.forEach(function (m) {
      const b = gridOf(m.bRef.zone)[m.bRef.r][m.bRef.c];
      if (!b || b.type !== m.bRef.type) return; // 建筑被拆/焚：岗位消失
      const n = Math.min(m.n, Math.max(0, getRes('pop') - assignedTotal() - restored)); // 闲民够才派
      if (n > 0) { b.workers += n; restored += n; }
    });
    state.recalled = false;
    pushLog('【复工】城外平民按原岗返工 ' + restored + ' 人（缺口需手动补岗）');
  }
  return true;
}
// 产出与运输（v0.3）：城外产线产出已移 tickWorld 秒级实时（不占日结）；
// 此处仅保留工匠坊日结（耗料结算简单、产出即时部署用）
dailySettlers.push(function workshopDaily(day) {
  const parts = [];
  eachBuilding(function (b, zone) {
    if (zone !== 'in' || b.type !== 'workshop') return;
    const e = effOf(b);
    if (e <= 0) return;
    const p = CONFIG.workshopProducts[b.product];
    let v = p.perDay * e;
    // 原料不足限产
    let factor = 1;
    for (const k of Object.keys(p.cost)) {
      const need = p.cost[k] * e;
      if (getRes(k) < need) factor = Math.min(factor, getRes(k) / need);
    }
    v *= factor;
    LEDGER_SRC = '工匠坊耗料';
    for (const k of Object.keys(p.cost)) addRes(k, -Math.round(p.cost[k] * e * factor));
    LEDGER_SRC = null;
    b.progress = (b.progress || 0) + v;
    const whole = Math.floor(b.progress);
    if (whole > 0) {
      b.progress -= whole;
      state.inv[b.product] += whole;
      parts.push('工匠坊产出 ' + p.label + '×' + whole + (factor < 1 ? '（原料不足限产）' : ''));
    } else if (factor < 1) {
      parts.push('工匠坊原料不足限产');
    }
  });
  if (parts.length) pushLog('产出：' + parts.join('；'));
});

// ============================ 商人与宵禁（改造④） ============================
function hireMerchant(b) {
  if (idlePop() <= 0) { b.merchant = false; pushLog('【市坊】闲民不足，暂无商人（停摆）'); return; }
  b.merchant = true;
  state.merchants += 1;
}
// 商税直入库（日结）+ 停摆市坊自动补员 + 驿站减半结算（v0.3 三态政策）
dailySettlers.push(function commerce(day) {
  let tax = 0;
  eachBuilding(function (b, zone) {
    if (b.type !== 'market') return;
    if (!b.merchant) hireMerchant(b); // 池子有人就自动补
    if (b.merchant) tax += CONFIG.marketTax;
  });
  if (state.innStay && tax > 0) {
    tax = Math.round(tax * CONFIG.innTaxFactor);
    pushLog('【驿站】商队昨夜宿驿站误早市，今日商税减半');
  }
  state.innStay = false;
  if (tax > 0) { LEDGER_SRC = '商税'; addRes('money', tax); LEDGER_SRC = null; pushLog('商税入库 钱+' + tax); }
});
// 宵禁（日结末位）：三态政策生效（v0.3）
//   open=常开：商队自动入城 + 夜赌事件；closed=常闭：商队夜宿驿站（次日税减半）；ask=每晚询问（默认）
dailySettlers.push(function curfew(day) {
  if (state.merchants <= 0) return;
  if (state.curfewPolicy === 'open') { resolveCurfew(true); return; }
  if (state.curfewPolicy === 'closed') { resolveCurfew(false); return; }
  queueDecision({ kind: 'curfew' });
});
function resolveCurfew(open) {
  if (open) {
    pushLog('【宵禁放行】商队入城');
    // 夜赌事件：开门才触发，关门绝对安全（用户拍板）
    const r = rand();
    if (r < CONFIG.nightFireP) {
      // 失火：烧随机一座建筑（豁免粮仓/货仓——保底运输线不断，v0.3 扩展）
      const targets = [];
      eachBuilding(function (b, zone, r2, c) { if (b.type !== 'granary' && b.type !== 'depot' && b.type !== 'house') targets.push({ zone: zone, r: r2, c: c }); });
      if (targets.length) {
        const t = targets[Math.floor(rand() * targets.length)];
        const b = gridOf(t.zone)[t.r][t.c];
        if (b.type === 'market' && b.merchant) state.merchants -= 1;
        gridOf(t.zone)[t.r][t.c] = null;
        pushLog('【夜赌·失火】' + CONFIG.buildings[b.type].label + ' 焚毁！');
      }
    } else if (r < CONFIG.nightFireP + CONFIG.nightTheftP) {
      const ml = Math.round(getRes('money') * CONFIG.nightTheftMoney);
      const gl = Math.round(getRes('grain') * CONFIG.nightTheftGrain);
      LEDGER_SRC = '夜赌失窃';
      addRes('money', -ml); addRes('grain', -gl);
      LEDGER_SRC = null;
      pushLog('【夜赌·偷盗】失窃 钱' + ml + ' 粮' + gl);
    } else {
      pushLog('一夜无事');
    }
  } else {
    // 常闭/不放行：商队夜宿城外驿站（固有设施，防匪不防军——骚扰日另算）
    state.innStay = true;
    pushLog('【宵禁】城门夜闭，商队宿于城外驿站（明日商税减半）');
  }
}

// ============================ 耗粮与饥荒（沿用，日结④） ============================
dailySettlers.push(function consume(day) {
  const pop = getRes('pop'), sol = getRes('soldiers');
  const need = pop * CONFIG.grainPerCapita + sol * CONFIG.grainPerCapita * CONFIG.soldierGrainMult;
  state.grainNeed = need;
  const eaten = Math.min(getRes('grain'), need);
  LEDGER_SRC = '口粮';
  addRes('grain', -eaten);
  LEDGER_SRC = null;
  const threshold = need * CONFIG.famineBufferDays;
  const wasFamine = state.famine;
  state.famine = getRes('grain') < threshold;
  if (state.famine && !wasFamine) pushLog('【饥荒】粮存不足 ' + CONFIG.famineBufferDays + ' 天（声望每日-' + CONFIG.faminePrestigeDrain + '）');
  if (!state.famine && wasFamine) pushLog('【饥荒解除】粮存回升');
  if (state.famine) addRes('prestige', -CONFIG.faminePrestigeDrain);
  if (eaten < need) {
    const dead = Math.min(pop, CONFIG.starvePopLoss);
    addRes('pop', -dead);
    pushLog('【断粮】口粮缺口 ' + (need - eaten) + '，饿死 ' + dead + ' 人！');
  }
});
// 军饷（日结⑤，沿用欠饷天数梯度）
dailySettlers.push(function pay(day) {
  const sol = getRes('soldiers');
  const need = sol * CONFIG.soldierPayPerDay;
  state.payNeed = need;
  if (sol <= 0) { state.unpaidDays = 0; return; }
  const paid = Math.min(getRes('money'), need);
  LEDGER_SRC = '军饷';
  addRes('money', -paid);
  LEDGER_SRC = null;
  if (paid >= need) {
    if (state.unpaidDays > 0) pushLog('【军饷补齐】军心回稳');
    state.unpaidDays = 0;
    return;
  }
  state.unpaidDays += 1;
  const rate = CONFIG.desertBase + CONFIG.desertPerDay * (state.unpaidDays - 1);
  const flee = Math.min(sol, Math.ceil(sol * rate));
  if (flee > 0) {
    state.deserters += flee;
    addRes('soldiers', -flee);
    pushLog('【欠饷】第 ' + state.unpaidDays + ' 日（缺 ' + Math.round(need - paid) + ' 钱）→ 逃兵 ' + flee + ' 人');
  }
});

// ============================ 兵营三营（改造⑤，日结⑥） ============================
const TYPE_LABEL = { melee: '步兵', archer: '弓兵', engineer: '工兵' };
function traineesOf(b, type) { // v0.3.1 分营：按兵种取在训列表
  return b.queue.filter(function (t) { return t.type === type; });
}
function sendTrainee(b, type) {
  // v0.3.1 分营：每营独立 capacity 席位，互不挤占（用户反馈：三种兵分别设置）
  const q = traineesOf(b, type);
  if (q.length >= CONFIG.buildings.barracks.capacity) { pushLog('【' + TYPE_LABEL[type] + '营】席位已满（每营各 ' + CONFIG.buildings.barracks.capacity + ' 席）'); return false; }
  if (idlePop() <= 0) { pushLog('闲民不足，无法送训'); return false; }
  b.queue.push({ left: CONFIG.trainingDays, type: type });
  b.workers = b.queue.length;
  pushLog('送训 1 人入【' + TYPE_LABEL[type] + '营】（' + CONFIG.trainingDays + ' 日成兵 · ' + (q.length + 1) + '/' + CONFIG.buildings.barracks.capacity + '）');
  return true;
}
function removeTrainee(b, type) {
  if (type !== undefined) { // v0.3.1 按兵种退训（退最晚入营者，无损：left 未减过的先退）
    for (let i = b.queue.length - 1; i >= 0; i--) {
      if (b.queue[i].type === type) { b.queue.splice(i, 1); b.workers = b.queue.length; return true; }
    }
    return false;
  }
  if (!b.queue.length) return false;
  b.queue.pop();
  b.workers = b.queue.length;
  return true;
}
function rushConscript(b) { // 提前出营：按已训天数折算熟练度
  const n = b.queue.length;
  if (!n) return false;
  b.queue.forEach(function (t) {
    const prof = CONFIG.trainProfPerDay * (CONFIG.trainingDays - t.left);
    state.troops.push({ prof: prof, seg: null, type: t.type });
  });
  setRes('soldiers', getRes('soldiers') + n);
  addRes('pop', -n);
  b.queue = [];
  b.workers = 0;
  pushLog('【提前出营】' + n + ' 人仓促成军（熟练度按已训天数折算）');
  return true;
}
dailySettlers.push(function train(day) {
  eachBuilding(function (b) {
    if (b.type !== 'barracks' || !b.queue.length) return;
    const grads = [];
    b.queue = b.queue.filter(function (t) { t.left -= 1; if (t.left > 0) return true; grads.push(t.type); return false; });
    b.workers = b.queue.length;
    if (grads.length > 0) {
      grads.forEach(function (type) { state.troops.push({ prof: CONFIG.trainProfPerDay * CONFIG.trainingDays, seg: null, type: type }); });
      setRes('soldiers', getRes('soldiers') + grads.length);
      addRes('pop', -grads.length);
      pushLog('训练完成：' + grads.length + ' 名新兵入伍（熟练度 80%）');
    }
  });
});

// ============================ 城墙布防（改造②⑤，檑木/火油/重弩部署） ============================
function troopsInSeg(s) {
  const arr = [];
  state.troops.forEach(function (t, i) { if (t.seg === s) arr.push(i); });
  return arr;
}
function reserveTroops() {
  const arr = [];
  state.troops.forEach(function (t, i) { if (t.seg === null || t.seg === undefined) arr.push(i); });
  return arr;
}
function soldierPower(prof) { return CONFIG.profPowerBase + CONFIG.profPowerSpan * (prof / 100); }
function segPower(s) {
  let p = 0;
  state.troops.forEach(function (t) { if (t.seg === s) p += soldierPower(t.prof); });
  return p;
}
function deployTroop(s, type) { // 按兵种上墙（取该兵种熟练度最高者）
  const pool = reserveTroops().filter(function (i) { return !type || state.troops[i].type === type; });
  if (!pool.length) { pushLog('无该兵种未布防兵'); return false; }
  let bi = pool[0];
  pool.forEach(function (i) { if (state.troops[i].prof > state.troops[bi].prof) bi = i; });
  state.troops[bi].seg = s;
  return true;
}
function withdrawTroop(s) {
  const seg = troopsInSeg(s);
  if (!seg.length) return false;
  let mi = seg[0];
  seg.forEach(function (i) { if (state.troops[i].prof < state.troops[mi].prof) mi = i; });
  state.troops[mi].seg = null;
  return true;
}
// 防御器械部署：从工匠坊库存部署到墙段（檑木≤2/火油≤2/重弩≤1），撤回入库
function deployGear(s, kind) {
  const caps = { log: CONFIG.wall.logMaxPerSeg, oil: CONFIG.wall.oilMaxPerSeg, crossbow: CONFIG.wall.xbowMaxPerSeg };
  const arr = { log: state.segLogs, oil: state.segOil, crossbow: state.segXbow }[kind];
  const names = { log: '檑木', oil: '火油', crossbow: '重弩' };
  if (state.inv[kind] <= 0) { pushLog(names[kind] + '库存不足（工匠坊生产）'); return false; }
  if (arr[s] >= caps[kind]) { pushLog('该墙段' + names[kind] + '已满'); return false; }
  state.inv[kind] -= 1;
  arr[s] += 1;
  return true;
}
function withdrawGear(s, kind) {
  const arr = { log: state.segLogs, oil: state.segOil, crossbow: state.segXbow }[kind];
  if (arr[s] <= 0) return false;
  arr[s] -= 1;
  state.inv[kind] += 1;
  return true;
}
// 修城门：土20木5 一次修满（用户定：土多木少）
function repairGate(seg) {
  if (state.gateHp[seg] >= gateMaxOf(seg)) { pushLog('城门完好'); return false; }
  if (getRes('soil') < CONFIG.gateRepairSoil) { pushLog('修门需土 ' + CONFIG.gateRepairSoil + '，不足'); return false; }
  if (getRes('wood') < CONFIG.gateRepairWood) { pushLog('修门需木 ' + CONFIG.gateRepairWood + '，不足'); return false; }
  LEDGER_SRC = '修门';
  addRes('soil', -CONFIG.gateRepairSoil);
  addRes('wood', -CONFIG.gateRepairWood);
  LEDGER_SRC = null;
  state.gateHp[seg] = CONFIG.gateMaxHp;
  pushLog('修缮【' + CONFIG.wall.segNames[seg] + '】段城门（土-' + CONFIG.gateRepairSoil + ' 木-' + CONFIG.gateRepairWood + '）');
  return true;
}

// ============================ 敌波次（改造⑥） ============================
function beaconCount() { return countBuilding('beacon'); }
function warnDays() { return CONFIG.raidWarnDays + (beaconCount() > 0 ? 1 : 0); }
function nextWave() {
  for (let i = 0; i < CONFIG.waves.length; i++) if (!state.waveFired[i]) return { idx: i, wave: CONFIG.waves[i] };
  return null;
}
// 波次构成（02 §1.2 兵种映射）
function composeWave(size, siege) {
  if (!siege) {
    return { rider: Math.ceil(size * 0.6), iron: Math.ceil(size * 0.25), crossbow: Math.floor(size * 0.15), infantry: 0, ram: 0, tower: 0 };
  }
  return {
    infantry: Math.round(size * 0.35), rider: Math.round(size * 0.2), crossbow: Math.round(size * 0.15), iron: Math.round(size * 0.1),
    ram: size >= 12 ? 2 : 1, tower: size >= 12 ? 2 : 1,
  };
}
function compPersonnel(c) { return c.rider + c.iron + c.crossbow + c.infantry; }
// 波次触发（日结末位）：骚扰 → 战前开/关门抉择；总攻 → 随机多门/猛攻一门（方向不预告）
dailySettlers.push(function waves(day) {
  for (let i = 0; i < CONFIG.waves.length; i++) {
    const w = CONFIG.waves[i];
    if (state.waveFired[i] || day < w.day) continue;
    state.waveFired[i] = true;
    if (w.siege) {
      pushLog('【总攻】匈奴主力压境！多门齐攻或猛攻一门，方向不明！');
      state.live.waveSize = w.size;
      // 第 4 步：实时战斗接管总攻（进战场即自动推近相机）；turnbased = 委托将领结算，
      // 供无头回归（playtest/trace）与「不想微操」的路径使用，两条路共用同一套回写口径。
      if (CONFIG.assaultMode === 'live') enterBattle(0);
      else beginAssault(w);
    } else {
      pushLog('【' + w.label + '】匈奴 ' + w.size + ' 骑犯边，在城外游弋劫掠！');
      state.enemies.push({ seg: null, n: w.size, siege: false, raid: true });
      queueDecision({ kind: 'gate', wave: w }); // 战前开/关门（骚扰期的门=核心决策）
    }
  }
});
// 预警（烽燧 +1 日）+ 声望红色预警（00-总纲 §5：显性化）+ 总攻规模情报（"塞上肥关，胡骑必至"）
dailySettlers.push(function raidWarning() {
  const nw = nextWave();
  if (nw && nw.wave.day - state.day <= warnDays() && nw.wave.day > state.day) {
    // 总攻规模情报：随声望升降（声望双刃剑显性化——玩家看得见"越富越危险"）
    let scaleHint = '探得虏情：';
    const p = getRes('prestige');
    if (nw.wave.siege) scaleHint += p >= 70 ? '「塞上肥关，胡骑必至」——虏酋大聚，此战必重（预估：大举）' : p >= 45 ? '虏骑渐聚，其势不小（预估：中势）' : '边鄙小关，虏志在掠而不在城（预估：常势）';
    else scaleHint += '游骑寇边，意在劫掠（预估：小股）';
    pushLog('【' + (beaconCount() > 0 ? '烽燧' : '瞭望') + '】' + nw.wave.day + ' 日将有' + (nw.wave.siege ? '【总攻】' : nw.wave.label) + '，速布防！' + scaleHint);
  }
  if (getRes('prestige') < CONFIG.prestigeWarnLine && !state.gameOver) {
    pushLog('【民心】声望濒危（' + getRes('prestige') + '/' + CONFIG.prestigeWarnLine + '）——再跌即散关！赈济、胜仗、护民皆可挽回');
  }
});

// ============================ 骚扰波结算（改造⑥：开/关门两端） ============================
function resolveRaid(wave, gateOpen) {
  const comp = composeWave(wave.size, false);
  const rep = { siege: false, label: wave.label, enemySize: wave.size, gateOpen: gateOpen, kills: 0, fled: 0,
    lootGrain: 0, lootMoney: 0, lootPop: 0, lootPrestige: 0, fieldRobbed: 0, fieldKilled: 0, beaconBurned: false, rounds: CONFIG.raidRounds };
  let pool = compPersonnel(comp) * CONFIG.enemyHp;
  let alive = compPersonnel(comp);
  // 城头反击：弓兵 + 重弩（工兵操作）全程抛射骚扰骑
  const archers = state.troops.filter(function (t) { return t.seg !== null && t.type === 'archer'; });
  const engineers = state.troops.filter(function (t) { return t.seg !== null && t.type === 'engineer'; });
  const xbows = state.segXbow.reduce(function (a, b) { return a + b; }, 0);
  for (let r = 1; r <= CONFIG.raidRounds && alive > 0; r++) {
    let dmg = 0;
    archers.forEach(function (t) { dmg += soldierPower(t.prof) * CONFIG.archerCoef; });
    dmg += Math.min(xbows, engineers.length * 2) * CONFIG.xbowDmg;
    pool -= dmg;
    const now = Math.max(0, Math.ceil(pool / CONFIG.enemyHp));
    rep.kills += alive - now;
    alive = now;
  }
  state.enemies = state.enemies.filter(function (e) { return !e.raid; });
  if (gateOpen) {
    // 开门：小股铁骑入城抢掠（单次上限：粮=库存10%、钱=15%，抢完即走）
    const raiders = Math.max(1, Math.ceil(comp.iron / 2));
    // 城内拦截结算（02 §4.1，2026-10-05 定案）：预备近战以逸待劳——K=min(⌊近战×I⌋,R)，只减损不刷兵
    const meleeReserve = state.troops.filter(function (t) { return t.seg === null && t.type === 'melee'; }).length; // 未上墙的近战=城内驻留
    const K = Math.min(Math.floor(meleeReserve * CONFIG.interceptCoef), raiders);
    rep.interceptKilled = K;
    if (K > 0) {
      const dead = Math.floor(K * CONFIG.interceptLoss); rep.interceptLoss = dead;
      for (let d = 0; d < dead; d++) { // 阵亡取熟练度最低者（新兵先死，沿用战场惯例）
        let mi = -1;
        state.troops.forEach(function (t, i) { if (t.seg === null && t.type === 'melee' && (mi < 0 || t.prof < state.troops[mi].prof)) mi = i; });
        if (mi >= 0) state.troops.splice(mi, 1);
      }
      if (dead > 0) { state.res.soldiers -= dead; addRes('pop', -dead); }
    }
    const relief = 1 - K / Math.max(raiders, 1); // 拦截减损系数
    rep.lootGrain = Math.round(Math.min(Math.round(getRes('grain') * CONFIG.raidLootGrainCap), raiders * CONFIG.raidLootGrainPerRider, getRes('grain')) * relief);
    rep.lootMoney = Math.round(Math.min(Math.round(getRes('money') * CONFIG.raidLootMoneyCap), raiders * CONFIG.raidLootMoneyPerRider, getRes('money')) * relief);
    rep.lootPop = Math.min(getRes('pop'), Math.round(Math.min(CONFIG.raidKillPopMax, raiders * CONFIG.raidKillPopPerRider) * relief));
    rep.lootPrestige = Math.max(0, Math.round(CONFIG.raidLootPrestige * relief));
    LEDGER_SRC = '匈奴抢掠';
    addRes('grain', -rep.lootGrain);
    addRes('money', -rep.lootMoney);
    addRes('pop', -rep.lootPop);
    addRes('prestige', -rep.lootPrestige);
    LEDGER_SRC = null;
    rep.kills += K; // 拦截击杀计入城头反击总数（声望账本可见收益）
  } else {
    // 关门：只扰城外——劫粮道（产地存量被抢）/ 杀城外暴露人口（收保=撤离在途不可杀）/ 烧烽燧
    eachBuilding(function (b, zone) {
      if (zone !== 'out') return;
      for (const k of Object.keys(b.stock)) {
        const rob = b.stock[k] * CONFIG.raidFieldRobRate;
        b.stock[k] -= rob;
        rep.fieldRobbed += rob;
      }
    });
    // 城外暴露人口：产线在岗工人 + 背货在途者（收保中=撤离路上，豁免）+ 常闭政策下宿驿站商人
    let outside = 0;
    eachBuilding(function (b, zone) { if (zone === 'out') outside += b.workers; });
    const carryWalkers = state.recalled ? [] : state.walkers.filter(function (w) { return w.kind === 'carry'; });
    outside += carryWalkers.length;
    if (state.curfewPolicy === 'closed') outside += state.merchants; // 驿站防匪不防军（01 §7 v0.4）
    rep.fieldKilled = Math.min(getRes('pop'), Math.round(outside * CONFIG.raidFieldKillRate));
    if (rep.fieldKilled > 0) {
      addRes('pop', -rep.fieldKilled);
      let left = rep.fieldKilled;
      eachBuilding(function (b, zone) {
        if (zone !== 'out' || left <= 0) return;
        const cut = Math.min(b.workers, left);
        b.workers -= cut; left -= cut;
      });
      // 背货者被杀：货随人劫走（02 v0.4）
      while (left > 0 && carryWalkers.length) {
        const w = carryWalkers.pop();
        const idx = state.walkers.indexOf(w);
        if (idx >= 0) state.walkers.splice(idx, 1);
        Object.keys(w.cargo).forEach(function (k) { rep.fieldRobbed += w.cargo[k]; });
        left--;
      }
      // 驿站商人被杀：市坊标记停摆待补员
      if (left > 0 && state.merchants > 0) {
        const kill = Math.min(state.merchants, left);
        state.merchants -= kill; left -= kill;
        let lk = kill;
        eachBuilding(function (b) { if (b.type === 'market' && b.merchant && lk > 0) { b.merchant = false; lk--; } });
      }
    }
    if (beaconCount() > 0) {
      outer: for (let r = 0; r < OUT.rows; r++) for (let c = 0; c < OUT.cols; c++) {
        if (state.outGrid[r][c] && state.outGrid[r][c].type === 'beacon') {
          state.outGrid[r][c] = null;
          rep.beaconBurned = true;
          break outer;
        }
      }
    }
  }
  // 全歼 → 俘虏；搏杀补熟练（存活 +3%，杀敌分摊 +0.5%）
  if (alive <= 0) {
    rep.captives = Math.ceil(wave.size * CONFIG.captiveRate);
    state.pendingCaptives += rep.captives;
  } else {
    rep.captives = 0;
  }
  const participants = archers.concat(engineers);
  if (participants.length) {
    const gain = CONFIG.profBattleSurvive + rep.kills * CONFIG.profPerKill / participants.length;
    participants.forEach(function (t) { t.prof = Math.min(100, t.prof + gain); });
  }
  state.battleReport = rep;
  state.paused = true;
  if (gateOpen) {
    pushLog('【劫掠】铁骑 ' + Math.max(1, Math.ceil(comp.iron / 2)) + ' 骑冲入城内：抢粮 ' + rep.lootGrain + '、钱 ' + rep.lootMoney + '、杀民 ' + rep.lootPop + '（声望-' + rep.lootPrestige + '）'
      + (rep.interceptKilled > 0 ? '；【城内拦截】预备队格杀 ' + rep.interceptKilled + ' 骑（我方阵亡 ' + (rep.interceptLoss || 0) + '）' : ''));
  } else {
    pushLog('【骚扰】关门固守：城外被劫存量 ' + Math.round(rep.fieldRobbed) + (rep.fieldKilled ? '、平民遇害 ' + rep.fieldKilled : '') + (rep.beaconBurned ? '、烽燧被焚' : ''));
  }
  if (rep.kills > 0) pushLog('城头反击歼敌 ' + rep.kills + '/' + wave.size + (rep.captives ? '，俘虏 ' + rep.captives : ''));
}

// ============================ 总攻结算（改造⑦⑧：续体式 + 决策点×3） ============================
function beginAssault(wave) {
  const comp = composeWave(wave.size, true);
  // 多门齐攻 or 猛攻一门（方向不预告，挂 P2①）
  let segs;
  if (rand() < CONFIG.assaultMultiP) {
    segs = [0, 1, 2, 3].map(function (s) {
      return { seg: s, comp: {
        infantry: Math.ceil(comp.infantry / 4), rider: Math.ceil(comp.rider / 4), crossbow: Math.ceil(comp.crossbow / 4), iron: Math.ceil(comp.iron / 4),
        ram: s < comp.ram ? 1 : 0, tower: s < comp.tower ? 1 : 0,
      } };
    });
  } else {
    const s = Math.floor(rand() * 4);
    segs = [{ seg: s, comp: comp }];
  }
  segs.forEach(function (sb) { state.enemies.push({ seg: sb.seg, n: compPersonnel(sb.comp) + sb.comp.ram + sb.comp.tower, siege: true }); });
  state.battle = { wave: wave, segs: segs, si: 0, ctx: null, reps: [], totalKills: 0, totalDead: 0, decisions: 0 };
  state.paused = true;
  startSegBattle();
}
function startSegBattle() {
  const B = state.battle;
  const sb = B.segs[B.si];
  B.ctx = { seg: sb.seg, comp: sb.comp, pool: compPersonnel(sb.comp) * CONFIG.enemyHp, alive: compPersonnel(sb.comp),
    ram: sb.comp.ram, tower: sb.comp.tower, round: 0, oilAsked: false, sortieAsked: false, blocked: false,
    kills: 0, dead: 0, gateDmg: 0, breached: false };
  stepBattle();
}
// 续体式结算：跑到需要决策就挂起（queueDecision），答完后 applyDecision 再调 stepBattle 续跑
function stepBattle() {
  const B = state.battle, ctx = B.ctx;
  const engines = function () { return ctx.ram + ctx.tower; };
  while (true) {
    // 决策点①：敌器械进入火油射程 → 倒火油？（耗已部署火油 1 份）
    // 切片纪律：全战斗决策点 ≤3（04 v0.2 §5）——多门齐攻时共用预算，耗尽自动保守处置
    if (!ctx.oilAsked) {
      ctx.oilAsked = true;
      if (engines() > 0 && state.segOil[ctx.seg] > 0 && B.decisions < 3) {
        B.decisions++;
        queueDecision({ kind: 'oil', seg: ctx.seg });
        return;
      }
    }
    // 决策点②：器械存活且压制墙段 → 出城拆除？（会被铁骑截杀——两步决策）
    if (!ctx.sortieAsked) {
      ctx.sortieAsked = true;
      if (engines() > 0 && B.decisions < 3) {
        B.decisions++;
        queueDecision({ kind: 'sortie', seg: ctx.seg });
        return;
      }
    }
    // 轮次循环
    while (ctx.round < CONFIG.siegeRounds && (ctx.alive > 0 || engines() > 0)) {
      ctx.round++;
      // ① 弓齐射（对人员全伤，对器械 ×0.1 刮痧）
      let dmg = 0, engDmg = 0;
      state.troops.forEach(function (t) {
        if (t.seg === ctx.seg && t.type === 'archer') { dmg += soldierPower(t.prof) * CONFIG.archerCoef; engDmg += soldierPower(t.prof) * CONFIG.archerCoef * CONFIG.arrowVsEngine; }
      });
      // ② 重弩（工兵操作，1 人至多 2 架；对器械 ×0.3）
      const engOnSeg = state.troops.filter(function (t) { return t.seg === ctx.seg && t.type === 'engineer'; }).length;
      const xb = Math.min(state.segXbow[ctx.seg], engOnSeg * 2);
      dmg += xb * CONFIG.xbowDmg;
      engDmg += xb * CONFIG.xbowDmg * CONFIG.xbowVsEngine;
      // ③ 檑木（工兵操作才滚得动；对器械 ×2 优先砸器械）
      if (engOnSeg > 0) engDmg += state.segLogs[ctx.seg] * CONFIG.logDmg * CONFIG.logVsEngine;
      // 结算伤害：器械先吃 engDmg（冲车先碎）
      while (engDmg > 0 && ctx.ram > 0) { engDmg -= CONFIG.ramHp; if (engDmg >= 0) { ctx.ram--; ctx.kills++; } }
      if (engDmg > 0) {
        while (engDmg > 0 && ctx.tower > 0) { engDmg -= CONFIG.towerHp; if (engDmg >= 0) { ctx.tower--; ctx.kills++; } }
      }
      // 火油持续灼伤（上轮的点燃余波）
      if (ctx.oilDotPending) { engDmg = ctx.oilDotPending; ctx.oilDotPending = 0;
        while (engDmg > 0 && ctx.ram > 0) { engDmg -= CONFIG.ramHp; if (engDmg >= 0) { ctx.ram--; ctx.kills++; } }
        while (engDmg > 0 && ctx.tower > 0) { engDmg -= CONFIG.towerHp; if (engDmg >= 0) { ctx.tower--; ctx.kills++; } }
      }
      // 人员伤害
      ctx.pool -= dmg;
      const now = Math.max(0, Math.ceil(ctx.pool / CONFIG.enemyHp));
      ctx.kills += ctx.alive - now;
      ctx.alive = now;
      if (ctx.alive <= 0 && engines() <= 0) break;
      // ④ 敌行动
      const gateBroken = state.gateHp[ctx.seg] <= 0;
      if (!gateBroken) {
        // 冲车撞门
        if (ctx.ram > 0) {
          const gd = ctx.ram * CONFIG.ramGateDmg;
          state.gateHp[ctx.seg] = Math.max(0, state.gateHp[ctx.seg] - gd);
          ctx.gateDmg += gd;
        }
        // 步兵蚁附撞门（无冲车时）
        if (ctx.ram <= 0 && ctx.comp.infantry > 0 && ctx.alive > 0) {
          const gd = Math.ceil(ctx.alive / 2);
          state.gateHp[ctx.seg] = Math.max(0, state.gateHp[ctx.seg] - gd);
          ctx.gateDmg += gd;
        }
      }
      // 井阑点杀城头（最低熟练先死）
      for (let t2 = 0; t2 < ctx.tower; t2++) {
        if (rand() < CONFIG.towerKillP) killSegTroop(ctx.seg, ctx);
      }
      // 门破：步兵涌入 vs 近战堵门互搏
      if (state.gateHp[ctx.seg] <= 0 && ctx.alive > 0) {
        // 决策点③：堵门洞？（步兵堵门=最后窗口；不堵=匈奴涌入判败）
        if (!ctx.blocked) {
          const meleeAvail = state.troops.some(function (t) { return t.seg === ctx.seg && t.type === 'melee'; }) || reserveTroops().length > 0;
          if (meleeAvail && B.decisions < 3) {
            B.decisions++;
            queueDecision({ kind: 'block', seg: ctx.seg });
            return;
          }
          if (meleeAvail) {
            // 决策预算耗尽：将士自发堵门（理性默认），不弹窗
            ctx.blocked = true;
            const res2 = reserveTroops();
            res2.forEach(function (i) { if (state.troops[i].type === 'melee') state.troops[i].seg = ctx.seg; });
            pushLog('【堵门洞】' + CONFIG.wall.segNames[ctx.seg] + '段将士自发以血肉塞门！');
          } else {
            // 无兵可堵 → 直接涌入
            floodDefeat(ctx);
            return;
          }
        }
        // 已堵门：互搏（近战输出杀敌，敌杀近战）
        let mdmg = 0;
        const meleeIdx = [];
        state.troops.forEach(function (t, i) { if (t.seg === ctx.seg && t.type === 'melee') meleeIdx.push(i); });
        meleeIdx.forEach(function (i) { mdmg += soldierPower(state.troops[i].prof) * CONFIG.meleeCoef; });
        ctx.pool -= mdmg;
        const now2 = Math.max(0, Math.ceil(ctx.pool / CONFIG.enemyHp));
        ctx.kills += ctx.alive - now2;
        ctx.alive = now2;
        const dead = Math.min(meleeIdx.length, Math.floor(ctx.alive * CONFIG.infantryMeleeCoef));
        for (let d = 0; d < dead; d++) killSegTroop(ctx.seg, ctx, 'melee');
      }
      if (ctx.alive <= 0 && engines() <= 0) break;
    }
    // 本段打完
    finishSegBattle();
    if (!state.battle) return; // 全部打完（或判败）
    if (state.battle.si >= state.battle.segs.length) return;
    if (state.pendingDecision) return;
    // 继续下一段
  }
}
function killSegTroop(seg, ctx, onlyType) {
  let mi = -1;
  state.troops.forEach(function (t, i) {
    if (t.seg !== seg) return;
    if (onlyType && t.type !== onlyType) return;
    if (mi < 0 || t.prof < state.troops[mi].prof) mi = i;
  });
  if (mi < 0) return;
  state.troops.splice(mi, 1);
  state.res.soldiers -= 1;
  ctx.dead++;
  addRes('pop', -1); // 战死=永久减人口
}
function floodDefeat(ctx) {
  state.battle = null;
  state.enemies = [];
  state.gameOver = { win: false, reason: '匈奴涌入城内', detail: CONFIG.wall.segNames[ctx.seg] + '段门破无人堵洞，胡骑涌入，关隘陷落。' };
  state.paused = true;
  pushLog('【败局】' + CONFIG.wall.segNames[ctx.seg] + '段门破，匈奴涌入城内！');
}
function finishSegBattle() {
  const B = state.battle, ctx = B.ctx;
  B.reps.push({ seg: ctx.seg, kills: ctx.kills, dead: ctx.dead, gateDmg: ctx.gateDmg, rounds: ctx.round });
  B.totalKills += ctx.kills;
  B.totalDead += ctx.dead;
  state.enemies = state.enemies.filter(function (e) { return e.seg !== ctx.seg; });
  B.si++;
  if (B.si < B.segs.length) { startSegBattle(); return; }
  // 全线打完：胜负判定
  const wave = B.wave;
  const rep = { siege: true, label: '总攻', enemySize: wave.size, kills: B.totalKills, dead: B.totalDead, segs: B.reps, captives: 0 };
  state.battle = null;
  // 搏杀补熟练：存活 +3%，杀敌分摊 +0.5%（器械击杀归操作工兵——P2⑥占位）
  const participants = state.troops.filter(function (t) { return t.seg !== null; });
  if (participants.length) {
    const gain = CONFIG.profBattleSurvive + rep.kills * CONFIG.profPerKill / participants.length;
    participants.forEach(function (t) { t.prof = Math.min(100, t.prof + gain); });
  }
  // 全歼 → 俘虏
  if (rep.kills >= rep.enemySize * 0.9) {
    rep.captives = Math.ceil(wave.size * CONFIG.captiveRate);
    state.pendingCaptives += rep.captives;
  }
  addRes('prestige', CONFIG.assaultWinPrestige); // 打退总攻
  state.battleReport = rep;
  state.paused = true;
  pushLog('【大捷】总攻退去！歼敌 ' + rep.kills + '，我方殉国 ' + rep.dead + '（声望+' + CONFIG.assaultWinPrestige + '）');
  // 胜利判定：守过总攻且声望达标
  if (!state.gameOver) {
    if (getRes('prestige') >= CONFIG.winPrestige) {
      state.gameOver = { win: true, reason: '守过总攻', detail: '塞上雄关屹立，胡骑远遁。声望 ' + getRes('prestige') + ' ≥ ' + CONFIG.winPrestige + '。' };
    } else {
      state.gameOver = { win: false, reason: '声望不逮', detail: '城虽守住，声望 ' + getRes('prestige') + ' < ' + CONFIG.winPrestige + '，朝廷问罪夺关。' };
    }
  }
}
// 决策应用（战斗中三决策点 + 骚扰开/关门 + 宵禁 + 皇帝任务）
function applyDecision(d, choice) {
  if (d.kind === 'curfew') { resolveCurfew(choice); return; }
  if (d.kind === 'emperor') {
    if (choice && state.task) {
      state.task.accepted = true;
      pushLog('【接旨】' + taskText(state.task) + '，' + CONFIG.taskDueDays + ' 日内缴清');
    } else if (state.task) {
      pushLog('【辞旨】此番摊派无力承担，推了（不接无罚）');
      state.task = null;
      state.nextTaskDay = state.day + CONFIG.taskEvery;
    }
    return;
  }
  if (d.kind === 'gate') {
    state.gateOpen = choice;
    resolveRaid(d.wave, choice);
    return;
  }
  // 战中决策点（stepBattle 续跑）
  const B = state.battle;
  if (!B || !B.ctx) return;
  const ctx = B.ctx;
  if (d.kind === 'oil') {
    if (choice && state.segOil[ctx.seg] > 0) {
      state.segOil[ctx.seg] -= 1;
      let burned = 0;
      if (ctx.ram > 0 && rand() < CONFIG.oilKillP) { ctx.ram--; burned++; ctx.kills++; }
      if (ctx.tower > 0 && rand() < CONFIG.oilKillP) { ctx.tower--; burned++; ctx.kills++; }
      ctx.oilDotPending = CONFIG.oilDot; // 未点燃的持续灼伤次轮结算
      pushLog('【倒火油】' + CONFIG.wall.segNames[ctx.seg] + '段城头烈焰倾盆' + (burned ? '，烧毁器械 ' + burned + ' 台！' : '，敌器械带伤续行'));
    } else {
      pushLog('保留火油（' + CONFIG.wall.segNames[ctx.seg] + '段）');
    }
    stepBattle();
    return;
  }
  if (d.kind === 'sortie') {
    if (choice) {
      // 出城拆除：步/工兵出城，每台器械 p 拆除；按当场铁骑/游骑存活比例折损
      const sortieIdx = [];
      state.troops.forEach(function (t, i) { if (t.seg === ctx.seg && (t.type === 'melee' || t.type === 'engineer')) sortieIdx.push(i); });
      let destroyed = 0;
      while (ctx.ram > 0 && rand() < CONFIG.sortieKillP) { ctx.ram--; destroyed++; ctx.kills++; }
      while (ctx.tower > 0 && rand() < CONFIG.sortieKillP) { ctx.tower--; destroyed++; ctx.kills++; }
      const loss = Math.min(sortieIdx.length, Math.round(ctx.comp.iron * CONFIG.sortieIronLoss + ctx.comp.rider * CONFIG.sortieRiderLoss));
      for (let i = 0; i < loss; i++) killSegTroop(ctx.seg, ctx);
      pushLog('【出城拆除】拆毁器械 ' + destroyed + ' 台，出城将士折损 ' + loss + ' 人（遭铁骑截杀）');
    } else {
      pushLog('按兵不出（器械持续压制）');
    }
    stepBattle();
    return;
  }
  if (d.kind === 'block') {
    if (choice) {
      ctx.blocked = true;
      // 堵门洞：未布防近战/任意兵补位到该段
      const res = reserveTroops();
      res.forEach(function (i) { if (state.troops[i].type === 'melee') state.troops[i].seg = ctx.seg; });
      pushLog('【堵门洞】' + CONFIG.wall.segNames[ctx.seg] + '段将士以血肉塞门，战局继续！');
      stepBattle();
    } else {
      floodDefeat(ctx);
    }
    return;
  }
}

// ============================ 皇帝任务（改造⑨，最简版） ============================
function taskText(t) {
  return '朝廷征 ' + (t.kind === 'grain' ? '军粮 ' + t.amount : '税钱 ' + t.amount);
}
dailySettlers.push(function emperor(day) {
  // 到期判定（接了的任务）
  if (state.task && state.task.accepted && day >= state.task.due) {
    const t = state.task;
    if (getRes(t.kind) >= t.amount) {
      LEDGER_SRC = '皇帝任务';
      addRes(t.kind, -t.amount);
      addRes('money', CONFIG.taskRewardMoney);
      LEDGER_SRC = null;
      addRes('political', CONFIG.taskRewardPolitical);
      pushLog('【缴旨】' + taskText(t) + ' 如数上缴 → 钱+' + CONFIG.taskRewardMoney + ' 政+' + CONFIG.taskRewardPolitical);
    } else {
      addRes('prestige', -CONFIG.taskFailPrestige);
      pushLog('【误期】' + taskText(t) + ' 未能缴清，声望-' + CONFIG.taskFailPrestige + '（失败惩罚占位，细则挂账）');
    }
    state.task = null;
    state.nextTaskDay = day + CONFIG.taskEvery;
  }
  // 新任务下发
  if (!state.task && day >= state.nextTaskDay) {
    const kind = (day / CONFIG.taskEvery) % 2 === 0 ? 'grain' : 'money';
    state.task = { kind: kind, amount: CONFIG.taskAmounts[kind], due: day + CONFIG.taskDueDays, accepted: false };
    queueDecision({ kind: 'emperor' });
  }
});
// 流民来投（沿用阈值驱动，日结）+ 住房软上限提示（v0.4）
dailySettlers.push(function refugees(day) {
  if (state.famine || state.gameOver) return;
  if (getRes('grain') < state.grainNeed * CONFIG.famineBufferDays) return; // 粮存不过 3 天线，流民不来
  const p = getRes('prestige');
  // 低速流入：一级隔日 +1、二级每日 +1（占位，自平衡靠粮闸与饥荒）
  const n = p >= CONFIG.refugeePrestige2 ? 1 : (p >= CONFIG.refugeePrestige1 && day % 2 === 0 ? 1 : 0);
  if (n > 0) {
    addRes('pop', n);
    if (getRes('pop') > houseCap()) {
      pushLog('【流民来投】' + n + ' 户流民来投，但住房不足——新户流落街头（耗粮不可上工，速造民房）');
    } else {
      pushLog('【流民来投】' + n + ' 户流民慕名来投（声望 ' + p + '）');
    }
  }
});
// 俘虏逐日判定（沿用模块12）
dailySettlers.push(function captivesDaily(day) {
  if (state.captives <= 0) return;
  let conv = 0, esc = 0;
  for (let i = 0; i < state.captives; i++) {
    const r = rand();
    if (r < CONFIG.captiveConvertRate) conv++;
    else if (r < CONFIG.captiveConvertRate + CONFIG.captiveEscapeRate) esc++;
  }
  state.captives -= conv + esc;
  if (conv > 0) addRes('pop', conv);
  if (conv + esc > 0) pushLog('俘虏营：' + (conv ? conv + ' 人归化' : '') + (esc ? esc + ' 人逃跑' : '') + '（在押余 ' + state.captives + '）');
});
function executeCaptives() {
  const n = state.pendingCaptives;
  if (!n) return false;
  addRes('prestige', -n * CONFIG.captiveKillPrestige);
  state.pendingCaptives = 0;
  state.paused = false;
  pushLog('【处置】处决俘虏 ' + n + ' 人（声望 -' + (n * CONFIG.captiveKillPrestige) + '）');
  return true;
}
function imprisonCaptives() {
  const n = state.pendingCaptives;
  if (!n) return false;
  state.captives += n;
  state.pendingCaptives = 0;
  state.paused = false;
  pushLog('【处置】关押俘虏 ' + n + ' 人');
  return true;
}
// 种子随机（mulberry32）
function rand() {
  state.rngState |= 0;
  state.rngState = (state.rngState + 0x6D2B79F5) | 0;
  let t = Math.imul(state.rngState ^ (state.rngState >>> 15), 1 | state.rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ============================ 决策队列 ============================
// AUTO：无头回归自动应答（smoke.js 设置），浏览器为 null 走弹窗
let AUTO = null;
function queueDecision(d) {
  state.decisionQueue.push(d);
  processDecisions();
}
function processDecisions() {
  if (state.pendingDecision || !state.decisionQueue.length) return;
  const d = state.decisionQueue[0];
  if (AUTO && AUTO[d.kind] !== undefined) {
    state.decisionQueue.shift();
    applyDecision(d, AUTO[d.kind]);
    return;
  }
  state.pendingDecision = d;
  state.paused = true;
}
function answerDecision(choice) {
  const d = state.pendingDecision;
  if (!d) return;
  state.pendingDecision = null;
  state.decisionQueue.shift();
  applyDecision(d, choice);
  if (!state.pendingDecision && !state.battleReport && state.pendingCaptives <= 0 && !state.gameOver) state.paused = false;
}

// ============================ 实时战斗层接入（08 §6 第 4 步：接口结算） ============================
// 接口方向 ①经营→战斗（战前快照）：兵员/熟练度/门耐久/重弩架数；
//         ②战斗→经营（战后回写）：伤亡(永久人口)/熟练度/声望/门耐久/器械消耗/设施损毁/战利品。
// 纪律：每个换算都要能回答「凭什么」——折算比例、声望口径、材料价一律进 CONFIG，不埋在逻辑里。
// 对账断言见 settle-smoke.js（信号 A：快照→战斗→回写全程守恒）。
function gateMaxOf(seg) { // 门耐久上限按段取：便门 9 < 正门 12（02 §3.1 定案）
  const s = CONFIG.map.segs[seg];
  return (s && s.maxHp) || CONFIG.gateMaxHp;
}
function killTroopsOfType(type, n) { // 战死=永久减人口；熟练度最低者先死（与 killSegTroop 同口径）
  for (let i = 0; i < n; i++) {
    let mi = -1;
    state.troops.forEach(function (t, j) { if (t.type !== type) return; if (mi < 0 || t.prof < state.troops[mi].prof) mi = j; });
    if (mi < 0) return;
    state.troops.splice(mi, 1);
    state.res.soldiers -= 1;   // 直接改计数：setRes('soldiers') 会补新兵，绕开
    addRes('pop', -1);
  }
}
function takeEconSnapshot(waveSize) { // 战前快照：对账基准 + 战后归因链素材
  const byType = { melee: 0, archer: 0, engineer: 0 };
  state.troops.forEach(function (t) { byType[t.type] = (byType[t.type] || 0) + 1; });
  const teamMax = { melee: 0, archer: 0, engineer: 0 };
  battleSnapshot().forEach(function (sn) { // 战斗编队人数 = 折算分母（甲/乙两步兵合并计）
    teamMax[Battle.RTS_CONFIG.player.teams[sn.id].type] += sn.n;
  });
  let ps = 0;
  state.troops.forEach(function (t) { ps += t.prof; });
  let inB = 0;
  eachBuilding(function (b, zone) { if (zone === 'in') inB++; });
  return {
    day: state.day, enemySize: waveSize || 0,
    pop: getRes('pop'), soldiers: getRes('soldiers'), prestige: getRes('prestige'),
    res: { grain: getRes('grain'), wood: getRes('wood'), soil: getRes('soil'), iron: getRes('iron'), money: getRes('money') },
    troops: byType, teamMax: teamMax,
    profAvg: state.troops.length ? Math.round(ps / state.troops.length) : 0,
    gateHp: state.gateHp.slice(), inv: Object.assign({}, state.inv),
    deployed: { log: state.segLogs.reduce(function (a, b) { return a + b; }, 0),
      oil: state.segOil.reduce(function (a, b) { return a + b; }, 0),
      xbow: state.segXbow.reduce(function (a, b) { return a + b; }, 0) },
    inBuildings: inB,
  };
}
function demolishRandomInCity() { // 入城敌波及：焚毁一座城内建筑（仓豁免——与夜赌失火同口径）
  const list = [];
  eachBuilding(function (b, zone, r, c) {
    if (zone === 'in' && b.type !== 'granary' && b.type !== 'depot') list.push({ r: r, c: c, type: b.type });
  });
  if (!list.length) return false;
  const it = list[Math.floor(rand() * list.length)];
  state.inGrid[it.r][it.c] = null;
  pushLog('【城破波及】' + CONFIG.buildings[it.type].label + ' 被入城胡骑焚毁');
  return true;
}
function battleSnapshot() {
  const pool = { melee: [], archer: [], engineer: [] };
  state.troops.forEach(function (t) { if (pool[t.type]) pool[t.type].push(t); });
  const avgProf = function (arr, dft) {
    return arr.length ? Math.round(arr.reduce(function (s, t) { return s + t.prof; }, 0) / arr.length) : dft;
  };
  // 编制系数：以 55 兵（15+15+15+10）为满编基准，±倍率钳在 [0.4, 1.6]
  const k = Math.max(0.4, Math.min(1.6, state.troops.length / 55));
  return Battle.RTS_CONFIG.player.teams.map(function (base) {
    const arr = base.type === 'melee' ? pool.melee : (base.type === 'archer' ? pool.archer : pool.engineer);
    const n = Math.max(3, Math.round((base.type === 'engineer' ? 10 : 15) * k));
    return { id: base.id, n: n, prof: avgProf(arr, base.prof) };
  });
}
// 战中技能走经营库存，不是战斗层的免费技能——檑木/火油扣**该墙段已部署**的存货，
// 修门扣土木。设计意图：备战时「器械放哪一段」会在开战后兑现成"哪一段才有得砸"（支柱 3）。
function skillWallSeg() { // 选中部队所在的墙段（器械从该段扣）
  const sel = Battle.S.teams.filter(function (t) { return !t.dead && Battle.isSelected(t.id) && t.onWall; });
  if (!sel.length) return null;
  const t = sel[0];
  const wy = t.wallSide === 'north' ? MAP.city.y : MAP.city.y + MAP.city.h;
  return wallSegAt(t.x, wy);
}
function useBattleSkill(kind, x, y) {
  if (!state.live.active || !state.live.skillUse) return false; // 只在战斗中生效，经营期调用无效
  if (kind === 'volley') return Battle.trySkill('volley', x, y); // 齐射是战术不是物资（装填真空已是代价）
  if (kind === 'log' || kind === 'oil') {
    const seg = skillWallSeg();
    if (seg === null) { pushLog((kind === 'log' ? '檑木' : '火油') + '需选中**城头部队**才能投放'); return false; }
    const arr = kind === 'log' ? state.segLogs : state.segOil;
    if (arr[seg] <= 0) {
      pushLog((kind === 'log' ? '檑木' : '火油') + '已用尽——' + CONFIG.wall.segNames[seg] + '段无存（备战时把器械放对段）');
      return false;
    }
    if (!Battle.trySkill(kind, x, y)) return false; // 冷却/条件不满足：不扣库存
    arr[seg] -= 1;
    state.live.skillUse[kind] += 1;
    pushLog('【' + (kind === 'log' ? '檑木' : '火油') + '】' + CONFIG.wall.segNames[seg] + '段投放（余 ' + arr[seg] + '）');
    return true;
  }
  if (kind === 'repair') {
    if (getRes('soil') < CONFIG.gateRepairSoil || getRes('wood') < CONFIG.gateRepairWood) {
      pushLog('抢修需土' + CONFIG.gateRepairSoil + ' 木' + CONFIG.gateRepairWood + '，材料不足');
      return false;
    }
    if (!Battle.trySkill('repair', x, y)) return false;
    LEDGER_SRC = '修门';
    addRes('soil', -CONFIG.gateRepairSoil);
    addRes('wood', -CONFIG.gateRepairWood);
    LEDGER_SRC = null;
    state.live.skillUse.repair += 1;
    pushLog('【抢修】城门加固（土-' + CONFIG.gateRepairSoil + ' 木-' + CONFIG.gateRepairWood + '）');
    return true;
  }
  return false;
}
function enterBattle(focusSeg) {
  if (state.live.settled) { pushLog('总攻已结算，战事不可重来（败局面板可读档重打）'); return false; } // 防刷新结果
  state.live.pre = takeEconSnapshot(state.live.waveSize); // 战前快照：对账基准 + 归因链素材
  state.live.active = true;
  state.live.result = null;
  state.live.skillUse = { log: 0, oil: 0, repair: 0 };
  state.live.focusSeg = focusSeg === undefined ? 0 : focusSeg;
  state.live.pendingCam = true; // 让主循环推近一次（推近后玩家可自由 Z/X，不再强制）
  state.paused = true;          // 经营时钟停摆（战斗期冻结，08 §3）
  Battle.reset((state.day * 7919 + 20261005) % 2147483647);
  battleSnapshot().forEach(function (sn) { // ① 兵员/熟练度：快照直通（人数/熟练度来自经营）
    const t = Battle.S.teams[sn.id];
    if (!t) return;
    t.n = sn.n; t.maxN = sn.n; t.prof = sn.prof;
  });
  Battle.GATES.forEach(function (g) { // ② 门耐久：经营 → 战斗（备战期攒的门血带进战场）
    const hp = Math.max(0, Math.min(g.maxHp, state.gateHp[g.seg]));
    g.hp = hp; g.broken = hp <= 0;
    if (g.broken && Battle.S.brokenGates.indexOf(g) < 0) Battle.S.brokenGates.push(g);
  });
  Battle.RTS_CONFIG.player.xbows = Math.max(1, state.live.pre.deployed.xbow); // ③ 重弩架数=已部署数（布防后果）
  Battle.setPaused(true); // 开战前先停：看清局势再开打（暂停中可下令——02 定调）
  pushLog('【战场】总攻已至——空格开战（暂停中仍可下令） · 1~4 技能 · 右键移动 · 点墙线上墙');
}
function exitBattle() {
  const S = Battle.S;
  state.live.active = false;
  state.live.result = S.gameOver
    ? { win: S.gameOver.win, reason: S.gameOver.reason, ops: S.ops, kills: Object.assign({}, S.killsByType) }
    : null;
  if (S.gameOver) { settleLiveBattle(); state.live.settled = true; } // 第 4 步：战斗 → 经营回写 + 锁死重打
  else pushLog('退出战场（未分胜负——总攻未决不可撤离）');
  state.paused = true; // 回到经营时先停住，让玩家消化战况
}
function armBattle(focusSeg) { // 兼容入口（第 3 步 B 键）：标记可进战场（相机由 ui 主循环推近一次）
  state.live.armed = true;
  state.live.focusSeg = focusSeg === undefined ? 0 : focusSeg;
}

// ============================ 战后回写（08 §4.2 战斗 → 经营） ============================
// 顺序：门耐久 → 伤亡 → 熟练度 → 设施损毁 → 声望/俘虏/战利品 → 战报+归因链 → 胜负判定。
// 守恒要求（信号 A）：回写后 pop/soldiers 的减少必须等于战报里的殉国数；门耐久等于战斗层 GATES；
// 物资变动只来自「战中消耗」（修门材料），其余一项不动。settle-smoke.js 逐条断言。
function settleLiveBattle() {
  const S = Battle.S, pre = state.live.pre || takeEconSnapshot(0);
  const use = state.live.skillUse || { log: 0, oil: 0, repair: 0 };
  const win = !!(S.gameOver && S.gameOver.win);
  let kills = 0;
  Object.keys(S.killsByType).forEach(function (k) { kills += S.killsByType[k] || 0; });

  // ① 门耐久：战斗层是门血的唯一真相源（修门账单由玩家次日自行支付，不代扣）
  const gateLines = [];
  Battle.GATES.forEach(function (g) {
    const before = pre.gateHp[g.seg];
    const after = g.broken ? 0 : Math.max(0, Math.min(gateMaxOf(g.seg), Math.round(g.hp)));
    state.gateHp[g.seg] = after;
    gateLines.push({ seg: g.seg, before: before, after: after, broken: g.broken });
  });
  const brokenN = S.brokenGates.length;

  // ② 伤亡：战斗队按兵种「死伤率」折回经营（战斗编队是经营的抽样，比例才是可迁移的量）
  const deadByType = { melee: 0, archer: 0, engineer: 0 };
  S.teams.forEach(function (t) { deadByType[t.type] += Math.max(0, t.maxN - t.n); });
  const dead = {}, dt = {};
  let deadTotal = 0;
  Object.keys(deadByType).forEach(function (type) {
    const pool = pre.troops[type] || 0, teamMax = pre.teamMax[type] || 0;
    let d = teamMax > 0 ? Math.round(pool * deadByType[type] / teamMax) : 0;
    // 有兵有伤亡 → 至少 1（否则战斗伤亡不落到经营 = 接口漂移，信号 A 直接判失败）
    if (pool > 0 && deadByType[type] > 0) d = Math.min(pool, Math.max(1, d));
    dt[type] = d; dead[type] = d; deadTotal += d;
    killTroopsOfType(type, d);
  });

  // ③ 熟练度：参战存活者 +3%、杀敌按人头分摊 +0.5%（与回合制 finishSegBattle 同公式）
  let profGain = 0;
  if (state.troops.length > 0) {
    profGain = CONFIG.profBattleSurvive + kills * CONFIG.profPerKill / state.troops.length;
    state.troops.forEach(function (t) { t.prof = Math.min(100, t.prof + profGain); });
  }

  // ④ 设施损毁：入城敌波及（败局不结算——城已陷，无"重建"语境）
  let demolished = 0;
  if (win) {
    for (let i = 0; i < S.peakInside; i++) if (rand() < CONFIG.invaderDemolishP && demolishRandomInCity()) demolished++;
  }

  // ⑤ 声望 / 俘虏 / 战利品
  let prestige = 0, captives = 0, loot = 0;
  if (win) {
    prestige = CONFIG.assaultWinPrestige - brokenN * CONFIG.assaultGateBrokenPrestige;
    addRes('prestige', prestige);
    if (S.siegeCount > 0 && kills >= S.siegeCount * 0.9) { // 全歼 → 俘虏（与回合制同口径，分母取实际生成敌数）
      captives = Math.ceil((pre.enemySize || S.siegeCount) * CONFIG.captiveRate);
      state.pendingCaptives += captives;
    }
    loot = Math.round(kills * CONFIG.assaultLootPerKill); // [PLACEHOLDER·默认 0，与俘虏机制挂 EA 联动后再开]
    if (loot > 0) { LEDGER_SRC = '战利品'; addRes('money', loot); LEDGER_SRC = null; }
  }

  // ⑥ 战报 + 归因链（支柱 3「后果可归因」的呈现载体 = 信号 C 的检测面）
  const rep = {
    siege: true, live: true, label: '总攻', enemySize: S.siegeCount || pre.enemySize,
    kills: kills, dead: deadTotal, deadByType: dt, captives: captives,
    gates: gateLines, demolished: demolished, loot: loot, prestige: prestige,
    skillUse: Object.assign({}, use), profGain: Math.round(profGain * 10) / 10,
    ops: S.ops, pauseRatio: (S.activeTime + S.pausedTime) > 0 ? S.pausedTime / (S.activeTime + S.pausedTime) : 0,
    peakInside: S.peakInside, win: win,
  };
  rep.attrib = buildAttribution(pre, rep);
  state.battleReport = rep;
  state.paused = true;
  pushLog('【' + (win ? '大捷' : '城陷') + '】' + (win ? '总攻退去' : (S.gameOver && S.gameOver.reason)) + '：歼敌 ' + kills
    + '，殉国 ' + deadTotal + (demolished ? '，焚毁建筑 ' + demolished : '')
    + (win ? '，声望 ' + (prestige >= 0 ? '+' : '') + prestige : ''));

  // ⑦ 胜负判定（与回合制 finishSegBattle 同口径：守过总攻且声望达标才算赢）
  if (!state.gameOver) {
    if (win) {
      if (getRes('prestige') >= CONFIG.winPrestige) {
        state.gameOver = { win: true, reason: '守过总攻', detail: '塞上雄关屹立，胡骑远遁。声望 ' + getRes('prestige') + ' ≥ ' + CONFIG.winPrestige + '。' };
      } else {
        state.gameOver = { win: false, reason: '声望不逮', detail: '城虽守住，声望 ' + getRes('prestige') + ' < ' + CONFIG.winPrestige + '，朝廷问罪夺关。' };
      }
    } else {
      state.gameOver = { win: false, reason: (S.gameOver && S.gameOver.reason) || '城陷', detail: (S.gameOver && S.gameOver.detail) || '门破涌入，关隘陷落。' };
    }
  }
}
// 归因链：每条损失都挂到一个经营决策上（否则玩家只看到"输了"，不知道输在哪——信号 C）
function buildAttribution(pre, r) {
  const out = [];
  const repairs = Math.min(Math.floor(getRes('soil') / CONFIG.gateRepairSoil), Math.floor(getRes('wood') / CONFIG.gateRepairWood));
  r.gates.forEach(function (gl) {
    if (gl.after === gl.before) return;
    out.push({ tone: gl.broken ? 'bad' : 'warn',
      text: '【门】' + CONFIG.wall.segNames[gl.seg] + ' ' + gl.before + ' → ' + gl.after + (gl.broken ? '（破门！）' : '')
        + '——现有土木够抢修 ' + repairs + ' 次（土' + CONFIG.gateRepairSoil + ' 木' + CONFIG.gateRepairWood + '/次）' });
  });
  if (r.gates.every(function (gl) { return gl.after === gl.before; })) {
    out.push({ tone: 'good', text: '【门】两门无损（前门 ' + state.gateHp[0] + '/' + gateMaxOf(0) + ' · 后门 ' + state.gateHp[2] + '/' + gateMaxOf(2) + '）' });
  }
  const tot = (pre.troops.melee || 0) + (pre.troops.archer || 0) + (pre.troops.engineer || 0);
  out.push({ tone: r.dead === 0 ? 'good' : (r.dead > tot * 0.25 ? 'bad' : 'warn'),
    text: '【兵】殉国 ' + r.dead + ' 人（步' + (r.deadByType.melee || 0) + '/弓' + (r.deadByType.archer || 0) + '/工' + (r.deadByType.engineer || 0) + '）'
      + '——战前在编 ' + tot + ' 人、平均熟练度 ' + pre.profAvg + '%' });
  out.push({ tone: (r.skillUse.log + r.skillUse.oil) > 0 ? 'good' : 'warn',
    text: '【械】檑木 ' + r.skillUse.log + ' · 火油 ' + r.skillUse.oil + ' · 抢修 ' + r.skillUse.repair + ' 次'
      + '——工匠坊余存 檑木' + state.inv.log + ' 火油' + state.inv.oil + '（已上墙的才算数）' });
  if (r.profGain > 0) out.push({ tone: 'good', text: '【练】存活 ' + state.troops.length + ' 人搏杀补熟练度 +' + r.profGain + '%' });
  if (r.demolished > 0) out.push({ tone: 'bad', text: '【毁】入城胡骑焚毁建筑 ' + r.demolished + ' 座（城内 ' + pre.inBuildings + ' → ' + (pre.inBuildings - r.demolished) + '）' });
  out.push({ tone: 'note', text: verdictLine(pre, r, tot) });
  return out;
}
function verdictLine(pre, r, tot) {
  if (!r.win) return '城陷归因：门破后无人堵洞——下次预备队留近战，或把檑木压到被破的那一段。';
  if (r.gates.some(function (gl) { return gl.broken; })) {
    return '门破而城未陷，靠的是堵门洞的血肉——下次备足土木（修门土' + CONFIG.gateRepairSoil + ' 木' + CONFIG.gateRepairWood + '）。';
  }
  if (tot > 0 && r.dead > tot * 0.25) return '折损过重（' + Math.round(r.dead / tot * 100) + '%）：熟练度偏低是主因，把训练周期拉长再打。';
  if ((r.skillUse.log + r.skillUse.oil) === 0) return '全程未动用器械——工匠坊产能闲置，檑木/火油是城头最便宜的杀伤。';
  return '城防无损：布防与器械都压住了——下一波可以更大胆。';
}

function advanceClock(dtRealSec) {
  if (state.live.active) { // 战斗模式：经营时钟停摆，只推进实时战斗（暂停由 Battle.S.paused 管）
    if (state.gameOver) return;
    const speed = CONFIG.speeds[state.speedIdx];
    let left = dtRealSec * speed;
    while (left > 0 && !Battle.S.gameOver) { const d = Math.min(0.1, left); Battle.step(d); left -= d; }
    if (Battle.S.gameOver && !state.live.result) exitBattle();
    return;
  }
  if (state.paused || state.gameOver) return;
  const speed = CONFIG.speeds[state.speedIdx];
  let dtGame = dtRealSec * speed;
  // 秒级实时层：按 ≤1 秒分片推进（与浏览器 60fps 帧行为等价，walker 不瞬移）
  while (dtGame > 0) {
    const step = Math.min(1, dtGame);
    dtGame -= step;
    tickWorld(step);
    state.dayProgress += step / CONFIG.dayLengthSec;
    if (state.dayProgress >= 1) {
      state.dayProgress -= 1;
      state.day += 1;
      onNewDay(state.day);
      if (state.paused || state.gameOver) { state.dayProgress = 0; return; }
    }
  }
}
