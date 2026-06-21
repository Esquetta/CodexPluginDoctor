# Real-World Validation Checklist

## Before Running

- choose at least 3 evaluation targets
- confirm each target can be read safely on the current machine
- decide whether package names should be anonymized in notes
- note the validator version under test

## For Each Target

- run static validation
- run runtime validation
- save JSON report
- save Markdown summary if useful
- review transcript if runtime was enabled

## For Each Finding

- is the finding correct
- is the severity correct
- is the message clear
- is the suggested fix useful
- would a user understand what to do next

## For Missing Findings

- did the validator miss a real issue
- was the issue structural, security-related, or runtime-related
- can it be reproduced in a controlled fixture

## Session Wrap-Up

- list false positives
- list false negatives
- list unclear findings
- list runtime transcript pain points
- list candidate threshold changes
- convert confirmed improvements into backlog tasks

## Exit Condition

A validation wave is complete when:

- all targets were reviewed
- findings were classified
- tuning actions were recorded
- no unclassified surprises remain

