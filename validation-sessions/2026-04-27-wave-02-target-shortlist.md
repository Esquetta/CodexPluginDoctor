# Wave 02 Target Shortlist

## Session Info

- Date: 2026-04-27
- Source: local Codex marketplace snapshot
- Search root: `C:\Users\fb_52\.codex\.tmp\plugins\plugins`
- Purpose: find non-curated, external-like plugin packages that exercise real marketplace metadata beyond repo-owned fixtures and curated cache packages.

## Selected Targets

| Rank | Label | Path | Initial Status | Why It Was Selected |
| --- | --- | --- | --- | --- |
| 1 | `linear-marketplace` | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\linear` | pass | Clean baseline with app and skill metadata. Useful to confirm the validator is not noisy on smaller marketplace packages. |
| 2 | `build-web-apps-marketplace` | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\build-web-apps` | warn | Engineering workflow package with frontend and payment-integration skill descriptions that are concrete but not MCP-heavy. |
| 3 | `atlassian-rovo-marketplace` | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\atlassian-rovo` | warn | Enterprise workflow package with structured trigger descriptions for Jira and Confluence workflows. Good stress test for non-protocol product language. |

## Alternates

| Label | Initial Status | Notes |
| --- | --- | --- |
| `gmail-marketplace` | warn | Good connector-heavy follow-up target; two skill-description warnings before tuning. |
| `neon-postgres-marketplace` | pass | Good database/platform baseline. |
| `notion-marketplace` | pass | Good app-plus-skills baseline with multiple skills. |
| `github-marketplace` | pass | Overlaps with wave 01 but useful as a marketplace snapshot comparison. |

## Selection Decision

Wave 02 should use `linear`, `build-web-apps`, and `atlassian-rovo`.

This gives one clean baseline and two high-signal warning cases. The warnings are concentrated in skill-description heuristics, which makes the wave useful for tuning without mixing in unrelated runtime/auth failures.
