import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import type { CheckResult, RuntimeScorecard } from "../src/domain/types.js";
import { buildMarkdownReport } from "../src/reporting/render-markdown-report.js";

describe("buildMarkdownReport", () => {
  const runtimeScorecard: RuntimeScorecard = {
    initialize: "pass",
    toolsList: "pass",
    toolsCall: "pass",
    resourcesList: "pass",
    resourceRead: "pass",
    resourceTemplatesList: "pass",
    promptsList: "pass",
    promptGet: "pass",
    conformance: {
      protocolVersion: "2025-11-25",
      profile: "2025-11-25",
      capabilityConsistency: "pass",
      taskDeclarations: "pass",
      tasksList: "pass",
      schemaDialect: "pass",
      overall: "pass"
    }
  };

  function expectRuntimeScorecardWithConformance(report: string) {
    expect(report).toContain("## Runtime Scorecard");
    expect(report).toContain("| initialize | PASS |");
    expect(report).toContain("| prompts/get | PASS |");
    expect(report).toContain("## MCP Conformance");
    expect(report).toContain("| Protocol version | 2025-11-25 |");
    expect(report).toContain("| Profile | 2025-11-25 |");
    expect(report).toContain("| Capability consistency | PASS |");
    expect(report).toContain("| Task declarations | PASS |");
    expect(report).toContain("| Tasks list | PASS |");
    expect(report).toContain("| Schema dialect | PASS |");
    expect(report).toContain("| Overall | PASS |");
    expect(report).not.toContain("private-task-id");
  }

  it("renders runtime scorecard and MCP Conformance before no-findings output", () => {
    const report = buildMarkdownReport(
      {
        targetPath: "example",
        status: "pass",
        exitCode: 0,
        findings: [],
        runtimeScorecard
      },
      { runtimeProbeEnabled: true }
    );

    expectRuntimeScorecardWithConformance(report);
    expect(report.indexOf("## Runtime Scorecard")).toBeLessThan(
      report.indexOf("No findings.")
    );
  });

  it("renders one MCP Conformance section alongside findings", () => {
    const report = buildMarkdownReport(
      {
        targetPath: "example",
        status: "fail",
        exitCode: 1,
        runtimeScorecard,
        findings: [
          {
            id: "plugin.manifest.missing",
            severity: "fail",
            message: "Missing manifest.",
            impact: "Codex cannot load the package.",
            suggestedFix: "Create `.codex-plugin/plugin.json`."
          }
        ]
      },
      { runtimeProbeEnabled: true }
    );

    expectRuntimeScorecardWithConformance(report);
    expect(report.match(/## MCP Conformance/g)).toHaveLength(1);
    expect(report).toContain("## Findings");
  });

  it("renders the remote MCP scorecard with enum-only session state", () => {
    const report = buildMarkdownReport({
      targetPath: "example",
      status: "pass",
      exitCode: 0,
      findings: [],
      runtimeScorecard: {
        ...runtimeScorecard,
        remote: { transport: "pass", networkSafety: "pass", initialize: "pass", contentType: "pass", session: "present-valid", protocolHeaders: "pass", authorization: "skipped", overall: "pass" }
      }
    }, { runtimeProbeEnabled: true });

    expect(report).toContain("## Remote MCP Scorecard");
    expect(report).toContain("| Session | PRESENT-VALID |");
  });

  it("renders remote reliability capability labels and statuses only", () => {
    const report = buildMarkdownReport({
      targetPath: "example",
      status: "pass",
      exitCode: 0,
      findings: [],
      runtimeScorecard: {
        ...runtimeScorecard,
        remote: {
          transport: "pass", networkSafety: "pass", initialize: "pass", contentType: "pass", session: "present-valid", protocolHeaders: "pass", authorization: "skipped", overall: "pass",
          reliability: { getSse: "pass", sessionPropagation: "pass", resumability: "skipped", disconnectSafety: "warn", sessionRestart: "skipped", termination: "skipped", overall: "warn" }
        }
      }
    }, { runtimeProbeEnabled: true });

    expect(report).toContain("## Remote Transport Reliability");
    expect(report).toContain("| GET SSE | PASS |");
    expect(report).toContain("| Disconnect safety | WARN |");
    expect(report).not.toMatch(/session-secret-sentinel|event-secret-sentinel|retry-secret-sentinel|body-secret-sentinel/);
  });

  it("renders a CI-friendly markdown summary", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-long-plugin-description");
    const result = await runCheck(targetPath);

    const report = buildMarkdownReport(result, { runtimeProbeEnabled: false });

    expect(report).toContain("# Codex Plugin Doctor Report");
    expect(report).toContain("Status | WARN");
    expect(report).toContain("plugin.heuristic.description.too_long");
    expect(report).not.toContain("Runtime backend:");
    expect(report).not.toContain("Runtime isolation:");
  });

  it("renders effective Docker runtime execution evidence", () => {
    const result: CheckResult = {
      targetPath: "/test/plugin",
      status: "pass",
      exitCode: 0,
      findings: [],
      runtimeExecution: {
        backend: "docker",
        image: "node:22-bookworm-slim@sha256:test",
        network: "none",
        packageMount: "read_only"
      }
    };

    const report = buildMarkdownReport(result, { runtimeProbeEnabled: true });

    expect(report).toContain("Runtime backend: DOCKER");
    expect(report).toContain(
      "Runtime isolation: network=none, package=read_only"
    );
  });

  it("renders finding evidence when present", async () => {
    const targetPath = path.resolve("tests/fixtures/security-hardcoded-secret");
    const result = await runCheck(targetPath);

    const report = buildMarkdownReport(result, { runtimeProbeEnabled: false });

    expect(report).toMatch(/- Fingerprint: `[a-f0-9]{64}`/);
    expect(report).toContain("- Evidence: serverName=dangerServer");
    expect(report).toContain("envKey=OPENAI_API_KEY");
    expect(report).toContain("envValue=[REDACTED]");
  });

  it("renders deduplicated next actions before findings", () => {
    const result: CheckResult = {
      targetPath: "example",
      status: "fail",
      exitCode: 1,
      findings: [
        {
          id: "plugin.manifest.missing",
          severity: "fail",
          message: "Missing manifest.",
          impact: "Codex cannot load the package.",
          suggestedFix: "Create `.codex-plugin/plugin.json`.",
          fingerprint: "a".repeat(64)
        },
        {
          id: "plugin.manifest.name.missing",
          severity: "fail",
          message: "Missing name.",
          impact: "Codex cannot identify the package.",
          suggestedFix: "Create `.codex-plugin/plugin.json`."
        },
        {
          id: "plugin.heuristic.description.too_long",
          severity: "warn",
          message: "Description is too long.",
          impact: "Discovery is less precise.",
          suggestedFix: "Shorten the manifest description."
        }
      ]
    };

    const report = buildMarkdownReport(result, { runtimeProbeEnabled: false });

    expect(report).toContain("## Next Actions\n\n1. Create `.codex-plugin/plugin.json`.");
    expect(report).toContain("2. Shorten the manifest description.");
    expect(report).not.toContain("3. Create `.codex-plugin/plugin.json`.");
    expect(report.indexOf("## Next Actions")).toBeLessThan(report.indexOf("## Findings"));
    expect(report).toContain("## Recommended Commands");
    expect(report).toContain('- `codex-plugin-doctor doctor recommend "example"`');
    expect(report).toContain('- `codex-plugin-doctor fix "example" --dry-run`');
    expect(report).toContain('- `codex-plugin-doctor suppress add "example"`');
  });
});
