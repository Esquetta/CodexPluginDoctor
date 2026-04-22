# CLI Presentation Issue Breakdown

## Objective

Track the next product slice for terminal UX, animation safety, and richer human-facing CLI output.

## Proposed Issues

### Issue A: Add terminal capability detection and output policy

Scope:

- detect TTY vs redirected output
- detect CI-safe fallback conditions
- decide when interactive output is allowed

### Issue B: Add a spinner registry and stderr status renderer

Scope:

- internal `{ frames, intervalMs }` registry
- start/update/stop lifecycle
- keep `stdout` clean for reports

### Issue C: Add `--no-animations` and ASCII fallback

Scope:

- explicit disable flag
- ASCII-safe rendering mode
- tests for fallback behavior

### Issue D: Add richer final CLI summary blocks

Scope:

- improve human-facing terminal summary
- compact severity sections
- keep machine modes unchanged

### Issue E: Add branded braille animation assets

Scope:

- create one short startup or phase transition animation
- derive frames from DAB
- keep the animation optional and minimal

### Issue F: Add CI-safe presentation tests

Scope:

- snapshot tests
- ANSI-stripped comparisons
- ensure `--json` and `--markdown` remain animation-free

