#!/usr/bin/env python3
"""Real (non-simulated) tests for parser.py + ffmpeg_builder.py.

Run from media/:  python3 tests/run_tests.py
Exits non-zero on the first failed assertion. Prints real parser output
so tests/output.txt is evidence, not a mock.
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from parser import parse_file, parse_text  # noqa: E402
from ffmpeg_builder import build_merge_command, detect_ffmpeg  # noqa: E402

passed = []


def check(name, cond, detail=""):
    assert cond, f"FAIL: {name} {detail}"
    passed.append(name)
    print(f"PASS: {name}")


def main():
    # --- HLS master ---
    hls = parse_file(ROOT / "fixtures" / "sample_master.m3u8")
    print(json.dumps(hls.to_dict(), indent=2))
    check("hls kind", hls.source_kind == "hls")
    check("hls 4 variants (3 video + 1 audio-only)", len(hls.variants) == 4, str(len(hls.variants)))
    check("hls sorted ascending by bandwidth",
          [v.bandwidth_bps for v in hls.variants] == [128000, 800000, 2500000, 6000000])
    v1080 = hls.variants[-1]
    check("hls 1080p dims", (v1080.width, v1080.height) == (1920, 1080))
    check("hls 1080p codecs split", v1080.video_codec == "avc1.640028" and v1080.audio_codec == "mp4a.40.2")
    check("hls audio-only flagged", hls.variants[0].is_audio_only is True)
    check("hls 2 audio groups/tracks", len(hls.audio_tracks) == 2)
    check("hls audio en default", hls.audio_tracks[0].default is True and hls.audio_tracks[0].language == "en")
    check("hls 2 subtitle tracks", len(hls.subtitle_tracks) == 2)
    check("hls subtitle format webvtt", all(t.format == "webvtt" for t in hls.subtitle_tracks))
    check("hls not drm", hls.drm_protected is False)

    # --- DASH ---
    dash = parse_file(ROOT / "fixtures" / "sample.mpd")
    print(json.dumps(dash.to_dict(), indent=2))
    check("dash kind", dash.source_kind == "dash")
    check("dash 3 video variants", len(dash.variants) == 3)
    check("dash sorted ascending", [v.bandwidth_bps for v in dash.variants] == [800000, 2500000, 6000000])
    check("dash 720p mime", dash.variants[1].mime_type == "video/mp4")
    check("dash 2 audio tracks (en+fr)", len(dash.audio_tracks) == 2
          and {t.language for t in dash.audio_tracks} == {"en", "fr"})
    check("dash 2 subtitle tracks", len(dash.subtitle_tracks) == 2)
    check("dash not drm", dash.drm_protected is False)

    # --- DRM edge case: reported, never decrypted ---
    drm = parse_file(ROOT / "fixtures" / "sample_drm.m3u8")
    check("drm flagged", drm.drm_protected is True)
    check("drm warning present", any("KEY" in w for w in drm.warnings))

    # --- Error handling ---
    try:
        parse_text("not a manifest", source="bad")
        check("bad input rejected", False)
    except ValueError:
        check("bad input rejected", True)

    # --- ffmpeg builder (build only, no execution) ---
    r = build_merge_command("video.mp4", "audio.m4a", "subs.vtt", "merged.mkv")
    print("MKV:", r.shell())
    check("mkv uses -c copy + -c:s copy",
          "-c" in r.command and "copy" in r.command and r.command[r.command.index("-c:s") + 1] == "copy")
    r2 = build_merge_command("video.mp4", "audio.m4a", "subs.vtt", "merged.mp4")
    print("MP4:", r2.shell())
    check("mp4 subtitles use mov_text", r2.command[r2.command.index("-c:s") + 1] == "mov_text")
    check("mp4 has faststart", "+faststart" in r2.command)
    r3 = build_merge_command(None, "audio.m4a", None, "audio_only.mkv")
    check("audio-only allowed", "-map" in r3.command and "0:a" in r3.command)
    ff = detect_ffmpeg()
    print(f"ffmpeg detected: {ff}")
    check("ffmpeg detection runs (bool result)", isinstance(ff, (str, type(None))))

    # --- CLI smoke test (real subprocess) ---
    proc = subprocess.run([sys.executable, str(ROOT / "parser.py"),
                           str(ROOT / "fixtures" / "sample_master.m3u8")],
                          capture_output=True, text=True, check=True)
    cli = json.loads(proc.stdout)
    check("cli json variant count", len(cli["variants"]) == 4)

    print(f"\nALL {len(passed)} CHECKS PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
