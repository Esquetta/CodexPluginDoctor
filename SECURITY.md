# Security Policy

## Supported Versions

Codex Plugin Doctor is currently pre-release. Security reports should target the latest `main` branch or the latest GitHub prerelease.

## Reporting a Vulnerability

Please report security issues privately instead of opening a public issue.

Preferred path:

1. Open a private GitHub security advisory if available.
2. If advisory reporting is unavailable, contact the maintainer through the GitHub profile linked from the repository.

Please include:

- affected version or commit
- reproduction steps
- expected impact
- whether secrets, filesystem access, or command execution are involved

## Security Scope

In scope:

- unsafe filesystem path handling
- secret leakage in reports or verbose runtime transcripts
- command execution behavior in runtime probing
- CI or release artifact leaks

Out of scope:

- issues in third-party MCP servers being validated
- expected warnings or failures emitted for intentionally broken fixtures
- public metadata already present in plugin packages
