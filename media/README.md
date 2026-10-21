# Download Manager — Media (Phase 1)

Prototype media layer: manifest parsing, user-choice-first selection,
and no-re-encode FFmpeg muxing. Pure Python 3.12 standard library;
no third-party dependencies, no network access in the parser.

## Files

| File | Purpose |
|---|---|
| `parser.py` | HLS `.m3u8` master + DASH `.mpd` → normalized variant list (JSON). CLI: `python3 parser.py fixtures/sample_master.m3u8` |
| `ffmpeg_builder.py` | Build (not run, by default) an ffmpeg mux command: video + audio + subtitle, `-c copy` except MP4 subtitles (`mov_text`). CLI: `python3 ffmpeg_builder.py --video v.mp4 --audio a.m4a --output merged.mkv` |
| `SPEC.md` | Selection spec: user-choice-first, separate audio/video, subtitle discovery/export, DRM rule |
| `playlist-handling.md` | How playlists/collections are enumerated and queued (user-authorized, public items only) |
| `yt-dlp-evaluation.md` | yt-dlp as an optional, opt-in backend only — license, limits, ToS caveats, recommendation |
| `fixtures/` | Synthetic, project-authored test manifests (not copied from any service) |
| `tests/` | Test script + real run output (see `tests/run_tests.py`, `tests/output.txt`) |

## Quick start

```bash
cd ~/workspace/download-manager/media
python3 parser.py fixtures/sample_master.m3u8 --pretty
python3 parser.py fixtures/sample.mpd --pretty
python3 ffmpeg_builder.py --check
python3 ffmpeg_builder.py --video video.mp4 --audio audio.m4a --subtitle subs.vtt --output merged.mkv
python3 tests/run_tests.py
```

## Hard constraints (non-negotiable)

- No DRM circumvention, decryption, or key handling — protected items
  are reported (`drm_protected: true`) and skipped.
- No unauthorized access; no extraction of browser cookies,
  passwords, or tokens.
- No re-encoding of video/audio by default; subtitle conversion only
  where the target container requires it (MP4 → `mov_text`).
- No simulated metrics: the test output in `tests/output.txt` is the
  real output of running the parser on the fixtures.
