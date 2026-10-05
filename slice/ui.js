// ============================================================================
// ui.js · 交互层（输入事件 + 主循环 + 启动）
// 职责：鼠标点击/移动/右键、键盘快捷键、暂停开关、requestAnimationFrame 主循环。
// 约定：把玩家意图翻译成 sim 的函数调用，不自己判定游戏规则。
// ============================================================================
'use strict';

canvas.addEventListener('click', function (e) {
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width);
  const my = (e.clientY - rect.top) * (H / rect.height);
  for (const b of buttons) {
    if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) { b.action(); return; }
  }
  if (state.pendingDecision || state.battleReport || state.gameOver) return;
  const cell = cellAt(mx, my);
  const seg = wallSegAt(mx, my);
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
  const rect = canvas.getBoundingClientRect();
  state.mouse.x = (e.clientX - rect.left) * (W / rect.width);
  state.mouse.y = (e.clientY - rect.top) * (H / rect.height);
  state.hoverCell = cellAt(state.mouse.x, state.mouse.y);
});
canvas.addEventListener('contextmenu', function (e) {
  e.preventDefault();
  if (state.buildMode) { pushLog('取消放置'); state.buildMode = null; return; }
  const rect = canvas.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (W / rect.width);
  const my = (e.clientY - rect.top) * (H / rect.height);
  const cell = cellAt(mx, my);
  if (cell) demolish(cell.zone, cell.r, cell.c);
});
window.addEventListener('keydown', function (e) {
  if (e.code === 'Space') { togglePause(); e.preventDefault(); return; }
  if (e.code === 'Escape' && state.buildMode) { state.buildMode = null; pushLog('取消放置'); return; }
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
  advanceClock(dt);
  render();
  requestAnimationFrame(frame);
}

pushLog('关隘开局（v0.3）：产出秒级累积，工人自运回城入库；民房定人口上限（空格暂停）');
requestAnimationFrame(frame);
