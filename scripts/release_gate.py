"""Fail closed unless named validation workflows passed at this exact commit."""

import argparse
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

WORKFLOWS = {"CI": "ci.yml", "Security": "security.yml", "Reproducibility": "reproducibility.yml"}


def validation_runs(runs, sha):
    selected = {}
    pending = []
    for name, filename in WORKFLOWS.items():
        candidates = [
            run
            for run in runs
            if run["name"] == name
            and run["event"] == "push"
            and run["head_sha"] == sha
            and run["path"] == f".github/workflows/{filename}"
            and run["head_branch"] == "main"
        ]
        if not candidates:
            pending.append(name)
            continue
        latest = max(candidates, key=lambda run: run["id"])
        if latest["status"] != "completed":
            pending.append(name)
        elif latest["conclusion"] != "success":
            raise ValueError(f"{name} has not passed: {latest['html_url']}")
        else:
            selected[name] = latest
    return selected, pending


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--wait-seconds", type=int, default=0)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    repository, sha = os.environ["GITHUB_REPOSITORY"], os.environ["GITHUB_SHA"]
    deadline = time.monotonic() + args.wait_seconds
    while True:
        response = subprocess.check_output(
            ["gh", "api", f"repos/{repository}/actions/runs?head_sha={sha}&per_page=100"], text=True
        )
        selected, pending = validation_runs(json.loads(response)["workflow_runs"], sha)
        if not pending:
            break
        if time.monotonic() >= deadline:
            raise SystemExit(f"Missing or unfinished validation for {sha}: {', '.join(pending)}")
        print(f"Waiting for exact-commit validation: {', '.join(pending)}", flush=True)
        time.sleep(min(10, max(0, deadline - time.monotonic())))
    proof = {
        "repository": repository,
        "commit": sha,
        "checked_at": datetime.now(timezone.utc).isoformat(),
        "workflows": selected,
        "scope": "Developer-controlled CI validation; not independent research replication.",
    }
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(proof, indent=2) + "\n", encoding="utf-8")
    for name, run in selected.items():
        print(f"Verified {name}: {run['html_url']}")


if __name__ == "__main__":
    main()
