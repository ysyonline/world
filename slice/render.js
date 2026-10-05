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
  warn += '  宵禁：' + policyLabel + (state.innStay ? '（明日商税减半）' : '') + '  在押' + state.captives;
  if (state.unpaidDays > 0) warn += '  【欠饷' + state.unpaidDays + '日】';
  if (over) warn += '  【住房不足：' + (getRes('pop') - cap) + '人流落街头】';
  if (getRes('prestige') < CONFIG.prestigeWarnLine) warn += '  【⚠声望濒危 ' + getRes('prestige') + '】';
  ctx.fillStyle = state.famine || state.unpaidDays > 0 || over ? '#ff8a7a' : (getRes('grain') < threshold * 2 ? '#efb63c' : '#7a6f58');
  ctx.fillText(warn, 430, 36);
  // 任务角标
  if (state.task) {
    ctx.fillStyle = state.task.accepted ? '#c9a45c' : '#8a7c5e';
    ctx.fillText(state.task.accepted ? '【任务】' + taskText(state.task) + '（' + Math.max(0, state.task.due - state.day) + '日内）' : '【圣旨到】待接', 430, 50);
  }
  // 右上按钮：暂停 / 倍速 / 宵禁政策 / 账本（v0.3）
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
  est.money = (est.money || 0) - getRes('soldiers') * CONFIG.soldierPayPerDay;
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
  const pw = 560, px = 1010 - pw + 256, py = 320, ph = 250;
  const x = 706;
  panel(x, py, pw, ph, '账 本 田 鸡（昨日实结 · 今日流水 · 今日预估）');
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = py + 40;
  // 表头
  ctx.fillStyle = '#8a7c5e';
  ctx.fillText('资源    昨日净额      今日已入/出（来源：数额）              今日预估', x + 12, y);
  y += 18;
  const est = todayEstimate();
  const yd = state.ledger.yday;
  LEDGER_KEYS.forEach(function (k) {
    const net = yd && yd.net ? (yd.net[k] || 0) : 0;
    const flows = state.ledger.today[k] || {};
    const fStr = Object.keys(flows).filter(function (s) { return Math.abs(flows[s]) >= 0.05; }).map(function (s) { return s + (flows[s] > 0 ? '+' : '') + Math.round(flows[s] * 10) / 10; }).join(' ') || '—'; // v0.3.1 过滤零值条目（防"其他 0"残留显示）
    const e = Math.round((est[k] || 0) * 10) / 10;
    ctx.fillStyle = '#c9bd9e';
    ctx.fillText(RES_LABEL[k], x + 12, y);
    ctx.fillStyle = net > 0 ? '#a8c98a' : (net < 0 ? '#ff8a7a' : '#8a7c5e');
    ctx.fillText((net > 0 ? '+' : '') + Math.round(net * 10) / 10, x + 60, y);
    ctx.fillStyle = '#a89f88';
    ctx.fillText(fStr.length > 44 ? fStr.slice(0, 44) + '…' : fStr, x + 130, y);
    ctx.fillStyle = e >= 0 ? '#a8c98a' : '#efb63c';
    ctx.fillText((e > 0 ? '+' : '') + e, x + 470, y);
    y += 20;
  });
  // 诊断
  ctx.fillStyle = '#8a7c5e';
  let diag = '';
  LEDGER_KEYS.forEach(function (k) {
    if ((est[k] || 0) < -0.05) {
      if (k === 'grain') diag = '粮入不敷出：扩田/加农，或减口粮消耗';
      if (k === 'money' && !diag) diag = '钱入不敷出：市坊/皇帝任务是主要进项';
      if (k === 'wood' && !diag) diag = '木入不敷出：工匠坊耗木大，扩伐木场';
    }
  });
  ctx.fillText(diag || '各资源收支健康（预估口径）', x + 12, y + 4);
}

// ============================ 场景（迷雾带 / 城外 / 城墙 / 关内） ============================
function renderScene() {
  const wallY = 300;
  const t = state.dayProgress;
  const sky = 22 + Math.round(12 * Math.sin(t * Math.PI));
  // 迷雾带（56~120）：可见范围=主城+城外田区+烽燧半径，往外即迷雾（01 §7）
  ctx.fillStyle = '#101418';
  ctx.fillRect(0, 56, W, 64);
  // 烽燧视野：每座烽燧驱散一团迷雾（视觉）
  eachBuilding(function (b, zone, r, c) {
    if (b.type !== 'beacon') return;
    const bx = OUT.x0 + c * OUT.cell + OUT.cell / 2;
    ctx.fillStyle = 'rgba(60,72,60,0.55)';
    ctx.beginPath(); ctx.arc(bx, 88, 90, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = '#5a6a72';
  ctx.font = '13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('迷 雾（敌来向 · 商人进货去向 · 烽燧可驱散）', W / 2, 70);
  // 驿站（固有设施标记，城外右端）
  ctx.fillStyle = '#6b5b38';
  ctx.fillRect(W - 130, 96, 100, 22);
  ctx.strokeStyle = '#8a7648';
  ctx.strokeRect(W - 130 + 0.5, 96.5, 99, 21);
  ctx.fillStyle = state.curfewPolicy === 'closed' ? '#e0c060' : '#c9bd9e';
  ctx.font = '12px sans-serif';
  ctx.fillText('驿站' + (state.curfewPolicy === 'closed' ? '（商队夜宿）' : ''), W - 80, 107);
  // 敌情标记
  if (state.enemies.length) {
    const hasSiege = state.enemies.some(function (e) { return e.siege; });
    state.enemies.forEach(function (e) {
      const cx = e.seg === null ? W / 2 : (e.seg + 0.5) * (W / CONFIG.wall.segNames.length);
      ctx.font = 'bold 14px sans-serif';
      ctx.fillStyle = e.siege ? '#d95745' : '#c98a4a';
      ctx.fillText((e.siege ? '⚔总攻×' : '🏹游骑×') + e.n, cx, 100);
    });
    if (hasSiege) {
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = '#d95745';
      ctx.fillText('—— 总攻进行中 ——', W / 2, 86);
    }
  }
  // 城外田区底色（120~288）
  ctx.fillStyle = 'rgb(' + (sky + 8) + ',' + (sky + 14) + ',' + (sky + 4) + ')';
  ctx.fillRect(0, 120, W, 168);
  ctx.fillStyle = '#6b5f47';
  ctx.font = '13px sans-serif';
  ctx.fillText('城 外 田 区（农/林/矿 · 产出先积产地，工人自运回城 · 可被袭扰）', W / 2, 130);
  if (state.recalled) {
    ctx.fillStyle = '#c9a45c';
    ctx.fillText('【收保中】城外平民已撤回（停产）', W / 2, 280);
  }
  // 城墙（288~326）
  ctx.fillStyle = '#3d362a';
  ctx.fillRect(0, wallY - 12, W, 38);
  ctx.fillStyle = '#4a4234';
  for (let x = 0; x < W; x += 46) ctx.fillRect(x + 4, wallY - 22, 30, 12);
  // 墙段
  const segs = CONFIG.wall.segNames;
  const segW = W / segs.length;
  for (let s = 0; s < segs.length; s++) {
    const sx = s * segW;
    const n = troopsInSeg(s).length;
    if (state.selectedSeg === s) { ctx.fillStyle = 'rgba(232,200,96,0.18)'; ctx.fillRect(sx, wallY - 12, segW, 38); }
    else if (n > 0) { ctx.fillStyle = 'rgba(120,160,90,0.10)'; ctx.fillRect(sx, wallY - 12, segW, 38); }
    if (s > 0) {
      ctx.strokeStyle = '#6b5b38';
      ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(sx + 0.5, wallY - 22); ctx.lineTo(sx + 0.5, wallY + 26); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = '#c9bd9e';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText(segs[s], sx + segW / 2, wallY - 14);
    ctx.font = '11px sans-serif';
    if (n > 0) {
      const nm = state.troops.filter(function (t) { return t.seg === s && t.type === 'melee'; }).length;
      const na = state.troops.filter(function (t) { return t.seg === s && t.type === 'archer'; }).length;
      const ne = state.troops.filter(function (t) { return t.seg === s && t.type === 'engineer'; }).length;
      ctx.fillStyle = '#d8cdb2';
      ctx.fillText('步' + nm + '弓' + na + '工' + ne, sx + segW / 2, wallY + 2);
    } else {
      ctx.fillStyle = '#ff8a7a';
      ctx.fillText('∅ 无驻防', sx + segW / 2, wallY + 2);
    }
    // 城门血点
    const gh = state.gateHp[s];
    for (let g = 0; g < CONFIG.gateMaxHp; g++) {
      ctx.fillStyle = g < gh ? '#8fae66' : '#3a3226';
      ctx.fillRect(sx + 8 + g * 8, wallY + 10, 6, 4);
    }
    // 器械图标
    ctx.fillStyle = '#a8832e';
    let lx = sx + segW - 14;
    for (let i = 0; i < state.segLogs[s]; i++) { ctx.fillText('▤', lx, wallY - 14); lx -= 13; }
    ctx.fillStyle = '#c9752e';
    for (let i = 0; i < state.segOil[s]; i++) { ctx.fillText('◉', lx, wallY - 14); lx -= 13; }
    ctx.fillStyle = '#8a9ab0';
    for (let i = 0; i < state.segXbow[s]; i++) { ctx.fillText('☩', lx, wallY - 14); lx -= 13; }
  }
  ctx.fillStyle = '#6b5f47';
  ctx.font = '13px sans-serif';
  ctx.fillText('城 墙 防 线（点击墙段布防）', W / 2, wallY + 34);
  // 关内地面
  ctx.fillStyle = '#2c2618';
  ctx.fillRect(0, 336, W, 600 - 336);
  ctx.fillStyle = '#6b5f47';
  ctx.fillText('关 内（工匠坊/兵营/市坊/粮仓/货仓/民房）', W / 2, 344);
  // walker 绘制（v0.3）：背货=小点+物资色包裹；收保撤离=空手小点；职业着色
  state.walkers.forEach(function (w) {
    ctx.fillStyle = w.color;
    ctx.beginPath();
    ctx.arc(w.x, w.y, 4, 0, Math.PI * 2);
    ctx.fill();
    if (w.kind === 'carry') { // 包裹：货物主色画头顶小方块
      const k0 = Object.keys(w.cargo)[0];
      const resColor = { grain: '#d8b83c', wood: '#8a6a3a', soil: '#a5785a', iron: '#8a9ab0' };
      ctx.fillStyle = resColor[k0] || '#d8b83c';
      ctx.fillRect(w.x - 3, w.y - 10, 6, 5);
    }
  });
}
function renderGridZone(zone) {
  const cfg = cfgOf(zone), g = gridOf(zone);
  const colors = { farm: '#6a8f3c', lumber: '#7a5a33', mine: '#5a5a66', beacon: '#8a7a3a',
    granary: '#7a6a42', depot: '#6a6a52', house: '#8a7448', workshop: '#8a4a3a', barracks: '#4a5a7a', market: '#3a6a62' };
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const x = cfg.x0 + c * cfg.cell, y = cfg.y0 + r * cfg.cell;
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
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (b) {
        ctx.fillStyle = colors[b.type];
        ctx.fillRect(x + 3, y + 3, cfg.cell - 6, cfg.cell - 6);
        ctx.fillStyle = '#f2e3b6';
        ctx.font = (zone === 'out' ? 11 : 12) + 'px sans-serif';
        ctx.fillText(CONFIG.buildings[b.type].label, x + cfg.cell / 2, y + cfg.cell / 2 - 8);
        const cap = CONFIG.buildings[b.type].capacity;
        const capShow = b.type === 'barracks' ? cap * 3 : cap; // v0.3.1 分营：兵营显示总席位=三营之和
        ctx.fillStyle = b.workers > capShow ? '#ff8a7a' : '#d8cdb2';
        ctx.font = '10px sans-serif';
        if (cap > 0) ctx.fillText((b.type === 'barracks' ? '训' : '人') + b.workers + '/' + capShow, x + cfg.cell / 2, y + cfg.cell / 2 + 8); // 兵营显示「训」=在训学员席（训毕离营编入部队）
        // 城外产地「待运」角标（v0.3：攒够 5 担自动有人背回）
        if (zone === 'out' && b.stock) {
          const s = Object.keys(b.stock).reduce(function (sum, k) { return sum + b.stock[k]; }, 0);
          if (s >= 1) {
            ctx.fillStyle = s >= CONFIG.carryLoad ? '#efb63c' : '#9a8f6e';
            ctx.font = '10px sans-serif';
            ctx.fillText('待运' + Math.floor(s), x + cfg.cell / 2, y + cfg.cell - 8);
          }
        }
      }
    }
  }
}

// ============================ 建造面板（左栏） ============================
function renderPalette() {
  const px = 14, pw = 150;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let y = 66;
  const groups = [['建 造 · 城 外', ['farm', 'lumber', 'mine', 'beacon']], ['建 造 · 关 内', ['house', 'granary', 'depot', 'workshop', 'barracks', 'market']]];
  groups.forEach(function (grp) {
    ctx.fillStyle = '#8a7c5e';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(grp[0], px, y);
    y += 20;
    grp[1].forEach(function (key) {
      const def = CONFIG.buildings[key];
      drawButton(px, y, pw, 24, def.label, state.buildMode === key, function () {
        state.buildMode = (state.buildMode === key) ? null : key;
      });
      ctx.fillStyle = '#7a6f58';
      ctx.font = '11px sans-serif';
      ctx.fillText(costStr(def.cost), px + 4, y + 33);
      y += 42;
    });
    y += 4;
  });
  // 收保按钮
  drawButton(px, y, pw, 26, state.recalled ? '▶ 复工（回城外）' : '⛨ 收保（撤平民）', state.recalled, toggleRecall);
  y += 34;
  ctx.fillStyle = '#7a6f58';
  ctx.font = '11px sans-serif';
  if (state.buildMode) {
    ctx.fillStyle = '#e8dcc0';
    const zoneTxt = CONFIG.buildings[state.buildMode].zone === 'out' ? '城外田区' : '关内';
    ctx.fillText('放置到' + zoneTxt + '，右键/Esc 取消', px, y);
  } else {
    ctx.fillText('右键点建筑=拆除（返还一半）', px, y);
  }
}
// 运输线列表（v0.3：一条线=一个产地→对应仓库；脚夫废除）
function renderTransport() {
  const px = 1010, py = 316, pw = 256, ph = 126; // v0.3.1：原位(14,470)盖住建菜单兵营/市坊按钮——搬右栏空区
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
    lines.slice(0, 6).forEach(function (t) {
      ctx.fillStyle = t.indexOf('待运') >= 0 ? '#c9a45c' : '#9a9282';
      ctx.fillText(t, px + 10, y);
      y += 15;
    });
    if (lines.length > 6) { ctx.fillStyle = '#8a7c5e'; ctx.fillText('…共 ' + lines.length + ' 条线', px + 10, y); }
  }
}

// ============================ 建筑面板（右栏） ============================
function renderBuildingPanel() {
  const px = 1010, py = 70, pw = 256, ph = 240;
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
    // v0.3.1 三营分列（用户反馈：兵/弓/工应分别设置）——每营一行：在训进度 + 分营 −/+ 按钮
    const list = [['melee', '步'], ['archer', '弓'], ['engineer', '工']];
    list.forEach(function (row) {
      const q = b.queue.filter(function (x) { return x.type === row[0]; });
      ctx.fillStyle = '#c9a45c';
      let line = '【' + row[1] + '兵营】训' + q.length + '/' + def.capacity;
      if (q.length) {
        const lefts = q.map(function (x) { return x.left; });
        line += ' 剩' + Math.min.apply(null, lefts) + '~' + Math.max.apply(null, lefts) + '日';
      } else {
        line += ' 空闲';
      }
      ctx.fillText(line, px + 12, y);
      drawButton(px + 164, y - 10, 40, 20, '−', false, function () { removeTrainee(b, row[0]); }, q.length <= 0);
      drawButton(px + 210, y - 10, 36, 20, '+' + row[1], false, function () { sendTrainee(b, row[0]); }, !(q.length < def.capacity && idlePop() > 0));
      y += 24;
    });
    ctx.fillStyle = '#7a6f58';
    ctx.font = '11px sans-serif';
    ctx.fillText('每营各 ' + def.capacity + ' 席 · 满训 ' + CONFIG.trainingDays + ' 日→熟练80%，训毕离营编入部队', px + 12, y); y += 16;
    ctx.font = '13px sans-serif';
    const t = state.troops;
    const nm = t.filter(x => x.type === 'melee').length, na = t.filter(x => x.type === 'archer').length, ne = t.filter(x => x.type === 'engineer').length;
    ctx.fillStyle = '#c9bd9e';
    if (t.length) {
      const avg = t.reduce(function (s, x) { return s + x.prof; }, 0) / t.length;
      const onWall = t.filter(x => x.seg !== null).length;
      ctx.fillText('【在编部队】' + t.length + '人·步' + nm + '弓' + na + '工' + ne + '·均熟练' + Math.round(avg) + '%', px + 12, y); y += 18;
      ctx.fillStyle = '#8a7c5e';
      ctx.fillText('布防：上墙' + onWall + '·预备' + (t.length - onWall) + '（点城墙段调配）', px + 12, y);
    } else {
      ctx.fillText('【在编部队】暂无——训毕的兵在此显示，驻防点城墙', px + 12, y);
    }
    y += 18;
    ctx.fillStyle = state.unpaidDays > 0 ? '#ff8a7a' : '#8a7c5e';
    ctx.fillText(state.unpaidDays > 0 ? '军饷：欠' + state.unpaidDays + '日（逃兵中）' : '军饷：' + state.payNeed + '钱/日·已发齐', px + 12, y); y += 18;
    ctx.fillStyle = '#8a7c5e';
    ctx.fillText('闲民：' + idlePop() + ' / 民 ' + getRes('pop'), px + 12, y);
    drawButton(px + 10, py + ph - 34, 236, 24, '提前出营（全部在训按已训天数折算熟练度）', false, function () { rushConscript(b); }, b.queue.length <= 0);
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
function renderSegPanel() {
  if (state.selectedSeg === null) return;
  const px = 1010, py = 322, pw = 256, ph = 274;
  const s = state.selectedSeg;
  const name = CONFIG.wall.segNames[s];
  const seg = troopsInSeg(s);
  panel(px, py, pw, ph, '【' + name + '】墙段布防');
  // 城门血条
  const gh = state.gateHp[s], gm = CONFIG.gateMaxHp;
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
  const y0 = H - 120;
  ctx.fillStyle = '#1a1510';
  ctx.fillRect(0, y0, W, 120);
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
  const pw = 460, ph = 260, px = (W - pw) / 2, py = 140;
  ctx.fillStyle = 'rgba(10, 8, 6, 0.55)';
  ctx.fillRect(0, 56, W, H - 56 - 120);
  panel(px, py, pw, ph, '');
  ctx.textAlign = 'center';
  ctx.fillStyle = '#e8dcc0';
  ctx.font = 'bold 19px sans-serif';
  ctx.fillText(rep.siege ? '【大捷 · 总攻退去】' : (rep.gateOpen ? '【劫掠 · ' + rep.label + '】' : '【骚扰 · ' + rep.label + '】'), px + pw / 2, py + 28);
  ctx.textAlign = 'left';
  ctx.font = '13px sans-serif';
  ctx.fillStyle = '#c9bd9e';
  const lines = [];
  if (rep.siege) {
    lines.push('敌军规模 ' + rep.enemySize + ' · 歼敌 ' + rep.kills + ' · 殉国 ' + rep.dead + ' · 俘虏 ' + rep.captives);
    rep.segs.forEach(function (s) {
      lines.push(CONFIG.wall.segNames[s.seg] + '段：' + s.rounds + ' 轮 · 门损 ' + s.gateDmg + '（现 ' + state.gateHp[s.seg] + '/' + CONFIG.gateMaxHp + '）');
    });
    lines.push('声望 +' + CONFIG.assaultWinPrestige);
  } else {
    lines.push('敌 ' + rep.enemySize + ' 骑 · 城头歼敌 ' + rep.kills + (rep.captives ? ' · 俘虏 ' + rep.captives : ''));
    if (rep.gateOpen) {
      lines.push('开门：铁骑入城抢粮 ' + rep.lootGrain + ' · 钱 ' + rep.lootMoney + ' · 杀民 ' + rep.lootPop);
      lines.push('声望 -' + rep.lootPrestige + '（抢完即走，下次还敢开吗？）');
    } else {
      lines.push('关门：城外存量被劫 ' + Math.round(rep.fieldRobbed) + ' · 平民遇害 ' + rep.fieldKilled + (rep.beaconBurned ? ' · 烽燧被焚' : ''));
      lines.push('（收保可免平民伤亡；烽燧重建耗土）');
    }
  }
  lines.forEach(function (t, i) { ctx.fillText(t, px + 24, py + 60 + i * 22); });
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
  ctx.fillRect(0, 56, W, H - 56 - 120);
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
  const pw = 480, ph = 220, px = (W - pw) / 2, py = 150;
  ctx.fillStyle = 'rgba(10, 8, 6, 0.6)';
  ctx.fillRect(0, 56, W, H - 56 - 120);
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
    lines = ['开门：商路不断，但小股铁骑会冲入城内抢粮抢钱杀人',
      '（单次上限：粮 ' + Math.round(CONFIG.raidLootGrainCap * 100) + '% · 钱 ' + Math.round(CONFIG.raidLootMoneyCap * 100) + '%，抢完即走）',
      '关门：只扰城外——劫粮道/杀城外平民/烧烽燧（收保可免伤亡）'];
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
      '完成：钱+' + CONFIG.taskRewardMoney + ' · 政治点+' + CONFIG.taskRewardPolitical,
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
}
function renderGameOver() {
  if (!state.gameOver) return;
  const pw = 500, ph = 240, px = (W - pw) / 2, py = 170;
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
  ctx.fillStyle = '#8a7c5e';
  ctx.fillText(state.checkpoint ? '复盘：输在哪一环？粮？门？声望？——或读档重打总攻' : '复盘：输在哪一环？粮？门？声望？——刷新页面重开一局', px + pw / 2, py + 168);
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
  ctx.fillRect(0, 56, W, H - 56 - 120);
  ctx.fillStyle = '#f2e3b6';
  ctx.font = 'bold 28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('已 暂 停（空格 / 按钮继续）', W / 2, H / 2);
}

function render() {
  buttons.length = 0;
  ctx.clearRect(0, 0, W, H);
  renderScene();
  renderGridZone('out');
  renderGridZone('in');
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
