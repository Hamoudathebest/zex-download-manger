# Architecture

The canonical architecture document is [`docs/architecture.md`](docs/architecture.md). This root-level entry is provided for repository tooling and directs contributors to the detailed design, API contracts, decisions, security boundaries and open questions maintained there.

Current code is an in-progress desktop product: a standalone Rust CLI and Native Messaging host in `engine/`, Chromium/Firefox extension sources in `extension/`, static HLS/DASH parsing and FFmpeg command construction in `media/`, and a React/Tauri desktop application under `ui/`. The Tauri UI starts real CLI downloads, stores observed state locally, and shares persisted jobs with the Native Messaging host. Linux unit/protocol/UI tests pass. The Windows Tauri build, NSIS install/start smoke test, Chromium registry pairing, and end-to-end browser handoff are pending a Windows Actions run. See [`AUDIT.md`](AUDIT.md) for scope and [`TEST_REPORT.md`](TEST_REPORT.md) for current evidence.
