"""Release packaging controls use temporary synthetic repositories, not research evidence."""

import copy
import hashlib
import json
import os
import runpy
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

REAL_RUN = subprocess.run
ROOT = Path(__file__).resolve().parents[1]
PACKAGING = runpy.run_path(str(ROOT / "scripts/package_release.py"))
GATE = runpy.run_path(str(ROOT / "scripts/release_gate.py"))


class ReleasePackagingTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name)
        (self.root / "pyproject.toml").write_text('[project]\nversion = "0.1.1"\n')
        for name in ("datasets", "research"):
            (self.root / name).mkdir()
            (self.root / name / "fixture.txt").write_text("Synthetic packaging test fixture\n")
        for args in (
            ["init", "-q"],
            ["add", "."],
            [
                "-c",
                "user.name=Packaging test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "-qm",
                "Synthetic packaging test",
            ],
        ):
            subprocess.run(["git", *args], cwd=self.root, check=True, capture_output=True)
        self.sha = subprocess.check_output(
            ["git", "rev-parse", "HEAD"], cwd=self.root, text=True
        ).strip()
        self.addCleanup(patch.stopall)
        patch.dict(
            os.environ,
            {
                "GITHUB_REF_TYPE": "branch",
                "GITHUB_REF_NAME": "main",
                "GITHUB_REPOSITORY": "example/synthetic-test",
            },
        ).start()

    def runs(self):
        return [
            {
                "id": index,
                "name": name,
                "event": "push",
                "head_branch": "main",
                "head_sha": self.sha,
                "path": f".github/workflows/{filename}",
                "status": "completed",
                "conclusion": "success",
                "html_url": "https://example.invalid",
            }
            for index, (name, filename) in enumerate(GATE["WORKFLOWS"].items(), start=1)
        ]

    def proof(self):
        output = self.root / "dist"
        output.mkdir()
        data = {
            "commit": self.sha,
            "repository": "example/synthetic-test",
            "workflows": {run["name"]: run for run in self.runs()},
        }
        (output / "final-verification.json").write_text(json.dumps(data))
        return output, data

    def test_archives_and_checksums_use_current_version(self):
        PACKAGING["package"](self.root)
        output = self.root / "dist"
        self.assertEqual(
            {p.name for p in output.iterdir()},
            {
                "nrs-source-v0.1.1.zip",
                "nrs-datasets-v0.1.1.zip",
                "nrs-research-v0.1.1.zip",
                "SHA256SUMS.txt",
            },
        )
        for line in (output / "SHA256SUMS.txt").read_text().splitlines():
            expected, name = line.split("  ")
            self.assertEqual(hashlib.sha256((output / name).read_bytes()).hexdigest(), expected)
        with zipfile.ZipFile(output / "nrs-source-v0.1.1.zip") as archive:
            self.assertIn(b"0.1.1", archive.read("pyproject.toml"))
        with zipfile.ZipFile(output / "nrs-datasets-v0.1.1.zip") as archive:
            self.assertIn("datasets/fixture.txt", archive.namelist())

    def test_tag_mismatch_is_rejected_before_packaging(self):
        with patch.dict(os.environ, {"GITHUB_REF_TYPE": "tag", "GITHUB_REF_NAME": "v0.1.0"}):
            with self.assertRaisesRegex(ValueError, "tag"):
                PACKAGING["package"](self.root)
        self.assertFalse((self.root / "dist").exists())

    def test_dependency_only_edits_do_not_request_another_release(self):
        (self.root / "pyproject.toml").write_text(
            '[project]\nversion = "0.1.1"\ndependencies = ["example==2.0.0"]\n'
        )
        self.assertFalse(PACKAGING["version_changed"](self.root, self.sha))

    def test_version_change_requests_a_release(self):
        (self.root / "pyproject.toml").write_text('[project]\nversion = "0.1.2"\n')
        self.assertTrue(PACKAGING["version_changed"](self.root, self.sha))

    def test_first_push_requests_a_release(self):
        self.assertTrue(PACKAGING["version_changed"](self.root, "0" * 40))

    def test_unknown_previous_commit_is_not_treated_as_a_version_change(self):
        with self.assertRaises(subprocess.CalledProcessError):
            PACKAGING["version_changed"](self.root, "missing-commit")

    def test_stale_distribution_is_rejected(self):
        (self.root / "dist").mkdir()
        (self.root / "dist/nurowerx_research_stack-0.1.0-py3-none-any.whl").write_bytes(b"old")
        with self.assertRaisesRegex(ValueError, "fresh build"):
            PACKAGING["package"](self.root)
        self.assertFalse((self.root / "dist/nrs-source-v0.1.1.zip").exists())

    def test_all_required_workflows_must_pass(self):
        selected, pending = GATE["validation_runs"](self.runs(), self.sha)
        self.assertEqual(set(selected), set(GATE["WORKFLOWS"]))
        self.assertEqual(pending, [])
        runs = self.runs()
        runs[0]["status"] = "in_progress"
        _, pending = GATE["validation_runs"](runs, self.sha)
        self.assertEqual(pending, ["CI"])

    def test_foreign_commit_or_pull_request_runs_cannot_satisfy_gate(self):
        runs = self.runs()
        runs[0]["head_sha"] = "another-commit"
        runs[1]["event"] = "pull_request"
        runs[2]["head_branch"] = "feature"
        selected, pending = GATE["validation_runs"](runs, self.sha)
        self.assertEqual(selected, {})
        self.assertEqual(set(pending), set(GATE["WORKFLOWS"]))

    def test_wrong_workflow_path_cannot_satisfy_gate(self):
        runs = self.runs()
        runs[0]["path"] = ".github/workflows/unrelated.yml"
        _, pending = GATE["validation_runs"](runs, self.sha)
        self.assertEqual(pending, ["CI"])

    def test_newer_failed_run_overrides_old_success(self):
        runs = self.runs()
        newer = dict(runs[0], id=99, conclusion="failure")
        with self.assertRaisesRegex(ValueError, "CI has not passed"):
            GATE["validation_runs"]([*runs, newer], self.sha)

    def test_evidence_for_another_commit_is_rejected(self):
        output, proof = self.proof()
        proof["commit"] = "another-commit"
        (output / "final-verification.json").write_text(json.dumps(proof))
        with self.assertRaisesRegex(ValueError, "does not match"):
            PACKAGING["validation_archive"](self.root, output, "v0.1.1")

    def download_fixture(self, args, **kwargs):
        if args[0] != "gh":
            return REAL_RUN(args, **kwargs)
        destination = Path(args[args.index("--dir") + 1])
        if destination.name == "Reproducibility":
            for platform in ("Linux", "Windows", "macOS"):
                report = destination / f"reproduction-{platform}/clean-install.json"
                report.parent.mkdir(parents=True)
                data = {
                    "status": "passed",
                    "reproduction": {"matched": True},
                    "browser": {"unexpected": 0, "flaky": 0, "skipped": 0},
                }
                if platform == "Linux":
                    data = copy.deepcopy(data)
                    data["browser"]["flaky"] = getattr(self, "flaky", 0)
                report.write_text(json.dumps(data))
        return subprocess.CompletedProcess(args, 0)

    def test_validation_archive_retains_all_platform_reports(self):
        output, _ = self.proof()
        with patch("subprocess.run", side_effect=self.download_fixture):
            PACKAGING["validation_archive"](self.root, output, "v0.1.1")
        with zipfile.ZipFile(output / "nrs-validation-v0.1.1.zip") as archive:
            self.assertIn("final-verification.json", archive.namelist())
            for platform in ("Linux", "Windows", "macOS"):
                self.assertIn(
                    f"Reproducibility/reproduction-{platform}/clean-install.json",
                    archive.namelist(),
                )

    def test_flaky_validation_cannot_be_published_as_clean(self):
        output, _ = self.proof()
        self.flaky = 1
        with patch("subprocess.run", side_effect=self.download_fixture):
            with self.assertRaisesRegex(ValueError, "flaky"):
                PACKAGING["validation_archive"](self.root, output, "v0.1.1")
        self.assertFalse((output / "nrs-validation-v0.1.1.zip").exists())
