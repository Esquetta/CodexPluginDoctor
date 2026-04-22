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
- startup timeouts are strict
- stdout and stderr capture are bounded
- no destructive follow-up actions are attempted

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

