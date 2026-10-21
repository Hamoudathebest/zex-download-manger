"""Local Range-capable HTTP test server (stdlib only).

Endpoints (all served from one deterministic fixture file on disk):
  /file.bin      -- Range-capable: HEAD/GET, Accept-Ranges: bytes,
                    206 Partial Content with Content-Range, 416 on
                    unsatisfiable ranges.
  /no-range.bin  -- Deliberately Range-IGNORING: always 200 + full body,
                    no Accept-Ranges header, even if Range is requested.
  anything else  -- 404.

No DRM circumvention, no external network: binds 127.0.0.1 only.
Used by test_downloads.py. Run standalone to smoke-test:
    python3 test_server.py   # serves the fixture dir, prints the port
"""
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")


class RangeRequestHandler(BaseHTTPRequestHandler):
    # Set by make_server(): absolute path of the fixture file.
    fixture_path = ""
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):  # keep test output clean
        pass

    def _is_no_range(self, path):
        return path == "/no-range.bin"

    def _send_file_head(self, path, is_head):
        """Return (status, headers, body_range_or_None). Handles Range."""
        size = os.path.getsize(self.fixture_path)
        no_range = self._is_no_range(path)
        range_hdr = self.headers.get("Range")

        if no_range or not range_hdr:
            # Full body. No Accept-Ranges on the no-range endpoint.
            self.send_response(200)
            self.send_header("Content-Type", "application/octet-stream")
            self.send_header("Content-Length", str(size))
            if not no_range:
                self.send_header("Accept-Ranges", "bytes")
            self.end_headers()
            return (200, size, (0, size - 1) if size else (0, 0))

        m = RANGE_RE.match(range_hdr.strip())
        if not m:
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return (400, size, None)
        start_s, end_s = m.groups()
        if start_s == "" and end_s == "":
            self.send_response(400)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return (400, size, None)
        if start_s == "":
            # suffix: last N bytes
            suffix = int(end_s)
            start = max(0, size - suffix)
            end = size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s != "" else size - 1
        if start >= size or end < start or start < 0:
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return (416, size, None)
        end = min(end, size - 1)
        length = end - start + 1
        self.send_response(206)
        self.send_header("Content-Type", "application/octet-stream")
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.end_headers()
        return (206, size, (start, end))

    def _send_body(self, byte_range):
        if byte_range is None:
            return
        start, end = byte_range
        try:
            with open(self.fixture_path, "rb") as f:
                f.seek(start)
                remaining = end - start + 1
                while remaining > 0:
                    chunk = f.read(min(65536, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            # Client went away mid-body (e.g. error-path test). Not a
            # server failure; swallow so test output stays clean.
            pass

    def do_HEAD(self):
        path = urlparse(self.path).path
        if path not in ("/file.bin", "/no-range.bin"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        self._send_file_head(path, is_head=True)

    def do_GET(self):
        path = urlparse(self.path).path
        if path not in ("/file.bin", "/no-range.bin"):
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        _, _, byte_range = self._send_file_head(path, is_head=False)
        self._send_body(byte_range)


def make_server(fixture_path, host="127.0.0.1", port=0):
    """Return (server, thread, base_url). Caller must call server.shutdown()."""
    handler = type(
        "BoundHandler",
        (RangeRequestHandler,),
        {"fixture_path": fixture_path},
    )
    server = ThreadingHTTPServer((host, port), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    actual_port = server.server_address[1]
    return server, thread, f"http://{host}:{actual_port}"
