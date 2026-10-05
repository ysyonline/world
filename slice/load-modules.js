// 无头加载器：从 index.html 读取模块引用顺序，按序拼接五个模块源码。
// 重构前：单文件内联 <script>；重构后：<script src>×5（08 §6 第 1 步）。
// 加载器与 index.html 的 src 顺序保持单一事实源——HTML 改顺序，这里自动跟随。
const fs = require('fs');
const path = require('path');

function loadSliceModules(htmlFile) {
  const htmlPath = htmlFile || path.join(__dirname, 'index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const dir = path.dirname(htmlPath);
  const srcs = [];
  const re = /<script\s+src=["']([^"']+)["']\s*><\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) srcs.push(m[1]);
  if (!srcs.length) throw new Error('index.html 中未找到 <script src> 模块引用');
  return srcs.map((s) => fs.readFileSync(path.join(dir, s), 'utf8')).join('\n;\n');
}

module.exports = { loadSliceModules };