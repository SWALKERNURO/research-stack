# Changelog

## 0.1.1 — Workflow and release maintenance

This patch release includes the tested setup-python and CodeQL updates from pull requests #10 and #11, plus the screenshot-test correction and versioned release packaging. TRACE, LOOP, LENS and FRAME retain their existing research behavior.

- Update actions/setup-python from 5.6.0 to 7.1.0 in CI, Security, Reproducibility and Release. Python remains 3.11; the action runtime requires a runner supporting Node.js 24.
- Pin CodeQL initialization and analysis together at the same v4.39.1 revision for Python and JavaScript/TypeScript scanning.
- Select the seeded baseline explicitly before the screenshot test inspects a case; assertions and timeouts remain intact.
- Update Python/npm packages and displayed API/UI versions to 0.1.1. Generate archive names from package metadata and reject mismatched tags or stale build files.
- Add release-packaging and gate controls, a packaging smoke check in CI, and exact-commit validation evidence. Version changes on main start a release only after CI, Security and Linux/Windows/macOS reproduction pass. Uploaded downloads are checksum-verified before publication.


## 0.1.0 — Initial public research release

Preserves the working four-module application and its original 31-test development baseline. Adds NRS-Bench version 1.0.0, original versioned datasets, formal manuscripts, citation metadata, CI and security workflows.

Release improvements include atomic validated TRACE graph exchange, idempotent ETL imports, rejection of conflicting duplicate relationship metadata, project-identity checks, packaged CLI migrations, allowed-host validation, explicit missing chart values, strict interval validation and time-series gaps. Adds regression controls, numerical visualization oracles, interruption tests, keyboard/export/error browser checks and correction/report screenshots.

Known scope: deterministic synthetic policies, local SQLite workbench, shared-token remote access, no independent-party replication or human-subject evaluation. TRACE graph import preserves historical evidence but does not reconstruct runnable LOOP database rows.
