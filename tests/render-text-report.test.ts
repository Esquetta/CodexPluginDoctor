import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import type { CheckResult, RuntimeScorecard } from "../src/domain/types.js";
import { renderTextReport } from "../src/reporting/render-text-report.js";

describe("renderTextReport", () => {
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

  function expectRuntimeScorecardWithConformance(output: string) {
    expect(output).toContain("Runtime Scorecard\n----------------");
    expect(output).toContain("initialize: pass");
    expect(output).toContain("prompts/get: pass");
    expect(output).toContain("MCP Conformance\n---------------");
    expect(output).toContain("Protocol version: 2025-11-25");
    expect(output).toContain("Profile: 2025-11-25");
    expect(output).toContain("Capability consistency: pass");
    expect(output).toContain("Task declarations: pass");
    expect(output).toContain("Tasks list: pass");
    expect(output).toContain("Schema dialect: pass");
    expect(output).toContain("Overall: pass");
    expect(output).not.toContain("private-task-id");
  }

  it("renders runtime operations and MCP Conformance without findings", () => {
    const output = renderTextReport({
      targetPath: "example",
      status: "pass",
      exitCode: 0,
      findings: [],
      runtimeScorecard
    });

    expectRuntimeScorecardWithConformance(output);
    expect(output).toContain("No findings.");
  });

  it("renders one MCP Conformance section alongside findings", () => {
    const output = renderTextReport({
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
    });

    expectRuntimeScorecardWithConformance(output);
    expect(output.match(/MCP Conformance/g)).toHaveLength(1);
    expect(output).toContain("Failures");
  });

  it("renders the remote MCP scorecard with enum-only session state", () => {
    const output = renderTextReport({
      targetPath: "example",
      status: "pass",
      exitCode: 0,
      findings: [],
      runtimeScorecard: {
        ...runtimeScorecard,
        remote: { transport: "pass", networkSafety: "pass", initialize: "pass", contentType: "pass", session: "present-valid", protocolHeaders: "pass", authorization: "skipped", overall: "pass" }
      }
    });

    expect(output).toContain("Remote MCP Scorecard");
    expect(output).toContain("network safety: pass");
    expect(output).toContain("session: present-valid");
  });

  it("renders remote reliability capability labels and statuses only", () => {
    const output = renderTextReport({
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
    });

    expect(output).toContain("Remote Transport Reliability");
    expect(output).toContain("GET SSE: pass");
    expect(output).toContain("Disconnect safety: warn");
    expect(output).not.toMatch(/session-secret-sentinel|event-secret-sentinel|retry-secret-sentinel|body-secret-sentinel/);
  });

  it("renders a rich unicode summary for warn results", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/heuristic-long-plugin-description")
    );
    const output = renderTextReport(result);

    expect(output).toContain("Status: WARN");
    expect(output).toContain(`Target: ${result.targetPath}`);
    expect(output).toContain("Summary: 0 fail, 1 warn, 1 total");
    expect(output).toContain("! plugin.heuristic.description.too_long");
    expect(output).toContain("Suggested fix: Shorten the manifest description");
    expect(output).not.toContain("Runtime backend:");
    expect(output).not.toContain("Runtime isolation:");
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

    const output = renderTextReport(result);

    expect(output).toContain("Runtime backend: DOCKER");
    expect(output).toContain(
      "Runtime isolation: network=none, package=read_only"
    );
  });

  it("renders an ASCII-safe summary when requested", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/security-hardcoded-secret")
    );
    const output = renderTextReport(result, { ascii: true });

    expect(output).toContain("Status: FAIL");
    expect(output).toContain(`Target: ${result.targetPath}`);
    expect(output).toContain("Summary: 1 fail, 0 warn, 1 total");
    expect(output).toContain("x plugin.security.hard_coded_secret");
    expect(output).toContain("Suggested fix: Replace the literal value");
    expect(output).toMatch(/Fingerprint: [a-f0-9]{64}/);
    expect(output).toContain("Evidence: serverName=dangerServer");
    expect(output).toContain("envKey=OPENAI_API_KEY");
    expect(output).toContain("envValue=[REDACTED]");
  });

  it("renders deduplicated next actions for explained reports", () => {
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

    const output = renderTextReport(result, { explain: true });

    expect(output).toContain("Next Actions\n------------");
    expect(output).toContain("1. Create `.codex-plugin/plugin.json`.");
    expect(output).toContain("2. Shorten the manifest description.");
    expect(output).not.toContain("3. Create `.codex-plugin/plugin.json`.");
    expect(output).toContain("Recommended Commands\n--------------------");
    expect(output).toContain('- codex-plugin-doctor doctor recommend "example"');
    expect(output).toContain('- codex-plugin-doctor fix "example" --dry-run');
    expect(output).toContain('- codex-plugin-doctor suppress add "example"');
  });
});
