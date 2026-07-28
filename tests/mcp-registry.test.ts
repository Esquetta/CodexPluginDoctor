import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildMcpRegistryReadiness,
  inspectMcpRegistryServer,
  renderMcpRegistryReadiness,
  renderMcpRegistryReadinessJson
} from "../src/core/mcp-registry.js";

async function writeServerJson(server: unknown, packageJson?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-registry-"));
  await writeFile(path.join(directory, "server.json"), JSON.stringify(server), "utf8");
  if (packageJson) {
    await writeFile(path.join(directory, "package.json"), JSON.stringify(packageJson), "utf8");
  }
  return directory;
}

const validServer = {
  $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
  name: "io.github.example/weather",
  description: "Weather tools.",
  version: "1.2.3",
  repository: {
    url: "https://github.com/example/weather",
    source: "github"
  },
  packages: [{
    registryType: "npm",
    identifier: "@example/weather-mcp",
    version: "1.2.3",
    transport: { type: "stdio" }
  }]
};

describe("MCP Registry readiness", () => {
  it("passes matching npm metadata and produces a non-mutating Codex preview", async () => {
    const target = await writeServerJson(validServer, {
      name: "@example/weather-mcp",
      version: "1.2.3",
      mcpName: "io.github.example/weather"
    });

    const report = await buildMcpRegistryReadiness(target);

    expect(report.status).toBe("pass");
    expect(report.scorecard).toMatchObject({
      metadata: "pass",
      ownership: "pass",
      packageIntegrity: "pass",
      transportReadiness: "pass",
      clientInstallability: "pass",
      overall: "pass"
    });
    expect(report.installability.codex).toBe("ready");
    expect(report.installability.codexPreview).toEqual({
      mcpServers: {
        weather: {
          command: "npx",
          args: ["-y", "@example/weather-mcp@1.2.3"]
        }
      }
    });
    expect(renderMcpRegistryReadiness(report)).toContain("Registry readiness: PASS");
    expect(JSON.parse(renderMcpRegistryReadinessJson(report))).toMatchObject({
      kind: "mcp-registry-readiness",
      schemaVersion: "1.0.0",
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      status: "pass"
    });
  });

  it("keeps metadata-only entries valid but reports missing installability evidence", async () => {
    const target = await writeServerJson({
      $schema: validServer.$schema,
      name: "com.example/metadata-only",
      description: "Metadata only.",
      version: "2026.07"
    });

    const report = await buildMcpRegistryReadiness(target);

    expect(report.status).toBe("warn");
    expect(report.scorecard.metadata).toBe("pass");
    expect(report.scorecard.transportReadiness).toBe("skipped");
    expect(report.installability.codex).toBe("unavailable");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.installability.missing");
  });

  it("warns on older official schemas and does not treat variable templates as embedded secrets", async () => {
    const target = await writeServerJson({
      ...validServer,
      $schema: "https://static.modelcontextprotocol.io/schemas/2025-09-29/server.schema.json",
      packages: [],
      remotes: [{
        type: "streamable-http",
        url: "https://example.com/mcp",
        headers: [{
          name: "Authorization",
          isSecret: true,
          value: "Bearer {api_key}"
        }]
      }]
    });

    const report = await buildMcpRegistryReadiness(target);
    const ids = report.findings.map((finding) => finding.id);

    expect(report.status).toBe("warn");
    expect(ids).toContain("registry.metadata.schema-outdated");
    expect(ids).not.toContain("registry.secret.embedded-value");
  });

  it("rejects unsafe or inconsistent publication metadata", async () => {
    const target = await writeServerJson({
      ...validServer,
      name: "io.github.attacker/weather",
      repository: {
        url: "https://github.com/example/weather",
        source: "github"
      },
      remotes: [{
        type: "streamable-http",
        url: "https://user:secret@example.com/mcp"
      }],
      packages: [{
        registryType: "mcpb",
        identifier: "https://github.com/example/weather/releases/download/v1/weather.mcpb",
        transport: { type: "stdio" }
      }]
    });

    const report = await buildMcpRegistryReadiness(target);
    const ids = report.findings.map((finding) => finding.id);

    expect(report.status).toBe("fail");
    expect(ids).toContain("registry.ownership.github-mismatch");
    expect(ids).toContain("registry.remote.credentials");
    expect(ids).toContain("registry.package.mcpb-hash-missing");
  });

  it("looks up only the fixed exact-name endpoint when network consent is explicit", async () => {
    const request = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({
        server: validServer,
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            status: "active",
            isLatest: true,
            publishedAt: "2026-07-01T00:00:00Z"
          }
        }
      }))
    }));

    const report = await inspectMcpRegistryServer(validServer.name, {
      allowNetwork: true,
      request
    });

    expect(request).toHaveBeenCalledWith(
      "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.example%2Fweather/versions/latest",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ accept: "application/json" })
      })
    );
    expect(report.source).toBe("registry");
    expect(report.registry).toMatchObject({ lifecycleStatus: "active", isLatest: true });
  });

  it("requires consent and rejects name substitution or deprecated lifecycle state", async () => {
    await expect(inspectMcpRegistryServer(validServer.name)).rejects.toThrow("--allow-network");

    const wrongName = vi.fn(async () => ({
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify({
        server: { ...validServer, name: "io.github.attacker/weather" },
        _meta: {
          "io.modelcontextprotocol.registry/official": {
            status: "deprecated",
            isLatest: true
          }
        }
      }))
    }));

    const report = await inspectMcpRegistryServer(validServer.name, {
      allowNetwork: true,
      request: wrongName
    });

    expect(report.status).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.lookup.name-mismatch");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.lookup.deprecated");
  });
});
