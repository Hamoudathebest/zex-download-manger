#!/usr/bin/env python3
"""Re-run helper: python3 run_tests.py  (from engine/tests/).

Runs the unittest suite verbosely and exits non-zero on any failure.
Stdlib only; no network beyond 127.0.0.1.
"""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from test_downloads import DownloadTests  # noqa: E402

if __name__ == "__main__":
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(DownloadTests)
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
