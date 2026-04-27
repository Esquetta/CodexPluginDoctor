# Real-World Validation Session

## Session Info

- Date: 2026-04-27
- Validator version: 0.1.0-rc.1
- Operator: Codex
- Notes visibility: internal only
- Session label: wave 02 marketplace snapshot review

## Purpose

This wave validates the static heuristic behavior against marketplace snapshot packages under:

`<codex-home>\.tmp\plugins\plugins`

The immediate question is:

`Can the skill-description heuristic distinguish verbose low-signal descriptions from long but concrete marketplace descriptions outside the curated cache?`

## Targets

| Label | Type | Runtime Enabled | Notes |
| --- | --- | --- | --- |
| linear-marketplace | marketplace snapshot | no | Clean baseline package with one skill and one app surface. |
| build-web-apps-marketplace | marketplace snapshot | no | Engineering workflow package with frontend and Stripe-oriented skills. |
| atlassian-rovo-marketplace | marketplace snapshot | no | Enterprise workflow package with structured Jira and Confluence skill triggers. |

## Paths

| Label | Path |
| --- | --- |
| linear-marketplace | `<codex-home>\.tmp\plugins\plugins\linear` |
| build-web-apps-marketplace | `<codex-home>\.tmp\plugins\plugins\build-web-apps` |
| atlassian-rovo-marketplace | `<codex-home>\.tmp\plugins\plugins\atlassian-rovo` |

## Commands Run

```bash
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\linear" --json
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\build-web-apps" --json
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\atlassian-rovo" --json
```

## Initial Output Summary

| Target | Status | Exit Code | Dominant Signal |
| --- | --- | --- | --- |
| linear-marketplace | pass | 0 | No findings |
| build-web-apps-marketplace | warn | 0 | 2 `skill_description.too_long` warnings |
| atlassian-rovo-marketplace | warn | 0 | 5 `skill_description.too_long` warnings |

## Manual Classification

| Target | Skill | Classification | Notes |
| --- | --- | --- | --- |
| build-web-apps-marketplace | `frontend-app-builder` | `false_positive` | Concrete frontend/UI/build workflow description; not protocol-heavy, but still scoped. |
| build-web-apps-marketplace | `stripe-best-practices` | `false_positive` | Dense payment-integration description with concrete Stripe products and integration surfaces. |
| atlassian-rovo-marketplace | `capture-tasks-from-meeting-notes` | `false_positive` | Structured trigger list with concrete Jira/Confluence actions. |
| atlassian-rovo-marketplace | `generate-status-report` | `false_positive` | Structured trigger list with concrete status-reporting and publishing workflow. |
| atlassian-rovo-marketplace | `search-company-knowledge` | `false_positive` | Long but operationally scoped internal-knowledge search workflow. |
| atlassian-rovo-marketplace | `spec-to-backlog` | `false_positive` | Concrete spec-to-Jira-backlog workflow with bounded output expectations. |
| atlassian-rovo-marketplace | `triage-issue` | `false_positive` | Concrete issue-triage workflow with duplicate search and ticket creation boundaries. |

Classification values:

- `true_positive`
- `false_positive`
- `unclear`
- `missing_expected_finding`

## Tuning Applied

The skill-description heuristic now accounts for:

- product/domain signals beyond MCP/API vocabulary
- structured trigger patterns such as `Use when`, `When an agent needs to`, and numbered trigger lists
- high-vagueness descriptions separately from long but concrete descriptions

Regression fixtures were added for:

- frontend builder descriptions
- payment-integration descriptions
- enterprise workflow descriptions

## Final Output Summary

| Target | Status | Exit Code | Findings |
| --- | --- | --- | --- |
| linear-marketplace | pass | 0 | 0 |
| build-web-apps-marketplace | pass | 0 | 0 |
| atlassian-rovo-marketplace | pass | 0 | 0 |

## Interpretation

Wave 02 confirms that the previous heuristic was biased toward protocol-heavy technical language. That worked for MCP/Codex/plugin packages, but it created noise for marketplace skills whose descriptions are concrete in product or workflow terms.

The updated heuristic is better aligned with real plugin metadata: it still warns on vague long descriptions while accepting long descriptions that contain concrete product surfaces, workflow boundaries, or structured trigger lists.

## Follow-Up Tasks

- [x] identify non-curated marketplace snapshot targets
- [x] run initial validation against selected targets
- [x] manually classify warning cases
- [x] add regression fixtures for marketplace-style descriptions
- [x] tune skill-description heuristic for product and structured trigger signals
- [x] re-run selected targets after tuning
- [ ] run a future wave against packages with known malformed metadata or intentionally bad descriptions
