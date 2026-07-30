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

function response(statusCode: number, payload: unknown, headers: Record<string, string | string[]> = {}) {
  return {
    statusCode,
    headers,
    body: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload))
  };
}

function npmPackument(overrides: Record<string, unknown> = {}) {
  return {
    name: matchingPackageJson.name,
    versions: {
      [validServer.version]: {
        name: matchingPackageJson.name,
        version: validServer.version,
        mcpName: validServer.name,
        dist: { integrity: "sha512-aGVsbG8=" }
      }
    },
    ...overrides
  };
}

function registryServer(name = validServer.name, version = validServer.version) {
  return {
    ...validServer,
    name,
    version
  };
}

function registryResponse(name = validServer.name, version = validServer.version) {
  return response(200, { server: registryServer(name, version) });
}

function requestSequence(...responses: Array<ReturnType<typeof response> | Error>) {
  return vi.fn(async () => {
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    if (!next) {
      throw new Error("Unexpected registry request.");
    }
    return next;
  });
}

const npmUrl = "https://registry.npmjs.org/%40example%2Fweather-mcp";
const registryExactUrl = "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.example%2Fweather/versions/1.2.3";
const registryLatestUrl = "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.example%2Fweather/versions/latest";
const requestOptions = {
  method: "GET",
  headers: {
    accept: "application/json",
    "user-agent": "codex-plugin-doctor"
  }
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

  it("collects matching public npm metadata and first-publication Registry evidence with fixed bounded requests", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(404, { error: "server not found" }),
      response(404, { error: "server not found" })
    );

    const report = await buildMcpRegistryPublicationPreflight(target, {
      allowNetwork: true,
      request
    });

    expect(report.status).toBe("pass");
    expect(report.packagePublication).toBe("pass");
    expect(report.registryVersionAvailability).toBe("available-first-publication");
    expect(request).toHaveBeenNthCalledWith(1, npmUrl, requestOptions);
    expect(request).toHaveBeenNthCalledWith(2, registryExactUrl, requestOptions);
    expect(request).toHaveBeenNthCalledWith(3, registryLatestUrl, requestOptions);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it.each([
    ["missing requested version", npmPackument({ versions: {} })],
    ["malformed packument", "not json"],
    ["mismatched top-level name", npmPackument({ name: "@example/other-mcp" })],
    ["mismatched published package name", npmPackument({ versions: {
      [validServer.version]: {
        name: "@example/other-mcp",
        version: validServer.version,
        mcpName: validServer.name,
        dist: { integrity: "sha512-aGVsbG8=" }
      }
    } })],
    ["mismatched published package version", npmPackument({ versions: {
      [validServer.version]: {
        name: matchingPackageJson.name,
        version: "1.2.4",
        mcpName: validServer.name,
        dist: { integrity: "sha512-aGVsbG8=" }
      }
    } })],
    ["mismatched published mcpName", npmPackument({ versions: {
      [validServer.version]: {
        name: matchingPackageJson.name,
        version: validServer.version,
        mcpName: "io.github.example/other",
        dist: { integrity: "sha512-aGVsbG8=" }
      }
    } })],
    ["malformed published integrity", npmPackument({ versions: {
      [validServer.version]: {
        name: matchingPackageJson.name,
        version: validServer.version,
        mcpName: validServer.name,
        dist: { integrity: "not-an-integrity-value" }
      }
    } })]
  ])("blocks package publication for %s", async (_caseName, payload) => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(response(200, payload));

    const report = await buildMcpRegistryPublicationPreflight(target, {
      allowNetwork: true,
      request
    });

    expect(report.status).toBe("fail");
    expect(report.packagePublication).toBe("fail");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(request).toHaveBeenCalledTimes(1);
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.npm.metadata");
  });

  it.each([418, 503])("keeps package publication unknown for unexpected npm HTTP %s", async (statusCode) => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(response(statusCode, { error: "unexpected response" }));

    const report = await buildMcpRegistryPublicationPreflight(target, {
      allowNetwork: true,
      request
    });

    expect(report.status).toBe("fail");
    expect(report.packagePublication).toBe("unknown");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(request).toHaveBeenCalledTimes(1);
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.npm.response");
  });

  it("encodes a scoped npm package identifier as one path segment", async () => {
    const target = await writeServerJson({
      ...validServer,
      packages: [{
        ...validServer.packages[0],
        identifier: "@scope/weather-mcp"
      }]
    }, {
      ...matchingPackageJson,
      name: "@scope/weather-mcp"
    });
    const request = requestSequence(response(404, { error: "package not found" }));

    await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(request).toHaveBeenCalledWith(
      "https://registry.npmjs.org/%40scope%2Fweather-mcp",
      requestOptions
    );
  });

  it("classifies an existing Registry server at another version as available for a new version", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(404, { error: "version not found" }),
      registryResponse(validServer.name, "1.2.2")
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("pass");
    expect(report.packagePublication).toBe("pass");
    expect(report.registryVersionAvailability).toBe("available-new-version");
  });

  it("blocks an already published exact Registry version", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(response(200, npmPackument()), registryResponse());

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.packagePublication).toBe("pass");
    expect(report.registryVersionAvailability).toBe("already-published");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.already-published");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps Registry version availability unknown for malformed exact Registry metadata", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(200, { server: { ...registryServer(), $schema: "https://example.com/server.schema.json" } })
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.exact-response");
  });

  it("keeps Registry version availability unknown for malformed exact Registry package metadata", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(200, { server: { ...registryServer(), packages: [{ registryType: "npm" }] } })
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.exact-response");
  });

  it("accepts a historical official Registry schema URL", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(200, { server: {
        ...registryServer(),
        $schema: "https://static.modelcontextprotocol.io/schemas/2025-10-01/server.schema.json"
      } })
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.registryVersionAvailability).toBe("already-published");
  });

  it("keeps Registry version availability unknown for malformed latest Registry metadata", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(404, { error: "version not found" }),
      response(200, { server: { ...registryServer(validServer.name, "1.2.2"), description: "" } })
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.latest-response");
  });

  it.each([
    ["a malformed exact not-found response", response(404, { error: "" })],
    ["an arbitrary exact client error", response(418, { error: "teapot" })],
    ["an arbitrary exact server error", response(503, { error: "unavailable" })],
    ["malformed exact JSON", response(200, "not json")],
    ["an exact identity mismatch", registryResponse("io.github.attacker/weather")]
  ])("keeps Registry version availability unknown for %s", async (_caseName, exactResponse) => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(response(200, npmPackument()), exactResponse);

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(request).toHaveBeenCalledTimes(2);
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.exact-response");
  });

  it("keeps Registry version availability unknown when a bounded request throws", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(new Error("registry-preflight-request-sentinel"));

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.packagePublication).toBe("unknown");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.npm.request");
  });

  it("keeps Registry version availability unknown when the exact Registry request throws after npm succeeds", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(response(200, npmPackument()), new Error("exact request failed"));

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.packagePublication).toBe("pass");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.exact-request");
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("keeps Registry version availability unknown when the latest Registry request throws", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(404, { error: "version not found" }),
      new Error("latest request failed")
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.packagePublication).toBe("pass");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.latest-request");
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("keeps Registry version availability unknown for a mismatched latest record", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = requestSequence(
      response(200, npmPackument()),
      response(404, { error: "version not found" }),
      registryResponse(validServer.name, validServer.version)
    );

    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.registry.latest-response");
  });

  it("fails when the adjacent package name differs from the sole npm declaration", async () => {
    const target = await writeServerJson(validServer, {
      ...matchingPackageJson,
      name: "@example/other-mcp"
    });

    const request = vi.fn();
    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("fail");
    expect(report.localReadiness).toBe("fail");
    expect(report.packagePublication).toBe("fail");
    expect(report.findings.map((finding) => finding.id)).toContain("registry.preflight.package.local-name-mismatch");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not issue requests without explicit network consent", async () => {
    const target = await writeServerJson(validServer, matchingPackageJson);
    const request = vi.fn();

    const report = await buildMcpRegistryPublicationPreflight(target, { request });

    expect(report.status).toBe("warn");
    expect(report.packagePublication).toBe("unknown");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(request).not.toHaveBeenCalled();
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

    const request = vi.fn();
    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.packagePublication).toBe("skipped");
    expect(request).not.toHaveBeenCalled();
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

    const request = vi.fn();
    const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork: true, request });

    expect(report.status).toBe("warn");
    expect(report.localReadiness).toBe("pass");
    expect(report.packagePublication).toBe("skipped");
    expect(report.registryVersionAvailability).toBe("unknown");
    expect(request).not.toHaveBeenCalled();
  });

  it("does not serialize untrusted response or error sentinels", async () => {
    const sentinel = "registry-preflight-redaction-sentinel";
    const pathReport = await buildMcpRegistryPublicationPreflight(await writeServerJson({
      ...validServer,
      name: `C:\\\\${sentinel}`,
      version: `/${sentinel}`
    }, matchingPackageJson));
    const responseRequest = requestSequence(response(200, sentinel, { "www-authenticate": sentinel }));

    const responseReport = await buildMcpRegistryPublicationPreflight(await writeServerJson(validServer, matchingPackageJson), {
      allowNetwork: true,
      request: responseRequest
    });
    const errorReport = await buildMcpRegistryPublicationPreflight(await writeServerJson(validServer, matchingPackageJson), {
      allowNetwork: true,
      request: requestSequence(new Error(sentinel))
    });

    expect(renderMcpRegistryPublicationPreflightJson(pathReport)).not.toContain(sentinel);
    expect(renderMcpRegistryPublicationPreflightJson(responseReport)).not.toContain(sentinel);
    expect(renderMcpRegistryPublicationPreflightJson(errorReport)).not.toContain(sentinel);
  });
});
