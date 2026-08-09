# Official Plugin Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Codex Plugin Doctor 1.58.0 with current official plugin package layout support, static manifest/app/hook validation, backward-compatible reports, and synchronized GitHub/npm releases.

**Architecture:** Add one pure MCP shape normalizer and migrate only package-source `.mcp.json` readers to it; destination client configs remain camel-case. Extend the existing validation pipeline with focused manifest/app and hook validators that perform bounded local reads and never execute plugin components. Feed new findings through the existing rule catalog, fingerprinting, reporters, release gates, and documentation.

**Tech Stack:** TypeScript 5.9, Node.js 22+, Vitest, npm, GitHub CLI, existing finding/report/release infrastructure.

---

## File map

- Create `src/core/mcp-config-normalizer.ts` for direct, snake-case, and legacy camel-case package layouts.
- Create `src/core/plugin-components.ts` for optional metadata, assets, and `.app.json` references.
- Create `src/core/plugin-hooks.ts` for hook source normalization and static schema validation.
- Modify `src/domain/types.ts`, `src/core/validate-plugin.ts`, all package-source MCP readers, rule metadata, public docs, and release metadata.
- Add focused unit tests plus integration coverage in existing command/runtime/security suites.
- Do not change destination client config readers, install snippet shape, registry install metadata, or scaffold output.

### Task 1: Pure MCP normalizer

**Files:**
- Create: `src/core/mcp-config-normalizer.ts`
- Create: `tests/mcp-config-normalizer.test.ts`

- [ ] **Step 1: Write failing tests for all source shapes**

```ts
const weather = { command: "node", args: ["server.js"] };
expect(normalizeMcpConfig({ weather })).toEqual({ ok: true, layout: "direct", servers: { weather } });
expect(normalizeMcpConfig({ mcp_servers: { weather } })).toEqual({ ok: true, layout: "snake_case_wrapper", servers: { weather } });
expect(normalizeMcpConfig({ mcpServers: { weather } })).toEqual({ ok: true, layout: "camel_case_wrapper", servers: { weather } });
expect(normalizeMcpConfig({ mcp_servers: { weather }, mcpServers: { weather } })).toEqual({ ok: false, issue: { code: "ambiguous_shape", field: "root" } });
```

Also cover wrapper plus direct key, empty maps, null/array roots, and sorted invalid server names.

- [ ] **Step 2: Run the test and confirm the missing-module failure**

Run: `npm test -- --run tests/mcp-config-normalizer.test.ts`

Expected: FAIL because the module is absent.

- [ ] **Step 3: Implement the minimal union and pure function**

```ts
export type McpServerConfig = Record<string, unknown>;
export type McpServerMap = Record<string, McpServerConfig>;
export type McpConfigLayout = "direct" | "snake_case_wrapper" | "camel_case_wrapper";
export type McpConfigNormalizationResult =
  | { ok: true; layout: McpConfigLayout; servers: McpServerMap }
  | { ok: false; issue:
      | { code: "ambiguous_shape"; field: "root" }
      | { code: "invalid_shape"; field: "root" | "mcp_servers" | "mcpServers" | "server"; invalidServerNames?: string[] }
    };

export function normalizeMcpConfig(value: unknown): McpConfigNormalizationResult;
```

Implementation order: reject non-object root; reserve both wrapper keys; reject two wrappers or wrapper plus another key; select one source map; reject empty/non-object map; collect and sort non-object server names; return the normalized map only on complete success.

- [ ] **Step 4: Run the focused test**

Expected command/result: `npm test -- --run tests/mcp-config-normalizer.test.ts` passes.

- [ ] **Step 5: Commit**

```text
git add src/core/mcp-config-normalizer.ts tests/mcp-config-normalizer.test.ts
git commit -m "feat: normalize official MCP config layouts"
```

### Task 2: Static validator, generic doctor, and security

**Files:**
- Modify: `src/core/validate-plugin.ts`
- Modify: `src/mcp/generic-mcp-doctor.ts`
- Modify: `src/security/security-audit.ts`
- Modify: `src/rules/rule-catalog.ts`
- Modify: `tests/check-command.test.ts`, `tests/mcp-command.test.ts`, `tests/security-command.test.ts`, `tests/rule-catalog.test.ts`
- Create fixtures: `tests/fixtures/valid-plugin-with-mcp-direct/`, `tests/fixtures/valid-plugin-with-mcp-snake-case/`, `tests/fixtures/mcp-config-ambiguous/`

- [ ] **Step 1: Add fixtures and failing parity tests**

Each manifest points `mcpServers` at `./.mcp.json`. Direct fixture content:

```json
{ "weather": { "command": "node", "args": ["server.js"] } }
```

Snake-case content:

```json
{ "mcp_servers": { "weather": { "command": "node", "args": ["server.js"] } } }
```

Assert both pass static/generic checks and receive the same security findings as the existing legacy fixture. Assert ambiguous input emits `plugin.mcp.ambiguous_shape` and is never partially audited.

- [ ] **Step 2: Run tests and observe wrapper-only failures**

Run: `npm test -- --run tests/check-command.test.ts tests/mcp-command.test.ts tests/security-command.test.ts tests/rule-catalog.test.ts`

- [ ] **Step 3: Normalize immediately after existing JSON parsing**

```ts
const normalized = normalizeMcpConfig(parsedConfig);
if (!normalized.ok && normalized.issue.code === "ambiguous_shape") {
  return [buildFailure("plugin.mcp.ambiguous_shape", "The MCP config mixes multiple top-level layout forms.", "Ambiguous server maps cannot be interpreted consistently.", "Use exactly one direct map, `mcp_servers`, or legacy `mcpServers` layout.", { configPath, field: "root" })];
}
if (!normalized.ok) return [existingInvalidShapeFinding];
const servers = normalized.servers;
```

Keep `auditMcpServerConfig` raw-input compatible and normalize internally. Add the new fail-level rule with full summary/why/fix metadata. Preserve existing invalid JSON/shape rule IDs and severities.

- [ ] **Step 4: Re-run focused tests and commit**

Expected: the Step 2 command passes.

Commit: `feat: validate official MCP package layouts`

### Task 3: Compatibility, runtime, and inspector migration

**Files:**
- Modify: `src/compatibility/compatibility-matrix.ts`
- Modify: four `src/compatibility/*-install-preview.ts` files
- Modify: `src/core/runtime-plan.ts`, `src/core/runtime-probe.ts`, `src/core/inspector-bridge.ts`
- Modify: `tests/cli-command.test.ts`, `tests/runtime-plan-command.test.ts`, `tests/runtime-protocol.test.ts`, `tests/inspector-command.test.ts`

- [ ] **Step 1: Add failing source-layout parity tests**

For direct and snake-case packages assert Generic MCP passes, duplicate-name detection sees `weather`, every client preview emits `{ mcpServers: { weather: ... } }`, runtime plans/probes see the same server, and Inspector lists `weather`. Ambiguous input must produce no executable plan.

- [ ] **Step 2: Run focused tests**

Run: `npm test -- --run tests/cli-command.test.ts tests/runtime-plan-command.test.ts tests/runtime-protocol.test.ts tests/inspector-command.test.ts`

- [ ] **Step 3: Replace source shape reads**

```ts
const normalized = normalizeMcpConfig(parsed);
if (!normalized.ok) throw new Error("MCP config does not contain one unambiguous non-empty server map.");
const servers = normalized.servers;
```

Runtime returns no servers on normalization failure because static validation blocks execution. Preview output re-wraps normalized input with destination `mcpServers`. Do not modify target-client parsers, `apply-install-preview.ts`, registry metadata, or scaffold templates.

- [ ] **Step 4: Re-run tests and commit**

Expected: Step 2 passes. Commit: `feat: use normalized MCP layouts across workflows`.

### Task 4: Manifest metadata and `.app.json`

**Files:**
- Modify: `src/domain/types.ts`, `src/core/validate-plugin.ts`
- Create: `src/core/plugin-components.ts`, `tests/plugin-components.test.ts`

- [ ] **Step 1: Write failing tests**

Cover author, homepage/repository, license, keywords, interface string/string-array fields, `./` asset paths, malformed types, traversal, symlink escape, missing app, and invalid app JSON. A parseable scalar/array/object `.app.json` must pass because its internal schema is not published.

- [ ] **Step 2: Run the missing-module failure**

Run: `npm test -- --run tests/plugin-components.test.ts`

- [ ] **Step 3: Extend untrusted manifest fields**

```ts
author?: unknown; homepage?: unknown; repository?: unknown; license?: unknown;
keywords?: unknown; apps?: unknown; hooks?: unknown; interface?: unknown;
```

- [ ] **Step 4: Implement `validatePluginComponents`**

```ts
export async function validatePluginComponents(discoveredPackage: DiscoveredPackage): Promise<Finding[]>;
```

Validate optional fields only when present. Component/asset paths must be strings starting `./`, resolve inside the plugin root, and for existing targets remain inside the canonical root after `realpath`. Evidence keeps package-relative paths only. `apps` requires a regular file and parseable JSON; parsed content remains `unknown` and receives no inferred field/cardinality checks. Use approved `plugin.manifest.*` and `plugin.app.*` IDs. No network or process calls.

- [ ] **Step 5: Wire, test, and commit**

Run: `npm test -- --run tests/plugin-components.test.ts tests/check-command.test.ts`

Expected: PASS. Commit: `feat: validate official plugin components`.

### Task 5: Lifecycle hook validation

**Files:**
- Modify: `src/domain/types.ts`, `src/core/validate-plugin.ts`, `src/security/security-audit.ts`
- Create: `src/core/plugin-hooks.ts`, `tests/plugin-hooks.test.ts`
- Modify: `tests/security-command.test.ts`

- [ ] **Step 1: Add documented types and failing tests**

```ts
export const pluginHookEvents = ["PreToolUse", "PermissionRequest", "PostToolUse", "PreCompact", "PostCompact", "UserPromptSubmit", "SubagentStop", "Stop", "SessionStart", "SubagentStart", "SessionEnd"] as const;
export type PluginHookEvent = typeof pluginHookEvents[number];
export interface PluginHookConfig {
  description?: string;
  hooks: Partial<Record<PluginHookEvent, unknown>>;
}
export type PluginHooks = string | string[] | PluginHookConfig | PluginHookConfig[];
```

Test all four union forms, optional default `hooks/hooks.json`, mixed arrays, invalid events/groups/handlers, ignored Stop/UserPromptSubmit matchers, skipped prompt/agent handlers, async warnings, and `SessionEnd.timeout > 3`. Spy on child process spawn and require zero calls.

- [ ] **Step 2: Run failing hook tests**

Run: `npm test -- --run tests/plugin-hooks.test.ts`

- [ ] **Step 3: Implement `validatePluginHooks`**

```ts
export async function validatePluginHooks(discoveredPackage: DiscoveredPackage): Promise<Finding[]>;
```

Absent manifest hooks discovers the default only when the file exists. Path sources require homogeneous string arrays and safe `./` paths; inline sources require homogeneous plain-object arrays. Validate documented event names, matcher-group arrays, handler arrays, command handler primitives, and timeout bounds. Warn rather than fail for host-parsed-but-skipped prompt/agent handlers, async commands, and ignored matchers.

- [ ] **Step 4: Reuse static security detectors**

```ts
export function auditHookCommand(rootPath: string, sourcePath: string, event: string, command: string): Finding[];
```

Check command and commandWindows for encoded commands and remote-content-to-shell. Reuse existing security IDs and retain only relative source/event evidence. A normal hook command is not warned merely because hooks are shell-based.

- [ ] **Step 5: Wire, test, and commit**

Run: `npm test -- --run tests/plugin-hooks.test.ts tests/security-command.test.ts tests/check-command.test.ts`

Expected: PASS, no spawned process. Commit: `feat: validate plugin lifecycle hooks`.

### Task 6: Catalog, reports, and public docs

**Files:**
- Modify: `src/rules/rule-catalog.ts`, `docs/rules/catalog.md`, `docs/README.md`, `README.md`
- Create: `docs/architecture/official-plugin-components.md`
- Modify: `tests/rule-catalog.test.ts`, `tests/public-readiness.test.ts`, `tests/contract-command.test.ts`, `tests/cli-command.test.ts`

- [ ] **Step 1: Add failing public-contract assertions**

Require every new MCP/manifest/app/hook ID in the catalog and public table. Assert text, Markdown, JSON, and SARIF include relative evidence without changing schema versions.

```text
plugin.mcp.ambiguous_shape
plugin.manifest.invalid_field
plugin.manifest.invalid_path
plugin.app.missing_file
plugin.app.invalid_json
plugin.app.invalid_path
plugin.hook.missing_file
plugin.hook.invalid_json
plugin.hook.invalid_shape
plugin.hook.invalid_path
plugin.hook.unsupported_event
plugin.hook.unsupported_handler
plugin.hook.async_unsupported
plugin.hook.matcher_ignored
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- --run tests/rule-catalog.test.ts tests/public-readiness.test.ts tests/contract-command.test.ts tests/cli-command.test.ts`

- [ ] **Step 3: Add complete metadata and docs**

Document the three package layouts, ambiguity failure, destination-client camel-case boundary, optional metadata/app/hook validation, default hooks, supported events, unpublished `.app.json` schema boundary, and absolute non-execution guarantee. Keep implementation planning out of public `docs/`.

- [ ] **Step 4: Re-run tests and commit**

Expected: Step 2 passes. Commit: `docs: document official plugin validation`.

### Task 7: Release metadata for 1.58.0

**Files:**
- Modify: `CHANGELOG.md`, `package.json`, `package-lock.json`, `README.md`, `docs/guides/github-action.md`
- Modify: `tests/release-sync.test.ts`, `tests/release-check.test.ts`, `tests/release-notes.test.ts`

- [ ] **Step 1: Restore verified 1.56.0 and 1.57.0 history**

1.56.0 records `doctor size`, total/file/top-ten/large-file output, thresholds, and public exports. 1.57.0 records `doctor size --npm`, publish-size comparison, and repeatable `check --fail-on`. Add 1.58.0 with official layouts, static components/hooks, security, and non-execution boundaries.

- [ ] **Step 2: Bump version sources**

Run: `npm version 1.58.0 --no-git-tag-version`

Expected: package and both lockfile root versions become 1.58.0 with no tag/commit.

- [ ] **Step 3: Update active 1.57.0 Action pins to 1.58.0**

Historical changelog text stays unchanged. Add release metadata regression assertions.

- [ ] **Step 4: Test and commit**

Run: `npm test -- --run tests/release-sync.test.ts tests/release-check.test.ts tests/release-notes.test.ts`

Expected: PASS. Commit: `chore: prepare v1.58.0 release`.

### Task 8: Independent reviews and release gates

**Files:** Review all changes from `ee43df1` to `HEAD`.

- [ ] **Step 1: Independent spec review**

Compare every accepted design criterion with code/tests. Fix validated gaps with targeted tests and a focused commit.

- [ ] **Step 2: Independent quality/security review**

Review containment/symlinks, fail-closed ambiguity, evidence redaction, hook non-execution, parser duplication, client output compatibility, and release metadata. Fix validated findings only.

- [ ] **Step 3: Run targeted tests**

Run all new tests plus check, MCP, security, compatibility, runtime plan/protocol, Inspector, catalog, public readiness, contract, and release suites. Expected: all pass except documented environment-dependent skips.

- [ ] **Step 4: Run repository gates**

```text
npm test
npm run build
npm pack --dry-run
npm audit --omit=dev --audit-level=high
git diff --check ee43df1..HEAD
```

Expected: zero failures, intended package contents, no high production vulnerability, no whitespace errors.

- [ ] **Step 5: Require clean committed tree and run `npm run release-check`**

Expected: unpublished version, absent tag, tests/build/metadata/security/pack/temp-install audit/publish-dry-run all pass.

### Task 9: Merge and publish

**Systems:** feature branch, GitHub `Esquetta/CodexPluginDoctor`, npm `codex-plugin-doctor`.

- [ ] **Step 1: Read-only auth and collision preflight**

Run `gh auth status`, `npm whoami`, and `npm view codex-plugin-doctor@1.58.0 version`. Require authorized identities and exact-version absence. Current npm status is E401; if still unauthorized, stop before tag/release/publish and request credential restoration.

- [ ] **Step 2: Push branch, create ready PR, wait for checks, merge with merge commit**

Use `git push -u origin feature/v1.58-official-plugin-compatibility`, `gh pr create`, `gh pr checks --watch`, and `gh pr merge --merge`. Fetch and verify `origin/main` contains reviewed commits.

- [ ] **Step 3: Re-run release-check in a clean worktree at merged `origin/main`**

Expected: identical passing gate on the exact commit to tag.

- [ ] **Step 4: Tag and push verified commit**

Create annotated `v1.58.0`, verify tagged package version, then push the tag.

- [ ] **Step 5: Create draft GitHub Release from the 1.58.0 changelog section**

Title: `Codex Plugin Doctor 1.58.0`; draft true; prerelease false.

- [ ] **Step 6: Publish npm exactly once**

Run `npm publish --access public` from the clean verified release worktree. Do not retry a successful immutable publish.

- [ ] **Step 7: Publish GitHub Release and verify synchronization**

Run `gh release edit v1.58.0 --draft=false --latest`, `npm run verify-release-sync`, and `npx --yes codex-plugin-doctor@1.58.0 --version`. Require npm latest, remote tag, GitHub release/latest pointer, and fresh CLI output all equal 1.58.0.

- [ ] **Step 8: Report and clean only v1.58 worktrees**

Report PR, merge SHA, tag, GitHub Release URL, npm version, and verification evidence. Preserve the original checkout's pre-existing package-lock change.
