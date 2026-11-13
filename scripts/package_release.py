"""Package the current version, optional exact-commit evidence, and SHA-256 checksums."""

import argparse
import hashlib
import json
import os
import re
import subprocess
import tempfile
import tomllib
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def version_tag(root):
    version = tomllib.loads((root / "pyproject.toml").read_text(encoding="utf-8"))["project"][
        "version"
    ]
    if not re.fullmatch(r"\d+\.\d+\.\d+", version):
        raise ValueError("Release version must use major.minor.patch")
    tag = f"v{version}"
    if os.environ.get("GITHUB_REF_TYPE") == "tag" and os.environ.get("GITHUB_REF_NAME") != tag:
        raise ValueError("Git tag does not match the package version")
    return version, tag


def version_changed(root, before):
    current, _ = version_tag(root)
    if before and set(before) == {"0"}:
        return True
    previous = subprocess.check_output(
        ["git", "show", f"{before}:pyproject.toml"], cwd=root, text=True
    )
    return current != tomllib.loads(previous)["project"]["version"]


def archive_folder(source, destination, relative_to):
    with zipfile.ZipFile(destination, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, path.relative_to(relative_to))


def validation_archive(root, output, tag):
    proof_path = output / "final-verification.json"
    proof = json.loads(proof_path.read_text(encoding="utf-8"))
    sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=root, text=True).strip()
    if proof["commit"] != sha or proof["repository"] != os.environ["GITHUB_REPOSITORY"]:
        raise ValueError("Validation evidence does not match this repository and commit")
    if set(proof["workflows"]) != {"CI", "Security", "Reproducibility"}:
        raise ValueError("Validation evidence is incomplete")
    with tempfile.TemporaryDirectory(prefix="nrs-release-evidence-") as folder:
        evidence = Path(folder)
        (evidence / proof_path.name).write_bytes(proof_path.read_bytes())
        for name, run in proof["workflows"].items():
            if run["head_sha"] != sha or run["conclusion"] != "success":
                raise ValueError("Validation workflow did not pass at this commit")
            subprocess.run(
                [
                    "gh",
                    "run",
                    "download",
                    str(run["id"]),
                    "--repo",
                    proof["repository"],
                    "--dir",
                    str(evidence / name),
                ],
                cwd=root,
                check=True,
            )
        for platform in ("Linux", "Windows", "macOS"):
            report = (
                evidence / "Reproducibility" / f"reproduction-{platform}" / "clean-install.json"
            )
            data = json.loads(report.read_text(encoding="utf-8"))
            if data["status"] != "passed" or not data["reproduction"]["matched"]:
                raise ValueError(f"{platform} did not reproduce the reference semantic digest")
            if any(data["browser"][key] for key in ("unexpected", "flaky", "skipped")):
                raise ValueError(f"{platform} browser validation was incomplete or flaky")
        archive_folder(evidence, output / f"nrs-validation-{tag}.zip", evidence)


def package(root, github_evidence=False):
    version, tag = version_tag(root)
    output = root / "dist"
    output.mkdir(exist_ok=True)
    expected = {
        f"nurowerx_research_stack-{version}-py3-none-any.whl",
        f"nurowerx_research_stack-{version}.tar.gz",
        "final-verification.json",
    }
    if any(path.name not in expected for path in output.iterdir()):
        raise ValueError("dist must contain only this version's fresh build and verification file")
    if github_evidence:
        validation_archive(root, output, tag)
    subprocess.run(
        ["git", "archive", "--format=zip", f"--output={output / f'nrs-source-{tag}.zip'}", "HEAD"],
        cwd=root,
        check=True,
    )
    for label in ("datasets", "research"):
        archive_folder(root / label, output / f"nrs-{label}-{tag}.zip", root)
    checksums = [
        f"{hashlib.sha256(path.read_bytes()).hexdigest()}  {path.name}"
        for path in sorted(output.iterdir())
        if path.is_file()
    ]
    (output / "SHA256SUMS.txt").write_text("\n".join(checksums) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-evidence", action="store_true")
    parser.add_argument(
        "--check", action="store_true", help="Validate version/tag without packaging"
    )
    parser.add_argument(
        "--changed-since", help="Print whether the package version differs from this commit"
    )
    args = parser.parse_args()
    if args.changed_since is not None:
        print(str(version_changed(ROOT, args.changed_since)).lower())
    elif args.check:
        print(version_tag(ROOT)[1])
    else:
        package(ROOT, args.github_evidence)
