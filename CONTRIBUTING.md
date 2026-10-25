# 贡献指南

感谢你愿意改进这个项目。以下是最小约定。

## 环境

- Windows + DSH Desktop（Electron）。系统 PATH 里通常没有 node，语法检查和临时脚本用 Desktop 自带的 Electron 以 Node 模式跑：

  ```powershell
  $env:ELECTRON_RUN_AS_NODE = "1"
  $env:ELECTRON_NO_ASAR = "1"
  & "<Desktop 安装目录>\DeepSeek Harness.exe" --check <某个 .mjs 文件>
  ```

- 直接读写 `app.asar` 时必须先设 `process.noAsar = true`，否则 fs 会走 Electron 的 asar 透明层，报 `ENOENT`。

## 改补丁逻辑

改动集中在 `plugin/lib/menu-patch.js`。修改前请注意：

1. **锚点必须来自真实的 `main.js`**，不要凭印象写字符串；先用 `tools/extract-asar.js` 提取出来核对。
2. **两种写法都要保持可逆**：托盘项走「追加 + 重定位 offset/size」，应用菜单项走「等长替换」。新增改动如果会改变长度，请沿用追加式写入（见 `writeMainJs()`），并同步 header 里的 SHA256 与 `blocks[0]`。
3. **先 dry check 再写盘**：在内存里拼出目标 `main.js`、核对锚点唯一性，写盘后立刻读回重新判定状态，不一致就报错。
4. 改完至少验证一遍：`--check`、`--install`、`--restore`、再 `--check`，确认状态判定与哈希都正确。

## 提交

- 一个提交做一件事，说明写清楚「改了什么、为什么」。
- 不要把本机的绝对路径、用户名、凭据写进代码或文档；路径用环境变量或 `process.execPath` 探测。
- UI 文案中英各一份（`locale/zh.json`、`locale/en.json`）。

## 报问题

请说明：DSH Desktop 版本、Windows 版本、执行的命令、完整报错（尤其是锚点找不到时的提示），以及 `--check` 的输出。
