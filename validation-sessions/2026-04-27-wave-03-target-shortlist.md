# Wave 03 Target Shortlist

## Session Info

- Date: 2026-04-27
- Source: local Codex marketplace snapshot
- Search root: `C:\Users\fb_52\.codex\.tmp\plugins\plugins`
- Purpose: find marketplace packages that expose true-positive or false-negative validator behavior after wave 02 reduced description-noise false positives.

## Selected Targets

| Rank | Label | Path | Initial Signal | Why It Was Selected |
| --- | --- | --- | --- | --- |
| 1 | `cloudflare-marketplace` | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\cloudflare` | block scalar descriptions | Uses `description: |` in skill frontmatter. This exposed that the validator was reading the scalar marker instead of the real description text. |
| 2 | `neon-postgres-marketplace` | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\neon-postgres` | folded block scalar descriptions | Uses `description: >-` in skill frontmatter. This validates folded YAML scalar handling. |
| 3 | `hyperframes-marketplace` | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\hyperframes` | mixed block scalar and long concrete descriptions | Includes block scalar metadata plus remaining long-description warning cases for future manual review. |

## Discovery Notes

The initial scan sorted skill descriptions by parsed length. Several real marketplace skills appeared to have descriptions of length `1` or `2`, but manual inspection showed valid YAML block scalars:

- `description: |`
- `description: >-`

That means the previous parser was not validating the real description text. It could miss a long vague description if it was written as a block scalar.

## Selection Decision

Wave 03 should focus on YAML block scalar frontmatter parsing before adding more heuristic rules.

This is higher value than tuning more domain vocabulary because it fixes a parser-level false negative: the validator must inspect the actual metadata before judging quality.
