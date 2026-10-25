// 只读工具：解析 Electron asar 归档，按路径提取文件内容，用于调研 DSH Desktop 源码。
// 用法：node extract-asar.js <asar路径> <内部路径> [输出文件]
// 省略输出文件时直接打印到 stdout。
process.noAsar = true; // 关闭 Electron 的 asar 透明层，按普通文件读归档
const fs = require('node:fs');
const path = require('node:path');

function readHeader(fd) {
  const sizeBuf = Buffer.alloc(8);
  fs.readSync(fd, sizeBuf, 0, 8, null);
  // Pickle: 前 4 字节为 payload 长度
  const size = sizeBuf.readUInt32LE(4);
  const headerBuf = Buffer.alloc(size);
  fs.readSync(fd, headerBuf, 0, size, null);
  // Pickle payload: 前 4 字节是字符串长度
  const strLen = headerBuf.readUInt32LE(4);
  const header = JSON.parse(headerBuf.subarray(8, 8 + strLen).toString('utf8'));
  return { header, dataOffset: 8 + size };
}

function findNode(header, innerPath) {
  const parts = innerPath.split('/').filter(Boolean);
  let node = header;
  for (const part of parts) {
    if (!node.files || !node.files[part]) return null;
    node = node.files[part];
  }
  return node;
}

const [, , asarPath, innerPath, outPath] = process.argv;
if (!asarPath || !innerPath) {
  console.error('用法: node extract-asar.js <asar路径> <内部路径> [输出文件]');
  process.exit(2);
}
const fd = fs.openSync(asarPath, 'r');
const { header, dataOffset } = readHeader(fd);
const node = findNode(header, innerPath);
if (!node) {
  console.error(`未找到内部路径: ${innerPath}`);
  process.exit(1);
}
if (node.files) {
  const walk = (n, prefix, depth) => {
    const lines = [];
    for (const [name, child] of Object.entries(n.files ?? {})) {
      const p = `${prefix}/${name}`;
      if (child.files) {
        lines.push(p + '/');
        if (depth > 0) lines.push(...walk(child, p, depth - 1));
      } else {
        lines.push(`${p} (${child.size})`);
      }
    }
    return lines;
  };
  console.log(walk(node, innerPath, 2).join('\n'));
  process.exit(0);
}
const buf = Buffer.alloc(node.size);
fs.readSync(fd, buf, 0, node.size, dataOffset + Number(node.offset));
if (outPath) {
  fs.writeFileSync(outPath, buf);
  console.error(`已写出 ${outPath} (${node.size} 字节)`);
} else {
  process.stdout.write(buf);
}
