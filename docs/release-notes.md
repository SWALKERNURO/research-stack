# v0.1.1 — Workflow and release maintenance

This patch release includes the tested setup-python and CodeQL updates from pull requests #10 and #11, plus the screenshot-test correction and versioned release packaging. TRACE, LOOP, LENS and FRAME retain their existing research behavior.

- Update actions/setup-python from 5.6.0 to 7.1.0 in CI, Security, Reproducibility and Release. Python remains 3.11; the action runtime requires a runner supporting Node.js 24.
- Pin CodeQL initialization and analysis together at the same v4.39.1 revision for Python and JavaScript/TypeScript scanning.
- Select the seeded baseline explicitly before the screenshot test inspects a case; assertions and timeouts remain intact.
- Update Python/npm packages and displayed API/UI versions to 0.1.1. Generate archive names from package metadata and reject mismatched tags or stale build files.
- Add release-packaging and gate controls, a packaging smoke check in CI, and exact-commit validation evidence. Version changes on main start a release only after CI, Security and Linux/Windows/macOS reproduction pass. Uploaded downloads are checksum-verified before publication.

Downloads include the source archive, Python wheel and source distribution, dataset/research archives, fresh raw validation artifacts, final-verification.json and SHA256SUMS.txt. Use the source archive for the full application; the wheel does not include the compiled frontend. The release's validation archive records the actual checks and runtime environments rather than relabeling historical results.

The original v0.1.0 release remains available. Its Zenodo DOI, 10.5281/zenodo.23898164, identifies that archived version; no new version-specific Zenodo DOI is claimed here. NRS-Bench and dataset versions, scientific methods, reference digests and historical observations are unchanged. Validation is developer-controlled synthetic software verification, not independent replication or evidence of real-world model performance.

Software: MIT. Original datasets and papers: CC BY 4.0. See the [v0.1.0 release notes](releases/v0.1.0.md) for the initial release and its historical observations.
