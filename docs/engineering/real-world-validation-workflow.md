# Real-World Validation Workflow

## Purpose

Codex Plugin Doctor is feature-rich enough that the next meaningful quality step is not more synthetic fixtures. It is disciplined evaluation against real or realistic plugin packages.

This workflow defines how to:

- select external-like plugin packages
- run repeatable validation passes
- classify findings
- identify false positives and false negatives
- turn results into rule tuning work

## Core Goal

Move from `lab-clean correctness` to `field-tested confidence`.

## Evaluation Principles

- test packages that look like actual user packages, not just minimal fixtures
- prefer a small number of high-quality evaluation targets over a large noisy set
- separate structural failures from validator mistakes
- capture evidence for every tuning decision
- avoid changing rules based on one ambiguous package

## Recommended Package Mix

Run each validation cycle against at least three targets:

1. `Healthy package`
   A package you expect to pass with no findings or only acceptable warnings.

2. `Broken but realistic package`
   A package with real packaging or runtime mistakes, not artificially trivial failures.

3. `Edge-case package`
   A package that is technically valid but unusual enough to pressure-test heuristics and runtime probing.

## Validation Sequence

### 1. Static Pass

Run:

```bash
codex-plugin-doctor check <target>
```

Capture:

- status
- finding IDs
- whether each finding is clearly correct

### 2. Runtime Pass

Run:

```bash
codex-plugin-doctor check <target> --json --runtime --verbose-runtime
```

Capture:

- runtime scorecard
- protocol transcript
- whether runtime findings reflect actual server behavior

### 3. Human Review

For each finding, classify it as:

- `true_positive`
- `false_positive`
- `unclear`
- `missing_expected_finding`

### 4. Tuning Output

Turn the session into:

- one summary document
- a list of tuning tasks
- any needed fixture additions for regressions

## Decision Rules

### Fix Immediately

- repeatable false positives on valid packages
- repeatable false negatives on clearly broken packages
- transcript output that hides important debugging evidence
- destructive probe behavior that feels unsafe

### Wait for More Evidence

- one-off edge cases
- subjective heuristic disagreements
- packages that violate spec in ambiguous ways

## Evidence Format

Every evaluation should capture:

- package name or anonymized label
- source type:
  - internal
  - public example
  - customer-like
- commands run
- output summary
- finding review table
- tuning recommendation

## Success Criteria

This workflow is successful when:

- valid packages stop producing surprising false alarms
- broken packages fail for the right reasons
- runtime scorecards align with actual protocol behavior
- tuning decisions are documented rather than ad hoc

## Relationship to Release Decisions

A public release should not be driven only by passing fixture tests. It should be supported by at least one full validation wave against real-world-like packages using this workflow.

