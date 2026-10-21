# Media Selection Spec — Phase 1

Prototype: `parser.py` (HLS `.m3u8` + DASH `.mpd` → normalized variant list)
Merge builder: `ffmpeg_builder.py` (mux without re-encoding where possible)

## 1. Normalized variant list

Both formats collapse to one JSON shape (see `parser.py` header for the
full schema):

| Field | Meaning |
|---|---|
| `source_kind` | `hls` or `dash` |
| `variants[]` | Video renditions, sorted ascending by `bandwidth_bps` (unknown bandwidth sorts last, never first) |
| `audio_tracks[]` | Standalone/grouped audio (HLS `#EXT-X-MEDIA TYPE=AUDIO`, DASH audio AdaptationSets) |
| `subtitle_tracks[]` | Standalone/grouped subtitles (HLS `TYPE=SUBTITLES`, DASH `text/*` AdaptationSets) |
| `drm_protected` | `true` if any encryption/DRM marker was seen |
| `warnings[]` | Non-fatal parse notes (skipped representations, trailing tags, …) |

Per variant: `index, uri, bandwidth_bps, bandwidth_kbps, resolution,
width, height, frame_rate, codecs, video_codec, audio_codec,
audio_group, subtitle_group, mime_type, is_audio_only`.
Per audio track: `group_id, name, language, uri, default, autoselect,
channels, bandwidth_bps`. Per subtitle track: the same, plus `format`
(`webvtt` when the URI ends in `.vtt`, else `null` — never guessed).

## 2. Selection rules — user choice first

**Principle: the user explicitly picks. No silent auto-download.**

1. **Present, don't assume.** The UI lists every parsed variant with
   resolution, bandwidth (kbps), codecs, and frame rate, plus every
   audio and subtitle track with language/name. Nothing is pre-selected
   as a download except the documented fallback in rule 3.
2. **Explicit pick wins over everything.** If the user picks a variant
   index, an audio track, and/or a subtitle track, those exact items
   are queued. A later "best quality" heuristic must never override an
   explicit pick.
3. **Fallback only when the user asks for "best"/"auto".** If — and only
   if — the user chooses an auto mode, the fallback is:
   - Video: highest `bandwidth_bps` among variants with a known
     resolution; ties broken by larger `height`, then larger `width`.
     Variants with unknown bandwidth are never chosen as "best".
   - Audio: the track with `default == true` in the chosen variant's
     audio group (HLS), else the first audio track matching the user's
     preferred language (see rule 5), else the highest-bandwidth audio
     track.
   - Subtitles: **none by default** in auto mode. Subtitles are only
     included when the user picks one (or sets a language preference
     that explicitly opts in).
4. **Separate audio/video track selection.** Video and audio are
   independent choices. A video-only variant (no embedded audio) must
   be paired with an explicitly chosen audio track, not with an assumed
   one; the UI must show "no audio selected" rather than silently
   adding the default track when the user picked video-only. When a
   variant already carries embedded audio (`audio_codec` present and
   no separate audio group), no extra audio input is added to the
   ffmpeg command unless the user explicitly adds one.
5. **Language preference is a tie-breaker, not a decision.** A stored
   language preference (e.g. `en`) may order the track lists and
   pre-highlight a matching track, but the download still waits for the
   user's confirmation. Never auto-download a language the user did
   not confirm.
6. **Audio-only is a first-class choice.** An audio-only variant or
   audio track can be downloaded on its own (no video required). The
   merge builder accepts audio-only input (`ffmpeg_builder.py` requires
   at least one of video/audio, not both).
7. **DRM / protected content is not selectable for download.**
   If `drm_protected == true`, the UI must show the item as
   "protected — not downloadable by this tool" and disable its download
   action. No decryption, key fetching, or bypass is attempted, ever.

## 3. Resolution selection

- Show the literal `resolution` string (`1920x1080`) when present;
  otherwise derive it from `width` × `height`.
- Do not invent resolutions: a variant without dimensions is listed
  as "unknown resolution" and is excluded from "best" auto-selection.
- Frame rate is display-only; it never changes the ranking except as
  a final tie-breaker (higher frame rate wins a bandwidth tie).

## 4. Audio selection

- Group first (HLS `AUDIO` group / DASH AdaptationSet id), then
  language, then name. Tracks without a language are listed under
  "unknown language", never assumed to be the user's language.
- `DEFAULT=YES` / `AUTOSELECT=YES` are hints for ordering only (see
  rule 2.3); they do not constitute user consent.
- Multiple audio tracks are **not** muxed together by default. If the
  user wants two languages, that is two separate outputs or an explicit
  multi-track request — not a silent default.

## 5. Subtitle discovery and export

- **Discovery:** subtitles come only from the manifest itself:
  HLS `#EXT-X-MEDIA TYPE=SUBTITLES` groups, or DASH `text/*`
  AdaptationSets. The parser does **not** crawl a page, guess subtitle
  URLs, or fetch sidecar files that the manifest does not reference.
- **Presentation:** list each track by language + name + format.
  A track with no URI is shown as unavailable, not queued.
- **Export options (user-chosen, one at a time):**
  1. **Mux into the output** (default when a subtitle is picked):
     `ffmpeg_builder.py` handles the container rule — `mov_text` for
     `.mp4`, `copy` for `.mkv` — while video/audio stay `-c copy`.
  2. **Sidecar file:** download the subtitle file as-is next to the
     output (e.g. `title.en.vtt`), with no conversion and no muxing.
  3. **None:** no subtitle track is queued.
- **No conversion of subtitle content** beyond the container-required
  `mov_text` muxing in option 1. No translation, no re-timing, no
  format rewriting is done by this prototype.
- Subtitles are never downloaded for a video the user did not choose
  to download.

## 6. What this spec deliberately does NOT do

- No DRM circumvention, no decryption, no key handling.
- No credential, cookie, or token extraction or use.
- No silent "best quality" download without an explicit auto-mode
  choice by the user.
- No re-encoding of video/audio (see `ffmpeg_builder.py`).
- No network fetching in `parser.py` — manifests are supplied as
  files/text by the caller. Any future fetcher must be user-authorized
  and must respect the source site's terms (see `yt-dlp-evaluation.md`).
