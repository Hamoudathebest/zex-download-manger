"""Minimal download harness (test client only, NOT the engine).

This exists because, at the time of writing (2026-10-21), the
download-manager engine prototype does not exist yet: engine/ was empty.
These helpers exercise *server behaviour* and *transfer mechanics* with
urllib (and curl in one test) so that when the real engine lands, the
same test cases can be re-pointed at it. Engine-integration tests are
therefore PENDING -- see qa/TEST_RESULTS.md.

Checkpoint format (harness-defined, JSON, version 1):
  {"version": 1, "url": ..., "dest": ..., "total_size": int,
   "downloaded": int, "parts": [{"start": int, "end": int,
   "done": bool}], "expected_sha256": str|null}
It is NOT an engine queue format: no engine queue file exists yet, so
queue persistence is PARTIAL / NOT-IMPLEMENTED (see test 07 notes).
"""
import hashlib
import json
import os
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def head_info(url, timeout=30):
    req = urllib.request.Request(url, method="HEAD")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return {
            "status": resp.status,
            "length": resp.headers.get("Content-Length"),
            "accept_ranges": resp.headers.get("Accept-Ranges"),
        }


def download_single(url, dest, timeout=60):
    """Full GET to dest. Returns (bytes_written, sha256)."""
    with urllib.request.urlopen(url, timeout=timeout) as resp, open(dest, "wb") as out:
        total = 0
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            out.write(chunk)
            total += len(chunk)
    return total, sha256_of(dest)


def download_range(url, dest, start, end, timeout=60):
    """GET one Range into dest (overwrites). Returns bytes written."""
    req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp, open(dest, "wb") as out:
        total = 0
        while True:
            chunk = resp.read(65536)
            if not chunk:
                break
            out.write(chunk)
            total += len(chunk)
        return total, resp.status


def download_multipart(url, dest, total_size, parts=4, timeout=60):
    """Parallel Range GETs, assembled in order. Returns (bytes, sha256)."""
    if total_size <= 0:
        raise ValueError("total_size must be > 0 for multipart")
    bounds = []
    base, rem = divmod(total_size, parts)
    cursor = 0
    for i in range(parts):
        size = base + (1 if i < rem else 0)
        bounds.append((cursor, cursor + size - 1))
        cursor += size

    def fetch(bound):
        start, end = bound
        req = urllib.request.Request(url, headers={"Range": f"bytes={start}-{end}"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status != 206:
                raise RuntimeError(f"expected 206 for range {start}-{end}, got {resp.status}")
            return resp.read()

    with ThreadPoolExecutor(max_workers=parts) as pool:
        chunks = list(pool.map(fetch, bounds))
    with open(dest, "wb") as out:
        for chunk in chunks:
            out.write(chunk)
    return os.path.getsize(dest), sha256_of(dest)


def download_with_resume(url, dest, timeout=60):
    """Resume-aware download: if dest exists, Range from its size.

    Falls back to a full download if the server ignores Range (200
    instead of 206). Returns (bytes_written_total, sha256, resumed_bool).
    """
    existing = os.path.getsize(dest) if os.path.exists(dest) else 0
    if existing == 0:
        total, digest = download_single(url, dest, timeout=timeout)
        return total, digest, False
    req = urllib.request.Request(url, headers={"Range": f"bytes={existing}-"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if resp.status == 206:
                with open(dest, "ab") as out:
                    while True:
                        chunk = resp.read(65536)
                        if not chunk:
                            break
                        out.write(chunk)
                return os.path.getsize(dest), sha256_of(dest), True
            # Server ignored Range: restart from scratch.
            total, digest = download_single(url, dest, timeout=timeout)
            return total, digest, False
    except urllib.error.HTTPError as e:
        if e.code == 416:
            # Already complete.
            return existing, sha256_of(dest), True
        raise


def verify_sha256(path, expected):
    """Return (match_bool, actual_sha256). Never raises on mismatch."""
    actual = sha256_of(path)
    return actual == expected, actual


# ---- checkpoint persistence (harness format, see module docstring) ----

def write_checkpoint(path, url, dest, total_size, downloaded, parts, expected=None):
    data = {
        "version": 1,
        "url": url,
        "dest": dest,
        "total_size": total_size,
        "downloaded": downloaded,
        "parts": parts,
        "expected_sha256": expected,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    return data


def read_checkpoint(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)
