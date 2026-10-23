# Release engineering — DevOps & release plan (Agent 10, Phase 1)

> **Current status (2026-10-23):** Windows run `39866677122` passed Rust,
> engine integration, Native Messaging, Tauri build, NSIS install/start,
> media and extension syntax checks on `windows-latest`. This branch adds
> desktop/browser E2E and security-audit jobs. RustSec/npm audit passed in
> run `39928995290`; Windows E2E failed before interaction on WebView2 CDP attach.
> Manual Windows 10/11 user-machine testing remains open. This document
> remains the original release plan; root
> `AUDIT.md` and `TEST_REPORT.md` carry the latest evidence.
>
> **Status: PLAN ONLY — NOT BUILT HERE.**
>
> ## User decision (Phase 1, confirmed — applies to this whole document)
>
> - **Chosen Windows build target: GitHub Actions `windows-latest`.**
>   The Windows executable/installer is produced as a CI artefact
>   (`upload-artifact`) by the workflow in
>   `.github/workflows/windows-build.yml`.
> - **NOT a build target: the user's own Windows PC.** No build,
>   packaging, installer, or signing step in this plan runs on, or
>   requires, the user's personal machine.
> - **Unsigned by default.** No code-signing credential is assumed
>   to exist. Signing is a separate, later step that requires the
>   user to supply signing credentials through a secure flow —
>   GitHub Actions Secrets (or a secure vault) — **never in chat**
>   and never committed to the repo. The workflow's signing step is
>   gated and skipped when no credential is present, and unsigned
>   artefacts are clearly labelled as such (artefact name
>   `download-manager-windows-x64-unsigned` plus a `UNSIGNED.txt`
>   marker inside `dist/`).
> - **Not run here.** This workflow has not run on this Linux VM.
>   It is a plan to run on a Windows runner. YAML validation (§7)
>   proves syntax only.
>
> This document is a design and a plan. It describes work that is
> intended to run on a GitHub Actions `windows-latest` runner in
> Phase 2. It was written on a Linux VM with **no Windows
> machine and no signing credentials available**, so:
>
> - **No Windows `.exe` or `.msi` was built here.**
> - **No installer was built here.**
> - **No binary was signed here.**
> - **No update server or update endpoint exists yet.**
>
> Anything in this document that sounds like a completed build is a
> description of a future step, not a claim about the present. Where a
> step is not yet possible, it says so explicitly.
>
> Related files:
>
> - Workflow (plan, YAML-validated, never run): [.github/workflows/windows-build.yml](../.github/workflows/windows-build.yml)
> - How to build the prototype on Linux vs. Windows: [BUILDING.md](BUILDING.md)
> - Docs index: [README.md](README.md)

---

## 1. Repository layout

The layout below shows the Phase 1 skeleton that already exists, plus
the directories planned for Phase 2. Planned directories are marked
`(planned)` — they do not exist yet and must not be treated as if
they do.

```text
download-manager/
├── .github/
│   └── workflows/
│       └── windows-build.yml      # Windows CI: build, test, package (PLAN ONLY)
├── docs/
│   ├── README.md                  # Docs index
│   ├── release.md                 # This file: layout, versioning, installer,
│   │                              #   updates, logging (all Phase 1 design)
│   └── BUILDING.md                # Build on Linux (prototype) vs Windows (Phase 2)
├── engine/                        # Download engine (Rust, planned implementation)
│   └── Cargo.toml                 # (planned — its presence activates the Rust
│                                  #  steps in windows-build.yml)
├── extension/                     # Browser extension
│   ├── native-host/               # Native Messaging host (bridges extension ↔ engine)
│   ├── icons/
│   └── dist/                      # (planned — built extension output)
├── installer/                     # (planned, Phase 2 — WiX or NSIS project;
│                                  #  see §4. Nothing here yet.)
├── specs/                         # Product / protocol specifications
├── media/                         # (other agents' work — not owned by DevOps)
├── qa/                            # (other agents' work — not owned by DevOps)
├── ui/                            # (other agents' work — not owned by DevOps)
├── CHANGELOG.md                   # (planned — see §2.3; one entry per release)
└── README.md                      # (project README — the DevOps section of it
                                   #  is this document; do not duplicate the
                                   #  layout/versioning text in two places)
```

### Layout rules

1. **One home per artefact.** The engine lives in `engine/`, the
   extension in `extension/`, the Native Messaging host in
   `extension/native-host/`. Do not copy binaries between directories
   by hand; the CI packaging step is the only thing that assembles
   `dist/`.
2. **No secrets in the repo.** Certificates, private keys, tokens, and
   passwords never go in any file here, including the workflow.
   Signing credentials live only in GitHub Secrets (Phase 2) — see §4.4.
3. **No checked-in build output.** `dist/`, `target/`, and
   `node_modules/` are build products, never committed. The CI
   artefact upload is how a build is shared, not a commit.
4. **The workflow is the contract.** If a new build step is needed, it
   goes in `windows-build.yml` (and is documented here), not in a
   one-off script on somebody's PC. A build that only works on one
   developer's machine is not a release build.

---

## 2. Versioning scheme — Semantic Versioning (SemVer)

### 2.1 Format

```
MAJOR.MINOR.PATCH[-PRERELEASE][+BUILD]
```

Examples: `1.0.0`, `1.2.3`, `2.0.0-beta.1`, `1.4.0-rc.1`.

Git tags use a `v` prefix and match the version exactly: `v1.2.3`,
`v2.0.0-beta.1`. The tag is what the CI workflow triggers on
(`v*.*.*`), and the GitHub Release is created from the tag — never
from a branch name or a date.

| Bump | When |
| --- | --- |
| **MAJOR** | Breaking change: Native Messaging protocol version change, dropped OS/browser support, incompatible settings or queue-file format. |
| **MINOR** | New feature that is backwards compatible (new download protocol, new UI surface, new setting with a safe default). |
| **PATCH** | Bug fix or security fix with no behaviour change for existing users. |
| **Pre-release** | `-alpha.N` (internal only), `-beta.N` (opt-in testers), `-rc.N` (release candidate: feature-frozen, only fixes). A pre-release is never offered to the stable update channel (§5). |

### 2.2 Single source of truth

The version is declared in **one** place per component, and every
other place reads it from there at build time:

- Engine: `engine/Cargo.toml` (`[package] version`).
- Extension: `extension/manifest.json` (`version` — note: extension
  manifests only accept `MAJOR.MINOR.PATCH` with no pre-release
  suffix, so a pre-release engine ships with the nearest stable
  manifest version plus the pre-release label in the release notes).
- The Native Messaging **protocol version** is a separate integer,
  versioned independently of the app version, and is negotiated at
  handshake time so an older extension and a newer host fail with a
  clear error instead of silently misbehaving.

Before any release, a CI check (to be added in Phase 2) must verify
that the tag, the engine version, and the extension manifest version
agree. A mismatch blocks the release; it is never fixed by editing a
tag after the fact.

### 2.3 Changelog

`CHANGELOG.md` (planned, Phase 2) follows the Keep-a-Changelog shape:
one dated section per release, grouped as Added / Changed / Fixed /
Security. Every release — including a patch — gets an entry before
the tag is pushed. The changelog is the human-readable companion to
the update manifest in §5; the manifest is what machines read, the
changelog is what users read.

### 2.4 Branching and release process

```text
main                ← always releasable; protected branch, PRs only
  feature/<name>    ← new work, merged to main by PR
  release/vX.Y.Z    ← cut from main when a release is being prepared
                       (version bump + changelog + final fixes only)
  hotfix/<name>     ← urgent fix branched from the release tag,
                       merged back to main AND to the release branch
```

Release checklist (all steps required, in order):

1. **Freeze.** Cut `release/vX.Y.Z` from `main`. No new features land
   on it; only fixes for release blockers.
2. **Bump and document.** Update the version (§2.2) and
   `CHANGELOG.md` on the release branch.
3. **Green CI.** The Windows workflow (§3) passes on the release
   branch: build + tests + packaging. A red run blocks the release.
4. **Tag.** Merge the release branch to `main`, then tag
   `vX.Y.Z` on the merge commit. Tags are never moved or deleted to
   fix a mistake — a bad tag gets a new patch release (§5.5).
5. **Publish.** The tag triggers the release job: artefact upload,
   SHA-256 checksums, signed update manifest (§5), and a GitHub
   Release with the changelog entry and the installer (once §4
   exists).
6. **Roll out in stages.** The update is not offered to 100% of
   users on day one — see staged rollout in §5.4.
7. **Watch.** Monitor error logs (§6) and the rollout halt criteria
   (§5.4) for at least the first staged cohort before widening.

Hotfixes skip the freeze but never skip steps 3–5. An emergency that
"can't wait for CI" is exactly the emergency CI exists for.

---

## 3. Continuous integration — the Windows workflow (plan)

File: `.github/workflows/windows-build.yml`.

| Property | Value |
| --- | --- |
| Runner | `windows-latest` (GitHub-hosted) |
| Triggers | Push to `main`, pull requests to `main`, tags `v*.*.*`, manual (`workflow_dispatch`) |
| Toolchains | Rust stable (`dtolnay/rust-toolchain@stable`), Node.js 20 (`actions/setup-node@v4`) |
| Steps | Checkout → toolchain setup → guardrail check → build → test → package → upload artefact |
| Artefact | `download-manager-windows-x64-unsigned` (contents of `dist/`, including an `UNSIGNED.txt` marker), 30-day retention |
| Signing | **Unsigned by default.** A signing step exists but is gated on a GitHub Actions Secret (`WINDOWS_SIGNING_CERT`); when the secret is absent the step is skipped and the run still succeeds with an unsigned artefact. See §4.4. |
| Permissions | `contents: read` only |

**Why both toolchains:** the engine is planned in Rust and the
extension tooling in Node, and Phase 1 does not yet fix the final
stack. The workflow therefore builds whichever project files are
present and skips the other — but it **fails** if neither is
present, so it can never report success for building nothing. This
is deliberate and is documented in the workflow header.

**What the workflow does NOT do (yet, and why):**

- It does **not** build an installer — no installer project exists
  (§4). The installer step is commented out in the workflow.
- It does **not** sign anything by default — no signing credential
  is assumed to exist (§4.4). The signing step is present but
  **gated**: it is skipped entirely when the GitHub Actions Secret
  is absent, and until the Phase 2 signing implementation lands,
  even a present credential does not produce a signed artefact —
  the artefact stays labelled UNSIGNED.
- It does **not** publish a GitHub Release — that job is added in
  Phase 2 together with the installer and signing, so a release is
  never published from an unsigned, unpackaged build.
- It has **not been run** anywhere. Its YAML syntax was validated
  locally (see the validation note at the end of this document);
  YAML validity is not a claim that the workflow succeeds on a
  runner. The first real run must be watched, not assumed.

---

## 4. Installer plan — NOT BUILT HERE

> **Explicit status:** no installer exists. There is no `.msi`,
> no `.exe` installer, and no `installer/` directory in this
> repository as of Phase 1. Everything in this section is a plan
> for Phase 2, to be executed on a GitHub Actions Windows runner
> only — the user's Windows PC is **not** a build target (see the
> decision box at the top of this document). Nothing here was built
> or tested on the Linux VM.

### 4.1 Options compared

| | **NSIS** | **WiX Toolset (MSI)** |
| --- | --- | --- |
| Output | `.exe` installer | `.msi` package |
| Learning curve / iteration speed | Low — one script (`.nsi`), fast to change | Higher — XML (`.wxs`), declarative, slower to iterate |
| Size / overhead | Small, self-contained | Larger, Windows Installer engine |
| Enterprise deployment (GPO, silent mass install) | Possible, but MSI is the native fit | Native: Group Policy, `msiexec` flags, standard uninstall |
| Upgrade / uninstall behaviour | Scripted by hand; easy to get subtly wrong | Handled by Windows Installer (major upgrades, rollback) |
| Best fit | First public releases, fast iteration | Later, if enterprise/IT deployment becomes a requirement |

**Recommendation (plan, not a decision already taken):** start with
**NSIS** for the first installer — it is the fastest path to a
correct, testable installer, and the checklist in §4.2 is the same
either way. Re-evaluate WiX/MSI if enterprise deployment (GPO,
centralised uninstall, standardised silent install) becomes a real
requirement; do not build both in parallel.

### 4.2 What the installer MUST do

Regardless of NSIS or WiX, the installer must, in order:

1. **Install the application files.**
   - The engine executable and its runtime files to the install
     directory (`%ProgramFiles%\<AppName>` for a per-machine install,
     `%LOCALAPPDATA%\Programs\<AppName>` for a per-user install).
   - The Native Messaging host executable (it may be the engine
     itself in host mode, or a separate binary — the installer must
     install whichever the final architecture uses, and exactly one
     copy of it).
   - The Native Messaging host manifest JSON (see step 2) next to
     the host binary — never in a user-writable temp location.
2. **Register the Native Messaging host** (this is what makes the
   browser extension able to talk to the desktop app, and it is the
   step most likely to be forgotten — it must be tested, not assumed):
   - Write the registry key for each supported Chromium browser:
     `HKCU\Software\Google\Chrome\NativeMessagingHosts\<host-name>`
     (and the Microsoft Edge equivalent under
     `... \Software\Microsoft\Edge\NativeMessagingHosts\<host-name>`),
     pointing at the installed host manifest JSON. `HKLM` instead of
     `HKCU` for a per-machine install.
   - The manifest's `allowed_origins` must contain **only** this
     project's extension ID(s) — never a wildcard, never another
     project's ID.
   - Firefox, if supported in Phase 2, uses a manifest in a
     browser-specific location instead of the registry; that path is
     decided when Firefox support is scoped, not improvised at
     install time.
3. **Create shortcuts.**
   - Start Menu shortcut (always).
   - Desktop shortcut (optional, default on for a first install,
     offered as a checkbox; upgrades must not re-add a shortcut the
     user deleted).
4. **Register an uninstaller.**
   - An `Uninstall` registry entry (display name, version,
     publisher, uninstall command) so the app appears in Windows
     Settings → Apps and can be removed by standard means.
   - The uninstaller must: remove installed files, remove the
     Native Messaging registry keys from step 2, remove shortcuts,
     and remove the `Uninstall` entry itself.
   - The uninstaller must **not** delete user data (download
     history, queue, settings, logs) without asking. Default:
     keep user data, offer a "remove all data" checkbox.
5. **Handle upgrades in place.** Installing a newer version over an
   older one must replace binaries, re-register the host manifest,
   and preserve user data and settings. It must not require a manual
   uninstall first, and it must not leave two installed versions
   side by side.
6. **Support silent install** (`/S` for NSIS, `msiexec /quiet` for
   MSI) with the same result as an interactive install, so the
   update mechanism (§5) can install an update without a wizard.
7. **Fail loudly.** If host registration fails, the installer must
   report it and roll back, not finish with a success message while
   the extension silently cannot connect. The "extension can't talk
   to the app" failure mode is a release blocker, not a known issue.

### 4.3 Installer testing (Phase 2, on a Windows runner / clean test VM only)

Before any installer ships, it must pass, on a clean Windows test
environment provisioned for CI (not on the user's personal PC):

- Fresh install → app launches, extension connects (Native
  Messaging handshake succeeds), shortcuts exist.
- Upgrade over the previous version → settings/history preserved,
  host still registered, no duplicate install entries.
- Uninstall → files, registry keys, and shortcuts gone; user data
  handled exactly as the uninstaller promised.
- Silent install → identical result to the interactive install.

None of these tests can be run from this Linux VM, and none are
claimed to have been run.

### 4.4 Code signing (plan, Phase 2 — separate, later step)

- **Default: unsigned.** Builds from `windows-build.yml` are
  unsigned unless and until signing is set up. Unsigned artefacts
  are labelled as such (artefact name
  `download-manager-windows-x64-unsigned` and `UNSIGNED.txt` in
  `dist/`), so nobody mistakes a CI artefact for a signed release.
- Signing requires a real code-signing certificate. No certificate,
  private key, or credential exists in this repository, and none
  may ever be committed to it.
- **How the credential is supplied (secure flow only):** the user
  supplies the signing credential through GitHub Actions Secrets
  (e.g. `WINDOWS_SIGNING_CERT` / `WINDOWS_SIGNING_PASSWORD`, or an
  Azure Trusted Signing configuration if the project adopts it —
  the choice is a Phase 2 decision, not made here) or through a
  secure vault wired into CI. **Credentials are never shared in
  chat, never pasted into issues or PRs, and never committed.**
  If the user has not supplied a credential, signing simply does
  not happen — the workflow's signing step is gated on the secret's
  presence and is skipped when it is absent, and the build still
  succeeds as an unsigned artefact.
- The workflow step that checks for the credential records only a
  boolean (present/absent); it never prints, echoes, or logs the
  credential value itself.
- Every shipped `.exe` and installer must be signed **and
  timestamped** (RFC 3161 timestamp) so the signature remains
  valid after the certificate expires.
- Signing reduces — it does not eliminate — Windows SmartScreen
  warnings for a new publisher. Reputation builds over time and
  installs; do not promise users that a signed build will never see
  a SmartScreen prompt.
- Until signing exists, any build is explicitly unsigned and must
  be labelled as such wherever it is shared. Never distribute an
  unsigned build as if it were a release.

---

## 5. Update mechanism — DESIGN ONLY

> **Status:** no update server, endpoint, manifest, or client update
> code exists. This section is a design for Phase 2. Domain names,
> URLs, and keys below are placeholders to be replaced when the
> infrastructure is actually provisioned — do not publish them as
> real endpoints.

### 5.1 Overview

The app checks for updates itself (no separate updater service in
Phase 1 scope). The flow is: **check → verify → download →
verify again → install → confirm healthy → keep the old version
until then**. An update is never applied on trust: the manifest and
every artefact are verified before anything is replaced.

### 5.2 Check endpoint and manifest

- **Check endpoint (to be provisioned in Phase 2):**
  `https://updates.example.invalid/v1/manifest.json`
  (placeholder — replace with the real update host before any client
  ships with update checks enabled).
- **Request:** the client sends only what the server needs to
  answer — current version, update channel (`stable` or `beta`),
  platform/architecture (`windows-x64`). It sends no user identity,
  no download history, no URLs, and no file names.
- **Response — signed manifest** (illustrative shape, not a live
  document):

```json
{
  "version": "1.2.3",
  "min_supported_version": "1.0.0",
  "channel": "stable",
  "rollout_percent": 10,
  "artifacts": {
    "windows-x64": {
      "url": "https://updates.example.invalid/releases/1.2.3/download-manager-1.2.3-windows-x64.exe",
      "sha256": "<hex sha-256 of the artefact>",
      "size_bytes": 0
    }
  },
  "release_notes_url": "https://example.invalid/releases/1.2.3",
  "signature": "<Ed25519 signature over the canonical manifest body>"
}
```

- **Verification (client side, mandatory):**
  1. Verify the manifest signature against a public key **pinned
     in the application binary** (not fetched from the same server
     that serves the manifest — otherwise a compromised server could
     serve a new key with a malicious manifest).
  2. Reject the manifest if the version is older than the installed
     version (no silent downgrades), if the channel does not match
     the user's channel, or if the signature check fails — and log
     the rejection (§6) without downloading anything.
  3. After download, verify the artefact's SHA-256 against the
     manifest, and verify the artefact's code signature (§4.4),
     before installing.
- **Check frequency:** at most once every 6 hours, plus once at
  startup if the last check is older than 24 hours. Never check on
  a metered connection unless the user opted in. A failed check is
  silent (retry later) — a failed check must never block the app
  from working.
- **Channels:** `stable` (default, all users) and `beta` (opt-in
  only, in settings). Pre-releases (`-beta.N`, `-rc.N`) are only
  ever published to the beta channel. There is no channel that
  serves `-alpha` builds to anyone outside the team.

### 5.3 Installation of an update

1. Download to a staging directory (not over the running binary).
2. Verify hash + signature (§5.2). Any mismatch → delete the
   staged file, log, retry at most once, then give up until the
   next check. Never install a file that failed verification.
3. Install via the silent installer path (§4.2 step 6) so the
   upgrade is the same code path as a manual upgrade — no second,
   update-only install mechanism to drift out of sync.
4. On next launch, the app runs a self-check (starts, loads the
   queue/settings, Native Messaging handshake works). Only then is
   the update considered successful.

### 5.4 Staged rollout

A release is **not** offered to everyone at once:

| Stage | Audience | Minimum soak before widening |
| --- | --- | --- |
| 1 | Beta channel + 1% of stable | 24 hours |
| 2 | 10% of stable | 48 hours |
| 3 | 50% of stable | 48 hours |
| 4 | 100% of stable | — |

- **Cohort assignment** is deterministic: a stable hash of a
  per-install anonymous ID, so a given install is consistently in
  or out of a stage and does not flip between checks.
- **Halt criteria (any one halts the rollout):** crash rate or
  error rate (§6) materially above the previous release's baseline,
  a confirmed data-loss or Native Messaging breakage report, or a
  failed signature/hash verification in the field. Halting is a
  server-side manifest change (set `rollout_percent` to 0) — it must
  not require shipping a new client.
- **Widening is a human decision.** The manifest's
  `rollout_percent` is raised by a maintainer after reviewing the
  stage's error data, not by a timer alone.

### 5.5 Rollback

- **Client-side rollback:** the installer keeps the previous
  version's binaries until the new version passes its first-launch
  self-check (§5.3 step 4). If the self-check fails, the previous
  version is restored automatically and the failure is logged.
  This covers a bad build; it does not cover a bad data migration
  (see below).
- **Server-side rollback:** set `rollout_percent` to 0 and, if the
  release is harmful, publish a manifest pointing back to the last
  known-good version with a higher rollout, so affected installs
  that have not yet updated stay put and new checks stop offering
  the bad version.
- **Data migrations are one-way by default.** If a release changes
  the settings/queue format, it must either be backwards compatible
  or ship a migration that can be reversed. A release whose data
  format cannot be rolled back must say so in its changelog and
  must spend longer in staged rollout. There is no "just reinstall
  the old version and hope" plan.
- **A bad tag is never rewritten.** A broken release is fixed by a
  new patch release (`1.2.4`), not by moving the `v1.2.3` tag or
  deleting the GitHub Release. Rewriting history after users have
  downloaded something is how two different binaries end up sharing
  one version number.

---

## 6. Error logging — design

### 6.1 Location

| Platform | Location |
| --- | --- |
| Windows (primary) | `%LOCALAPPDATA%\<AppName>\logs\` — local, non-roaming, so logs do not sync across machines |
| Linux (prototype only) | `~/.local/share/<AppName>/logs/` (XDG-style) |

`<AppName>` is the final product name, decided in Phase 2 — the
location scheme above is fixed regardless of the name. Logs are
per-user, never written to a shared or world-writable directory,
and never written inside the install directory (which may be
read-only for a per-machine install).

### 6.2 Format and levels

- One event per line, structured (JSON lines preferred) so logs are
  machine-readable without a custom parser:
  `{"ts":"…Z","level":"error","component":"engine","event":"download_failed","code":"E_TIMEOUT","detail":"…"}`
- Timestamps in UTC (ISO 8601), so logs from different timezones
  compare directly.
- Levels: `error` (something failed), `warn` (degraded but
  working), `info` (lifecycle: start, stop, update check result),
  `debug` (opt-in only, see §6.4). Production default level is
  `info`; `debug` is never the default.

### 6.3 Rotation and retention

- **Size-based rotation:** a log file rotates at 10 MB.
- **Count:** keep the 5 most recent rotated files, then delete the
  oldest. Maximum on-disk footprint: ~60 MB.
- **Retention:** rotated logs older than 30 days are deleted even
  if the count limit has not been reached.
- **Crash safety:** logging must never crash the app. If the log
  directory is unwritable, logging degrades silently and the app
  keeps working; the failure is surfaced once in the UI (settings →
  diagnostics) rather than on every event.
- **User access:** the app provides an in-app "Export logs" action
  (settings → diagnostics) that zips the current logs for a bug
  report, and a "Clear logs" action. Users must be able to see what
  they are sending before they send it.

### 6.4 Privacy — what is NEVER logged

This is a hard rule, not a guideline. A log line that violates it is
a bug, and a release that ships with such a line does not ship.

- **No credentials, tokens, or secrets of any kind:** no passwords,
  no OAuth/API tokens, no session cookies, no `Authorization`
  headers, no signing keys. If a value could be replayed to act as
  the user, it is never written to a log.
- **No URLs with tokens or query strings.** Log a download failure
  as host + path + error code (e.g. `example.com/file.zip`,
  `E_TIMEOUT`) — never the full URL, and never anything after `?`.
  Query strings routinely carry tokens, session IDs, and signed
  links, and a log file that contains them is a credential leak
  with a different name.
- **No user-identifying paths verbatim.** Redact the user profile
  prefix: `C:\Users\<redacted>\Downloads\file.zip`, not the real
  username. The same applies to home directories on Linux.
- **No download contents, file contents, or message bodies.**
  Log that a download failed and why (error code, HTTP status
  class); never what was being downloaded beyond host + path.
- **No extension message payloads.** Native Messaging traffic is
  logged as event types and sizes only, never payload contents.
- **Scrubbing is enforced in code, not by convention:** a single
  logging helper applies the redaction rules (strip query strings,
  redact profile paths, drop known secret fields) to every event
  before it is written. Call sites do not get to opt out, and the
  scrubber has tests (Phase 2) that feed it URLs with tokens,
  credentials, and profile paths and assert they never appear in
  the output.
- **Crash reports are opt-in.** If crash reporting is added in
  Phase 2, it is off by default, asks before sending, and shows the
  user the report first. A crash report follows the same redaction
  rules as a log line.

### 6.5 What logging is FOR

Logs exist to answer, after the fact: "which version, which
component, which error code, how often, and did the update/rollback
path work?" They are aggregated (by version + error code, with no
user data) to drive the rollout halt criteria in §5.4. If a log
line cannot help answer one of those questions, it does not belong
in the log.

---

## 7. Validation note (Phase 1, actually done)

- The workflow file `.github/workflows/windows-build.yml` was
  parsed and validated locally on this Linux VM with Python's YAML
  parser (`yaml.safe_load`), including after the Phase 1 decision
  update (GitHub Actions build target, gated signing, UNSIGNED
  labelling). Result: **valid YAML** — 13 steps, `runs-on:
  windows-latest`, signing step gated on
  `steps.signing.outputs.available == 'true'`, upload artefact
  `download-manager-windows-x64-unsigned`. (PyYAML parses the bare
  `on:` trigger key as boolean `True`; that is a known PyYAML
  YAML 1.1 quirk, not a workflow error — GitHub Actions parses
  `on:` correctly.)
- The validation above was re-run after the decision update, not
  just on the first draft, so the current workflow file on disk is
  the validated one.
- That validation proves syntax only. It does **not** prove the
  workflow runs, builds, or passes on a Windows runner, and it is
  not a substitute for the first watched run in Phase 2.
- No other claim in this document was tested by execution, because
  the things it describes (installer, signing, update server, log
  rotation in the shipped app) do not exist yet.
