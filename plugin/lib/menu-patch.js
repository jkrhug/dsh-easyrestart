/**
 * DSH Desktop 菜单补丁（Host 侧与独立脚本共用）。
 *
 * 一共装两项，都来自 DSH Desktop 主进程自带的 `lib/main.js`：
 *
 *   A. 托盘图标右键菜单：「重启 DeepSeek Harness」（在「退出」上方）
 *   B. 左上角「应用」菜单：「重启应用与 Host」（在「退出」上方）
 *
 * 为什么必须改 `lib/main.js`：这两个菜单都由 Electron 主进程用
 * `Menu.buildFromTemplate()` 构建，是操作系统级原生菜单；页面侧
 * （`window.dshDesktop`）与 host 进程与 Electron 的 IPC 都没有 menu / relaunch 通道，
 * Cordis 插件的 slot 体系里也没有对应插槽。所以插件能做的是「管理这个补丁」。
 *
 * 写入方式：asar 只按 header 里每个条目的 offset/size 读取文件内容，所以
 * `lib/main.js` 的内容可以被搬到同一份 asar 的别处：
 *   1. 把改好的 `main.js` 追加到 asar 文件末尾（或长度不变时原地写）；
 *   2. 把 header 里 `lib/main.js` 的 offset/size 指向新位置；
 *   3. 同步 header 里的 SHA256（hash 与 blocks[0]）。
 * 三处替换都保持字节数不变（offset 9 位、size 6 位、hash 64 位），
 * 因此 header 长度、dataOffset、其他文件的位置全都不动。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** 应用菜单块里唯一的锚点。 */
const APP_ANCHOR = "currentDesktopLocale().messages.restartAppHostMenu";
/** 应用菜单：开发模式条件（原始 / 补丁后，等长 18 字节）。 */
const DEV_OLD = Buffer.from("...development ? [", "utf8");
const DEV_NEW = Buffer.from("...true        ? [", "utf8");
/** 应用菜单：「刷新页面」项（原始 / 补丁后隐藏，等长 14 字节）。 */
const RELOAD_OLD = Buffer.from('role: "reload"', "utf8");
const RELOAD_NEW = Buffer.from("visible: false", "utf8");

/** 托盘菜单：分隔线到「退出」项开头这段是唯一锚点。 */
const TRAY_SEPARATOR = '\t\t\t{ type: "separator" },\n';
const TRAY_QUIT_HEAD = '\t\t\t{\n\t\t\t\tlabel: messages.quitApplication,';
const TRAY_OLD_TEXT = TRAY_SEPARATOR + TRAY_QUIT_HEAD;
const TRAY_INSERT_TEXT =
	TRAY_SEPARATOR +
	[
		"\t\t\t{",
		"\t\t\t\tlabel: `${messages.restartApplication} DeepSeek Harness`,",
		"\t\t\t\tclick: () => {",
		"\t\t\t\t\tapp.relaunch();",
		"\t\t\t\t\tquitWithoutConfirmation();",
		"\t\t\t\t}",
		"\t\t\t},",
	].join("\n") +
	"\n" +
	TRAY_QUIT_HEAD;
const TRAY_OLD = Buffer.from(TRAY_OLD_TEXT, "utf8");
const TRAY_NEW = Buffer.from(TRAY_INSERT_TEXT, "utf8");

/** 菜单块内字节到锚点的最大距离，用于防止跨块误匹配。 */
const MAX_SPAN = 4000;

export class MenuPatchError extends Error {}

function fail(message) {
	throw new MenuPatchError(message);
}

/**
 * Host 进程同样运行在 Electron 的 Node 模式里，fs 会经过 asar 透明层：
 * 直接读写 app.asar 会被当作「asar 内部路径」而报 ENOENT。
 * 本模块的 asar 读写都是同步的，所以临时关闭该层再恢复是安全的。
 */
function guardAsar(operation) {
	const previous = process.noAsar;
	process.noAsar = true;
	try {
		return operation();
	} finally {
		process.noAsar = previous;
	}
}

/** 在 buffer 的 [from, to) 范围内找出所有 match 的位置。 */
function findAll(buffer, match, from = 0, to = buffer.length) {
	const positions = [];
	let index = buffer.indexOf(match, from);
	while (index !== -1 && index < to) {
		if (index + match.length <= to) positions.push(index);
		index = buffer.indexOf(match, index + 1);
	}
	return positions;
}

/** 把唯一命中处的字节换掉；长度可以不同。 */
function splice(buffer, at, removeLength, insert) {
	return Buffer.concat([buffer.subarray(0, at), insert, buffer.subarray(at + removeLength)]);
}

/** 定位 app.asar：Desktop 的 asar 就在可执行文件同级的 resources 目录里。 */
export function resolveAsarPath() {
	const candidates = [];
	if (process.env.DSH_DESKTOP_ASAR) candidates.push(process.env.DSH_DESKTOP_ASAR);
	if (process.env.DSH_DIR) candidates.push(path.join(process.env.DSH_DIR, "resources", "app.asar"));
	// Electron 主进程里 execPath 是 DeepSeek Harness.exe，同级 resources 下就是 app.asar
	if (process.execPath) candidates.push(path.join(path.dirname(process.execPath), "resources", "app.asar"));
	// 在 Electron 主进程里 process.resourcesPath 直接指向 resources 目录
	if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, "app.asar"));
	// Windows 上 Desktop 的默认安装位置，作为最后兜底
	candidates.push(path.join(process.env.LOCALAPPDATA ?? "", "Programs", "DeepSeek Harness", "resources", "app.asar"));

	for (const candidate of candidates) {
		if (!candidate) continue;
		try {
			if (fs.existsSync(candidate)) return candidate;
		} catch {
			/* 探测下一个 */
		}
	}
	return null;
}

/** 解析 asar 头：dataOffset、lib/main.js 的范围、header 文本位置。 */
function readAsarLayout(buffer) {
	if (buffer.length < 16) fail("app.asar 太小，不是有效的 asar 文件");
	if (buffer.readUInt32LE(0) !== 4) fail("asar 头格式不符合预期（起始标记不是 4）");
	const headerPickleSize = buffer.readUInt32LE(4);
	const jsonLength = buffer.readUInt32LE(12);
	const headerRange = { start: 16, end: 16 + jsonLength };
	if (headerRange.end > buffer.length) fail("asar 头长度越界");
	const header = JSON.parse(buffer.toString("utf8", headerRange.start, headerRange.end));
	const dataOffset = 8 + headerPickleSize;

	const mainEntry = header?.files?.lib?.files?.["main.js"];
	if (!mainEntry) fail("app.asar 里找不到 lib/main.js");
	const offset = Number(mainEntry.offset);
	const size = Number(mainEntry.size);
	if (!Number.isFinite(offset) || !Number.isFinite(size)) fail("lib/main.js 的 offset/size 不是数字");
	const start = dataOffset + offset;
	const end = start + size;
	if (end > buffer.length) fail("lib/main.js 范围越界");

	return { dataOffset, headerRange, offset, size, start, end, integrity: mainEntry.integrity };
}

/** 判断 A（应用菜单）当前状态与可编辑位置。 */
function inspectAppMenu(buffer) {
	const anchors = findAll(buffer, Buffer.from(APP_ANCHOR, "utf8"));
	if (anchors.length !== 1) fail(`锚点 "${APP_ANCHOR}" 出现 ${anchors.length} 次（应为 1 次），无法安全定位`);
	const anchor = anchors[0];

	const devOld = findAll(buffer, DEV_OLD);
	const reloadOld = findAll(buffer, RELOAD_OLD);
	const devNew = findAll(buffer, DEV_NEW);

	if (devNew.length === 1 && devNew[0] < anchor && anchor - devNew[0] <= MAX_SPAN) {
		const reloadNewAt = buffer.lastIndexOf(RELOAD_NEW, anchor);
		if (reloadNewAt > devNew[0] && reloadNewAt < anchor) {
			return { state: "patched", anchor, devNewAt: devNew[0], reloadNewAt };
		}
	}
	if (devOld.length === 1 && reloadOld.length === 1 && devOld[0] < anchor && reloadOld[0] < anchor) {
		if (reloadOld[0] < devOld[0]) fail("菜单块结构不符合预期：role: reload 出现在 development 条件之前");
		if (anchor - devOld[0] > MAX_SPAN) fail("development 条件离锚点太远");
		return { state: "pristine", anchor, devAt: devOld[0], reloadAt: reloadOld[0] };
	}
	fail(
		"A（应用菜单）既不是原始状态也不是本补丁状态，可能是 DSH 升级换了菜单结构。" +
			`\n  "..development ? [" 命中 ${devOld.length} 处；"role: \\"reload\\"" 命中 ${reloadOld.length} 处；` +
			`"..true        ? [" 命中 ${devNew.length} 处`,
	);
}

/** 判断 B（托盘菜单）当前状态与可编辑位置。 */
function inspectTray(buffer) {
	const inserted = findAll(buffer, TRAY_NEW);
	const original = findAll(buffer, TRAY_OLD);
	if (inserted.length === 1 && original.length === 0) return { state: "patched", at: inserted[0] };
	if (original.length === 1 && inserted.length === 0) return { state: "pristine", at: original[0] };
	fail(
		"B（托盘菜单）既不是原始状态也不是本补丁状态，可能是 DSH 升级改了托盘菜单。" +
			`\n  已打补丁的片段命中 ${inserted.length} 处；原始片段命中 ${original.length} 处`,
	);
}

/** 读取 asar 全文与两处补丁的状态。 */
function load() {
	return guardAsar(() => {
		const asar = resolveAsarPath();
		if (!asar) fail("找不到 app.asar（DSH Desktop 安装目录下的 resources/app.asar）");
		const buffer = fs.readFileSync(asar);
		const layout = readAsarLayout(buffer);
		const main = buffer.subarray(layout.start, layout.end);
		return { asar, buffer, layout, main, appMenu: inspectAppMenu(main), tray: inspectTray(main) };
	});
}

/** 只读：当前补丁状态。 */
export function inspectMenuPatch() {
	try {
		const { asar, layout, appMenu, tray } = load();
		return {
			ok: true,
			asar,
			installed: appMenu.state === "patched" && tray.state === "patched",
			appMenu: appMenu.state === "patched",
			trayMenu: tray.state === "patched",
			mainJsSize: layout.size,
		};
	} catch (error) {
		return { ok: false, error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * 把改好的 main.js 落盘：长度不变就原地写，变了就追加到 asar 末尾并改 header。
 * 两种情况都要同步 header 里的 SHA256。
 */
function writeMainJs(asar, buffer, layout, nextMain) {
	const headerText = buffer.toString("utf8", layout.headerRange.start, layout.headerRange.end);
	const oldHash = layout.integrity?.hash;
	const nextHash = createHash("sha256").update(nextMain).digest("hex");
	if (Array.isArray(layout.integrity?.blocks) && layout.integrity.blocks.length > 1) {
		fail("lib/main.js 跨多个 hash 块，本补丁不支持自动同步");
	}

	const writeAt = (fd, bytes, at) => {
		const written = fs.writeSync(fd, bytes, 0, bytes.length, at);
		if (written !== bytes.length) fail(`写入 offset ${at} 失败：只写了 ${written} 字节`);
	};

	const sameLength = nextMain.length === layout.size;
	const appendAt = sameLength ? layout.start : buffer.length;
	const nextOffset = sameLength ? layout.offset : appendAt - layout.dataOffset;

	let nextHeader = headerText;
	if (nextOffset !== layout.offset || nextMain.length !== layout.size) {
		const oldEntry = `"size":${layout.size},"offset":"${layout.offset}"`;
		const newEntry = `"size":${nextMain.length},"offset":"${nextOffset}"`;
		if (newEntry.length !== oldEntry.length) {
			fail(`header 条目长度会变化（${oldEntry.length} → ${newEntry.length}），本补丁要求等长`);
		}
		if (findAll(Buffer.from(headerText, "utf8"), Buffer.from(oldEntry, "utf8")).length !== 1) {
			fail(`header 中找不到唯一的 "${oldEntry}"，asar 结构可能已变化`);
		}
		nextHeader = nextHeader.replace(oldEntry, newEntry);
	}
	if (oldHash !== undefined && oldHash !== nextHash) {
		if (findAll(Buffer.from(nextHeader, "utf8"), Buffer.from(oldHash, "utf8")).length !== 2) {
			fail("header 中找不到 2 处旧 SHA256，无法同步完整性信息");
		}
		nextHeader = nextHeader.split(oldHash).join(nextHash);
	}
	if (Buffer.byteLength(nextHeader, "utf8") !== headerText.length) {
		fail("header 文本长度发生变化，拒绝写入");
	}

	guardAsar(() => {
		const fd = fs.openSync(asar, "r+");
		try {
			writeAt(fd, nextMain, appendAt);
			if (nextHeader !== headerText) {
				writeAt(fd, Buffer.from(nextHeader, "utf8"), layout.headerRange.start);
			}
			fs.fsyncSync(fd);
		} finally {
			fs.closeSync(fd);
		}
	});

	return { appended: !sameLength, nextOffset };
}

/** 应用补丁（两处都装）；幂等。 */
export function installMenuPatch() {
	return guardAsar(() => {
		const { asar, buffer, layout, main, appMenu, tray } = load();
		if (appMenu.state === "patched" && tray.state === "patched") {
			return { ok: true, installed: true, changed: false, asar, message: "补丁已经在生效，无需重复安装" };
		}

		let next = main;
		if (tray.state === "pristine") next = splice(next, tray.at, TRAY_OLD.length, TRAY_NEW);
		if (appMenu.state === "pristine") {
			const reloadAt = next.indexOf(RELOAD_OLD);
			if (reloadAt === -1) fail("生成补丁时找不到 role: reload");
			next = splice(next, reloadAt, RELOAD_OLD.length, RELOAD_NEW);
			const devAt = next.indexOf(DEV_OLD);
			if (devAt === -1) fail("生成补丁时找不到 development 条件");
			next = splice(next, devAt, DEV_OLD.length, DEV_NEW);
		}
		if (next.equals(main)) fail("生成的内容与现有内容相同，但状态判定为未打补丁");

		const written = writeMainJs(asar, buffer, layout, next);
		const after = inspectMenuPatch();
		if (!after.ok || !after.installed) fail(`写入后自校验失败：${after.error ?? JSON.stringify(after)}`);

		return {
			ok: true,
			installed: true,
			changed: true,
			asar,
			appended: written.appended,
			message:
				"已安装：重启 DSH Desktop 后，托盘图标右键菜单与左上角「应用」菜单里都会出现「重启」项（就在「退出」上方）",
		};
	});
}

/** 还原两处补丁；幂等。 */
export function uninstallMenuPatch() {
	return guardAsar(() => {
		const { asar, buffer, layout, main, appMenu, tray } = load();
		if (appMenu.state === "pristine" && tray.state === "pristine") {
			return { ok: true, installed: false, changed: false, asar, message: "当前是原始状态，无需还原" };
		}

		let next = main;
		if (appMenu.state === "patched") {
			next = splice(next, appMenu.reloadNewAt, RELOAD_NEW.length, RELOAD_OLD);
			next = splice(next, appMenu.devNewAt, DEV_NEW.length, DEV_OLD);
		}
		if (tray.state === "patched") {
			const at = next.indexOf(TRAY_NEW);
			if (at === -1) fail("还原时找不到托盘菜单补丁片段");
			next = splice(next, at, TRAY_NEW.length, TRAY_OLD);
		}
		if (next.equals(main)) fail("生成的内容与现有内容相同，但状态判定为已打补丁");

		const written = writeMainJs(asar, buffer, layout, next);
		const after = inspectMenuPatch();
		if (!after.ok || after.installed) fail(`还原后自校验失败：${after.error ?? JSON.stringify(after)}`);

		return {
			ok: true,
			installed: false,
			changed: true,
			asar,
			appended: written.appended,
			message: "已还原：重启 DSH Desktop 后，两个菜单都恢复原样",
		};
	});
}
