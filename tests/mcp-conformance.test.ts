import { describe, expect, it } from "vitest";

import { evaluateMcpConformance } from "../src/core/mcp-conformance.js";

const latestCapabilities = {
  tasks: {
    list: {},
    requests: {
      tools: {
        call: {}
      }
    }
  }
};

function observe(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: "2025-11-25",
    capabilities: {},
    tools: [],
    ...overrides
  };
}

describe("MCP 2025-11 conformance", () => {
  it.each([
    ["2024-11-05", "legacy"],
    ["2025-03-26", "legacy"],
    ["2025-06-18", "legacy"],
    ["2025-11-25", "2025-11-25"],
    ["2026-01-01", "future-compatible"]
  ] as const)("classifies %s as %s", (protocolVersion, profile) => {
    const result = evaluateMcpConformance(observe({ protocolVersion }));

    expect(result.scorecard.profile).toBe(profile);
  });

  it("skips task and schema checks for legacy protocol versions", () => {
    const result = evaluateMcpConformance(
      observe({
        protocolVersion: "2025-06-18",
        capabilities: { tasks: "invalid" },
        tools: [
          {
            name: "legacy-tool",
            inputSchema: "invalid",
            execution: { taskSupport: "invalid" }
          }
        ],
        tasksList: { status: "fail", itemCount: 0, pageCount: 0, failure: "timeout" }
      })
    );

    expect(result.findings).toEqual([]);
    expect(result.scorecard).toMatchObject({
      capabilityConsistency: "skipped",
      taskDeclarations: "skipped",
      tasksList: "skipped",
      schemaDialect: "skipped",
      overall: "pass"
    });
  });

  it("warns for a syntactically newer protocol and applies the latest checks", () => {
    const result = evaluateMcpConformance(
      observe({ protocolVersion: "2026-01-01" })
    );

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "mcp.conformance.protocol.unknown_newer"
    ]);
    expect(result.scorecard).toMatchObject({
      protocolVersion: "2026-01-01",
      overall: "warn"
    });
  });

  it("accepts additive task capability keys when every known task capability is an object", () => {
    const result = evaluateMcpConformance(
      observe({
        capabilities: {
          ...latestCapabilities,
          vendorExtension: true,
          tasks: {
            ...latestCapabilities.tasks,
            extension: { future: true }
          }
        },
        tools: [
          {
            name: "task-tool",
            inputSchema: {},
            execution: { taskSupport: "optional", extension: true }
          }
        ]
      })
    );

    expect(result.findings).toEqual([]);
    expect(result.scorecard).toMatchObject({
      capabilityConsistency: "pass",
      taskDeclarations: "pass",
      schemaDialect: "pass",
      overall: "pass"
    });
  });

  it("rejects malformed known task capability objects", () => {
    const result = evaluateMcpConformance(
      observe({ capabilities: { tasks: { requests: { tools: { call: true } } } } })
    );

    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "mcp.conformance.tasks.capability_invalid",
        severity: "fail",
        evidence: { field: "capabilities.tasks.requests.tools.call" }
      })
    ]);
    expect(result.scorecard.capabilityConsistency).toBe("fail");
  });

  it.each([
    [undefined, "pass", []],
    ["forbidden", "pass", []],
    ["optional", "fail", ["mcp.conformance.tasks.capability_mismatch"]],
    ["required", "fail", ["mcp.conformance.tasks.capability_mismatch"]],
    ["unexpected", "fail", ["mcp.conformance.tasks.task_support_invalid"]]
  ] as const)(
    "evaluates taskSupport %s",
    (taskSupport, expectedStatus, expectedFindingIds) => {
      const execution = taskSupport === undefined ? undefined : { taskSupport };
      const result = evaluateMcpConformance(
        observe({
          tools: [{ name: "task-tool", inputSchema: {}, ...(execution ? { execution } : {}) }]
        })
      );

      expect(result.scorecard.taskDeclarations).toBe(expectedStatus);
      expect(result.findings.map((finding) => finding.id)).toEqual(expectedFindingIds);
    }
  );

  it("requires the tools/call task capability when task support is declared", () => {
    const result = evaluateMcpConformance(
      observe({
        capabilities: { tasks: { requests: { tools: {} } } },
        tools: [{ name: "task-tool", inputSchema: {}, execution: { taskSupport: "required" } }]
      })
    );

    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "mcp.conformance.tasks.capability_mismatch",
        evidence: { toolName: "task-tool", taskSupport: "required" }
      })
    ]);
  });

  it("reports timeout and invalid task list observations", () => {
    const timeout = evaluateMcpConformance(
      observe({ tasksList: { status: "fail", itemCount: 0, pageCount: 1, failure: "timeout" } })
    );
    const invalid = evaluateMcpConformance(
      observe({ tasksList: { status: "fail", itemCount: 0, pageCount: 1, failure: "invalid" } })
    );

    expect(timeout.findings.map((finding) => finding.id)).toEqual([
      "mcp.conformance.tasks_list.timeout"
    ]);
    expect(invalid.findings.map((finding) => finding.id)).toEqual([
      "mcp.conformance.tasks_list.invalid"
    ]);
    expect(timeout.scorecard.tasksList).toBe("fail");
    expect(invalid.scorecard.tasksList).toBe("fail");
  });

  it.each([
    ["omitted", {}, "pass", []],
    ["canonical", { $schema: "https://json-schema.org/draft/2020-12/schema" }, "pass", []],
    ["canonical trailing hash", { $schema: "https://json-schema.org/draft/2020-12/schema#" }, "pass", []],
    ["malformed", { $schema: "not a URI" }, "fail", ["mcp.conformance.schema.dialect_invalid"]],
    ["unsupported", { $schema: "https://json-schema.org/draft/2019-09/schema" }, "warn", ["mcp.conformance.schema.dialect_unsupported"]]
  ] as const)("handles %s schema dialects", (_caseName, inputSchema, expectedStatus, ids) => {
    const result = evaluateMcpConformance(
      observe({ tools: [{ name: "schema-tool", inputSchema }] })
    );

    expect(result.scorecard.schemaDialect).toBe(expectedStatus);
    expect(result.findings.map((finding) => finding.id)).toEqual(ids);
  });

  it.each([
    ["omitted", {}, "pass", []],
    ["canonical", { $schema: "https://json-schema.org/draft/2020-12/schema" }, "pass", []],
    ["canonical trailing hash", { $schema: "https://json-schema.org/draft/2020-12/schema#" }, "pass", []],
    ["malformed", { $schema: "not a URI" }, "fail", ["mcp.conformance.schema.dialect_invalid"]],
    ["unsupported", { $schema: "https://json-schema.org/draft/2019-09/schema" }, "warn", ["mcp.conformance.schema.dialect_unsupported"]]
  ] as const)("handles %s output schema dialects", (_caseName, outputSchema, expectedStatus, ids) => {
    const result = evaluateMcpConformance(
      observe({ tools: [{ name: "schema-tool", inputSchema: {}, outputSchema }] })
    );

    expect(result.scorecard.schemaDialect).toBe(expectedStatus);
    expect(result.findings.map((finding) => finding.id)).toEqual(ids);
  });

  it("rejects non-object schema containers and non-string schema dialects", () => {
    const result = evaluateMcpConformance(
      observe({
        tools: [
          { name: "input", inputSchema: [] },
          { name: "output", inputSchema: {}, outputSchema: { $schema: 202012 } }
        ]
      })
    );

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "mcp.conformance.schema.dialect_invalid",
      "mcp.conformance.schema.dialect_invalid"
    ]);
    expect(result.scorecard).toMatchObject({ schemaDialect: "fail", overall: "fail" });
  });

  it("aggregates deterministically with failure taking precedence over warnings", () => {
    const result = evaluateMcpConformance(
      observe({
        protocolVersion: "2026-01-01",
        tools: [{ name: "schema-tool", inputSchema: { $schema: "not a URI" } }]
      })
    );

    expect(result.findings.map((finding) => finding.id)).toEqual([
      "mcp.conformance.protocol.unknown_newer",
      "mcp.conformance.schema.dialect_invalid"
    ]);
    expect(result.scorecard.overall).toBe("fail");
  });
});
