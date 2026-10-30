# dsh-easyrestart（DSH 插件）

给 DSH Desktop 的两处菜单加上原生「重启」项，位置都在「退出」上方：

| 菜单 | 新项 | 怎么打开 |
| --- | --- | --- |
| **托盘图标右键菜单** | 重启 DeepSeek Harness | 右下角系统托盘里的 DSH 图标，右键 |
| 左上角「应用」菜单 | 重启应用与 Host | 点左上角「应用」 |

两项都是 DSH Desktop 主程序自带的菜单项（原本被开发模式条件关闭 / 由模板构建），所以字体、间距、悬停高亮、分隔线都与原版完全一致，语言跟随界面语言。

## 用法

装好并重启 Desktop 后：

- **托盘图标右键** → 「打开 DeepSeek Harness」/「重启 DeepSeek Harness」/「退出 DeepSeek Harness」；
- **「应用」菜单** → 「检查更新…」/「管理 dsh 命令」/「重启应用与 Host」/「退出」；
- 想用命令管理：`/easyrestart status`、`/easyrestart install`、`/easyrestart uninstall`；
- 也可以直接让 agent 调用工具 `dsh_easyrestart`（`action` = `status` / `install` / `uninstall`）。

安装或还原后都需要**重启 DSH Desktop** 才会生效（主进程菜单在启动时构建）。

## 为什么插件要改 `app.asar`

这两处菜单都由 Electron **主进程**用 `Menu.buildFromTemplate()` 生成，是操作系统级原生菜单，不在 Cordis 的 slot 体系里；页面侧（`window.dshDesktop`）和 host 进程都没有任何 quit / relaunch / menu 扩展通道。所以插件无法「注册」一个菜单项，只能改主进程代码。

改法有两处：

**A. 托盘菜单（新增一项）** —— 在 `DesktopTray.relabel()` 的模板里，「打开」与「退出」之间插入：

```js
{
  label: `${messages.restartApplication} DeepSeek Harness`,
  click: () => {
    app.relaunch();
    quitWithoutConfirmation();
  }
},
```

这会让 `lib/main.js` 变长。asar 只按 header 里的 offset/size 读文件，所以把新的 `main.js` **追加到 asar 文件末尾**、再把 header 里 `lib/main.js` 的 offset/size 指过去即可，其他文件完全不受影响。

**B. 「应用」菜单（原来就有、被关掉）** —— 等长字节替换：

| 位置 | 原来 | 改成 | 长度 |
| --- | --- | --- | --- |
| `development` 条件 | `...development ? [` | `...true        ? [` | 18 → 18 |
| 「刷新页面」项 | `role: "reload"` | `visible: false` | 14 → 14 |

两种改动都会重算并同步 asar header 中 `lib/main.js` 的 SHA256（`hash` 与 `blocks[0]`，都是等长 64 位 hex），保持完整性信息一致；header 文本长度不变，所以 `dataOffset` 与所有文件的绝对位置都不动。

## 文件清单

| 文件 | 作用 |
| --- | --- |
| `package.json` | 包清单：`dsh.bundle.patch`、`./locale/*.json`、`./icon` 导出 |
| `cordis.patch.yml` | 把 `dsh-easyrestart` 这一行插进当前 profile |
| `index.js` | Host 半：注册工具 `dsh_easyrestart` 与命令 `/easyrestart` |
| `lib/menu-patch.js` | 补丁核心：定位 asar、判断两处状态、安装、还原、同步 SHA256 |
| `locale/zh.json`、`locale/en.json` | 插件管理页显示的名称与描述 |
| `icon.svg` | 插件图标（原创） |

## 行为说明

- **幂等**：已安装时 `install` 只报告状态；已还原时 `uninstall` 同样只报告。
- **安全**：写入前先在内存里生成目标 `main.js` 并核对锚点唯一性；写入后再读回、重新判定状态，不一致就报错。
- **Host 进程要临时关掉 asar 透明层**（`process.noAsar = true`）才能直接读写 `app.asar`，本模块的读写都是同步的，用完立刻恢复。
- **DSH Desktop 升级后**补丁会随 `app.asar` 一起被替换掉，重跑一次 `install` 即可（锚点找不到时会明确报错，不会乱写）。
- 需要写 Desktop 的 `resources/app.asar`；路径按 `process.execPath` / `process.resourcesPath` 探测，可用环境变量 `DSH_DESKTOP_ASAR` 覆盖。权限不足时会报 `EPERM`。
- 只在 Windows 桌面版有实际菜单效果；Web 端没有这些原生菜单。
- 每次内容长度变化都会往 asar 末尾追加一份 `main.js`（约 517 KB），旧数据成为不影响读取的空闲区。

## 手动兜底

同一个工作区里的 `../patch/apply-menu-item.mjs` 是同一套逻辑的独立脚本（可脱离插件运行）：`--check` / `--install` / `--restore`。`../README.md` 记录了更完整的调研过程与 asar 结构。
