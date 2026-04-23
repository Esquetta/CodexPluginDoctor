# Release Candidate Workflow

## Purpose

Prepare a locally testable or CI-generated release candidate without publishing to npm.

## Local Flow

```bash
npm run prepare-rc -- --target examples/codex-doctor-runtime --runtime-target examples/codex-doctor-runtime
```

This creates a versioned folder under:

```text
release-candidate/<version>/
```

The folder includes:

- validation summary
- static JSON report
- runtime JSON report
- packed npm tarball
- generated release notes
- release manifest

## GitHub Flow

Use the manual workflow:

- `.github/workflows/release-candidate.yml`

Inputs:

- `validation_target`
- `runtime_target`

## Recommended Usage

- use `examples/codex-doctor-runtime` as the default sanity target
- switch to a real plugin package path when validating a real release candidate
- inspect the generated tarball and release notes before any public publish decision

