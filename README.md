# dsh-easyrestart

> 给 **DSH Desktop**（DeepSeek Harness 桌面版）的菜单加一个原生「重启」项，就在「退出」上面。
> Adds native *Restart* entries above *Quit* in DSH Desktop's tray menu and Application menu.
>
> [English](README.en.md) · [MIT](LICENSE)

托盘图标右键：

```
打开 DeepSeek Harness
──────────
重启 DeepSeek Harness      ← 新增
退出 DeepSeek Harness
```

左上角「应用」菜单：

```
关于 DeepSeek Harness
──────────
检查更新…
管理 dsh 命令
──────────
重启应用与 Host      ← 新增
──────────
退出
```

两项都是 DSH Desktop 自己的 `Menu.buildFromTemplate()` 菜单项——字体、间距、分隔线、悬停高亮全部沿用系统原生样式，文案跟随界面语言（中文「重启」/ 英文「Restart」）。

## 为什么需要它

DSH Desktop 目前没有「重启应用」的入口：关窗口往往只是隐藏到托盘，想让新装的插件生效只能从托盘「退出」再手动打开。这个项目补上这一步。

它是**插件**：装上以后可以用 `/easyrestart`、插件管理页或 agent 工具随时安装/还原，不用记命令。

> 仓库名是 `dsh-easyrestart`，插件包名仍是 `dsh-easyrestart`（沿用初版，已安装过的用户不必卸载重装）。

## 安装

### 方式一：从 GitHub 安装（推荐）

```bash
dsh plugin --profile desktop add github:jkrhug/dsh-easyrestart
```

本机已有源码时，也可以按目录安装：

```bash
dsh plugin --profile desktop add /path/to/dsh-easyrestart
```

> 用 `desktop` profile —— 本插件只在 DSH Desktop 生效，Web profile 装了不会有可见变化。

装好后 **重启 DSH Desktop**，两个菜单里就会出现「重启」项。

装好后可以随时通过以下任一方式管理：

- `/easyrestart status | install | uninstall`
- agent 工具 `dsh_easyrestart`
- 插件管理页里的「重启 dsh」一行

### 方式二：独立脚本（不走插件）

```powershell
# 用 DSH Desktop 自带的 Electron 以 Node 模式运行
$env:ELECTRON_RUN_AS_NODE = "1"
$env:ELECTRON_NO_ASAR = "1"
& "<Desktop 安装目录>\DeepSeek Harness.exe" patch/apply-menu-item.mjs --check
& "<Desktop 安装目录>\DeepSeek Harness.exe" patch/apply-menu-item.mjs --install
& "<Desktop 安装目录>\DeepSeek Harness.exe" patch/apply-menu-item.mjs --restore
```

`--check` 看状态，`--install` 装补丁，`--restore` 还原。两种方式共用同一份实现，可以互相接力。

## 分类与权限

- **能力分类**：界面与体验
- **权限**：需要写 DSH Desktop 安装目录下的 `resources/app.asar`（权限不足会报 `EPERM`）。除此之外不写任何文件。
- **外部服务**：无。不联网、不上报、不收集任何数据。
- **平台**：Windows 桌面版（Electron）。

## 真实输出

```
$ dsh_easyrestart status
app.asar：D:\deepseek\resources\app.asar
菜单项：已就位（应用菜单有，托盘菜单有）
```

## 原理

这两处菜单都由 Electron **主进程**用 `Menu.buildFromTemplate()` 构建，属于操作系统级原生菜单，不在 DSH 的 Cordis slot 体系里；页面侧与 host 进程也没有 quit / relaunch / menu 的扩展通道。所以无法「注册」一个菜单项，只能改主进程代码——也就是 Desktop 安装目录下 `resources/app.asar` 里的 `lib/main.js`。

**A. 托盘菜单：插入一项。** `DesktopTray.relabel()` 的模板原本是「打开 / 分隔线 / 退出」，补丁在分隔线后插入：

```js
{
  label: `${messages.restartApplication} DeepSeek Harness`,
  click: () => {
    app.relaunch();
    quitWithoutConfirmation();
  }
},
```

这会让 `main.js` 变长。asar 只按 header 里每个条目的 offset/size 读取内容，所以把改好的 `main.js` **追加到 asar 文件末尾**、再把 header 里 `lib/main.js` 的 offset/size 指过去即可，其他文件位置完全不动。

**B. 「应用」菜单：等长替换。** 这个菜单项原本就在代码里，只是被 `development`（`!app.isPackaged`）条件关掉了：

| 位置 | 原来 | 改成 | 长度 |
| --- | --- | --- | --- |
| `development` 条件 | `...development ? [` | `...true        ? [` | 18 → 18 |
| 「刷新页面」项 | `role: "reload"` | `visible: false` | 14 → 14 |

两种改动都会重算并同步 header 里 `lib/main.js` 的 SHA256（`hash` 与 `blocks[0]`，等长 64 位 hex），保持 Electron 的完整性校验一致；header 文本长度不变，所以 `dataOffset` 和所有文件的绝对位置都不动。

## 兼容性

- **DSH Desktop for Windows**（Electron）。Web 端没有这些原生菜单，装了也不会有可见变化。
- 写入需要能修改 Desktop 安装目录（`resources/app.asar`）。权限不足时会得到 `EPERM`。
- **DSH Desktop 升级会重装 `app.asar`**，补丁随之消失；升级后重跑一次 `install` 即可。锚点找不到时会明确报错，不会乱写。
- 已在 DSH Desktop `0.2.1-rc.5`（Windows）上验证通过；`0.2.1-rc.3`（含）以前也适用。
- 只改 `lib/main.js` 的上述字节，不重打包、不动其他文件；`--restore` 是反向定位，不依赖备份。
- 每次内容长度变化都会往 asar 末尾追加一份 `main.js`（约 517 KB），反复安装/还原会让文件缓慢变大。

## 目录结构

```
.
├─ package.json             插件清单：包名、版本、exports、cordis.patch.yml
├─ index.js                 Host 半：注册工具 dsh_easyrestart 与命令 /easyrestart
├─ lib/menu-patch.js        补丁核心：定位 asar、判状态、安装、还原、同步 SHA256
├─ cordis.patch.yml         把本插件插进当前 profile
├─ locale/                  插件管理页的显示名（中/英）
├─ icon.svg
├─ docs/implementation.md   实现细节：为什么改 asar、文件清单、行为说明
├─ patch/
│  └─ apply-menu-item.mjs   命令行入口（插件与脚本共用同一实现）
├─ tools/                   只读调研脚本：从 asar 提取文件 / 按关键词搜字节
├─ README.md / README.en.md
├─ CONTRIBUTING.md
└─ LICENSE
```

## 常见问题

**装完没反应？** 菜单在应用启动时构建，必须完全退出 Desktop 再打开（关窗口可能只是隐藏到托盘，要从托盘「退出」）。

**会不会影响自动更新？** 补丁只改 `main.js` 内容并同步它自己的 SHA256，不碰 asar 结构和其他文件。Desktop 升级会覆盖整个 `app.asar`，补丁自然失效，重装一次即可。

**为什么不能用纯插件实现？** 见上文「原理」——原生菜单没有对插件开放的注册通道。

## License

[MIT](LICENSE)
