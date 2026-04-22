# Technical Architecture

## Architecture Overview

Codex Plugin Doctor is a modular CLI application with a validation pipeline composed of five main layers:

1. package discovery
2. static analysis
3. runtime probing
4. rule evaluation
5. reporting

## High-Level Components

### CLI Orchestrator

Coordinates command parsing, scan mode selection, lifecycle logging, and exit code management.

### Package Loader

Discovers the target package root, reads plugin manifests, locates skills and support files, and normalizes paths.

### Config Parser

Parses Codex-related config surfaces and MCP definitions into a canonical internal model.

### Runtime Probe Engine

Starts supported stdio servers, monitors startup behavior, attempts basic capability discovery, and captures diagnostics safely.

### Rule Engine

Executes deterministic checks against static data and runtime findings, producing normalized findings with severity and remediation guidance.

### Reporters

Render findings into text, JSON, and CI-friendly Markdown summaries.

## Recommended Stack

### Language

TypeScript on Node.js for the CLI and rule engine.

### Key Reasons

- strong ecosystem for CLI packaging
- straightforward JSON and process handling
- good portability for developer distribution
- easier path to future Electron shell if needed

## Internal Domain Model

### PackageModel

Represents plugin metadata, referenced files, detected skills, and MCP entries.

### RuntimeResult

Represents startup status, stderr output, exit codes, and capability discovery results.

### Finding

Represents one normalized validation outcome with:

- stable identifier
- severity
- category
- evidence
- impact statement
- recommended fix

## Execution Flow

1. Resolve target path.
2. Load plugin metadata and referenced files.
3. Parse skills and MCP configuration.
4. Run static rules.
5. If `--runtime` is enabled, probe runtime behavior.
6. Merge findings into a single scored report.
7. Render requested output formats.
8. Exit with deterministic status code.

## Future Extension Points

- client adapter layer for cross-client compatibility
- hosted report ingestion
- policy packs for team standards
- signed validation artifacts

## Design Constraints

- must run offline for core validation
- must not require Codex UI presence to produce useful results
- should avoid destructive commands during runtime probing
- should be safe to run in CI

