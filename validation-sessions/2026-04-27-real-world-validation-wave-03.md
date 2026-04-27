# Real-World Validation Session

## Session Info

- Date: 2026-04-27
- Validator version: 0.1.0-rc.1
- Operator: Codex
- Notes visibility: internal only
- Session label: wave 03 YAML block scalar metadata review

## Purpose

Wave 03 checks whether Codex Plugin Doctor correctly reads skill frontmatter descriptions when plugins use YAML block scalar syntax.

The immediate question is:

`Does the validator inspect the real skill description text when frontmatter uses description: | or description: >-?`

## Targets

| Label | Type | Runtime Enabled | Notes |
| --- | --- | --- | --- |
| cloudflare-marketplace | marketplace snapshot | no | Uses literal block scalar descriptions. |
| neon-postgres-marketplace | marketplace snapshot | no | Uses folded block scalar descriptions. |
| hyperframes-marketplace | marketplace snapshot | no | Uses block scalar metadata and has additional long-description warning cases. |

## Paths

| Label | Path |
| --- | --- |
| cloudflare-marketplace | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\cloudflare` |
| neon-postgres-marketplace | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\neon-postgres` |
| hyperframes-marketplace | `C:\Users\fb_52\.codex\.tmp\plugins\plugins\hyperframes` |

## Commands Run

```bash
node dist/cli.js check "C:\Users\fb_52\.codex\.tmp\plugins\plugins\cloudflare" --json
node dist/cli.js check "C:\Users\fb_52\.codex\.tmp\plugins\plugins\neon-postgres" --json
node dist/cli.js check "C:\Users\fb_52\.codex\.tmp\plugins\plugins\hyperframes" --json
```

## Initial Finding

The metadata scan showed suspiciously short parsed descriptions:

| Target | Skill | Observed Parsed Value | Actual Frontmatter Form |
| --- | --- | --- | --- |
| cloudflare-marketplace | `building-ai-agent-on-cloudflare` | `|` | `description: |` |
| cloudflare-marketplace | `building-mcp-server-on-cloudflare` | `|` | `description: |` |
| neon-postgres-marketplace | `neon-postgres-egress-optimizer` | `>-` | `description: >-` |
| hyperframes-marketplace | `website-to-hyperframes` | `|` | `description: |` |

This was a parser-level false negative risk. A long vague block scalar description could pass because the validator only saw the scalar marker.

## Regression Coverage

Two fixture cases were added:

| Fixture | Expected Result | Purpose |
| --- | --- | --- |
| `heuristic-vague-block-scalar-skill-description` | warn | Proves long vague block scalar descriptions are inspected and warned. |
| `heuristic-acceptable-folded-block-scalar-skill-description` | pass | Proves concrete folded block scalar descriptions are accepted. |

## Tuning Applied

The skill frontmatter parser now supports:

- literal YAML block scalars such as `description: |`
- folded YAML block scalars such as `description: >-`
- quoted single-line scalar cleanup

The description heuristic also includes database/cost/query domain signals so concrete Postgres egress optimization descriptions are not treated as vague verbosity.

## Final Output Summary

| Target | Status | Exit Code | Findings |
| --- | --- | --- | --- |
| cloudflare-marketplace | pass | 0 | 0 |
| neon-postgres-marketplace | pass | 0 | 0 |
| hyperframes-marketplace | warn | 0 | 2 |

## Manual Classification

| Target | Skill | Classification | Notes |
| --- | --- | --- | --- |
| hyperframes-marketplace | `gsap` | `unclear` | Description is concrete and reference-oriented, but should be reviewed alongside other animation/video packages before tuning. |
| hyperframes-marketplace | `hyperframes` | `unclear` | Long description covers many video-production surfaces. It may be acceptable, but more comparable targets are needed before relaxing the rule. |

Classification values:

- `true_positive`
- `false_positive`
- `unclear`
- `missing_expected_finding`

## Interpretation

Wave 03 found a real false-negative class in the parser rather than a simple threshold issue. The validator now reads the actual content behind YAML block scalar descriptions, which makes the existing verbosity and vagueness checks meaningful for more marketplace packages.

The remaining HyperFrames warnings were not tuned in this wave. They are better handled in a separate media/animation metadata review so the heuristic does not grow by blindly adding more product vocabulary.

## Follow-Up Tasks

- [x] scan marketplace snapshot for suspiciously short parsed skill descriptions
- [x] identify block scalar frontmatter as the root cause
- [x] add failing regression coverage for vague block scalar descriptions
- [x] implement block scalar frontmatter parsing
- [x] validate concrete folded block scalar descriptions
- [x] re-run selected marketplace targets
- [ ] run a focused media/animation metadata wave before tuning HyperFrames warnings
