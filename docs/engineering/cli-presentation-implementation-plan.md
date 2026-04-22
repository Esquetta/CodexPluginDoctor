# CLI Presentation Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a safe terminal presentation foundation with TTY-aware output policy and a minimal stderr spinner/status renderer.

**Architecture:** This slice introduces a small terminal subsystem with three responsibilities: decide whether interactive rendering is allowed, provide internal spinner frame definitions, and render transient live status to `stderr` while keeping `stdout` clean for final reports. The CLI will only enable this layer in human-facing TTY scenarios and will automatically disable it for JSON, Markdown, CI, redirected output, and non-TTY contexts.

**Tech Stack:** Node.js 22, TypeScript, Vitest, npm

---

### Task 1: Terminal Policy Tests

**Files:**
- Create: `tests/output-policy.test.ts`
- Create: `src/terminal/output-policy.ts`

- [ ] Add tests for TTY interactive eligibility in normal terminal use.
- [ ] Add tests for disabling interactive mode in CI, machine output, and redirected output.
- [ ] Run the focused test file and confirm it fails before implementation.

### Task 2: Spinner Registry and Renderer Tests

**Files:**
- Create: `tests/live-status-renderer.test.ts`
- Create: `src/terminal/spinner-registry.ts`
- Create: `src/terminal/live-status-renderer.ts`

- [ ] Add tests for built-in spinner availability.
- [ ] Add tests for starting, updating, and stopping stderr status rendering.
- [ ] Run the focused tests and confirm failure before implementation.

### Task 3: CLI Integration

**Files:**
- Modify: `src/run-cli.ts`
- Modify: `tests/cli-command.test.ts`

- [ ] Add CLI dependency injection points needed for deterministic testing.
- [ ] Add a runCli integration test that verifies interactive status goes to stderr while final output stays on stdout.
- [ ] Run the focused CLI test and confirm it fails before implementation.

### Task 4: Minimal Implementation

**Files:**
- Modify: `src/terminal/output-policy.ts`
- Modify: `src/terminal/spinner-registry.ts`
- Modify: `src/terminal/live-status-renderer.ts`
- Modify: `src/run-cli.ts`

- [ ] Implement output policy detection with conservative defaults.
- [ ] Implement a minimal internal spinner registry.
- [ ] Implement a simple stderr live status renderer.
- [ ] Wire the renderer into runCli only for interactive human-mode runs.

### Task 5: Verification

**Files:**
- Modify: `tests/**/*.ts`
- Modify: `src/**/*.ts`

- [ ] Run `npm test` and verify the full suite passes.
- [ ] Run `npm run build` and verify it succeeds.
- [ ] Run a smoke check through the built CLI to confirm no machine outputs are polluted.

