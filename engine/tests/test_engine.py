#!/usr/bin/env python3
"""Engine-integration tests: drive the real Rust `dm` binary against
the local Range-capable server from test_server.py (sibling QA
harness — not modified here).

Run from engine/tests/:
    DM_BIN=../target/release/dm python3 -m unittest -v test_engine
or simply:  python3 test_engine.py

Every assertion checks real bytes / real SHA-256 digests from real
HTTP transfers on 127.0.0.1. No external network, no simulated metrics.

Cases:
  01 single-connection download
  02 multi-part (4 connections) download
  03 pause (SIGINT) + --resume to completion
  04 no-Range server fallback (4 requested -> 1 used, still correct)
  05 redirect (302, via a tiny inline redirect server)
  06 SHA-256 mismatch: destination NOT created, .part kept, exit != 0
  07 throttle: 1 MiB/s cap measurably slows a 5 MiB download
  08 resume validation: tampered checkpoint size -> refusal
  09 HTTP 404 -> non-zero exit, no destination file
  10 unknown-length (no Content-Length) single download
"""
import hashlib
import json
import os
import random
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from downloader import sha256_of  # noqa: E402  (sibling harness helper)
from test_server import make_server  # noqa: E402

FIXTURE_SIZE = 5 * 1024 * 1024
FIXTURE_SEED = 42
DM_BIN = os.environ.get(
    "DM_BIN",
    os.path.join(os.path.dirname(os.path.abspath(__file__)),
                 "..", "target", "release", "dm"),
)
if os.name == "nt" and not DM_BIN.lower().endswith(".exe"):
    DM_BIN += ".exe"


def make_fixture(path):
    rng = random.Random(FIXTURE_SEED)
    with open(path, "wb") as f:
        remaining = FIXTURE_SIZE
        while remaining > 0:
            n = min(65536, remaining)
            f.write(rng.randbytes(n))
            remaining -= n
    return sha256_of(path)


class RedirectHandler(BaseHTTPRequestHandler):
    target = ""

    def log_message(self, *args):
        pass

    def do_HEAD(self):
        self.send_response(302)
        self.send_header("Location", self.target)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        self.do_HEAD()


class UnknownHandler(BaseHTTPRequestHandler):
    fixture_path = ""
    protocol_version = "HTTP/1.0"

    def log_message(self, *args):
        pass

    def do_HEAD(self):
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()

    def do_GET(self):
        with open(self.fixture_path, "rb") as f:
            data = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/octet-stream")
        # Deliberately NO Content-Length and NO Accept-Ranges.
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            # The range probe deliberately drops this ignored-Range response.
            pass


class EngineTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp(prefix="dm-engine-")
        cls.fixture = os.path.join(cls.tmp, "fixture.bin")
        cls.expected_sha = make_fixture(cls.fixture)
        cls.server, _, cls.base = make_server(cls.fixture)
        cls.file_url = cls.base + "/file.bin"
        cls.no_range_url = cls.base + "/no-range.bin"
        print(f"\n[fixture] size={FIXTURE_SIZE} sha256={cls.expected_sha}")
        print(f"[server]  base={cls.base}")
        print(f"[dm]      bin={DM_BIN}")
        assert os.path.isfile(DM_BIN), f"dm binary missing: {DM_BIN}"

        # Inline redirect server -> file_url.
        rh = type("RH", (RedirectHandler,), {"target": cls.file_url})
        cls.redir = ThreadingHTTPServer(("127.0.0.1", 0), rh)
        threading.Thread(target=cls.redir.serve_forever, daemon=True).start()
        cls.redir_url = f"http://127.0.0.1:{cls.redir.server_address[1]}/redirect"

        # Inline unknown-length server.
        uh = type("UH", (UnknownHandler,), {"fixture_path": cls.fixture})
        cls.unk = ThreadingHTTPServer(("127.0.0.1", 0), uh)
        threading.Thread(target=cls.unk.serve_forever, daemon=True).start()
        cls.unk_url = f"http://127.0.0.1:{cls.unk.server_address[1]}/unknown.bin"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.redir.shutdown()
        cls.redir.server_close()
        cls.unk.shutdown()
        cls.unk.server_close()
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def _out(self, name):
        return os.path.join(self.tmp, name)

    def _run(self, args, timeout=120):
        r = subprocess.run([DM_BIN] + args, capture_output=True,
                           text=True, timeout=timeout)
        return r

    def test_01_single_connection(self):
        dest = self._out("single.bin")
        t0 = time.monotonic()
        r = self._run([self.file_url, dest, "--connections", "1",
                       "--sha256", self.expected_sha])
        dt = time.monotonic() - t0
        print(f"[01] rc={r.returncode} time={dt:.3f}s out={r.stdout.strip()}")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(os.path.getsize(dest), FIXTURE_SIZE)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_02_multipart_4(self):
        dest = self._out("multi.bin")
        t0 = time.monotonic()
        r = self._run([self.file_url, dest, "--connections", "4",
                       "--sha256", self.expected_sha])
        dt = time.monotonic() - t0
        print(f"[02] rc={r.returncode} time={dt:.3f}s out={r.stdout.strip()}")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(os.path.getsize(dest), FIXTURE_SIZE)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_03_pause_and_resume(self):
        dest = self._out("resumed.bin")
        part = dest + ".part"
        ckpt = dest + ".checkpoint.json"
        # Throttled so the download is still running when we interrupt.
        proc = subprocess.Popen(
            [DM_BIN, self.file_url, dest, "--connections", "4",
             "--throttle", "256k"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP
                           if os.name == "nt" else 0))
        time.sleep(2.5)
        self.assertIsNone(proc.poll(), "dm finished before SIGINT (too fast?)")
        proc.send_signal(
            signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
        _, stderr = proc.communicate(timeout=30)
        print(f"[03] pause rc={proc.returncode}")
        self.assertEqual(proc.returncode, 130, stderr)
        self.assertTrue(os.path.isfile(part), "part file missing after pause")
        self.assertTrue(os.path.isfile(ckpt), "checkpoint missing after pause")
        with open(ckpt) as f:
            data = json.load(f)
        done = sum(s["done"] for s in data["segments"])
        print(f"[03] checkpoint: done={done}/{FIXTURE_SIZE} "
              f"segments={len(data['segments'])}")
        self.assertGreater(done, 0)
        self.assertLess(done, FIXTURE_SIZE)
        # Resume unthrottled to completion.
        t0 = time.monotonic()
        r = self._run([self.file_url, dest, "--resume",
                       "--sha256", self.expected_sha])
        dt = time.monotonic() - t0
        print(f"[03] resume rc={r.returncode} time={dt:.3f}s out={r.stdout.strip()}")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(os.path.getsize(dest), FIXTURE_SIZE)
        self.assertEqual(sha256_of(dest), self.expected_sha)
        self.assertFalse(os.path.exists(part), "part file should be renamed away")
        self.assertFalse(os.path.exists(ckpt), "checkpoint should be removed")

    def test_04_no_range_fallback(self):
        dest = self._out("norange.bin")
        r = self._run([self.no_range_url, dest, "--connections", "4",
                       "--sha256", self.expected_sha])
        print(f"[04] rc={r.returncode} out={r.stdout.strip()}")
        self.assertIn("falling back to 1 connection", r.stderr)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_05_redirect(self):
        dest = self._out("redir.bin")
        r = self._run([self.redir_url, dest, "--connections", "2",
                       "--sha256", self.expected_sha])
        print(f"[05] rc={r.returncode} out={r.stdout.strip()}")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_06_sha_mismatch_blocks_destination(self):
        dest = self._out("badhash.bin")
        r = self._run([self.file_url, dest, "--connections", "2",
                       "--sha256", "0" * 64])
        print(f"[06] rc={r.returncode} err={r.stderr.strip()[-200:]}")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(dest), "dest must NOT be created")
        self.assertTrue(os.path.exists(dest + ".part"), ".part kept for inspection")

    def test_07_throttle_is_real(self):
        dest = self._out("throttled.bin")
        t0 = time.monotonic()
        r = self._run([self.file_url, dest, "--connections", "4",
                       "--throttle", "1m"])
        dt = time.monotonic() - t0
        avg = FIXTURE_SIZE / dt if dt else 0
        print(f"[07] rc={r.returncode} time={dt:.3f}s avg={avg/1048576:.2f} MiB/s")
        self.assertEqual(r.returncode, 0, r.stderr)
        # 5 MiB at a 1 MiB/s aggregate cap cannot finish in under ~4s
        # on a real token bucket (allowing generous scheduling slack).
        self.assertGreaterEqual(dt, 4.0)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_08_resume_validation_refuses_changed_size(self):
        dest = self._out("tampered.bin")
        part = dest + ".part"
        ckpt = dest + ".checkpoint.json"
        proc = subprocess.Popen(
            [DM_BIN, self.file_url, dest, "--connections", "2",
             "--throttle", "256k"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP
                           if os.name == "nt" else 0))
        time.sleep(1.5)
        proc.send_signal(
            signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
        proc.communicate(timeout=30)
        self.assertEqual(proc.returncode, 130)
        with open(ckpt) as f:
            data = json.load(f)
        data["total_size"] = FIXTURE_SIZE + 12345
        with open(ckpt, "w") as f:
            json.dump(data, f)
        r = self._run([self.file_url, dest, "--resume"])
        print(f"[08] rc={r.returncode} err={r.stderr.strip()[-220:]}")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("changed on server", r.stderr)
        # Cleanup so later tests are unaffected (fresh --restart works).
        r2 = self._run([self.file_url, dest, "--restart",
                        "--sha256", self.expected_sha])
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_09_not_found(self):
        dest = self._out("missing.bin")
        r = self._run([self.base + "/does-not-exist.bin", dest])
        print(f"[09] rc={r.returncode} err={r.stderr.strip()[-200:]}")
        self.assertNotEqual(r.returncode, 0)
        self.assertFalse(os.path.exists(dest))

    def test_10_unknown_length(self):
        dest = self._out("unknown.bin")
        r = self._run([self.unk_url, dest])
        print(f"[10] rc={r.returncode} out={r.stdout.strip()}")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(os.path.getsize(dest), FIXTURE_SIZE)
        self.assertEqual(sha256_of(dest), self.expected_sha)

    def test_11_control_file_pause_and_resume(self):
        dest = self._out("controlled-resume.bin")
        control = dest + ".control"
        proc = subprocess.Popen(
            [DM_BIN, self.file_url, dest, "--connections", "4",
             "--throttle", "256k", "--control-file", control],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP
                           if os.name == "nt" else 0))
        time.sleep(1.0)
        with open(control, "w") as f:
            f.write("pause\n")
        _, stderr = proc.communicate(timeout=30)
        self.assertEqual(proc.returncode, 130, stderr)
        self.assertTrue(os.path.isfile(dest + ".part"))
        self.assertTrue(os.path.isfile(dest + ".checkpoint.json"))
        os.remove(control)

        resumed = self._run([self.file_url, dest, "--resume", "--control-file", control,
                             "--sha256", self.expected_sha])
        self.assertEqual(resumed.returncode, 0, resumed.stderr)
        self.assertEqual(sha256_of(dest), self.expected_sha)
        self.assertFalse(os.path.exists(control))

    def test_12_control_file_cancel_removes_partial_state(self):
        dest = self._out("controlled-cancel.bin")
        control = dest + ".control"
        proc = subprocess.Popen(
            [DM_BIN, self.file_url, dest, "--connections", "4",
             "--throttle", "256k", "--control-file", control],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
            creationflags=(subprocess.CREATE_NEW_PROCESS_GROUP
                           if os.name == "nt" else 0))
        time.sleep(1.0)
        with open(control, "w") as f:
            f.write("cancel\n")
        _, stderr = proc.communicate(timeout=30)
        self.assertEqual(proc.returncode, 131, stderr)
        self.assertFalse(os.path.exists(dest))
        self.assertFalse(os.path.exists(dest + ".part"))
        self.assertFalse(os.path.exists(dest + ".checkpoint.json"))
        self.assertFalse(os.path.exists(control))


if __name__ == "__main__":
    unittest.main(verbosity=2)
