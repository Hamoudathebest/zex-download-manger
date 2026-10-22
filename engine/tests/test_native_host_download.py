#!/usr/bin/env python3
"""Loopback end-to-end test of Native Messaging host -> real `dm` engine."""

import hashlib
import json
import os
import random
import subprocess
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


TEST_DIR = os.path.dirname(os.path.abspath(__file__))
ENGINE_BIN = os.environ.get(
    "DM_BIN", os.path.join(TEST_DIR, "..", "target", "release", "dm")
)
HOST_BIN = os.environ.get(
    "DM_NATIVE_HOST_BIN", os.path.join(TEST_DIR, "..", "target", "release", "dm-native-host")
)
if os.name == "nt":
    if not ENGINE_BIN.lower().endswith(".exe"):
        ENGINE_BIN += ".exe"
    if not HOST_BIN.lower().endswith(".exe"):
        HOST_BIN += ".exe"


def frame(message):
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    return len(payload).to_bytes(4, "little") + payload


def unframe(payload):
    if len(payload) < 4:
        raise AssertionError("native host response omitted its frame prefix")
    length = int.from_bytes(payload[:4], "little")
    if len(payload) != length + 4:
        raise AssertionError("native host response has an invalid frame length")
    return json.loads(payload[4:].decode("utf-8"))


class FixtureHandler(BaseHTTPRequestHandler):
    body = b""

    def log_message(self, *_args):
        pass

    def _send(self, include_body):
        total = len(self.body)
        header = self.headers.get("Range")
        if header:
            left, right = header.removeprefix("bytes=").split("-", 1)
            start = int(left or 0)
            end = int(right) if right else total - 1
            end = min(end, total - 1)
            payload = self.body[start : end + 1]
            self.send_response(206)
            self.send_header("Content-Range", f"bytes {start}-{end}/{total}")
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Accept-Ranges", "bytes")
        else:
            payload = self.body
            self.send_response(200)
            self.send_header("Content-Length", str(total))
            self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Type", "application/octet-stream")
        self.end_headers()
        if include_body:
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

    def do_HEAD(self):
        self._send(False)

    def do_GET(self):
        self._send(True)


class NativeHostDownloadTests(unittest.TestCase):
    def test_user_selected_url_downloads_real_bytes_and_updates_shared_state(self):
        self.assertTrue(os.path.isfile(ENGINE_BIN), f"dm binary missing: {ENGINE_BIN}")
        self.assertTrue(os.path.isfile(HOST_BIN), f"Native Messaging host missing: {HOST_BIN}")

        rng = random.Random(9173)
        expected = bytes(rng.randrange(256) for _ in range(1024 * 1024))
        fixture = type("Fixture", (FixtureHandler,), {"body": expected})
        server = ThreadingHTTPServer(("127.0.0.1", 0), fixture)
        server.daemon_threads = True
        threading.Thread(target=server.serve_forever, daemon=True).start()

        with tempfile.TemporaryDirectory(prefix="zex-host-e2e-") as temp:
            temp_path = os.path.abspath(temp)
            environment = os.environ.copy()
            environment.update(
                {
                    "DM_ENGINE_PATH": os.path.abspath(ENGINE_BIN),
                    "HOME": temp_path,
                    "USERPROFILE": temp_path,
                    "APPDATA": os.path.join(temp_path, "Roaming"),
                    "XDG_DATA_HOME": os.path.join(temp_path, "data"),
                }
            )
            url = f"http://127.0.0.1:{server.server_address[1]}/fixture.bin"
            request = {
                "type": "download_request",
                "url": url,
                "filename": "native-host-e2e.bin",
                "pageUrl": None,
            }
            result = subprocess.run(
                [HOST_BIN], input=frame(request), capture_output=True,
                env=environment, timeout=20,
            )
            self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", "replace"))
            reply = unframe(result.stdout)
            self.assertEqual(reply["type"], "download_ack")
            self.assertTrue(reply["queued"])

            destination = os.path.join(temp_path, "Downloads", "native-host-e2e.bin")
            deadline = time.monotonic() + 30
            while time.monotonic() < deadline and not os.path.isfile(destination):
                time.sleep(0.05)
            self.assertTrue(os.path.isfile(destination), "engine child did not finish the download")
            with open(destination, "rb") as downloaded:
                self.assertEqual(hashlib.sha256(downloaded.read()).digest(), hashlib.sha256(expected).digest())

            state_dir = (
                os.path.join(temp_path, "Roaming", "com.zex.downloadmanager")
                if os.name == "nt"
                else os.path.join(temp_path, "data", "com.zex.downloadmanager")
            )
            with open(os.path.join(state_dir, "downloads.json"), encoding="utf-8") as state_file:
                records = json.load(state_file)
            self.assertEqual(len(records), 1)
            self.assertEqual(records[0]["status"], "active")
            self.assertEqual(records[0]["destination"], destination)

        server.shutdown()
        server.server_close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
