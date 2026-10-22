# Windows installer (NSIS, Phase 2)

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

## How CI builds it

In `.github/workflows/release.yml`, the NSIS step is gated twice:

1. It runs only if `installer/*.nsi` exists.
2. It runs only if `makensis` is available on the runner
   (`Get-Command makensis`); if makensis is missing, the step
   records `nsis_built=false` and the release simply has no
   installer artefact, instead of failing the whole release.

When both gates pass, `makensis` produces
`installer/download-manager-setup.exe`, which the packaging step
copies into `dist/` and the release step uploads alongside the
portable zip and the extension zips.

To build it locally on Windows, from the repository root:

```powershell
makensis installer/download-manager.nsi
```

The output is `installer/download-manager-setup.exe`.

## Signing

This installer is **unsigned by default**. Windows SmartScreen will
warn about an unknown publisher. Signing is a separate, later step
requiring a credential supplied through GitHub Secrets — never
committed, never printed, never in chat.

## MSI (WiX) — planned, not built

An MSI installer via WiX is documented as planned in
`docs/release.md`. No WiX project (`.wxs`) exists in this repository,
and no MSI is produced by this script or by the release workflow.
Do not claim an MSI exists until a WiX project actually builds one
on a Windows runner.
