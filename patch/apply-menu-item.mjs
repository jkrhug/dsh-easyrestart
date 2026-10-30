#!/usr/bin/env node
/**
 * 命令行入口：给 DSH Desktop 的两个菜单加「重启」项（也可还原）。
 *
 * 真正的实现在 ../plugin/lib/menu-patch.js —— 插件与这个脚本共用同一份逻辑，
 * 这里只是把 CLI 参数翻译成 install / uninstall / inspect。
 *
 * 用法：
 *   无参数       安装（幂等；已装则只报告状态）
 *   --check      只查看状态
 *   --dry-run    做完整结构校验但不写文件（等价于一次 check）
 *   --restore    还原为原始菜单
 *
 * PATH 里通常没有独立的 node，用 Desktop 自带的 Electron 以 Node 模式跑：
 *   $env:ELECTRON_RUN_AS_NODE = "1"
 *   $env:ELECTRON_NO_ASAR = "1"
 *   & "<Desktop 安装目录>\DeepSeek Harness.exe" apply-menu-item.mjs --check
 */
import { inspectMenuPatch, installMenuPatch, uninstallMenuPatch } from "../lib/menu-patch.js";

const mode = (process.argv[2] ?? "--install").trim();

function print(title, value) {
  console.log(`\n${title}`);
  console.log(JSON.stringify(value, null, 2));
}

try {
  if (mode === "--check" || mode === "--dry-run" || mode === "--status") {
    print("当前状态", inspectMenuPatch());
  } else if (mode === "--restore" || mode === "--uninstall") {
    print("还原结果", uninstallMenuPatch());
  } else if (mode === "--install" || mode === "--apply") {
    print("安装结果", installMenuPatch());
  } else {
    console.error(`未知参数：${mode}`);
    console.error("可用参数：--install（默认） / --check / --dry-run / --restore");
    process.exitCode = 2;
  }
} catch (error) {
  console.error(`\n失败：${error instanceof Error ? error.message : String(error)}`);
  if (error instanceof Error && error.stack) console.error(error.stack);
  process.exitCode = 1;
}
