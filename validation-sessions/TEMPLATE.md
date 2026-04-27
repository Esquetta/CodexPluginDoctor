# Real-World Validation Session

## Session Info

- Date:
- Validator version:
- Operator:
- Notes visibility:
  - internal only
  - safe to share

## Targets

| Label | Type | Expected Outcome | Runtime Enabled | Notes |
| --- | --- | --- | --- | --- |
| target-01 | healthy | pass | yes | |
| target-02 | broken | fail | yes | |
| target-03 | edge-case | warn/pass | yes | |

## Commands Run

```bash
codex-plugin-doctor check <target>
codex-plugin-doctor check <target> --json --runtime --verbose-runtime
```

## Findings Review

| Target | Finding ID | Severity | Classification | Notes |
| --- | --- | --- | --- | --- |
| target-01 | example.finding | warn | false_positive | |

Classification values:

- `true_positive`
- `false_positive`
- `unclear`
- `missing_expected_finding`

## Runtime Review

- Did initialize behave as expected:
- Did tools list/call behave as expected:
- Did resources probing behave as expected:
- Did prompts probing behave as expected:
- Any transcript confusion:

## Tuning Recommendations

### High Priority

- 

### Medium Priority

- 

### Low Priority

- 

## Follow-Up Tasks

- [ ] Convert confirmed issues into repo backlog
- [ ] Add regression fixture if needed
- [ ] Re-run after fixes

