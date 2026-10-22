; Download Manager — NSIS installer (Phase 2, unsigned by default)
;
; What this installs:
;   - dm.exe            the Rust download-engine CLI, built by CI
;                       (engine/target/release/dm.exe on windows-latest)
;   - README.md, LICENSE
;   - A Start Menu shortcut to dm.exe (CLI: run it from a terminal,
;     e.g. `dm <URL> <DEST>`; it is NOT a GUI yet — no Tauri app exists)
;   - An uninstaller (uninstall.exe) + HKCU Uninstall registry entry
;
; How to build (from the REPOSITORY ROOT, not from installer/):
;   makensis installer/download-manager.nsi
; Output: installer/download-manager-setup.exe
;
; Per-user install: InstallDir is $LOCALAPPDATA, RequestExecutionLevel
; is "user", so no administrator rights are required. This is
; deliberate for an unsigned Phase 2 build: it avoids a UAC prompt
; for an unknown-publisher installer while still giving a clean
; uninstall. A per-machine install ($PROGRAMFILES + admin) is a
; later decision, once signing exists.
;
; MSI via WiX: NOT built by this script. WiX is documented as planned
; in docs/release.md; do not claim an MSI exists because this file does.
;
; This installer is UNSIGNED by default. Windows SmartScreen will
; warn about an unknown publisher until a signing step (GitHub
; Secrets, never committed, never in chat) is added in a later phase.

!define APP_NAME "Download Manager"
!define APP_VERSION "0.1.0"
!define APP_PUBLISHER "Download Manager (open source)"
!define APP_EXE "dm.exe"

Unicode true
Name "${APP_NAME} ${APP_VERSION}"
OutFile "installer/download-manager-setup.exe"
InstallDir "$LOCALAPPDATA\Download Manager"
RequestExecutionLevel user

; Pages: directory choice, then install, then finish.
Page directory
Page instfiles

Section "Main" SecMain
  SetOutPath "$INSTDIR"
  ; Built by CI on windows-latest: engine/target/release/dm.exe.
  ; If this file is missing, makensis fails here — that is deliberate:
  ; an installer must never ship without the engine binary.
  File "engine\target\release\dm.exe"
  File "README.md"
  File "LICENSE"

  ; Start Menu shortcut to the CLI engine.
  CreateDirectory "$SMPROGRAMS\Download Manager"
  CreateShortcut "$SMPROGRAMS\Download Manager\Download Manager.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$SMPROGRAMS\Download Manager\Read Me.lnk" "$INSTDIR\README.md"

  ; Uninstaller + Add/Remove Programs entry (per-user, HKCU).
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DownloadManager" "DisplayName" "${APP_NAME} ${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DownloadManager" "UninstallString" "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DownloadManager" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DownloadManager" "Publisher" "${APP_PUBLISHER}"
SectionEnd

Section "Uninstall" SecUninstall
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\README.md"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\uninstall.exe"
  Delete "$SMPROGRAMS\Download Manager\Download Manager.lnk"
  Delete "$SMPROGRAMS\Download Manager\Read Me.lnk"
  RMDir "$SMPROGRAMS\Download Manager"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\DownloadManager"
  RMDir "$INSTDIR"
SectionEnd
