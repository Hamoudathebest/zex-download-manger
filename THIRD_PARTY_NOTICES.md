# Third-party notices

This project is licensed under the MIT licence (see `LICENSE`).
The components below are used under their own licences. Nothing in
this file changes the licence of the project's own code.

Licences below were verified from the installed copies on the build
machine: the Cargo registry sources for Rust crates
(`~/.cargo/registry/src/...`) and the `LICENSE` files inside
`ui/node_modules/` for Node packages. Transitive dependencies are
not listed individually here; their licences are as declared in
`engine/Cargo.lock` and `ui/package-lock.json` respectively, and a
full audit of transitive licences is an open task (see the note at
the bottom).

## Rust — direct dependencies (`engine/Cargo.toml` and `ui/src-tauri/Cargo.toml`)

| Crate | Version used in Phase 1 | Licence (verified) |
| --- | --- | --- |
| tokio | 1.54.0 (Cargo.toml: `1`) | MIT |
| reqwest | 0.12.28 (Cargo.toml: `0.12`, rustls-tls, stream) | MIT OR Apache-2.0 |
| serde | 1.0.229 (Cargo.toml: `1`, derive) | MIT OR Apache-2.0 |
| serde_json | 1.0.154 (Cargo.toml: `1`) | MIT OR Apache-2.0 |
| sha2 | 0.10.9 (Cargo.toml: `0.10`) | MIT OR Apache-2.0 |
| ctrlc | 3.5.2 (Cargo.toml: `3`) | MIT OR Apache-2.0 |
| futures-util | 0.3.34 (Cargo.toml: `0.3`) | MIT OR Apache-2.0 |
| fs2 | 0.4.3 (Cargo.toml: `0.4`) | MIT OR Apache-2.0 |
| tauri | 2.12.5 (Cargo.toml: `2`) | Apache-2.0 OR MIT |
| tauri-build | 2.7.4 (Cargo.toml: `2`) | Apache-2.0 OR MIT |
| url | 2.5.8 (Cargo.toml: `2`) | MIT OR Apache-2.0 |
| winreg | 0.55.0 (Windows-only; Cargo.toml: `0.55`) | MIT |

## Node — direct dependencies (`ui/package.json`)

| Package | Version used in Phase 1 | Licence (verified) |
| --- | --- | --- |
| react | ^19.3.1 | MIT |
| react-dom | ^19.3.1 | MIT |
| vite | ^8.3.4 | MIT |
| tailwindcss | ^4.3.3 | MIT |
| @tailwindcss/vite | ^4.3.3 | MIT |
| typescript | ~6.0.3 | Apache-2.0 |
| @types/node | ^24.19.2 | MIT |
| @types/react | ^19.3.0 | MIT |
| @types/react-dom | ^19.3.0 | MIT |
| @vitejs/plugin-react | ^6.1.2 | MIT |
| oxlint | ^1.88.0 | MIT |
| @tauri-apps/api | ^2 | Apache-2.0 OR MIT |
| @tauri-apps/cli | ^2 | Apache-2.0 OR MIT |

## Not bundled

- **yt-dlp** is evaluation-only (see `media/yt-dlp-evaluation.md`).
  It is not bundled, not vendored, and not a dependency of any
  build. If it is ever integrated, its licence and the applicable
  website rules must be reviewed first, and it must not be used for
  DRM-protected or otherwise access-controlled content.
- **FFmpeg** is not bundled. The media subsystem builds FFmpeg
  command lines for a FFmpeg the user already has; it does not
  distribute FFmpeg binaries.
- **GitHub Actions actions** used in workflows (`actions/checkout`,
  `actions/setup-node`, `actions/setup-python`,
  `dtolnay/rust-toolchain`, `actions/upload-artifact`,
  `actions/download-artifact`, `softprops/action-gh-release`) are
  used under their own licences, as published in their repositories.
  Their versions are pinned in the workflow files; check there for
  the exact pins.

## Unverified / open

- Transitive (indirect) dependency licences have **not** been
  individually audited. Before a `v1.0.0` release, run a licence
  audit over `engine/Cargo.lock` and `ui/package-lock.json` and
  record the result here.
- No dependency in the direct lists above is known to be
  incompatible with MIT distribution of this project, but that
  statement is limited to the direct dependencies verified above;
  it is not a full legal review.
