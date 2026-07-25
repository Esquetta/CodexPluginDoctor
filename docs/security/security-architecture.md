# Security Architecture

## Security Objective

Protect users, package authors, and CI environments while validating potentially unsafe plugin bundles and runtime commands.

## Security Principles

- least privilege
- explicit execution boundaries
- no silent secret capture
- transparent reporting
- safe-by-default runtime probing

## Trust Boundaries

### Boundary 1: Local Workstation

The CLI runs on a developer or CI machine and must assume the target package may be malformed or unsafe.

### Boundary 2: Package Contents

Plugin manifests, skill files, scripts, and referenced assets are untrusted input.

### Boundary 3: Runtime Probe

Starting an MCP server is a higher-risk operation than static parsing and must be tightly controlled.

## Security Controls

### Static Validation First

Run structural and config checks before any runtime command execution.

### Safe Runtime Policy

- runtime probing is opt-in through `--runtime`
- runtime approval can be required through `--require-runtime-approval` and a matching `doctor runtime-plan` digest
- startup timeouts are strict
- stdout and stderr capture are bounded
- no destructive follow-up actions are attempted

### Runtime Approval Boundary

`doctor runtime-plan <path>` is a non-executing review surface. It lists MCP server commands, args, cwd, intended probe methods, and security risk reasons before any local process is started.

This is an approval gate, not a sandbox. It reduces accidental or unreviewed execution, but it does not isolate the process after launch.

### Remote MCP Network Boundary

Remote probing requires explicit network consent and separately requires `--allow-local-network` consent for loopback endpoints only. Private, link-local, multicast, unspecified, reserved, and NAT64 ranges remain blocked. Before each request, the CLI validates the URL and resolved addresses to block credentials, query and fragment components, numeric IP literals, loopback and private ranges, link-local and cloud-metadata ranges, and other SSRF targets. Requests are bounded, redirect-free, and redacted in reports.

DNS and IP classification cannot eliminate arbitrary network-specific NAT64 Pref64 mappings. Use runner or host egress controls to limit the destinations that a CI job or workstation can reach.

### Secret Hygiene

- redact values that look like tokens in reports
- never persist raw secrets
- warn on obviously embedded credentials

### File System Safety

- resolve and normalize all referenced paths
- warn on parent-directory traversal
- flag execution from suspicious directories

## Telemetry Position

The local CLI should work without mandatory telemetry.

If optional product analytics are added later:

- collect aggregate usage only
- never capture plugin contents by default
- require explicit opt-in for uploaded reports

## Secure Defaults for the Hosted Future

- short-lived signed report access
- encrypted report storage
- tenant isolation
- audit trails for shared validation runs
