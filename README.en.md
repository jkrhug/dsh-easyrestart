# dsh-easyrestart

> Adds native **Restart** entries above **Quit** in [DSH Desktop](https://github.com/deepseek-ai) (DeepSeek Harness for desktop).
>
> [中文](README.md) · [MIT](LICENSE)

Tray icon, right click:

```
Open DeepSeek Harness
──────────
Restart DeepSeek Harness      <- new
Quit DeepSeek Harness
```

Application menu (top left):

```
About DeepSeek Harness
──────────
Check for Updates…
Manage dsh Command
──────────
Restart App & Host      <- new
──────────
Quit
```

Both are regular `Menu.buildFromTemplate()` items of DSH Desktop itself, so font, spacing, separators and hover highlight match the native menu exactly, and the label follows your UI language.

## Why

DSH Desktop has no "restart" entry: closing the window usually just hides the app to the tray, so making a freshly installed plugin take effect means quitting from the tray and starting the app again manually. This project adds that step.

It ships as a **DSH plugin**, so you can install/revert it from the plugin manager, the `/easyrestart` command, or an agent tool.

> The repository is `dsh-easyrestart` while the plugin package is still named `dsh-easyrestart` (kept from the first release so existing installs do not need to be reinstalled).

## Install

### Option 1: as a DSH plugin (recommended)

1. Clone the repo:
   ```bash
   git clone https://github.com/jkrhug/dsh-easyrestart.git
   ```
2. Install the **`plugin/`** subdirectory into your profile, using DSH's own plugin manager (do not hand-edit the profile):
   ```
   plugin_manager  install_bundle  target = <repo path>/plugin
   ```
   Equivalent CLI (dsh-m):
   ```bash
   dshm install <repo path>/plugin
   ```
3. **Restart DSH Desktop.** Both menus now show a Restart item.

Manage it any time with `/easyrestart status | install | uninstall`, the `dsh_easyrestart` agent tool, or the plugin manager UI.

### Option 2: standalone script

```powershell
# run with the Electron bundled with DSH Desktop, in Node mode
$env:ELECTRON_RUN_AS_NODE = "1"
$env:ELECTRON_NO_ASAR = "1"
& "<Desktop install dir>\DeepSeek Harness.exe" patch/apply-menu-item.mjs --check
& "<Desktop install dir>\DeepSeek Harness.exe" patch/apply-menu-item.mjs --install
& "<Desktop install dir>\DeepSeek Harness.exe" patch/apply-menu-item.mjs --restore
```

Both options share the same implementation (`plugin/lib/menu-patch.js`) and are idempotent.

## How it works

Both menus are built in the Electron **main process** with `Menu.buildFromTemplate()`. They are native OS menus, outside DSH's Cordis slot system, and neither the renderer (`window.dshDesktop`) nor the host process exposes any quit / relaunch / menu extension point. So a menu item cannot be "registered" — the plugin patches `lib/main.js` inside `resources/app.asar`.

**A. Tray menu — insert an item.** `DesktopTray.relabel()` builds "Open / separator / Quit"; the patch inserts before Quit:

```js
{
  label: `${messages.restartApplication} DeepSeek Harness`,
  click: () => {
    app.relaunch();
    quitWithoutConfirmation();
  }
},
```

This makes `main.js` longer. Asar reads each entry via offset/size from the header, so the patched `main.js` is **appended to the end of the asar file** and the header entry for `lib/main.js` is repointed — every other file keeps its position.

**B. Application menu — equal-length swap.** The item already exists but is gated behind `development` (`!app.isPackaged`):

| Location | Original | Patched | Length |
| --- | --- | --- | --- |
| `development` guard | `...development ? [` | `...true        ? [` | 18 → 18 |
| "Reload page" item | `role: "reload"` | `visible: false` | 14 → 14 |

Both changes recompute and rewrite the `lib/main.js` SHA256 in the asar header (`hash` and `blocks[0]`, equal-length hex), keeping Electron's integrity data consistent. Header text length never changes, so `dataOffset` and all absolute file positions stay put.

## Compatibility

- **DSH Desktop on Windows** (Electron). On the web build there are no native menus, so nothing is added.
- Writing requires permission on the Desktop install directory (`resources/app.asar`); otherwise you get `EPERM`.
- **A DSH Desktop upgrade reinstalls `app.asar`**, which removes the patch. Run `install` once after upgrading; if the anchors are missing it fails loudly instead of writing garbage.
- Only the bytes above change inside `lib/main.js`; nothing is repacked, no other file is touched, and `--restore` works by reverse lookup (no backup file needed).
- Each length-changing operation appends ~517 KB of `main.js` to the asar; repeated install/restore slowly grows the file.

## Layout

```
.
├─ plugin/                  the DSH plugin (install target)
│  ├─ index.js              registers tool dsh_easyrestart + command /easyrestart
│  ├─ lib/menu-patch.js     patch core: locate asar, detect state, install, revert, sync SHA256
│  ├─ cordis.patch.yml      inserts this plugin into the current profile
│  ├─ locale/               plugin manager title (zh/en)
│  └─ icon.svg
├─ patch/
│  └─ apply-menu-item.mjs   CLI entry point (same implementation as the plugin)
├─ tools/                   read-only research helpers: extract a file from asar / search bytes
└─ LICENSE
```

## FAQ

**Nothing changed after install?** Menus are built at app start — quit DSH Desktop completely and open it again (closing the window may only hide it to the tray).

**Does it break auto-update?** The patch only rewrites `main.js` bytes and its own SHA256; asar structure and other files are untouched. A Desktop upgrade overwrites the whole `app.asar`, so the patch simply disappears — reinstall it.

**Why not a pure plugin?** See "How it works" — native menus expose no registration point to plugins.

## License

[MIT](LICENSE)
