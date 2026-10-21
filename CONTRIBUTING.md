# Contributing

Thanks for considering a contribution. This project is in Phase 1:
a real, working foundation — not yet a finished product — so honest,
well-tested contributions matter more than large, unverified ones.

## What this project is (and is not)

- It is an original, open-source download manager: a Rust download
  engine, a Manifest V3 browser extension, an HLS/DASH media parser,
  and a React UI prototype.
- It is **not** a copy of Internet Download Manager, and it contains
  no proprietary IDM code, no decompiled IDM code, and no
  IDM-derived assets. Do not submit any.
- It does not circumvent DRM, bypass authentication, or access
  content the user is not authorised to download. Do not submit code
  that does any of those things.
- It never extracts browser cookies, passwords, session tokens, or
  other credentials. Do not submit code that does.

## Building

```bash
# Download engine (Rust)
cd engine
cargo build --release
cargo test

# UI prototype (Node 20)
cd ui
npm ci
npm run build

# Media parser tests (Python 3.12, standard library only)
cd media
python3 tests/run_tests.py

# Engine integration tests (loopback only, no external network)
cd engine/tests
python3 test_engine.py
```

The GitHub Actions workflows in `.github/workflows/` run the same
steps on `windows-latest`. A pull request should keep those steps
green; do not weaken a workflow to make a failing change pass.

## Submitting a pull request

1. Fork the repository and create a branch from `main`.
2. Keep the change focused. One feature or fix per pull request.
3. Add or update tests for behaviour you change. If a test cannot
   run on loopback or on a Windows runner, say so in the pull
   request and explain what you ran instead.
4. Update `CHANGELOG.md` under "Unreleased".
5. Do not claim a feature works on Windows, in a live browser, or
   against a real service unless you actually ran it there. Label
   untested claims as untested.
6. Follow the existing code style: Rust with `cargo fmt` where
   applicable, TypeScript as in `ui/`, Python standard library only
   for `media/` and `tools/`.

## Secrets and privacy

- Never commit secrets, private keys, tokens, cookies, passwords, or
  personal data. The secret scan in CI review is a backstop, not a
  substitute for care.
- Never commit build artefacts: `engine/target/`, `ui/node_modules/`,
  `ui/dist/`, and `benchmarks/.bench-work/` are excluded from the
  repository for a reason.
- Report a leaked secret or a vulnerability privately first — see
  `SECURITY.md`. Do not open a public issue about it.

## Licence

By contributing, you agree that your contribution will be licensed
under the MIT licence in `LICENSE`, on the same terms as the rest of
the project. If your contribution includes third-party code, state
its origin and licence in the pull request and add it to
`THIRD_PARTY_NOTICES.md`.
