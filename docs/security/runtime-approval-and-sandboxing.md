# Runtime Approval And Sandboxing

## Current Position

Codex Plugin Doctor does not claim hard OS, VM, or container sandboxing for plugin-local MCP servers.

The current control model is safer-by-default execution approval:

- static validation and security checks run before runtime probing
- `doctor runtime-plan <path>` shows the runtime command plan without starting servers
- the plan includes a stable digest for review and CI approval
- `check --runtime --require-runtime-approval --runtime-approval-digest <digest>` refuses to start runtime probes when the current plan changed
- release evidence records runtime approval status in the signed artifact

## Why This Boundary Exists

Runtime probing is useful because it catches real MCP protocol failures that static config checks cannot see. It is also higher risk because a package-local MCP server can execute local code.

The approval digest makes the execution boundary explicit. A reviewer can inspect the command, args, cwd, probe methods, and risk reasons before allowing a CI or release job to start the server.

## What This Is Not

Runtime approval is not a security sandbox. It does not isolate filesystem, network, process, or credential access once the approved command is started.

Use runtime approval as a gate before execution, not as a containment layer after execution.

## Future Sandbox Direction

A future sandbox mode should be additive and explicit, for example:

- `--sandbox docker` for containerized CI probing
- restricted environment variables by default
- read-only package mounts where possible
- network policy controls for remote MCP servers
- clear evidence fields showing which sandbox mode was used
