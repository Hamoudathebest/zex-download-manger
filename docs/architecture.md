# Download Manager — System Architecture (Phase 1 design baseline)

> **Status:** Historical foundation/design baseline. The implementation inventory and current test evidence are maintained in the root `AUDIT.md` and `TEST_REPORT.md`; those supersede environment and implementation-status statements below.
> **Author role:** Agent 1 — Chief Architect (Phase 1).
> **Scope boundary:** Work under `~/workspace/download-manager/` only. No production
> system, no TitanGuard / quest-bot code, and no Windows machine was touched.
>
> **Honesty header — read first:**
>
> - No authorized Internet Download Manager (IDM) binary was available in this
>   environment, and **no IDM binary was downloaded, decompiled, copied, or
>   reverse-engineered** in this work.
> - No Windows `.exe` / `.msi` has been built or run on this Linux host. Rust is now installed and a Rust CLI download engine exists; Tauri/Windows packaging is a
>   **planned Phase 2** activity, not a Phase 1 result.
> - Every claim about IDM in this document and in `feature-matrix.md` is
>   labelled `public-doc` (public IDM documentation / widely described public
>   behaviour), `planned` (this project's design intent, not yet built), or
>   `not-verified` (could not be confirmed from this environment). Nothing in
>   this document is presented as the result of testing IDM.
> - No performance numbers are quoted in this document. Any future number must
>   be a real measured result with method + hardware + date, or be labelled
>   `not-run`. No simulated metrics.
> - No DRM circumvention, no unauthorized access, and no extraction of browser
>   cookies, passwords, or tokens is designed, specified, or endorsed anywhere
>   in this architecture. The browser-extension design (§5) deliberately
>   excludes credential exfiltration.

---

## Table of contents

1. [Goals, non-goals, and environment constraints](#1-goals-non-goals-and-environment-constraints)
2. [System overview and component diagram](#2-system-overview-and-component-diagram)
3. [Component-by-component design](#3-component-by-component-design)
4. [Download engine — detailed design](#4-download-engine--detailed-design)
5. [Browser extension (MV3 + Native Messaging)](#5-browser-extension-mv3--native-messaging)
6. [Media subsystem](#6-media-subsystem)
7. [Desktop UI (Tauri 2 + React / TypeScript / Tailwind — planned)](#7-desktop-ui-tauri-2--react--typescript--tailwind--planned)
8. [Scheduler and queue](#8-scheduler-and-queue)
9. [Persistence, checkpointing, and file formats](#9-persistence-checkpointing-and-file-formats)
10. [Data flows (end to end)](#10-data-flows-end-to-end)
11. [Error handling, retry, and recovery](#11-error-handling-retry-and-recovery)
12. [Security boundaries and threat model](#12-security-boundaries-and-threat-model)
13. [Tech choices with rationale (and rejected alternatives)](#13-tech-choices-with-rationale-and-rejected-alternatives)
14. [Concurrency, limits, and resource policy](#14-concurrency-limits-and-resource-policy)
15. [Configuration and observability](#15-configuration-and-observability)
16. [Testing strategy (Phase 1, Linux-prototype scope)](#16-testing-strategy-phase-1-linux-prototype-scope)
17. [Open decisions (carried into roadmap.md)](#17-open-decisions-carried-into-roadmapmd)
18. [Appendix A — Module / file layout (planned)](#appendix-a--module--file-layout-planned)
19. [Appendix B — Glossary](#appendix-b--glossary)

---

## 1. Goals, non-goals, and environment constraints

### 1.1 Goals (Phase 1)

1. **A correct, resumable, multi-connection HTTP(S) downloader on Linux**
   that can be exercised end-to-end without Windows, without a browser, and
   without any proprietary binary: CLI-driven downloads, segmented/range
   downloads when the server supports them, graceful single-connection
   fallback when it does not, checkpoint/resume across process restarts.
2. **A clean seam for the browser extension and the desktop UI** so that
   Phase 2 can attach Tauri + MV3 without rewriting the engine. The engine
   exposes a local, versioned API (see §3.6); the UI and extension are
   clients of that API, never direct manipulators of engine internals.
3. **A media-capture design that stays inside legal and store-policy
   boundaries:** detect downloadable media the user is already entitled to
   access via ordinary HTTP(S) requests the browser itself makes; never
   bypass DRM, never strip protection, never harvest credentials.
4. **Honest documentation:** every IDM comparison labelled, every
   unbuilt piece marked `planned`, every untested claim marked
   `not-verified`.

### 1.2 Non-goals (explicitly out of scope)

| Non-goal | Why |
|---|---|
| Downloading, decompiling, or cloning IDM code or behaviour by binary analysis | No authorized binary; legally and ethically out of scope. Comparisons are public-doc only. |
| DRM circumvention (Widevine / FairPlay / encrypted HLS/DASH decryption, key extraction) | Out of scope by policy. See §6.4 and §12. |
| Browser cookie / password / token extraction or session hijacking | Forbidden. Extension passes only the URL + user-visible metadata the user explicitly sends (see §5.4). |
| Torrent / P2P, FTP (beyond trivial HTTP fallback), or streaming-protocol reimplementation | Not Phase 1. HTTP(S) + plain HLS/DASH segment download (unencrypted, user-accessible) only. |
| A Windows installer, code signing, or auto-update channel in Phase 1 | Phase 3 work; requires a real Windows test machine (not available here). |
| A cloud account, sync service, or telemetry backend | No server component in Phase 1. All state is local. |
| Claiming IDM parity | Parity is a Phase 3 evaluation question, judged against public docs + real Windows testing — not asserted now. |

### 1.3 Environment constraints recorded in the original baseline (2026-10-21)

| Fact | Value / evidence |
|---|---|
| Host OS | Linux VM (this workspace host). No Windows machine access. |
| Node.js | v24.20.0 (`node --version`, verified this session) |
| Python | 3.12.3 (`python3 --version`, verified this session) |
| Rust toolchain | Rust/Cargo 1.96.1 are installed on the current VPS (verified 2026-10-22; see root `AUDIT.md`). Tauri 2 is still not implemented. |
| IDM binary | None available; none fetched. |
| Other agents' areas | `engine/`, `extension/`, `ui/`, `specs/` directories exist in the shared project tree (scaffolded by sibling agents). This document does not modify their code; it defines the contracts their code should satisfy. Where a sibling implementation already diverges from this doc, the divergence is an open decision (§17), not a silent override. |

**Current implementation:** a Rust CLI download engine exists in
`engine/` and has passed local loopback tests; it does not yet implement
the local API, scheduler, or desktop integration described in this
design. The existing React UI remains a disconnected prototype. Refer
to `AUDIT.md` for verified scope and `TEST_REPORT.md` for test results.

### 1.4 Design principles

1. **Correctness over speed.** A download that verifies, resumes, and
   completes beats a faster download that corrupts or loses progress.
2. **Fail closed on ambiguity.** If a server response is ambiguous
   (unknown length, contradictory `Content-Range`, changed `ETag`),
   fall back to the safe path (single connection, restart segment, or
   re-validate) rather than guessing.
3. **Crash safety.** Every byte written to disk must be recoverable or
   re-downloadable. Checkpoint state is fsynced before it is trusted.
4. **Least privilege.** Each component gets only the access it needs
   (§12). The extension cannot read engine files; the engine cannot read
   browser profile data.
5. **No magic.** No hidden network calls, no telemetry, no silent
   retries that hammer a server. All behaviour is configurable and logged
   locally.

---

## 2. System overview and component diagram

### 2.1 One-paragraph overview

The user adds a download (paste URL, browser-extension handoff, or queue
file). The **Core / Scheduler** validates the URL, assigns it to a
category/queue, and hands it to the **Download Engine**, which probes the
server (`HEAD` / range probe), decides between segmented and
single-connection mode, and writes bytes into a `.part` file while
maintaining a checkpoint JSON file (§9). On completion the engine
verifies size (and hash when the server or user supplies one), renames
`.part` → final file atomically, and notifies the UI. The **Media
Subsystem** is a specialised client of the same engine: it inspects
page/playlist metadata the browser already exposes, resolves a list of
ordinary segment URLs, and feeds them to the engine as a segmented or
playlist job — without ever touching DRM. The **Desktop UI** (planned
Tauri 2) and the **Browser Extension** (MV3) are both thin clients over
the engine's local API / Native Messaging host; neither embeds download
logic of its own.

### 2.2 Component diagram (Mermaid)

```mermaid
flowchart TB
    subgraph UserFacing["User-facing clients (thin)"]
        UI["Desktop UI — Tauri 2 + React/TS/Tailwind<br/>(PLANNED, Phase 2)"]
        EXT["Browser Extension — MV3<br/>content script + service worker<br/>(Phase 1: spec + prototype host)"]
        CLI["CLI / headless driver<br/>(Phase 1: primary test surface)"]
    end

    subgraph LocalAPI["Local control plane (localhost only)"]
        NMH["Native Messaging Host<br/>(extension ↔ engine bridge)"]
        API["Engine Local API<br/>HTTP on loopback and/or stdio JSON-RPC<br/>versioned, token-gated (see §12)"]
    end

    subgraph Core["Core (engine process)"]
        SCHED["Scheduler / Queue<br/>priorities, concurrency, scheduling windows"]
        ENGINE["Download Engine<br/>probe → segment → fetch → assemble → verify"]
        MEDIA["Media Subsystem<br/>sniffer + playlist resolver<br/>(unencrypted HLS/DASH segments only)"]
        STORE["Persistence<br/>.part + checkpoint JSON + job DB<br/>(SQLite in Phase 2; JSON in Phase 1)"]
    end

    subgraph Outside["Outside the trust boundary"]
        WEB["Origin servers / CDNs<br/>HTTP(S) only"]
        BROWSER["Browser (user's own session)<br/>extension runs here; no profile access"]
    end

    UI --> API
    CLI --> API
    EXT --> NMH
    NMH --> API
    API --> SCHED
    SCHED --> ENGINE
    SCHED --> MEDIA
    MEDIA --> ENGINE
    ENGINE --> STORE
    ENGINE --> WEB
    MEDIA -.->|"reads page metadata<br/>via extension only"| BROWSER
    EXT -.->|"user-initiated handoff only"| BROWSER

    style UI fill:#fff3cd,stroke:#856404
    style NMH fill:#e2e3ff,stroke:#383d7a
```

**Reading note:** dashed lines are *metadata-only, user-initiated* paths.
No dashed line carries cookies, tokens, or credentials. The only network
path from the engine is ordinary HTTP(S) to the URL the user supplied.

### 2.3 Component responsibilities (summary table)

| Component | Owns | Does NOT own |
|---|---|---|
| Scheduler / Queue (§8) | Ordering, concurrency slots, categories, scheduled windows, pause/resume policy | Byte fetching, file I/O, verification |
| Download Engine (§4) | Probing, segmentation, range requests, assembly, integrity checks, checkpoint writes | UI rendering, browser integration, playlist parsing |
| Media Subsystem (§6) | Detecting downloadable media URLs, parsing unencrypted playlists, quality selection | DRM, decryption, credential handling, playback |
| Persistence (§9) | `.part` files, checkpoint JSON, job records, crash recovery | Business rules (which job runs next) |
| Native Messaging Host (§5) | Validating + translating extension messages into engine API calls | Download logic; it is a bridge, not an engine |
| Desktop UI (§7) | Presentation, user commands, progress display | Any download state that is not also in the engine store (UI is a view, not a source of truth) |
| CLI (§3.6) | Headless driving + scripting + Phase 1 testing | Anything the API does not expose |

---

## 3. Component-by-component design

### 3.1 Scheduler / Queue — see §8 (full design there).

### 3.2 Download Engine — see §4 (full design there).

### 3.3 Media Subsystem — see §6 (full design there).

### 3.4 Persistence — see §9 (full design there).

### 3.5 Browser Extension — see §5 (full design there).

### 3.6 Engine Local API (the contract everything else depends on)

The engine exposes **one** control surface. UI, CLI, and the Native
Messaging Host all speak to it; no component reaches around it.

**Phase 1 transport (Linux prototype):** a local HTTP server bound to
`127.0.0.1` on an ephemeral or configured port, plus a stdio JSON-RPC
mode for the Native Messaging Host. Both speak the same message schema
below. Binding to loopback only is mandatory (§12).

**Phase 2 transport (planned):** the same schema over Tauri's IPC /
command layer, so the desktop UI does not need a separate HTTP server
when running inside Tauri. The loopback HTTP mode remains for CLI and
scripting.

**Message schema (versioned, JSON):**

```jsonc
// Request envelope (all calls)
{ "jsonrpc": "2.0", "id": "…", "method": "…", "params": { … } }
// Response envelope
{ "jsonrpc": "2.0", "id": "…", "result": { … } }
// or
{ "jsonrpc": "2.0", "id": "…", "error": { "code": -32000, "message": "…", "data": { … } } }
```

**Core methods (Phase 1 minimum):**

| Method | Params (essentials) | Returns |
|---|---|---|
| `download.add` | `url`, `filename?`, `category?`, `headers?` (user-supplied only), `connections?`, `priority?` | `jobId` |
| `download.pause` / `download.resume` / `download.cancel` / `download.remove` | `jobId`, `deleteFiles?` | job status |
| `download.list` | `filter?` (status/category) | job summaries incl. progress, speed, ETA |
| `download.get` | `jobId` | full job record + segment map |
| `queue.setConcurrency` / `queue.move` | limits / ordering | updated queue state |
| `scheduler.setWindow` | days/times, `allowOutsideWindow?` | schedule record |
| `engine.status` | — | version, uptime, active jobs, disk space |
| `events.subscribe` | (server-sent events / websocket in HTTP mode; newline-delimited JSON in stdio mode) | progress + state-change stream |

**Rules:**

- `download.add` **validates** the URL before accepting it: scheme must
  be `http:` or `https:` (no `file:`, no custom schemes, no
  credentials-in-URL silently accepted — see §12.3). Invalid URLs are
  rejected with a typed error, not queued.
- `headers` may carry only a user-supplied, allow-listed set
  (`User-Agent`, `Referer` for the *same* download the user initiated,
  `Range` is engine-managed and overridden). `Cookie`, `Authorization`,
  and any browser-derived credential header are **rejected** (§12).
- Every mutation returns the resulting job record, so clients never
  have to poll-and-guess.
- API version is in the `engine.status` response and in an
  `X-DM-API-Version` header (HTTP mode). Breaking changes bump the
  major version; clients must check it on connect.

### 3.7 What the engine is NOT

- Not a browser. It does not execute JavaScript, render pages, or run a
  headless browser to bypass bot checks.
- Not a proxy. It does not intercept the user's browser traffic.
- Not a credential store. It stores no passwords, no browser cookies,
  no session tokens (§12).

---

## 4. Download engine — detailed design

### 4.1 Job lifecycle (state machine)

```
            ┌──────────┐
            │  QUEUED  │◄─────────────────────────────┐
            └────┬─────┘                              │
                 │ scheduler assigns a slot           │
                 ▼                                    │
            ┌──────────┐      probe fails (retryable) │
            │ PROBING  │──────────────────────────────┤
            └────┬─────┘      probe fails (fatal)     │ retry /
                 │ probe ok                           ▼ backoff
                 ▼                              ┌──────────┐
            ┌──────────┐                       │  FAILED  │
            │DOWNLOADING│◄────── resume ───────┤ (terminal│
            └────┬─────┘                       │  until   │
              ┌──┼──┐                          │  retried)│
              │  │  └──── user pause ─────────►└──────────┘
              │  │                             ┌──────────┐
              │  └──── segment error ─────────►│  PAUSED  │
              │                                 └────┬─────┘
              ▼                                      │ resume
         ┌─────────┐                                 │
         │VERIFYING│── verify fails ──► FAILED / re-download segment(s)
         └────┬────┘
              │ verify ok
              ▼
         ┌──────────┐
         │COMPLETED │  (terminal; .part renamed to final file)
         └──────────┘
         CANCELLED is terminal from any non-terminal state; with
         deleteFiles=true it also removes .part + checkpoint.
```

**Invariants:**

- Only `DOWNLOADING` holds open network connections and an open file
  handle. `PAUSED` closes both promptly (no dangling sockets).
- `COMPLETED` is reached only after verification (§4.6) and a
  successful atomic rename (§4.5). A crash between verify and rename
  leaves a `.part` + checkpoint that re-verifies on restart — it never
  leaves a half-renamed final file presented as complete.
- Every transition is persisted (checkpoint write, §9) *before* it is
  reported to clients, so a crash cannot report a state the disk does
  not reflect.

### 4.2 Probing (what happens before any byte is fetched)

For each new job, in order:

1. **URL normalisation + validation** (§3.6 rules). Reject non-HTTP(S),
   reject URLs with embedded credentials unless the user explicitly
   confirmed (and even then, strip credentials from logs and from the
   stored job record — store only scheme/host/path, never the password).
2. **`HEAD` request** (with a short timeout, e.g. 15 s default,
   configurable). Record: `Content-Length`, `Accept-Ranges`,
   `ETag`, `Last-Modified`, `Content-Type`, `Content-Disposition`.
   - If the server rejects `HEAD` (405 / 403 on HEAD only), fall back
     to a **range probe**: `GET` with `Range: bytes=0-0` and read the
     `Content-Range` total. This is the common CDN case; it is not an
     error.
   - If both fail with a retryable status (429, 5xx, network error),
     the job goes to retry/backoff (§11), not to FAILED.
3. **Capability decision:**

   | Server signals | Mode |
   |---|---|
   | `Accept-Ranges: bytes` **and** known total length | Segmented (multi-connection) |
   | `Content-Range` total from range probe | Segmented |
   | No range support, or unknown length | Single-connection streaming |
   | `Content-Length: 0` or missing + no range | Single-connection streaming; progress shows bytes, not % |
   | Redirect chain (3xx) | Follow up to N=5 redirects (configurable), same-origin policy per §12; final URL recorded in checkpoint (for resume, re-probe the *final* URL) |

4. **Filename determination** (in priority order): user-supplied
   filename → `Content-Disposition: filename*` / `filename` →
   last URL path segment (URL-decoded, sanitised) → `download`
   fallback. Sanitisation: strip path separators, `..`, control
   characters, and leading dots; on collision, append ` (n)` before
   the extension (same convention users expect; `planned` behaviour,
   to be confirmed in Phase 1 testing).

### 4.3 Segmentation

Segmented mode splits the known-length file into **N contiguous byte
ranges** (default N=8, configurable 1–32; see §14). Design points:

- **Segment sizing:** equal-size ranges, except the last segment which
  takes the remainder. Segments are *not* re-split mid-download in
  Phase 1 (dynamic re-splitting is a Phase 2 optimisation, `planned`,
  `not-verified` for benefit — see §17, decision D-07).
- **One connection per segment** (HTTP/1.1 range request). HTTP/2
  multiplexing is left to the underlying HTTP client; the engine does
  not implement its own HTTP/2 scheduler in Phase 1.
- **Segment state:** each segment tracks `start`, `end` (inclusive),
  `downloaded` (bytes confirmed written), `status`
  (`pending|active|done|failed`), and `attempts`. This is the unit of
  retry: a failed segment retries independently (§11) without
  discarding other segments' progress.
- **Slow-segment handling (Phase 1, conservative):** no segment
  stealing. A slow segment simply finishes later; the job completes
  when all segments are `done`. This avoids the complexity and the
  server-load risk of aggressive re-splitting. (Dynamic splitting is
  decision D-07.)
- **Server that lies about ranges:** if a server returns `200` instead
  of `206` for a range request, or a `Content-Range` that does not
  match the request, the engine **aborts segmented mode for that job**,
  discards in-flight segment buffers (not already-fsynced bytes), and
  restarts the job in single-connection mode from byte 0 *only if no
  bytes were yet committed*, otherwise it fails the job with a typed
  error (`RANGE_MISMATCH`) and asks the user to retry. It never writes
  mismatched bytes into the `.part` at the wrong offset.

### 4.4 Writing bytes (`.part` discipline)

- The destination is `<final>.part` in the target directory (see §9.1).
  The final filename is never created until verification passes.
- Each segment writes **only within its own range** using positional
  writes (`pwrite`-equivalent; in Node, `fs.write` with an explicit
  position). Segments never append blindly — append-only writes are a
  classic source of corruption on resume.
- Writes are buffered in memory per segment (e.g. 64 KiB chunks) and
  flushed to the file; the checkpoint is updated after each flush
  batch, not after every chunk (see §9.3 for the fsync policy).
- **Pre-allocation (optional, default off in Phase 1):** when the
  total length is known, the engine *may* pre-allocate the `.part` to
  full size with sparse allocation (`ftruncate`) so that positional
  writes never extend the file unexpectedly. This is a Phase 1 option
  to evaluate on Linux ext4/tmpfs; it is `planned`, not yet measured.

### 4.5 Completion, verification, and atomic rename

1. All segments `done` → job enters `VERIFYING`.
2. **Size check (always):** `.part` size must equal the probed total
   length (when known). Mismatch → FAILED with `SIZE_MISMATCH`, and
   the checkpoint is kept so the user can inspect/retry.
3. **Hash check (when available):** if the user supplied a hash
   (SHA-256 preferred, SHA-1/MD5 accepted but flagged as weak) or the
   server supplied a trustworthy digest header, verify it. Hash
   failure → FAILED with `HASH_MISMATCH`; the `.part` is kept, not
   deleted, so the failure is diagnosable.
4. **Rename:** `rename(.part → final)` on the same filesystem
   (guaranteed atomic on POSIX when source and destination share a
   directory). Only after the rename succeeds is the job marked
   `COMPLETED` and the checkpoint removed (or archived — see §9.4).
5. **Collision on rename:** if the final path appeared between probe
   and rename (e.g. user created a file), the engine does **not**
   overwrite silently. It renames to the ` (n)`-suffixed name and
   records the actual final path in the job record.

### 4.6 Integrity details

- Hashing is streaming (hash the `.part` once, in chunks, during
  VERIFYING) — never load the whole file into memory.
- If the server's `ETag` or `Last-Modified` changed between probe and
  resume, the engine treats the remote file as *possibly different*:
  it re-probes, and if length/ETag differ, it discards the old
  checkpoint and restarts from byte 0 after user confirmation in UI
  mode, or automatically with a warning in CLI mode (configurable;
  default in Phase 1 CLI: restart + warn, because a stale resume is
  worse than a re-download).

### 4.7 Speed, throttling, and fairness

- Per-job speed limit (bytes/s, 0 = unlimited) enforced with a
  token-bucket per job, shared across its segments (not per-segment,
  which would multiply the limit by N — a common bug).
- Global speed limit enforced the same way across all active jobs.
- Throttling is cooperative (pauses segment reads), not connection
  killing — killing connections on every throttle tick creates
  reconnect storms.
- No attempt to evade server rate limits: on `429`, honour
  `Retry-After` if present (§11).

---

## 5. Browser extension (MV3 + Native Messaging)

### 5.1 What the extension is for

One job: **let the user send a download to the desktop engine with one
click**, from the page they are already on. It is not a download
manager in the browser, not a traffic interceptor, and not a media
ripper. All heavy work happens in the engine.

### 5.2 MV3 architecture

```
  ┌─────────────────────────────────────────────────────────┐
  │ Browser extension (Manifest V3)                         │
  │                                                         │
  │  content script (page context, isolated world)          │
  │    • adds context-menu / page-action affordances        │
  │    • collects ONLY: link URL, link text, page URL,     │
  │      media element src the user right-clicked           │
  │    • sends message to service worker; never reads       │
  │      cookies, storage, or page credentials               │
  │                                                         │
  │  service worker (event-driven, no persistent background)│
  │    • contextMenus: "Download with DM" (link / media)   │
  │    • browserAction popup: "Send current page links"     │
  │    • forwards user-initiated handoffs to Native Host    │
  │    • handles host replies: queued / error / offline     │
  │                                                         │
  │  popup UI (minimal, Phase 1)                            │
  │    • shows engine status (online/offline)               │
  │    • lists recent handoffs + their engine jobIds        │
  └─────────────────────────────────────────────────────────┘
                        │ chrome.runtime.connectNative()
                        ▼
              Native Messaging Host (see §5.3)
```

**MV3 constraints honoured:**

- Service worker is **event-driven and non-persistent**: no
  `setInterval` polling, no long-lived background page. State that
  must survive worker restarts lives in `chrome.storage.local` (only
  handoff receipts + user preferences — never credentials).
- Host permissions are **minimal**: `contextMenus`, `storage`,
  `activeTab` (for the user-invoked popup only). **No**
  `<all_urls>` host permission, **no** `cookies`, **no**
  `webRequest`/`webRequestBlocking`, **no** `debugger`. If a future
  feature needs broader permissions, it needs a separate, justified
  decision (§17, D-05) — it is not smuggled in now.
- Content scripts run in the **isolated world** and cannot read page
  JavaScript variables or page storage. They can read DOM attributes
  the user interacted with (the clicked link/media `src`) — that is
  the intended, minimal surface.

### 5.3 Native Messaging Host

The host is a small, standalone executable (Node.js script in Phase 1
prototype; a compiled binary in Phase 2 packaging) registered per
browser via the standard Native Messaging manifest locations
(Chrome/Chromium: `~/.config/google-chrome/NativeMessagingHosts/` on
Linux; the Windows registry path is a Phase 2 packaging concern,
`planned`, `not-verified` here).

**Protocol (Chrome Native Messaging framing):**

- Each message is a 4-byte little-endian length prefix + UTF-8 JSON.
- Max message size: the host enforces a cap (e.g. 1 MiB); oversized
  messages are rejected, not truncated.
- The host is **stateless per message** except for a short-lived
  connection to the engine API: it validates, translates, forwards,
  and returns the engine's reply. It keeps no download state of its
  own.

**Host responsibilities:**

1. Read length-prefixed JSON from stdin, validate against a schema
   (unknown fields rejected, not ignored silently — fail closed).
2. Check the message `type` is in the allow-list:
   `download.add`, `engine.status`, `ping`. Anything else → error.
3. Call the engine Local API (§3.6) over loopback HTTP (or stdio
   JSON-RPC in the Phase 1 prototype where the engine is already a
   child process — one transport, not two parallel implementations,
   to be settled in D-04).
4. Return the engine's `jobId` / status / typed error to the
   extension. On engine-offline, return a distinct `ENGINE_OFFLINE`
   error so the extension can show "start the desktop app" instead of
   a generic failure.
5. Log to stderr only (stdout is the Native Messaging channel; any
   stray stdout breaks framing — a classic bug, explicitly guarded).

**Host non-responsibilities:** no downloading, no file I/O beyond
logging, no browser-profile access, no credential handling.

### 5.4 What the extension sends — and what it never sends

| Sent (user-initiated only) | Never sent |
|---|---|
| Target URL (the link/media the user clicked) | Cookies, `Authorization` headers, session tokens |
| Link text / suggested filename (from DOM) | Page HTML, page storage, browsing history |
| Page URL (as `Referer`-equivalent metadata, only if the user enabled it in extension settings; default: send page URL, because some servers require a referer — but the engine sends it as a plain `Referer` header for that one download, and it is shown to the user in the job record) | Passwords, form data, autofill data |
| User-chosen category / quality (media jobs) | Anything from another tab, or anything collected without a click |

**User confirmation:** the extension popup / context-menu handoff
shows the URL and destination category before sending when the user
has "confirm before sending" enabled (default ON in Phase 1). Silent
auto-capture of every link on a page is **not** a Phase 1 feature
(decision D-05) — it is the feature most likely to surprise users and
to trip store review, so it stays off until explicitly decided.

### 5.5 Failure modes (extension)

| Situation | Extension behaviour |
|---|---|
| Engine offline / host not installed | Show "Desktop app not running" + install/start hint; queue nothing silently. |
| Engine rejects URL (invalid scheme, blocked host) | Surface the engine's typed error verbatim. |
| Service worker restarted mid-handoff | Handoff receipt in `chrome.storage.local` lets the popup show "sent, jobId unknown — check desktop app" rather than claiming success. |
| Browser store policy change (MV3 rules tighten) | Extension is designed to the smallest permission set, so policy drift has minimal surface to break. |

### 5.6 Browser support (Phase 1 vs planned)

| Browser | Phase 1 | Planned |
|---|---|---|
| Chromium / Chrome (Linux, for prototype) | Prototype host + MV3 manifest tested against Chromium if available on the VM (`not-verified` — Chromium availability on this VM was not asserted; test in Phase 1) | Full MV3 |
| Firefox | Not in Phase 1 (different Native Messaging manifest + `browser.*` APIs) | Phase 2, MV2/MV3-compat assessment needed |
| Edge / Brave (Chromium-based) | Same Chromium MV3 manifest in principle; `not-verified` | Phase 2 Windows testing |

---

## 6. Media subsystem

### 6.1 Purpose and boundary (restated, because this is the
### highest-risk area for scope creep)

The media subsystem lets a user download **media they can already play
in their browser via an ordinary, unprotected HTTP(S) stream** — e.g.
a direct MP4 file, or an unencrypted HLS playlist whose segments are
plain `.ts` / `.m4s` files served over HTTPS. It does **not** defeat
any protection. If a stream is encrypted, token-gated in a way the
user's browser session alone would not reproduce via a plain request,
or DRM-protected, the subsystem reports "not downloadable by this tool"
and stops. That refusal is a feature, not a gap to work around.

### 6.2 Detection (what "sniffing" means here — and what it does not)

**In scope (Phase 1):**

- The extension's content script, on user right-click of a
  `<video>` / `<audio>` element, reads that element's `src` /
  `<source src>` attribute — a URL the page itself put in the DOM.
- The user pastes a media URL (direct file, `.m3u8`, `.mpd`) into the
  desktop UI / CLI.
- The engine fetches a playlist the user supplied and parses it
  (§6.3).

**Out of scope (explicitly):**

- Intercepting all browser network traffic (`webRequest` sniffing of
  every request on every page). Not in Phase 1; requires the broad
  permissions rejected in §5.2 and a separate decision (D-05).
- Reading media URLs out of page JavaScript variables, obfuscated
  players, or authenticated API responses the browser fetched with
  session credentials. If the URL is not in the DOM or not pasted by
  the user, this tool does not go looking for it.
- Any form of stream ripping that bypasses a paywall, login wall, or
  DRM. See §6.4.

### 6.3 Playlist handling (unencrypted HLS / DASH only)

**HLS (`.m3u8`):**

1. Fetch the playlist (ordinary GET, user-supplied URL).
2. If it is a **master playlist**, list variant streams (bandwidth,
   resolution, codecs) and let the user pick (UI) or take the highest
   bandwidth (CLI default, configurable). Record the choice.
3. If it is a **media playlist**, resolve every segment URI relative
   to the playlist URL, honour `EXT-X-KEY` only in one case: **no key**
   (`EXT-X-KEY: NONE` or absent) → proceed. **Any other
   `EXT-X-KEY`** (AES-128, SAMPLE-AES, etc.) → stop with
   `MEDIA_ENCRYPTED` and explain why. Do not fetch the key URI, do
   not attempt decryption.
4. Feed the segment list to the engine as a **playlist job**:
   segments downloaded (segmented, in order, with the same retry
   rules as §4), then concatenated in playlist order into a single
   output file (`.ts` concatenation for MPEG-TS; for fMP4, remuxing
   is a Phase 2 concern — Phase 1 supports TS concatenation and
   direct-file media; fMP4 remux via ffmpeg, if available, is
   `planned`, `not-verified` for correctness on this VM).
5. Live / sliding-window playlists (`EXT-X-ENDLIST` absent): Phase 1
   **does not** support live capture. If the playlist has no ENDLIST,
   fail with `MEDIA_LIVE_UNSUPPORTED` rather than recording
   indefinitely.

**DASH (`.mpd`):**

- Phase 1: parse the MPD, list representations, and support only
  **unencrypted, segment-template / segment-list** representations
  whose segments are plain HTTP(S) URLs. Encrypted (`ContentProtection`
  present) → `MEDIA_ENCRYPTED`, stop. SegmentBase with byte ranges
  over a single file is supported via the normal range engine.
- Full DASH (multi-period, dynamic, subtitle muxing) is Phase 2,
  `planned`.

**Quality selection:** user picks, or CLI default = highest
bandwidth variant that is unencrypted. Never silently downgrade
without recording the choice in the job record.

### 6.4 DRM / encryption — hard stop

| Signal | Action |
|---|---|
| HLS `EXT-X-KEY` with any METHOD other than NONE | Stop, `MEDIA_ENCRYPTED` |
| DASH `ContentProtection` element | Stop, `MEDIA_ENCRYPTED` |
| Widevine / FairPlay / PlayReady licence request observed or required | Stop; never issue a licence request, never extract keys |
| Segment URLs that return 403 without user-supplied credentials | Stop; do not retry with harvested credentials |
| User asks to "remove protection" / "decrypt" | Refuse in UI copy; this tool does not do that |

### 6.5 Media job record

A media job is a normal download job (§9) plus:

```jsonc
{
  "kind": "media-playlist",
  "playlistUrl": "https://…/master.m3u8",
  "playlistType": "hls-master",
  "selectedVariant": { "bandwidth": 0, "resolution": "…", "codecs": "…" },
  "segments": { "total": 0, "done": 0 },
  "encrypted": false,   // must be false for the job to exist; true ⇒ job never created
  "outputFormat": "ts-concat"  // or "direct-file"
}
```

---

## 7. Desktop UI (Tauri 2 + React / TypeScript / Tailwind — planned)

> **Status of this whole section: `planned`.** No Tauri app was built
> in Phase 1 (no Rust toolchain on this VM, §1.3). This section is
> the design the Phase 2 team builds against, not a description of
> existing code.

### 7.1 Why Tauri 2 (rationale, and what would change the choice)

- **Small distribution size + OS-native webview** vs Electron's
  bundled Chromium: matters for a download manager users expect to
  leave running. (Rationale from Tauri's public docs; `public-doc`
  for Tauri's claims, `planned` for this project's adoption.)
- **Rust core + JS frontend split** matches the engine/UI split in
  §2: the Rust side can eventually host the engine core, while React
  stays purely presentational.
- **Security model:** Tauri's capability / allow-list system fits
  §12 (the frontend gets only the commands it needs; filesystem
  access is scoped to the download directory + config dir).
- **What would change the choice:** if Phase 2 Windows testing shows
  the webview (WebView2) cannot be relied on in the target
  environments, or if the Rust port cost exceeds the benefit, the
  fallback is a Node.js + system-webview shell or Electron — recorded
  as decision D-02, to be settled with real Windows evidence, not
  here.

### 7.2 Frontend stack (planned)

- **React 18+ + TypeScript (strict)** — component model, type safety
  for the job/segment state shapes in §9.
- **Tailwind CSS** — utility styling; dark/light themes via CSS
  variables; no custom design system in Phase 1.
- **State:** a small store (Zustand or equivalent, `planned` — final
  pick is D-03) holding job list + selected job + scheduler state,
  fed by the engine event stream (§3.6). The store is a *cache* of
  engine state, never the source of truth: on reconnect it re-syncs
  from `download.list`.
- **Routing/views (planned):** Downloads (list + detail/progress),
  Queue & Scheduler, Categories, Media (playlist jobs), Settings.
  One window in Phase 1; floating mini-progress window is Phase 3.

### 7.3 Tauri command surface (planned, mirrors §3.6)

The frontend calls Tauri commands that map 1:1 to engine API methods
(`download_add`, `download_pause`, …). The Rust side validates
arguments again (never trust the frontend), then forwards to the
engine core. In Phase 2 the engine core may *be* the Rust side; in
the interim (Tauri shell over the Node engine), the Rust side proxies
to the loopback API. Either way the frontend sees the same commands.

### 7.4 UI ↔ engine sync and offline behaviour

- On launch, UI requests `engine.status` + `download.list`, then
  subscribes to the event stream. Progress updates are throttled
  (e.g. max 4 updates/sec/job) to avoid re-render storms — the
  engine emits at most that rate; the UI does not poll in a loop.
- If the engine disconnects, the UI shows a persistent "engine
  offline" banner, keeps the last known job list (marked stale), and
  disables mutating actions. It does not invent progress.
- All destructive actions (cancel + delete files, remove completed
  history) require explicit confirmation in the UI.

---

## 8. Scheduler and queue

### 8.1 Queue model

- **One global queue**, ordered by (priority, insertion order).
  Priority is a small integer (default 0; higher runs first).
  `queue.move(jobId, position)` reorders; the scheduler respects
  the new order for the *next* slot assignment, never pre-empting a
  running job to satisfy a reorder (pre-emption is a Phase 2
  discussion, D-08).
- **Categories** are labels + default destination folders
  (e.g. `general`, `video`, `music`, `documents`, `compressed`),
  user-editable. A category is not a separate queue — it is a
  filter + a folder default. This keeps scheduling simple and
  predictable.
- **Concurrency:** global max simultaneous downloads (default 3,
  configurable 1–10) and per-host max (default 2, configurable) to
  avoid hammering one server. A job waits in QUEUED until both a
  global slot and a per-host slot are free.
- **Queue persistence:** the queue order + job records live in the
  persistence layer (§9), so a restart restores the queue exactly.

### 8.2 Scheduling windows

- A schedule is a set of **weekly windows**: e.g.
  Mon–Fri 01:00–06:00, Sat–Sun 00:00–23:59. Outside a window, the
  scheduler does not start *new* jobs; running jobs are handled by
  the `onWindowEnd` policy:
  - `pause` (default): pause running jobs at window end, resume at
    window start. Checkpointing makes this safe (§9).
  - `finish-current`: let running jobs finish, start nothing new.
  - `continue`: ignore windows (schedule disabled).
- **One-shot schedules:** "start this job at <time>" / "stop all at
  <time>" — implemented as a single window + a timer, not a
  separate system.
- **Shutdown / sleep integration (planned, Phase 2/Windows):**
  "shutdown when downloads complete" and "prevent sleep while
  downloading" are OS-specific (Windows power APIs, Linux
  systemd-inhibit). Phase 1 on Linux can prototype
  `systemd-inhibit` if available; Windows behaviour is
  `not-verified` until Phase 2 testing. Never force a shutdown
  without user confirmation in UI mode.

### 8.3 Pause / resume semantics

- **Pause** = stop all segment connections, flush + checkpoint, close
  the file. Resume re-probes (cheap `HEAD`/range probe), validates
  ETag/length (§4.6), and continues from checkpointed offsets.
- **Resume after restart** = same as pause, plus crash-recovery
  validation (§9.4). There is no separate "resume" code path — one
  path, tested once, used everywhere.

---

## 9. Persistence, checkpointing, and file formats

### 9.1 Files on disk (per download)

```
<download-dir>/
  <final-name>.part          # in-progress bytes (positional writes, §4.4)
  <final-name>.part.json     # checkpoint (this section, §9.2) — see note below
  <final-name>               # appears ONLY after atomic rename on completion
```

**Naming note (open detail, D-06):** sibling agents may use
`<name>.dmcheckpoint.json` or a central job DB instead of a sidecar
`.part.json`. The *contract* this architecture requires is: (a) the
checkpoint is co-located with or unambiguously linked to its `.part`
by jobId, (b) it is written atomically (§9.3), and (c) it contains
all fields in §9.2. The exact suffix is settled in D-06; implementations
must not assume a suffix other components have not agreed on. This
document uses `.part.json` as the reference name.

**Central job store (Phase 1):** a JSON file
(`~/.config/download-manager/jobs.json` on Linux, or the
project-local equivalent in the prototype) holding job records.
**Phase 2:** SQLite (`jobs.db`) with the same record shape — the
migration is a storage change, not a schema redesign. Job records
reference `.part` paths; they never embed file bytes.

### 9.2 Checkpoint JSON format (versioned)

```jsonc
{
  "formatVersion": 1,
  "jobId": "uuid-v4",
  "url": "https://example.com/file.zip",        // final URL after redirects
  "originalUrl": "https://example.com/redirect",
  "finalName": "file.zip",
  "downloadDir": "/home/user/Downloads",
  "partPath": "/home/user/Downloads/file.zip.part",
  "totalBytes": 104857600,                      // null when unknown
  "supportsRanges": true,
  "etag": "\"abc123\"",                         // null when absent
  "lastModified": "Wed, 21 Oct 2026 07:00:00 GMT", // null when absent
  "contentType": "application/zip",
  "category": "compressed",
  "priority": 0,
  "maxConnections": 8,
  "status": "paused",                           // job state (§4.1)
  "segments": [
    { "index": 0, "start": 0, "end": 13107199,
      "downloaded": 13107200, "status": "done", "attempts": 1 },
    { "index": 1, "start": 13107200, "end": 26214399,
      "downloaded": 5242880, "status": "active", "attempts": 1 }
  ],
  "bytesDownloaded": 18350080,                  // sum of segment.downloaded
  "createdAt": "2026-10-21T10:00:00.000Z",
  "updatedAt": "2026-10-21T10:05:00.000Z",
  "checksum": { "algorithm": "sha256", "expected": null }, // null unless user/server supplied
  "media": null,                                // or media job object (§6.5)
  "error": null                                 // or last typed error (§11.2)
}
```

**Field rules:**

- `url` is the *final* URL (after redirects). `originalUrl` is kept
  for display/diagnosis only; resume re-probes `url`.
- No credentials anywhere in this file. If the original URL contained
  credentials, they are stripped before this file is written, and the
  file's permissions are `0600` regardless (defence in depth).
- `segments[].downloaded` counts **bytes confirmed written to disk**
  (after flush), not bytes received into a memory buffer. This is the
  only definition that makes resume correct.
- `formatVersion` is mandatory. A reader that sees an unknown major
  version must refuse to resume that job (typed error
  `CHECKPOINT_VERSION_UNSUPPORTED`) rather than guessing at the layout.

### 9.3 Write discipline (how checkpoints stay trustworthy)

1. **Atomic write:** write to `<checkpoint>.tmp`, `fsync` the tmp
   file, then `rename(tmp → checkpoint)`, then `fsync` the containing
   directory (POSIX durability). Readers never see a half-written
   checkpoint.
2. **Frequency:** checkpoint after every flush batch (see §4.4), and
   at minimum on every state transition, on pause, and on clean
   shutdown. Not after every 64 KiB chunk (too much fsync overhead);
   not only on pause (too much loss on crash). The batch interval is
   configurable (default: every 1 MiB written per job or every 5 s,
   whichever comes first — `planned` default, to be tuned by Phase 1
   measurement, `not-run` until then).
3. **Crash window:** bytes written to the `.part` but not yet
   checkpointed are *re-downloaded* on resume (their segment's
   `downloaded` lags behind the file). This is safe (idempotent
   range re-fetch) and bounded by the batch size above. It is never
   "assumed present".
4. **File permissions:** `.part` and checkpoint `0600` by default
   (user's files, user's eyes only); final file `0644` (umask-aware)
   on completion.

### 9.4 Crash recovery (startup procedure)

On engine start, for each job record / checkpoint found:

1. If status was `DOWNLOADING` or `PROBING` at crash → set to
   `PAUSED` (it was interrupted, not completed), keep segments.
2. Validate: `.part` exists? `.part` size ≥ max segment
   `downloaded`? (If the file is *smaller* than checkpointed
   progress — e.g. user deleted/truncated it — discard the
   checkpoint and restart the job from byte 0 with a warning, or
   fail it if the user prefers strict mode.)
3. Re-probe the URL (§4.2, cheap). If length/ETag changed → §4.6
   handling (restart or fail, never silent resume onto a different
   file).
4. Jobs in `COMPLETED` with a missing final file are marked
   `FAILED`/`MISSING` (the file was moved/deleted externally) — the
   engine does not silently re-download without user action.
5. Orphan `.part` files with no checkpoint/job record are listed in
   `engine.status` diagnostics (count + total bytes) and left alone
   until the user deletes or re-adds them. The engine never deletes
   user data unprompted.

**Checkpoint retention after completion:** on successful rename, the
checkpoint is deleted (default) or archived to a `completed/` log
if the user enabled history retention. The job *record* (summary:
name, size, completedAt, final path) is kept in the job store until
the user clears history.

### 9.5 Disk-space policy

- Before starting a job with known length, check free space ≥
  `totalBytes × 1.05` (headroom) in the target directory. If not,
  the job stays QUEUED with a typed `INSUFFICIENT_DISK_SPACE` error
  and a clear message — it does not start and fail halfway.
- During download, if a write fails with ENOSPC, pause the job
  immediately (all segments), checkpoint, and report
  `INSUFFICIENT_DISK_SPACE`. Other jobs to the same filesystem are
  also paused (they would fail the same way); jobs to other
  filesystems continue.

---

## 10. Data flows (end to end)

### 10.1 Flow A — User pastes a URL in the UI/CLI

```
User → UI/CLI → download.add(url) → API validates (§3.6)
  → Scheduler: assign jobId, category, priority, QUEUED
  → Slot free? → Engine: PROBING (HEAD / range probe, §4.2)
  → Segmented or single mode decided
  → DOWNLOADING: segments fetch ranges → positional writes to .part
    → checkpoint batches (§9.3) → progress events to UI
  → All segments done → VERIFYING (size [+ hash], §4.5)
  → rename .part → final → COMPLETED → UI notification
  → (any failure) → §11 retry/fail path, checkpoint kept
```

### 10.2 Flow B — Browser extension handoff

```
User right-clicks link/media → extension content script reads
  clicked URL (+ link text) → service worker → user confirms
  (if enabled) → connectNative → Native Host validates schema
  → Host calls engine API download.add (loopback only)
  → Engine replies jobId (or typed error) → Host returns it
  → Extension popup shows "Sent to desktop app (job #…)"
  → From here, Flow A continues inside the engine.
  → If engine offline: extension shows ENGINE_OFFLINE; nothing
    is queued in the browser (no silent loss, no silent retry loop).
```

### 10.3 Flow C — Media playlist job

```
User supplies .m3u8/.mpd (paste or extension media click)
  → Media Subsystem fetches playlist (§6.3)
  → Encrypted? → MEDIA_ENCRYPTED, stop (no job created)
  → Live (no ENDLIST)? → MEDIA_LIVE_UNSUPPORTED, stop
  → Master playlist? → variant list → user picks (or CLI default)
  → Segment URLs resolved → engine playlist job (§6.5)
  → Segments downloaded + concatenated in order → VERIFYING
    (size = sum of segment lengths when known; hash only if the
    playlist/user supplied one — segment-level hashes are not
    assumed) → rename → COMPLETED
```

### 10.4 Flow D — Pause / crash / resume

```
Pause (user) or crash (process dies)
  → On pause: flush, checkpoint (atomic, §9.3), close file + sockets
  → On crash: nothing is written (by definition); disk holds the
    last checkpointed state, which lags real bytes by ≤ one batch
  → Restart: §9.4 recovery (validate .part, re-probe, ETag check)
  → Resume: segments with downloaded < length re-fetch only their
    missing tail (Range: downloaded..end); done segments skipped
  → Completes via Flow A VERIFYING path
```

---

## 11. Error handling, retry, and recovery

### 11.1 Error taxonomy (typed errors — clients switch on `code`, not on message text)

| Category | Examples | Retry? |
|---|---|---|
| Network (retryable) | `ECONNRESET`, timeout, DNS transient, 502/503/504 | Yes, with backoff (§11.3) |
| Rate limit | `429` (+ `Retry-After` honoured) | Yes, after `Retry-After` or backoff, whichever is longer |
| Client / fatal | `400`, `401`, `403`, `404`, `410` | No — fail immediately with clear message; user action needed |
| Range / integrity | `RANGE_MISMATCH`, `SIZE_MISMATCH`, `HASH_MISMATCH`, `CHECKPOINT_VERSION_UNSUPPORTED` | No auto-retry (re-probe / user decision) |
| Local | `INSUFFICIENT_DISK_SPACE`, `PERMISSION_DENIED`, `FILESYSTEM_ERROR` | No auto-retry; pause + report |
| Media | `MEDIA_ENCRYPTED`, `MEDIA_LIVE_UNSUPPORTED`, `MEDIA_PLAYLIST_INVALID` | No |
| Engine | `ENGINE_OFFLINE` (extension side), `INVALID_URL`, `BLOCKED_HOST` (§12) | No |

**Rule:** error messages shown to users are plain language + the
code (e.g. "Download failed: server returned 404 (NOT_FOUND). The
file may have been removed."). Raw stack traces stay in the local
log, not in UI copy.

### 11.2 Per-segment vs per-job failure

- A **segment** failure retries independently (§11.3) without
  failing the job. Only when a segment exhausts its retries does
  the **job** fail (or pause, per policy below).
- A **job-level** failure (probe fatal, range mismatch, disk full)
  pauses/fails the whole job regardless of segment state.

### 11.3 Retry and backoff (Phase 1 defaults — `planned`, tunable)

- Per-segment retries: **5 attempts** (initial + 4 retries).
- Backoff: exponential with jitter — 1 s, 2 s, 4 s, 8 s, 16 s
  (×2, capped at 60 s), plus uniform jitter ±25% to avoid
  thundering-herd synchronisation across segments.
- `Retry-After` (seconds or HTTP-date) overrides the computed delay
  when it is longer.
- After final retry exhaustion: job → `FAILED` (CLI default) or
  `PAUSED` (UI default, so the user can inspect and resume manually
  without losing the checkpoint). This default difference is
  intentional: CLI users script around FAILED; UI users expect to
  be able to press Resume. Configurable in both.
- **No infinite retry.** Ever. A job that retries forever is a
  denial-of-service against the origin server and against the user's
  own bandwidth.

### 11.4 Logging

- Local log file (rotating, e.g. 5 × 10 MiB, `planned` sizes) in the
  config dir. Levels: `error`, `warn`, `info`, `debug`.
- Logs contain URLs (host + path, **never** embedded credentials),
  jobIds, segment indices, status codes, and timings. They never
  contain headers, cookies, or tokens.
- A user can export a redacted log bundle for bug reports; the
  export step strips query strings that look like tokens
  (`token=`, `key=`, `auth=`, `sig=` — heuristic redaction, and the
  user is warned it is heuristic, not a guarantee).

---

## 12. Security boundaries and threat model

### 12.1 Trust boundaries (diagram in words)

1. **Browser ↔ Native Host:** the browser is *untrusted input* to
   the host in the sense that any extension message is validated
   against a schema before use. A compromised/malicious page cannot
   speak Native Messaging directly (only the installed extension
   can), but the host still validates, because defence in depth.
2. **Native Host ↔ Engine API:** loopback only. The API binds
   `127.0.0.1`, never `0.0.0.0`. A remote machine cannot reach it
   even if the user's firewall is misconfigured, because the socket
   never listens externally.
3. **Engine ↔ Origin server:** the engine makes only the requests
   the user asked for, to the URL the user supplied (plus redirects,
   bounded, §4.2). It does not follow the user around the web.
4. **UI ↔ Engine:** the UI is a local client with the same trust as
   the user. In Tauri Phase 2, the frontend's capabilities are
   allow-listed (§7.1); a compromised webview cannot read arbitrary
   files — it can only call the Tauri commands it was granted.

### 12.2 API authentication (loopback token — Phase 1 pragmatic choice)

- On first run, the engine generates a random 256-bit token stored
  `0600` in the config dir. Local clients (UI, CLI, Native Host)
  read it from the same config dir (same user, same machine) and
  present it as `Authorization: Bearer <token>` (HTTP mode) or as a
  `token` field (stdio mode).
- This is **not** a defence against other processes running as the
  same user — on a single-user machine, same-user processes can
  read the same config dir by design. It *is* a defence against
  other origins: a random website cannot guess the token and cannot
  drive the engine via a browser request (plus CORS is denied for
  non-loopback origins, and the API rejects `Origin` headers from
  web pages in HTTP mode).
- Token rotation: on user request (Settings → "Reset local API
  token") or on detection of a suspicious pattern (repeated auth
  failures from distinct processes — logged, not auto-rotated, to
  avoid breaking the user's own clients silently).

### 12.3 URL and host policy

- **Allowed schemes:** `http:`, `https:` only.
- **Blocked by default (configurable allow-list override with explicit
  user confirmation):** `localhost` / loopback / RFC-1918 private
  addresses / link-local, as *download targets* — to prevent the
  engine being used as a confused deputy to probe the user's LAN
  (SSRF-style abuse via a malicious link the user was tricked into
  sending). The user can allow a private host explicitly per-job
  with a confirmation dialog; the default is deny with a clear
  `BLOCKED_HOST` error.
- **Redirect policy:** follow ≤5 redirects; if a redirect crosses
  from public → private address, stop with `BLOCKED_HOST`. If a
  redirect changes scheme https → http, warn in the job record
  (downgrade) and continue only if the user allowed downgrades
  (default: allow, but record it — a hard block here breaks too
  many legitimate CDNs; the downgrade is visible, not silent).
- **Credentials in URL:** `https://user:pass@host/` is rejected by
  default in the API (return `INVALID_URL`, suggest pasting without
  credentials). If a future decision allows it (D-09), credentials
  must never be logged or stored in the checkpoint (§9.2).

### 12.4 What is NOT stored, ever

- Browser cookies, session tokens, passwords, `Authorization`
  headers, page HTML, browsing history, form data.
- Engine logs and checkpoints are audited against this list in
  Phase 1 code review (checklist item, §16).

### 12.5 Supply-chain notes (Phase 1 honesty)

- Node.js dependencies for the prototype must be pinned
  (`package-lock.json` committed) and installed from the public npm
  registry. No vendored binary blobs, no downloaded executables
  from untrusted URLs during build.
- The Tauri Phase 2 build will need a Rust toolchain + crates.io
  access; supply-chain review (cargo audit or equivalent) is a
  Phase 2 milestone, `planned`, not claimed as done here.

---

## 13. Tech choices with rationale (and rejected alternatives)

| Choice | Rationale | Status | Rejected alternative + why |
|---|---|---|---|
| Node.js 24 for Phase 1 engine prototype | Available + verified on this VM (§1.3); strong HTTP client ecosystem; fast to iterate and test on Linux; single language with the extension host | **Phase 1, in use for prototyping** | Python `requests`/`aiohttp` prototype — viable, but two-language split with the JS extension host adds friction; Python remains the tooling/test option |
| Rust for the eventual engine core (via Tauri) | Performance, single static binary for distribution, Tauri's native language | **Planned (Phase 2)** — no toolchain here yet, so no Rust code is claimed | Go — also viable for a downloader core; rejected for now only because Tauri's Rust integration is tighter than a Go+webview split. Revisit in D-02 if Tauri falters |
| Tauri 2 + React + TypeScript + Tailwind for desktop UI | §7.1; small bundle, OS webview, capability model | **Planned (Phase 2)** | Electron — larger bundle, bundled Chromium, heavier idle footprint; kept as fallback (D-02) |
| MV3 browser extension + Native Messaging | Only browser-sanctioned way for an extension to reach a desktop app; MV3 is the current Chrome store baseline | **Spec'd; prototype host in sibling work** | NPAPI / native binary injection / traffic interception — obsolete, store-forbidden, or out of policy; rejected |
| HTTP Range (`Accept-Ranges` / `206`) segmentation | The standard, server-supported mechanism; no proprietary protocol needed | **Core design (§4)** | Custom multi-connection protocol — no server would speak it; rejected |
| `.part` + sidecar checkpoint JSON (Phase 1) | Simple, inspectable, crash-safe with atomic rename (§9.3); debuggable with ordinary tools | **Design; suffix to confirm (D-06)** | Single SQLite DB for everything in Phase 1 — adds a dependency + tooling for a prototype that benefits from human-readable checkpoints; SQLite is the Phase 2 migration (§9.1) |
| SQLite for job store (Phase 2) | Durable, queryable, single-file, no server | **Planned** | Postgres / server DB — absurd for a local desktop app; rejected |
| Loopback HTTP + stdio JSON-RPC (one schema) | One message schema, two transports for two clients (UI/CLI vs Native Host) | **Design (§3.6)** | D-Bus / named pipes as primary API — Linux-only, complicates the Windows port; rejected as primary (may appear as a Phase 2 Linux convenience) |
| Token-bucket throttling (§4.7) | Correct per-job (not per-segment) limits; cooperative, no reconnect storms | **Design** | Per-connection throttling — multiplies the limit by N; rejected as a bug, not a choice |

---

## 14. Concurrency, limits, and resource policy

| Limit | Phase 1 default | Configurable range | Notes |
|---|---|---|---|
| Global simultaneous downloads | 3 | 1–10 | Scheduler slot (§8.1) |
| Per-host simultaneous downloads | 2 | 1–10 | Prevents hammering one origin |
| Connections per download (segments) | 8 | 1–32 | Above ~16, returns diminish and server complaints rise; `not-run` — tune by measurement in Phase 1 |
| Per-job speed limit | 0 (unlimited) | bytes/s | Token bucket (§4.7) |
| Global speed limit | 0 (unlimited) | bytes/s | Token bucket across jobs |
| Redirects followed | 5 | 1–10 | §12.3 |
| Segment retry attempts | 5 total | 1–10 | §11.3 |
| Checkpoint batch | 1 MiB or 5 s | tunable | §9.3 |
| Max in-memory buffer per segment | 64 KiB chunks | — | Never load a whole file (§4.6) |
| Max Native Message size | 1 MiB | fixed | §5.3 |

**Backpressure:** if the disk write queue grows (slow disk, fast
network), segment reads pause — the engine never buffers an unbounded
amount of downloaded-but-unwritten data in memory.

---

## 15. Configuration and observability

### 15.1 Config locations (Linux, Phase 1)

```
~/.config/download-manager/
  config.json          # user settings (dirs, limits, scheduler, UI prefs)
  jobs.json            # Phase 1 job store (§9.1)
  api-token            # 0600 loopback token (§12.2)
  logs/
    engine.log         # rotating log (§11.4)
~/Downloads/           # default download dir (user-changeable, per category)
```

Windows/macOS paths are Phase 2 packaging concerns (`planned`,
`not-verified` here — Tauri's dirs API will supply them; do not
hard-code Linux paths into cross-platform code).

### 15.2 Settings surface (minimum Phase 1)

Download dir + per-category dirs; global/per-job speed limits;
max connections; max simultaneous downloads; scheduler windows;
"confirm before sending" (extension); hash verification preference;
log level; API token reset. Every setting has a default, a type,
and a validation rule — invalid config fails loudly on startup
with the offending key named, rather than silently falling back
and confusing the user.

### 15.3 Metrics (local only, no telemetry)

Per-job: bytes, elapsed, current/average speed, ETA (bytes
remaining ÷ recent average speed, smoothed over ~10 s — ETA is an
estimate and labelled as such in the UI, never a promise). Global:
active jobs, aggregate speed, disk free in target dirs. All metrics
are computed locally from engine state; nothing leaves the machine.

---

## 16. Testing strategy (Phase 1, Linux-prototype scope)

> No test results are claimed in this document. The items below are
> the *plan*; results belong in test reports with method + date, and
> any number quoted there must be measured, not simulated.

1. **Unit tests (engine):** segmentation math (edge cases: 0-byte,
   1-byte, length not divisible by N, unknown length); range-header
   construction; filename sanitisation; checkpoint
   serialise/deserialise round-trip; backoff sequence.
2. **Local HTTP fixture server (the key Phase 1 harness):** a small
   Node/Python server on loopback that serves: range-supporting
   files, range-refusing files, redirect chains, `HEAD`-rejecting
   endpoints, slow/trickling responses, `429` + `Retry-After`,
   `ETag` changes mid-download, and truncated responses. The engine
   is tested against this fixture, not against the public internet
   (deterministic, offline, repeatable).
3. **Crash-recovery tests:** kill the engine mid-download (SIGKILL),
   restart, resume, verify byte-identical output vs the fixture's
   original (hash comparison). Repeat with each segment in a
   different state.
4. **Checkpoint corruption tests:** truncate / garble a checkpoint
   and a `.part`; engine must fail safely (§9.4), never produce a
   corrupt "completed" file.
5. **Extension-host contract tests:** schema validation (unknown
   fields, oversized messages, wrong framing) against the Native
   Host without a browser, using length-prefixed stdin/stdout.
6. **Media tests:** parse real (public, unencrypted, licence-free)
   sample playlists locally; verify variant listing, segment
   resolution, encrypted-playlist refusal (§6.4), and TS
   concatenation byte order.
7. **Windows testing: explicitly NOT in Phase 1.** Any Windows
   behaviour (installer, WebView2, Native Host registry, power
   management) is `not-verified` until Phase 2 has a real Windows
   machine. Phase 1 test reports must say so.

---

## 17. Open decisions (carried into roadmap.md)

| ID | Decision | Options / lean | Needed before |
|---|---|---|---|
| D-01 | Engine core language for the shipped product: stay Node (bundled runtime) vs port to Rust | Lean Rust-via-Tauri for distribution; Node prototype proves the design first | Phase 2 start |
| D-02 | UI shell: Tauri 2 vs Electron fallback | Lean Tauri 2 (§7.1); fallback if WebView2 evidence fails | Phase 2 start |
| D-03 | Frontend state library | Zustand vs Redux Toolkit vs plain React state | Phase 2 UI build |
| D-04 | Native Host → engine transport: loopback HTTP only, or stdio JSON-RPC when engine is a child process | Lean loopback HTTP only (one transport); stdio only if the host must spawn the engine | Phase 1 extension prototype sign-off |
| D-05 | Extension auto-capture / traffic sniffing | Default OFF; any ON requires separate justification + store-policy review | Any auto-capture work (not Phase 1) |
| D-06 | Checkpoint file suffix + layout: `.part.json` sidecar vs central DB only | Reference in this doc: `.part.json` sidecar; sibling implementations must converge | Phase 1 engine/extension integration |
| D-07 | Dynamic segment re-splitting / segment stealing | Phase 1: no; Phase 2: measure benefit before adding complexity | Phase 2 optimisation |
| D-08 | Queue pre-emption on reorder | Phase 1: no pre-emption; Phase 2: revisit | Phase 2 scheduler polish |
| D-09 | Credentials-in-URL policy | Phase 1: reject; revisit only with a storage + logging design that never persists them | Any such feature |
| D-10 | fMP4 remux (ffmpeg) for media jobs | Phase 1: TS concat + direct files only; ffmpeg remux `planned` if ffmpeg availability + correctness verified | Phase 2 media |
| D-11 | Windows packaging: MSI vs MSIX vs portable ZIP | Undecided; needs real Windows testing + signing decision (Phase 3) | Phase 2 packaging |
| D-12 | Auto-update channel | Undecided; Tauri updater vs manual download; signing prerequisite (Phase 3) | Phase 3 |

---

## Appendix A — Module / file layout (planned)

> This is a *target* layout for the prototype, not a claim that these
> files exist or pass tests. Sibling agents own implementation; this
> layout is the coordination reference — divergences go to §17.

```
download-manager/
  docs/
    architecture.md      # this file
    feature-matrix.md    # IDM vs planned (public-doc / planned / not-verified)
    roadmap.md           # phases, milestones, dependencies, decisions
  engine/                # sibling area: download engine implementation
    src/
      probe.js           # HEAD / range probe (§4.2)
      segmenter.js       # segmentation (§4.3)
      fetcher.js         # range fetching, retries (§4.3, §11)
      writer.js          # positional .part writes (§4.4)
      checkpoint.js      # atomic checkpoint I/O (§9.3)
      scheduler.js       # queue + windows (§8)
      api.js             # local API server (§3.6)
      media/             # playlist parsing (§6.3)
  extension/             # sibling area: MV3 extension + native host
    manifest.json
    src/                 # service worker, content script, popup
    native-host/         # host executable + manifests
  ui/                    # sibling area: Tauri + React (Phase 2)
  specs/                 # sibling area: API / format specs
  tests/
    fixtures/            # local HTTP fixture server (§16.2)
    engine.test.*        # unit + crash-recovery tests
    media.test.*         # playlist tests
    host.test.*          # native-host contract tests
```

---

## Appendix B — Glossary

- **Segment:** one contiguous byte range of a file, fetched by one
  connection (§4.3). Not to be confused with an HLS/DASH media
  segment (§6), which is a separate file/byte-range in a playlist.
- **Checkpoint:** the versioned JSON record of a job's progress
  (§9.2), written atomically (§9.3).
- **`.part` file:** the in-progress download bytes. Never presented
  as a finished file.
- **Native Messaging:** the browser-sanctioned stdin/stdout JSON
  channel between an extension and a local host executable (§5.3).
- **MV3:** Manifest Version 3, the current Chrome extension
  manifest format (service workers, declarative permissions).
- **DRM:** digital rights management / content protection
  (Widevine, FairPlay, PlayReady, HLS AES-128 key encryption,
  DASH ContentProtection). Out of scope for circumvention (§6.4).
- **`public-doc` / `planned` / `not-verified`:** labelling scheme
  used across this project's docs. See the honesty header and
  `feature-matrix.md` for definitions.

---

*End of architecture.md — Phase 1 foundation. Companion documents:
`feature-matrix.md` (IDM comparison, labelled) and `roadmap.md`
(phases, milestones, dependencies, open decisions).*
