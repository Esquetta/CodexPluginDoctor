# Vision and Strategy

## Vision

Codex Plugin Doctor becomes the default preflight validation layer for Codex plugin packages and, over time, the most trusted validation engine for MCP-based agent integrations across clients.

## Mission

Help plugin authors and engineering teams ship Codex-compatible integrations with confidence by turning opaque install failures into deterministic validation reports.

## Problem Statement

The ecosystem around Codex plugins, skills, and MCP integrations is growing faster than its operational tooling. Authors can assemble packaging, manifests, startup commands, skills, and MCP servers, but they still face several expensive unknowns:

- whether the package structure is valid
- whether required files are missing
- whether runtime startup works outside the author's machine
- whether `tools/list` returns usable results
- whether auth and environment configuration will fail for downstream users
- whether tool schemas create context bloat or poor model ergonomics

These failures do not just create bugs. They create trust damage, support costs, failed demos, and friction in every distribution channel.

## Strategic Thesis

Codex itself will continue improving install UX, discovery, and integrated experiences. The enduring opportunity is not to compete with that surface. The durable opportunity is to own the validation layer beneath it.

Codex Plugin Doctor wins by focusing on:

- package correctness
- runtime truth
- report quality
- CI integration
- developer workflow fit

## Positioning Statement

For plugin authors and AI-native engineering teams shipping Codex packages, Codex Plugin Doctor is the validation and healthcheck tool that proves a package is installable, runnable, and operationally safe before release.

Unlike generic linters or static schema validators, Codex Plugin Doctor combines packaging analysis, runtime checks, and actionable remediation guidance in one report.

## Product Strategy

### Phase 1

Own the Codex package validation workflow with a CLI, JSON output, and GitHub Action.

### Phase 2

Extend the validation engine into a broader `MCP Doctor` product that can assess compatibility across multiple agent clients.

### Phase 3

Launch a hosted control plane for package certification, shared validation reports, policy packs, and audit-friendly release workflows.

## Product Principles

- Validation first, automation second.
- Opinionated defaults, transparent reasoning.
- Strict enough for teams, simple enough for solo builders.
- Security is part of package quality, not a separate add-on.
- Reports must explain impact, not just surface errors.

## Success Criteria

The product is succeeding when:

- plugin authors run it before publishing by default
- teams add it to CI without hand-holding
- support teams use its reports to resolve packaging incidents faster
- MCP vendors use passing reports as trust signals in docs and sales

## Non-Goals for the Initial Product

- building a plugin marketplace
- replacing Codex install UX
- acting as a universal secrets manager
- providing full remote agent observability
- becoming an enterprise policy platform in v1

