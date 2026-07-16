# Runtime Approval And Sandboxing

## Execution Model

Runtime probing remains opt-in. Static validation and security checks run before any MCP process starts; a fail-level static finding prevents runtime execution.

Native probing preserves the existing host execution behavior:

```bash
codex-plugin-doctor check ./plugin --runtime
```

Docker probing is explicit and currently supports local Node.js stdio servers:

```bash
codex-plugin-doctor check ./plugin --runtime --sandbox docker
```

The Docker launch uses a digest-pinned Node image, no network, a read-only root filesystem and package mount, dropped Linux capabilities, `no-new-privileges`, an unprivileged user, bounded CPU/memory/PIDs, and a 16 MiB writable `/tmp`.

## Approval Digest

Generate and review the plan for the same backend that will execute:

```bash
codex-plugin-doctor doctor runtime-plan ./plugin --sandbox docker --json
codex-plugin-doctor check ./plugin --runtime --sandbox docker \
  --require-runtime-approval \
  --runtime-approval-digest sha256:<approved-plan-digest>
```

The digest binds the command plan and effective execution fields, including backend, immutable image, network mode, and package mount mode. Changing those fields invalidates the prior approval. Docker isolation never changes a `deny` policy decision into `allow`.

Signed release evidence includes the effective execution object only when runtime is requested. That object is part of the signed payload; verification fails if it is modified.

## Failure And Cleanup

Docker mode fails closed without native fallback when Docker or its daemon is unavailable, the pinned image cannot start, the command is unsupported, the working directory escapes the package, or cleanup cannot be confirmed. Success, timeout, and post-spawn crash paths force-remove the uniquely named container. Raw Docker stderr, host environment values, and host paths are not copied into findings.

Package roots containing commas are rejected because Docker bind-mount argument parsing cannot represent them safely in this launch mode.

## Security Boundary

Docker mode reduces exposure; it is not a complete trust boundary. The Docker daemon and pinned base image remain trusted components, kernel/container escape risks are outside this tool, and denial-of-service within configured limits is still possible. Remote HTTP MCP servers are not routed through this local Node stdio sandbox.

Native mode does not isolate filesystem, network, process, or credential access. Use it only for code you already trust.
