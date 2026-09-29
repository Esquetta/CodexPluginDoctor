import { describe, expect, it } from "vitest";

import { inspectMcpToolDefinition } from "../src/core/mcp-tool-definition.js";

const location = { page: 2, toolIndex: 7 };

function ids(value: unknown): string[] {
  return inspectMcpToolDefinition(value, location).map((finding) => finding.id);
}

describe("MCP tool definition catalog validation", () => {
  it("accepts a complete canonical root-schema definition", () => {
    const findings = inspectMcpToolDefinition(
      {
        name: "search_catalog",
        title: "Search",
        description: "Search the catalog.",
        inputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
          additionalProperties: false
        },
        outputSchema: {
          $schema: "https://json-schema.org/draft/2020-12/schema#",
          type: ["object", "null"]
        }
      },
      location
    );

    expect(findings).toEqual([]);
  });

  it("accepts an MCP tool name containing dots", () => {
    expect(inspectMcpToolDefinition({ name: "admin.tools.list", inputSchema: {} }, location)).toEqual([]);
  });
  it.each([
    ["entry", null, "plugin.catalog.tool.invalid_object"],
    ["missing name", { inputSchema: {} }, "plugin.catalog.tool.name.invalid"],
    ["non-string name", { name: 4, inputSchema: {} }, "plugin.catalog.tool.name.invalid"],
    ["non-string title", { name: "tool", title: false, inputSchema: {} }, "plugin.catalog.tool.title.invalid"],
    ["non-string description", { name: "tool", description: [], inputSchema: {} }, "plugin.catalog.tool.description.invalid"],
    ["missing input schema", { name: "tool" }, "plugin.catalog.schema.input.invalid"],
    ["array input schema", { name: "tool", inputSchema: [] }, "plugin.catalog.schema.input.invalid"],
    ["null input schema", { name: "tool", inputSchema: null }, "plugin.catalog.schema.input.invalid"],
    ["non-object output schema", { name: "tool", inputSchema: {}, outputSchema: true }, "plugin.catalog.schema.output.invalid"]
  ] as const)("reports an invalid %s structure", (_caseName, value, expectedId) => {
    expect(ids(value)).toContain(expectedId);
  });

  it.each([
    ["empty", ""],
    ["too long", "a".repeat(129)],
    ["non-ASCII", "araç"],
    ["space", "tool name"]
  ])("warns for a %s recommended-name violation", (_caseName, name) => {
    const findings = inspectMcpToolDefinition({ name, inputSchema: {} }, location);

    expect(findings).toEqual([
      expect.objectContaining({
        id: "plugin.catalog.tool.name.recommended",
        severity: "warn",
        location
      })
    ]);
  });

  it.each([
    ["explicitly undefined dialect", { $schema: undefined }, "plugin.catalog.schema.dialect.invalid"],
    ["invalid dialect type", { $schema: 202012 }, "plugin.catalog.schema.dialect.invalid"],
    ["invalid dialect URI", { $schema: "not a URI" }, "plugin.catalog.schema.dialect.invalid"],
    ["invalid properties", { properties: [] }, "plugin.catalog.schema.properties.invalid"],
    ["invalid required", { required: ["query", 3] }, "plugin.catalog.schema.required.invalid"],
    ["duplicate required", { required: ["query", "query"] }, "plugin.catalog.schema.required.invalid"],
    ["invalid type", { type: "record" }, "plugin.catalog.schema.type.invalid"],
    ["empty type union", { type: [] }, "plugin.catalog.schema.type.invalid"],
    ["duplicate type union", { type: ["string", "string"] }, "plugin.catalog.schema.type.invalid"],
    ["invalid additionalProperties", { additionalProperties: null }, "plugin.catalog.schema.additional_properties.invalid"]
  ] as const)("reports an invalid root keyword for %s", (_caseName, inputSchema, expectedId) => {
    expect(ids({ name: "tool", inputSchema })).toContain(expectedId);
  });

  it("skips recognized root keyword validation for a valid unsupported dialect", () => {
    const findings = inspectMcpToolDefinition(
      {
        name: "tool",
        inputSchema: {
          $schema: "https://example.test/custom-schema",
          properties: [],
          required: [1],
          type: "record",
          additionalProperties: null
        }
      },
      location
    );

    expect(findings).toEqual([
      expect.objectContaining({
        id: "plugin.catalog.schema.dialect.unsupported",
        severity: "warn",
        location: { ...location, schema: "inputSchema" }
      })
    ]);
  });

  it("accepts valid root-schema constructs outside this bounded coverage", () => {
    const findings = inspectMcpToolDefinition(
      {
        name: "__proto__",
        inputSchema: {
          required: ["external"],
          properties: { "__proto__": { type: "string" } },
          anyOf: [{ $ref: "#/defs/value" }],
          allOf: [{ type: "object" }],
          $ref: "#/defs/tool",
          defs: { tool: true },
          additionalProperties: { type: "string" }
        },
        outputSchema: { type: ["string", "null"] }
      },
      location
    );

    expect(findings).toEqual([]);
  });

  it("keeps untrusted tool values out of all finding fields", () => {
    const sentinel = "CATALOG_SECRET_SENTINEL";
    const findings = inspectMcpToolDefinition(
      {
        name: sentinel,
        description: sentinel,
        inputSchema: {
          $schema: `not-a-uri-${sentinel}`,
          properties: { [sentinel]: [] }
        }
      },
      location
    );

    expect(JSON.stringify(findings)).not.toContain(sentinel);
    expect(findings.every((finding) => finding.location?.page === 2)).toBe(true);
    expect(findings.every((finding) => finding.location?.toolIndex === 7)).toBe(true);
  });
});
