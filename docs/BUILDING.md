# Building — Linux prototype vs. Windows (GitHub Actions)

> **Correction (GitHub integration work, 2026-10-21):**
> `.github/workflows/windows-build.yml` and
> `.github/workflows/release.yml` are now real workflows that
> build/test/package the actual project. They are still unrun on
> a Windows runner. Where this document says "plan only", read
> it as "unrun", and treat the workflow files as authoritative.
>
> **Build-target decision (Phase 1, confirmed):** the Windows build
> runs on **GitHub Actions `windows-latest`**, producing a CI
> artefact. **The user's own Windows PC is NOT a build target** and
> no step in this plan requires it. See [release.md](release.md)
> (decision box at the top, and §3–§4) for the full statement,
> including the unsigned-by-default rule.

## 1. What you can build where

| Task | Linux (this VM, prototype) | GitHub Actions `windows-latest` (Phase 2) |
| --- | --- | --- |
| Engine logic + unit tests | Yes — prototype only (once `engine/` code lands) | Yes — the real build |
| Extension lint / build | Yes (Node tooling, once present) | Yes |
| Native Messaging protocol test over stdin/stdout pipes | Yes — the protocol itself is OS-neutral | Yes |
| Windows `.exe` | **No** — not built here | Yes — CI artefact, **unsigned by default** |
| Installer (`.exe` / `.msi`) | **No** — plan only, see [release.md §4](release.md) | Planned, Phase 2, CI only |
| Native Messaging registry registration | **No** — Windows registry work, not testable here | Tested on a CI-provisioned Windows environment, not on a user's PC |
| Code signing | **No** — no credential exists | Later, gated step only, once the user supplies a credential via GitHub Actions Secrets / secure vault — never in chat |

## 2. Linux prototype build (what works here)

Prerequisites (once the code lands): a Rust toolchain (`rustup`,
stable) for `engine/`, and Node.js 20 + npm for the extension
tooling. Nothing else is needed to prototype.

```sh
# Engine (once engine/Cargo.toml exists)
cargo build --manifest-path engine/Cargo.toml
cargo test  --manifest-path engine/Cargo.toml

# Extension tooling (once package.json exists)
npm ci
npm run build --if-present
npm test --if-present
```

These commands mirror the CI steps, but a passing Linux prototype
build is **not** a Windows build: it proves logic, not the shipped
artefact. Do not label prototype output as a release.

## 3. Windows build (GitHub Actions only)

1. Push to `main`, open a PR against `main`, push a `v*.*.*` tag,
   or run the workflow manually (`workflow_dispatch`).
2. The workflow (`.github/workflows/windows-build.yml`) runs on
   `windows-latest`: checkout → Rust stable + Node.js 20 → guardrail
   check (fails if no `engine/Cargo.toml` and no `package.json`
   exist, so it can never report a green empty build) → build →
   test → package into `dist/` → upload artefact.
3. **Artefact:** `download-manager-windows-x64-unsigned`
   (30-day retention), containing the packaged binaries plus
   `UNSIGNED.txt`. The `UNSIGNED` label is deliberate: until the
   Phase 2 signing step is implemented *and* the user has supplied
   a signing credential through a secure flow, every artefact is
   unsigned and must be presented as such.
4. **Signing step (gated):** the workflow checks only whether the
   `WINDOWS_SIGNING_CERT` secret is present (a boolean, never the
   value). If absent, the signing step is skipped and the run
   succeeds unsigned. If present, the current placeholder logs that
   the Phase 2 implementation is not yet present and the artefact
   remains unsigned — a present secret alone does not make a build
   signed.
5. **The workflow has not run here.** Its YAML syntax was validated
   locally (see [release.md §7](release.md)); that validates syntax
   only. The first real run must be watched on the runner, and its
   result — not this document — is what proves the build works.

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
