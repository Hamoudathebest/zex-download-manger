# yt-dlp Evaluation — Optional Backend Only

Status: **evaluation only**. yt-dlp is NOT bundled, NOT a default, and
NOT used by `parser.py` or `ffmpeg_builder.py` in this prototype, which
are pure Python-3.12-stdlib. This document records what yt-dlp could
and could not do if a later phase opts into it.

## 1. License

- yt-dlp is free software under the **Unlicense** (public domain
  dedication; see https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE).
  That license permits reuse, but it does **not** override any
  third-party site's terms of service, copyright law, or DRM law.
- If yt-dlp were ever bundled, its license notice and version must be
  shipped with it, and the bundling must be reviewed against the
  project's own licensing at that time. This prototype ships no yt-dlp
  code and no yt-dlp binary.

## 2. What it can do (as an optional backend)

- Parse manifests and extract direct media URLs for many public sites,
  including HLS/DASH variant enumeration comparable to `parser.py`,
  plus format selection (`-f`) and subtitle listing (`--list-subs`).
- Download and, via ffmpeg, mux separate video/audio tracks — the same
  no-re-encode muxing `ffmpeg_builder.py` documents, which yt-dlp
  already delegates to ffmpeg.
- Handle playlists supplied explicitly by the user (`--playlist-items`,
  `--no-playlist` discipline), matching the per-item, user-confirmed
  model in `playlist-handling.md`.

## 3. What it cannot / must not do here

- **No DRM circumvention.** yt-dlp does not (and must not be made to)
  decrypt DRM-protected streams. DRM items stay skipped, exactly as in
  `SPEC.md` §2 rule 7. Any plugin, fork, or option that claims to
  bypass DRM is out of scope and must not be used.
- **No unauthorized access.** It must not be used with stolen,
  borrowed, or extracted cookies, credentials, or tokens, and not
  against private, paywalled, or sign-in-gated content. The hard
  constraints of this project (no cookie/password/token extraction)
  apply to yt-dlp use exactly as they apply to our own code.
- **No ToS override.** A site's terms of service may prohibit
  downloading even public content. yt-dlp's technical ability to fetch
  a URL is not permission. Each site's rules must be checked before
  enabling it, and a site that prohibits downloading must stay disabled.
- **No guarantee of stability.** Sites change layouts and APIs;
  yt-dlp extractors break, and breakage is the site's / yt-dlp's
  maintenance burden, not something this project should paper over
  with scraping workarounds.
- **Not a substitute for the parser.** The normalized variant list
  (`parser.py`) remains the project's own selection layer: even if
  yt-dlp were enabled, its output should be mapped through the same
  user-choice-first selection rules, not allowed to auto-pick formats.

## 4. Site-rules / ToS caveats (check per site, before enabling)

- Read the target site's current terms and robots/usage policy; terms
  change and this document does not summarize any specific site.
- Respect rate limits; do not hammer a site with parallel playlist
  expansion.
- Only the user's own content, public-domain content, or content the
  user has a right to download may be queued — "publicly accessible"
  alone is not sufficient if the site's terms or the content's license
  forbid downloading.
- When in doubt, the item is skipped and the reason is logged.

## 5. Recommendation

> **Optional, opt-in, not default, not for DRM/protected content.**

- Default backend: this project's own `parser.py` + `ffmpeg_builder.py`
  (stdlib only, no third-party downloader).
- yt-dlp, if adopted in a later phase, should be: (a) an explicit
  user opt-in per site, (b) invoked only for user-supplied, public,
  non-DRM items, (c) constrained to the same selection and queue rules
  as the native path, and (d) never bundled with DRM-bypass plugins or
  credential-extraction features.
- Re-evaluate this recommendation before any bundling decision, and
  re-check yt-dlp's license and the relevant sites' terms at that time.
