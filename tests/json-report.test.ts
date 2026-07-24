import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import type { CheckResult } from "../src/domain/types.js";
import { buildJsonReport } from "../src/reporting/render-json-report.js";

describe("buildJsonReport", () => {
  it("wraps check results in a stable report envelope", async () => {
    const targetPath = path.resolve("tests/fixtures/valid-plugin-with-mcp");
    const result = await runCheck(targetPath);

    const report = buildJsonReport(result, { runtimeProbeEnabled: false });

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.summary.targetPath).toBe(targetPath);
    expect(report.summary.status).toBe("pass");
    expect(report.summary.exitCode).toBe(0);
    expect(report.summary.runtimeProbeEnabled).toBe(false);
    expect(report.summary.findingCounts).toEqual({
      fail: 0,
      warn: 0,
      total: 0
    });
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it("serializes additive MCP conformance without task values", () => {
    const result: CheckResult = {
      targetPath: "example",
      status: "pass",
      exitCode: 0,
      findings: [],
      runtimeScorecard: {
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
      }
    };

    const report = buildJsonReport(result, { runtimeProbeEnabled: true });
    const serialized = JSON.stringify(report);

    expect(report.summary.runtimeScorecard?.conformance).toEqual({
      protocolVersion: "2025-11-25",
      profile: "2025-11-25",
      capabilityConsistency: "pass",
      taskDeclarations: "pass",
      tasksList: "pass",
      schemaDialect: "pass",
      overall: "pass"
    });
    expect(serialized).not.toContain("private-task-id");
    expect(Array.isArray(report.findings)).toBe(true);
  });
});

