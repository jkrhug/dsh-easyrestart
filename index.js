/**
 * dsh-easyrestart 的 Host 半。
 *
 * 给 DSH Desktop 的「应用」菜单安装原生的「重启应用与 Host」项，并提供两种
 * 管理入口：agent 工具 `dsh_easyrestart` 和斜杠命令 `/easyrestart`。
 * 真正的读写逻辑在 ./lib/menu-patch.js。
 */
import { inspectMenuPatch, installMenuPatch, uninstallMenuPatch } from "./lib/menu-patch.js";

export const inject = ["tools", "commands"];

const ACTIONS = ["status", "install", "uninstall"];

const ACTION_ALIASES = new Map([
  ["status", "status"],
  ["状态", "status"],
  ["检查", "status"],
  ["install", "install"],
  ["apply", "install"],
  ["安装", "install"],
  ["卸载", "uninstall"],
  ["uninstall", "uninstall"],
  ["remove", "uninstall"],
  ["restore", "uninstall"],
  ["还原", "uninstall"],
]);

function normalizeAction(raw) {
  const key = String(raw ?? "").trim().toLowerCase();
  if (!key) return "status";
  const action = ACTION_ALIASES.get(key);
  if (!action) return null;
  return ACTIONS.includes(action) ? action : null;
}

function runAction(action) {
  if (action === "install") return installMenuPatch();
  if (action === "uninstall") return uninstallMenuPatch();
  return inspectMenuPatch();
}

function describe(result) {
  if (!result.ok) return `操作失败：${result.error}`;
  const lines = [];
  lines.push(result.message ?? "完成");
  if (result.asar) lines.push(`app.asar：${result.asar}`);
  if (typeof result.installed === "boolean") {
    lines.push(
      `菜单项：${result.installed ? "已就位" : "未安装"}` +
        (typeof result.appMenu === "boolean"
          ? `（应用菜单${result.appMenu ? "有" : "无"}，托盘菜单${result.trayMenu ? "有" : "无"}）`
          : ""),
    );
  }
  if (result.changed) lines.push("提示：需要重启 DSH Desktop 才会生效。");
  return lines.join("\n");
}

export function apply(ctx) {
  ctx.tools.register({
    name: "dsh_easyrestart",
    description:
      "管理 DSH Desktop 的「重启」菜单项：托盘图标右键菜单里的「重启 DeepSeek Harness」和左上角「应用」菜单里的「重启应用与 Host」，都在「退出」上方。" +
      "查看状态、安装、还原；安装或还原后需要重启 Desktop 才生效。",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ACTIONS,
          description: "status 查看状态；install 安装菜单项；uninstall 还原为原始菜单。",
        },
      },
      required: ["action"],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          installed: { type: "boolean" },
          appMenu: { type: "boolean" },
          trayMenu: { type: "boolean" },
          changed: { type: "boolean" },
          asar: { type: "string" },
          message: { type: "string" },
          error: { type: "string" },
        },
      },
      render(_args, value) {
        return [{ type: "text", text: describe(value) }];
      },
    },
    async execute(args) {
      const action = normalizeAction(args?.action);
      if (!action) {
        return { ok: false, error: `未知的 action：${String(args?.action ?? "")}（可选 status / install / uninstall）` };
      }
      const result = runAction(action);
      return { ...result, action };
    },
  });

  ctx.commands.register({
    name: "easyrestart",
    description: "查看 / 安装 / 还原「应用」菜单里的「重启应用与 Host」项",
    input: { hint: "status | install | uninstall" },
    async handler(invocation) {
      const action = normalizeAction(invocation.rawInput);
      if (!action) {
        return {
          kind: "error",
          text: "用法：/easyrestart [status|install|uninstall]（不带参数等于 status）",
        };
      }
      const result = runAction(action);
      const text = describe(result);
      return result.ok ? { kind: "success", text } : { kind: "error", text };
    },
  });
}
