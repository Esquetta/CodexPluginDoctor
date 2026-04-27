# Real-World Validation Session

## Session Info

- Date: 2026-04-27
- Validator version: 0.1.0-rc.1
- Operator: Codex
- Notes visibility: internal only
- Session label: wave 01 curated plugin cache review

## Purpose

This wave moves beyond repository-owned fixtures and examples into locally available curated plugin cache packages that more closely resemble real ecosystem distributions.

The immediate question for this wave is:

`Are the current skill-description heuristics too noisy on real curated packages?`

## Targets

| Label | Type | Expected Outcome | Runtime Enabled | Notes |
| --- | --- | --- | --- | --- |
| github-curated | plugin cache | warn | no | Real `.codex-plugin` package with 4 skills. |
| cloudflare-curated | plugin cache | warn | no | Real `.codex-plugin` package with `.mcp.json` and wider skill surface. |
| figma-curated | plugin cache | warn | no | Real `.codex-plugin` package with the densest skill surface in this first wave. |

## Paths

| Label | Path |
| --- | --- |
| github-curated | `C:\Users\fb_52\.codex\plugins\cache\openai-curated\github\b066e4a0` |
| cloudflare-curated | `C:\Users\fb_52\.codex\plugins\cache\openai-curated\cloudflare\b066e4a0` |
| figma-curated | `C:\Users\fb_52\.codex\plugins\cache\openai-curated\figma\b066e4a0` |

## Commands Run

```bash
node dist/cli.js check "C:\Users\fb_52\.codex\plugins\cache\openai-curated\github\b066e4a0" --json
node dist/cli.js check "C:\Users\fb_52\.codex\plugins\cache\openai-curated\cloudflare\b066e4a0" --json
node dist/cli.js check "C:\Users\fb_52\.codex\plugins\cache\openai-curated\figma\b066e4a0" --json
```

## Findings Review

| Target | Finding ID | Severity | Classification | Notes |
| --- | --- | --- | --- | --- |
| github-curated | `plugin.heuristic.skill_description.too_long` | warn | unclear | All 4 skills were flagged; these look plausibly detailed rather than obviously excessive. |
| cloudflare-curated | `plugin.heuristic.skill_description.too_long` | warn | unclear | All 7 flagged skills are long-form but appear intentionally rich for platform workflows. |
| figma-curated | `plugin.heuristic.skill_description.too_long` | warn | unclear | All 7 flagged skills are detailed workflow descriptions rather than obvious low-signal verbosity. |

Classification values:

- `true_positive`
- `false_positive`
- `unclear`
- `missing_expected_finding`

## Runtime Review

Runtime was intentionally skipped in wave 01 because these curated packages may depend on external authenticated MCP surfaces or environment-specific integrations. The current goal is static finding quality, not runtime transport success.

## Output Summary

| Target | Status | Exit Code | Dominant Signal |
| --- | --- | --- | --- |
| github-curated | warn | 0 | 4 `skill_description.too_long` warnings |
| cloudflare-curated | warn | 0 | 7 `skill_description.too_long` warnings |
| figma-curated | warn | 0 | 7 `skill_description.too_long` warnings |

## Concrete Counts

- `github-curated`: 4 warnings, 0 failures
- `cloudflare-curated`: 7 warnings, 0 failures
- `figma-curated`: 7 warnings, 0 failures

## Early Interpretation

All three curated plugin packages primarily trigger the same heuristic family:

- `plugin.heuristic.skill_description.too_long`

That consistency is useful. It means the validator is not spraying unrelated noise. But it also strongly suggests that the current threshold may be tuned too aggressively for high-quality curated plugin packages with intentionally detailed skill descriptions.

## Tuning Recommendations

### High Priority

- audit the current skill description length threshold against these three packages
- decide whether the heuristic should:
  - raise the length threshold
  - incorporate structure-aware exceptions
  - use `warn` only when both length and ambiguity are high
- add one regression fixture that is long but should still pass

### Medium Priority

- add one or more non-curated external-like packages once available
- distinguish `long and precise` from `long and vague`

### Low Priority

- consider separate thresholds for core skill packs vs plugin-distributed skill packs

## Follow-Up Tasks

- [ ] review the flagged skill descriptions manually for GitHub curated package
- [ ] review the flagged skill descriptions manually for Cloudflare curated package
- [ ] review the flagged skill descriptions manually for Figma curated package
- [ ] convert the heuristic tuning decision into an implementation slice
- [ ] add a long-but-acceptable skill description fixture
