import { describe, expect, it } from "vitest";

import { findRuleDefinition, ruleCatalog } from "../src/rules/rule-catalog.js";

const mcpConformanceRules = [
  {
    id: "mcp.conformance.protocol.unknown_newer",
    category: "mcp",
    defaultSeverity: "warn",
    summary: "The server advertises a newer MCP protocol version.",
    why: "The validator applies the 2025-11-25 structural baseline, which may not cover newer protocol requirements.",
    fix: "Confirm the server's newer protocol changes remain compatible with the 2025-11-25 MCP contract.",
    example: '{ "protocolVersion": "2026-01-01" }'
  },
  {
    id: "mcp.conformance.tasks.capability_invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A Tasks capability declaration is malformed.",
    why: "Codex cannot safely determine whether the server supports task-aware tool calls.",
    fix: "Return an object for the affected Tasks capability field, or omit the capability until it is implemented.",
    example: '{ "capabilities": { "tasks": { "requests": { "tools": { "call": {} } } } } }'
  },
  {
    id: "mcp.conformance.tasks.task_support_invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A tool declares invalid task support.",
    why: "Codex cannot safely interpret the tool's task support contract.",
    fix: "Set execution.taskSupport to required, optional, or forbidden.",
    example: '{ "execution": { "taskSupport": "optional" } }'
  },
  {
    id: "mcp.conformance.tasks.capability_mismatch",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A tool's task support does not match server capability.",
    why: "Codex may attempt task-aware tool calls that the server did not advertise as supported.",
    fix: "Advertise capabilities.tasks.requests.tools.call as an object, or set execution.taskSupport to forbidden.",
    example: '{ "capabilities": { "tasks": { "requests": { "tools": { "call": {} } } } }, "execution": { "taskSupport": "required" } }'
  },
  {
    id: "mcp.conformance.tasks_list.timeout",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The server did not complete tasks/list in time.",
    why: "Codex cannot rely on task discovery when tasks/list cannot complete with a valid response.",
    fix: "Reduce tasks/list latency and verify pagination completes.",
    example: "Return a valid tasks/list response before the configured runtime timeout."
  },
  {
    id: "mcp.conformance.tasks_list.invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "The server returned an invalid tasks/list response.",
    why: "Codex cannot rely on task discovery when tasks/list cannot complete with a valid response.",
    fix: "Return a valid tasks/list response with well-formed task items and pagination.",
    example: '{ "tasks": [] }'
  },
  {
    id: "mcp.conformance.schema.dialect_invalid",
    category: "mcp",
    defaultSeverity: "fail",
    summary: "A tool schema declares an invalid dialect.",
    why: "Codex cannot reliably select a schema dialect for this tool.",
    fix: "Omit $schema or provide an absolute URI in the affected tool schema.",
    example: '{ "inputSchema": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }'
  },
  {
    id: "mcp.conformance.schema.dialect_unsupported",
    category: "mcp",
    defaultSeverity: "warn",
    summary: "A tool schema uses a non-canonical dialect.",
    why: "The schema may be valid, but its dialect is outside the validator's latest compatibility baseline.",
    fix: "Use https://json-schema.org/draft/2020-12/schema or omit $schema.",
    example: '{ "inputSchema": { "$schema": "https://json-schema.org/draft/2020-12/schema" } }'
  }
] as const;

const remoteMcpRules = [
  { id: "mcp.server.transport.conflict", category: "mcp", defaultSeverity: "fail" },
  { id: "plugin.mcp.server.transport.conflict", category: "mcp", defaultSeverity: "fail" },
  { id: "plugin.security.insecure_http_url", category: "security", defaultSeverity: "fail" },
  { id: "plugin.security.remote_mcp_url.invalid", category: "security", defaultSeverity: "fail" },
  { id: "plugin.security.remote_mcp_url.unsupported_scheme", category: "security", defaultSeverity: "fail" },
  { id: "plugin.security.remote_mcp_url.credentials", category: "security", defaultSeverity: "fail" },
  { id: "plugin.security.remote_mcp_url.query", category: "security", defaultSeverity: "fail" },
  { id: "plugin.security.remote_mcp_url.fragment", category: "security", defaultSeverity: "fail" },
  { id: "plugin.security.remote_mcp_url.ip_literal", category: "security", defaultSeverity: "fail" }
] as const;

describe("MCP 2025-11 conformance rule catalog", () => {
  it("resolves every evaluator finding with its public remediation contract", () => {
    expect(ruleCatalog.filter((rule) => rule.id.startsWith("mcp.conformance."))).toEqual(
      mcpConformanceRules
    );

    for (const expectedRule of mcpConformanceRules) {
      expect(findRuleDefinition(expectedRule.id)).toEqual(expectedRule);
    }
  });

  it("resolves every remote MCP transport finding with a public remediation contract", () => {
    for (const expectedRule of remoteMcpRules) {
      expect(findRuleDefinition(expectedRule.id)).toMatchObject(expectedRule);
    }
  });
});
