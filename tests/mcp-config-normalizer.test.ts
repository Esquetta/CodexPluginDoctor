import { describe, expect, it } from "vitest";

import { normalizeMcpConfig } from "../src/core/mcp-config-normalizer.js";

describe("normalizeMcpConfig", () => {
  it("normalizes a direct server map", () => {
    const servers = {
      weather: { command: "npx", args: ["weather-mcp"] }
    };

    expect(normalizeMcpConfig(servers)).toEqual({
      ok: true,
      layout: "direct",
      servers
    });
  });

  it("normalizes the snake_case wrapper", () => {
    const servers = { weather: { command: "npx" } };

    expect(normalizeMcpConfig({ mcp_servers: servers })).toEqual({
      ok: true,
      layout: "snake_case_wrapper",
      servers
    });
  });

  it("normalizes the camelCase wrapper", () => {
    const servers = { weather: { command: "npx" } };

    expect(normalizeMcpConfig({ mcpServers: servers })).toEqual({
      ok: true,
      layout: "camel_case_wrapper",
      servers
    });
  });

  it("rejects roots that contain both wrapper forms", () => {
    expect(normalizeMcpConfig({
      mcp_servers: { weather: { command: "npx" } },
      mcpServers: { weather: { command: "npx" } }
    })).toEqual({ ok: false, reason: "ambiguous_shape", field: "root" });
  });

  it("rejects a wrapper combined with a direct server key", () => {
    expect(normalizeMcpConfig({
      mcpServers: { weather: { command: "npx" } },
      github: { command: "npx" }
    })).toEqual({ ok: false, reason: "ambiguous_shape", field: "root" });
  });

  it.each([
    ["direct", {}, "root"],
    ["snake_case_wrapper", { mcp_servers: {} }, "mcp_servers"],
    ["camel_case_wrapper", { mcpServers: {} }, "mcpServers"]
  ] as const)("rejects an empty %s map", (_layout, config, field) => {
    expect(normalizeMcpConfig(config)).toEqual({
      ok: false,
      reason: "invalid_shape",
      field
    });
  });

  it.each([
    [{ mcp_servers: null }, "mcp_servers"],
    [{ mcpServers: [] }, "mcpServers"]
  ] as const)("rejects a non-object wrapper map at its source field", (config, field) => {
    expect(normalizeMcpConfig(config)).toEqual({
      ok: false,
      reason: "invalid_shape",
      field
    });
  });

  it.each([null, [], new Date()])("rejects a non-plain root", (config) => {
    expect(normalizeMcpConfig(config)).toEqual({
      ok: false,
      reason: "invalid_shape",
      field: "root"
    });
  });

  it("reports all invalid server names in sorted order without returning a partial map", () => {
    const result = normalizeMcpConfig({
      zoo: null,
      weather: { command: "npx" },
      alpha: [],
      beta: "npx",
      date: new Date()
    });

    expect(result).toEqual({
      ok: false,
      reason: "invalid_shape",
      field: "server",
      invalidServerNames: ["alpha", "beta", "date", "zoo"]
    });
    expect(result).not.toHaveProperty("servers");
  });
});
