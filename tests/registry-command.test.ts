import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/run-cli.js";
import {
  buildMcpRegistryPublicationPreflight,
  registryPublicationPreflightExitCode,
  renderMcpRegistryPublicationPreflight,
  renderMcpRegistryPublicationPreflightJson,
  type McpRegistryPublicationPreflightStatus
} from "../src/index.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) {
        stdout.push(message);
      },
      writeStderr(message: string) {
        stderr.push(message);
      }
    }
  };
}

async function createMetadataOnlyServer(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-registry-cli-"));
  await writeFile(path.join(directory, "server.json"), JSON.stringify({
    $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
    name: "com.example/metadata-only",
    description: "Metadata only.",
    version: "1.0.0"
  }), "utf8");
  return directory;
}

describe("registry command", () => {
  it("checks local server metadata and exposes the strict readiness gate", async () => {
    const target = await createMetadataOnlyServer();
    const normal = createIo();
    const strict = createIo();

    expect(await runCli(["registry", "check", target, "--json"], normal.io)).toBe(0);
    expect(JSON.parse(normal.stdout.join(""))).toMatchObject({
      kind: "mcp-registry-readiness",
      status: "warn"
    });

    expect(await runCli([
      "registry", "check", target, "--require-registry-readiness"
    ], strict.io)).toBe(1);
  });

  it("requires explicit network consent for Registry inspection", async () => {
    const result = createIo();

    expect(await runCli([
      "registry", "inspect", "io.github.example/weather"
    ], result.io)).toBe(2);
    expect(result.stderr.join("")).toContain("--allow-network");
  });

  it("rejects unknown Registry flags", async () => {
    const result = createIo();

    expect(await runCli(["registry", "check", ".", "--publish"], result.io)).toBe(2);
    expect(result.stderr.join("")).toContain("Unknown registry flag");
  });

  it("renders an offline publication preflight without using the network", async () => {
    const target = await createMetadataOnlyServer();
    const result = createIo();

    expect(await runCli(["registry", "preflight", target], result.io)).toBe(0);
    expect(result.stdout.join("")).toContain("Registry publication preflight: WARN");
    expect(result.stdout.join("")).toContain("Network verification: NOT REQUESTED");
  });

  it("blocks an offline warning when publication readiness is required", async () => {
    const target = await createMetadataOnlyServer();
    const result = createIo();

    expect(await runCli([
      "registry", "preflight", target, "--require-publish-ready"
    ], result.io)).toBe(1);
  });

  it("does not claim network verification completed after a local offline failure", async () => {
    const target = await createMetadataOnlyServer();
    await writeFile(path.join(target, "server.json"), JSON.stringify({
      $schema: "https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json",
      name: "com.example/metadata-only",
      description: "",
      version: "1.0.0"
    }), "utf8");

    const report = await buildMcpRegistryPublicationPreflight(target);

    expect(renderMcpRegistryPublicationPreflight(report)).toContain("Network verification: NOT AVAILABLE");
  });

  it("writes the exact JSON preflight report to --output", async () => {
    const target = await createMetadataOnlyServer();
    const outputPath = path.join(target, "preflight.json");
    const result = createIo();

    expect(await runCli([
      "registry", "preflight", target, "--json", "--output", outputPath
    ], result.io)).toBe(0);
    expect(await readFile(outputPath, "utf8")).toBe(result.stdout.join(""));
    expect(JSON.parse(result.stdout.join(""))).toMatchObject({
      kind: "mcp-registry-publication-preflight",
      status: "warn"
    });
  });

  it("rejects Registry flags outside their subcommand", async () => {
    const target = await createMetadataOnlyServer();
    const check = createIo();
    const inspect = createIo();
    const preflight = createIo();

    expect(await runCli(["registry", "check", target, "--allow-network"], check.io)).toBe(2);
    expect(check.stderr.join("")).toContain("registry check");

    expect(await runCli([
      "registry", "inspect", "io.github.example/weather", "--allow-network", "--require-publish-ready"
    ], inspect.io)).toBe(2);
    expect(inspect.stderr.join("")).toContain("registry preflight");

    expect(await runCli([
      "registry", "preflight", target, "--require-registry-readiness"
    ], preflight.io)).toBe(2);
    expect(preflight.stderr.join("")).toContain("registry check or registry inspect");
  });

  it("rejects missing and unknown preflight flags", async () => {
    const target = await createMetadataOnlyServer();
    const missingOutput = createIo();
    const unknown = createIo();

    expect(await runCli(["registry", "preflight", target, "--output"], missingOutput.io)).toBe(2);
    expect(missingOutput.stderr.join("")).toContain("Missing path after --output");

    expect(await runCli(["registry", "preflight", target, "--publish"], unknown.io)).toBe(2);
    expect(unknown.stderr.join("")).toContain("Unknown registry flag");
  });

  it("exports preflight builders, renderers, status, and exit policy from the barrel", async () => {
    const target = await createMetadataOnlyServer();
    const report = await buildMcpRegistryPublicationPreflight(target);
    const status: McpRegistryPublicationPreflightStatus = report.status;

    expect(status).toBe("warn");
    expect(renderMcpRegistryPublicationPreflight(report)).toContain("WARN");
    expect(JSON.parse(renderMcpRegistryPublicationPreflightJson(report))).toMatchObject({
      status: "warn"
    });
    expect(registryPublicationPreflightExitCode(report)).toBe(0);
    expect(registryPublicationPreflightExitCode(report, true)).toBe(1);
  });
});
