# CLI Presentation Plan

## Purpose

This document defines how Codex Plugin Doctor can evolve from a functional validator into a polished terminal tool without breaking machine-readable output, CI behavior, or accessibility.

The goal is not to add decoration for its own sake. The goal is to make long-running validation feel more trustworthy, legible, and premium while keeping `--json`, `--markdown`, and file outputs deterministic.

## Design Thesis

The CLI should support two fundamentally different output modes:

- `machine mode`: stable, non-animated, pipe-safe output for JSON, Markdown, files, CI, and redirected streams
- `interactive mode`: TTY-aware status rendering for humans using a live terminal

This separation is the core architectural rule. If we violate it, the product becomes noisy and unreliable.

## External References

Two useful references informed this plan:

- `DAB - Draw & Animate Braille`: useful for designing bespoke braille frame sequences and exporting them as JavaScript frame arrays for CLI use
- `unicode-animations`: a strong reference for a minimal frame model based on `{ frames, interval }` and simple terminal spinner rendering

## Recommendation

### Use Internal Frame Data, Not a Runtime Dependency

For Codex Plugin Doctor, the best first step is to adopt the `unicode-animations` data model, not necessarily the package itself.

Recommended internal model:

```ts
type SpinnerDefinition = {
  name: string;
  frames: string[];
  intervalMs: number;
};
```

Why:

- avoids adding a dependency for a small amount of static data
- keeps bundle and maintenance surface small
- makes it easy to add custom branded braille animations later
- gives us exact control over fallback behavior and naming

### Use DAB as a Design Tool, Not as a Runtime Component

DAB is most valuable as an offline animation authoring tool. It is ideal for creating a branded loading or scan animation and exporting the result as frame arrays. It should not be a runtime dependency.

## Product Requirements

### Core Requirements

- animations must never contaminate JSON output
- animations must never contaminate Markdown output
- animations must never pollute redirected output files
- default behavior must be safe in CI and `TERM=dumb`
- users must be able to disable animation explicitly

### UX Requirements

- human-readable mode should feel fast and intentional
- warn/fail summaries should be easy to scan
- stage transitions should be visible during runtime probing
- the UI should preserve a professional developer-tool tone

## Proposed Output Modes

### `auto` (default)

- rich TTY output if terminal supports it
- plain output otherwise

### `plain`

- no animation
- simple text lines

### `ascii`

- no unicode-only glyph dependency
- simple ASCII indicators for broader compatibility

### `machine`

- enabled implicitly for `--json`, `--markdown`, redirected output, or CI-safe workflows

## Proposed Flags

- `--pretty auto|always|never`
- `--ascii`
- `--no-animations`
- `--spinner <name>`

The initial implementation does not need all of these at once. The right order is:

1. `auto` behavior
2. `--no-animations`
3. `--ascii`
4. spinner selection only if the presentation layer proves valuable

## Architecture

### 1. Terminal Capability Detector

Responsibility:

- determine whether output is a TTY
- detect `CI`, `TERM=dumb`, and redirected streams
- decide whether unicode/animation should be enabled

### 2. Spinner Registry

Responsibility:

- store built-in frame sets
- expose frame data using a stable internal contract
- provide `braille`, `dots`, `scan`, and `ascii` variants

### 3. Live Status Renderer

Responsibility:

- write transient progress lines to `stderr`
- start, update, and stop a spinner
- emit final checkmarks or failure markers

Writing transient UI to `stderr` is important because it keeps `stdout` usable for report output and piping.

### 4. Summary Renderer

Responsibility:

- render final human-facing summary cards
- use minimal ASCII/Unicode structure
- keep severity sections readable without overdesign

### 5. Branded Animation Assets

Responsibility:

- store custom DAB-derived braille sequences
- support a short startup animation or phase transition
- remain optional and easy to disable

## Visual Direction

The terminal style should feel:

- precise
- premium
- quiet
- engineering-first

It should not feel:

- game-like
- flashy
- over-animated
- emotionally loud

### Recommended Terminal Language

- short stage labels
- subtle animation
- compact summary blocks
- reserved use of glyphs such as `•`, `→`, `✔`, `!`

## Implementation Phases

### Phase 1: Safe Foundation

- add capability detection
- add spinner registry
- add stderr-only live status renderer
- add `--no-animations`

### Phase 2: Human Summary Polish

- add richer final summary block
- add warn/fail grouping with compact tables
- add ASCII fallback rendering

### Phase 3: Branded Motion

- add one short branded braille animation derived from DAB
- use it only at startup or between phases
- keep runtime spinners simple and readable

### Phase 4: Optional Presentation Expansion

- named spinner selection
- per-stage animation presets
- optional richer section borders or compact cards

## Testing Requirements

- snapshot tests for interactive summaries
- ANSI stripping in snapshot comparisons
- explicit tests that JSON/Markdown outputs never contain animation frames
- tests that redirected output remains clean
- tests for `CI` and `TERM=dumb` fallbacks

## Risks

### Risk 1: Polluted Output

Animated output can break scripts, files, or summaries if written to the wrong stream.

Mitigation:

- treat `stdout` as report output
- keep live terminal rendering on `stderr`

### Risk 2: Terminal Compatibility

Not every terminal renders braille or unicode cleanly.

Mitigation:

- add ASCII fallback
- gate rich output behind capability detection

### Risk 3: UX Noise

Too much motion makes a serious tool feel gimmicky.

Mitigation:

- keep animation subtle
- reserve branded motion for short moments

## Final Recommendation

Yes, CLI-side visual polish is worth doing.

But the correct version is:

`a disciplined TTY presentation layer with optional animation`

not:

`random animated output everywhere`

The best immediate roadmap is:

1. capability-aware spinner/status system
2. better human summary rendering
3. branded braille sequence designed with DAB

