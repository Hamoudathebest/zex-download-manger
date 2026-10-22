# Architecture

The canonical architecture document is [`docs/architecture.md`](docs/architecture.md). This root-level entry is provided for repository tooling and directs contributors to the detailed design, API contracts, decisions, security boundaries and open questions maintained there.

Current code is a collection of prototypes rather than an integrated desktop product: a standalone Rust CLI in `engine/`, browser extension sources in `extension/`, static HLS/DASH parsing and FFmpeg command construction in `media/`, and a disconnected React UI prototype in `ui/`. There is currently no Tauri shell, persistent database/service API, or Native Messaging host implementation. See [`AUDIT.md`](AUDIT.md) for the verified inventory and [`TEST_REPORT.md`](TEST_REPORT.md) for actual checks.
