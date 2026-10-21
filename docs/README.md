# Documentation index

> **Build-target decision (Phase 1, confirmed):** Windows builds run
> on **GitHub Actions `windows-latest`** as CI artefacts, unsigned
> by default. **The user's own Windows PC is NOT a build target.**
> Details in [release.md](release.md).

## Documents (DevOps-owned, Phase 1)

- **[release.md](release.md)** — the DevOps & release plan: repository
  layout, Semantic Versioning, branching/release process, installer
  plan (WiX/NSIS, **not built here**), update mechanism design
  (check endpoint, signed manifests, staged rollout, rollback),
  error-logging design (location, rotation, privacy rules), and the
  YAML-validation note. This is the authoritative DevOps document;
  other docs link to it rather than restating it.
- **[BUILDING.md](BUILDING.md)** — how to build the prototype on
  Linux vs. the Windows build on GitHub Actions, plus contribution
  notes (no secrets in the repo, never claim an unrun build).

## Workflow (plan, not yet run)

- **[../.github/workflows/windows-build.yml](../.github/workflows/windows-build.yml)**
  — GitHub Actions workflow for `windows-latest`: checkout, Rust
  stable + Node.js 20 setup, build, test, package, and
  `upload-artifact` of an **unsigned** artefact
  (`download-manager-windows-x64-unsigned`). The signing step is
  gated on a GitHub Actions Secret and skipped when absent.
  YAML-validated locally; **never run** on this Linux VM, and no
  Windows `.exe`/installer has been produced here.

## Other areas

Other directories in this repository (`engine/`, `extension/`,
`specs/`, `media/`, `qa/`, `ui/`) are owned by other Phase 1 agents
and documented by them. This index does not speak for their work.
