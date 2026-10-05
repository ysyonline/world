// slice/browser-check.js · 真实浏览器实跑（08 §6 第 2 步验收用）
// 无头测试证明不了「画面长什么样」，所以这里用 playwright-core 驱动本机 Chrome 真跑一遍：
// ①五模块符号齐全 ②画面非空白 ③真实鼠标点击能建造（扣钱+落建筑）④空格暂停 ⑤Z/X 切视角生效
// ⑥console 无报错（favicon 404 按 URL 过滤）。用法：node slice/browser-check.js [--shot]
// 踩坑（沿用 10-06 重构经验）：canvas 有 CSS 缩放，点击必须按 getBoundingClientRect 换算，否则全落空。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const ROOT = __dirname;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const wantShot = process.argv.includes('--shot');

const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nope'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  res.end(fs.readFileSync(f));
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/index.html';
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.location().url || '')) errors.push('console: ' + m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForTimeout(600);

  const errs = [];
  const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) errs.push(msg); };

  // ①符号 + 相机
  const info = await page.evaluate(() => ({
    mods: ['CONFIG', 'state', 'sim', 'render', 'ui'].filter(k => typeof eval("typeof " + k) !== "undefined" && eval("typeof " + k) !== "undefined" !== 'undefined'),
    has: ['cellAt', 'wallSegAt', 'worldToScreen', 'screenToWorld', 'setCamera', 'camera', 'segRect'].filter(k => typeof eval("typeof " + k) !== "undefined" && eval("typeof " + k) !== "undefined" !== 'undefined'),
    zoom: camera && camera.zoom, mode: camera && camera.mode,
    segNames: CONFIG.wall.segNames, worldW: CONFIG.map.worldW, worldH: CONFIG.map.worldH,
  }));
  ok(info.mods.length >= 4, '模块符号齐全：' + info.mods.join('/'));
  ok(info.has.length === 7, '合图 API 齐全：' + info.has.join('/'));
  ok(Math.abs(info.zoom - Math.min(1000 / info.worldW, 584 / info.worldH)) < 1e-6, '全景档 zoom 按 fit 算出 = ' + info.zoom.toFixed(3));

  // ②画面非空白（canvas 像素统计）
  const px = await page.evaluate(() => {
    const c = document.getElementById('game'), g = c.getContext('2d');
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let n = 0, tot = 0;
    for (let i = 0; i < d.length; i += 4 * 37) { tot++; if (d[i + 3] > 8) n++; }
    return { ratio: n / tot, w: c.width, h: c.height };
  });
  ok(px.ratio > 0.9, '画面非空白（非透明像素 ' + (px.ratio * 100).toFixed(1) + '%）');

  // ③真实点击建造：点建造菜单「农田」→ 点后郊格子 → 扣钱且落建筑
  const rect = await page.evaluate(() => { const r = document.getElementById('game').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const toScreen = (x, y) => ({ x: rect.x + x * (rect.w / 1280), y: rect.y + y * (rect.h / 720) });
  const before = await page.evaluate(() => state.res ? { m: getRes('money') } : null);
  const money0 = await page.evaluate(() => getRes('money'));
  // 建造菜单第一格（右栏两列排布：px=1010, 首项 y≈90）
  const btn = await page.evaluate(() => buttons.filter(b => b.label === '农田').map(b => ({ x: b.x, y: b.y, w: b.w, h: b.h }))[0]);
  let p = toScreen(btn.x + btn.w / 2, btn.y + btn.h / 2);
  await page.mouse.click(p.x, p.y);
  // 后郊第一行第一格中心 → 屏幕
  const cellP = await page.evaluate(() => { const c = cellCenter('out', 0, 0); const s = worldToScreen(c.x, c.y); return s; });
  p = toScreen(cellP.x, cellP.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
  const after = await page.evaluate(() => ({ money: getRes('money'), has: !!state.outGrid[0][0], type: state.outGrid[0][0] && state.outGrid[0][0].type }));
  ok(after.has && after.type === 'farm', '真实点击建成农田（' + money0 + ' → ' + after.money + ' 钱）');
  ok(after.money === money0 - 20, '农田造价扣钱 20');

  // ④点击墙段能选中（前门段）
  const segP = await page.evaluate(() => { const r = segRect(0); const s = worldToScreen(r.x + r.w / 2, r.y + r.h / 2); return s; });
  p = toScreen(segP.x, segP.y);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(80);
  ok(await page.evaluate(() => state.selectedSeg === 0), '点击墙段选中前门（selectedSeg=0）');

  // ⑤空格暂停
  await page.keyboard.press('Space');
  await page.waitForTimeout(60);
  ok(await page.evaluate(() => state.paused === true), '空格暂停生效');
  await page.keyboard.press('Space');

  // ⑥Z 切战斗档 / X 切聚焦方向
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(60);
  const cam1 = await page.evaluate(() => ({ mode: camera.mode, zoom: camera.zoom, fy: camera.y, f: camera.focusSeg }));
  ok(cam1.mode === 'battle' && cam1.zoom > info.zoom, 'Z 推近战斗档（zoom ' + info.zoom.toFixed(2) + ' → ' + cam1.zoom.toFixed(2) + '，' + (cam1.zoom / info.zoom).toFixed(2) + '×）');
  await page.keyboard.press('KeyX');
  await page.waitForTimeout(60);
  const cam2 = await page.evaluate(() => ({ f: camera.focusSeg, y: camera.y, name: CONFIG.map.segs[camera.focusSeg].name }));
  ok(cam2.f !== cam1.f && cam2.y < cam1.fy, 'X 切换聚焦方向（' + cam2.name + '，镜头移到北侧）');
  await page.keyboard.press('KeyZ');
  await page.waitForTimeout(60);
  ok(await page.evaluate(() => camera.mode === 'overview'), 'Z 回到全景档');

  // 战斗档截图（给用户过眼）
  if (wantShot) {
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ROOT, 'shot-battle.png') });
    await page.keyboard.press('KeyZ');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ROOT, 'shot-overview.png') });
    console.log('  · 截图已存 shot-overview.png / shot-battle.png');
  }

  ok(errors.length === 0, 'console 无报错' + (errors.length ? '：' + errors.slice(0, 3).join(' | ') : ''));

  await browser.close();
  server.close();
  console.log('\n' + (errs.length ? 'BROWSER CHECK FAILED：' + errs.length + ' 项' : 'BROWSER CHECK PASSED'));
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
