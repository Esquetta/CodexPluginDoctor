import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  buildMcpRegistryPublicationPreflight,
  renderMcpRegistryPublicationPreflightJson
} from "../src/core/mcp-registry-preflight.js";

async function writeServerJson(server: unknown, packageJson?: unknown): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-registry-preflight-"));
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

const matchingPackageJson = {
  name: "@example/weather-mcp",
  version: "1.2.3",
  mcpName: "io.github.example/weather"
};

describe("MCP Registry publication preflight", () => {
  it("returns a public-safe partial warning and non-executing publisher plan offline", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report).toMatchObject({
      schemaVersion: "1.0.0",
      kind: "mcp-registry-publication-preflight",
      generatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      target: "server.json",
      serverName: validServer.name,
      serverVersion: validServer.version,
      status: "warn",
      localReadiness: "pass",
      packagePublication: "unknown",
      registryVersionAvailability: "unknown",
      publisherPlan: {
        executable: false,
        steps: [
          {
            command: "mcp-publisher login github",
            purpose: "Authenticate with GitHub for Registry publication."
          },
          {
            command: "mcp-publisher publish",
            purpose: "Publish the validated Registry metadata."
          }
        ]
      }
    });
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.network-unverified");

    const rendered = renderMcpRegistryPublicationPreflightJson(report);
    expect(rendered).not.toContain(target);
    expect(rendered).not.toContain("\\\\");
  });

  it("does not issue a request when network consent is present in Task 1", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = vi.fn();

    const report = await buildMcpRegistryPublicationPreflight(target, {
      allowNetwork: true,
      request
    });

    expect(request).not.toHaveBeenCalled();
    expect(report.packagePublication).toBe("unknown");
    expect(report.registryVersionAvailability).toBe("unknown");
  });

  it("fails when the adjacent package name differs from the sole npm declaration", async () => {
    const target = await writeServerJson(validServer, {
      ...matchingPackageJson,
      name: "@example/other-mcp"
    });

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.status).toBe("fail");
    expect(report.localReadiness).toBe("fail");
    expect(report.packagePublication).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.package.local-name-mismatch");
  });

  it("fails when publication evidence declares multiple npm packages", async () => {
    const target = await writeServerJson({
      ...validServer,
      packages: [
        ...validServer.packages,
        {
          registryType: "npm",
          identifier: "@example/weather-cli",
          version: "1.2.3",
          transport: { type: "stdio" }
        }
      ]
    }, matchingPackageJson);

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.status).toBe("fail");
    expect(report.localReadiness).toBe("fail");
    expect(report.packagePublication).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.package.multiple-npm-declarations");
  });

  it("inherits a package mcpName mismatch as a blocking local failure", async () => {
    const target = await writeServerJson(validServer, {
      ...matchingPackageJson,
      mcpName: "io.github.example/other"
    });

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.status).toBe("fail");
    expect(report.localReadiness).toBe("fail");
    expect(report.packagePublication).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.ownership.npm-mcp-name");
  });

  it("inherits a local package version mismatch as a blocking failure", async () => {
    const target = await writeServerJson(validServer, {
      ...matchingPackageJson,
      version: "1.2.4"
    });

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.status).toBe("fail");
    expect(report.localReadiness).toBe("fail");
    expect(report.packagePublication).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.package.local-version-mismatch");
  });

  it("keeps inherited Registry readiness failures blocking", async () => {
    const target = await writeServerJson({
      ...validServer,
      description: ""
    }, matchingPackageJson);

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.status).toBe("fail");
    expect(report.localReadiness).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.metadata.description");
  });

  it("redacts invalid path-shaped metadata from the public report", async () => {
    const windowsName = "C:\\registry-preflight-name-sentinel";
    const posixVersion = "/registry-preflight-version-sentinel";
    const target = await writeServerJson({
      ...validServer,
      name: windowsName,
      version: posixVersion
    }, matchingPackageJson);

    const report = await buildMcpRegistryPublicationPreflight(target);
    const rendered = renderMcpRegistryPublicationPreflightJson(report);

    expect(report.serverName).toBeUndefined();
    expect(report.serverVersion).toBeUndefined();
    expect(rendered).not.toContain(windowsName);
    expect(rendered).not.toContain(posixVersion);
  });

  it("skips package publication evidence for non-npm packages", async () => {
    const target = await writeServerJson({
      ...validServer,
      packages: [{
        registryType: "mcpb",
        identifier: "https://github.com/example/weather/releases/download/v1/weather.mcpb",
        version: validServer.version,
        fileSha256: "a".repeat(64),
        transport: { type: "stdio" }
      }]
    });

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.packagePublication).toBe("skipped");
  });

  it("skips package publication evidence for remote-only input", async () => {
    const target = await writeServerJson({
      $schema: validServer.$schema,
      name: validServer.name,
      description: validServer.description,
      version: validServer.version,
      repository: validServer.repository,
      remotes: [{
        type: "streamable-http",
        url: "https://example.com/mcp"
      }]
    });

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(report.status).toBe("warn");
    expect(report.localReadiness).toBe("pass");
    expect(report.packagePublication).toBe("skipped");
    expect(report.registryVersionAvailability).toBe("unknown");
  });
});
