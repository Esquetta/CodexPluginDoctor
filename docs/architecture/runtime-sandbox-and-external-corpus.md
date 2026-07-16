# Runtime Sandbox and External Corpus

## Status

Approved design for `v1.47.0`. The release adds two independent, backward-compatible capabilities:

- Docker-isolated runtime probing for supported local Node.js stdio MCP servers
- offline evaluation of local real-world package snapshots through a corpus manifest

Native runtime probing and the bundled corpus remain available with their existing defaults.

## Goals

- prevent runtime probing from starting before static validation and security checks complete
- provide real filesystem, network, capability, and resource isolation when Docker is explicitly requested
- fail closed instead of silently falling back to native execution
- evaluate realistic package snapshots without network-dependent tests or third-party source redistribution
- make unexpected, missing, and disputed corpus findings visible and release-gating
- preserve existing CLI commands and stable JSON semantics

## Non-Goals

- making Docker the default runtime backend
- supporting arbitrary languages, package managers, shells, or HTTP MCP transports in the first sandbox release
- installing dependencies inside a runtime container
- forwarding host secrets or configured MCP environment variables into a container
- downloading corpus targets or running their MCP servers
- publishing private package labels, local paths, source contents, or review notes

## Runtime Sandbox

### Command Surface

The initial command surface is:

```text
codex-plugin-doctor check <path> --runtime --sandbox docker
codex-plugin-doctor release check <path> --runtime --sandbox docker
```

`--sandbox docker` requires `--runtime`. Unknown sandbox values and unsupported command surfaces are usage errors. Native execution remains the default when `--sandbox` is absent.

The first release supports local stdio MCP entries whose executable resolves to Node.js and whose JavaScript entrypoint and dependencies are already contained within the package root. HTTP transports, package managers, shell wrappers, non-Node runtimes, installed-package scans, watch mode, and changed-package mode are rejected for sandbox execution.

### Validation Order

Static manifest, skill, MCP configuration, path, and security checks must complete before any runtime process starts. Runtime probing is skipped when static validation has a failing finding, the runtime policy decision is `deny`, or the command surface is unsupported. Warnings remain probeable and can still require an approval digest. This ordering applies to native and Docker backends.

### Container Boundary

The CLI starts Docker directly with an argument array and never constructs a shell command. The container receives:

- a read-only bind mount of the package at `/workspace`
- a validated package-relative working directory
- no network access
- a read-only container filesystem
- no inherited host environment or configured secret injection
- all Linux capabilities dropped
- `no-new-privileges`
- an unprivileged numeric user
- bounded process, memory, CPU, and temporary-disk resources
- a writable, bounded `/tmp` tmpfs

The implementation uses a version-controlled Node 22 Debian slim image reference containing an immutable OCI `sha256` digest; mutable image tags are rejected. The exact reference is included in the runtime plan. Docker Engine and the selected image remain trusted dependencies; the feature does not claim protection from a compromised Docker daemon or image.

### Execution Flow

```text
CLI options
  -> static validation and security preflight
  -> runtime plan with sandbox details
  -> optional approval digest verification
  -> Docker availability and command support checks
  -> isolated MCP protocol probe
  -> verified container cleanup
  -> validation, runtime, and release evidence reports
```

The runtime plan and approval digest bind the sandbox mode, image reference, container working directory, mount mode, network mode, and resource/security controls. Changing any of these fields invalidates prior approval.

### Failure Behavior

The operation fails without native fallback when Docker is missing, its daemon is unavailable, the image cannot start, the MCP command is unsupported, the working directory escapes the package, or container cleanup cannot be verified. Startup timeout is separate from MCP request timeout. Timeout and crash paths force-remove the uniquely named container and report cleanup failure if removal cannot be confirmed.

Reports distinguish native and Docker execution and retain the effective sandbox evidence without exposing host paths or environment values.

## External Corpus

### Command Surface

The existing bundled command remains unchanged. A manifest extends it:

```text
codex-plugin-doctor doctor corpus --manifest <corpus.json> [--json] [--output <path>]
```

Manifest paths resolve relative to the manifest file. Evaluation is static and offline: it performs no download, dependency installation, or runtime execution.

### Manifest Contract

Each target contains:

- a public-safe ID
- `healthy`, `broken`, or `edge-case` profile
- source type such as `public-package`, `local-snapshot`, or `derived-fixture`
- disclosure mode
- relative local path
- package analysis mode
- expected content digest
- expected status
- reviewed findings identified by finding ID and fingerprint
- classification for each reviewed finding

The content digest reuses the stable package fingerprint algorithm already used by Doctor attestations: each allowed package file is hashed, relative paths and file digests are sorted, and that stable list is hashed again. This prevents unnoticed snapshot drift without depending on the package's host path. The manifest must not contain secrets, private notes, or source content intended for report output.

### Classification Rules

- `true_positive` must be present.
- `false_positive` must be absent; its presence fails the case.
- `unclear` remains unresolved and fails the case while present.
- `missing_expected_finding` is generated when an expected true positive is absent.
- any actual finding without a review entry is treated as `unclear`.

Unlike the bundled corpus's historical subset comparison, manifest evaluation rejects unexpected findings. Duplicate finding IDs are distinguished by their stable fingerprints.

### Output and Exit Codes

The report keeps `kind: "doctor.validation.corpus"` and existing summary fields, then adds sanitized target metadata, digest status, classification counts, and exact expectation results. It omits manifest paths, package paths, temporary extraction paths, local usernames, source contents, and private labels. Target order follows the manifest; findings sort by ID and fingerprint. `generatedAt` is the only intentionally volatile report field.

- exit `0`: all targets and expectations pass
- exit `1`: evaluation completes but at least one acceptance condition fails
- exit `2`: manifest, target, digest input, or CLI usage is invalid

Confirmed real-world defects become minimal independently authored test fixtures. Third-party repositories and private validation-session history are not committed as corpus content.

## Compatibility

- `check --runtime` without `--sandbox` retains native execution.
- `doctor corpus` without `--manifest` retains the bundled corpus.
- existing finding IDs and severities do not change.
- new JSON fields are additive.
- runtime remains opt-in.
- sandbox execution is never inferred from runtime policy recommendations.
- successful native runtime behavior remains compatible; skipping runtime after a failing static preflight is an intentional security correction.

## Verification

### Sandbox Acceptance

- static findings are produced before any attempted process start
- Docker arguments handle spaces without shell interpolation
- package writes, host environment reads, network access, and excess resources are blocked
- `/tmp` remains writable within its limit
- plan digests change with sandbox image or control changes
- missing Docker, unsupported commands, timeout, crash, and cleanup failure fail closed
- successful native and Docker probes produce equivalent MCP protocol results
- success and failure paths leave no container behind

Docker argument and error behavior receive deterministic unit tests. A Docker-backed integration test runs when Docker is available, with a local Docker Desktop smoke test required before release.

### Corpus Acceptance

- bundled corpus behavior remains compatible
- relative-path manifests run offline
- digest drift and unexpected findings fail
- missing expected findings and duplicate IDs are handled by fingerprint
- invalid manifests return exit `2`
- equivalent snapshots in different host directories produce the same payload except `generatedAt`
- public reports contain no absolute paths or private labels

### Release Gates

The release requires the targeted sandbox and corpus tests, full `npm test`, build, package dry run, `npm run release-check`, local Docker isolation smoke tests, successful GitHub Actions, fresh-install npm audit, GitHub Release creation, npm publication, and release-sync verification.

## Documentation Hygiene

Public documentation describes supported behavior, security boundaries, and contributor workflows. Internal validation-session history is removed from the public repository; useful general guidance remains in the real-world validation guide. Git history and GitHub Releases preserve implementation and release history.
