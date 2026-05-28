# DogeOS Open-Source Security Tooling 2026-05-28

Generated: `2026-05-28T15:44:46.602Z`

This is a zero-dependency local tooling gate. It does not add scanners to `package.json`; it records whether the audit workstation has the external open-source tools needed for deeper checks.

| Tool | Status | Path | Command |
| --- | --- | --- | --- |
| slither | Missing |  | `slither . --exclude-dependencies --filter-paths 'node_modules|artifacts|cache|coverage'` |
| aderyn | Missing |  | `aderyn .` |
| osv-scanner | Missing |  | `osv-scanner scan source -r .` |
| semgrep | Missing |  | `semgrep scan --config p/security-audit --config p/secrets .` |

Next action: Install missing tools locally, or rerun with DOGEOS_SECURITY_STRICT_OPEN_SOURCE_TOOLS=1 once the audit workstation is provisioned.
