# Legacy CLI installer script (NSIS)

## What it is

`download-manager.nsi` is a real NSIS installer script. It installs,
per user (no admin rights required):

- `dm.exe` — the Rust download-engine CLI
- `README.md` and `LICENSE`
- A Start Menu shortcut to `dm.exe`
- An uninstaller (`uninstall.exe`) plus a per-user
  Add/Remove Programs entry (`HKCU\...\Uninstall\DownloadManager`)

The shortcut points at the CLI engine, not a GUI. There is no Tauri
desktop app yet, so `dm.exe` must be run from a terminal, for example
`dm <URL> <DEST>`. The installer does not pretend otherwise.

## Standalone CLI installer

`download-manager.nsi` packages only the `dm.exe` CLI. It is not the
desktop application installer and is not used by the current release
workflow. The Tauri installer path is configured under `ui/src-tauri/`.

To build the standalone CLI installer locally on Windows, from the repository root:

```powershell
makensis installer/download-manager.nsi
```

The output is `installer/download-manager-setup.exe`.

## Tauri desktop installer

The application NSIS bundle is configured in `ui/src-tauri/tauri.conf.json`.
Windows run `39866677122` built it, silently installed it, and verified the
desktop process remained running during the startup smoke test. New desktop
and Native Messaging E2E automation is pending its first run; manual Windows
10/11 testing remains outstanding.

## Signing

This installer is **unsigned by default**. Windows SmartScreen will
warn about an unknown publisher. Signing is a separate, later step
requiring a credential supplied through GitHub Secrets — never
committed, never printed, never in chat.

## MSI (WiX) — not implemented

No WiX project (`.wxs`) exists in this repository, and no MSI is produced
by either installer path. Do not claim an MSI exists until a WiX project
actually builds one on a Windows runner.
