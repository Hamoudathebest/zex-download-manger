#!/usr/bin/env python3
"""Protocol-level tests for the Rust Native Messaging executable.

These tests do not need a browser or start any downloads. They send exact
Chrome Native Messaging frames to the real binary and verify its replies.
"""

import json
import os
import subprocess
import unittest


HOST_BIN = os.environ.get(
    "DM_NATIVE_HOST_BIN",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "target", "release", "dm-native-host"),
)
if os.name == "nt" and not HOST_BIN.lower().endswith(".exe"):
    HOST_BIN += ".exe"


def frame(message):
    payload = json.dumps(message, separators=(",", ":")).encode("utf-8")
    return len(payload).to_bytes(4, "little") + payload


def decode_frames(data):
    messages = []
    offset = 0
    while offset < len(data):
        if len(data) - offset < 4:
            raise AssertionError("truncated response frame prefix")
        length = int.from_bytes(data[offset : offset + 4], "little")
        offset += 4
        payload = data[offset : offset + length]
        if len(payload) != length:
            raise AssertionError("truncated response payload")
        offset += length
        messages.append(json.loads(payload.decode("utf-8")))
    return messages


class NativeHostTests(unittest.TestCase):
    def test_ping_and_invalid_request_reply_with_framed_json(self):
        self.assertTrue(os.path.isfile(HOST_BIN), f"native host binary missing: {HOST_BIN}")
        result = subprocess.run(
            [HOST_BIN],
            input=frame({"type": "ping"}) + frame({"type": "download_request", "url": "file:///secret"}),
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = decode_frames(result.stdout)
        self.assertEqual(len(replies), 2)
        self.assertEqual(replies[0]["type"], "pong")
        self.assertTrue(replies[0]["hostVersion"])
        self.assertEqual(replies[1]["type"], "download_error")
        self.assertIn("http(s)", replies[1]["error"])

    def test_malformed_json_gets_protocol_error_without_crashing(self):
        payload = b"not-json"
        result = subprocess.run(
            [HOST_BIN],
            input=len(payload).to_bytes(4, "little") + payload,
            capture_output=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        replies = decode_frames(result.stdout)
        self.assertEqual(len(replies), 1)
        self.assertEqual(replies[0]["type"], "download_error")


if __name__ == "__main__":
    unittest.main(verbosity=2)
