# Ops, Support, and SLA

## Operating Model

The initial product is CLI-first and open core, so operations should stay lean. The goal is to make the product easy to self-serve and easy to support without a large human services burden.

## Support Model

### Community Tier

- GitHub issues
- public documentation
- sample fixtures and example reports

### Paid Team Tier

- prioritized issue response
- private support channel
- guidance on CI rollout and rule tuning

## Support Objectives

- fast diagnosis of broken validation behavior
- consistent reproduction against fixtures
- clear rule documentation
- minimal back-and-forth for common package issues

## Incident Types

- CLI runtime crash
- false positive or false negative rule behavior
- package parsing regression
- report rendering corruption
- release packaging issue

## Internal Response Guidelines

### Severity 1

The CLI cannot run or corrupts reports.

Target response: same business day.

### Severity 2

Blocking false positives or runtime regressions affecting many users.

Target response: next business day.

### Severity 3

Documentation gaps, edge-case bugs, non-blocking report issues.

Target response: standard backlog flow.

## SLA Guidance for Paid Plans

Indicative targets:

- initial response within `1 business day`
- production bug workaround within `3 business days`
- critical release blocker triage within `same day`

These should remain commercial commitments only after the hosted service and support capacity are mature.

## Documentation Operations

- keep rule catalog versioned
- maintain release notes per version
- publish migration guidance for major rule changes

