# Codex Plugin Doctor Documentation

## Document Purpose

This documentation set defines the product, brand, technical architecture, security posture, operations model, and go-to-market strategy for `Codex Plugin Doctor`.

`Codex Plugin Doctor` is a CLI-first validation and healthcheck tool for Codex plugins, skills, and MCP integrations. It helps plugin authors and engineering teams catch packaging, configuration, runtime, and security issues before distribution.

## Document Map

### Product

- [Vision and Strategy](product/vision-and-strategy.md)
- [MVP Specification](product/mvp-spec.md)
- [Personas and Jobs To Be Done](product/personas-and-jobs-to-be-done.md)

### Brand

- [Brand Foundation](brand/brand-foundation.md)
- [Messaging Framework](brand/messaging-framework.md)

### Go-To-Market

- [Market, Pricing, and Sales](go-to-market/market-pricing-and-sales.md)

### Engineering

- [Technical Architecture](engineering/technical-architecture.md)
- [CLI and Rule Engine Specification](engineering/cli-and-rule-engine-spec.md)
- [Testing and Release](engineering/testing-and-release.md)
- [Release Gating Workflow](engineering/release-gating-workflow.md)
- [CLI Presentation Plan](engineering/cli-presentation-plan.md)
- [Rule Catalog](rules/catalog.md)
- [NPM Release Checklist](engineering/npm-release-checklist.md)
- [Versioning and Releases](engineering/versioning-and-releases.md)
- [Publish Decision Log](engineering/publish-decision-log.md)
- [Release Candidate Workflow](engineering/release-candidate-workflow.md)
- [v0.1.0 Release Notes](engineering/v0.1.0-final-release-notes.md)
- [v0.1.1 Release Notes](engineering/v0.1.1-release-notes.md)
- [v0.1.2 Release Notes](engineering/v0.1.2-release-notes.md)
- [v0.1.3 Release Notes](engineering/v0.1.3-release-notes.md)
- [v0.1.4 Release Notes](engineering/v0.1.4-release-notes.md)
- [v0.1.5 Release Notes](engineering/v0.1.5-release-notes.md)

### Security

- [Security Architecture](security/security-architecture.md)
- [Threat Model](security/threat-model.md)
- [Privacy and Compliance](security/privacy-and-compliance.md)

### Operations

- [Ops, Support, and SLA](operations/ops-support-and-sla.md)
- [Roadmap and Risk Register](operations/roadmap-and-risk-register.md)
- [CLI Presentation Issue Breakdown](operations/cli-presentation-issue-breakdown.md)
- [Public Release Checklist](operations/public-release-checklist.md)

## Product Snapshot

| Category | Definition |
| --- | --- |
| Product name | Codex Plugin Doctor |
| Product type | Developer tooling, CLI-first validation platform |
| Primary audience | Plugin authors, MCP vendors, platform engineers, AI-native teams |
| Core promise | Validate Codex plugin packages before they break trust in production |
| Initial wedge | Local validation, installed plugin discovery, runtime probing, and CI reporting for Codex plugin bundles |
| Expansion path | MCP Doctor, compatibility lab, hosted control plane |

## Strategic Positioning

Codex Plugin Doctor is not a plugin marketplace and not a generic agent dashboard. It is a narrow, practical control point that answers one expensive question quickly:

`Will this plugin package actually work when a team installs it?`

That focus protects the product from direct platform overlap while creating a strong foundation for future expansion into cross-client MCP validation and governance.

## Working Principles

- Start with a strong CLI and CI story.
- Prefer deterministic validation over aspirational automation.
- Treat runtime truth as more important than static config truth.
- Make every failure actionable and easy to fix.
- Keep security posture visible, documented, and testable.
