# Security Policy

## Supported Versions

Security fixes target the latest published minor version of `codex-plugin-doctor`.

| Version | Supported |
| --- | --- |
| Latest npm release | Yes |
| Older releases | Best effort |

## Reporting a Vulnerability

Please do not open a public issue for suspected vulnerabilities.

Report security concerns through GitHub Security Advisories for this repository when available, or contact the maintainer through the GitHub profile linked from the repository owner.

Useful report details:

- affected version or commit
- command that triggered the issue
- target package shape or minimal reproduction
- whether credentials, local paths, or generated transcripts were exposed
- expected safe behavior

## Security Principles

- Validation should be local-first and deterministic.
- Runtime probes should redact generated prompt argument values and avoid leaking secrets.
- Install previews must not modify local agent configuration files.
- Future apply/write flows must create backups before mutation.
- Findings should explain impact and remediation clearly.
