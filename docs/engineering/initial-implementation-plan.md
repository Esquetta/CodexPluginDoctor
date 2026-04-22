# Codex Plugin Doctor Initial Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first working repository scaffold, a minimal `check` CLI command, and fixture-based tests for package discovery and manifest validation.

**Architecture:** The first slice is a TypeScript CLI with a small domain model, one package discovery path, one manifest validation rule set, and two output modes. The code stays modular so future runtime probing and MCP-specific rules can slot into the same pipeline without rewriting the command surface.

**Tech Stack:** Node.js 22, TypeScript, Vitest, npm

---

### Task 1: Repository Bootstrap

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`

- [ ] Add Node/TypeScript/Vitest project metadata and scripts.
- [ ] Add CLI package metadata and initial `bin` target.
- [ ] Add base repository README and ignore rules.

### Task 2: Failing Validation Tests

**Files:**
- Create: `tests/check-command.test.ts`
- Create: `tests/fixtures/valid-plugin/.codex-plugin/plugin.json`
- Create: `tests/fixtures/valid-plugin/skills/hello/SKILL.md`
- Create: `tests/fixtures/missing-manifest/README.md`

- [ ] Write tests for missing manifest failure behavior.
- [ ] Write tests for valid plugin pass behavior.
- [ ] Run tests and confirm failure due to missing implementation.

### Task 3: Core Validation Engine

**Files:**
- Create: `src/domain/types.ts`
- Create: `src/core/discover-package.ts`
- Create: `src/core/validate-plugin.ts`
- Create: `src/reporting/render-text-report.ts`

- [ ] Implement package discovery and manifest loading.
- [ ] Implement minimal required-field validation.
- [ ] Implement text report rendering.

### Task 4: CLI Command

**Files:**
- Create: `src/index.ts`
- Create: `src/cli.ts`

- [ ] Implement `check` command argument parsing.
- [ ] Connect validation engine to CLI output.
- [ ] Return deterministic exit codes.

### Task 5: Green Test Verification

**Files:**
- Modify: `tests/check-command.test.ts`
- Modify: `src/**/*`

- [ ] Run tests and verify green state.
- [ ] Run the CLI against the provided fixtures.
- [ ] Document immediate next backlog items.

