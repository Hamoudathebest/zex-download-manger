# Building — Linux prototype vs. Windows (GitHub Actions)

> **Current status (2026-10-23):** Windows run `39866677122` passed the
> earlier Rust, engine integration, Native Messaging, Tauri build, NSIS
> install/start smoke, media, and extension syntax checks. This revision adds
> desktop/browser E2E and security-audit jobs. RustSec/npm audit passed in run
> `39928995290`; run `39934826380` passed the desktop lifecycle through
> completion and Cancel but Edge's TCP debug endpoint failed before the
> Native Messaging/browser test stage.
> This document began as a Phase 1 plan; refer to root `AUDIT.md` and
> `TEST_REPORT.md` for current findings.
>
> The Windows workflow runs on GitHub Actions `windows-latest`. This
> validates that runner image only; it is not a Windows 10/11 user-machine
> compatibility claim. Artifacts are unsigned.

## 1. What you can build where

| Task | Linux (this VM, prototype) | GitHub Actions `windows-latest` (Phase 2) |
| --- | --- | --- |
| Engine logic + unit tests | Yes — Linux CLI build and loopback tests | Yes — Windows x64 build and tests |
| Extension lint / build | Yes — JS/JSON validation | Yes — JS/JSON validation |
| Native Messaging protocol test over stdin/stdout pipes | Yes — the protocol itself is OS-neutral | Yes |
| Windows `.exe` | **No** — not built here | Yes — CI artefact, **unsigned by default** |
| Tauri NSIS installer (`.exe`) | **No** — Windows target only | Built, silently installed and startup-smoke-tested on `windows-latest` |
| MSI | **No** — not implemented | Not implemented |
| Native Messaging registry registration | **No** — Windows registry work, not testable here | UI registration command is implemented; Edge/host E2E is blocked on WebView2 CDP attachment |
| Code signing | **No** | **No** — all current artifacts are unsigned |

## 2. Linux prototype build (what works here)

Prerequisites: a Rust toolchain (`rustup`, stable), Node.js 22 + npm,
Python 3 for icon generation, and Tauri's Linux WebKit/GTK prerequisites
if compiling the desktop shell locally. Windows desktop/release checks
run on GitHub Actions.

```sh
# Rust engine and Native Messaging host
cargo build --manifest-path engine/Cargo.toml
cargo test  --manifest-path engine/Cargo.toml

# Tauri frontend typecheck/build (web UI)
cd ui
npm ci
npm run lint
npm run build

# Browser extension syntax / manifest checks
node --check extension/background.js
node --check extension/content.js
python3 -m json.tool extension/manifest.json > /dev/null
```

These commands mirror the CI steps, but a passing Linux prototype
build is **not** a Windows build: it proves logic, not the shipped
artefact. Do not label prototype output as a release.

## 3. Windows build (GitHub Actions only)

1. Push to `main`, open a PR against `main`, push a `v*.*.*` tag,
   or run the workflow manually (`workflow_dispatch`).
2. The workflow (`.github/workflows/windows-build.yml`) runs format,
   Clippy, Rust/loopback tests, Native Messaging protocol tests, UI lint
   and build, media tests, Tauri Windows bundle, and installer
   install/start smoke test.
3. **Artifact:** `dm-windows-x64-<commit>` contains CLI, Native Messaging
   host and NSIS desktop installer executables. All are unsigned.
4. Workflow run `39866677122` passed the build and installer/startup
   smoke. Treat it as runner validation only; a successful runner build
   does not prove interactive Windows 10/11 compatibility.

## 4. Contributing notes

- **Never commit secrets.** Certificates, keys, tokens, and
  passwords go nowhere in this repo — not in code, not in the
  workflow, not in docs, not in commit messages. Signing credentials
  belong in GitHub Actions Secrets / a secure vault, supplied by
  the user through that secure flow.
- **Never claim a build you did not run.** Prototype results are
  prototype results; CI results are CI results; a plan is a plan.
  If a step has not run on a Windows runner, say so.
- **Keep the workflow as the contract.** A build step that only
  works on one person's machine — including the user's PC — is not
  a release step. Put it in the workflow or do not rely on it.
- **Versioning, branching, installer, updates, and logging** are
  specified in [release.md](release.md). Do not duplicate those
  rules here; link to them.
