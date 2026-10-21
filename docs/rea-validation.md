# REA Validation — Phase 1 (Download Manager Project)

**Scope of this document:** Public-documentation validation only.
**Date of check:** 2026-10-21
**Status:** ✅ REA understood from its public docs. ❌ No binary analysis performed — see §3.

> This file does **not** claim that REA was installed, run, or tested here.
> It does **not** claim a live-browser visit: as a generic subagent, this check
> used public web search and page-text fetching only. No sign-in, clicking,
> purchase, or form submission was performed.

---

## 1. What REA actually is

**REA = Reverse Engineer Anything**, public repository `morluto/rea`.

From its README (fetched 2026-10-21, commit `01788bac863ac786bfbb648cad69b11e23b40a89`):

- Tagline: *"Reverse engineer anything with agents, from app behavior down to
  native binaries"* / *"One MCP for reverse engineering across binaries,
  applications, and runtime behavior."*
- It is **not a new decompiler**. It is an **MCP server + CLI** that connects
  an AI coding agent to established reverse-engineering tools, so the agent
  can inspect a target without its original source code, explain a feature,
  show the evidence behind the conclusion, and then build a version of that
  feature in the agent's own project.
- Workflow, per the README: agent asks about a local target → REA inspects
  and traces it using analysis tools → agent uses the returned code,
  references and unknowns to explain, implement and test.
- Licence: **MIT** for REA-authored code. Third-party material retains its
  own licences (see README "License" and `THIRD_PARTY_NOTICES.md`).
- Analysis runs **locally** on the operator's machine: *"REA analyzes targets
  locally."* The README FAQ adds the caveat that the agent's own model
  provider has its own data policy — local REA analysis does not by itself
  guarantee that nothing leaves the machine via the agent/model call.
- Supported agent clients named by setup: Claude Code, Codex, Cursor,
  Gemini CLI, Grok Build, plus other MCP-capable clients via manual MCP
  registration. Any agent that supports local MCP servers can use it, per
  the FAQ.
- The npm package is `rea-agents`; the official sources named by the README
  are the `morluto/rea` repo, `rea.tools`, and the `rea-agents` npm package.
  The README explicitly warns that a similar repo name or a copied README
  does not establish that a download is official.

### What REA can analyse (README "What you can analyze" table, abridged)

Relevant to a Windows download-manager-style target first, then the wider set:

| Target | What REA returns | Provider / requirement (per README) |
|---|---|---|
| Native binaries | Pseudocode, assembly, strings, symbols, calls and references | Hopper, Ghidra or IDA |
| Desktop installations | Runtime candidates, supporting files, component markers, next probes | Built-in bounded directory/header inspection |
| JavaScript / Electron | Modules, imports, source maps, routes, IPC, native add-on relationships | Node.js + npm; on Linux, a procps-compatible `ps` |
| .NET assemblies | Metadata, CIL instructions, declared native dependencies, build comparisons | None (static only) |
| Android APKs | Manifest, classes, decompiled methods, references | Headless JADX + full JDK (Linux/macOS/Windows x64) |
| Firmware | Regions, extraction results, native-analysis handoffs | Binwalk / Unblob on Linux |
| Websites | Page structure, scripts, network observations, requested screenshots | A Chrome-family browser |
| Saved network captures | Requests, responses, exposed payloads, source locations | HAR or Fiddler Everywhere SAZ; mitmdump on Linux for native mitmproxy |
| SQLite databases, model artifacts, Godot PCK, Rust/Go binaries, WASM, EVM bytecode, recorded packets/crashes, process behaviour, PyInstaller executables, packages/resources, and others | Format-specific inventories, metadata, decoded structures | Mostly built-in static inspection, or a named caller-supplied tool (e.g. TShark, sigrok-cli, WABT, pwntools) |

Static JavaScript and .NET inspection read supplied files **without running**
the application. Runtime capture runs or interacts with the selected target
under the operator's user permissions; each runtime guide describes its effects.

### Analysis providers — only what the docs actually say

**Native-binary providers (the ones that matter for a native Windows binary):**

1. **Ghidra** — REA connects to an *existing* Ghidra installation. Per
   `docs/installation.md`:
   - Hosts: Linux x64/arm64, macOS x64/arm64, or **experimental Windows
     x64 "P0"**.
   - Accepted version: **Ghidra 12.1.x**, with the 64-bit full JDK declared by
     that installation (`application.java.min` / `application.java.max`);
     current 12.1 releases require JDK 21 or newer; the bridge is verified
     with Ghidra 12.1.4 and JDK 21.
   - Each installation must include the native decompiler for the host
     architecture; REA checks the executable header, it does not infer
     compatibility from a directory name.
   - The Ghidra adapter exposes **26 read-only operations** (14
     inventory/name/search + 12 function-analysis), covering metadata,
     decompilation, assembly, resolved calls, typed references, xrefs,
     function dossiers, instructions, recovered data types, load mappings,
     loaded memory bytes and observed file offsets.
   - On Linux/macOS, annotation operations can rename functions / set
     address names; those session metadata edits leave executable bytes
     unchanged and are discarded on close. **Windows P0 remains read-only.**
   - Windows P0 scope (per the installation doc): native x86, x86-64,
     ARMNT (Thumb-2) and ARM64 **PE applications and DLLs**, plus explicitly
     selected raw NMOS 6502 images with a caller-supplied entry at file
     offset 0, on fixed local NTFS volumes. Other raw CPU families remain
     unsupported on Windows.
   - **Setup never installs Ghidra, Java, or Python.** The operator extracts
     Ghidra and installs the JDK outside REA, then sets
     `GHIDRA_INSTALL_DIR` (and `JAVA_HOME` if needed) and runs
     `rea doctor --json`.
   - Default Ghidra provider startup deadline is 330,000 ms; raisable via
     `REA_GHIDRA_STARTUP_TIMEOUT_MS`.
2. **Hopper** — commercial software with its own licence; free demo has
   vendor-defined limits; a paid licence is optional.
   - Setup can install Hopper **with explicit approval** — but only on
     supported macOS/Linux hosts (macOS 12+, Ubuntu 24.04+, Fedora 41+,
     Nobara 44+, 64-bit Arch, CachyOS, Omarchy). On macOS it downloads the
     official DMG, checks size/digest, validates the bundle, installs to
     `~/Applications/Hopper Disassembler.app`; on supported Linux it verifies
     the official `.deb`/`.rpm`/Arch package (detached PGP signature against
     Hopper's stable primary fingerprint) before invoking the package manager.
   - **Hopper installation remains unavailable on Windows.** REA reuses a
     detected existing installation and preserves Hopper during uninstall.
   - REA starts Hopper when an operation needs it; on macOS a first-run
     dialog may ask for demo mode or licence activation, to be completed in
     the same user session before the first operation or unattended job.
   - On macOS, REA currently declines saved Hopper database (`.hop`) targets
     (the native `open database` route does not run REA's bridge script);
     analyse the original executable instead.
3. **IDA Pro** — named throughout the README as a native provider alongside
   Hopper and Ghidra, including an optional native MCP bridge; the README
   points to a dedicated IDA guide. The installation doc excerpt checked here
   does **not** give IDA version/host detail, so no IDA version or platform
   claim is made in this document (see §5, unverified).
4. **Kuna decompiler** — listed in the installation doc alongside Hopper,
   Ghidra and IDA as an analysis-engine option, with a dedicated guide.
   No version or capability claim is made here beyond that listing.
5. **Offline extras** — for offline native-binary inspection, REA also
   supports caller-supplied **GNU objdump and Rizin**. The README is explicit:
   **REA does not install or update either provider.**
6. **JEB** — JEB projects are supported via a caller-started JEB client
   serving MCP, selected with `REA_JEB_MCP_URL`. JEB is a commercial tool
   subject to the same "legally obtain it yourself" rule below.

**For a Windows PE target, the realistic provider shortlist from the docs is
therefore: Ghidra (experimental Windows P0, read-only) if a Windows host is
available, or Hopper/Ghidra/IDA on a Linux/macOS host that can read the PE —
subject to confirming PE support for the chosen provider in its own guide
before any Phase 2 work.**

### Installation requirements (from README + installation doc)

- **Node.js 22.x (>= 22.19), 24.x (>= 24.11), or 26+**, plus npm. Node 23, 25
  and prereleases are unsupported (installation doc, runtime section).
  REA uses the npm already paired with that runtime and never upgrades
  Node.js, npm or Homebrew.
- Setup command (quoted from the README; **not run in this validation**):
  `npx rea-agents setup` — choose agents, review the proposed changes,
  approve them, restart the agent. Setup adds REA's MCP server and matching
  workflow instructions, with backups of existing configuration. It asks
  before changing agent configuration or installing Hopper; declining or
  Ctrl-C makes no changes.
- Global CLI install (also not run here): `npm install --global rea-agents`,
  then `rea --help`; update with `rea update`; one-off CLI use with
  `npx -y rea-agents@latest <command>`.
- Diagnostics: `rea doctor --json` (full health), and scoped checks such as
  `rea doctor --provider ghidra --json` (or `hopper`, `ida`).
- Example terminal analysis (not run here):
  `npx -y rea-agents@latest analyze-javascript-application /absolute/path/to/app --json`
  and, for native analysis after provider configuration,
  `rea analyze /absolute/path/to/app.exe --provider ghidra --json`.
- On Linux, Ghidra, JADX, firmware launches and static JavaScript/Electron
  analysis require a procps-compatible `ps` on REA's `PATH` for process
  ownership checks (README quick-start note; recovery steps are in
  `docs/installation.md` under "Linux owned-process prerequisite").

### Limitations stated by the project itself

- **REA is an interface, not a decompiler, and not original source.**
  Native analysis returns pseudocode and assembly; provider-specific
  pseudocode is never treated as original source or as Hopper-equivalent
  text (installation doc). The disclaimer adds: *"Decompilation,
  reconstruction, heuristics, and AI-assisted analysis may be incomplete or
  incorrect. Results do not guarantee accuracy, completeness, security,
  compatibility, or legal compliance. Review the underlying evidence and
  verify consequential conclusions before relying on them."*
- **Findings carry evidence and limitations.** The README's model is that
  REA returns findings *with their evidence*, including stated caveats and
  unknowns — conclusions without that evidence should not be relied on.
- **Commercial tools are the operator's responsibility.** README licence
  section: *"You must legally obtain and be authorized to use commercial
  tools, including IDA Pro / Hex-Rays decompilers, Hopper, and JEB, under
  their applicable licenses. REA grants no tool license, key, or activation
  entitlement."* Trials/demos remain subject to vendor terms, including
  user, feature, automation and output-sharing restrictions. *"Cracked
  copies, stolen keys, unauthorized key sharing, and bypassing license
  restrictions are not authorized."*
- **Lawful-use boundary (DISCLAIMER.md, "Responsible use").** REA is built
  for lawful analysis: security research, malware/incident analysis,
  vulnerability research and coordinated disclosure, CTFs and education,
  interoperability, software preservation, and debugging/auditing software
  you own or are authorized to examine. The project **does not support, and
  will not help with**: circumventing DRM, licence checks, anti-cheat systems
  or other technical protection measures; developing game cheats or
  tampering with online services; bypassing authentication, bot protection
  or access controls on systems you are not authorized to test; **copying
  proprietary software or reproducing its protected code and assets**;
  evading AI model-provider usage policies; reselling/sharing AI accounts or
  API access.
- **Authorisation is not implied by possession.** Disclaimer: *"Public
  availability of software, possession of a file, or access to a debugging
  endpoint does not by itself establish permission for every operation."*
  Authorisation to inspect an artifact does not necessarily authorise
  execution, interception, device changes, or interaction with another
  party's system.
- **Provider/host limits.** Windows Ghidra support is experimental (P0),
  read-only, and scoped as above; Hopper cannot be installed by setup on
  Windows; Ghidra/Java/Python are never installed by setup on any host;
  large binaries may need raised startup deadlines; a client's own tool-call
  timeout can expire before the provider finishes.
- **No whole-application cloning claim.** The README's showcases are
  narrow, worked reconstructions (e.g. DX-Ball sound-pan calculation,
  Notion Electron clipboard bridge, TH04 DOS bullet-ring calculation) —
  each traced from a specific feature question to evidence to a rebuilt
  implementation, with test comparisons. Nothing in the fetched README
  claims recovery of a complete original codebase.

---

## 2. What was checked, and what it established

| # | Source actually fetched | What it established |
|---|---|---|
| 1 | `https://github.com/morluto/rea` (repo page + full README, 682 lines, commit `01788bac863ac786bfbb648cad69b11e23b40a89`, MIT licence, public, not archived) | §1: identity, MCP+CLI model, target table, provider names, Node requirements, setup/update commands, showcases, FAQ answers, licence/disclaimer pointers. Star/fork counts at fetch time (volatile — see §5). |
| 2 | `https://github.com/morluto/rea/blob/main/docs/installation.md` (2,066 lines; sections read: setup, Hopper, Ghidra, runtime requirements; searched for Node.js / Windows / Ghidra) | Provider detail in §1: Ghidra 12.1.x + JDK 21+, Windows P0 scope/read-only status, Hopper install hosts + Windows exclusion, setup approval/backup behaviour, `rea doctor` checks, startup deadlines, "setup never installs Ghidra/Java/Python". |
| 3 | `https://github.com/morluto/rea/blob/main/DISCLAIMER.md` (full, 212 lines) | Lawful-use scope, prohibited uses (incl. DRM/licence-check circumvention and copying proprietary software), user-responsibility and "possession ≠ permission" rules, commercial-tool licence rule, "results may be incomplete or incorrect" warning. |
| 4 | Web search: "morluto rea github reverse engineering agents" (secondary coverage: Wikipedia, startupfortune, ai.nl, nextriva, codewithnishant) | Corroboration only: REA described consistently as an MIT-licensed MCP server/CLI bridging agents to Ghidra/IDA/Hopper/JADX/Binwalk-type tools, with local analysis and Node `22.19+/24.11+/26+` + `npx rea-agents setup`. **Not used as the source for any precise claim above** — secondary star counts and version numbers conflicted (see §5) and were therefore not adopted. |

No other REA documentation page (IDA guide, Kuna guide, CLI/Evidence guide,
Windows Ghidra P0 guide, MCP contracts, tool catalog) was opened in this
pass; their existence is recorded from README links, their contents are
**not** summarised here.

---

## 3. Why no binary analysis was performed here

**No binary analysis was performed in Phase 1. Nothing was downloaded,
decompiled, executed, or copied. No conclusion about IDM's internals appears
in this document, because none was observed.**

The reasons, each independently sufficient:

1. **No authorized IDM binary is available in this scope.** No IDM binary
   was supplied with this task, and none exists in
   `~/workspace/download-manager/` for this validation. There is nothing
   lawful to point REA at.
2. **No Windows machine / authorised environment is in scope here.** This
   validation ran on the agent's Linux VM as a documentation check. IDM is a
   Windows application; its observable behaviour, installer, and runtime
   environment are not present here, and standing up a Windows host is a
   Phase 2 decision, not a Phase 1 shortcut.
3. **No `npx rea-agents setup` was run — deliberately.** The task instructed
   inspection before any setup, and this agent's remit is validation, not
   installation. Running setup blind would have changed agent configuration
   (and could have proposed a Hopper install) without a target, a provider
   decision, or an authorised environment to justify it. The safe, auditable
   first step is `rea setup --dry-run` / `rea doctor --json` in Phase 2 —
   after the environment decision — not a blind interactive setup now.
4. **Legal/ethical boundary.** REA's own disclaimer (quoted in §1) limits
   use to software you own or are authorized to examine, and refuses help
   with circumventing licence checks / technical protection measures and
   with copying proprietary software or reproducing its protected code and
   assets. A download-manager clone project must therefore be built from
   **lawful inputs** — public documentation, observable behaviour of a
   lawfully licensed copy, and original implementation — not from copied
   proprietary code, cracked tools, bypassed licensing, or decompiled output
   pasted into the product. Until written authorisation / licence review
   for the specific target is recorded, binary analysis must not start.
   This is a project gate, not a technical preference.

---

## 4. What a lawful, evidence-based RE workflow WOULD look like in Phase 2

**This section is a plan only. None of it has been executed.**

### Phase 2 entry gates (all must pass before any target is opened)

- [ ] **G0 — Written authorisation on file.** Named target, named scope
      (inspect only? execute? capture network?), named operator, expiry.
      If the target is third-party proprietary software, a licence review
      noting what the licence permits; if it does not permit the intended
      analysis, stop and seek permission or use only public docs + black-box
      observation of a lawfully licensed copy.
- [ ] **G1 — Clean environment.** Isolated Windows host/VM (or Linux host
      for static PE inspection) with snapshots, no production credentials,
      no production network access, egress controlled. REA + provider
      installed from official sources only (README's official-source rule).
- [ ] **G2 — Provider + licence check.** Provider chosen and its licence
      verified: Ghidra (free, existing install, JDK 21+, Ghidra 12.1.x) is
      the zero-cost default; Hopper/IDA/JEB only with a valid licence the
      project actually holds. Run `rea doctor --json` and record a green
      provider check before any target work. Note Windows Ghidra P0 is
      experimental/read-only — confirm its current scope in the Windows
      Ghidra P0 guide at that time.
- [ ] **G3 — Baseline record.** Target file hash (SHA-256), size, version,
      source of the copy, provider name + version, REA version, host OS.
      Every later claim must be traceable to this baseline.

### Phase 2 method (in order — behaviour before bytes)

1. **Documented capabilities first.** Collect the target's public help,
   manual, changelog and settings UI. Write the feature list to be explained
   (e.g. download segmentation, resume, browser integration, scheduler,
   queue) as questions, before opening any binary.
2. **Observable behaviour (black-box).** On the isolated host, run the
   lawfully licensed copy and record only what it observably does: UI
   flows, settings and their effects, files created, protocols/URLs it
   contacts (network capture only if G0 explicitly authorises interception;
   REA's disclaimer treats inspection authorisation as distinct from
   interception authorisation). Screenshots, logs and captures go into an
   evidence bundle with timestamps.
3. **Static inspection, read-only, evidence-first.** Only then open the
   binary through REA with the chosen provider
   (e.g. `rea analyze <path> --provider ghidra --json`), one narrow question
   at a time. For each question, record: the exact command/tool call,
   provider output (pseudocode/assembly/strings/xrefs), and the session's
   Evidence bundle / snapshot (`close_binary` with `snapshot_path` where
   applicable) — before writing any interpretation.
4. **Confidence labelling — mandatory for every finding.** Use exactly
   these levels, and never upgrade a finding without new evidence:
   - **Observed fact** — directly seen in UI, log, capture, or provider
     output, with the evidence reference attached.
   - **Provider-reported** — what Ghidra/Hopper/IDA output says, quoted as
     provider output, not as ground truth (pseudocode ≠ original source).
   - **Hypothesis** — an inference from observed/provider-reported facts,
     labelled as such, with the test that would confirm or refute it.
   - **Unverified** — claimed by secondary sources, memory, or analogy;
     must not enter specs, estimates, or code comments as fact.
5. **Reconstruction as clean-room implementation.** Rebuild behaviour from
   the documented + observed specification in the project's own code and
   stack. Do **not** paste decompiled pseudocode, strings, or assets from
   the target into the product; do not reproduce protected code/assets.
   Where a behaviour is ambiguous, prefer the observable-behaviour
   specification over the decompiled guess, and test against the licensed
   copy's observable behaviour (input → output), not against its internals.
6. **Independent verification.** A second pass re-runs the key provider
   queries and black-box tests; discrepancies are recorded as open
   questions, not smoothed over. Decompilation incompleteness is assumed,
   per REA's own disclaimer.
7. **Stop conditions.** Stop immediately if: authorisation is withdrawn or
   found not to cover the operation; the work drifts toward licence-check /
   DRM circumvention, credential/access-control bypass, or copying
   protected code/assets; a provider licence turns out invalid; or the
   target turns out to be a different binary than the G3 baseline (re-hash
   and re-baseline before continuing).

### Phase 2 deliverables (to be produced then, not now)

- `docs/rea-phase2-baseline.md` — G0–G3 record (hashes, versions, licences).
- `docs/rea-evidence/<question>/` — per-question evidence bundles + command log.
- `docs/rea-findings.md` — findings table with confidence labels (§4 step 4)
  and an explicit observed-fact vs hypothesis split; no finding without an
  evidence reference.
- A spec diff: what changed in the download-manager spec because of
  evidence, vs what remains hypothesis/unverified.

---

## 5. Verified facts vs unverified / not-checked items

### Verified from the primary sources fetched above

- REA is `morluto/rea`: an MIT-licensed MCP server + CLI bridging AI agents
  to established RE tools; it is not itself a decompiler.
- Native providers named by the README: Hopper, Ghidra, IDA; plus Kuna,
  JEB (via MCP), objdump/Rizin (offline, caller-supplied, not installed by
  REA), JADX (Android), Binwalk/Unblob (firmware).
- Ghidra requirements and Windows P0 scope/read-only status as in §1.
- Hopper: commercial, demo limits, setup-installable only on supported
  macOS/Linux hosts, **not installable by setup on Windows**; setup never
  installs Ghidra/Java/Python.
- Node.js 22.x (>=22.19) / 24.x (>=24.11) / 26+ + npm; setup command
  `npx rea-agents setup` with review-and-approve flow and backups;
  `rea doctor --json` diagnostics.
- Analysis runs locally; agent model provider has its own data policy.
- Lawful-use scope and prohibited uses per DISCLAIMER.md, including the ban
  on copying proprietary software / reproducing protected code and assets,
  and the rule that possession of a file does not by itself establish
  permission.
- Decompilation/reconstruction may be incomplete or incorrect; evidence
  and limitations accompany conclusions.

### Unverified / explicitly NOT established here

- **REA version number.** Secondary coverage cited conflicting versions
  (6.5.0, 6.7.0) and the fetched README text did not expose a version
  string; no version is claimed. Check `rea --version` / the npm page in
  Phase 2.
- **Star/fork counts.** The fetched repo page showed 356,180 stars /
  89,439 forks at fetch time; Wikipedia's snapshot showed a 6.7.0 release
  dated 2026-10-18. Both are volatile snapshots, not project facts, and are
  not relied on for any decision.
- **IDA, Kuna, JEB details.** Named in the README/installation doc, but
  their dedicated guides were not opened; versions, host support, licence
  mechanics and exact capabilities for a PE target are unverified.
- **Windows Ghidra P0 current scope.** The installation doc describes it as
  experimental with the scope in §1; the dedicated Windows Ghidra P0 guide
  was not opened, so its current verified scope/limitations must be
  re-checked in Phase 2.
- **Anything about IDM itself.** No IDM binary, version, behaviour,
  architecture, or internals were observed. No IDM claim appears in this
  document. IDM-specific facts (feature behaviour, protocols, file formats)
  must come from public documentation and lawful black-box observation in
  Phase 2, not from this validation.
- **This VM's readiness.** REA, Node.js, Ghidra, Hopper, IDA and JDK
  presence/versions on any host were **not** checked in this pass (no
  install, no `rea doctor`, no local tool inventory), because the task was
  documentation validation and no target environment had been decided.
- **Live-website state.** Only fetched page text was used; the live
  `rea.tools` guides, npm page, and any interactive content were not
  visited or verified.

---

## 6. Recommendation for Phase 1 close-out

1. **Accept REA as a candidate tool, not as a result.** The docs support
   using REA (with Ghidra as the default free provider) for evidence-based
   investigation — if and when Phase 2 gates G0–G3 pass.
2. **Do not run setup yet.** Wait for the Phase 2 environment decision
   (Windows host vs Linux static host, provider choice), then start with
   `rea setup --dry-run` and `rea doctor --json`, reviewed before any
   approval.
3. **Keep the IDM work specification-led until then.** Specs, UI, and
   architecture for the download manager should cite public documentation
   and original design decisions only; mark anything that would need binary
   evidence as **Unverified / Phase 2** rather than filling it by analogy
   to IDM.
4. **Gate reminder.** If written authorisation for a specific IDM binary
   never arrives, Phase 2 binary analysis stays closed and the project
   proceeds on public docs + black-box observation of a lawfully licensed
   copy + original implementation only.
