"""Offline scanner download controls; all network calls and execution are mocked."""

import hashlib
import http.client
import io
import os
import runpy
import socket
import ssl
import subprocess
import tarfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest.mock import call, patch

ROOT = Path(__file__).resolve().parents[1]
SECURITY = runpy.run_path(str(ROOT / "scripts/security_tools.py"))
URL = "https://example.invalid/scanner"
BASE = "https://github.com/gitleaks/gitleaks/releases/download/v8.30.1"
FILENAME = (
    "gitleaks_8.30.1_windows_x64.zip" if os.name == "nt" else "gitleaks_8.30.1_linux_x64.tar.gz"
)


def http_error(code):
    return urllib.error.HTTPError(URL, code, "Synthetic failure", {}, io.BytesIO())


class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.urlopen = self.enterContext(patch("urllib.request.urlopen"))
        self.sleep = self.enterContext(patch("time.sleep"))

    def test_success_uses_timeout_without_retry(self):
        body = io.BytesIO(b"complete")
        self.urlopen.return_value = body
        self.assertEqual(SECURITY["download"](URL), b"complete")
        self.urlopen.assert_called_once_with(URL, timeout=60)
        self.sleep.assert_not_called()
        self.assertTrue(body.closed)

    def test_transient_http_errors_are_retried(self):
        for code in (408, 500, 502, 503, 504):
            with self.subTest(code=code):
                self.urlopen.reset_mock()
                self.sleep.reset_mock()
                error = http_error(code)
                self.urlopen.side_effect = [error, io.BytesIO(b"complete")]
                self.assertEqual(SECURITY["download"](URL), b"complete")
                self.assertEqual(self.urlopen.call_count, 2)
                self.sleep.assert_called_once_with(1)
                self.assertTrue(error.fp.closed)

    def test_other_http_errors_fail_immediately(self):
        for code in (400, 401, 403, 404, 429, 501):
            with self.subTest(code=code):
                self.urlopen.reset_mock()
                self.urlopen.side_effect = http_error(code)
                with self.assertRaises(urllib.error.HTTPError):
                    SECURITY["download"](URL)
                self.assertEqual(self.urlopen.call_count, 1)
        self.sleep.assert_not_called()

    def test_exhaustion_preserves_final_error_and_bounds_backoff(self):
        errors = [http_error(504) for _ in range(3)]
        self.urlopen.side_effect = errors
        with self.assertRaises(urllib.error.HTTPError) as caught:
            SECURITY["download"](URL)
        self.assertIs(caught.exception, errors[-1])
        self.assertEqual(self.urlopen.call_args_list, [call(URL, timeout=60)] * 3)
        self.assertEqual(self.sleep.call_args_list, [call(1), call(2)])
        self.assertTrue(all(error.fp.closed for error in errors))

    def test_wrapped_transient_network_errors_are_retried(self):
        for reason in (
            TimeoutError("Synthetic timeout"),
            ConnectionResetError("Synthetic reset"),
            socket.gaierror(socket.EAI_AGAIN, "Synthetic temporary DNS failure"),
        ):
            with self.subTest(reason=reason):
                self.urlopen.reset_mock()
                self.sleep.reset_mock()
                self.urlopen.side_effect = [
                    urllib.error.URLError(reason),
                    io.BytesIO(b"complete"),
                ]
                self.assertEqual(SECURITY["download"](URL), b"complete")
                self.assertEqual(self.urlopen.call_count, 2)
                self.sleep.assert_called_once_with(1)

    def test_certificate_permanent_dns_and_unknown_errors_fail_immediately(self):
        for reason in (
            ssl.SSLCertVerificationError("Synthetic invalid certificate"),
            socket.gaierror(socket.EAI_NONAME, "Synthetic missing host"),
            "Unknown failure",
        ):
            with self.subTest(reason=reason):
                self.urlopen.reset_mock()
                error = urllib.error.URLError(reason)
                self.urlopen.side_effect = error
                with self.assertRaises(urllib.error.URLError) as caught:
                    SECURITY["download"](URL)
                self.assertIs(caught.exception, error)
                self.assertEqual(self.urlopen.call_count, 1)
        self.sleep.assert_not_called()

    def test_read_failures_restart_the_entire_download(self):
        for error in (
            TimeoutError("Synthetic timeout"),
            ConnectionResetError("Synthetic reset"),
            http.client.IncompleteRead(b"partial", 100),
        ):
            with self.subTest(error=error):
                self.urlopen.reset_mock()
                self.sleep.reset_mock()
                broken = self.urlopen.return_value
                broken.__enter__.return_value.read.side_effect = error
                self.urlopen.side_effect = [broken, io.BytesIO(b"whole replacement")]
                self.assertEqual(SECURITY["download"](URL), b"whole replacement")
                self.assertEqual(self.urlopen.call_count, 2)
                self.sleep.assert_called_once_with(1)
                broken.__exit__.assert_called()

    def test_read_timeout_exhaustion_is_bounded(self):
        response = self.urlopen.return_value
        response.__enter__.return_value.read.side_effect = TimeoutError("Synthetic timeout")
        with self.assertRaises(TimeoutError):
            SECURITY["download"](URL)
        self.assertEqual(self.urlopen.call_count, 3)
        self.assertEqual(self.sleep.call_args_list, [call(1), call(2)])


class ScannerIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.urlopen = self.enterContext(patch("urllib.request.urlopen"))
        self.sleep = self.enterContext(patch("time.sleep"))
        self.execute = self.enterContext(patch("subprocess.run"))
        self.extract = self.enterContext(
            patch("zipfile.ZipFile", wraps=zipfile.ZipFile)
            if os.name == "nt"
            else patch("tarfile.open", wraps=tarfile.open)
        )
        self.enterContext(patch("platform.system", return_value="Linux"))
        self.enterContext(patch("platform.machine", return_value="x86_64"))
        output = io.BytesIO()
        if os.name == "nt":
            with zipfile.ZipFile(output, "w") as archive:
                archive.writestr("gitleaks.exe", b"synthetic executable")
        else:
            with tarfile.open(fileobj=output, mode="w:gz") as archive:
                member = tarfile.TarInfo("gitleaks")
                member.size = len(b"synthetic executable")
                archive.addfile(member, io.BytesIO(b"synthetic executable"))
        self.data = output.getvalue()
        self.checksums = f"{hashlib.sha256(self.data).hexdigest()}  {FILENAME}\n".encode()
        self.extract.reset_mock()

    def run_scanner(self):
        SECURITY["run_tool"]("gitleaks", "gitleaks/gitleaks", "8.30.1", ["git", "--redact"])

    def test_both_downloads_use_pinned_urls_before_verified_execution(self):
        self.urlopen.side_effect = [io.BytesIO(self.checksums), io.BytesIO(self.data)]

        def inspect_execution(args, **kwargs):
            self.assertEqual(Path(args[0]).read_bytes(), b"synthetic executable")
            self.assertEqual(args[1:], ["git", "--redact"])
            self.assertEqual(kwargs, {"cwd": ROOT, "check": True})

        self.execute.side_effect = inspect_execution
        self.run_scanner()
        self.assertEqual(
            self.urlopen.call_args_list,
            [
                call(f"{BASE}/gitleaks_8.30.1_checksums.txt", timeout=60),
                call(f"{BASE}/{FILENAME}", timeout=60),
            ],
        )
        self.execute.assert_called_once()

    def test_each_download_can_recover_from_504(self):
        for failed_index in (0, 1):
            with self.subTest(failed_index=failed_index):
                self.urlopen.reset_mock()
                self.execute.reset_mock()
                self.sleep.reset_mock()
                responses = [io.BytesIO(self.checksums), io.BytesIO(self.data)]
                responses.insert(failed_index, http_error(504))
                self.urlopen.side_effect = responses
                self.run_scanner()
                self.assertEqual(self.urlopen.call_count, 3)
                self.execute.assert_called_once()
                self.sleep.assert_called_once_with(1)

    def test_checksum_mismatch_blocks_extraction_and_execution_without_retry(self):
        self.urlopen.side_effect = [io.BytesIO(self.checksums), io.BytesIO(b"tampered")]
        with self.assertRaisesRegex(RuntimeError, "Scanner checksum mismatch"):
            self.run_scanner()
        self.assertEqual(self.urlopen.call_count, 2)
        self.extract.assert_not_called()
        self.execute.assert_not_called()
        self.sleep.assert_not_called()

    def test_missing_or_malformed_checksum_blocks_binary_download(self):
        for checksums in (b"", b"malformed\n", b"abc  unrelated.tar.gz\n"):
            with self.subTest(checksums=checksums):
                self.urlopen.reset_mock()
                self.urlopen.side_effect = [io.BytesIO(checksums)]
                with self.assertRaises(StopIteration):
                    self.run_scanner()
                self.assertEqual(self.urlopen.call_count, 1)
        self.extract.assert_not_called()
        self.execute.assert_not_called()
        self.sleep.assert_not_called()

    def test_exhausted_download_prevents_extraction_and_execution(self):
        self.urlopen.side_effect = [io.BytesIO(self.checksums)] + [
            http_error(504) for _ in range(3)
        ]
        with self.assertRaises(urllib.error.HTTPError):
            self.run_scanner()
        self.extract.assert_not_called()
        self.execute.assert_not_called()

    def test_scanner_failure_remains_fatal_without_retry(self):
        self.urlopen.side_effect = [io.BytesIO(self.checksums), io.BytesIO(self.data)]
        error = subprocess.CalledProcessError(1, ["synthetic-scanner"])
        self.execute.side_effect = error
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.run_scanner()
        self.assertIs(caught.exception, error)
        self.assertEqual(self.urlopen.call_count, 2)
        self.execute.assert_called_once()
        self.sleep.assert_not_called()
