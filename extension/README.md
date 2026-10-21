# Download Manager Companion — Browser Extension (Phase 1)

> **Testing status — read first:** This extension was **NOT tested in a
> live browser and NOT tested with a desktop app**, and the Windows
> registry steps were **NOT tested on Windows** (no Windows machine in
> this workspace, no built host executable yet). What *was* verified here
> is listed under "Validation" below: JSON syntax, JS syntax, and static
> checks. Load-unpacked + pairing verification on real Chrome/Edge/Brave
> + Windows is still required before any user-facing claim of "it works".

A Manifest V3 companion extension for a next-generation download manager.
It does one job, conservatively: let the user point at a download they
can already see on a page, and hand exactly that link to a paired desktop
app. It never downloads silently, never scrapes a page, and never touches
credentials.

## Architecture

```
Page (user-visible links/media)
  │  user enables site in popup + clicks "Scan this page"
  ▼
content.js  (injected on demand via chrome.scripting, activeTab)
  │  adds a "⬇ DM" button next to eligible <a>/<video>/<audio> elements
  │  button click ──► chrome.runtime.sendMessage({type:'SEND_TO_APP', url})
  ▼
background.js  (MV3 service worker, ephemeral — no persistent port)
  │  checks per-origin toggle in chrome.storage.local
  │  opens a SHORT-LIVED chrome.runtime.connectNative() port per request
  ▼
Native host  com.downloadmanager.nextgen  (desktop app, NOT in this repo)
  │  stdio JSON protocol: ping/pong, download_request → download_ack/error
  ▼
Desktop download engine (separate Phase / component)
```

Popup (`popup.html/js/css`) is the only UI for settings and status. It
talks to the background worker via `chrome.runtime.sendMessage` and
never talks to the native host directly.

### File map

| File | Purpose |
|---|---|
| `manifest.json` | MV3 manifest, minimal permissions (see below) |
| `background.js` | Context menus, native-messaging client, message routing, per-site settings |
| `content.js` | Page scanner + `⬇ DM` affordance buttons (on-demand injection only) |
| `popup.html` / `popup.js` / `popup.css` | Per-site toggle, connection status, send-to-app, explicit browser-download fallback |
| `icons/icon{16,48,128}.png` | Placeholder solid-colour icons (replace with final artwork before release) |
| `native-host/com.downloadmanager.nextgen.json` | Native host manifest **template** — placeholders must be replaced (see PAIRING.md) |
| `native-host/install-chrome.reg` | Windows registry example — **NOT tested on Windows** |
| `native-host/PAIRING.md` | Install steps, host name, protocol, and how pairing is verified |

## How a download happens (explicit-choice flow)

1. User opens the popup on an http(s) page. The per-site toggle defaults
   to **off** for every site.
2. User turns the toggle on. The popup requests host permission for
   **that origin only** (`chrome.permissions.request({origins:[origin+'/*']})`).
   Denial leaves the toggle off. Turning it off removes the permission.
3. User clicks **Scan this page**. The background injects `content.js`
   into that tab only (via `chrome.scripting`, under `activeTab`).
4. `content.js` adds a `⬇ DM` button next to eligible items only:
   anchors with a `download` attribute or a known downloadable file
   extension in the path, and `<video>`/`<audio>` elements (or their
   `<source>` children) with a page-exposed http(s) `src`. Plain
   navigation links get no button. Invisible elements get no button.
5. User clicks a `⬇ DM` button (or a context-menu item, or **Send this
   page link to app** in the popup). Only then does `background.js`
   forward that one http(s) URL to the native host.
6. If the host is unreachable, the result is reported as a failure.
   The popup then offers **Download with browser instead** — a second,
   explicit click that calls `chrome.downloads.download`. There is no
   automatic fallback.

## Permissions rationale (least privilege)

Every permission is in `manifest.json` for a named reason. Nothing else
is requested at install. In particular: **no `cookies` permission, no
`webRequest`, no broad `host_permissions`, no `tabs` permission.**

| Permission | Type | Why it is needed | What it is NOT used for |
|---|---|---|---|
| `activeTab` | permission | Lets the popup read the current tab's URL and lets `chrome.scripting` inject `content.js` into that tab after the user clicks in the popup. | Reading other tabs, background tab access. |
| `contextMenus` | permission | The "Send link/media to Download Manager" right-click items. | Anything automatic; menus only fire on user click. |
| `storage` | permission | `chrome.storage.local` for per-origin on/off toggles (`site:<origin>`) and the last-send outcome shown in the popup. | Syncing settings, storing URLs beyond the last-send record, storing any credentials (none are ever collected). |
| `downloads` | permission | Only the explicit browser-download fallback, after a native-host failure and a second user click. | Silent or automatic downloading; the primary path is the desktop app, not this API. |
| `scripting` | permission | `chrome.scripting.executeScript` to inject `content.js` on demand (see flow above). | Injecting into tabs the user has not acted on. |
| `optional_host_permissions: http://*/*, https://*/*` | **optional, not granted at install** | So the per-site toggle can request access to one origin at a time, only when the user enables that site. Without this, Chrome cannot grant per-origin access on demand. The user can revoke per-site access in extension settings at any time. | This is deliberately *not* in `host_permissions`: installing the extension grants **zero** host access. |

**Why there is no `content_scripts` entry in the manifest:** declaring
`content_scripts` with `<all_urls>` would be a broad host permission
granted at install and would run the scanner on every page, including
sites the user never opted into. The on-demand injection design above
avoids both problems, at the cost of one extra click ("Scan this page").
That trade-off is intentional and documented here so a later phase does
not silently "simplify" it away.

**Host name:** `com.downloadmanager.nextgen`. It must match exactly in
`background.js`, the host manifest JSON, and the registry key — see
`native-host/PAIRING.md`.

## Privacy and safety guarantees (by construction, not by promise)

- **No cookies, passwords, tokens, or session data** are read, stored,
  or forwarded. The extension holds no `cookies` permission and the
  code paths that build native messages contain only `{url, filename,
  pageUrl}` — `filename` is derived from the URL path alone.
- **No DRM circumvention, no protected-stream handling.** If a video
  has no page-exposed http(s) source, no button is shown. The extension
  does not intercept network traffic, decrypt, or defeat any protection.
- **No silent capture.** No download starts without a click on a
  `⬇ DM` button, a context-menu item, or a popup button.
- **No exfiltration surface beyond the chosen URL.** `blob:`, `data:`,
  `javascript:`, and `file:` URLs are rejected in both `content.js` and
  `background.js`.
- **No unrestricted background execution.** The service worker holds no
  persistent native port, no polling timer, and no alarm. Each native
  request is one short-lived port with an 8 s reply timeout (5 s for a
  ping), closed on reply or disconnect.

## Firefox-compatibility notes (MV3 differences — Firefox build required)

This manifest targets Chromium (Chrome/Edge/Brave). A Firefox build is
**not** provided here and would need its own manifest + testing. Known
differences to address in that build:

1. **Manifest identity:** add `browser_specific_settings: { gecko: { id: "…" } }`
   (an email-style ID is required for signed Firefox distribution; for
   temporary `about:debugging` loads it can be omitted, but signing needs it).
2. **Background:** Firefox MV3 supports service-worker backgrounds
   (since Firefox 121), but historically used non-persistent event pages
   (`"background": {"scripts": […]}` in MV2). Keep the worker stateless
   (as here — no reliance on worker lifetime) so the same code works
   either way, and test worker restart behaviour in Firefox specifically.
3. **Namespace:** Firefox exposes both `chrome.*` (partially, via its
   WebExtensions compatibility layer) and the promise-based `browser.*`.
   Code here uses callback/`sendMessage`-style `chrome.*` APIs; for a
   Firefox build, either keep the `chrome.*` calls that Firefox supports
   or adopt `webextension-polyfill` and convert the async flows — do not
   assume every `chrome.*` call behaves identically (notably
   `chrome.scripting` and `chrome.action` badge behaviour).
4. **Native Messaging host manifest:** Firefox host manifests use
   `"allowed_extensions"` (a list of extension IDs) instead of Chromium's
   `"allowed_origins"` (`chrome-extension://…` URLs), and the manifest is
   installed in a different location (Windows registry key
   `HKCU\Software\Mozilla\NativeMessagingHosts\<name>`, or a JSON file
   in the browser's native-messaging-hosts directory on macOS/Linux).
   The `native-host/` template here is Chromium-shaped; a Firefox host
   manifest variant is required, and the `allowed_origins` field must
   not be copied verbatim.
5. **Permissions / optional hosts:** Firefox's optional-host-permission
   prompt and site-access UX differ from Chrome's; the per-site toggle
   flow (request one origin, revert on denial) must be re-tested there,
   including the `permissions.request` / `permissions.remove` behaviour.
6. **MV3 gaps to re-check at build time:** Firefox MV3 has historically
   lagged Chromium on some APIs (service-worker edge cases, `downloads`
   details, `contextMenus` on some contexts). Re-check the Firefox MV3
   docs for each API used here at the time of the Firefox build, and
   test: popup, context menus, per-site toggle, injection, and the ping.
7. **Distribution:** Firefox Add-ons (AMO) review has its own rules for
   native-messaging extensions (the host installer must be clearly
   disclosed); the Chromium Web Store listing text cannot be reused
   without that disclosure.

## Limitations (Phase 1 — honest scope)

- **Not tested in a live browser, not tested with a desktop app, not
  tested on Windows.** JSON/JS syntax validation only (see below). The
  first live test must be: load unpacked → popup → Check connection →
  scan → send, per `native-host/PAIRING.md` §3, on real Windows + Chrome.
- **No desktop host or download engine is included.** `native-host/` is
  a manifest template + registry example + instructions only. Until a
  host implementing the `ping` / `download_request` protocol exists and
  is installed, the popup will correctly report **Disconnected**.
- **Popup status is never faked — but it is also only as fresh as the
  last check.** Default is **Unknown**; **Connected** means only "the
  host replied to a ping just now", not "downloads will succeed".
- **Per-site host permission is requested at toggle-on time.** On
  Chromium this shows a browser permission prompt; if the user dismisses
  it, the site stays off. Sites that need http(s) access through an
  enterprise policy may behave differently.
- **Only page-exposed links/media are surfaced.** Links generated by
  scripts after a scan are picked up by the debounced MutationObserver
  (800 ms), but media behind DRM, authenticated streaming sessions,
  `blob:` URLs, or network-level (non-DOM) sources are intentionally
  out of scope and get no button.
- **Scan cap:** at most 50 affordance buttons per scan, to avoid
  cluttering / slowing very link-dense pages. Re-scanning after the page
  changes is a manual "Scan this page" click.
- **Icons are placeholders** (solid-colour PNGs). Replace before release.
- **Manifest V3 constraints honoured:** no persistent background page,
  no `webRequestBlocking`, no remotely hosted code (popup CSS/JS are
  local files; the content-script button uses inline styles only, no
  external stylesheet is injected into pages).
- **Service-worker lifetime:** because the worker is ephemeral, a
  native reply that arrives after the worker is terminated will not be
  delivered; the 8 s timeout + explicit failure reporting is the
  mitigation. Long downloads are the desktop app's job, not the worker's.

## Development: load unpacked (Chromium)

1. Open `chrome://extensions` (or `edge://extensions` / `brave://extensions`).
2. Enable Developer mode.
3. **Load unpacked** → select this `extension/` directory.
4. Open the popup on an http(s) page. Without a paired host, **Check
   connection** should report **Disconnected** — that is the expected
   result until pairing (see `native-host/PAIRING.md`) is completed.

## Validation (run in this workspace)

```bash
python3 -m json.tool manifest.json > /dev/null
python3 -m json.tool native-host/com.downloadmanager.nextgen.json > /dev/null
node --check background.js && node --check content.js && node --check popup.js
```

Results for this delivery are reported in the handoff note (files
created, validation results, limitations) — not claimed inside the
extension UI.
