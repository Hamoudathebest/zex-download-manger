# Roadmap — Download Manager (Phases 1–3)

> **Status:** Phase plan; implementation progress is tracked in the root
> `AUDIT.md` and `TEST_REPORT.md`. Those current reports supersede stale
> environment and completion statements in this historical plan.
> Dates below are **relative milestones** (Phase 1 → Phase 2 → Phase 3),
> not calendar commitments: no calendar date is promised, because
> Phase 2 depends on a Windows machine that is not available here, and Phase 3 depends on
> signing/packaging decisions that are still open.
>
> Companion docs: `architecture.md` (design + open decisions D-01…D-12)
> and `feature-matrix.md` (IDM comparison, labelled
> `public-doc` / `planned` / `not-verified`).
>
> **Honesty constraints carried from architecture.md:**
> no Windows `.exe`/`.msi` is claimed in Phase 1; no IDM binary was
> tested or analysed; no DRM circumvention; no browser credential
> extraction; no simulated metrics — only real measured numbers or
> `not-run`.

---

## Roadmap at a glance

```
Phase 1 ── Linux foundation (THIS PHASE)
  │  Engine prototype on Linux (Rust CLI) · local API remains unimplemented
  │  Segmented + resumable HTTP(S) · .part + checkpoint JSON
  │  Scheduler/queue · MV3 extension spec + native-host prototype
  │  Media: unencrypted HLS/DASH only, encrypted ⇒ refuse
  │  Local HTTP fixture server + crash-recovery tests
  │  Exit gate: engine passes fixture + crash tests on Linux (see §1.4)
  │
  ▼
Phase 2 ── Tauri + Windows (REQUIRES NEW ENVIRONMENT)
  │  Rust toolchain install · Tauri 2 shell + React/TS/Tailwind UI
  │  Engine: Node prototype → Rust core decision (D-01) executed
  │  Real Windows machine: install, run, browser integration test
  │  Windows packaging (MSI vs MSIX vs portable, D-11)
  │  Media: fMP4 remux (D-10), DASH polish, queue pre-emption (D-08)
  │  Exit gate: Windows end-to-end test report (see §2.4)
  │
  ▼
Phase 3 ── Polish, signing, release
    Signing · auto-update decision (D-12) · localisation
    Installer polish · docs + support surface · release checklist
    Exit gate: signed release + published docs (see §3.4)
```

**Dependency rule:** a phase's exit gate must pass before the next
phase's release claims begin. Work may *start* early (e.g. UI mockups
in Phase 1), but no Phase 2/3 outcome may be claimed until its gate
evidence exists.

---

## Phase 1 — Foundation, Linux prototype

**Goal:** prove the engine is correct on Linux, with clean seams for
the UI and extension, and with honest docs. Not a product release.
Not a Windows build.

### 1.1 Milestones

| ID | Milestone | Deliverable / evidence | Depends on | Status |
|---|---|---|---|---|
| P1-M1 | Architecture + feature matrix + roadmap (this doc set) | `docs/architecture.md`, `docs/feature-matrix.md`, `docs/roadmap.md` | — | **Done (this delivery, Agent 1)** — docs only, not code |
| P1-M2 | Engine core: probe → segment → fetch → assemble → verify | Rust CLI implementation in `engine/`; unit and real HTTP integration tests pass for documented behaviors (see root `TEST_REPORT.md`) | P1-M1 (contracts in architecture §3.6, §4, §9) | **Partial** — CLI works; local API and specified filename sanitisation are absent |
| P1-M3 | Persistence + crash recovery | `.part` + checkpoint JSON with atomic writes; SIGKILL → restart → resume → byte-identical output vs fixture | P1-M2 | **Partial** — Ctrl-C pause/resume is tested; SIGKILL/atomic crash recovery gate not demonstrated |
| P1-M4 | Scheduler + queue + throttling | Queue ordering, global/per-host concurrency, speed limits (token bucket), scheduling windows, pause/resume | P1-M2 | **Partial** — aggregate throttle exists and is tested; queue/scheduler do not exist |
| P1-M5 | Local API + CLI | Loopback API (§3.6 methods) + CLI driver; API versioning + token auth | P1-M2, P1-M4 | Open |
| P1-M6 | Browser extension spec + native-host prototype | MV3 manifests, content scripts and service workers exist; native host with schema validation/framing tests is still required | P1-M5 (API contract) | **Partial** — extension sources exist; host integration absent and browsers untested |
| P1-M7 | Media subsystem (narrow scope) | Unencrypted HLS master/media playlist parsing, variant listing, segment resolution, TS concat; encrypted/live refusal paths with typed errors | P1-M2 | **Partial** — static playlist parsing and FFmpeg command builder tested; segment transfer/job execution absent |
| P1-M8 | Test harness + Phase 1 test report | Local HTTP fixture server (§16.2 in architecture); unit + crash-recovery + checkpoint-corruption + media + host-contract tests; written report with method and real measured results or `not-run` | P1-M2…P1-M7 | **Partial** — root `TEST_REPORT.md`; SIGKILL, checkpoint corruption and host contract gates remain unverified |
| P1-M9 | Decision convergence | D-04 (host transport), D-06 (checkpoint suffix/layout) settled and recorded; D-01/D-02 recommendations written for Phase 2 (not yet executed) | P1-M6, P1-M3 | Open |

### 1.2 What Phase 1 deliberately does NOT include

- No Tauri app and no verified Windows installer (Windows machine unavailable; the standalone Rust CLI exists and is documented in root `AUDIT.md`).
- No automatic browser capture, no traffic interception, no site
  grabber, no clipboard monitoring (see feature-matrix gaps).
- No DRM/encrypted-media handling beyond refusal (architecture §6.4).
- No cloud, account, sync, or telemetry.
- No performance/speed-multiple claims (all such claims `not-run`
  until P1-M8 measures something, and even then only for the fixture
  + stated hardware).

### 1.3 Risks in Phase 1 (and mitigations)

| Risk | Mitigation |
|---|---|
| Sibling implementations diverge from architecture contracts (e.g. checkpoint suffix, API schema) | D-06 + P1-M9 convergence checkpoint; architecture is the contract, code reviews check against it |
| Fixture server does not cover a real server quirk (e.g. a CDN that rejects HEAD *and* range probes) | Fixture cases enumerated in architecture §16.2; add cases as real-world failures are found, with regression tests |
| Segment-count / buffer tuning guessed without measurement | Defaults are labelled `planned`; P1-M8 measures before any tuning claim |
| Scope creep into DRM / credential features | Hard boundary in architecture §6.4, §12; any such request is refused in design review, not implemented "just to see" |

### 1.4 Phase 1 exit gate (all must hold)

1. [ ] P1-M8 test report exists, with fixture + crash-recovery
   tests passing on Linux, and every number in it measured (or
   labelled `not-run`).
2. [ ] A download can be paused, SIGKILLed, resumed, and verified
   byte-identical — demonstrated, not asserted.
3. [ ] Encrypted playlist input produces `MEDIA_ENCRYPTED` and
   creates no job; live playlist produces `MEDIA_LIVE_UNSUPPORTED`.
4. [ ] Native host rejects malformed/oversized/unknown-field
   messages (contract tests, P1-M8).
5. [ ] No checkpoint, log, or job record contains a credential,
   cookie, or token (review checklist, architecture §12.4).
6. [ ] Docs state plainly what Phase 1 does not do (this roadmap +
   feature-matrix gaps) — no parity claim.

**If any gate item fails, Phase 1 is not complete, and Phase 2
release claims do not start.** The gate is the definition of done,
not a date.

---

## Phase 2 — Tauri / Windows packaging + real Windows testing

**Goal:** turn the proven Linux engine design into a real desktop
app a Windows user can install and run, and prove it on Windows. The
Tauri shell and installer pass a CI install/start smoke test; P2 exit
evidence still requires interactive Windows and end-to-end browser tests.

### 2.1 Prerequisites (environment changes, not code)

| Prerequisite | Why it blocks Phase 2 | Status |
|---|---|---|
| Windows test environment | Installer, WebView2, Native Host registry and browser integration require Windows | **GitHub `windows-latest` CI is available for build/install/start smoke tests; no interactive Windows 10/11 browser test machine is available** |
| Rust toolchain (stable, pinned version) + cargo | Tauri 2 builds require Rust | **Installed on Linux (Rust 1.96.1); pinning and Windows runner validation remain** |
| Chromium/Chrome + Firefox on Windows | Browser extension testing (MV3 install, Native Messaging registration, handoff) | No interactive browser test has been run; Firefox remains incomplete |
| Test accounts / public test files (licence-free) for Windows runs | Deterministic, lawful test content (no copyrighted/DRM material) | To be assembled at Phase 2 start |

### 2.2 Milestones

| ID | Milestone | Deliverable / evidence | Depends on | Status |
|---|---|---|---|---|
| P2-M1 | Toolchain + Tauri shell | Tauri 2 project, real window, bundled resources and Windows startup smoke | §2.1 prerequisites | **Partial** — CI build and startup smoke pass; interactive Win 10/11 validation pending |
| P2-M2 | Engine decision executed (D-01) | Rust engine integrated to the §3.6 service contract, with persistence and lifecycle control | P1 exit gate, P2-M1 | **Partial** — Tauri launches `dm`; full API, SQLite, pause/cancel and queue absent |
| P2-M3 | UI shell decision executed (D-02, D-03) | Tauri 2 + React/TS/Tailwind views | P2-M1 | **Partial** — ten views run in Tauri; scheduler, queue actions and stats remain incomplete |
| P2-M4 | UI ↔ engine integration | Frontend calls commands, shows actual progress and persists jobs | P2-M2, P2-M3 | **Partial** — add/list/progress and shared state implemented; end-to-end download via the GUI remains to be exercised on Windows |
| P2-M5 | Windows browser integration | MV3 extension installed; Native Messaging registration and handoff demonstrated; Firefox decision documented | P2-M2, §2.1 browsers | **Partial** — host, shared job records and Chromium registration UI implemented; browser handshake untested; Firefox incomplete |
| P2-M6 | Windows packaging | NSIS installer builds, installs, starts and uninstalls cleanly | P2-M4, P2-M5 | **Partial** — Tauri NSIS build/install/start smoke passes in CI; uninstall and interactive user-machine tests pending; MSI not implemented |
| P2-M7 | Media Phase 2 | fMP4 remux via ffmpeg (D-10) if verified; DASH polish; segment handling for fMP4; encrypted-refusal re-tested on Windows | P2-M2 | Open |
| P2-M8 | Scheduler / queue polish | Queue pre-emption decision (D-08) executed or deferred with reasons; shutdown-on-complete + prevent-sleep on Windows power APIs, tested (not just coded) | P2-M4 | Open |
| P2-M9 | Phase 2 test report (Windows) | Written report: Windows version/build, hardware, browsers tested, installer tested, handoff tested, media tested, known failures listed. Every Windows claim in this report is backed by a run on the test machine — anything else stays `not-verified` | P2-M1…P2-M8 | Open — **this is the Phase 2 exit evidence** |

### 2.3 What Phase 2 deliberately does NOT include

- Code signing for public distribution (Phase 3; an unsigned test
  build is fine for P2 testing, but it must be labelled unsigned
  and must not be distributed as a release).
- Auto-update channel (D-12, Phase 3).
- macOS port (not committed; Tauri feasibility note only).
- Site grabber, clipboard monitoring, auto-capture (still D-05 /
  out of scope unless separately decided — Phase 2 does not smuggle
  them in via the UI).

### 2.4 Phase 2 exit gate (all must hold)

1. [ ] App installs, runs, downloads, pauses/resumes, and
   uninstalls cleanly on a real Windows machine (P2-M9 evidence).
2. [ ] Browser handoff works in at least one Chromium browser on
   Windows (P2-M5 evidence).
3. [ ] No Windows behaviour is claimed from Linux runs — the P2
   report separates "tested on Windows" from "tested on Linux" from
   `not-verified`.
4. [ ] Encrypted-media refusal still holds on the Windows build
   (regression, not assumption).

---

## Phase 3 — Polish, signing, release

**Goal:** a distributable, trustworthy release — not just a build
that runs on a test machine.

### 3.1 Milestones

| ID | Milestone | Deliverable / evidence | Depends on | Status |
|---|---|---|---|---|
| P3-M1 | Code signing | Signing certificate procured (organisational decision — who holds the key, how it is stored); Windows builds signed; signature verified on a clean test machine | P2 exit gate | Open |
| P3-M2 | Auto-update decision executed (D-12) | Decision: Tauri updater vs manual download vs none — with security reasoning (update channel is a high-value attack surface; unsigned auto-update is not acceptable). If updater chosen, update flow tested end-to-end incl. rollback/failure path | P3-M1 (signing is a prerequisite for a trustworthy updater) | Open |
| P3-M3 | Installer polish | Final packaging format confirmed (D-11); per-user vs per-machine install tested; upgrade over a previous version tested (settings + queue + checkpoints survive upgrade) | P2-M6, P3-M1 | Open |
| P3-M4 | Localisation + accessibility | UI strings externalised; at least one additional language shipped (Arabic is the natural first candidate given this project's user context, but the choice is a product decision, not assumed); keyboard navigation + screen-reader basics checked | P2-M4 | Open |
| P3-M5 | Docs + support surface | User guide (install, add download, extension handoff, scheduler, media limits incl. encrypted-refusal explained in plain language); troubleshooting (ENGINE_OFFLINE, BLOCKED_HOST, HASH_MISMATCH, disk-full); privacy note (no telemetry, no credentials stored) | P2-M9 | Open |
| P3-M6 | Release checklist run | Clean-machine install test; upgrade test; uninstall test; signed-binary verification; docs published alongside the build; known-issues list published (not hidden) | P3-M1…P3-M5 | Open — **this is the Phase 3 exit evidence** |

### 3.2 What Phase 3 deliberately does NOT include

- Any feature that was out of scope in Phases 1–2 (DRM, credential
  harvesting, site grabber) — polish does not reopen closed
  boundaries. Reopening one requires a new, explicit decision with
  legal/policy review, not a roadmap edit.
- A cloud service, account system, or paid licensing system — none
  is scoped in this roadmap. If a commercial model is later wanted,
  it is a separate programme, not a Phase 3 milestone.

### 3.3 Risks in Phase 3 (and mitigations)

| Risk | Mitigation |
|---|---|
| Signing key mishandled (leaked, lost, or held by one person) | Key custody decided before P3-M1 starts; hardware-backed storage preferred; loss/revocation procedure written before first signed build |
| Auto-update becomes an attack vector | D-12 reasoning + signed updates only + failure/rollback tested (P3-M2); no update without signature verification |
| Upgrade breaks existing queues/checkpoints | Checkpoint `formatVersion` discipline (architecture §9.2) + upgrade test in P3-M3/P3-M6; old-format checkpoints must fail safely, never corrupt |
| Release notes overclaim parity with IDM | Feature-matrix re-checked at release; every row re-labelled against the shipped build's test evidence, not against the Phase 1 plan |

### 3.4 Phase 3 exit gate (all must hold)

1. [ ] Signed installer verified on a clean Windows machine.
2. [ ] Upgrade + uninstall tested and documented.
3. [ ] User guide + privacy note published with the release.
4. [ ] Known issues published; no known data-loss or credential-
   handling issue ships as "known" without a workaround.
5. [ ] Feature matrix updated to reflect the shipped build (rows
   move from `planned` to tested only with P2/P3 evidence).

---

## Open decisions register (summary — full text in architecture §17)

| ID | Decision | Lean / status | Phase that must settle it |
|---|---|---|---|
| D-01 | Shipped engine core language (Node bundle vs Rust port) | Lean Rust-via-Tauri; prototype proves design first | Phase 2 (P2-M2) |
| D-02 | UI shell (Tauri 2 vs Electron fallback) | Lean Tauri 2; fallback on WebView2 evidence | Phase 2 (P2-M3) |
| D-03 | Frontend state library | Undecided | Phase 2 (P2-M3) |
| D-04 | Native host transport (loopback HTTP only vs + stdio) | Lean loopback HTTP only | Phase 1 (P1-M9) |
| D-05 | Extension auto-capture / traffic sniffing | Default OFF; separate justification required | Any future auto-capture work (not Phase 1) |
| D-06 | Checkpoint suffix/layout (`.part.json` vs central DB only) | Reference: `.part.json` sidecar | Phase 1 (P1-M9) |
| D-07 | Dynamic segment re-splitting | Phase 1: no; Phase 2: measure first | Phase 2 |
| D-08 | Queue pre-emption on reorder | Phase 1: no | Phase 2 (P2-M8) |
| D-09 | Credentials-in-URL policy | Phase 1: reject | Any such feature |
| D-10 | fMP4 remux via ffmpeg | Phase 2, pending verification | Phase 2 (P2-M7) |
| D-11 | Windows packaging format (MSI vs MSIX vs portable) | Undecided | Phase 2 (P2-M6), confirmed Phase 3 |
| D-12 | Auto-update channel | Undecided; signing prerequisite | Phase 3 (P3-M2) |

**Decision log rule:** when a decision is settled, record the date,
the evidence, and who decided — in this file, as an appended entry
below. Do not silently edit the lean column; append the outcome so
the history is auditable.

### Decision log

- *(Empty — Phase 1, 2026-10-21. No decisions settled beyond the
  design leans recorded above.)*

---

## Dependencies diagram (text)

```
P1-M1 (docs) ──► P1-M2 (engine) ──► P1-M3 (persistence) ──┐
                  │                 │                    │
                  ▼                 ▼                    ▼
               P1-M4 (scheduler)  P1-M5 (API/CLI) ──► P1-M6 (extension host)
                  │                 │                    │
                  └────────► P1-M7 (media) ◄─────────────┘
                                   │
                                   ▼
                            P1-M8 (test report) ──► PHASE 1 GATE
                                                         │
                              ┌────────────────────────────┘
                              ▼
                    P2 prerequisites (Windows machine, Rust)
                              │
              P2-M1 (Tauri shell) ──► P2-M2 (engine core) ──► P2-M4 (UI↔engine)
                  │                       │                      │
                  ▼                       ▼                      ▼
              P2-M3 (UI) ─────────► P2-M5 (browser, Win) ──► P2-M6 (packaging)
                  │                       │                      │
                  └──────► P2-M7 (media 2) + P2-M8 (scheduler polish)
                                   │
                                   ▼
                            P2-M9 (Win test report) ──► PHASE 2 GATE
                                                         │
                              ┌────────────────────────────┘
                              ▼
              P3-M1 (signing) ──► P3-M2 (auto-update) ──► P3-M3 (installer)
                  │                       │                      │
                  └──────► P3-M4 (l10n/a11y) + P3-M5 (docs)
                                   │
                                   ▼
                            P3-M6 (release checklist) ──► PHASE 3 GATE
```

---

## What success looks like (per phase, in one sentence each)

- **Phase 1 success:** a stranger can run the Linux prototype
  against a local fixture, kill it mid-download, resume it, and get
  a byte-identical file — and the docs honestly say what it cannot
  yet do.
- **Phase 2 success:** a Windows user can install the app, send a
  download from their browser with one click, and have it complete
  — proven on a real Windows machine, not on Linux.
- **Phase 3 success:** that Windows user can download a signed
  installer, install it, upgrade it, and uninstall it cleanly, with
  a guide that explains its limits (including encrypted-media
  refusal) in plain language.

---

*End of roadmap.md — Phase 1 foundation. Next action after this
delivery: sibling agents' P1-M2…P1-M8 implementation and test work,
followed by the P1-M9 decision convergence (D-04, D-06).*
