import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import { buildJsonReport } from "../src/reporting/render-json-report.js";

describe("runtime scorecard", () => {
  it("includes runtime capability statuses in the JSON report", async () => {
    const result = await runCheck(path.resolve("tests/fixtures/runtime-valid"), {
      runtime: true
    });

    const report = buildJsonReport(result, { runtimeProbeEnabled: true });

    expect(report.summary.runtimeScorecard).toEqual({
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
        tasksList: "skipped",
        schemaDialect: "pass",
        overall: "pass"
      }
    });
    expect(report.summary.runtimeExecution).toEqual({
      backend: "native",
      image: null,
      network: "host",
      packageMount: "host"
    });
  });

  it("omits runtime execution evidence when no runtime ran", () => {
    const report = buildJsonReport(
      {
        targetPath: "/test/plugin",
        status: "pass",
        exitCode: 0,
        findings: []
      },
      { runtimeProbeEnabled: false }
    );

    expect(report.summary).not.toHaveProperty("runtimeExecution");
  });
});
