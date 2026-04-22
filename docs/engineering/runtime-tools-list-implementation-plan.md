# Runtime Tools List Probe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade runtime validation from simple startup/liveness checks to a real MCP stdio protocol probe that performs `initialize`, sends `notifications/initialized`, and validates `tools/list`.

**Architecture:** The runtime probe will remain command-server only for now, but will move from "process stayed alive" semantics to "process completed a valid protocol handshake" semantics. The implementation will introduce a newline-delimited JSON-RPC client for stdio servers, validate initialization and `tools/list` responses against the MCP schema shape, and return targeted findings for malformed or incomplete protocol behavior.

**Tech Stack:** Node.js 22, TypeScript, Vitest, npm

---

### Task 1: Protocol Fixture Tests

**Files:**
- Create: `tests/runtime-protocol.test.ts`
- Create: `tests/fixtures/runtime-invalid-initialize/.codex-plugin/plugin.json`
- Create: `tests/fixtures/runtime-invalid-initialize/.mcp.json`
- Create: `tests/fixtures/runtime-invalid-initialize/mock-server.js`
- Create: `tests/fixtures/runtime-invalid-tools/.codex-plugin/plugin.json`
- Create: `tests/fixtures/runtime-invalid-tools/.mcp.json`
- Create: `tests/fixtures/runtime-invalid-tools/mock-server.js`
- Modify: `tests/fixtures/runtime-valid/mock-server.js`

- [ ] Add a passing test for a server that completes initialize and returns valid `tools/list`.
- [ ] Add a failing test for malformed initialize results.
- [ ] Add a failing test for malformed `tools/list` results.
- [ ] Run the focused runtime tests and confirm failure before implementation.

### Task 2: Protocol Client

**Files:**
- Modify: `src/core/runtime-probe.ts`

- [ ] Add newline-delimited JSON-RPC message sending and receiving for stdio transport.
- [ ] Add `initialize` request generation with client info and protocol version.
- [ ] Add `notifications/initialized` after successful initialize.
- [ ] Add `tools/list` request and result validation.

### Task 3: Validation Semantics

**Files:**
- Modify: `src/core/runtime-probe.ts`
- Modify: `tests/cli-command.test.ts`

- [ ] Keep early-exit and startup-failure findings intact.
- [ ] Add new finding IDs for initialize and tools-list protocol failures.
- [ ] Verify existing CLI runtime tests still pass after the deeper protocol check.

### Task 4: Verification

**Files:**
- Modify: `tests/**/*.ts`
- Modify: `src/**/*.ts`

- [ ] Run `npm test` and confirm the full suite is green.
- [ ] Run `npm run build`.
- [ ] Run smoke checks through `dist/cli.js` for valid and invalid protocol fixtures.

