# Pairing the extension with the desktop app (Native Messaging)

> **Status: host implemented; Windows/browser pairing NOT verified.** The
> Rust `dm-native-host` binary is implemented in `engine/src/native_host.rs`
> and protocol-tested on Linux. The current Linux checkout has not built
> or run the Windows host. A Tauri application and NSIS build path now
> exist, but their Windows build/install/start path and registration UI
> have not completed CI verification. Follow the steps below and complete the
> verification on Windows before claiming browser integration works.

## 1. Terms

| Term | Value — must match exactly in all three places |
|---|---|
| Host name | `com.downloadmanager.nextgen` |
| Extension code | `background.js` calls `chrome.runtime.connectNative('com.downloadmanager.nextgen')` |
| Host manifest | `native-host/com.downloadmanager.nextgen.json`, field `"name"` |
| Registry key | `…\NativeMessagingHosts\com.downloadmanager.nextgen` (see `install-chrome.reg`) |

If any one of these differs (typo, different name), Chrome reports
"Specified native messaging host not found" and the popup will show
**Disconnected** — that is the correct, honest result, not a bug to paper over.

## 2. Install steps (Windows)

1. **Build/install both executables.** On Windows, `cargo build --release`
   produces `dm.exe` and `dm-native-host.exe` in `engine/target/release/`.
   Place both in the same per-user application directory; the host searches
   for `dm.exe` alongside itself. The Tauri NSIS bundle is configured to
   include both binaries, but that installer has not yet passed its Windows
   workflow smoke test.
2. **Load the extension unpacked** (development) in Chrome/Edge/Brave:
   `chrome://extensions` → Developer mode ON → Load unpacked →
   select `extension/`. Copy the extension ID from each browser you want
   to pair.
3. **Register it**: in the installed desktop app, open Browser Integration,
   enter the unpacked extension ID(s), and select **Register Native
   Messaging host**. This writes the host manifest and per-user HKCU keys
   for Chrome, Edge and Brave. For manual developer pairing, edit the host
   manifest template's `path` and `allowed_origins` fields, copy it to a
   stable location and import the matching registry file; never import
   its placeholder paths.
4. **The host protocol** (for the desktop-app implementer): Native
   Messaging framing — each message is a 4-byte little-endian length
   prefix + one UTF-8 JSON object, over stdin/stdout. Logical messages
   (see `background.js` header):
   - In: `{"type":"ping"}` → Out: `{"type":"pong","hostVersion":"…"}`.
   - In: `{"type":"download_request","url":"https://…","filename":"…","pageUrl":"…"}` →
     Out: `{"type":"download_ack","url":"…","queued":true}` or
     `{"type":"download_error","url":"…","error":"…"}`.
   - The host must exit when stdin closes (browser closed / port
     disconnected) and must never request or log cookies, passwords, or
     tokens — the extension never sends them.

## 3. How pairing is verified (the only acceptable proof)

1. Open the extension popup → click **Check connection**.
2. **Connected** = the host actually replied `pong` to a live ping in
   this session. The popup's default state is **Unknown**, and a failed
   ping shows **Disconnected** with the browser's error text.
3. Then, on an http(s) page: enable the site toggle, click **Scan this
   page**, click a `⬇ DM` button next to a link, and confirm the desktop
   app queues that URL.
4. If step 2 shows Disconnected, check in order: (a) registry key path
   and JSON location match, (b) JSON `"name"` and `"allowed_origins"`
   (extension ID + trailing slash), (c) `"path"` executable exists and
   is runnable, (d) browser was restarted after registration,
   (e) browser console (`chrome://extensions` → extension → Service
   worker → Inspect) for the exact `connectNative` error.

## 4. Unpairing / uninstall

- The configured NSIS post-uninstall hook removes this host's per-user
  registry keys and generated manifest while preserving download history.
  Remove the extension separately from
  `chrome://extensions`. Revoking the extension's per-site permissions
  is done in the extension's Details → Site access, or by toggling sites
  off in the popup (which calls `chrome.permissions.remove`).

## 5. Security notes

- The host runs as the current user with that user's privileges — keep
  its privileges minimal and never run it elevated.
- `allowed_origins` is an allowlist, not a suggestion: only the listed
  extension ID may connect. A different extension (or a web page) cannot
  use this host.
- The extension never sends cookies, credentials, or page content to
  the host — only the user-chosen http(s) URL, an optional filename
  derived from that URL's path, and the page URL for the per-site check.
