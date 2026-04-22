# Roadmap and Risk Register

## Product Roadmap

### Stage 0: Documentation and Product Definition

- finalize vision, positioning, and scope
- define rule categories and CLI contract
- prepare brand and launch narrative

### Stage 1: CLI MVP

- package parser
- rule engine
- text and JSON report formats
- runtime probing
- GitHub Action

### Stage 2: Package Quality Workflow

- stable badge output
- historical trend summary
- signed validation artifacts
- private team reports

### Stage 3: MCP Doctor Expansion

- client adapters
- compatibility reports
- broader MCP packaging support

### Stage 4: Hosted Control Plane

- multi-run history
- team sharing
- policy packs
- audit views

## Top Risks

| Risk | Description | Mitigation |
| --- | --- | --- |
| Platform overlap | Native Codex improvements may absorb shallow validation features | focus on runtime truth, CI workflow, and independent validation |
| Scope creep | Expanding into dashboard and marketplace too early | keep v1 CLI-first and validation-only |
| Runtime probe risk | probing untrusted packages increases risk | keep runtime opt-in and conservative |
| Thin market | Codex-specific market may be too narrow alone | design the engine to expand into MCP Doctor |
| Trust gap | users may not trust early findings | use fixtures, transparent evidence, and stable rule IDs |

## Launch Priorities

- high-quality README and examples
- public fixture repository
- one strong demo showing a broken package caught before release
- GitHub Action for immediate workflow fit

## Decision Rules

- do not build UI before CLI adoption proves the workflow
- do not add hosted history before report quality is trusted
- do not market broad governance before owning package validation

## Twelve-Month Goal

Become the default validation step teams run before publishing a Codex-compatible plugin package and establish a credible path to broader MCP validation.
