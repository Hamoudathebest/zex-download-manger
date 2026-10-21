#!/usr/bin/env python3
"""
Prototype manifest parser for Phase 1 of the Internet Download Manager project.

Parses, with Python 3.12 standard library only:
  * HLS master playlists (.m3u8) — RFC 8216: variant streams
    (BANDWIDTH / RESOLUTION / CODECS / FRAME-RATE / AUDIO / SUBTITLES),
    audio groups and subtitle groups (#EXT-X-MEDIA).
  * DASH manifests (.mpd) — ISO/IEC 23009-1: Period / AdaptationSet /
    Representation (bandwidth, width, height, mimeType, codecs, lang).

Output: a normalized variant list (see ``normalized_schema`` below), so the
downloader UI and the FFmpeg merge builder in ffmpeg_builder.py can treat
HLS and DASH identically.

Scope / hard constraints (do not extend without a new task):
  * Publicly accessible, user-authorized manifests only.
  * No DRM handling: encrypted / DRM-protected entries are reported as
    ``drm_protected: true`` and are NOT decrypted, unlocked, or downloaded.
    (HLS: #EXT-X-KEY present, or DASH ContentProtection present.)
  * No credential, cookie, password, or token extraction of any kind.
  * No network fetching in this module: callers pass text / file paths.
    Fetching, if added later, must be the user's own authorized request
    and must respect the source site's terms of service.
  * Fixtures in fixtures/ are synthetic, authored for this project, and
    are not copied from any real service.

Usage:
    python3 parser.py fixtures/sample_master.m3u8
    python3 parser.py fixtures/sample.mpd
    python3 parser.py fixtures/sample_master.m3u8 fixtures/sample.mpd --pretty
    python3 parser.py --help

Exit codes: 0 = parsed (even if the manifest contains zero usable variants,
which is reported explicitly); 2 = usage / file error; 1 = parse error.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass, field
from pathlib import Path
from urllib.parse import urljoin

__version__ = "0.1.0"

# ---------------------------------------------------------------------------
# Normalized schema
# ---------------------------------------------------------------------------
# {
#   "source_kind": "hls" | "dash",
#   "source": "<path or label supplied by caller>",
#   "drm_protected": bool,          # any DRM/encryption marker found
#   "variants": [ { ... } ],         # video (or video+audio) renditions
#   "audio_tracks": [ { ... } ],     # standalone / grouped audio renditions
#   "subtitle_tracks": [ { ... } ],  # standalone / grouped subtitle renditions
#   "warnings": [str, ...]
# }
# Variant fields: index, uri, bandwidth_bps, bandwidth_kbps, resolution,
#   width, height, frame_rate, codecs, video_codec, audio_codec,
#   audio_group, subtitle_group, mime_type, is_audio_only
# Audio track fields: group_id, name, language, uri, default, autoselect,
#   channels, bandwidth_bps
# Subtitle track fields: group_id, name, language, uri, default,
#   autoselect, format ("webvtt" inferred from .vtt, else "unknown")
# DASH representations map onto the same fields; AdaptationSet-level
# mimeType/lang are inherited by their Representations.


@dataclass
class Variant:
    index: int
    uri: str | None
    bandwidth_bps: int | None = None
    resolution: str | None = None
    width: int | None = None
    height: int | None = None
    frame_rate: float | None = None
    codecs: str | None = None
    video_codec: str | None = None
    audio_codec: str | None = None
    audio_group: str | None = None
    subtitle_group: str | None = None
    mime_type: str | None = None
    is_audio_only: bool = False

    @property
    def bandwidth_kbps(self) -> int | None:
        return self.bandwidth_bps // 1000 if self.bandwidth_bps else None

    def to_dict(self) -> dict:
        d = asdict(self)
        d["bandwidth_kbps"] = self.bandwidth_kbps
        return d


@dataclass
class MediaTrack:
    kind: str  # "audio" | "subtitle"
    group_id: str | None
    name: str | None
    language: str | None
    uri: str | None
    default: bool = False
    autoselect: bool = False
    channels: str | None = None
    bandwidth_bps: int | None = None
    format: str | None = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Manifest:
    source_kind: str
    source: str
    variants: list[Variant] = field(default_factory=list)
    audio_tracks: list[MediaTrack] = field(default_factory=list)
    subtitle_tracks: list[MediaTrack] = field(default_factory=list)
    drm_protected: bool = False
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "source_kind": self.source_kind,
            "source": self.source,
            "drm_protected": self.drm_protected,
            "variants": [v.to_dict() for v in self.variants],
            "audio_tracks": [t.to_dict() for t in self.audio_tracks],
            "subtitle_tracks": [t.to_dict() for t in self.subtitle_tracks],
            "warnings": self.warnings,
        }


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

_ATTR_RE = re.compile(r'([A-Z0-9_-]+)=("[^"]*"|[^,]*)')


def _parse_attr_list(text: str) -> dict[str, str]:
    """Parse a comma-separated KEY=VALUE list, honouring quoted strings."""
    out: dict[str, str] = {}
    for m in _ATTR_RE.finditer(text):
        value = m.group(2)
        if value.startswith('"') and value.endswith('"'):
            value = value[1:-1]
        out[m.group(1)] = value
    return out


def _parse_resolution(text: str | None) -> tuple[int | None, int | None]:
    if not text or "x" not in text:
        return None, None
    try:
        w, h = text.lower().split("x", 1)
        return int(w), int(h)
    except ValueError:
        return None, None


def _split_codecs(codecs: str | None) -> tuple[str | None, str | None]:
    """Best-effort split of a CODECS list into video / audio codec.

    Video codec prefixes (RFC 6381 / common practice): avc1, avc3, hev1,
    hvc1, vp09, vp08, av01. Audio: mp4a, ac-3, ec-3, opus, vorbis, mp3.
    Anything unrecognised is kept verbatim in ``codecs`` and left
    unclassified rather than guessed.
    """
    if not codecs:
        return None, None
    video, audio = None, None
    for part in [c.strip() for c in codecs.split(",") if c.strip()]:
        head = part.split(".")[0].lower()
        if head in ("avc1", "avc3", "hev1", "hvc1", "vp09", "vp08", "av01", "mp4v"):
            video = video or part
        elif head in ("mp4a", "ac-3", "ec-3", "opus", "vorbis", "mp3", "flac"):
            audio = audio or part
    return video, audio


def _yes(value: str | None) -> bool:
    return (value or "").strip().upper() == "YES"


def _resolve(base: str | None, uri: str | None) -> str | None:
    if uri is None:
        return None
    if base and not uri.startswith(("http://", "https://", "/")):
        return urljoin(base, uri)
    return uri


# ---------------------------------------------------------------------------
# HLS (.m3u8)
# ---------------------------------------------------------------------------

def parse_hls(text: str, source: str = "<hls>", base_url: str | None = None) -> Manifest:
    """Parse an HLS playlist. Master playlists yield variants; a media
    playlist (no #EXT-X-STREAM-INF) yields a single variant so callers
    can still present / download it, flagged in warnings."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    if not lines or lines[0] != "#EXTM3U":
        raise ValueError("not an HLS playlist: first line is not #EXTM3U")

    manifest = Manifest(source_kind="hls", source=source)
    pending: dict[str, str] | None = None  # STREAM-INF attrs awaiting its URI
    saw_stream_inf = False

    for line in lines[1:]:
        if line.startswith("#EXT-X-STREAM-INF:"):
            pending = _parse_attr_list(line[len("#EXT-X-STREAM-INF:"):])
            saw_stream_inf = True
            continue
        if line.startswith("#EXT-X-MEDIA:"):
            attrs = _parse_attr_list(line[len("#EXT-X-MEDIA:"):])
            mtype = attrs.get("TYPE", "").upper()
            track = MediaTrack(
                kind="audio" if mtype == "AUDIO" else "subtitle",
                group_id=attrs.get("GROUP-ID"),
                name=attrs.get("NAME"),
                language=attrs.get("LANGUAGE"),
                uri=_resolve(base_url, attrs.get("URI")),
                default=_yes(attrs.get("DEFAULT")),
                autoselect=_yes(attrs.get("AUTOSELECT")),
                channels=attrs.get("CHANNELS"),
                format="webvtt" if (attrs.get("URI") or "").endswith(".vtt") else None,
            )
            if mtype == "AUDIO":
                manifest.audio_tracks.append(track)
            elif mtype == "SUBTITLES":
                manifest.subtitle_tracks.append(track)
            else:
                manifest.warnings.append(
                    f"ignored #EXT-X-MEDIA with unsupported TYPE={mtype!r}"
                )
            continue
        if line.startswith("#EXT-X-KEY:"):
            # Encryption marker: report, never attempt to use the key.
            manifest.drm_protected = True
            manifest.warnings.append(
                "encrypted segment (#EXT-X-KEY) present: DRM/protected "
                "content is reported only and is not decrypted or downloaded"
            )
            continue
        if line.startswith("#"):
            continue  # Other tags (VERSION, TARGETDURATION, etc.): not needed.
        # A bare URI line.
        if pending is not None:
            bw = pending.get("BANDWIDTH")
            width, height = _parse_resolution(pending.get("RESOLUTION"))
            codecs = pending.get("CODECS")
            video_codec, audio_codec = _split_codecs(codecs)
            try:
                frame_rate = float(pending["FRAME-RATE"]) if pending.get("FRAME-RATE") else None
            except ValueError:
                frame_rate = None
            try:
                bw_int = int(bw) if bw else None
            except ValueError:
                bw_int = None
            manifest.variants.append(Variant(
                index=len(manifest.variants),
                uri=_resolve(base_url, line),
                bandwidth_bps=bw_int,
                resolution=pending.get("RESOLUTION"),
                width=width, height=height,
                frame_rate=frame_rate,
                codecs=codecs,
                video_codec=video_codec, audio_codec=audio_codec,
                audio_group=pending.get("AUDIO"),
                subtitle_group=pending.get("SUBTITLES"),
                is_audio_only=bool(video_codec is None and audio_codec),
            ))
            pending = None
        elif not saw_stream_inf:
            # Media playlist: the URI lines are segments, not variants.
            # Recorded as one variant only if this is the whole file's
            # purpose; callers normally pass master playlists. We do NOT
            # enumerate segments here — segment handling belongs to the
            # downloader, not the variant parser.
            manifest.warnings.append(
                "media playlist (no #EXT-X-STREAM-INF): segment URIs are "
                "not enumerated as variants; pass a master playlist for "
                "variant selection"
            )
            break

    if pending is not None:
        manifest.warnings.append("trailing #EXT-X-STREAM-INF with no URI line ignored")
    if saw_stream_inf and not manifest.variants:
        manifest.warnings.append("master playlist contained no usable variant URIs")
    manifest.variants.sort(key=lambda v: (v.bandwidth_bps is None, v.bandwidth_bps or 0))
    for i, v in enumerate(manifest.variants):
        v.index = i
    return manifest


# ---------------------------------------------------------------------------
# DASH (.mpd)
# ---------------------------------------------------------------------------

def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_dash(text: str, source: str = "<dash>", base_url: str | None = None) -> Manifest:
    """Parse a DASH MPD. Namespace-agnostic (tags matched by local name)."""
    try:
        root = ET.fromstring(text)
    except ET.ParseError as exc:
        raise ValueError(f"invalid DASH XML: {exc}") from exc
    if _local(root.tag) != "MPD":
        raise ValueError("not a DASH manifest: root element is not MPD")

    manifest = Manifest(source_kind="dash", source=source)

    def find_children(elem: ET.Element, name: str) -> list[ET.Element]:
        return [c for c in list(elem) if _local(c.tag) == name]

    def find_first(elem: ET.Element, name: str) -> ET.Element | None:
        kids = find_children(elem, name)
        return kids[0] if kids else None

    periods = find_children(root, "Period") or [root]
    for period in periods:
        for adap in find_children(period, "AdaptationSet"):
            if find_first(adap, "ContentProtection") is not None:
                manifest.drm_protected = True
                manifest.warnings.append(
                    "ContentProtection present in an AdaptationSet: "
                    "DRM/protected content is reported only and is not "
                    "decrypted or downloaded"
                )
            adap_mime = adap.get("mimeType")
            adap_lang = adap.get("lang")
            adap_content = (adap.get("contentType") or "").lower()
            base = find_first(adap, "BaseURL")
            adap_base = base.text.strip() if base is not None and base.text else None

            for rep in find_children(adap, "Representation"):
                if find_first(rep, "ContentProtection") is not None:
                    manifest.drm_protected = True
                mime = rep.get("mimeType") or adap_mime
                content = (rep.get("contentType") or adap_content).lower()
                is_video = mime is not None and mime.startswith("video/")
                is_audio = mime is not None and mime.startswith("audio/")
                is_text = mime is not None and mime.startswith("text/") or content == "text"
                codecs = rep.get("codecs")
                video_codec, audio_codec = _split_codecs(codecs)
                try:
                    bw = int(rep.get("bandwidth")) if rep.get("bandwidth") else None
                except ValueError:
                    bw = None
                width = int(rep.get("width")) if rep.get("width") else None
                height = int(rep.get("height")) if rep.get("height") else None
                try:
                    fr = float(rep.get("frameRate")) if rep.get("frameRate") else None
                except ValueError:
                    fr = None
                rep_base_el = find_first(rep, "BaseURL")
                rep_base = rep_base_el.text.strip() if rep_base_el is not None and rep_base_el.text else None
                uri = _resolve(base_url, rep_base or adap_base)

                if is_text:
                    manifest.subtitle_tracks.append(MediaTrack(
                        kind="subtitle",
                        group_id=adap.get("id"),
                        name=rep.get("id"),
                        language=adap_lang or rep.get("lang"),
                        uri=uri,
                        format="webvtt" if (uri or "").endswith(".vtt") else None,
                    ))
                elif is_audio:
                    manifest.audio_tracks.append(MediaTrack(
                        kind="audio",
                        group_id=adap.get("id"),
                        name=rep.get("id"),
                        language=adap_lang or rep.get("lang"),
                        uri=uri,
                        bandwidth_bps=bw,
                        channels=rep.get("audioSamplingRate"),
                    ))
                elif is_video or not mime:
                    # Video representations are variants; an AdaptationSet
                    # with no mimeType is treated as video only if it has
                    # width/height, otherwise warned and skipped.
                    if not mime and width is None and height is None:
                        manifest.warnings.append(
                            f"skipped Representation id={rep.get('id')!r} "
                            "with no mimeType and no dimensions"
                        )
                        continue
                    manifest.variants.append(Variant(
                        index=len(manifest.variants),
                        uri=uri,
                        bandwidth_bps=bw,
                        resolution=f"{width}x{height}" if width and height else None,
                        width=width, height=height,
                        frame_rate=fr,
                        codecs=codecs,
                        video_codec=video_codec, audio_codec=audio_codec,
                        mime_type=mime,
                    ))
                else:
                    manifest.warnings.append(
                        f"skipped Representation id={rep.get('id')!r} "
                        f"with unhandled mimeType={mime!r}"
                    )

    manifest.variants.sort(key=lambda v: (v.bandwidth_bps is None, v.bandwidth_bps or 0))
    for i, v in enumerate(manifest.variants):
        v.index = i
    if not manifest.variants and not manifest.audio_tracks:
        manifest.warnings.append("MPD contained no usable video/audio Representations")
    return manifest


# ---------------------------------------------------------------------------
# Dispatch + CLI
# ---------------------------------------------------------------------------

def parse_text(text: str, source: str = "<input>", base_url: str | None = None) -> Manifest:
    stripped = text.lstrip()
    if stripped.startswith("#EXTM3U"):
        return parse_hls(text, source=source, base_url=base_url)
    if stripped.startswith("<") or stripped.startswith("<?xml"):
        return parse_dash(text, source=source, base_url=base_url)
    raise ValueError("unrecognised manifest: expected #EXTM3U or an MPD document")


def parse_file(path: str | Path) -> Manifest:
    p = Path(path)
    if not p.exists():
        raise FileNotFoundError(f"manifest file not found: {p}")
    text = p.read_text(encoding="utf-8")
    # Relative URIs in fixtures resolve against the file's directory name
    # only when a base is meaningful; keep source as the path for clarity.
    return parse_text(text, source=str(p))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(
        description="Parse HLS (.m3u8) / DASH (.mpd) manifests into a "
                    "normalized variant list (JSON on stdout).")
    ap.add_argument("files", nargs="+", help="manifest file(s) to parse")
    ap.add_argument("--pretty", action="store_true", help="indent JSON output")
    ap.add_argument("--version", action="store_true", help="print version")
    args = ap.parse_args(argv)
    if args.version:
        print(__version__)
        return 0
    results = []
    for f in args.files:
        try:
            results.append(parse_file(f).to_dict())
        except (FileNotFoundError, ValueError) as exc:
            print(f"error: {exc}", file=sys.stderr)
            return 2 if isinstance(exc, FileNotFoundError) else 1
    out = results[0] if len(results) == 1 else results
    print(json.dumps(out, indent=2 if args.pretty else None, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
