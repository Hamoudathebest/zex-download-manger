# Pairing the extension with the desktop app (Native Messaging)

> **Status: NOT tested on Windows here.** This workspace has no Windows
> machine and no built desktop host yet. The steps below are the exact
> procedure to verify on a real Windows + Chrome/Edge/Brave install. Do
> not present pairing as working until the verification step at the end
> passes on that machine.

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

1. **Install the desktop app + host executable.** (Out of scope for this
   Phase 1 extension deliverable — no `.exe` is provided here.) Note its
   real install path, e.g. `C:\Program Files\DownloadManagerNextGen\idm-nextgen-host.exe`.
2. **Load the extension unpacked** (development) in Chrome/Edge/Brave:
   `chrome://extensions` → Developer mode ON → Load unpacked →
   select `download-manager/extension/`. Copy the extension ID shown there.
   Once published, use the Web Store ID instead — and update step 3.
3. **Edit the host manifest** (`native-host/com.downloadmanager.nextgen.json`):
   - `"path"`: the real host `.exe` path from step 1.
   - `"allowed_origins"`: `["chrome-extension://<REAL_EXTENSION_ID>/"]`
     — replace the placeholder, keep the trailing `/`.
   - `"name"`: must stay `com.downloadmanager.nextgen`.
   - `"type"`: must stay `"stdio"`.
4. **Copy the edited JSON** to its final location (the path the registry
   will point to), e.g. `C:\Program Files\DownloadManagerNextGen\com.downloadmanager.nextgen.json`.
5. **Register it**: edit `install-chrome.reg` so its `@=` value points at
   that same JSON path, then double-click the `.reg` file as the current
   user (HKCU — no admin needed). For Edge/Brave, uncomment the matching
   section in the `.reg` file. Restart the browser after registering.
6. **The host protocol** (for the desktop-app implementer): Native
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

- Remove the registry key(s) from `install-chrome.reg` (see the uninstall
  note at the bottom of that file), delete the host JSON/`.exe` if the
  app is being removed, and remove the extension from
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
