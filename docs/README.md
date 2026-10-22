# Documentation index

> **Current status:** see root [`AUDIT.md`](../AUDIT.md) and
> [`TEST_REPORT.md`](../TEST_REPORT.md) for the current implementation
> inventory and verified results. The Phase 1 plans below are historical
> design material where they conflict with those current reports.

## Documents (DevOps-owned, Phase 1)

- **[release.md](release.md)** — the historical DevOps & release plan: repository
  layout, Semantic Versioning, branching/release process, installer
  plan (WiX/NSIS), update mechanism design
  (check endpoint, signed manifests, staged rollout, rollback),
  error-logging design (location, rotation, privacy rules), and the
  YAML-validation note. This is the authoritative DevOps document;
  other docs link to it rather than restating it.
- **[BUILDING.md](BUILDING.md)** — how to build the prototype on
  Linux vs. the Windows build on GitHub Actions, plus contribution
  notes (no secrets in the repo, never claim an unrun build).

## Workflows (current run status in TEST_REPORT.md)

- **[../.github/workflows/windows-build.yml](../.github/workflows/windows-build.yml)**
  — Windows x64 Rust build/tests, Native Messaging tests, Tauri/NSIS
  build and install/start smoke test. Run `39850739198` passed these
  checks on `windows-latest`; interactive browser and user-machine
  Windows 10/11 verification remain outstanding.

## Other areas

See the root audit for a consolidated component inventory; this index
points to component-level design documents rather than independently
asserting their completion status.
