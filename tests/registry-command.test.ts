import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCli } from "../src/run-cli.js";

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
});
