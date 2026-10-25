// 只读工具：在 Electron asar 归档的全部字节中按 UTF-8 / 转义形式搜索关键词并打印上下文。
// 用法：node search-asar.js <asar路径> <关键词> [上下文字节数=400] [最大命中=20]
process.noAsar = true;
const fs = require('node:fs');

const [, , asarPath, needle, ctxRaw, maxRaw] = process.argv;
if (!asarPath || !needle) {
  console.error('用法: node search-asar.js <asar路径> <关键词> [上下文字节数] [最大命中]');
  process.exit(2);
}
const contextBytes = Number(ctxRaw ?? 400);
const maxHits = Number(maxRaw ?? 20);
const buf = fs.readFileSync(asarPath);
const hay = buf.toString('latin1'); // 字节级搜索：latin1 保证 1 字节 = 1 字符，偏移与 Buffer 一致
const targets = [needle];
// 中文关键词同时尝试 JS unicode 转义写法（bundle 内常见）
if (/[^\x00-\x7f]/.test(needle)) {
  const escaped = [...needle].map((ch) => `\\u${ch.codePointAt(0).toString(16).padStart(4, '0')}`).join('');
  targets.push(escaped);
}
let total = 0;
for (const target of targets) {
  const tb = Buffer.from(target, target === needle ? 'utf8' : 'latin1').toString('latin1');
  let idx = 0;
  while ((idx = hay.indexOf(tb, idx)) !== -1 && total < maxHits) {
    const start = Math.max(0, idx - contextBytes);
    const end = Math.min(buf.length, idx + tb.length + contextBytes);
    console.log(`\n===== hit #${total + 1} @ byte ${idx} (${target}) =====`);
    console.log(buf.subarray(start, end).toString('utf8').replace(/\0/g, '.'));
    total++;
    idx += tb.length;
  }
}
if (total === 0) console.log(`未命中: ${needle}`);
