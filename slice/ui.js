// ============================================================================
// ui.js · 交互层（输入事件 + 主循环 + 启动）
// 职责：鼠标点击/移动/右键、键盘快捷键、暂停开关、requestAnimationFrame 主循环。
// 约定：把玩家意图翻译成 sim 的函数调用，不自己判定游戏规则。
// 坐标（08 §6 第 2 步）：按钮/面板走屏幕坐标；地图点击先 screenToWorld 转世界坐标再交给 sim。
// 战斗模式（第 3 步）：state.live.active 时输入改走 Battle.*（圈选/右键下令/技能键），
//   空格暂停的是战斗层而不是经营时钟——「暂停中仍可下令」是这套 RTS 的灵魂，不能丢。
// ============================================================================
'use strict';

function hitView(sx, sy) { // 只有点在地图视口内才算地图操作（右栏/HUD/日志区不吃点击）
  return sx >= VIEW.x && sx <= VIEW.x + VIEW.w && sy >= VIEW.y && sy <= VIEW.y + VIEW.h;
}
function evtPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
}
function inBattle() { return !!(state.live && state.live.active); }

// ---- 框选（战斗模式）----
let dragStart = null, dragHandled = false;
canvas.addEventListener('mousedown', function (e) {
  if (!inBattle() || e.button !== 0) return;
  const p = evtPos(e);
  if (!hitView(p.x, p.y)) return;
  dragStart = p; dragHandled = false;
});
canvas.addEventListener('mouseup', function (e) {
  if (!inBattle() || e.button !== 0 || !dragStart) return;
  const p = evtPos(e);
  const x1 = Math.min(dragStart.x, p.x), x2 = Math.max(dragStart.x, p.x);
  const y1 = Math.min(dragStart.y, p.y), y2 = Math.max(dragStart.y, p.y);
  dragStart = null;
  if (x2 - x1 > 10 || y2 - y1 > 10) { // 拖框 = 圈选（队伍世界坐标转屏幕后落在框内即入选）
    const ids = [];
    Battle.S.teams.forEach(function (t) {
      if (t.dead) return;
      const q = worldToScreen(t.x, t.y);
      if (q.x >= x1 && q.x <= x2 && q.y >= y1 && q.y <= y2) ids.push(t.id);
    });
    Battle.select(ids);
    dragHandled = true;
  }
});
canvas.addEventListener('click', function (e) {
  const p = evtPos(e);
  for (const b of buttons) {
    if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) { b.action(); return; }
  }
  if (inBattle()) { // 战斗模式：地图点击 = 点选队伍（框选已在 mouseup 处理过就跳过）
    if (dragHandled) { dragHandled = false; return; }
    if (!hitView(p.x, p.y)) return;
    const wp = screenToWorld(p.x, p.y);
    let hit = null, bd = 18 / camera.zoom; // 屏幕 18px 容差 → 世界坐标
    Battle.S.teams.forEach(function (t) {
      if (t.dead) return;
      const d = Math.hypot(t.x - wp.x, t.y - wp.y);
      if (d < bd) { bd = d; hit = t; }
    });
    Battle.select(hit ? [hit.id] : []);
    return;
  }
  if (state.pendingDecision || state.battleReport || state.gameOver) return;
  if (!hitView(p.x, p.y)) return;
  const wp = screenToWorld(p.x, p.y);
  const cell = cellAt(wp.x, wp.y);
  const seg = wallSegAt(wp.x, wp.y);
  if (seg !== null) { state.selectedSeg = (state.selectedSeg === seg) ? null : seg; state.selected = null; return; }
  if (cell && gridOf(cell.zone)[cell.r][cell.c]) {
    state.selected = cell;
    state.selectedSeg = null;
    return;
  }
  if (state.buildMode) {
    if (cell) tryBuild(state.buildMode, cell.zone, cell.r, cell.c);
    return;
  }
  state.selected = null;
  state.selectedSeg = null;
});
canvas.addEventListener('mousemove', function (e) {
  const p = evtPos(e);
  state.mouse.x = p.x;
  state.mouse.y = p.y;
  if (inBattle() && hitView(p.x, p.y)) { // 战斗层也要知道鼠标在哪（技能目标点取用）
    const wp = screenToWorld(p.x, p.y);
    Battle.S.mouse.x = wp.x; Battle.S.mouse.y = wp.y;
  }
  if (!hitView(p.x, p.y)) { state.hoverCell = null; return; }
  const wp = screenToWorld(p.x, p.y);
  state.hoverCell = cellAt(wp.x, wp.y);
});
canvas.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  const p = evtPos(e);
  if (inBattle()) { // 战斗模式：右键 = 移动/上墙令（点墙线即上墙驻防）
    if (!hitView(p.x, p.y)) return;
    const wp = screenToWorld(p.x, p.y);
    Battle.orderMove(wp.x, wp.y);
    return;
  }
  if (state.buildMode) { pushLog('取消放置'); state.buildMode = null; return; }
  if (!hitView(p.x, p.y)) return;
  const wp = screenToWorld(p.x, p.y);
  const cell = cellAt(wp.x, wp.y);
  if (cell) demolish(cell.zone, cell.r, cell.c);
});
window.addEventListener('keydown', function (e) {
  // ---- 战斗模式键位（优先）----
  if (inBattle()) {
    if (e.code === 'Space') { Battle.togglePause(); e.preventDefault(); return; }
    if (e.code === 'Escape') {
      // 第 4 步：总攻未分胜负不可撤离（否则可以反复重开战斗刷结果，stakes 归零）
      if (Battle.S.gameOver) exitBattle();
      else pushLog('战事未决，不可撤离（空格可暂停下令）');
      return;
    }
    if (e.code === 'KeyF') { pushLog('战斗速度 ×' + Battle.cycleSpeed()); return; }
    if (e.code === 'KeyZ') {
      setCamera(camera.mode === 'overview' ? 'battle' : 'overview', camera.focusSeg);
      pushLog('视角：' + (camera.mode === 'battle' ? '战斗档（推近 ×' + camera.zoom.toFixed(2) + '）' : '全景档（×' + camera.zoom.toFixed(2) + '）'));
      return;
    }
    if (e.code === 'KeyX') {
      const next = camera.focusSeg === 0 ? 2 : 0;
      setCamera('battle', next);
      state.live.focusSeg = next;
      pushLog('聚焦：' + CONFIG.map.segs[next].name + '方向');
      return;
    }
    const si = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
    if (si >= 0) {
      // 第 4 步：技能走 sim 的 useBattleSkill（檑木/火油扣该墙段存货，修门扣土木）
      useBattleSkill(['volley', 'log', 'oil', 'repair'][si], Battle.S.mouse.x, Battle.S.mouse.y);
      return;
    }
    return;
  }
  if (e.code === 'Space') { togglePause(); e.preventDefault(); return; }
  if (e.code === 'Escape' && state.buildMode) { state.buildMode = null; pushLog('取消放置'); return; }
  // B：手动进入实时战场（总攻日会自动进入，这里是调试/回看入口）
  if (e.code === 'KeyB') {
    if (state.live && (state.live.armed || state.live.waveSize)) enterBattle(state.live.focusSeg);
    else pushLog('尚未至总攻日（总攻当日自动进入实时战场）');
    return;
  }
  // Z：预演视角切换（全景档 ⇄ 战斗档）——第 2 步先把手感摆出来，第 3 步由总攻自动触发
  if (e.code === 'KeyZ') {
    setCamera(camera.mode === 'overview' ? 'battle' : 'overview', camera.focusSeg);
    pushLog('视角：' + (camera.mode === 'battle' ? '战斗档（推近 ×' + camera.zoom.toFixed(2) + '）' : '全景档（×' + camera.zoom.toFixed(2) + '）'));
    return;
  }
  // X：战斗档下切换聚焦方向（前门 / 后门）
  if (e.code === 'KeyX') {
    const next = camera.focusSeg === 0 ? 2 : 0;
    setCamera('battle', next);
    pushLog('聚焦：' + CONFIG.map.segs[next].name + '方向');
    return;
  }
  const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].indexOf(e.code);
  if (idx >= 0 && idx < RES_KEYS.length) {
    const d = e.shiftKey ? -10 : 10;
    LEDGER_SRC = '调试';
    addRes(RES_KEYS[idx], d);
    LEDGER_SRC = null;
    pushLog('调试：' + RES_LABEL[RES_KEYS[idx]] + (d > 0 ? '+' : '') + d);
  }
});
function togglePause() {
  if (state.paused && (state.battleReport || state.pendingCaptives > 0 || state.pendingDecision || state.gameOver)) return;
  state.paused = !state.paused;
  pushLog(state.paused ? '（暂停）' : '（继续）');
}
// ============================ 主循环 ============================
let lastTs = 0;
function frame(ts) {
  if (!lastTs) lastTs = ts;
  const dt = Math.min((ts - lastTs) / 1000, 0.25);
  lastTs = ts;
  // 总攻已至 / 进入战场：视角自动推近一次（08 定案「只有总决战推近」），之后玩家可自由 Z/X
  if (state.live.pendingCam) { setCamera('battle', state.live.focusSeg); state.live.pendingCam = false; }
  else if (state.live.armed && !state.live.active) { setCamera('battle', state.live.focusSeg); state.live.armed = false; }
  advanceClock(dt);
  render();
  requestAnimationFrame(frame);
}

pushLog('关隘开局（v0.4 合图）：同一张地图跑经营与守城；Z 键预演推近视角（空格暂停）');
requestAnimationFrame(frame);
