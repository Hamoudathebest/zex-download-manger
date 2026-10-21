#!/usr/bin/env python3
"""
FFmpeg merge command builder for Phase 1 of the Internet Download Manager.

Given user-selected video + audio (+ subtitle) inputs, build an ffmpeg
command that muxes them WITHOUT re-encoding where possible (``-c copy``),
so merging is fast and lossless. Subtitles are the one exception, and
only when the target container requires it (see below).

Scope / hard constraints:
  * This module builds commands; it does NOT run them by default.
    ``--execute`` exists only as an explicit opt-in for local files the
    user already owns / is authorized to use, and it still never
    re-encodes except for the documented subtitle case.
  * No DRM handling, no credential/cookie extraction, no network access.
  * If ffmpeg is not found, commands are still returned but labelled
    TEMPLATE (not executed, not verified against a real binary).
  * Subtitle rule: MP4 containers require mov_text; copying WebVTT
    verbatim into MP4 is not valid, so for .mp4 the subtitle stream is
    converted (``-c:s mov_text``) while video/audio stay ``-c copy``.
    For .mkv, ``-c:s copy`` is valid and is used. For .webm, subtitles
    are omitted with a warning (WebM subtitle support is limited) unless
    the caller explicitly asks to keep them, in which case the command
    still uses copy and the user is warned to verify playback.
  * Output extension decides the container; unknown extensions default
    to Matroska (.mkv) behaviour with a warning.

Usage as a library:
    from ffmpeg_builder import build_merge_command, detect_ffmpeg
    cmd, notes = build_merge_command(
        video="video.mp4", audio="audio.m4a",
        subtitles="subs.vtt", output="merged.mkv")

Usage as a CLI:
    python3 ffmpeg_builder.py --video video.mp4 --audio audio.m4a \\
        --subtitle subs.vtt --output merged.mkv
    python3 ffmpeg_builder.py --video video.mp4 --output video_only.mp4 --check
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class MergeResult:
    command: list[str]
    notes: list[str] = field(default_factory=list)
    ffmpeg_found: bool = False
    ffmpeg_path: str | None = None
    template_only: bool = False  # True when ffmpeg was NOT found

    def shell(self) -> str:
        """Single-line shell rendering (for display / copy-paste only)."""
        import shlex
        return " ".join(shlex.quote(a) for a in self.command)

    def label(self) -> str:
        return "TEMPLATE (ffmpeg not found — not executed)" if self.template_only \
            else "READY (ffmpeg detected — command built, not yet executed)"


def detect_ffmpeg() -> str | None:
    """Return the ffmpeg executable path, or None if not on PATH."""
    return shutil.which("ffmpeg")


def _subtitle_codec_for(output: str, notes: list[str]) -> str | None:
    ext = Path(output).suffix.lower()
    if ext == ".mp4":
        notes.append(
            "subtitle: MP4 requires mov_text — subtitle stream converted "
            "with -c:s mov_text; video/audio remain -c copy (no re-encode)"
        )
        return "mov_text"
    if ext == ".mkv":
        notes.append("subtitle: MKV supports -c:s copy (no conversion)")
        return "copy"
    if ext == ".webm":
        notes.append(
            "subtitle: WebM subtitle support is limited — subtitle stream "
            "included with -c:s copy; verify playback in your player, or "
            "omit --subtitle for a video+audio-only WebM"
        )
        return "copy"
    notes.append(
        f"subtitle: unknown container {ext!r} — treating as Matroska-like, "
        "using -c:s copy; verify the result plays before keeping it"
    )
    return "copy"


def build_merge_command(
    video: str | None,
    audio: str | None = None,
    subtitles: str | None = None,
    output: str = "merged.mkv",
    *,
    overwrite: bool = True,
    extra_args: list[str] | None = None,
) -> MergeResult:
    """Build (do not run) an ffmpeg mux command.

    At least one of video/audio is required. Inputs are placed in
    stream order video, audio, subtitles so -map indices are stable:
    0:v, 1:a (if audio), 2:s (if subtitles, or 1:s if audio absent).
    """
    if not video and not audio:
        raise ValueError("at least one of video or audio is required")
    if not output:
        raise ValueError("output path is required")

    notes: list[str] = []
    ffmpeg_path = detect_ffmpeg()
    found = ffmpeg_path is not None
    if not found:
        notes.append(
            "ffmpeg not found on PATH — command below is a TEMPLATE only. "
            "Install ffmpeg, then re-run with --check to verify it."
        )

    cmd: list[str] = [ffmpeg_path or "ffmpeg"]
    cmd.append("-y" if overwrite else "-n")
    inputs: list[str] = []
    if video:
        inputs.append(video)
    if audio:
        inputs.append(audio)
    if subtitles:
        inputs.append(subtitles)
    for inp in inputs:
        cmd += ["-i", inp]

    # -map: map every stream we were given, in input order.
    idx = 0
    if video:
        cmd += ["-map", f"{idx}:v"]
        idx += 1
    if audio:
        cmd += ["-map", f"{idx}:a"]
        idx += 1
    if subtitles:
        cmd += ["-map", f"{idx}:s"]

    cmd += ["-c", "copy"]  # video + audio: never re-encoded
    if subtitles:
        sub_codec = _subtitle_codec_for(output, notes)
        cmd += ["-c:s", sub_codec]
    # Fast-start for MP4 so playback can begin before full download of
    # the merged file; harmless no-op for other containers (flag is
    # only added for .mp4).
    if Path(output).suffix.lower() == ".mp4":
        cmd += ["-movflags", "+faststart"]
    cmd += list(extra_args or [])
    cmd.append(output)

    notes.append(
        "no re-encoding: video/audio use -c copy (lossless mux). "
        "Re-encoding would require an explicit, separate user choice "
        "and is out of scope for this builder."
    )
    return MergeResult(
        command=cmd, notes=notes,
        ffmpeg_found=found, ffmpeg_path=ffmpeg_path,
        template_only=not found,
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Build an ffmpeg mux command (no re-encode).")
    ap.add_argument("--video", help="video input file")
    ap.add_argument("--audio", help="audio input file")
    ap.add_argument("--subtitle", help="subtitle input file (.vtt/.srt)")
    ap.add_argument("--output", help="output file (.mkv/.mp4/.webm; required unless --check)")
    ap.add_argument("--no-overwrite", action="store_true", help="use -n instead of -y")
    ap.add_argument("--check", action="store_true",
                    help="only report whether ffmpeg was detected")
    ap.add_argument("--execute", action="store_true",
                    help="actually run the command (opt-in; local files only)")
    args = ap.parse_args(argv)

    if args.check:
        path = detect_ffmpeg()
        print(f"ffmpeg: {path if path else 'NOT FOUND on PATH'}")
        return 0 if path else 1
    if not args.output:
        ap.error("--output is required unless --check is given")

    try:
        result = build_merge_command(
            args.video, args.audio, args.subtitle, args.output,
            overwrite=not args.no_overwrite)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    print(f"# {result.label()}")
    for note in result.notes:
        print(f"# note: {note}")
    print(result.shell())

    if args.execute:
        if result.template_only:
            print("error: refusing --execute: ffmpeg not found", file=sys.stderr)
            return 1
        print("# executing (explicit --execute opt-in)…", file=sys.stderr)
        proc = subprocess.run(result.command)
        return proc.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
