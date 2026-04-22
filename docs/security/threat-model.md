# Threat Model

## Scope

This threat model covers the CLI-first product and the future risks implied by optional runtime probing.

## Key Assets

- developer workstation safety
- CI runner safety
- secrets exposed through env vars or package files
- report integrity
- customer trust in validation results

## Threat Actors

- careless package author
- malicious plugin package publisher
- compromised dependency in the validation tool chain
- internal user misconfiguring CI or runtime flags

## Attack Surfaces

- plugin manifest parsing
- file reference traversal
- runtime probe command execution
- report export
- future hosted ingestion endpoints

## Major Threats

### 1. Dangerous Runtime Execution

A malicious package could define a command that executes harmful behavior when runtime probing is enabled.

#### Controls

- require explicit `--runtime`
- limit probe scope
- use bounded timeouts
- log exact executed command
- document safe-use expectations clearly

### 2. Secret Leakage in Reports

Reports may accidentally include env values or stdout/stderr with sensitive tokens.

#### Controls

- redact common token patterns
- cap captured output size
- never print full env snapshots

### 3. Path Traversal

A package may reference files outside the package root.

#### Controls

- canonicalize paths
- flag escaped roots
- separate warning from valid internal references

### 4. False Trust Signal

Users may over-interpret a passing validation score as a guarantee of production safety.

#### Controls

- state scope limits explicitly
- avoid certification language in the CLI
- distinguish validation from compliance

## Residual Risk

The largest residual risk in v1 is the intentional runtime probe surface. This is acceptable if:

- probing remains opt-in
- documentation is explicit
- defaults are conservative
- evidence is transparent

