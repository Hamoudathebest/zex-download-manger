"""QA suite for Phase 1 download-manager (server-behaviour harness).

Run:  python3 -m unittest -v test_downloads
      (from engine/tests/)  -- or:  python3 run_tests.py  (same dir)

IMPORTANT SCOPE NOTE: the engine prototype does not exist yet
(engine/ was empty on 2026-10-21), so these tests run against a LOCAL
Range-capable server (test_server.py) with urllib/curl as the client.
They prove transfer mechanics and server behaviour. Engine-integration
tests are PENDING until the engine lands; nothing here is simulated --
every assertion below executes a real HTTP transfer against the local
server and checks real bytes / real SHA-256 digests.

Covered: (1) single, (2) multi-part, (3) interrupted/resumed,
(4) no-Range fallback, (5) invalid URL, (6) integrity mismatch,
(7) checkpoint persistence (queue persistence = PARTIAL, see test 07).
"""
import hashlib
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from downloader import (  # noqa: E402
    download_multipart,
    download_range,
    download_single,
    download_with_resume,
    read_checkpoint,
    sha256_of,
    verify_sha256,
    write_checkpoint,
)
from test_server import make_server  # noqa: E402

# Deterministic fixture: 5 MiB, seeded PRNG so every run has the same
# bytes and the same SHA-256 (recorded in qa/TEST_RESULTS.md).
FIXTURE_SIZE = 5 * 1024 * 1024
FIXTURE_SEED = 42


def make_fixture(path):
    rng = random.Random(FIXTURE_SEED)
    with open(path, "wb") as f:
        remaining = FIXTURE_SIZE
        while remaining > 0:
            n = min(65536, remaining)
            f.write(rng.randbytes(n))
            remaining -= n
    return sha256_of(path)


class DownloadTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dm-qa-")
        cls.fixture = os.path.join(cls.tmp, "fixture.bin")
        cls.expected_sha = make_fixture(cls.fixture)
        cls.expected_size = FIXTURE_SIZE
        cls.server, cls.thread, cls.base = make_server(cls.fixture)
        cls.file_url = cls.base + "/file.bin"
        cls.no_range_url = cls.base + "/no-range.bin"
        print(f"\n[fixture] size={cls.expected_size} sha256={cls.expected_sha}")
        print(f"[server]  base={cls.base}")

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _out(self, name):
        return os.path.join(self.tmp, name)

    # (1) single file download
    def test_01_single_file_download(self):
        t0 = time.monotonic()
        dest = self._out("single.bin")
        size, digest = download_single(self.file_url, dest)
        dt = time.monotonic() - t0
        print(f"[01] size={size} sha256={digest} time={dt:.3f}s")
        self.assertEqual(size, self.expected_size)
        self.assertEqual(digest, self.expected_sha)

    # (2) multi-part download (4 parallel ranges)
    def test_02_multipart_download_4_parts(self):
        t0 = time.monotonic()
        dest = self._out("multi.bin")
        size, digest = download_multipart(self.file_url, dest, self.expected_size, parts=4)
        dt = time.monotonic() - t0
        print(f"[02] parts=4 size={size} sha256={digest} time={dt:.3f}s")
        self.assertEqual(size, self.expected_size)
        self.assertEqual(digest, self.expected_sha)

    # (3) interrupted / resumed transfer
    def test_03_interrupted_resumed_transfer(self):
        dest = self._out("resumed.bin")
        # "Interrupt": fetch only the first 1 MiB, then stop (partial file).
        first = 1024 * 1024
        n, status = download_range(self.file_url, dest, 0, first - 1)
        self.assertEqual(status, 206)
        self.assertEqual(n, first)
        self.assertEqual(os.path.getsize(dest), first)
        print(f"[03] interrupted at partial_size={first} (status={status})")
        # Resume from the partial file.
        t0 = time.monotonic()
        total, digest, resumed = download_with_resume(self.file_url, dest)
        dt = time.monotonic() - t0
        print(f"[03] resumed={resumed} final_size={total} sha256={digest} time={dt:.3f}s")
        self.assertTrue(resumed)
        self.assertEqual(total, self.expected_size)
        self.assertEqual(digest, self.expected_sha)

    # (4) no-Range fallback: server ignores Range, client must restart full
    def test_04_no_range_fallback(self):
        # Prove the server really ignores Range first (real 200, full body).
        req = urllib.request.Request(self.no_range_url, headers={"Range": "bytes=0-99"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            self.assertEqual(resp.status, 200)
            body = resp.read()
        self.assertEqual(len(body), self.expected_size)
        print(f"[04] no-range server: Range request -> status=200 full_len={len(body)}")
        # Client-side fallback: partial file + resume attempt -> full re-download.
        dest = self._out("norange.bin")
        with open(dest, "wb") as f:
            f.write(b"\x00" * 1024)  # fake partial
        total, digest, resumed = download_with_resume(self.no_range_url, dest)
        print(f"[04] fallback resumed_flag={resumed} final_size={total} sha256={digest}")
        self.assertFalse(resumed)  # fell back, did not do a 206 resume
        self.assertEqual(total, self.expected_size)
        self.assertEqual(digest, self.expected_sha)

    # (5) invalid URL handling
    def test_05_invalid_url(self):
        # 5a: malformed / unknown-scheme URL -> urllib raises URLError
        # (verified: 'unknown url type: ht!tp'; ValueError is NOT raised
        # for this input on Python 3.12, so the test asserts the real
        # behaviour rather than an assumed exception type).
        with self.assertRaises(urllib.error.URLError):
            urllib.request.urlopen("ht!tp://::bad", timeout=10)
        print("[05a] malformed URL -> URLError raised (unknown url type)")
        # 5b: connection refused (closed port on localhost; no external net)
        with self.assertRaises(urllib.error.URLError):
            urllib.request.urlopen("http://127.0.0.1:1/file.bin", timeout=10)
        print("[05b] connection refused (127.0.0.1:1) -> URLError raised")
        # 5c: HTTP 404 from the local server
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(self.base + "/does-not-exist.bin", timeout=10)
        self.assertEqual(cm.exception.code, 404)
        print("[05c] missing path -> HTTPError 404")

    # (6) integrity mismatch: wrong expected SHA-256 must be DETECTED
    def test_06_integrity_mismatch_detected(self):
        dest = self._out("integrity.bin")
        size, digest = download_single(self.file_url, dest)
        self.assertEqual(size, self.expected_size)
        wrong = "0" * 64  # deliberately wrong expected digest
        match, actual = verify_sha256(dest, wrong)
        print(f"[06] expected(wrong)={wrong}")
        print(f"[06] actual          ={actual} match={match}")
        self.assertFalse(match)
        # And the correct digest must verify, proving the check itself works.
        match_ok, _ = verify_sha256(dest, self.expected_sha)
        self.assertTrue(match_ok)

    # (7) checkpoint persistence -- queue persistence is PARTIAL here.
    # No engine queue file format exists (engine was empty), so this
    # tests the harness checkpoint format + resume-from-checkpoint.
    # Engine queue persistence: NOT-IMPLEMENTED / pending engine.
    def test_07_checkpoint_persistence(self):
        dest = self._out("checkpoint.bin")
        first = 1024 * 1024
        n, _ = download_range(self.file_url, dest, 0, first - 1)
        self.assertEqual(n, first)
        ckpt = self._out("download.json")
        data = write_checkpoint(
            ckpt, self.file_url, dest, self.expected_size, first,
            [{"start": 0, "end": first - 1, "done": True},
             {"start": first, "end": self.expected_size - 1, "done": False}],
            expected=self.expected_sha,
        )
        print(f"[07] checkpoint written: downloaded={data['downloaded']}/{data['total_size']}")
        # Simulate a restart: reload checkpoint from disk, resume.
        loaded = read_checkpoint(ckpt)
        self.assertEqual(loaded["downloaded"], first)
        self.assertEqual(loaded["total_size"], self.expected_size)
        self.assertEqual(loaded["expected_sha256"], self.expected_sha)
        total, digest, resumed = download_with_resume(loaded["url"], loaded["dest"])
        print(f"[07] reloaded+resumed={resumed} final_size={total} sha256={digest}")
        self.assertTrue(resumed)
        self.assertEqual(total, self.expected_size)
        self.assertEqual(digest, self.expected_sha)
        print("[07] NOTE: engine queue persistence NOT-IMPLEMENTED "
              "(no engine queue format exists); checkpoint persistence only.")

    # Extra: Range contract of the local server (206 / Content-Range / 416)
    def test_08_range_headers_contract(self):
        req = urllib.request.Request(self.file_url, headers={"Range": "bytes=10-19"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            self.assertEqual(resp.status, 206)
            self.assertEqual(resp.headers.get("Content-Range"),
                             f"bytes 10-19/{self.expected_size}")
            self.assertEqual(len(resp.read()), 10)
        print("[08] Range bytes=10-19 -> 206 Content-Range bytes 10-19/"
              f"{self.expected_size} len=10")
        req = urllib.request.Request(
            self.file_url, headers={"Range": f"bytes={self.expected_size}-"})
        with self.assertRaises(urllib.error.HTTPError) as cm:
            urllib.request.urlopen(req, timeout=30)
        self.assertEqual(cm.exception.code, 416)
        print(f"[08] out-of-range request -> 416 (size={self.expected_size})")

    # Extra: curl as the download client (single file + resume flag path)
    def test_09_curl_single_download(self):
        if shutil.which("curl") is None:
            self.skipTest("curl not installed")
        dest = self._out("curl.bin")
        t0 = time.monotonic()
        r = subprocess.run(
            ["curl", "-sS", "-o", dest, self.file_url],
            capture_output=True, text=True, timeout=60)
        dt = time.monotonic() - t0
        self.assertEqual(r.returncode, 0, r.stderr)
        size = os.path.getsize(dest)
        digest = sha256_of(dest)
        print(f"[09] curl size={size} sha256={digest} time={dt:.3f}s rc=0")
        self.assertEqual(size, self.expected_size)
        self.assertEqual(digest, self.expected_sha)


if __name__ == "__main__":
    unittest.main(verbosity=2)
