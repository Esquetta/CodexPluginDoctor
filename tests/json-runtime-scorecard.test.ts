import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";
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

  it("includes the remote scorecard without changing stdio scorecard fields", () => {
    const report = buildJsonReport(
      {
        targetPath: "/test/plugin",
        status: "warn",
        exitCode: 0,
        findings: [],
        runtimeScorecard: {
          initialize: "skipped",
          toolsList: "unsupported",
          toolsCall: "unsupported",
          resourcesList: "unsupported",
          resourceRead: "unsupported",
          resourceTemplatesList: "unsupported",
          promptsList: "unsupported",
          promptGet: "unsupported",
          remote: {
            transport: "pass",
            networkSafety: "pass",
            initialize: "skipped",
            contentType: "skipped",
            session: "absent",
            protocolHeaders: "skipped",
            authorization: "warn",
            overall: "warn"
          }
        }
      },
      { runtimeProbeEnabled: true }
    );

    expect(report.summary.runtimeScorecard?.remote).toEqual({
      transport: "pass",
      networkSafety: "pass",
      initialize: "skipped",
      contentType: "skipped",
      session: "absent",
      protocolHeaders: "skipped",
      authorization: "warn",
      overall: "warn"
    });
  });

  it("adds a complete remote reliability scorecard without changing the prior remote shape", () => {
    const reliability = {
      getSse: "pass" as const,
      sessionPropagation: "pass" as const,
      resumability: "skipped" as const,
      disconnectSafety: "skipped" as const,
      sessionRestart: "skipped" as const,
      termination: "skipped" as const,
      overall: "pass" as const
    };
    const report = buildJsonReport(
      {
        targetPath: "/test/plugin",
        status: "pass",
        exitCode: 0,
        findings: [],
        runtimeScorecard: {
          initialize: "skipped",
          toolsList: "unsupported",
          toolsCall: "unsupported",
          resourcesList: "unsupported",
          resourceRead: "unsupported",
          resourceTemplatesList: "unsupported",
          promptsList: "unsupported",
          promptGet: "unsupported",
          remote: {
            transport: "pass",
            networkSafety: "pass",
            initialize: "pass",
            contentType: "pass",
            session: "absent",
            protocolHeaders: "pass",
            authorization: "skipped",
            reliability,
            overall: "pass"
          }
        }
      },
      { runtimeProbeEnabled: true }
    );

    expect(report.summary.runtimeScorecard?.remote?.reliability).toEqual(reliability);
  });

  it("keeps reliability optional while rejecting unsupported capability statuses", () => {
    const contract = buildDoctorOutputContract("2026-07-26T00:00:00.000Z");
    const schema = contract.schemas.find((entry) => entry.id === "doctor.check.json")?.schema;
    const remote = (schema?.properties as { summary?: { properties?: { runtimeScorecard?: { properties?: { remote?: { properties?: Record<string, unknown>; required?: string[] } } } } } })
      .summary?.properties?.runtimeScorecard?.properties?.remote;
    const reliability = remote?.properties?.reliability as {
      properties?: Record<string, { enum?: string[] }>;
      required?: string[];
      additionalProperties?: boolean;
    } | undefined;

    expect(remote?.required).not.toContain("reliability");
    expect(reliability).toMatchObject({
      required: ["getSse", "sessionPropagation", "resumability", "disconnectSafety", "sessionRestart", "termination", "overall"],
      additionalProperties: false
    });
    for (const capability of [
      "getSse",
      "sessionPropagation",
      "resumability",
      "disconnectSafety",
      "sessionRestart",
      "termination",
      "overall"
    ]) {
      expect(reliability?.properties?.[capability]?.enum).not.toContain("unsupported");
      expect(reliability?.properties?.[capability]?.enum).toEqual([
        "pass",
        "warn",
        "fail",
        "skipped"
      ]);
    }
  });
});
