# Phase 8.13 Windows notification notes

## Phase 8.13.2 notification source and icon

LanGram uses the official Tauri v2 notification plugin for desktop notifications. On Windows, the plugin is tied to the installed application identity. Tauri's official notification plugin documentation notes that Windows notifications only work correctly for installed apps and may show the PowerShell name and icon in development mode.

For this project:

- `client/src-tauri/tauri.conf.json` sets `productName` to `LanGram`.
- `client/src-tauri/tauri.conf.json` sets a stable `identifier` of `com.langram.app`.
- Native Windows icons come from `client/src-tauri/icons`, not from `client/public`.
- The Windows NSIS installer uses `client/src-tauri/icons/icon.ico` for the installer and uninstaller icons.
- The Windows NSIS installer creates the Start Menu shortcut under `LanGram`.
- The MSI bundle has a stable `upgradeCode` so Windows treats future LanGram updates as the same application.
- `notification:default` remains enabled in the default desktop capability for the main window and image preview windows.

Expected behavior:

- `npm.cmd run tauri dev` may still show notifications as `Windows PowerShell` or the terminal host. This is a development-mode limitation and should not be fixed by writing machine-specific registry entries.
- After building and installing the Windows package, notifications should be attributed to `LanGram` with the packaged LanGram icon, because the installer creates the Windows application identity and shortcut metadata.

Manual verification:

1. Start the dev client with `npm.cmd run tauri dev`.
2. Trigger a new-message notification and confirm it still appears.
3. If the source is `Windows PowerShell`, treat it as expected dev-mode behavior.
4. Build the Windows package with `npm.cmd run tauri build`.
5. Install the generated Windows package.
6. Launch LanGram from the installed shortcut or Start Menu entry.
7. Trigger a new-message notification and confirm Windows shows the source as `LanGram`.
