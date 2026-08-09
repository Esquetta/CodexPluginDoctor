export type McpServerConfig = Record<string, unknown>;
export type McpServerMap = Record<string, McpServerConfig>;
export type McpConfigLayout = "direct" | "snake_case_wrapper" | "camel_case_wrapper";

export type McpConfigNormalizationResult =
  | { ok: true; layout: McpConfigLayout; servers: McpServerMap }
  | { ok: false; reason: "ambiguous_shape"; field: "root" }
  | {
    ok: false;
    reason: "invalid_shape";
    field: "root" | "mcp_servers" | "mcpServers" | "server";
    invalidServerNames?: string[];
  };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeServerMap(
  value: unknown,
  field: "root" | "mcp_servers" | "mcpServers",
  layout: McpConfigLayout
): McpConfigNormalizationResult {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return { ok: false, reason: "invalid_shape", field };
  }

  const invalidServerNames: string[] = [];
  const servers: McpServerMap = {};
  for (const [name, server] of Object.entries(value)) {
    if (!isPlainObject(server)) {
      invalidServerNames.push(name);
    } else {
      servers[name] = server;
    }
  }
  if (invalidServerNames.length > 0) {
    return {
      ok: false,
      reason: "invalid_shape",
      field: "server",
      invalidServerNames: invalidServerNames.sort()
    };
  }

  return { ok: true, layout, servers };
}

export function normalizeMcpConfig(value: unknown): McpConfigNormalizationResult {
  if (!isPlainObject(value)) {
    return { ok: false, reason: "invalid_shape", field: "root" };
  }

  const hasSnakeCaseWrapper = Object.hasOwn(value, "mcp_servers");
  const hasCamelCaseWrapper = Object.hasOwn(value, "mcpServers");
  if (hasSnakeCaseWrapper && hasCamelCaseWrapper) {
    return { ok: false, reason: "ambiguous_shape", field: "root" };
  }

  if (hasSnakeCaseWrapper || hasCamelCaseWrapper) {
    if (Object.keys(value).length !== 1) {
      return { ok: false, reason: "ambiguous_shape", field: "root" };
    }
    return hasSnakeCaseWrapper
      ? normalizeServerMap(value.mcp_servers, "mcp_servers", "snake_case_wrapper")
      : normalizeServerMap(value.mcpServers, "mcpServers", "camel_case_wrapper");
  }

  return normalizeServerMap(value, "root", "direct");
}
