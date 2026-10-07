// ============================================================================
// render.js · 渲染层（Canvas 绘制，零状态变更）
// 职责：画布句柄、绘制工具、HUD、账本、场景、网格、建造/建筑/布防面板、
//       日志与各类弹窗（结算/俘虏/决策/败局/暂停遮罩）。
// 约定：只读 state 与 CONFIG，不写任何游戏状态；按钮点击动作一律闭包回指 sim。
// ============================================================================
'use strict';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width, H = canvas.height;
const buttons = [];
// ============================ 相机（08 §6 第 2 步：同一地图承载两级视角） ============================
// 世界坐标 ↔ 屏幕坐标的唯一换算口；经营/骚扰固定全景档，总攻推战斗档（第 3 步接入触发）。
const VIEW = CONFIG.view; // MAP（世界几何）由 sim.js 声明，渲染层复用：几何是逻辑概念，两边必须同源
const camera = { x: MAP.worldW / 2, y: MAP.worldH / 2, zoom: 1, mode: 'overview', focusSeg: 0 };
function fitZoom() { return Math.min(VIEW.w / MAP.worldW, VIEW.h / MAP.worldH); }
function setCamera(mode, focusSeg) {
  camera.mode = mode;
  if (mode === 'battle') {
    camera.focusSeg = focusSeg === undefined ? 0 : focusSeg;
    camera.zoom = CONFIG.camera.battleZoom;
    const g = MAP.segs[camera.focusSeg];
    const wallY = g.side === 'north' ? MAP.city.y : MAP.city.y + MAP.city.h;
    camera.x = MAP.city.x + MAP.city.w / 2;
    camera.y = wallY + (g.side === 'north' ? -55 : 55); // 同屏装下 门+门侧墙+近郊接战区
  } else {
    camera.zoom = fitZoom();
    camera.x = MAP.worldW / 2;
    camera.y = MAP.worldH / 2;
  }
}
setCamera('overview');
function worldToScreen(wx, wy) {
  return { x: VIEW.x + VIEW.w / 2 + (wx - camera.x) * camera.zoom,
    y: VIEW.y + VIEW.h / 2 + (wy - camera.y) * camera.zoom };
}
function screenToWorld(sx, sy) {
  return { x: camera.x + (sx - VIEW.x - VIEW.w / 2) / camera.zoom,
    y: camera.y + (sy - VIEW.y - VIEW.h / 2) / camera.zoom };
}
function inView(sx, sy) { return sx >= VIEW.x && sx <= VIEW.x + VIEW.w && sy >= VIEW.y && sy <= VIEW.y + VIEW.h; }
function drawWorld(fn) { // 世界层：裁剪到视口 + 应用相机变换
  ctx.save();
  ctx.beginPath(); ctx.rect(VIEW.x, VIEW.y, VIEW.w, VIEW.h); ctx.clip();
  ctx.translate(VIEW.x + VIEW.w / 2, VIEW.y + VIEW.h / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  fn();
  ctx.restore();
}
// 世界层里的文字：临时回屏幕坐标绘制，保证任意 zoom 下字号恒定可读（缩放文字会糊）
function worldText(txt, wx, wy, fontPx, color, align) {
  const p = worldToScreen(wx, wy);
  if (!inView(p.x, p.y)) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = (fontPx || 12) + 'px sans-serif';
  ctx.fillStyle = color || '#c9bd9e';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(txt, p.x, p.y);
  ctx.restore();
}
// ============================ 绘制工具 ============================
function drawButton(x, y, w, h, label, active, action, disabled) {
  buttons.push({ x: x, y: y, w: w, h: h, label: label, action: disabled ? function () {} : action });
  ctx.fillStyle = disabled ? '#2a251d' : (active ? '#6b5320' : '#3a3226');
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#8a7648';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.fillStyle = disabled ? '#6b6150' : (active ? '#f2e3b6' : '#c9bd9e');
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + h / 2 + 1);
}
function panel(x, y, w, h, title) {
  ctx.fillStyle = '#221c14';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#4a3f2e';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 15px sans-serif';
  ctx.fillText(title, x + 12, y + 18);
}

// ============================ HUD ============================
function renderHUD() {
  ctx.fillStyle = '#26201a';
  ctx.fillRect(0, 0, W, 56);
  ctx.strokeStyle = '#4a3f2e';
  ctx.beginPath(); ctx.moveTo(0, 56.5); ctx.lineTo(W, 56.5); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText('第 ' + state.day + ' 日', 14, 28);
  const barX = 100, barY = 20, barW = 130, barH = 16;
  ctx.fillStyle = '#17130e';
  ctx.fillRect(barX, barY, barW, barH);
  ctx.fillStyle = '#a8832e';
  ctx.fillRect(barX, barY, barW * state.dayProgress, barH);
  ctx.strokeStyle = '#6b5b38';
  ctx.strokeRect(barX + 0.5, barY + 0.5, barW - 1, barH - 1);
  // 倒计时（烽燧 +1 日预警）
  const nw = nextWave();
  ctx.font = '15px sans-serif';
  if (nw) {
    const left = nw.wave.day - state.day;
    ctx.fillStyle = left <= warnDays() ? '#d95745' : '#c9bd9e';
    ctx.fillText('距' + (nw.wave.siege ? '【总攻】' : nw.wave.label) + '：' + left + ' 日', 246, 28);
  } else if (!state.gameOver) {
    ctx.fillStyle = '#c9bd9e';
    ctx.fillText('战事已尽', 246, 28);
  }
  // 资源两行（九项+政）——人口三色：白总数/绿在岗/红闲民（v0.4），超住房红字
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const cap = houseCap(), over = getRes('pop') > cap;
  const res1 = '粮' + getRes('grain') + ' 木' + getRes('wood') + ' 土' + getRes('soil') + ' 铁' + getRes('iron') + ' 钱' + getRes('money') + '  ';
  ctx.fillStyle = '#c9bd9e';
  ctx.fillText(res1, 430, 14);
  const x2 = 430 + res1.length * 13 * 0.62 + 10; // 中文 13px 近似宽（不用 measureText，兼容无头桩）
  ctx.fillStyle = over ? '#ff8a7a' : '#f2e3b6';
  const popStr = '民' + getRes('pop') + '/' + cap;
  ctx.fillText(popStr, x2, 14);
  ctx.fillStyle = '#a8c98a';
  const gangStr = '岗' + assignedTotal();
  ctx.fillText(gangStr, x2 + 70, 14);
  const idle = idlePop();
  ctx.fillStyle = over ? '#ff8a7a' : '#e8a06a';
  ctx.fillText('闲' + idle, x2 + 125, 14);
  ctx.fillStyle = '#c9bd9e';
  ctx.fillText('兵' + getRes('soldiers') + '(训' + (function(){ let q=0; eachBuilding(function(b){ if(b.type==='barracks'&&b.queue) q+=b.queue.length; }); return q; })() + ')' + ' 声望' + getRes('prestige') + ' 政' + getRes('political'), x2 + 170, 14);
  // 预警行：饥荒线 / 城门政策 / 驿站 / 在押
  const threshold = state.grainNeed * CONFIG.famineBufferDays;
  ctx.font = '12px sans-serif';
  let warn = '耗粮' + state.grainNeed + '/日·饥荒线' + threshold + (state.famine ? '【饥荒中】' : '');
  const policyLabel = state.curfewPolicy === 'open' ? '夜不闭户' : (state.curfewPolicy === 'closed' ? '夜夜宵禁' : '每晚询问');
  const taxLv = CONFIG.taxLevels[state.taxLevel];
  const taxLeft = CONFIG.taxMonthDays - (state.day % CONFIG.taxMonthDays);
  warn += '  宵禁：' + policyLabel + (state.innStay ? '（明日商税减半）' : '') + '  口钱' + taxLv.perHead + '钱/月·' + taxLeft + '日后结（声望' + (taxLv.prestige > 0 ? '+' : '') + taxLv.prestige + '）  在押' + state.captives;
  if (state.unpaidDays > 0) warn += '  【欠饷' + state.unpaidDays + '日】';
  if (over) warn += '  【住房不足：' + (getRes('pop') - cap) + '人流落街头】';
  if (getRes('prestige') < CONFIG.prestigeWarnLine) warn += '  【⚠声望濒危 ' + getRes('prestige') + '】';
  ctx.fillStyle = state.famine || state.unpaidDays > 0 || over || taxLv.prestige <= -3 ? '#ff8a7a' : (getRes('grain') < threshold * 2 ? '#efb63c' : '#7a6f58');
  ctx.fillText(warn, 430, 36);
  // 任务角标
  if (state.task) {
    ctx.fillStyle = state.task.accepted ? '#c9a45c' : '#8a7c5e';
    ctx.fillText(state.task.accepted ? '【任务】' + taskText(state.task) + '（' + Math.max(0, state.task.due - state.day) + '日内·赏声望' + CONFIG.taskRewardPrestige + '政' + CONFIG.taskRewardPolitical + '）' : '【圣旨到】待接（赏声望' + CONFIG.taskRewardPrestige + '政' + CONFIG.taskRewardPolitical + '）', 430, 50);
  }
  // 右上按钮：暂停 / 倍速 / 宵禁政策 / 税率 / 账本（v0.3 + v0.4.2 口钱）
  drawButton(W - 486, 14, 108, 28, '税：' + CONFIG.taxLevels[state.taxLevel].label, state.taxLevel !== 1, function () {
    state.taxLevel = (state.taxLevel + 1) % CONFIG.taxLevels.length;
    const lv = CONFIG.taxLevels[state.taxLevel];
    pushLog('【口钱】改征' + lv.label + '：民口' + lv.perHead + '钱/月 · ' + lv.note + '（次月结生效）');
  });
  drawButton(W - 372, 14, 84, 28, '宵禁：' + (state.curfewPolicy === 'open' ? '常开' : (state.curfewPolicy === 'closed' ? '常闭' : '询问')), state.curfewPolicy !== 'ask', function () {
    state.curfewPolicy = state.curfewPolicy === 'ask' ? 'open' : (state.curfewPolicy === 'open' ? 'closed' : 'ask');
    const lab = { ask: '每晚询问（默认）', open: '常开：商队夜入 + 夜赌风险', closed: '常闭：商队宿驿站，明日税减半' };
    pushLog('【宵禁政策】' + lab[state.curfewPolicy]);
  });
  drawButton(W - 280, 14, 70, 28, '账 本', state.ledgerView, function () { state.ledgerView = !state.ledgerView; });
  drawButton(W - 202, 14, 58, 28, state.paused ? '▶' : '⏸', state.paused, togglePause);
  const sp = CONFIG.speeds[state.speedIdx];
  drawButton(W - 136, 14, 112, 28, '倍速 ×' + sp, sp > 1, function () {
    state.speedIdx = (state.speedIdx + 1) % CONFIG.speeds.length;
  });
}
// ---- 账本浮层（v0.3：昨日实结 + 今日流水 + 今日预估）----
function todayEstimate() { // 今日预估：口粮/军饷按当前人口兵额；商税按市坊；产出按产线在岗（不含在途）
  const est = {};
  const need = (getRes('pop') + getRes('soldiers') * CONFIG.soldierGrainMult) * CONFIG.grainPerCapita;
  est.grain = (est.grain || 0) - need;
  // 军饷按日均摊（三日一结只改结算颗粒度，强度仍是 1钱/兵/日）——否则非发饷日预估虚高
  est.money = (est.money || 0) - getRes('soldiers') * CONFIG.soldierPayPerDay;
  // 口钱日均摊（v0.4.2 口径修补）：月结 30 日摊到每天，否则预估列天天漏掉这笔基线收入
  est.money += getRes('pop') * CONFIG.taxLevels[state.taxLevel].perHead / CONFIG.taxMonthDays;
  // 粜粮（开仓时按当前余粮估一日的量）
  if (state.sellGrain) {
    const gNeed = need;
    const excess = Math.floor(getRes('grain') - gNeed * CONFIG.grainSellKeepDays);
    if (excess > 0) {
      const sell = Math.min(excess, CONFIG.grainSellMaxPerDay);
      const earn = Math.floor(sell / CONFIG.grainSellRatio);
      est.money += earn;
      est.grain = (est.grain || 0) - earn * CONFIG.grainSellRatio;
    }
  }
  // 闲工：闲民打零工的日均进项（破产救援线，进预估防"账面看着更死"）
  est.money += idlePop() * CONFIG.idleEarnPerCap;
  let tax = 0;
  eachBuilding(function (b) { if (b.type === 'market' && b.merchant) tax += CONFIG.marketTax; });
  est.money += tax;
  eachBuilding(function (b, zone) {
    const def = CONFIG.buildings[b.type];
    if (zone !== 'out' || !def.output) return;
    const e = effOf(b) * (state.recalled ? 0 : 1);
    for (const k of Object.keys(def.output)) est[k] = (est[k] || 0) + def.output[k] * e;
  });
  return est;
}
function renderLedger() {
  if (!state.ledgerView) return;
  // v0.4.1 修遮挡：账本原在右栏 (706,320,560×250)，打开即盖住运输线(y348)与建筑面板(y452)——
  // v0.3.1「坊市没了」同类 bug。挪到地图视口左侧（经营期该处常年空置），宽 380 只占视口 38%。
  const pw = 380, x = 12, py = 190, ph = 250;
  panel(x, py, pw, ph, '账 本 田 鸡（昨日实结 · 今日流水 · 今日预估）');
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = py + 40;
  // 表头（v0.4.2 晚修：加「今日支/入」合计列——亏损归因先看总口子再看来源；来源明细按数额降序，军饷/建造大额排最前）
  ctx.fillStyle = '#8a7c5e';
  ctx.fillText('资源   昨日净额   今日支/入合计              预估', x + 12, y);
  y += 18;
  const est = todayEstimate();
  const yd = state.ledger.yday;
  LEDGER_KEYS.forEach(function (k, idx) {
    const net = yd && yd.net ? (yd.net[k] || 0) : 0;
    const flows = state.ledger.today[k] || {};
    // v0.4.2 流水可见性修补：来源明细按 |数额| 降序——最大的花销排最前，34 字截断只牺牲尾部小额
    const srcs = Object.keys(flows).filter(function (s) { return Math.abs(flows[s]) >= 0.05; });
    srcs.sort(function (a, b) { return Math.abs(flows[b]) - Math.abs(flows[a]); });
    const fStr = srcs.map(function (s) { return s + (flows[s] > 0 ? '+' : '') + Math.round(flows[s] * 10) / 10; }).join(' ') || '—';
    const e = Math.round((est[k] || 0) * 10) / 10;
    // 今日支出/收入合计（拆正负）：一眼回答"今天钱主要花哪了"
    let outSum = 0, inSum = 0;
    srcs.forEach(function (s) { if (flows[s] < 0) outSum += flows[s]; else inSum += flows[s]; });
    ctx.fillStyle = '#c9bd9e';
    ctx.fillText(RES_LABEL[k], x + 12, y);
    ctx.fillStyle = net > 0 ? '#a8c98a' : (net < 0 ? '#ff8a7a' : '#8a7c5e');
    ctx.fillText((net > 0 ? '+' : '') + Math.round(net * 10) / 10, x + 68, y);
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = outSum < 0 ? '#ff8a7a' : '#8a7c5e';
    ctx.fillText(Math.round(outSum * 10) / 10, x + 130, y);
    ctx.fillStyle = inSum > 0 ? '#a8c98a' : '#8a7c5e';
    ctx.fillText('+' + Math.round(inSum * 10) / 10, x + 178, y);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = e >= 0 ? '#a8c98a' : '#efb63c';
    ctx.fillText((e > 0 ? '+' : '') + e, x + 320, y);
    y += 16;
    ctx.font = '11px sans-serif';
    const parts = srcs.slice(0, 7).map(function (s) { return { s: s, v: flows[s] }; });
    let dx = x + 68;
    for (const p of parts) {
      const seg = p.s + (p.v > 0 ? '+' : '') + Math.round(p.v * 10) / 10 + ' ';
      if (dx + seg.length * 6.1 > x + pw - 12) { ctx.fillStyle = '#8a7c5e'; ctx.fillText('…', dx, y); break; }
      ctx.fillStyle = p.v < 0 ? '#ff8a7a' : '#a8c98a';
      ctx.fillText(seg, dx, y);
      dx += seg.length * 6.1;
    }
    if (!srcs.length) { ctx.fillStyle = '#8a7c5e'; ctx.fillText('—', x + 68, y); }
    ctx.font = '12px sans-serif';
    y += 18;
  });
  // 诊断
  ctx.fillStyle = '#8a7c5e';
  let diag = '';
  LEDGER_KEYS.forEach(function (k) {
    if ((est[k] || 0) < -0.05) {
      if (k === 'grain') diag = '粮入不敷出：扩田/加农，或减口粮消耗';
      if (k === 'money' && !diag) diag = '钱入不敷出：商税/粜粮/缴获是主要进项，军饷三日一结是大头支出';
      if (k === 'wood' && !diag) diag = '木入不敷出：工匠坊耗木大，扩伐木场';
    }
  });
  ctx.fillText(diag || '各资源收支健康（预估口径）', x + 12, y + 4);
}

// ============================ 场景（合图世界层：迷雾 / 天险 / 接战区 / 城外 / 城墙 / 关内） ============================
// 08 §6 第 2 步：一张真地图承载两级视角。几何全部来自 CONFIG.map，绘制一律走世界坐标；
// 文字走 worldText（回屏幕坐标绘制），保证全景档和战斗档下字号恒定不糊。
function renderScene() {
  const OG = CONFIG.outGrid, C = MAP.city, T = MAP.wallThick;
  const t = state.dayProgress;
  const sky = 22 + Math.round(12 * Math.sin(t * Math.PI));
  const backH = OG.splitRow * OG.cell, frontH = (OG.rows - OG.splitRow) * OG.cell;
  drawWorld(function () {
    // 图外暗区 / 世界底色（迷雾）：地图 700×722 是竖长的，视口 1000×584 是宽扁的，
    // fit 后两侧必然留白 —— 底色必须铺到视口边界，左右深涧也一并延伸出画面（看起来是崖外，不是空洞）
    const tl = screenToWorld(VIEW.x, VIEW.y), br = screenToWorld(VIEW.x + VIEW.w, VIEW.y + VIEW.h);
    ctx.fillStyle = '#101418';
    ctx.fillRect(tl.x - 20, tl.y - 20, (br.x - tl.x) + 40, (br.y - tl.y) + 40);
    // 烽燧驱雾（视觉，01 §7）
    eachBuilding(function (b, zone, r, c) {
      if (b.type !== 'beacon') return;
      const p = cellCenter(zone, r, c);
      ctx.fillStyle = 'rgba(60,72,60,0.45)';
      ctx.beginPath(); ctx.arc(p.x, p.y, 74, 0, Math.PI * 2); ctx.fill();
    });
    // 近郊接战区（南北）：敌集结与我军出城拆除器械的战场
    ctx.fillStyle = 'rgb(' + (sky + 12) + ',' + (sky + 6) + ',' + (sky + 2) + ')';
    ctx.fillRect(0, MAP.fog, MAP.worldW, MAP.battle);
    ctx.fillRect(0, MAP.worldH - MAP.fog - MAP.battle, MAP.worldW, MAP.battle);
    // 城外产业区（后郊 / 前郊）
    ctx.fillStyle = 'rgb(' + (sky + 8) + ',' + (sky + 14) + ',' + (sky + 4) + ')';
    ctx.fillRect(0, OG.y0North, MAP.worldW, backH);
    ctx.fillRect(0, OG.y0South, MAP.worldW, frontH);
    // 关内地面
    ctx.fillStyle = '#2c2618';
    ctx.fillRect(C.x, C.y, C.w, C.h);
    // 左右天险（深涧：不可建造 / 不可进攻 / 不可布防，08 §3 侧翼天险）
    ctx.fillStyle = '#15181c';
    ctx.fillRect(tl.x - 20, 0, (MAP.cliffW - tl.x) + 20, MAP.worldH);
    ctx.fillRect(MAP.worldW - MAP.cliffW, 0, (br.x + 20) - (MAP.worldW - MAP.cliffW), MAP.worldH);
    ctx.strokeStyle = '#333c44'; ctx.lineWidth = 1;
    for (let y = 0; y < MAP.worldH; y += 20) {
      ctx.beginPath(); ctx.moveTo(6, y); ctx.lineTo(MAP.cliffW - 6, y + 12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(MAP.worldW - 6, y); ctx.lineTo(MAP.worldW - MAP.cliffW + 6, y + 12); ctx.stroke();
    }
    // 城墙（南北两道；左右依天险不设墙）
    ctx.fillStyle = '#3d362a';
    ctx.fillRect(C.x - 8, C.y - T, C.w + 16, T);
    ctx.fillRect(C.x - 8, C.y + C.h, C.w + 16, T);
    ctx.fillStyle = '#4a4234';
    for (let x = C.x - 8; x < C.x + C.w; x += 46) {
      ctx.fillRect(x + 4, C.y - T - 7, 30, 7);
      ctx.fillRect(x + 4, C.y + C.h + T, 30, 7);
    }
    // 四段布防（前门 / 前侧墙 / 后门 / 后侧墙）：实线=门，虚线=云梯可攀
    for (let s = 0; s < MAP.segs.length; s++) {
      const r = segRect(s), g = MAP.segs[s];
      const n = troopsInSeg(s).length;
      if (state.selectedSeg === s) { ctx.fillStyle = 'rgba(232,200,96,0.28)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
      else if (n > 0) { ctx.fillStyle = 'rgba(120,160,90,0.16)'; ctx.fillRect(r.x, r.y, r.w, r.h); }
      ctx.strokeStyle = g.climb ? '#c9752e' : '#8a7648';
      ctx.lineWidth = 1;
      ctx.setLineDash(g.climb ? [5, 3] : []);
      ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
      ctx.setLineDash([]);
      const gh = state.gateHp[s], gm = gateMaxOf(s); // 便门上限 9 < 正门 12（02 §3.1）
      ctx.fillStyle = '#17130e';
      ctx.fillRect(r.x + 1, r.y + r.h - 5, r.w - 2, 3);
      ctx.fillStyle = gh <= 3 ? '#d95745' : (gh < gm ? '#efb63c' : '#8fae66');
      ctx.fillRect(r.x + 1, r.y + r.h - 5, (r.w - 2) * (gh / gm), 3);
    }
    // v0.4.1：walker 绘制移出 renderScene → 独立 renderWalkers()（见 render() 序列）。
    // 原先画在格子层 renderGridZone 之前，不透明格子底色把人整个盖住——城内格子密、
    // 背货路程长，表现为「农民进城后小绿点消失」。渲染顺序=图层顺序：人必须画在地面之上。
  });
  // ---- 文字层（屏幕坐标，字号恒定）----
  const ccx = C.x + C.w / 2;
  worldText('迷 雾（敌来向 · 商人进货去向 · 烽燧可驱散）', MAP.worldW / 2, MAP.fog / 2, 12, '#5a6a72');
  worldText('迷 雾', MAP.worldW / 2, MAP.worldH - MAP.fog / 2, 12, '#5a6a72');
  worldText('近郊接战区', MAP.worldW / 2, MAP.fog + 14, 11, '#9a7f66');
  worldText('近郊接战区', MAP.worldW / 2, MAP.worldH - MAP.fog - 14, 11, '#9a7f66');
  worldText('后郊产业区（农/林/矿 · 产出先积产地，工人自运回城 · 可被袭扰）', MAP.worldW / 2, OG.y0North - 10, 12, '#6b7f47');
  worldText('前郊产业区（直面正门方向 · 粮道即敌来向）', MAP.worldW / 2, OG.y0South + (OG.rows - OG.splitRow) * OG.cell + 12, 12, '#6b7f47');
  worldText('关 内（工匠坊/兵营/市坊/粮仓/货仓/民房）', ccx, C.y + C.h - 5, 10, '#6b5f47');
  worldText('深涧·天险', MAP.cliffW / 2, MAP.worldH / 2, 12, '#6b7a86');
  worldText('深涧·天险', MAP.worldW - MAP.cliffW / 2, MAP.worldH / 2, 12, '#6b7a86');
  for (let s = 0; s < MAP.segs.length; s++) {
    const r = segRect(s), n = troopsInSeg(s).length;
    worldText(MAP.segs[s].name + (n > 0 ? '×' + n : ' ∅'), r.x + r.w / 2, r.y + r.h / 2 - 4, 11, n > 0 ? '#f2e3b6' : '#ff8a7a');
    if (n > 0) {
      const nm = state.troops.filter(function (x) { return x.seg === s && x.type === 'melee'; }).length;
      const na = state.troops.filter(function (x) { return x.seg === s && x.type === 'archer'; }).length;
      const ne = state.troops.filter(function (x) { return x.seg === s && x.type === 'engineer'; }).length;
      worldText('步' + nm + '弓' + na + '工' + ne, r.x + r.w / 2, r.y + r.h / 2 + 10, 10, '#d8cdb2');
    }
  }
  // 驿站（城外固有设施：常闭→商队夜宿，次日商税 ×0.5）
  const innP = worldToScreen(MAP.worldW - MAP.cliffW - 46, MAP.worldH - MAP.fog - MAP.battle / 2);
  if (inView(innP.x, innP.y)) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#6b5b38'; ctx.fillRect(innP.x - 42, innP.y - 11, 84, 22);
    ctx.strokeStyle = '#8a7648'; ctx.lineWidth = 1; ctx.strokeRect(innP.x - 41.5, innP.y - 10.5, 83, 21);
    ctx.fillStyle = state.curfewPolicy === 'closed' ? '#e0c060' : '#c9bd9e';
    ctx.font = '12px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('驿站' + (state.curfewPolicy === 'closed' ? '（宿）' : ''), innP.x, innP.y);
    ctx.restore();
  }
  // 敌情标记（按段所在侧的接战区呈现）
  if (state.enemies.length) {
    state.enemies.forEach(function (e) {
      const g = MAP.segs[e.seg === null ? 0 : e.seg];
      const y = g.side === 'north' ? MAP.fog + MAP.battle / 2 : MAP.worldH - MAP.fog - MAP.battle / 2;
      worldText((e.siege ? '总攻×' : '游骑×') + e.n, g.x + g.w / 2, y, 14, e.siege ? '#d95745' : '#c98a4a');
    });
    if (state.enemies.some(function (e) { return e.siege; })) {
      worldText('—— 总攻进行中 ——', MAP.worldW / 2, MAP.fog + MAP.battle - 12, 13, '#d95745');
    }
  }
  if (state.recalled) {
    worldText('【收保中】城外平民已撤回（停产）', ccx, OG.y0North + backH - 12, 12, '#c9a45c');
  }
}
function renderGridZone(zone) {
  const cfg = cfgOf(zone), g = gridOf(zone);
  const colors = { farm: '#6a8f3c', lumber: '#7a5a33', mine: '#5a5a66', beacon: '#8a7a3a',
    granary: '#7a6a42', depot: '#6a6a52', house: '#8a7448', workshop: '#8a4a3a', barracks: '#4a5a7a', market: '#3a6a62' };
  drawWorld(function () {
    for (let r = 0; r < cfg.rows; r++) {
      for (let c = 0; c < cfg.cols; c++) {
        const x = cfg.x0 + c * cfg.cell, y = zone === 'out' ? outRowY0(r) : cfg.y0 + r * cfg.cell;
        const b = g[r][c];
        ctx.fillStyle = zone === 'out' ? '#33301f' : '#332d1f';
        ctx.fillRect(x, y, cfg.cell, cfg.cell);
        if (state.buildMode && state.hoverCell && state.hoverCell.zone === zone && state.hoverCell.r === r && state.hoverCell.c === c) {
          ctx.fillStyle = canBuildAt(state.buildMode, zone, r, c).ok ? 'rgba(120,200,90,0.35)' : 'rgba(210,80,60,0.35)';
          ctx.fillRect(x, y, cfg.cell, cfg.cell);
        }
        ctx.strokeStyle = '#4a4234';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, cfg.cell - 1, cfg.cell - 1);
        if (state.selected && state.selected.zone === zone && state.selected.r === r && state.selected.c === c) {
          ctx.strokeStyle = '#e8c860';
          ctx.lineWidth = 2;
          ctx.strokeRect(x + 1.5, y + 1.5, cfg.cell - 3, cfg.cell - 3);
        }
        if (b) { ctx.fillStyle = colors[b.type]; ctx.fillRect(x + 3, y + 3, cfg.cell - 6, cfg.cell - 6); }
      }
    }
  });
  // 建筑标签（屏幕坐标，字号恒定；格子屏幕约 40px，三行排布）
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const b = g[r][c];
      if (!b) continue;
      const x = cfg.x0 + c * cfg.cell, y = zone === 'out' ? outRowY0(r) : cfg.y0 + r * cfg.cell;
      const mx = x + cfg.cell / 2, my = y + cfg.cell / 2;
      worldText(CONFIG.buildings[b.type].label, mx, my - 9, 11, '#f2e3b6');
      const cap = CONFIG.buildings[b.type].capacity;
      const capShow = b.type === 'barracks' ? cap * 3 : cap; // v0.3.1 分营：兵营显示总席位=三营之和
      if (cap > 0) {
        worldText((b.type === 'barracks' ? '训' : '人') + b.workers + '/' + capShow, mx, my + 2, 10,
          b.workers > capShow ? '#ff8a7a' : '#d8cdb2');
      }
      if (zone === 'out' && b.stock) { // 城外产地「待运」角标
        const s = Object.keys(b.stock).reduce(function (sum, k) { return sum + b.stock[k]; }, 0);
        if (s >= 1) worldText('待运' + Math.floor(s), mx, my + 13, 10, s >= CONFIG.carryLoad ? '#efb63c' : '#9a8f6e');
      }
    }
  }
}
// v0.4.1：walker 层（背货/收保/复工/商人）——画在格子层之后，人站在地面上。
// 半径按 zoom 反算保证屏幕尺寸恒定；背货walker头顶加物资色小包裹。
function renderWalkers() {
  drawWorld(function () {
    const wr = 4 / camera.zoom;
    state.walkers.forEach(function (w) {
      ctx.fillStyle = w.color;
      ctx.beginPath(); ctx.arc(w.x, w.y, wr, 0, Math.PI * 2); ctx.fill();
      if (w.kind === 'carry') {
        const k0 = Object.keys(w.cargo)[0];
        const resColor = { grain: '#d8b83c', wood: '#8a6a3a', soil: '#a5785a', iron: '#8a9ab0' };
        ctx.fillStyle = resColor[k0] || '#d8b83c';
        ctx.fillRect(w.x - wr, w.y - wr * 2.6, wr * 2, wr * 1.3);
      }
    });
  });
}

// ============================ 建造面板（右栏 · 08 §6 第 2 步：地图铺满视口，面板不再压地图） ============================
function renderPalette() {
  const px = 1010, colW = 122; // 右栏常驻 280px，建造菜单两列排布省纵向空间
  let y = 72;
  const groups = [['建 造 · 城 外（前后郊）', ['farm', 'lumber', 'mine', 'beacon']], ['建 造 · 关 内', ['house', 'granary', 'depot', 'workshop', 'barracks', 'market']]];
  groups.forEach(function (grp) {
    ctx.fillStyle = '#8a7c5e';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(grp[0], px, y);
    y += 18;
    grp[1].forEach(function (key, i) {
      const def = CONFIG.buildings[key];
      const cx = px + (i % 2) * (colW + 4), cy = y + Math.floor(i / 2) * 34;
      drawButton(cx, cy, colW, 24, def.label, state.buildMode === key, function () {
        state.buildMode = (state.buildMode === key) ? null : key;
      });
      ctx.fillStyle = '#7a6f58';
      ctx.font = '10px sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(costStr(def.cost), cx + 5, cy + 31);
    });
    y += Math.ceil(grp[1].length / 2) * 34 + 22;
  });
  drawButton(px, y, 248, 26, state.recalled ? '▶ 复工（回城外）' : '⛨ 收保（撤平民）', state.recalled, toggleRecall);
  y += 34;
  ctx.fillStyle = '#7a6f58';
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  if (state.buildMode) {
    ctx.fillStyle = '#e8dcc0';
    const zoneTxt = CONFIG.buildings[state.buildMode].zone === 'out' ? '城外前后郊' : '关内';
    ctx.fillText('放置到' + zoneTxt + '，右键/Esc 取消', px, y);
  } else {
    ctx.fillText('右键点建筑=拆除（返还一半）', px, y);
  }
}
// 运输线列表（v0.3：一条线=一个产地→对应仓库；脚夫废除）
// v0.4.1 修遮挡：①y 348→366（原与建造菜单底行提示文字重叠）②选中建筑/墙段时让位给建筑面板（右栏纵向不够两块同屏）
function renderTransport() {
  if (state.selected || state.selectedSeg) return; // 建筑面板优先占用右栏（取消选中即恢复）
  const px = 1010, py = 366, pw = 256, ph = 96; // 右栏中部：建造菜单之下、日志区（y640）之上
  panel(px, py, pw, ph, '运 输 线');
  ctx.font = '11px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = py + 36;
  const lines = [];
  const srcMap = { farm: '农田', lumber: '伐木', mine: '矿洞' };
  const whMap = { farm: '粮仓', lumber: '货仓', mine: '货仓' };
  eachBuilding(function (b, zone) {
    if (zone !== 'out' || !CONFIG.buildings[b.type].capacity) return;
    const s = Object.keys(b.stock).reduce(function (sum, k) { return sum + b.stock[k]; }, 0);
    const busy = state.walkers.some(function (w) { return w.kind === 'carry' && w.bRef && w.bRef.type === b.type && gridOf(w.bRef.zone)[w.bRef.r][w.bRef.c] === b; });
    let status;
    if (state.recalled) status = '收保停产';
    else if (!b.workers) status = '无人上岗';
    else if (busy) status = '运输中';
    else status = '待运 ' + Math.floor(s) + ' 担';
    lines.push(srcMap[b.type] + '→' + whMap[b.type] + '  ' + status);
  });
  if (!lines.length) {
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('城外暂无产线（建农田/伐木场/矿洞）', px + 10, y + 6);
  } else {
    lines.slice(0, 4).forEach(function (t) {
      ctx.fillStyle = t.indexOf('待运') >= 0 ? '#c9a45c' : '#9a9282';
      ctx.fillText(t, px + 10, y);
      y += 15;
    });
    if (lines.length > 4) { ctx.fillStyle = '#8a7c5e'; ctx.fillText('…共 ' + lines.length + ' 条线', px + 10, y); }
  }
}

// ============================ 建筑面板（右栏） ============================
// v0.4.1 修遮挡：原 py=452 + 内容高 ≈230 → 底行按钮落在 y656~680，被日志区（y640 起）盖住——
// 用户实机「没有按钮派遣平民种田」的直接原因（与 v0.3.1「坊市没了」同类：canvas 无层级，后画盖先画）。
// 修法：选中时运输线让位，面板上移到 py=366，底行按钮收进 y≤630（日志线 y640 之上）。
function renderBuildingPanel() {
  const px = 1010, py = 366, pw = 256;
  // 兵营面板 v0.4.2 拆两段后内容更长：单独加高（366+276=642，仍贴日志线 640——改 274 收进 640 内）
  const isBarracks = state.selected && gridOf(state.selected.zone) && gridOf(state.selected.zone)[state.selected.r] && gridOf(state.selected.zone)[state.selected.r][state.selected.c] && gridOf(state.selected.zone)[state.selected.r][state.selected.c].type === 'barracks';
  const ph = isBarracks ? 272 : 264;
  if (!state.selected) {
    panel(px, py, pw, 110, '城 市 概 览');
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('市坊 ' + countBuilding('market') + ' 座 · 商人 ' + state.merchants, px + 12, py + 40);
    ctx.fillText('烽燧 ' + beaconCount() + ' 座（预警 +' + (beaconCount() > 0 ? 1 : 0) + ' 日）', px + 12, py + 58);
    ctx.fillText('工匠库存：檑木' + state.inv.log + ' 火油' + state.inv.oil + ' 重弩' + state.inv.crossbow, px + 12, py + 76);
    ctx.fillText('点击建筑/墙段打开对应面板', px + 12, py + 94);
    return;
  }
  const b = gridOf(state.selected.zone)[state.selected.r][state.selected.c];
  if (!b) { state.selected = null; return; }
  const def = CONFIG.buildings[b.type];
  panel(px, py, pw, ph, '【' + def.label + '】');
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#c9bd9e';
  let y = py + 42;
  if (b.type === 'barracks') {
    // v0.4.2 晚修（用户反馈"混乱不直观"）：面板拆两段——「训练营」（在训新兵，管进出）
    // 与「在编部队」（真正上战场的兵，管布防与开销）。训练是入口、在编是家底，两个心智模型分开展示。
    ctx.fillStyle = '#c9a45c';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('━ 训练营 · 在训 ' + b.queue.length + ' 人', px + 12, y); y += 20;
    ctx.font = '13px sans-serif';
    const list = [['melee', '步'], ['archer', '弓'], ['engineer', '工']];
    list.forEach(function (row) {
      const q = b.queue.filter(function (x) { return x.type === row[0]; });
      ctx.fillStyle = '#c9bd9e';
      let line = row[1] + '营 ' + q.length + '/' + def.capacity + ' 席';
      if (q.length) {
        const lefts = q.map(function (x) { return x.left; });
        line += '（最快剩 ' + Math.min.apply(null, lefts) + ' 日）';
      }
      ctx.fillText(line, px + 12, y);
      drawButton(px + 164, y - 10, 40, 20, '−', false, function () { removeTrainee(b, row[0]); }, q.length <= 0);
      drawButton(px + 210, y - 10, 36, 20, '+' + row[1], false, function () { sendTrainee(b, row[0]); }, !(q.length < def.capacity && idlePop() > 0));
      y += 24;
    });
    drawButton(px + 10, y - 8, 236, 22, '提前出营（在训按已训天数折算熟练度）', false, function () { rushConscript(b); }, b.queue.length <= 0);
    y += 28;
    ctx.fillStyle = '#7a6f58';
    ctx.font = '11px sans-serif';
    ctx.fillText('满训 ' + CONFIG.trainingDays + ' 日 → 熟练80% 自动出营，编入下方在编部队', px + 12, y); y += 18;
    // ============ 下段：在编部队 ============
    ctx.font = 'bold 13px sans-serif';
    ctx.fillStyle = '#c9a45c';
    ctx.fillText('━ 在编部队 · 可上战场 ' + state.troops.length + ' 人', px + 12, y); y += 20;
    ctx.font = '13px sans-serif';
    const t = state.troops;
    const nm = t.filter(x => x.type === 'melee').length, na = t.filter(x => x.type === 'archer').length, ne = t.filter(x => x.type === 'engineer').length;
    if (t.length) {
      const avg = t.reduce(function (s, x) { return s + x.prof; }, 0) / t.length;
      const onWall = t.filter(x => x.seg !== null).length;
      ctx.fillStyle = '#c9bd9e';
      ctx.fillText('步兵 ' + nm + ' · 弓兵 ' + na + ' · 工兵 ' + ne + '（均熟练 ' + Math.round(avg) + '%）', px + 12, y); y += 18;
      ctx.fillStyle = onWall === 0 ? '#efb63c' : '#8a7c5e';
      ctx.fillText('布防：上墙 ' + onWall + ' · 城内预备 ' + (t.length - onWall) + '（点城墙段调配）', px + 12, y); y += 18;
    } else {
      ctx.fillStyle = '#8a7c5e';
      ctx.fillText('暂无在编——新兵训满自动编入；也可提前出营救急', px + 12, y); y += 18;
    }
    ctx.fillStyle = state.unpaidDays > 0 ? '#ff8a7a' : '#8a7c5e';
    const nextPay = (CONFIG.soldierPayEveryDays - (state.day - CONFIG.startDay) % CONFIG.soldierPayEveryDays) % CONFIG.soldierPayEveryDays || CONFIG.soldierPayEveryDays;
    ctx.fillText(state.unpaidDays > 0
      ? '军饷 ' + CONFIG.soldierPayPerDay + '钱/兵/日【欠 ' + state.unpaidDays + ' 期，逃兵中！】'
      : '军饷 ' + CONFIG.soldierPayPerDay + '钱/兵/日 · ' + nextPay + ' 日后一结（' + t.length * CONFIG.soldierPayPerDay * CONFIG.soldierPayEveryDays + '钱）', px + 12, y); y += 18;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('可送训闲民：' + idlePop() + ' / 总人口 ' + getRes('pop'), px + 12, y);
    return;
  }
  if (b.type === 'workshop') {
    ctx.fillText('在岗：' + b.workers + '/' + def.capacity, px + 12, y); y += 20;
    ctx.fillText('当前产物：' + CONFIG.workshopProducts[b.product].label, px + 12, y); y += 20;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('库存：檑木' + state.inv.log + ' 火油' + state.inv.oil + ' 重弩' + state.inv.crossbow, px + 12, y); y += 20;
    Object.keys(CONFIG.workshopProducts).forEach(function (pk, i) {
      const p = CONFIG.workshopProducts[pk];
      drawButton(px + 10 + i * 80, py + ph - 96, 74, 24, p.label, b.product === pk, function () { b.product = pk; });
    });
    ctx.fillStyle = '#7a6f58';
    ctx.font = '11px sans-serif';
    const p = CONFIG.workshopProducts[b.product];
    ctx.fillText('耗料/个：' + costStr(p.cost) + ' · 满岗日产 ' + p.perDay, px + 12, py + ph - 62);
    drawButton(px + 12, py + ph - 36, 110, 24, '− 撤岗', false, function () { assignWorker(b, -1); }, b.workers <= 0);
    drawButton(px + 134, py + ph - 36, 110, 24, '+ 上岗', false, function () { assignWorker(b, +1); }, (CONFIG.hardCapJobs && b.workers >= def.capacity) || idlePop() <= 0 || !canAssignWorkers());
    return;
  }
  if (b.type === 'market') {
    ctx.fillText('商人：' + (b.merchant ? '在岗' : '停摆（等补员）'), px + 12, y); y += 20;
    ctx.fillText('商税：' + CONFIG.marketTax + ' 钱/日（直入库）' + (state.innStay ? ' · 明日减半(宿驿站)' : ''), px + 12, y); y += 20;
    // 粜粮开关（v0.4.2）：默认关——卖的是饥荒保险，开不开是玩家对"钱荒 vs 粮荒"的判断
    const need = (getRes('pop') + getRes('soldiers') * CONFIG.soldierGrainMult) * CONFIG.grainPerCapita;
    const excess = Math.max(0, Math.floor(getRes('grain') - need * CONFIG.grainSellKeepDays));
    ctx.fillText('粜粮：' + (state.sellGrain ? '开（今可卖 ' + Math.min(excess, CONFIG.grainSellMaxPerDay) + ' 粮 → +' + Math.floor(Math.min(excess, CONFIG.grainSellMaxPerDay) / CONFIG.grainSellRatio) + ' 钱）'
      : '关（余粮 ' + excess + ' 担可变现）'), px + 12, y);
    drawButton(px + 158, y - 10, 86, 20, state.sellGrain ? '停止粜粮' : '开仓粜粮', state.sellGrain, function () {
      state.sellGrain = !state.sellGrain;
      pushLog(state.sellGrain ? '【粜粮】开仓：每日卖出 ' + CONFIG.grainSellKeepDays + ' 日口粮线以上余粮（' + CONFIG.grainSellRatio + ' 粮=1 钱，日限 ' + CONFIG.grainSellMaxPerDay + ' 粮）'
        : '【粜粮】闭仓：余粮留存备战荒');
    });
    y += 22;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('午后出城进迷雾进货，夜间回城', px + 12, y); y += 18;
    ctx.fillText('常闭→宿驿站税减半；骚扰日宿驿站仍可被杀', px + 12, y);
    return;
  }
  if (b.type === 'granary') {
    ctx.fillText('粮食入库点（粮自运到此）', px + 12, y); y += 20;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('全关隘仅一座；仓储上限出切片', px + 12, y);
    return;
  }
  if (b.type === 'depot') {
    ctx.fillText('木/土/铁入库点（自运到此）', px + 12, y); y += 20;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('全关隘仅一座；仓储上限出切片', px + 12, y);
    return;
  }
  if (b.type === 'house') {
    ctx.fillText('容纳 ' + CONFIG.houseCap + ' 名平民（兵不占）', px + 12, y); y += 20;
    ctx.fillStyle = getRes('pop') > houseCap() ? '#ff8a7a' : '#8a7c5e';
    ctx.fillText('住房上限：' + houseCap() + ' / 现有人口 ' + getRes('pop'), px + 12, y); y += 20;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('超限人口为闲民：耗粮、不可上工', px + 12, y);
    return;
  }
  if (b.type === 'beacon') {
    ctx.fillText('无人驻守 · 驱散迷雾 · 预警+1日', px + 12, y); y += 20;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('可被骚扰波焚毁，重建耗土', px + 12, y);
    return;
  }
  // 城外产线（农田/伐木场/矿洞）
  const eff = effOf(b);
  ctx.fillText('在岗：' + b.workers + '/' + def.capacity, px + 12, y); y += 20;
  const outStr = Object.keys(def.output).map(function (k) { return RES_LABEL[k] + Math.round(def.output[k] * eff * 10) / 10; }).join(' ');
  ctx.fillText('效率：' + Math.round(eff * 100) + '% · 日产 ' + outStr, px + 12, y); y += 20;
  const stockStr = Object.keys(b.stock).map(function (k) { return RES_LABEL[k] + (Math.round(b.stock[k] * 10) / 10); }).join(' ') || '无';
  ctx.fillStyle = '#c9a45c';
  ctx.fillText('待运：' + stockStr + '（满 ' + CONFIG.carryLoad + ' 担自动背回）', px + 12, y); y += 20;
  ctx.fillStyle = '#8a7c5e';
  ctx.font = '12px sans-serif';
  ctx.fillText('背货人走路期间不产出（运输税=距离）', px + 12, y);
  drawButton(px + 12, py + ph - 36, 110, 24, '− 撤岗', false, function () { assignWorker(b, -1); }, b.workers <= 0);
  drawButton(px + 134, py + ph - 36, 110, 24, '+ 上岗', false, function () { assignWorker(b, +1); }, (CONFIG.hardCapJobs && b.workers >= def.capacity) || idlePop() <= 0 || !canAssignWorkers());
}

// ============================ 布防面板（右栏下） ============================
// v0.4.1 修遮挡：原 py=452 + 264 → 底到 y716，被日志区（y640）盖住下半（撤器械/修门不可见）。上移到 366 对齐建筑面板。
function renderSegPanel() {
  if (state.selectedSeg === null) return;
  const px = 1010, py = 366, pw = 256, ph = 264;
  const s = state.selectedSeg;
  const name = CONFIG.wall.segNames[s];
  const seg = troopsInSeg(s);
  panel(px, py, pw, ph, '【' + name + '】墙段布防');
  // 城门血条
  const gh = state.gateHp[s], gm = gateMaxOf(s); // 城门血条
  ctx.font = '12px sans-serif';
  ctx.fillStyle = '#8a7c5e';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('城门', px + 12, py + 40);
  ctx.fillStyle = '#17130e';
  ctx.fillRect(px + 52, py + 33, 120, 14);
  ctx.fillStyle = gh <= 3 ? '#d95745' : (gh < gm ? '#efb63c' : '#8fae66');
  ctx.fillRect(px + 52, py + 33, 120 * (gh / gm), 14);
  ctx.strokeStyle = '#6b5b38';
  ctx.strokeRect(px + 52.5, py + 33.5, 119, 13);
  ctx.fillStyle = '#e8dcc0';
  ctx.fillText(gh + '/' + gm, px + 182, py + 40);
  // 兵力与器械
  const nm = state.troops.filter(function (t) { return t.seg === s && t.type === 'melee'; }).length;
  const na = state.troops.filter(function (t) { return t.seg === s && t.type === 'archer'; }).length;
  const ne = state.troops.filter(function (t) { return t.seg === s && t.type === 'engineer'; }).length;
  ctx.font = '13px sans-serif';
  ctx.fillStyle = seg.length ? '#c9bd9e' : '#ff8a7a';
  ctx.fillText('驻兵 ' + seg.length + '：步' + nm + ' 弓' + na + ' 工' + ne, px + 12, py + 62);
  const avg = seg.length ? seg.reduce(function (sum, i) { return sum + state.troops[i].prof; }, 0) / seg.length : 0;
  ctx.fillStyle = '#8a7c5e';
  ctx.font = '12px sans-serif';
  ctx.fillText('战力 ' + segPower(s).toFixed(2) + ' · 均熟练 ' + Math.round(avg) + '%', px + 12, py + 80);
  ctx.fillText('檑木' + state.segLogs[s] + '/' + CONFIG.wall.logMaxPerSeg + ' 火油' + state.segOil[s] + '/' + CONFIG.wall.oilMaxPerSeg
    + ' 重弩' + state.segXbow[s] + '/' + CONFIG.wall.xbowMaxPerSeg + (ne === 0 && (state.segLogs[s] + state.segXbow[s]) > 0 ? '（无工兵=死器械！）' : ''), px + 12, py + 98);
  ctx.fillText('未布防兵：' + reserveTroops().length + '（工兵操作檑木/重弩）', px + 12, py + 116);
  // 行1：调兵
  drawButton(px + 10, py + 130, 56, 24, '− 撤防', false, function () { withdrawTroop(s); }, seg.length <= 0);
  drawButton(px + 70, py + 130, 56, 24, '+步兵', false, function () { deployTroop(s, 'melee'); });
  drawButton(px + 130, py + 130, 56, 24, '+弓兵', false, function () { deployTroop(s, 'archer'); });
  drawButton(px + 190, py + 130, 56, 24, '+工兵', false, function () { deployTroop(s, 'engineer'); });
  // 行2：器械部署
  drawButton(px + 10, py + 160, 74, 24, '+檑木(' + state.inv.log + ')', false, function () { deployGear(s, 'log'); }, state.inv.log <= 0 || state.segLogs[s] >= CONFIG.wall.logMaxPerSeg);
  drawButton(px + 90, py + 160, 74, 24, '+火油(' + state.inv.oil + ')', false, function () { deployGear(s, 'oil'); }, state.inv.oil <= 0 || state.segOil[s] >= CONFIG.wall.oilMaxPerSeg);
  drawButton(px + 170, py + 160, 76, 24, '+重弩(' + state.inv.crossbow + ')', false, function () { deployGear(s, 'crossbow'); }, state.inv.crossbow <= 0 || state.segXbow[s] >= CONFIG.wall.xbowMaxPerSeg);
  // 行3：撤器械
  drawButton(px + 10, py + 190, 74, 24, '−檑木', false, function () { withdrawGear(s, 'log'); }, state.segLogs[s] <= 0);
  drawButton(px + 90, py + 190, 74, 24, '−火油', false, function () { withdrawGear(s, 'oil'); }, state.segOil[s] <= 0);
  drawButton(px + 170, py + 190, 76, 24, '−重弩', false, function () { withdrawGear(s, 'crossbow'); }, state.segXbow[s] <= 0);
  // 行4：修门（土多木少）
  drawButton(px + 10, py + 226, 236, 26, gh < gm ? '修城门（土' + CONFIG.gateRepairSoil + ' 木' + CONFIG.gateRepairWood + '）' : '城门完好', false,
    function () { repairGate(s); }, gh >= gm || getRes('soil') < CONFIG.gateRepairSoil || getRes('wood') < CONFIG.gateRepairWood);
}

// ============================ 日志 / 弹窗 ============================
function renderLog() {
  // v0.4.1：右栏底色改在 render() 开头铺（见 render 内注释）——原先铺在这里（renderLog 在
  // 面板之后执行）会把建造菜单/建筑面板整个盖掉，「建筑面板没了没法建」即此。教训第三条：
  // 底色永远先画，内容后画；渲染顺序=图层顺序。
  const y0 = H - CONFIG.view.logH;
  ctx.fillStyle = '#1a1510';
  ctx.fillRect(0, y0, W, CONFIG.view.logH);
  ctx.strokeStyle = '#4a3f2e';
  ctx.beginPath(); ctx.moveTo(0, y0 + 0.5); ctx.lineTo(W, y0 + 0.5); ctx.stroke();
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '13px sans-serif';
  state.log.forEach(function (line, i) {
    ctx.fillStyle = i === state.log.length - 1 ? '#e8dcc0' : '#7a6f58';
    ctx.fillText(line, 24, y0 + 12 + i * 13);
  });
}
function renderBattleReport() {
  const rep = state.battleReport;
  if (!rep || !state.paused) return;
  if (rep.live && state.gameOver) return; // 实时战报的归因链已内嵌进终局面板，避免两层面板叠盖
  const attrib = rep.attrib || [];
  const lines = []; // {text, tone}——tone 决定颜色：绿=做对了 黄=有代价 红=失血
  if (rep.siege && rep.live) { // 第 4 步：实时战斗战后结算（附归因链）
    lines.push({ tone: 'note', text: '敌军规模 ' + rep.enemySize + ' · 歼敌 ' + rep.kills + ' · 殉国 ' + rep.dead + ' · 俘虏 ' + rep.captives
      + (rep.loot > 0 ? ' · 缴获 ' + rep.loot + ' 钱' : '') });
    lines.push({ tone: 'note', text: '有效操作 ' + rep.ops + ' 次 · 暂停占比 ' + Math.round(rep.pauseRatio * 100) + '% · 声望 '
      + (rep.prestige >= 0 ? '+' : '') + rep.prestige + (rep.peakInside > 0 ? ' · 曾涌入 ' + rep.peakInside + ' 骑' : '') });
    lines.push({ tone: 'head', text: '—— 归因链：这一仗是被哪几个经营决策决定的 ——' });
    attrib.forEach(function (a) { lines.push(a); });
  } else if (rep.siege) {
    lines.push({ tone: 'note', text: '敌军规模 ' + rep.enemySize + ' · 歼敌 ' + rep.kills + ' · 殉国 ' + rep.dead + ' · 俘虏 ' + rep.captives });
    rep.segs.forEach(function (s) {
      lines.push({ tone: 'note', text: CONFIG.wall.segNames[s.seg] + '段：' + s.rounds + ' 轮 · 门损 ' + s.gateDmg + '（现 ' + state.gateHp[s.seg] + '/' + gateMaxOf(s.seg) + '）' });
    });
    lines.push({ tone: 'note', text: '声望 +' + CONFIG.assaultWinPrestige });
  } else {
    lines.push({ tone: 'note', text: '敌 ' + rep.enemySize + ' 骑 · 城头歼敌 ' + rep.kills + (rep.captives ? ' · 俘虏 ' + rep.captives : '') });
    if (rep.gateOpen) {
      lines.push({ tone: 'bad', text: '开门：铁骑入城抢粮 ' + rep.lootGrain + ' · 钱 ' + rep.lootMoney + ' · 杀民 ' + rep.lootPop });
      lines.push({ tone: 'bad', text: '声望 -' + rep.lootPrestige + '（抢完即走，下次还敢开吗？）' });
    } else {
      lines.push({ tone: 'warn', text: '关门：城外存量被劫 ' + Math.round(rep.fieldRobbed) + ' · 平民遇害 ' + rep.fieldKilled + (rep.beaconBurned ? ' · 烽燧被焚' : '') });
      lines.push({ tone: 'note', text: '（收保可免平民伤亡；烽燧重建耗土）' });
    }
  }
  const pw = 580, ph = Math.min(H - CONFIG.view.logH - 120, 92 + lines.length * 21 + 62);
  const px = (W - pw) / 2, py = Math.max(72, (H - CONFIG.view.logH - ph) / 2 - 16);
  ctx.fillStyle = 'rgba(10, 8, 6, 0.55)';
  ctx.fillRect(0, 56, W, H - 56 - CONFIG.view.logH);
  panel(px, py, pw, ph, '');
  ctx.textAlign = 'center';
  ctx.font = 'bold 19px sans-serif';
  if (rep.siege && rep.live) {
    ctx.fillStyle = rep.win ? '#8ad08a' : '#e06a5a';
    ctx.fillText(rep.win ? '【大捷 · 总攻退去】' : '【城陷 · 关隘失守】', px + pw / 2, py + 28);
  } else {
    ctx.fillStyle = '#e8dcc0';
    ctx.fillText(rep.siege ? '【大捷 · 总攻退去】' : (rep.gateOpen ? '【劫掠 · ' + rep.label + '】' : '【骚扰 · ' + rep.label + '】'), px + pw / 2, py + 28);
  }
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  const TONE = { good: '#8fae66', warn: '#efb63c', bad: '#d95745', note: '#c9bd9e', head: '#e8dcc0' };
  lines.forEach(function (l, i) {
    ctx.fillStyle = TONE[l.tone] || '#c9bd9e';
    ctx.fillText(l.text, px + 24, py + 58 + i * 21);
  });
  drawButton(px + pw / 2 - 60, py + ph - 40, 120, 28, '关 闭', false, function () {
    state.battleReport = null;
    if (state.pendingCaptives > 0) {
      pushLog('俘虏 ' + state.pendingCaptives + ' 人听候处置');
    } else {
      state.paused = false;
      processDecisions();
      if (!state.pendingDecision && !state.gameOver) pushLog('（战报已阅，继续）');
    }
  });
}
function renderCaptivePanel() {
  if (!state.paused || state.battleReport || state.pendingDecision || state.pendingCaptives <= 0) return;
  const n = state.pendingCaptives;
  const pw = 440, ph = 200, px = (W - pw) / 2, py = 160;
  ctx.fillStyle = 'rgba(10, 8, 6, 0.55)';
  ctx.fillRect(0, 56, W, H - 56 - CONFIG.view.logH);
  panel(px, py, pw, ph, '');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('【俘虏处置】' + n + ' 名匈奴俘虏听候发落', px + pw / 2, py + 30);
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#c9bd9e';
  ctx.fillText('处决：每名声望 -' + CONFIG.captiveKillPrestige, px + 24, py + 64);
  ctx.fillText('关押：每日 ' + Math.round(CONFIG.captiveConvertRate * 100) + '% 归化 / ' + Math.round(CONFIG.captiveEscapeRate * 100) + '% 逃跑', px + 24, py + 86);
  drawButton(px + 60, py + ph - 54, 140, 32, '全部处决', false, executeCaptives);
  drawButton(px + pw - 200, py + ph - 54, 140, 32, '全部关押', false, imprisonCaptives);
}
// 决策弹窗（骚扰开/关门、宵禁、皇帝任务、战中三决策点）
function renderDecision() {
  const d = state.pendingDecision;
  if (!d || !state.paused) return;
  const pw = 480, ph = d.kind === 'gate' ? 250 : 220, px = (W - pw) / 2, py = 150;
  ctx.fillStyle = 'rgba(10, 8, 6, 0.6)';
  ctx.fillRect(0, 56, W, H - 56 - CONFIG.view.logH);
  panel(px, py, pw, ph, '');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#c9bd9e';
  let title = '', lines = [], yes = '', no = '';
  if (d.kind === 'gate') {
    title = '【骚扰期的门】匈奴游骑在城外劫掠';
    const reserve = state.troops.filter(function (t) { return t.seg === null; }).length;
    lines = ['开门：商路不断，但小股铁骑会冲入城内抢粮抢钱杀人',
      '（单次上限：粮 ' + Math.round(CONFIG.raidLootGrainCap * 100) + '% · 钱 ' + Math.round(CONFIG.raidLootMoneyCap * 100) + '%，抢完即走）',
      '关门：只扰城外——劫粮道/杀城外平民/烧烽燧（收保可免伤亡）',
      '出城迎击（v0.4.2）：预备队 ' + reserve + ' 人野战——胜=产地无损+缴获，败=折损≤' + Math.round(CONFIG.raidSortieLossCap * 100) + '%'];
    yes = '开门（赌一把）'; no = '关门（固守）';
  } else if (d.kind === 'curfew') {
    title = '【宵禁】夜闭城门，商队 ' + state.merchants + ' 人求入';
    lines = ['放行：商队平安入城，但开门夜赌——可能偷盗（-钱-粮）/ 失火（烧建筑，豁免两仓）',
      '不放行：商队夜宿城外驿站，明日商税减半，城内绝对安全',
      '（嫌烦？右上角「宵禁」按钮可设为常开/常闭，不再每晚询问）'];
    yes = '放行（夜赌）'; no = '不放行（宿驿站）';
  } else if (d.kind === 'emperor') {
    title = '【圣旨到】朝廷摊派';
    lines = [taskText(state.task) + '，限 ' + CONFIG.taskDueDays + ' 日缴清',
      '完成：声望+' + CONFIG.taskRewardPrestige + ' · 政治点+' + CONFIG.taskRewardPolitical + '（声望高=流民来投快，但下次总攻也更大）',
      '误期：声望-' + CONFIG.taskFailPrestige + '（不接无罚）'];
    yes = '接旨'; no = '辞旨（不接）';
  } else if (d.kind === 'oil') {
    title = '【决策点①】敌器械逼近【' + CONFIG.wall.segNames[d.seg] + '】段';
    lines = ['倒火油？城头烈焰倾盆（耗火油 1 份）',
      '点燃概率 ' + Math.round(CONFIG.oilKillP * 100) + '%/台，未点燃也持续灼伤',
      '不倒：保留库存，器械继续砸门'];
    yes = '倒火油！'; no = '保留火油';
  } else if (d.kind === 'sortie') {
    title = '【决策点②】器械压制【' + CONFIG.wall.segNames[d.seg] + '】段';
    lines = ['出城拆除？步/工兵出城，' + Math.round(CONFIG.sortieKillP * 100) + '%/台 拆毁（最可靠）',
      '代价：遭当场铁骑/游骑截杀，按存活比例折损',
      '不出：器械持续输出，城门扛不住几轮'];
    yes = '出城拆除！'; no = '按兵不出';
  } else if (d.kind === 'block') {
    title = '【决策点③】【' + CONFIG.wall.segNames[d.seg] + '】段城门告破！';
    lines = ['步兵堵门洞？以血肉塞门，战局继续（最后窗口）',
      '不堵：匈奴涌入城内 = 立即判败'];
    yes = '堵！人在关在'; no = '不堵（放弃）';
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 17px sans-serif';
  ctx.fillText(title, px + pw / 2, py + 28);
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#c9bd9e';
  lines.forEach(function (t, i) { ctx.fillText(t, px + 24, py + 58 + i * 21); });
  drawButton(px + 40, py + ph - 52, 190, 32, yes, false, function () { answerDecision(true); });
  drawButton(px + pw - 230, py + ph - 52, 190, 32, no, false, function () { answerDecision(false); });
  // v0.4.2 第三选项：骚扰门决策可出城迎击（预备队野战，御敌于外保产地）
  if (d.kind === 'gate') {
    const reserve = state.troops.filter(function (t) { return t.seg === null; }).length;
    drawButton(px + (pw - 200) / 2, py + ph - 92, 200, 32, '⚔ 出城迎击（预备队 ' + reserve + ' 人）', false, function () { answerDecision('sortie'); }, reserve <= 0);
  }
}
function renderGameOver() {
  if (!state.gameOver) return;
  // 第 4 步：实时战斗的终局面板直接内嵌归因链（信号 C——玩家先看因果，再看胜负按钮）
  const rep = state.battleReport;
  const attrib = (rep && rep.live && rep.attrib) || [];
  const pw = 600, ph = attrib.length ? 262 + attrib.length * 21 : 240;
  const px = (W - pw) / 2, py = Math.max(48, (H - CONFIG.view.logH - ph) / 2 - 10);
  ctx.fillStyle = 'rgba(10, 8, 6, 0.75)';
  ctx.fillRect(0, 0, W, H);
  panel(px, py, pw, ph, '');
  ctx.textAlign = 'center';
  ctx.fillStyle = state.gameOver.win ? '#a8c98a' : '#ff8a7a';
  ctx.font = 'bold 26px sans-serif';
  ctx.fillText(state.gameOver.win ? '【胜 利】' : '【败 局】', px + pw / 2, py + 44);
  ctx.fillStyle = '#e8dcc0';
  ctx.font = '16px sans-serif';
  ctx.fillText(state.gameOver.reason, px + pw / 2, py + 84);
  ctx.fillStyle = '#c9bd9e';
  ctx.font = '13px sans-serif';
  ctx.fillText(state.gameOver.detail, px + pw / 2, py + 112);
  ctx.fillText('第 ' + state.day + ' 日 · 民' + getRes('pop') + ' 兵' + getRes('soldiers') + ' 声望' + getRes('prestige') + ' 政' + getRes('political'), px + pw / 2, py + 138);
  if (attrib.length) {
    ctx.textAlign = 'left';
    ctx.font = '12px sans-serif';
    const TONE = { good: '#8fae66', warn: '#efb63c', bad: '#d95745', note: '#c9bd9e', head: '#e8dcc0' };
    ctx.fillStyle = '#e8dcc0';
    ctx.fillText('—— 归因链：这一仗是被哪几个经营决策决定的 ——', px + 36, py + 172);
    attrib.forEach(function (a, i) {
      ctx.fillStyle = TONE[a.tone] || '#c9bd9e';
      ctx.fillText(a.text, px + 36, py + 194 + i * 21);
    });
  } else {
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText(state.checkpoint ? '复盘：输在哪一环？粮？门？声望？——或读档重打总攻' : '复盘：输在哪一环？粮？门？声望？——刷新页面重开一局', px + pw / 2, py + 168);
  }
  if (state.checkpoint && !state.gameOver.win) {
    drawButton(px + pw / 2 - 160, py + ph - 52, 140, 32, '读档 · 总攻前夜', false, function () {
      if (loadCheckpoint()) pushLog('【读档】已回到总攻日晨');
    });
    drawButton(px + pw / 2 + 20, py + ph - 52, 140, 32, '重 开', false, function () {
      if (typeof location !== 'undefined' && location.reload) location.reload();
    });
  } else {
    drawButton(px + pw / 2 - 70, py + ph - 52, 140, 32, '重 开', false, function () {
      if (typeof location !== 'undefined' && location.reload) location.reload();
    });
  }
}
function renderPauseOverlay() {
  if (!state.paused || state.battleReport || state.pendingCaptives > 0 || state.pendingDecision || state.gameOver) return;
  ctx.fillStyle = 'rgba(10, 8, 6, 0.45)';
  ctx.fillRect(0, 56, W, H - 56 - CONFIG.view.logH);
  ctx.fillStyle = '#f2e3b6';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('已 暂 停（空格 / 按钮继续）', W / 2, H / 2);
}

// ============================ 战斗层渲染（08 §6 第 3 步：rts.html 战斗核心搬进合图） ============================
// 约定：只读 Battle.S / Battle.RTS_CONFIG，不写任何战斗状态。
// 单位画在世界层（随相机缩放，战斗档推近后自然变大）；文字一律走 worldText（回屏幕坐标），
// 保证全景档（×0.81）与战斗档（×1.4）下字号恒定不糊。
const BCOL = Battle.COLORS, BTCOL = Battle.TEAM_COLORS;
function skillCdText(name) {
  const sel = Battle.selTeams();
  if (!sel.length) return '—';
  if (name === '齐射') { const t = sel.filter(function (x) { return x.type === 'archer'; })[0]; return t ? (t.volleyCd > 0 ? Math.ceil(t.volleyCd) + 's' : '就绪') : '需弓兵'; }
  if (name === '檑木') { const t = sel.filter(function (x) { return x.onWall && (x.type === 'engineer' || x.type === 'melee'); })[0]; return t ? (t.logCd > 0 ? Math.ceil(t.logCd) + 's' : '就绪') : '需城头'; }
  if (name === '火油') { const t = sel.filter(function (x) { return x.type === 'engineer' && x.onWall; })[0]; return t ? (t.oilCd > 0 ? Math.ceil(t.oilCd) + 's' : '就绪') : '需工兵城头'; }
  if (name === '修门') { const t = sel.filter(function (x) { return x.type === 'engineer'; })[0]; return t ? (t.repairCd > 0 ? Math.ceil(t.repairCd) + 's' : '就绪') : '需工兵'; }
  return '';
}
function renderBattleUnits() {
  const S = Battle.S;
  drawWorld(function () {
    // 城门（战斗态）：破门画叉，未破画血条——以战斗层为准（第 3 步结算不回写经营层的 state.gateHp）
    Battle.GATES.forEach(function (g) {
      if (g.broken) {
        ctx.strokeStyle = '#e06a5a'; ctx.lineWidth = 3 / camera.zoom;
        ctx.beginPath();
        ctx.moveTo(g.x - g.w / 2, g.y - 12); ctx.lineTo(g.x + g.w / 2, g.y + 12);
        ctx.moveTo(g.x + g.w / 2, g.y - 12); ctx.lineTo(g.x - g.w / 2, g.y + 12);
        ctx.stroke();
      } else {
        const by = g.y + (g.side === 'north' ? -MAP.wallThick - 9 : MAP.wallThick + 4);
        ctx.fillStyle = '#17130e'; ctx.fillRect(g.x - g.w / 2, by, g.w, 4);
        const f = Math.max(0, g.hp / g.maxHp);
        ctx.fillStyle = f > 0.5 ? '#8ad08a' : f > 0.25 ? '#d8c25a' : '#e06a5a';
        ctx.fillRect(g.x - g.w / 2, by, g.w * f, 4);
      }
    });
    // 特效底层（光环 / 弹道）
    S.fx.forEach(function (f) {
      const a = 1 - f.t / f.dur;
      if (f.type === 'ring') {
        ctx.strokeStyle = f.color; ctx.globalAlpha = a; ctx.lineWidth = 2 / camera.zoom;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.4 + 0.6 * (1 - a)), 0, Math.PI * 2); ctx.stroke();
      } else if (f.type === 'beam') {
        ctx.strokeStyle = f.color; ctx.globalAlpha = a; ctx.lineWidth = (f.w || 1) * 1.5 / camera.zoom;
        ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });
    // 敌军（形状=兵种：三角游骑/菱铁骑/方先登/长条冲车/井阑）
    S.enemies.forEach(function (e) {
      const col = BCOL[e.squad] || '#c8b88a';
      const s = (e.kind === 'ram' || e.kind === 'tower') ? 11 : 7;
      ctx.save(); ctx.translate(e.x, e.y);
      if (e.state === 'ambush') ctx.globalAlpha = 0.35;
      ctx.fillStyle = col; ctx.strokeStyle = '#0e0b08'; ctx.lineWidth = 1.5 / camera.zoom;
      if (e.kind === 'rider' || e.kind === 'arbalest') {
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.9, s * 0.7); ctx.lineTo(-s * 0.9, s * 0.7); ctx.closePath(); ctx.fill(); ctx.stroke();
        if (e.kind === 'arbalest') { ctx.strokeStyle = '#12303a'; ctx.beginPath(); ctx.moveTo(-s, 0); ctx.lineTo(s, 0); ctx.stroke(); }
      } else if (e.kind === 'iron') {
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.8, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.8, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (e.kind === 'vanguard') {
        ctx.fillRect(-s / 2, -s / 2, s, s); ctx.strokeRect(-s / 2, -s / 2, s, s);
      } else if (e.kind === 'ram') {
        ctx.fillRect(-s, -4, s * 2, 8); ctx.strokeRect(-s, -4, s * 2, 8);
      } else if (e.kind === 'tower') {
        ctx.fillRect(-6, -11, 12, 19); ctx.strokeRect(-6, -11, 12, 19);
      }
      if (e.burning > 0) { ctx.fillStyle = '#ff7a3c'; ctx.globalAlpha = 0.7; ctx.beginPath(); ctx.arc(0, -s - 4, 4, 0, Math.PI * 2); ctx.fill(); }
      ctx.globalAlpha = 1;
      if (e.state === 'climb') { ctx.strokeStyle = '#b8a284'; ctx.lineWidth = 2 / camera.zoom; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -20); ctx.stroke(); }
      ctx.restore();
      if (e.hp < e.maxHp) { // 血条走屏幕坐标：世界坐标下 3px 在全景档会糊成一条线
        const p = worldToScreen(e.x, e.y - s - 9);
        if (inView(p.x, p.y)) {
          ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = '#3a2f22'; ctx.fillRect(p.x - 8, p.y, 16, 3);
          ctx.fillStyle = '#e06a5a'; ctx.fillRect(p.x - 8, p.y, 16 * Math.max(0, e.hp / e.maxHp), 3);
          ctx.restore();
        }
      }
    });
    // 我军（菱形 + 人数 + 兵种字）
    S.teams.forEach(function (t) {
      if (t.dead) return;
      const col = BTCOL[t.type], sel = Battle.isSelected(t.id);
      ctx.save(); ctx.translate(t.x, t.y);
      ctx.fillStyle = col; ctx.strokeStyle = sel ? '#ffd24a' : '#0e0b08'; ctx.lineWidth = (sel ? 2.4 : 1.5) / camera.zoom;
      ctx.beginPath(); ctx.moveTo(0, -9); ctx.lineTo(7.2, 0); ctx.lineTo(0, 9); ctx.lineTo(-7.2, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      worldText(String(t.n), t.x, t.y + 1, 10, '#14100b');
      worldText(t.type === 'melee' ? '步' : t.type === 'archer' ? '弓' : '工', t.x, t.y - 14, 10, col);
      if (t.onWall) worldText('城头', t.x, t.y - 26, 9, '#d8cfb8');
      if (t.busy > 0 && t.busyKind === 'repair') worldText('修…', t.x, t.y + 16, 9, '#8ad08a');
    });
    // 特效顶层（飘字）
    S.fx.forEach(function (f) {
      if (f.type !== 'text') return;
      ctx.globalAlpha = 1 - f.t / f.dur;
      worldText(f.text, f.x, f.y - f.t * 18, 12, f.color || '#ffd8a0');
      ctx.globalAlpha = 1;
    });
  });
}
function renderBattlePanel() {
  const px = 1010, py = 70, pw = 256;
  const S = Battle.S, RC = Battle.RTS_CONFIG;
  panel(px, py, pw, 62, '战 况');
  ctx.font = '12px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#c9bd9e';
  ctx.fillText((S.paused ? '⏸ 暂停（仍可下令）' : '▶ ×' + RC.speeds[S.speedIdx]) + '   ' + Math.floor(S.t) + 's', px + 12, py + 30);
  ctx.fillStyle = '#8a7c5e';
  ctx.fillText('敌 ' + S.enemies.length + '   涌城 ' + S.insideEnemies.size + '/' + RC.ai.floodInsideLose + '   操作 ' + S.ops, px + 12, py + 46);
  // v0.4.2 晚（用户反馈"大地图看不见，只能看见前城门"）：视角切换从暗知识（Z 键）升级为面板明按钮
  drawButton(px + 150, py + 22, 96, 26, camera.mode === 'battle' ? '🗺 全景（Z）' : '⚔ 近景（Z）', camera.mode !== 'battle', function () {
    setCamera(camera.mode === 'overview' ? 'battle' : 'overview', camera.focusSeg);
    pushLog('视角：' + (camera.mode === 'battle' ? '战斗档（推近 ×' + camera.zoom.toFixed(2) + '，Z/X 切换）' : '全景档（×' + camera.zoom.toFixed(2) + '，看全局）'));
  });
  // 两门血条（v0.4.2 下移避让视角按钮：y py+60→py+74）
  Battle.GATES.forEach(function (g, i) {
    const y = py + 74 + i * 24;
    ctx.fillStyle = '#8a7c5e'; ctx.font = '12px sans-serif';
    ctx.fillText(g.label, px + 12, y + 8);
    ctx.fillStyle = '#3a2f22'; ctx.fillRect(px + 58, y + 2, 174, 8);
    const f = Math.max(0, g.hp / g.maxHp);
    ctx.fillStyle = g.broken ? '#e06a5a' : (f > 0.4 ? '#8ad08a' : '#d8c25a');
    ctx.fillRect(px + 58, y + 2, 174 * f, 8);
  });
  // 部队卡（点击选中）
  let y = py + 130;
  panel(px, y, pw, 32 + S.teams.length * 44, '部 队');
  S.teams.forEach(function (t, i) {
    const cy = y + 28 + i * 44, sel = Battle.isSelected(t.id);
    buttons.push({ x: px + 8, y: cy, w: pw - 16, h: 40, label: '', action: function () { Battle.select([t.id]); } });
    ctx.fillStyle = sel ? 'rgba(255,210,74,0.18)' : 'rgba(60,50,36,0.6)';
    ctx.fillRect(px + 8, cy, pw - 16, 40);
    ctx.strokeStyle = sel ? '#ffd24a' : '#4a4030'; ctx.lineWidth = 1;
    ctx.strokeRect(px + 8.5, cy + 0.5, pw - 17, 39);
    ctx.fillStyle = t.dead ? '#6a6050' : BTCOL[t.type];
    ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'left';
    ctx.fillText(t.label, px + 18, cy + 14);
    ctx.font = '11px sans-serif'; ctx.fillStyle = '#d8cfb8';
    ctx.fillText(t.dead ? '覆没' : t.n + '/' + t.maxN + ' 熟' + t.prof + (t.onWall ? ' 城头' : '') + (t.busy > 0 ? ' 忙' : ''), px + 18, cy + 30);
  });
  y += 32 + S.teams.length * 44 + 12;
  // 指令钮（1~4 键同效）
  panel(px, y, pw, 112, '指 令');
  const skills = [['1 齐射', 'volley'], ['2 檑木', 'log'], ['3 火油', 'oil'], ['4 修门', 'repair']];
  skills.forEach(function (s, i) {
    const bx = px + 8 + (i % 2) * 122, by = y + 28 + Math.floor(i / 2) * 40;
    // 第 4 步：技能走 sim（扣经营库存），不直连战斗层
    drawButton(bx, by, 116, 34, s[0], false, function () { useBattleSkill(s[1], S.mouse.x, S.mouse.y); });
  });
  y += 124;
  ctx.textAlign = 'left'; ctx.font = '11px sans-serif';
  // 城头存货（檑木/火油按**墙段**扣：备战时放哪一段，战中就只有那一段能用——布防决策的兑现）
  const lg = state.segLogs.reduce(function (a, b) { return a + b; }, 0);
  const ol = state.segOil.reduce(function (a, b) { return a + b; }, 0);
  ctx.fillStyle = '#8a7c5e';
  ctx.fillText('城头存货 檑木' + lg + ' 火油' + ol + '（按段扣用，放错段=用不上）', px + 12, y + 8);
  ctx.fillStyle = '#7a6f58';
  ['左键点部队 / 拖框选 · 右键下令', '点墙线 = 上墙驻防', '空格暂停（暂停中仍可下令）', 'F 变速 · Z 视角 · X 换聚焦方向'].forEach(function (t, i) {
    ctx.fillText(t, px + 12, y + 26 + i * 16);
  });
}
function renderBattleBanners() {
  const S = Battle.S;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  S.banners.forEach(function (b, i) {
    ctx.font = 'bold 13px sans-serif';
    const w = ctx.measureText(b.text).width + 24;
    ctx.fillStyle = 'rgba(10,8,6,0.78)';
    ctx.fillRect(VIEW.x + VIEW.w / 2 - w / 2, VIEW.y + 6 + i * 24, w, 20);
    ctx.fillStyle = '#ffe9b8';
    ctx.fillText(b.text, VIEW.x + VIEW.w / 2, VIEW.y + 16 + i * 24);
  });
}
function renderBattleEnd() {
  const S = Battle.S;
  if (!S.gameOver) return;
  const w = 520, h = 296, x = W / 2 - w / 2, y = 118;
  ctx.fillStyle = 'rgba(10,8,6,0.96)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = S.gameOver.win ? '#8ad08a' : '#e06a5a'; ctx.lineWidth = 2;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 22px sans-serif'; ctx.fillStyle = S.gameOver.win ? '#8ad08a' : '#e06a5a';
  ctx.fillText(S.gameOver.win ? '—— 击退总攻 ——' : '—— 城陷 ——', W / 2, y + 34);
  ctx.font = '13px sans-serif'; ctx.fillStyle = '#d8cfb8';
  ctx.fillText(S.gameOver.reason, W / 2, y + 62);
  ctx.fillText(S.gameOver.detail, W / 2, y + 84);
  const K = S.killsByType, total = K.archer + K.melee + K.xbow + K.log + K.oil;
  const lines = [
    ['有效操作', S.ops + ' 次（指标 ≥' + Battle.RTS_CONFIG.metrics.minEffectiveOps + '）'],
    ['总击杀', String(total)],
    ['弓 / 弩 / 檑木 / 火油', K.archer + ' / ' + K.xbow + ' / ' + K.log + ' / ' + K.oil],
    ['齐射使用', S.volleyUses + ' 次'],
    ['出城机动', S.sortieMoves + ' 次'],
    ['破门', S.brokenGates.map(function (g) { return g.label; }).join('、') || '无'],
  ];
  ctx.textAlign = 'left'; ctx.font = '12px sans-serif';
  lines.forEach(function (l, i) {
    ctx.fillStyle = '#8a7f66'; ctx.fillText(l[0], x + 40, y + 120 + i * 24);
    ctx.fillStyle = '#d8cfb8'; ctx.fillText(l[1], x + 190, y + 120 + i * 24);
  });
  ctx.textAlign = 'center'; ctx.fillStyle = '#8a7f66'; ctx.font = '12px sans-serif';
  ctx.fillText('战事已决——Esc 返回经营（伤亡/门损/器械已回写经营层）', W / 2, y + h - 18);
}

function render() {
  buttons.length = 0;
  ctx.clearRect(0, 0, W, H);
  renderScene();
  if (state.live && state.live.active) { // 战斗模式：经营面板让位给战斗面板
    renderBattleUnits();
    renderBattlePanel();
    renderBattleBanners();
    renderHUD();
    renderLog();
    renderBattleEnd();
    renderPauseOverlay();
    return;
  }
  // v0.4.1：右栏底色在最开头铺（先底色后内容——铺在 renderLog 里会盖掉建造菜单/面板）。
  // 同时解决"面板缩短后右栏下半露画布背景被像素抽检算空白"的问题（原 89.8%<90% 误报）。
  ctx.fillStyle = '#14100c';
  ctx.fillRect(1010, 56, 270, 640 - 56);
  renderGridZone('out');
  renderGridZone('in');
  renderWalkers(); // v0.4.1：人画在格子之上（原先在 renderScene 里，被格子底色盖住）
  renderPalette();
  renderTransport();
  renderBuildingPanel();
  renderSegPanel();
  renderHUD();
  renderLedger();
  renderLog();
  renderBattleReport();
  renderCaptivePanel();
  renderDecision();
  renderGameOver();
  renderPauseOverlay();
}
