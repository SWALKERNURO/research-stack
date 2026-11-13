"""Download pinned scanners, verify publisher checksums, execute selected binaries."""

import hashlib
import http.client
import io
import os
import platform
import socket
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def download(url):
    """Retry transient GET failures; return only a complete response body."""
    for attempt in range(3):
        try:
            with urllib.request.urlopen(url, timeout=60) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            exc.close()
            if exc.code not in {408, 500, 502, 503, 504} or attempt == 2:
                raise
        except urllib.error.URLError as exc:
            transient = isinstance(exc.reason, (TimeoutError, ConnectionError)) or (
                isinstance(exc.reason, socket.gaierror) and exc.reason.errno == socket.EAI_AGAIN
            )
            if not transient or attempt == 2:
                raise
        except (TimeoutError, ConnectionError, http.client.IncompleteRead):
            if attempt == 2:
                raise
        time.sleep(2**attempt)


def run_tool(name, repo, version, args):
    system = (
        "windows" if os.name == "nt" else "darwin" if platform.system() == "Darwin" else "linux"
    )
    arch = (
        "arm64"
        if platform.machine().lower() in ("arm64", "aarch64")
        else "x64"
        if name == "gitleaks"
        else "amd64"
    )
    extension = "zip" if system == "windows" else "tar.gz"
    filename = f"{name}_{version}_{system}_{arch}.{extension}"
    base = f"https://github.com/{repo}/releases/download/v{version}"
    checksums = download(f"{base}/{name}_{version}_checksums.txt").decode()
    expected = next(
        line.split()[0] for line in checksums.splitlines() if line.split()[-1] == filename
    )
    data = download(f"{base}/{filename}")
    if hashlib.sha256(data).hexdigest() != expected:
        raise RuntimeError("Scanner checksum mismatch")
    with tempfile.TemporaryDirectory(prefix="nrs-scanner-") as folder:
        binary_name = name + (".exe" if os.name == "nt" else "")
        if extension == "zip":
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                binary = archive.read(binary_name)
        else:
            with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
                member = archive.extractfile(binary_name)
                if member is None:
                    raise RuntimeError("Scanner executable absent")
                binary = member.read()
        path = Path(folder) / binary_name
        path.write_bytes(binary)
        path.chmod(0o700)
        subprocess.run([str(path), *args], cwd=ROOT, check=True)


if __name__ == "__main__":
    run_tool(
        "gitleaks",
        "gitleaks/gitleaks",
        "8.30.1",
        [
            "git",
            "--redact",
            "--no-banner",
            "--report-format",
            "json",
            "--report-path",
            "gitleaks.json",
        ],
    )
    run_tool("actionlint", "rhysd/actionlint", "1.7.12", ["-color"])
