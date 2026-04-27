# Real-World Validation Session

## Session Info

- Date: 2026-04-27
- Validator version: 0.1.0-rc.1
- Operator: Codex
- Notes visibility: internal only
- Session label: bootstrap wave 00

## Purpose

This wave is a bootstrap validation pass using the repository's most realistic local sample packs before moving on to externally sourced plugin packages.

It is not a substitute for customer-like package review, but it establishes a clean baseline across the main validator result shapes:

- healthy `pass`
- broken `fail`
- large-payload `warn`
- paginated runtime `pass`

## Targets

| Label | Type | Expected Outcome | Runtime Enabled | Notes |
| --- | --- | --- | --- | --- |
| target-01 | healthy | pass | yes | `examples/codex-doctor-runtime` exercises the full runtime scorecard. |
| target-02 | broken | fail | no | `examples/codex-doctor-risky` intentionally contains a hard-coded secret-like env value. |
| target-03 | edge-case | warn | yes | `tests/fixtures/runtime-large-payloads` is structurally valid but oversized. |
| target-04 | edge-case | pass | yes | `tests/fixtures/runtime-paginated` exercises paginated MCP list flows. |

## Commands Run

```bash
node dist/cli.js check examples/codex-doctor-runtime --json --runtime
node dist/cli.js check examples/codex-doctor-risky --json
node dist/cli.js check tests/fixtures/runtime-large-payloads --json --runtime
node dist/cli.js check tests/fixtures/runtime-paginated --json --runtime
```

## Findings Review

| Target | Finding ID | Severity | Classification | Notes |
| --- | --- | --- | --- | --- |
| target-02 | `plugin.security.hard_coded_secret` | fail | true_positive | Correctly identifies an unsafe literal secret-like env value. |
| target-03 | `plugin.runtime.tool_call.content_too_large` | warn | true_positive | Correctly flags a very large tool response. |
| target-03 | `plugin.runtime.resource_read.content_too_large` | warn | true_positive | Correctly flags a very large resource payload. |
| target-03 | `plugin.runtime.prompt_get.content_too_large` | warn | true_positive | Correctly flags an oversized prompt body. |

## Runtime Review

- `target-01`: full runtime scorecard passed as expected
- `target-02`: no runtime execution was needed to prove the static security failure
- `target-03`: runtime passed structurally and produced warn-level payload findings as intended
- `target-04`: paginated runtime scorecard passed as expected across tools/resources/templates/prompts

## Output Summary

| Target | Status | Exit Code | Scorecard Notes |
| --- | --- | --- | --- |
| target-01 | pass | 0 | all supported runtime capability checks passed |
| target-02 | fail | 1 | static secret finding correctly blocked the package |
| target-03 | warn | 0 | runtime contract valid, but payload-size warnings surfaced |
| target-04 | pass | 0 | pagination handling behaved correctly |

## False Positives

None observed in this bootstrap wave.

## False Negatives

None observed in this bootstrap wave for the tested scenarios.

## Unclear Findings

None in this wave.

## Tuning Recommendations

### High Priority

- run the next wave against at least one real external-like plugin package outside this repository

### Medium Priority

- validate whether the current payload-size thresholds feel right on real packages instead of synthetic large fixtures

### Low Priority

- improve the session process by saving raw JSON outputs beside the Markdown note when reviewing external packages

## Follow-Up Tasks

- [ ] select 3 external-like targets for wave 01
- [ ] run static and runtime validation on those targets
- [ ] classify any false positives or false negatives
- [ ] convert confirmed tuning needs into backlog work

