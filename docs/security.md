# Download Manager — Security Design (Phase 1)

> **Status — read this first.**
> This document is a **design specification**, not an audit of finished code.
> As of 2026-10-21, `engine/` and `extension/` (including `extension/native-host/`)
> are **empty scaffolds — no code exists there to audit**, and `ui/` is an
> unmodified stock Vite + React + TypeScript template. Every control below is
> therefore labelled **[DESIGN]** (must be implemented as specified) unless it
> says **[EXISTS]**.
>
> **No Windows machine is available in this environment.** Every Windows-specific
> control is labelled **[DESIGNED — NOT TESTED ON WINDOWS]** and must be
> verified on a real Windows host before release. Nothing in this document
> reports a test result that was not actually performed, and no scan result is
> claimed that was not actually run (see §10).
>
> **Scope:** Phase 1 only — unauthenticated downloads of public files over
> HTTP/HTTPS, via a browser extension talking to a local native host / engine.
> Anything beyond that (accounts, payments, cloud storage, browser automation)
> is out of scope until this document is revised.

## 0. Hard boundaries (non-negotiable)

These are not trade-offs. If a feature request conflicts with one of them,
the feature is refused or redesigned — it is not shipped with a warning.

1. **No DRM circumvention.** The downloader must not defeat, bypass, or work
   around DRM, encryption, token-gated playback protection, or any other
   technological protection measure, and must not download from a source
   whose access control it is evading. A URL the user can already open and
   download in their browser is in scope; a stream the site deliberately
   protects is not.
2. **No unauthorized access.** Only URLs the user explicitly supplies (paste,
   extension "send to downloader" click, or a file they choose) are fetched.
   The app must never crawl, guess, brute-force, or probe a server, and must
   never fetch a URL the user did not ask for.
3. **Never extract browser cookies, passwords, or tokens.** The extension
   must not read `cookies`, `history`, saved passwords, session storage, or
   any site's authentication state, and must not forward any of them to the
   native host or engine. No `cookies` permission, no cookie exfiltration
   workaround. If a download requires being logged in, Phase 1 fails it
   cleanly (see §8) — it does not borrow the browser's session.
4. **No silent execution.** Downloaded files are data, never code to run.
   The app must never execute, auto-open, or "helpfully launch" a download,
   and must never pass a downloaded path to a shell, interpreter, or
   installer. Opening a file is always an explicit user action in their own
   file manager / viewer.

## 1. Threat model

### 1.1 Assets and trust boundaries

| Asset | Why it matters |
|---|---|
| User's files and filesystem | A malicious filename or destination can overwrite data or plant files (e.g. in a startup folder). |
| User's credentials / sessions | Must not exist in this app in Phase 1 (see §8); the main risk is accidentally capturing them via the extension channel. |
| Download integrity | A tampered or swapped file (wrong content, malware) must be detected or at least never silently trusted. |
| The native host's privileges | It runs as the user and can write files; any other extension or process that can talk to it inherits that power. |
| Network identity of the user | Redirects and metadata endpoints can leak the URL, IP, and headers to third parties. |

Trust boundaries (data crossing one must be validated on the receiving side,
never trusted because of where it came from):

```
  Untrusted web page / server        Browser extension         Native host / engine
  ───────────────────────────  ──►  ─────────────────────  ──►  ─────────────────────
  URL, filename, headers,            message (JSON)             filesystem, network
  redirects, checkpoint data                                  (both re-validated here)
```

Key principle: **the engine re-validates everything, even if the extension
already validated it.** The extension is a convenience UI, not a security
layer — a compromised or malicious extension, or any other process that can
reach the host, must not be able to bypass the engine's checks.

### 1.2 Threats

| ID | Threat | Attacker / vector | Impact if unmitigated | Mitigated by |
|---|---|---|---|---|
| T1 | Malicious extension / process impersonates the real extension and drives the native host | Any installed extension, or local malware | Arbitrary file writes as the user | §6 (allowed origins, manifest placement, message allowlist) |
| T2 | Malicious URL: `file://`, `javascript:`, `data:`, `ftp:`, `chrome://`, internal IPs, cloud metadata endpoints | Link, page, pasted URL, redirect | Local file read, SSRF, cloud-credential theft | §2, §3 |
| T3 | Open-redirect / redirect chain to a malicious or credential-harvesting origin | Compromised or hostile server, short-link | Download from attacker server; header/credential leak across origins | §2 (redirect rules) |
| T4 | Path traversal via server-supplied filename (`../../`, absolute paths, separators, control chars) | `Content-Disposition` header, URL basename | Overwrite files outside the download folder | §4 |
| T5 | Destination escape: user-chosen or stored destination pointing outside the intended folder, symlink escape, TOCTOU swap | Stored config, symlink planted between check and write | Write outside the download folder | §4, §5 |
| T6 | Server lies about the file: changes `ETag` / `Content-Length` mid-download or on resume, serves different bytes for a range | Hostile or buggy server, MITM on plain HTTP | Corrupt, truncated, or swapped file presented as complete | §7 |
| T7 | Checkpoint / resume-state tampering | Local malware, another user/process, crafted `.part` sidecar | Resume writes attacker-chosen bytes to an attacker-chosen path, or resumes a different file | §7 |
| T8 | Supply-chain compromise: malicious or vulnerable dependency | npm / pip / cargo ecosystem | Code execution or data theft via a trusted-looking package | §10 |
| T9 | Malicious file content executed or trusted by the user | Downloaded executable, script, archive, document with macros | Malware execution, misleading "verified" badge | §9, §0 rule 4, UI warnings |
| T10 | Log / error-message leakage | Verbose logs, crash dumps | URLs with tokens, paths, or user data end up in logs or bug reports | §8.4 |
| T11 | DNS rebinding / redirect-to-private-IP | Attacker-controlled DNS or redirect | SSRF against LAN services or metadata endpoints after the first check passes | §2.5 |
| T12 | Denial of service / disk exhaustion | Huge or infinite `Content-Length`, decompression bomb, unbounded concurrency | Disk full, system unusable | §5.4, §7.3 |

### 1.3 Explicitly out of scope for Phase 1

- Malware scanning of downloaded content (rely on the OS / user's antivirus;
  do not claim the app "scans for viruses").
- TLS certificate validation bypasses, custom CAs, or plain-HTTP "upgrade"
  tricks — TLS verification stays on, always (see §2.6).
- Multi-user / shared-machine isolation beyond normal OS file permissions.
- Sandboxing of the native host (recommended as a Phase 2 hardening item,
  not a Phase 1 gate — see §11).

## 2. URL sanitization rules **[DESIGN]**

All rules apply identically to the **initial URL and to every redirect
target**. A redirect is a new URL: it gets the full validation pass, not a
short-cut. Validation happens in the **engine**, not only in the extension.

### 2.1 Allowed schemes — http and https only

- Accept: `http`, `https` (case-insensitive, after parsing — never by
  string prefix, which is bypassable, e.g. `https:evil` or `http%3a//`).
- Reject everything else, including but not limited to: `file`, `ftp`,
  `javascript`, `data`, `blob`, `chrome`, `about`, `view-source`, `ws`,
  `wss`, `mailto`, `ssh`, `smb`, and any scheme with control characters,
  whitespace, or mixed case tricks (`HtTp` is fine after lower-casing;
  `java\tscript:` is not — it must be rejected, not normalized into
  something executable).
- Parse with a real URL parser (WHATWG URL / `urllib.parse` equivalent),
  never with regexes or string splitting. Reject the URL if parsing fails,
  if the hostname is empty, or if the URL contains ASCII control characters
  (`U+0000–U+001F`, `U+007F`) or unencoded spaces anywhere.

### 2.2 Credentials in URLs

- A URL containing a username/password (`https://user:pass@host/…`) is
  **rejected in Phase 1**. Rationale: it is almost always a phishing or
  credential-leak vector (`https://trusted.com@attacker.com/`), and Phase 1
  has no credential handling at all (§8). Do not strip and proceed silently;
  reject with a clear message ("URLs with embedded credentials are not
  supported").
- Never log a URL's userinfo, query string, or fragment at INFO level or
  above (see §8.4). Query strings can carry tokens.

### 2.3 Redirect validation

1. **Same checks, every hop.** Each redirect target is re-parsed and
   re-validated against §2.1, §2.2, and §2.4 before following it.
2. **Redirect count cap: 10.** Exceeding it aborts the download with
   "too many redirects". (Browsers allow ~20; a downloader has no need for
   more than 10, and a lower cap bounds redirect-loop DoS.)
3. **No credential leakage across origins.** On a cross-origin redirect
   (different scheme, host, or port):
   - Drop `Authorization` and any custom auth headers entirely.
   - Drop the request body on 301/302/303 (303 always becomes GET); do not
     re-send a body cross-origin.
   - Never forward the original URL's query string or fragment to the new
     origin unless the redirect target itself carries them.
   - Same-origin redirects may preserve headers; cross-origin ones must not.
4. **No scheme downgrade.** A redirect from `https://` to `http://` is
   **rejected** (downgrade attack: the "secure" download silently becomes
   interceptable). `http://` → `https://` is allowed.
5. **No redirect to a blocked destination.** A redirect to a private /
   loopback / metadata address (§2.4) is rejected even if the initial URL
   was public — this is the classic open-redirect-to-SSRF bypass.
6. Only redirect status codes 301, 302, 303, 307, 308 are followed, and only
   when a valid `Location` header is present. A relative `Location` is
   resolved against the current URL and then re-validated.
7. The user-visible "source URL" shown in the UI is the **final** URL after
   redirects, so the user can see where the file actually came from. The
   original URL is kept in the download record for audit, not displayed as
   the source.

### 2.4 Blocked destinations (SSRF / internal endpoints)

**[DESIGN]** — The following are rejected unless an explicit, per-download,
user-confirmed justification exists (see the exception procedure below).
There is no Phase 1 feature that needs them, so the default is block-all:

- Loopback: `127.0.0.0/8`, `::1`.
- Private ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  `fc00::/7` (ULA), `fe80::/10` (link-local).
- Link-local / metadata: `169.254.0.0/16` — including the cloud metadata
  endpoints `169.254.169.254` (AWS / GCP / Azure IMDS) and
  `100.100.100.100` (Alibaba), plus `metadata.google.internal`.
- Unspecified / reserved: `0.0.0.0/8`, `::`, `::ffff:0:0/96` (IPv4-mapped
  forms must be unwrapped and re-checked — `::ffff:127.0.0.1` is loopback).
- Hostnames that resolve to any of the above (see §2.5), and hostnames
  `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.intranet`.
- `file://` and any non-http(s) access to local paths, device paths, or
  internal services — there is no legitimate Phase 1 path that needs them.

**Exception procedure (not a bypass):** if a future feature genuinely needs
a private endpoint (e.g. a company-internal file server), it must be added
as an explicit, opt-in, per-host allowlist entry the user types themselves,
stored in user config, shown in the UI, and logged — never as a silent
allowlist, a wildcard, or a URL-parameter flag. Until that feature exists,
the exception procedure is: **do not implement the download**.

### 2.5 DNS rebinding

Checking the hostname once at validation time is not enough: an
attacker-controlled DNS name can resolve to a public IP for the check and
to `127.0.0.1` when the connection is made. **[DESIGN]** requirements:

- Resolve the hostname, validate **every** returned address against §2.4,
  and reject if any address is blocked (not just the first).
- Where the HTTP stack supports it, pin the validated address for the
  connection (connect to the validated IP with the original hostname kept
  for TLS SNI / Host verification). If the stack cannot pin, re-validate
  after each redirect and treat a mid-download address change to a blocked
  range as fatal.
- Do not cache DNS results across redirects without re-validation.

### 2.6 Transport rules

- TLS certificate verification is **always on**. No "ignore certificate
  errors" option, no click-through for self-signed certificates in Phase 1.
  A TLS failure is a download failure with a plain-language message.
- Prefer HTTPS: an `http://` URL is accepted (many legitimate file hosts
  still serve plain HTTP) but the UI must show it as **not encrypted**, and
  checksum verification (§9) is strongly recommended for HTTP downloads.
- Send a minimal, static `User-Agent` identifying the app; never send
  browser cookies, browser fingerprints, or user credentials (§0 rule 3).
- Respect `Content-Length` sanity (§7.3) and never trust the server's
  claimed MIME type for execution decisions.

### 2.7 URL test vectors

| # | Input | Expected outcome |
|---|---|---|
| U1 | `https://example.com/files/report.pdf` | ✅ Accept |
| U2 | `http://example.com/files/report.pdf` | ✅ Accept, UI marks "not encrypted" |
| U3 | `file:///etc/passwd` | ❌ Reject — scheme not allowed |
| U4 | `javascript:alert(1)` | ❌ Reject — scheme not allowed |
| U5 | `data:text/html,<script>alert(1)</script>` | ❌ Reject — scheme not allowed |
| U6 | `ftp://example.com/file.zip` | ❌ Reject — scheme not allowed |
| U7 | `https://user:secret@example.com/file.zip` | ❌ Reject — embedded credentials |
| U8 | `https://example.com@evil.com/file.zip` | ❌ Reject — embedded credentials (host is `evil.com`; also fails the credential rule) |
| U9 | `https://169.254.169.254/latest/meta-data/` | ❌ Reject — metadata endpoint |
| U10 | `https://127.0.0.1/admin` | ❌ Reject — loopback |
| U11 | `https://192.168.1.1/router` | ❌ Reject — private range |
| U12 | `https://[::ffff:127.0.0.1]/x` | ❌ Reject — IPv4-mapped loopback |
| U13 | `https://example.com/redirect` → `Location: file:///etc/passwd` | ❌ Abort at redirect — re-validation fails |
| U14 | `https://example.com/a` → `https://evil.com/b` (with `Authorization` set) | ⚠️ Follow only after re-validation; `Authorization` header dropped on the cross-origin hop |
| U15 | `https://example.com/a` → `http://example.com/b` | ❌ Reject — scheme downgrade |
| U16 | 11 redirects in a chain | ❌ Abort — redirect cap (10) exceeded |
| U17 | `https://exa mple.com/file.zip` (space / control char) | ❌ Reject — malformed URL |
| U18 | `https://example.com/files/%2e%2e/%2e%2e/etc/passwd` | URL is syntactically valid, but the derived filename must still be sanitized per §4 — the URL path is never used as a filesystem path verbatim |
| U19 | `https://metadata.google.internal/` | ❌ Reject — internal hostname |
| U20 | `https://example.com/file.zip#fragment` | ✅ Accept; fragment is not sent to the server and not used in the filename |

## 3. Filename derivation (where the name comes from)

Order of preference, with every candidate passed through §4 before use:

1. `Content-Disposition` filename, if present and parseable (RFC 6266 /
   RFC 5987 `filename*` with charset decoding; reject undecodable or
   control-character-containing values rather than guessing).
2. The last path segment of the **final** URL (after redirects), percent-decoded.
3. A fallback: `download` plus the current timestamp (e.g.
   `download-20261021-193700`) — never an empty string, never the raw URL,
   never a server header verbatim.

Rules that apply regardless of source:

- The filename is **data**, never a path. It is always reduced to a single
  path component by §4 before it touches the filesystem.
- The file extension from the server/URL is preserved (the user needs to
  know what they downloaded) but is **not trusted** for any execution or
  "open with" decision, and is shown in full in the UI — double extensions
  (`report.pdf.exe`) must be displayed in full, never truncated to the
  first extension.
- If `Content-Disposition` and the URL disagree, prefer
  `Content-Disposition` (it is the server's explicit intent) but still
  sanitize it; log the discrepancy at debug level only.

## 4. Filename sanitization + path-traversal prevention **[DESIGN]**

This is the highest-risk area in a downloader: one missed separator or
reserved name can turn a download into a write anywhere the user can write.

### 4.1 Sanitization steps (apply in this order)

Given a raw candidate name (from §3):

1. **Percent-decode** (for URL-derived names) and Unicode-normalize
   (NFC). Reject the name if it contains `U+0000` after decoding — a NUL
   byte must abort, not be stripped silently, because it signals a crafted
   input.
2. **Take the basename only.** Split on both `/` and `\` and keep the last
   non-empty segment. This kills `../../evil`, `..\evil`, absolute paths
   (`/etc/passwd`, `C:\Windows\…`), and mixed-separator tricks
   (`..\/..\evil`) in one step. Do this **before** any other cleaning, and
   do it again after step 3 (cleaning can expose a new separator).
3. **Strip or replace dangerous characters.** Remove ASCII control
   characters (`U+0000–U+001F`, `U+007F`), and replace each of
   `< > : " / \ | ? *` with `_`. (On POSIX, `/` and NUL are the only
   forbidden characters, but applying the full Windows set on all platforms
   keeps behaviour identical everywhere and avoids cross-platform surprises
   when a folder is later opened on Windows.)
4. **Strip leading dots and spaces, and trailing dots and spaces.**
   Leading dots hide files (`.bashrc`) and enable `..`/`...` tricks;
   trailing dots/spaces are silently stripped by Windows, so
   `evil.exe...` would otherwise become `evil.exe` on disk while the UI
   showed something else. After this step, if the name is empty, use the
   §3 fallback.
5. **Reserved Windows names [DESIGNED — NOT TESTED ON WINDOWS].**
   Reject-or-rename (rename is preferred: append `_`) the following,
   case-insensitively, with or without an extension, and with or without
   trailing dots/spaces (already stripped in step 4):
   `CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`.
   So `CON`, `con.txt`, `AUX.exe`, `nul` all become `CON_`, `con_.txt`,
   `AUX_.exe`, `nul_`. This applies on **all** platforms, not just Windows,
   so a folder synced or moved to Windows stays safe.
6. **Length cap.** Truncate the base name (preserving the extension) so
   the full component is at most **200 characters** (below the 255-byte
   filesystem limit, leaving room for suffixes like ` (1)` and `.part`).
   Truncation must not split a multi-byte UTF-8 character; truncate on
   character boundaries and re-check the byte length.
7. **Collision handling.** If the sanitized name already exists in the
   destination, append ` (1)`, ` (2)`, … before the extension. Never
   overwrite an existing file without an explicit user confirmation, and
   never follow the "overwrite" path silently on resume (see §7).

### 4.2 Destination containment check (mandatory, on every write)

Sanitization alone is not enough — the final check is a containment proof:

```
resolved_destination = realpath(download_dir)          # resolve symlinks once, at setup
candidate            = realpath(join(download_dir, sanitized_name))
require candidate is inside resolved_destination
        (commonpath(candidate, resolved_destination) == resolved_destination)
        AND candidate != resolved_destination
```

Rules:

- Perform the check on the **resolved** path (symlinks resolved), not the
  lexical path — a symlink inside the download folder pointing outside it
  must fail the check.
- Perform it **at write time**, not only at download setup: a symlink can
  be planted between setup and write (TOCTOU). The safe pattern is:
  open the destination file with `O_NOFOLLOW` / no-follow semantics where
  available, or create the `.part` file and then `lstat` it and re-check
  containment before writing any bytes.
- The same check applies to the temporary `.part` file, the final file,
  the checkpoint sidecar (§7), and any extracted or moved file. There are
  no exceptions for "trusted" names.
- If the check fails: abort the download, delete any partial file created
  in this run, and report "destination outside the download folder" — do
  not fall back to another folder silently.

### 4.3 Filename test vectors

| # | Raw input | Expected sanitized output | Why |
|---|---|---|---|
| F1 | `report.pdf` | `report.pdf` | Clean input passes through |
| F2 | `../../etc/passwd` | `passwd` | Basename only |
| F3 | `..\\..\\evil.exe` | `evil.exe` | Backslash separators also split |
| F4 | `/etc/passwd` | `passwd` | Absolute path reduced to basename |
| F5 | `C:\Windows\System32\evil.dll` | `evil.dll` | Windows absolute path reduced to basename |
| F6 | `..\/..\/evil.sh` | `evil.sh` | Mixed separators reduced to basename |
| F7 | `my<file>:name?.txt` | `my_file__name_.txt` | Forbidden chars replaced |
| F8 | `file\x00name.txt` (NUL) | ❌ Reject download | NUL signals crafted input; abort, don't strip |
| F9 | `file\x01name.txt` (control char) | `filename.txt` | Other control chars stripped |
| F10 | `CON` | `CON_` | Reserved Windows name |
| F11 | `con.txt` | `con_.txt` | Reserved name, case-insensitive, with extension |
| F12 | `AUX.exe` | `AUX_.exe` | Reserved name with extension |
| F13 | `LPT9.dat` | `LPT9_.dat` | Reserved name |
| F14 | `COM1` | `COM1_` | Reserved name |
| F15 | `.bashrc` | `bashrc` | Leading dot stripped (hidden-file trick) |
| F16 | `...` | Fallback name (`download-<timestamp>`) | All dots stripped → empty → fallback |
| F17 | `evil.exe...` | `evil.exe` | Trailing dots stripped — and the UI must show this exact name, not the raw one |
| F18 | `report.pdf.exe` | `report.pdf.exe` (shown in full) | Double extension displayed, never truncated; file is never auto-executed (§0) |
| F19 | `  spaced name .pdf  ` | `spaced name .pdf` | Leading/trailing spaces stripped (interior spaces kept) |
| F20 | `ünïcödé — report.pdf` | `ünïcödé — report.pdf` (NFC) | Legitimate Unicode preserved |
| F21 | 300-character name | Truncated to ≤ 200 chars, extension preserved | Length cap |
| F22 | `` (empty) | Fallback name (`download-<timestamp>`) | Never an empty filename |
| F23 | `normal.pdf` + symlink `normal.pdf` → `/etc/` inside download dir | ❌ Abort — containment check fails on resolved path | Symlink escape blocked at write time |
| F24 | `..%2f..%2fevil` (URL-encoded traversal) | `evil` | Percent-decoding happens before basename extraction |

## 5. Download destination validation **[DESIGN]**

The download directory is user-chosen, but "user-chosen" still needs
validation — stored settings can be corrupted, and a previously valid
folder can become a symlink to somewhere else.

1. **Must be a real directory.** It must exist (or be creatable by the
   app with the user's confirmation), be a directory (not a file), and be
   writable by the app. If any check fails, refuse and ask the user to pick
   another folder — do not silently fall back to a default.
2. **Must not be a sensitive system location.** Refuse: the user's home
   directory root itself, OS install / system directories (`C:\Windows`,
   `/`, `/etc`, `/usr`, `/System`, …), the app's own install directory,
   and any folder containing OS or app configuration. This list is
   **[DESIGNED — NOT TESTED ON WINDOWS]** for the Windows entries and must
   be verified per-platform before release.
3. **Resolve once, then verify on every use.** At setup, resolve the
   directory to its canonical path (symlinks resolved) and store the
   canonical form. On every download, re-resolve and compare: if the
   canonical path changed (symlink swap), stop and ask the user to
   re-confirm the destination.
4. **Containment (see §4.2).** Every file the app writes for a download —
   final file, `.part` file, checkpoint sidecar — must pass the containment
   check against the canonical destination.
5. **No writes outside the destination.** The app must not write
   downloads, temp files, or logs into the destination of another download,
   into the system temp directory with a predictable name, or into the
   current working directory. Temp files live **inside** the destination
   directory as `<sanitized>.part` so they inherit the containment check.
6. **Predictable temp names are forbidden.** Do not use the raw filename
   as a temp name in a shared directory (symlink-planting attack). The
   `.part` file is created with exclusive-create (`O_EXCL`) semantics;
   if it already exists and is not this download's own resume file, treat
   it as a collision and pick a new name (§4.1 step 7).
7. **Per-download override.** If the user picks a different folder for one
   download, that folder goes through the same checks (1–4) before use.
   A per-download folder is never remembered as the default without an
   explicit "use as default" action.

### 5.1 Destination test vectors

| # | Destination | Expected outcome |
|---|---|---|
| D1 | Existing, writable user folder (e.g. `~/Downloads`) | ✅ Accept |
| D2 | Path that is a regular file, not a directory | ❌ Reject — not a directory |
| D3 | Non-writable directory | ❌ Reject — not writable |
| D4 | `/` or `C:\Windows` | ❌ Reject — sensitive system location |
| D5 | Home directory root itself | ❌ Reject — too broad (a typo'd destination could scatter files over the home dir) |
| D6 | Symlink inside the tree pointing outside it | ❌ Reject at re-resolution, or fail the §4.2 containment check |
| D7 | Destination that changed (symlink swapped) since setup | ❌ Stop, ask user to re-confirm |
| D8 | Non-existent nested path | ⚠️ Offer to create it; create only after user confirmation |

### 5.2 Disk-exhaustion guard

- Before starting, compare `Content-Length` (if present) against free disk
  space in the destination: if the file does not fit, refuse before
  writing anything. If `Content-Length` is absent (chunked), check free
  space periodically during the write and abort cleanly (keeping the
  `.part` file for resume) when free space drops below a safety margin
  (e.g. 100 MB or 5% of the volume, whichever is larger — exact threshold
  is an implementation choice, but the check must exist).
- Cap concurrent downloads (default: 3) so one batch cannot exhaust disk
  or sockets; the cap is user-configurable with a sane maximum.

## 6. Native Messaging host validation **[DESIGN]**

The extension ↔ native host channel is a privileged local IPC channel: the
host can write files as the user. Its security rests on **three independent
layers** — manifest placement, origin allowlisting, and message validation.
Losing any one layer must not, by itself, give an attacker arbitrary writes.

### 6.1 Host manifest placement

- The manifest is a JSON file naming the host binary by **absolute path**
  and declaring `allowed_origins` (see §6.2). It must be installed in the
  browser's per-user native-messaging location only, never system-wide
  unless the installer explicitly offers it and the user accepts:
  - Chrome / Edge on Linux: `~/.config/google-chrome/NativeMessagingHosts/`
    (or the Chromium / Edge equivalent); macOS:
    `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`.
  - Windows: registry under `HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>`
    pointing at the manifest path — **[DESIGNED — NOT TESTED ON WINDOWS]**.
- The manifest file and the host binary must be writable only by the user
  (no group/world write). The installer / first-run setup must verify this
  and warn if the permissions are looser — a world-writable host binary is
  a trivial privilege-escalation path for any local process.
- The manifest's `path` must be an absolute path to the app's own binary.
  Relative paths, paths through symlinks in world-writable directories,
  and paths supplied by the extension at runtime are all rejected.
- **No other installer, extension, or web page may register or replace the
  manifest.** If the manifest's contents differ from what the app installed
  (hash comparison at host startup), the host must refuse to serve requests
  and tell the user to re-run the app's setup.

### 6.2 Allowed origins / extensions

- `allowed_origins` must list **exactly one entry**: the real extension's
  ID, in the form `chrome-extension://<32-char-extension-id>/`.
- Never use a wildcard, a list of "all our extensions", or a pattern that
  matches any extension. Every additional origin is an additional trusted
  party with file-write power.
- The extension ID is fixed at publish time; if the ID ever changes, the
  manifest is updated by the app's installer, not by the extension, and the
  change is surfaced to the user.
- The host must not accept connections from web pages, `http(s)` origins,
  or other native hosts. Native Messaging already enforces this at the
  browser level via `allowed_origins`; the host adds a second check: it
  verifies the connecting extension's origin against its own compiled-in
  expected ID before processing any message, and drops the connection on
  mismatch. (This is defence in depth — if the manifest is ever tampered
  with, the host still refuses strangers.)

### 6.3 Message validation and schema **[DESIGN]**

Native Messaging frames each message as a 4-byte little-endian length
prefix followed by UTF-8 JSON. The host must enforce:

1. **Size limit: 1 MB maximum** (the Chrome Native Messaging limit; the
   host enforces it independently rather than trusting the browser to).
   A length prefix claiming more than 1 MB → drop the connection, do not
   attempt to read the body.
2. **Strict JSON parsing.** Reject: trailing data after the JSON value,
   duplicate keys (where the parser can detect them), non-UTF-8 bytes,
   and top-level values that are not objects.
3. **Schema allowlist, not denylist.** Each message must match exactly one
   known schema, with a `type` field drawn from a fixed enum (Phase 1:
   `download_request`, `cancel_download`, `pause_download`,
   `resume_download`, `get_status`). Unknown `type` values, unknown
   fields, and wrong field types are rejected — the message is dropped and
   an error is returned, not "processed with the unknown parts ignored".
4. **Field-level validation.** Every field is validated as if it came from
   an attacker, because it might have:
   - `url`: full §2 validation (§2.1–§2.4). The extension's say-so is
     worthless here — the engine re-validates.
   - `filename` (if supplied): full §4 sanitization; a supplied filename
     never bypasses sanitization, and never overrides containment.
   - `destination`: must equal the user's configured download directory
     (or a per-download folder that passes §5). An arbitrary destination
     path in a message is rejected — the extension does not get to pick
     filesystem locations.
   - `download_id`: opaque identifier matching `^[A-Za-z0-9_-]{1,64}$`;
     used only as a lookup key, never as a path component.
   - No field may contain a shell command, a path traversal sequence, or
     an executable directive — and no field is ever passed to a shell
     (see §6.4).
5. **No ambient authority.** A message may not request: reading arbitrary
   files, listing directories, executing programs, changing settings, or
   accessing the network for any URL other than the validated download
   URL. Anything outside the Phase 1 enum is not a "future extension
   point" — it is rejected until this document is revised to cover it.
6. **Rate limiting.** The host processes one message at a time per
   connection and caps concurrent downloads (§5.2). A flood of messages
   is throttled and then the connection is dropped; the host never queues
   unbounded work.
7. **No secrets in messages.** Messages must not contain cookies,
   passwords, tokens, or `Authorization` headers (§0 rule 3, §8). If a
   message contains a field that looks like a credential, the host rejects
   the message and logs a warning (without the value).

### 6.4 No shell execution

- The host and engine must **never** build a shell command string from
  message fields, filenames, or URLs. No `sh -c`, `cmd /c`, `eval`, or
  template-substituted commands anywhere in the download path.
- Where an external tool is genuinely needed (e.g. a checksum tool in
  Phase 2), it is invoked with an argument array, a fixed executable path,
  and no shell — and that design must be added to this document first.

### 6.5 Native host test vectors

| # | Message / setup | Expected outcome |
|---|---|---|
| N1 | Valid `download_request` from the real extension ID, valid http(s) URL | ✅ Accept, engine re-validates URL and filename |
| N2 | Same message from an unknown extension ID | ❌ Drop connection (browser-level `allowed_origins` + host-level ID check) |
| N3 | Message claiming length > 1 MB | ❌ Drop connection without reading the body |
| N4 | Malformed JSON / trailing data / non-object top level | ❌ Reject message, return error |
| N5 | Unknown `type` (e.g. `exec_command`) | ❌ Reject — schema allowlist |
| N6 | `download_request` with `file:///etc/passwd` URL | ❌ Reject — §2 re-validation in the engine |
| N7 | `download_request` with `destination: /etc/` | ❌ Reject — destination not the configured download dir |
| N8 | `download_request` with `filename: ../../evil.exe` | ⚠️ Accept the request but sanitize to `evil.exe` inside the download dir (§4) |
| N9 | Message containing a `cookie` or `token` field | ❌ Reject message, log warning without the value |
| N10 | Manifest `allowed_origins` containing a wildcard | ❌ Invalid install — installer must refuse to write it |
| N11 | Host binary world-writable | ⚠️ Setup warns; host refuses to serve until fixed (recommended) |
| N12 | Manifest hash differs from installed hash at startup | ❌ Host refuses to serve, user told to re-run setup |

## 7. Untrusted servers, resume, and checkpoint tampering **[DESIGN]**

The server is untrusted: it can lie, change its mind, or be replaced by an
attacker between requests. Resume is where that matters most.

### 7.1 What the server may change — and what the client must do

| Server behaviour | Client response |
|---|---|
| `ETag` differs from the value stored at download start | **Discard the partial file and restart from byte 0.** Never resume against a different ETag — the file is not the same file. Tell the user the file changed on the server. |
| `Content-Length` (total) differs from the stored total | Same: discard and restart. A changed total means the content changed. |
| `Last-Modified` differs and no `ETag` was ever provided | Treat as changed: discard and restart (weaker signal, same safe action). |
| Server ignores `Range` and returns `200` instead of `206` | Discard the partial file and restart as a fresh download; do not append a full body onto a partial file. |
| Server returns `206` but `Content-Range` total disagrees with the stored total | Abort; do not write the range. |
| Server returns a range that does not start where requested | Abort; do not write bytes at the wrong offset. |
| Server returns more bytes than the declared range / total | Abort and discard the excess; a file longer than declared is corrupt by definition. |
| `Content-Length` missing (chunked encoding) | Allowed, but the download is only "complete" when the stream ends cleanly; free-space checks run periodically (§5.2), and checksum verification (§9) is the only completeness proof. |
| Server redirects mid-resume to a different origin | Full §2 redirect validation applies; cross-origin redirect drops auth headers (§2.3) and re-checks the destination blocklist. |

Golden rule: **a mismatch is never "fixed" by truncating, padding, or
overwriting silently.** The safe actions are restart-from-zero or abort
with a clear message. The user can always choose to restart; the app never
chooses to present a Frankenstein file as complete.

### 7.2 Checkpoint file design

The checkpoint (resume state) is a sidecar file, e.g.
`<sanitized>.part.json`, stored **inside the destination directory** so it
inherits the §4.2 containment check. Contents (Phase 1):

```jsonc
{
  "version": 1,                    // schema version; unknown versions are rejected
  "url": "https://example.com/file.zip",   // re-validated against §2 on resume
  "final_name": "file.zip",        // re-sanitized against §4 on resume
  "total_bytes": 104857600,         // null if unknown (chunked)
  "etag": "\"abc123\"",             // null if server gave none
  "last_modified": "Wed, 21 Oct 2026 12:00:00 GMT",  // null if absent
  "downloaded_bytes": 52428800,    // must be <= total_bytes (if known)
  "part_file": "file.zip.part"     // basename only — never a path
}
```

Validation on load — **every field, every time**, before any byte is written:

1. Parse strictly: unknown `version` → reject. Wrong types, negative
   numbers, `downloaded_bytes > total_bytes` → reject as corrupt.
2. `url` re-validated against §2 (scheme, credentials, blocklist).
   A checkpoint pointing at a new URL is not resumed — it is rejected.
3. `final_name` re-sanitized against §4, and the resolved `.part` path
   re-checked against §4.2 containment. A checkpoint naming a path
   outside the destination is rejected, not followed.
4. `part_file` must be a bare basename equal to
   `<final_name>.part`; any separator, absolute path, or mismatch →
   reject.
5. The `.part` file's actual size on disk must equal
   `downloaded_bytes`; a mismatch → treat as corrupt (restart or abort,
   never "adjust" the counter to match).
6. **Tamper evidence (honest limitation).** A plain JSON sidecar can be
   edited by anyone who can write to the download folder — checksums
   inside the same file do not stop that, because the attacker can
   recompute them. Phase 1 therefore does **not** claim checkpoints are
   tamper-proof. Two mitigations are specified:
   - Defence in depth: every value that affects the filesystem or the
     network is re-validated on load (steps 1–5), so editing a checkpoint
     can at most cause a restart or an abort — it cannot redirect a
     write outside the destination or change the URL without re-validation.
   - Optional Phase 1 hardening (recommended): store an HMAC-SHA-256 of
     the canonical checkpoint JSON, with the key held in the OS keyring
     (§8) — not in the checkpoint file, not in app config. A checkpoint
     whose HMAC fails is treated as corrupt and the download restarts.
     This is tamper-*evident* against attackers who lack keyring access,
     and it must be described that way — never as tamper-proof.
7. On successful completion, the checkpoint sidecar is deleted with the
   `.part` rename. A stale checkpoint with no matching `.part` file is
   ignored (and may be cleaned up on next startup).

### 7.3 Size and integrity guards during transfer

- Never allocate based on an untrusted `Content-Length` alone: stream to
  disk in fixed-size chunks (e.g. 64 KB–1 MB), and abort if the bytes
  written exceed the declared total.
- Never trust `Content-Length` for the "download complete" decision when a
  checksum is available — the checksum (§9) is the authority; without one,
  completion means "the stream ended cleanly and the byte count matches
  the declared total", and the UI must not over-claim ("downloaded",
  not "verified").
- Partial files keep the `.part` suffix until completion, so no other
  program mistakes an incomplete file for a finished one. The final rename
  (`.part` → final name) is atomic on the same filesystem and happens
  only after all checks pass.

## 8. Secure credential handling **[DESIGN]**

### 8.1 Phase 1: no credentials are stored. Full stop.

- The app stores **no passwords, tokens, cookies, session IDs, API keys,
  or `Authorization` headers** — not in config files, not in checkpoint
  files, not in logs, not in extension storage, not in environment
  variables written to disk.
- A download that returns `401` / `403` fails with a plain-language
  message ("This file requires sign-in, which Phase 1 does not support").
  The app must not prompt for a password and keep it, must not open a
  login page to harvest a session, and must not retry with guessed or
  borrowed credentials.
- URLs with embedded credentials are rejected (§2.2) rather than
  stripped-and-used, for the same reason.

### 8.2 If authentication is ever added (future phase — not Phase 1)

This section is a **requirement for a future design revision**, not
permission to implement auth now. When auth is added, all of the following
are mandatory, and this document must be updated first:

1. **OS keyring only.** Secrets live in the platform credential store —
   Windows Credential Manager, macOS Keychain, Linux Secret Service
   (via the `keyring` API) — never in plaintext files, never in app
   config, never in the checkpoint sidecar, never in the extension's
   `storage` area. **[DESIGNED — NOT TESTED ON WINDOWS]** for the
   Windows Credential Manager path.
2. **Per-origin, minimum scope.** One credential per origin (scheme +
   host + port); a credential for origin A is never sent to origin B, and
   is dropped entirely on cross-origin redirect (§2.3).
3. **In-memory only during a download.** The secret is loaded from the
   keyring when the download starts, held in memory, and wiped (zeroed)
   when the download finishes, fails, or is cancelled. It is never
   written to logs, crash dumps, or error messages.
4. **User-supplied, never scraped.** Credentials are typed by the user
   into the app's own UI (or pasted by them) — never read from the
   browser, never imported from a browser profile, never extracted from
   cookies or storage.
5. **Revocation path.** The UI must offer "forget this credential" that
   deletes it from the keyring, and uninstall must offer to purge all
   stored credentials.

### 8.3 What must never happen (all phases)

- No plaintext credential files, including "temporary" ones.
- No credentials in URLs, filenames, log lines, or error strings.
- No base64 "obfuscation" presented as encryption — base64 is encoding,
  not protection, and must never be described as securing anything.
- No sending credentials to analytics, crash reporting, or update
  servers. Phase 1 has no analytics or crash reporting that transmits
  user data; if either is added, URLs and paths must be scrubbed first.

### 8.4 Logging hygiene

- Log levels: errors log the failure *kind* ("redirect validation failed",
  "checksum mismatch"), never the full URL, query string, filename with
  tokens, or destination path beyond the download folder name.
- Debug-level logs may include full URLs, but only when the user
  explicitly enables debug logging, and the UI must warn that debug logs
  may contain URLs.
- Log files live outside the download directory, are user-readable only,
  and are never uploaded automatically.

## 9. Optional checksum verification **[DESIGN]**

Checksum verification is optional for the user, but the *design* is
mandatory: if the UI offers a checksum field, it must work exactly as
specified here, or not be offered at all.

### 9.1 Design

1. **User-supplied checksum.** The user pastes an expected checksum
   (from the file publisher's site) into an optional field before or
   during the download. The app never invents one.
2. **Algorithms allowed: SHA-256 (default) and SHA-512.** MD5 and SHA-1
   are **not** accepted as security checksums — they are broken for
   collision resistance. If a publisher only offers MD5, the UI may show
   it as informational ("legacy checksum, not a security guarantee") but
   must not show a "verified" badge for it.
3. **Streaming computation.** The hash is computed incrementally as bytes
   arrive (not by re-reading the file afterwards), so verification costs
   no extra I/O and cannot be skipped by a rename race.
4. **Verification gate.** The `.part` → final rename happens **only**
   after the hash matches. On mismatch:
   - The download is marked failed, the final file is **not** created,
     and the `.part` file is kept (for inspection / retry) or deleted per
     user choice — never silently renamed into place.
   - The error states plainly: "Downloaded file does not match the
     expected checksum — it may be corrupt or tampered with. It has not
     been saved as [name]."
   - The user may retry (fresh download, not resume of suspect bytes) or
     discard.
5. **Checksum format validation.** Accept hex strings of the correct
   length (64 hex chars for SHA-256, 128 for SHA-512), case-insensitive,
   whitespace-trimmed. Anything else is rejected as input, not treated as
   a mismatch.
6. **Sidecar files (optional, Phase 1 stretch).** If the user downloads a
   publisher's `.sha256` sidecar file, the app may parse `"<hex>  <filename>"`
   lines and use the matching entry — but only after the user confirms
   which entry applies, and only if the sidecar itself came from the same
   origin as the file. A sidecar from a different origin proves nothing
   and must not produce a "verified" badge.
7. **No "verified" over-claiming.** The UI distinguishes three states
   exactly: `verified` (SHA-256/512 matched), `unverified` (no checksum
   supplied — the normal case), and `failed verification` (mismatch).
   "Unverified" must never be rendered with a checkmark, shield, or
   language implying safety.

### 9.2 Out of scope for Phase 1

- Publisher signatures (PGP / code signing) — a checksum proves the bytes
  match *someone's* published hash; it does not prove who published it.
  Signature verification is a Phase 2 item (see §11).
- Automatic checksum lookup from the server (a hostile server would just
  serve a matching hash for its own malicious file).

## 10. Dependency scanning **[DESIGN + HONEST STATUS]**

### 10.1 Current scan status (2026-10-22)

- `ui/`: `npm ci` completed and npm reported **0 vulnerabilities** across
  50 audited packages. This is the UI dependency audit at that time; it
  does not establish that the project is vulnerability-free.
- `engine/`: a Rust manifest and lockfile exist. `cargo audit` was not
  run during this audit; no Rust advisory scan result is claimed.
- `extension/` and `media/`: there is no package-manager dependency
  install in the current implementation; this does not replace review of
  browser API permissions or the FFmpeg binary supply chain.

The previous status below was written before these components and lock
files existed. Do not use its 2026-10-21 inventory as a current
description. Record future scans in §10.3 with the command, tool version,
date and result.

### 10.2 How to run a scan (per ecosystem, when a manifest exists)

```bash
# JavaScript / TypeScript (requires package-lock.json; commit it)
cd ui            # or engine/, extension/, as applicable
npm audit                    # report only
npm audit --omit=dev         # production dependencies only
npm audit fix                # only after reviewing what it changes; never blindly in CI

# Python (requires pip-audit; install once, outside the project)
pip install pip-audit
pip-audit -r requirements.txt        # or: pip-audit (inside a venv, against installed deps)
pip-audit --strict                   # fail on any vulnerability

# Rust (requires cargo-audit; needs a Cargo.lock, which must be committed)
cargo install cargo-audit
cargo audit
cargo audit --deny warnings          # fail the build on any advisory
```

Rules for every ecosystem:

- **Commit lockfiles** (`package-lock.json`, `Cargo.lock`,
  `requirements.txt` with hashes / `pip-tools` output). An audit without
  a lockfile audits intentions, not the code that will actually run.
- **Pin versions.** Prefer exact versions or tight ranges for security-
  sensitive dependencies (HTTP client, URL parser, crypto, archive
  handling). A floating `*` or `latest` is a supply-chain incident
  waiting for a bad release.
- **Minimize dependencies.** Every dependency is trusted code. A URL
  parser, a filename sanitizer, and a checksum routine are all small
  enough to be first-party code or stdlib — do not add a package for
  something the stdlib already does, and do not add a package to save
  ten lines in the security path.
- **Review before upgrading.** `npm audit fix` / automated PRs change
  code; a human reviews the diff and the changelog before merging,
  especially for major versions.

### 10.3 CI requirements (what remains — none of this exists yet)

- [ ] A CI job runs the applicable audit on every pull request and fails
      the build on **high or critical** findings (medium/low may warn,
      but must be triaged within a defined window — suggest 30 days).
- [ ] Dependabot or Renovate enabled on the repository for automated
      security-update PRs.
- [ ] Lockfiles are required in CI (a PR that deletes or ignores a
      lockfile fails the build).
- [ ] A software bill of materials (SBOM) is generated at release time
      (e.g. `npm sbom` / `cargo cyclonedx`) and stored with the release.
- [ ] First scan result recorded here (date, tool, scope, outcome) once
      the first manifest exists — replacing the "nothing run" statement
      in §10.1 with evidence, not deleting the history.
- [ ] Known-vulnerable-version policy: a dependency with a published,
      unpatched CVE in the security path (networking, parsing, crypto)
      blocks release regardless of severity label.

## 11. Security test checklist for QA

QA must run these against a real build; each item is pass/fail, and any
fail blocks release. Items marked **[WINDOWS]** need a real Windows host
(see the status note at the top) — they cannot be signed off from Linux.

### URL & redirect tests

- [ ] **SEC-01** — Each URL in §2.7 (U1–U20) produces the stated outcome.
      Pay special attention to U8 (credential-host confusion), U12
      (IPv4-mapped loopback), and U18 (encoded traversal in the path).
- [ ] **SEC-02** — A redirect chain of 11 hops aborts; a chain of 10
      succeeds (if all targets are otherwise valid).
- [ ] **SEC-03** — Cross-origin redirect drops `Authorization` and any
      custom auth headers (verify with a local test server that echoes
      received headers — do not test against a real third-party service).
- [ ] **SEC-04** — `https://` → `http://` redirect is rejected; the user
      sees a downgrade error, not a silent HTTP download.
- [ ] **SEC-05** — Redirect to `169.254.169.254` and to a private IP is
      rejected even when the initial URL was public.
- [ ] **SEC-06** — A hostname that resolves to both a public and a
      private address is rejected (§2.5); test with a local DNS stub,
      not by relying on a public rebinding domain.
- [ ] **SEC-07** — Self-signed / expired / wrong-host TLS certificate
      aborts the download with a clear error; there is no click-through.

### Filename & destination tests

- [ ] **SEC-08** — Each filename vector in §4.3 (F1–F24) produces the
      stated sanitized output or rejection. Automate this: the sanitizer
      is a pure function and must have unit tests, not just manual QA.
- [ ] **SEC-09** — **[WINDOWS]** Reserved names (`CON`, `PRN`, `AUX`,
      `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, with extensions, mixed case)
      are renamed on a real Windows host.
- [ ] **SEC-10** — **[WINDOWS]** Trailing dots/spaces (`evil.exe...`,
      `name.txt `) land on disk under the sanitized name, and the UI
      shows exactly the on-disk name.
- [ ] **SEC-11** — Symlink inside the download folder pointing outside it:
      download aborts, no file is written outside, partial file removed.
- [ ] **SEC-12** — Destination validation (§5.1, D1–D8): file-as-folder,
      non-writable folder, system locations, and swapped symlinks are
      all rejected or re-confirmed as specified.
- [ ] **SEC-13** — Existing file with the same name is never silently
      overwritten; the user is asked, or a ` (1)` suffix is used.
- [ ] **SEC-14** — Disk-full behaviour: download aborts cleanly, `.part`
      file retained for resume, no truncated file renamed into place.

### Native host tests

- [ ] **SEC-15** — Each native-host vector in §6.5 (N1–N12) produces the
      stated outcome.
- [ ] **SEC-16** — A message with an unknown `type` or unknown field is
      rejected (allowlist), not processed with the unknown parts ignored.
- [ ] **SEC-17** — A 1 MB + 1 byte message is dropped without the host
      attempting to allocate or parse the body.
- [ ] **SEC-18** — **[WINDOWS]** Manifest registry placement and
      `allowed_origins` are verified on a real Windows Chrome/Edge install.

### Server-trust & checkpoint tests

- [ ] **SEC-19** — Resume against a changed `ETag` restarts from zero
      (verify byte counts on the test server, not just the UI message).
- [ ] **SEC-20** — Resume against a changed total `Content-Length`
      restarts from zero.
- [ ] **SEC-21** — Server returning `200` to a `Range` request restarts
      from zero; the partial file is not appended to.
- [ ] **SEC-22** — `206` with a mismatched `Content-Range` total aborts
      without writing.
- [ ] **SEC-23** — Hand-edited checkpoint (changed URL, changed
      `part_file` to `../../evil`, changed `downloaded_bytes` to disagree
      with the `.part` size) is rejected; no write happens outside the
      destination, and the download restarts or aborts — it never resumes
      on edited state.
- [ ] **SEC-24** — Stale checkpoint with no matching `.part` file is
      ignored, not treated as a resumable download.

### Credential & checksum tests

- [ ] **SEC-25** — A `401`/`403` response produces a clean "sign-in not
      supported in Phase 1" failure; no password prompt, no credential
      storage, no retry with borrowed session data.
- [ ] **SEC-26** — No file created by the app (config, checkpoint, log)
      contains a password, token, or `Authorization` value after a
      download attempt — grep the app's data directory for test secrets
      to prove it.
- [ ] **SEC-27** — Correct SHA-256 → file saved, UI shows `verified`.
- [ ] **SEC-28** — Wrong SHA-256 → file NOT saved under its final name,
      clear mismatch error, `.part` retained or deleted per user choice.
- [ ] **SEC-29** — MD5-only publisher hash → no `verified` badge, UI
      language does not imply security.
- [ ] **SEC-30** — Executable download (`*.exe`, `*.sh`, `*.bat`,
      `*.msi`) is never auto-executed or auto-opened; opening requires an
      explicit user action outside the app.

### Supply-chain tests

- [ ] **SEC-31** — The applicable audit command from §10.2 runs clean in
      CI (or fails the build on high/critical) — attach the CI log, not
      a verbal assurance.
- [ ] **SEC-32** — Lockfiles exist and are committed for every manifest
      in the repo; a PR deleting one fails CI.
- [ ] **SEC-33** — The final binary / package contains no dependency
      with a known, unpatched CVE in the security path (networking,
      parsing, crypto).

## 12. Reference implementation sketch (sanitizers)

The following is **pseudocode** (Python-flavoured; the same logic ports
directly to TypeScript/Rust). It is included so QA can test the *rules*
independently of the final implementation language, and so an implementer
cannot "interpret" the spec into something weaker. Where the sketch and
§2/§4 disagree, §2/§4 win — fix the sketch, not the rules.

```python
import re, unicodedata
from urllib.parse import urlparse, unquote
from pathlib import Path

MAX_REDIRECTS = 10
MAX_NAME_CHARS = 200
RESERVED = {"CON", "PRN", "AUX", "NUL"} | \
           {f"COM{i}" for i in range(1, 10)} | \
           {f"LPT{i}" for i in range(1, 10)}
BLOCKED_CIDRS = [
    "127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16",
    "169.254.0.0/16", "0.0.0.0/8", "100.100.100.100/32",
    "::1/128", "fc00::/7", "fe80::/10", "::/128",
]  # implementation must also unwrap ::ffff:a.b.c.d and check the IPv4 part
BLOCKED_HOSTS = {"localhost"}  # plus suffixes: .localhost, .local, .internal, .intranet

def validate_url(raw: str) -> str:
    """Return the validated URL, or raise ValueError. Re-run per redirect hop."""
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in raw):
        raise ValueError("control characters in URL")
    u = urlparse(raw.strip())
    if u.scheme.lower() not in ("http", "https"):
        raise ValueError("scheme not allowed")
    if not u.hostname:
        raise ValueError("empty hostname")
    if u.username is not None or u.password is not None:
        raise ValueError("embedded credentials not supported")
    host = u.hostname.lower()
    if host in BLOCKED_HOSTS or any(
        host.endswith(s) for s in (".localhost", ".local", ".internal", ".intranet")
    ):
        raise ValueError("internal hostname blocked")
    # NOTE: IP-range check needs DNS resolution of `host` + ipaddress module;
    # every resolved address must pass, not just the first (see §2.5).
    # This sketch omits that step for brevity — the implementation must not.
    return raw

def _basename(name: str) -> str:
    """Last non-empty segment on either separator; '' if there is none."""
    for sep in ("/", "\\"):
        parts = [seg for seg in name.split(sep) if seg]
        name = parts[-1] if parts else ""
    return name

def sanitize_filename(raw: str, fallback: str) -> str:
    """Reduce any server/URL-supplied name to one safe path component."""
    if "\x00" in raw:
        raise ValueError("NUL byte in filename")
    name = unicodedata.normalize("NFC", unquote(raw))
    # Basename on BOTH separators, twice (cleaning can expose a separator).
    name = _basename(name)
    name = "".join(c for c in name if ord(c) >= 0x20 and ord(c) != 0x7F)
    name = re.sub(r'[<>:"/\\|?*]', "_", name)
    name = _basename(name)
    name = name.strip(" .")  # strips leading/trailing dots AND spaces (§4.1 step 4)
    if not name:
        return fallback
    stem, dot, ext = name.rpartition(".")
    base = stem if dot else name
    if base.upper() in RESERVED:
        name = base + "_" + (dot + ext if dot else "")
    if len(name) > MAX_NAME_CHARS:  # truncate on char boundaries, keep extension
        keep = MAX_NAME_CHARS - (len(ext) + 1 if dot else 0)
        name = name[:keep] + (dot + ext if dot else "")
    return name or fallback

def contained_path(download_dir: str, name: str) -> Path:
    """Resolve and prove containment, or raise. Call at WRITE time, not just setup."""
    base = Path(download_dir).resolve()
    cand = (base / name).resolve()
    if cand == base or base not in cand.parents:
        raise ValueError("destination outside download folder")
    return cand

def validate_native_message(msg: dict, expected_extension_id: str,
                            configured_dir: str) -> dict:
    """Allowlist validation for one Native Messaging JSON object."""
    ALLOWED_TYPES = {"download_request", "cancel_download", "pause_download",
                     "resume_download", "get_status"}
    if not isinstance(msg, dict) or msg.get("type") not in ALLOWED_TYPES:
        raise ValueError("unknown message type")
    if any(k in msg for k in ("cookie", "cookies", "token", "password",
                              "authorization", "session")):
        raise ValueError("credentials must never appear in native messages")
    if msg["type"] == "download_request":
        allowed_fields = {"type", "url", "filename", "download_id"}
        if set(msg) - allowed_fields:
            raise ValueError("unknown field in download_request")
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", msg.get("download_id", "")):
            raise ValueError("bad download_id")
        validate_url(msg["url"])  # engine re-validates; extension is not trusted
        if "filename" in msg:
            msg["filename"] = sanitize_filename(msg["filename"], "download")
        # NOTE: destination is NOT taken from the message — it is always the
        # configured directory (see §6.3). Any destination field is rejected
        # by the allowlist above.
    return msg
```

Notes on the sketch (known simplifications an implementer must close):

- The IP-range / DNS check in `validate_url` is marked, not implemented —
  it needs real DNS resolution plus `ipaddress` checks over **all**
  returned addresses, including IPv4-mapped IPv6 unwrapping.
- `sanitize_filename`'s `strip(" .")` also strips interior-adjacent
  spaces only at the ends, which matches §4.1 step 4; it must be verified
  against the §4.3 vectors (especially F17–F19) in unit tests.
- `contained_path` uses `resolve()`, which follows symlinks — that is
  the point — but the file must still be opened with exclusive-create
  and re-checked after creation to close the TOCTOU window (§4.2).

## 13. Open items for Phase 2 (not Phase 1 gates)

- Host sandboxing / least-privilege execution (AppArmor / Seatbelt /
  Windows integrity levels) — **[DESIGNED — NOT TESTED ON WINDOWS]** for
  the Windows entry.
- Publisher signature verification (PGP / code signing) beyond checksums.
- Authenticated downloads via OS keyring (§8.2) — requires a revision of
  this document first.
- Private-endpoint allowlist procedure (§2.4 exception) — only if a real
  feature needs it.
- Malware scanning integration (OS antivirus handoff, not a built-in
  scanner claim).
- Windows verification pass for every item marked
  **[DESIGNED — NOT TESTED ON WINDOWS]** in this document.

---

*Document owner: Agent 8 (Security Engineer, Phase 1). Next review trigger:
first real code landing in `engine/` or `extension/`, first dependency
manifest, or any proposal to add authentication, private-endpoint access,
or auto-open behaviour — whichever comes first.*
