# GitHub push access — diagnosis

Status (2026-10-22 VPS check): **public read access works; write access is
not authenticated or verified.** The current CLI reports no logged-in
GitHub account. Repository permissions and branch protection could not
be inspected anonymously. This is the present blocker; the prior
connector diagnosis below is historical evidence and was not
independently revalidated from this VPS.

To enable a push, authenticate on the VPS with `gh auth login` using an
account authorized to write to this exact repository, then verify the
identity with `gh auth status`. Do not send a token or private key in
chat. After authorization, check branch protection and test write access
using a temporary branch before publishing project changes.

## Current VPS evidence

| Item | Verified value |
| --- | --- |
| Repository | `Hamoudathebest/zex-download-manger` |
| Visibility/read | Public; anonymous `git ls-remote` and HTTPS clone succeeded |
| GitHub CLI | `gh 2.97.0`; `gh auth status` says not logged in |
| Remote write permissions | **Unknown** — no authenticated identity |
| Branch protection / Actions release permissions | **Unknown** — not available to anonymous reads |
| Push attempt from this VPS | None; a credential-free push test would not establish authorized access |

## Prior connector report (2026-10-21; historical, not revalidated here)

The following evidence was recorded by a prior connector workflow. It is
retained as context, not treated as proof of current account or app
permissions:

| Item | Verified value |
| --- | --- |
| Repository | `Hamoudathebest/zex-download-manger` (spelling as created) |
| Visibility | Public (`private: false`) |
| Created | 2026-10-21 |
| Default branch | `main` |
| Head commit before any push attempt | `274dae07d6a9975e62a2964a6366f4cd4cd778d3` — "Initial commit", README only |
| Connected GitHub identity (Muse connector) | `ahmed700tu7` — **not** `Hamoudathebest` |
| Read access | Confirmed: repository search, `list_commits`, and `get_file_contents` for `README.md` all succeed. This proves nothing about write access: the repository is public, so reads succeed for anyone. |
| Push attempt 1 | 2026-10-21 ~21:00 CET, 80 text files to `main` via the connector snapshot-push route. Failed at tree creation. |
| Push attempt 2 | 2026-10-21 ~21:12 CET, same manifest, after the user reported the install step as done. Same failure. |
| Error (both attempts) | `POST https://api.github.com/repos/Hamoudathebest/zex-download-manger/git/trees` → **403 "Resource not accessible by integration"** |
| Files actually pushed | None. A failed tree creation creates no commit, no branch, and no files. The remote head is still the initial commit until a push succeeds. |
| Push manifest (prepared, not pushed) | 80 text files, 675,789 bytes — see `~/workspace/download-manager-paths.txt` on the build machine. Build artefacts and PNG icons are excluded from that route (see below). |

## Exact cause

GitHub Apps do not inherit the connected user's personal permissions.
An app can write to a repository only when:

1. the app is **installed on the account or organisation that owns the
   repository** — here, `Hamoudathebest`, and
2. that installation **selects this repository** — either "All
   repositories" or "Only select repositories" including
   `zex-download-manger`.

A 403 "Resource not accessible by integration" at tree creation means
at least one of those two conditions is missing. The most likely
explanation here is that the installation was made on the
`ahmed700tu7` account, or on `Hamoudathebest` without this repository
selected. Installing on the wrong account, or clicking through the
install page without selecting the repository, leaves write access
exactly where it was: absent.

This is not a temporary error and not a rate limit. Retrying the
identical push on a timer would just repeat the identical 403, so no
automated retry loop is scheduled. The push is retried once, manually,
after the installation is corrected.

## The exact fix the user must take

1. Log into GitHub as **`Hamoudathebest`** — not as `ahmed700tu7`.
   If the browser is logged into the other account, switch accounts
   first; installing while logged in as the wrong account is the
   failure mode above.
2. Open the Muse GitHub App installation page (the "Select
   repositories" link supplied in chat).
3. When GitHub asks which account to install on, choose
   **`Hamoudathebest`**.
4. Under repository access, choose either **All repositories**, or
   **Only select repositories** and tick **`zex-download-manger`**.
5. Save.
6. Reply **DONE** in this chat. The main agent will then retry the
   push once and verify the new head commit and the presence of
   `.github/workflows/windows-build.yml` on `main` before reporting
   success.

## Workflow permissions note

CI permissions are separate from app-installation permissions and do
not fix this blocker:

- The build workflow (`.github/workflows/windows-build.yml`) uses
  `permissions: contents: read`. It only needs to check out code.
- The release workflow (`.github/workflows/release.yml`) uses
  `permissions: contents: write`, because creating a GitHub Release
  and uploading artefacts requires write access — but that permission
  is granted to the workflow's own `GITHUB_TOKEN` at run time, inside
  GitHub Actions, and only after the code is actually in the
  repository. It does not grant the Muse connector write access, and
  it cannot substitute for the app installation above.

## Alternative authentication — investigated and rejected

The Muse GitHub connector's snapshot-push procedure explicitly forbids
starting a separate authentication flow using `gh auth login`, device
authorisation, personal access tokens, OAuth tokens supplied in chat,
or credentials embedded in Git commands. There is therefore **no
supported personal-access-token route here**, and none is proposed.
Do not paste any token, password, cookie, or private key in chat to
work around this — that would not be used, and it would create a
security problem instead of fixing an installation problem.

The manual ZIP prepared earlier remains only a fallback for the user
to upload by hand. It is not the solution, and it does not replace the
push: the release pipeline only runs from code that is actually in
the repository.

## PNG icon note

The connector snapshot-push route accepts UTF-8 text files only, so
the four extension PNG icons (`extension/icons/icon*.png`) cannot
travel in that push. That is why `tools/generate-icons.py` exists and
why both workflows run it before packaging the extension: the icons
are regenerated inside CI from a deterministic script, so a checkout
without the PNG files still produces a complete extension package.
Until the PNGs are present in the repository (by manual upload or by
a future git-based push), do not claim the checked-out extension
loads with icons.
