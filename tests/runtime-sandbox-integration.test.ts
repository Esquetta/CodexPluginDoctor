import { execFile, spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { DiscoveredPackage } from "../src/domain/types.js";
import { probeRuntime } from "../src/core/runtime-probe.js";
import {
  buildRuntimeLaunch,
  DOCKER_RUNTIME_IMAGE
} from "../src/core/runtime-sandbox.js";

const execFileAsync = promisify(execFile);
const dockerAvailable = spawnSync(
  "docker",
  ["version", "--format", "{{.Server.Version}}"],
  { encoding: "utf8" }
).status === 0;
const dockerRequired =
  process.env.CI === "true" ||
  process.env.CODEX_PLUGIN_DOCTOR_REQUIRE_DOCKER === "1";

if (!dockerAvailable && dockerRequired) {
  throw new Error("Docker integration tests are required, but the Docker daemon is unavailable.");
}

async function dockerContainers(): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "docker",
    ["ps", "-a", "--filter", "name=codex-doctor-", "--format", "{{.Names}}"],
    { encoding: "utf8" }
  );

  return stdout
    .split(/\r?\n/u)
    .map((value) => value.trim())
    .filter(Boolean)
    .sort();
}

async function expectNoNewDoctorContainers(before: string[]): Promise<void> {
  const after = await dockerContainers();
  expect(after.filter((name) => !before.includes(name))).toEqual([]);
}

async function createRuntimeFixture(mode: "success" | "timeout" | "crash"): Promise<{
  rootPath: string;
  discoveredPackage: DiscoveredPackage;
}> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-docker-runtime-"));
  const serverSource = [
    'import readline from "node:readline";',
    'const mode = process.argv[2] ?? "success";',
    'const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });',
    'const reply = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");',
    'input.on("line", (line) => {',
    '  const message = JSON.parse(line);',
    '  if (message.method === "initialize") {',
    '    reply(message.id, {',
    '      protocolVersion: "2025-11-25",',
    '      capabilities: { tools: {} },',
    '      serverInfo: { name: "docker-integration", version: "1.0.0" }',
    '    });',
    '    return;',
    '  }',
    '  if (message.method === "tools/list") {',
    '    if (mode === "timeout") return;',
    '    if (mode === "crash") process.exit(17);',
    '    reply(message.id, { tools: [{',
    '      name: "ping",',
    '      description: "Return sandbox health.",',
    '      inputSchema: { type: "object", properties: {}, required: [] }',
    '    }] });',
    '    return;',
    '  }',
    '  if (message.method === "tools/call") {',
    '    reply(message.id, { content: [{ type: "text", text: "docker-runtime-ok" }] });',
    '  }',
    '});'
  ].join("\n");

  await writeFile(path.join(rootPath, "server.mjs"), serverSource, "utf8");
  await writeFile(
    path.join(rootPath, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        dockerIntegration: {
          command: "node",
          args: ["./server.mjs", mode]
        }
      }
    }),
    "utf8"
  );
  const manifestPath = path.join(rootPath, "plugin.json");
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: "docker-integration",
      version: "1.0.0",
      description: "Docker integration fixture.",
      mcpServers: "./.mcp.json"
    }),
    "utf8"
  );

  return {
    rootPath,
    discoveredPackage: {
      rootPath,
      manifestPath,
      manifest: {
        name: "docker-integration",
        version: "1.0.0",
        description: "Docker integration fixture.",
        mcpServers: "./.mcp.json"
      }
    }
  };
}

describe.runIf(dockerAvailable)("Docker runtime integration", () => {
  it("enforces the configured filesystem, environment, network, and tmp boundaries", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-docker-isolation-"));
    const containerName = "codex-doctor-integration-isolation-" + process.pid;
    const isolationSource = [
      'import fs from "node:fs";',
      'const result = {};',
      'try { fs.writeFileSync("/workspace/blocked.txt", "blocked"); result.packageWriteBlocked = false; }',
      'catch { result.packageWriteBlocked = true; }',
      'result.hostEnvironmentHidden = process.env.DOCTOR_HOST_SENTINEL === undefined;',
      'try { fs.writeFileSync("/tmp/doctor-ok", "ok"); result.tmpWritable = true; }',
      'catch { result.tmpWritable = false; }',
      'try {',
      '  await fetch("http://example.com", { signal: AbortSignal.timeout(1000) });',
      '  result.networkBlocked = false;',
      '} catch { result.networkBlocked = true; }',
      'process.stdout.write(JSON.stringify(result));'
    ].join("\n");

    await writeFile(path.join(rootPath, "isolation.mjs"), isolationSource, "utf8");
    const launch = buildRuntimeLaunch({
      sandbox: "docker",
      packageRoot: rootPath,
      cwd: rootPath,
      command: "node",
      args: ["./isolation.mjs"],
      containerName
    });

    try {
      const { stdout } = await execFileAsync(launch.command, launch.args, {
        cwd: launch.cwd,
        encoding: "utf8",
        env: {
          ...process.env,
          DOCTOR_HOST_SENTINEL: "must-not-enter-container"
        }
      });

      expect(JSON.parse(stdout)).toEqual({
        packageWriteBlocked: true,
        hostEnvironmentHidden: true,
        tmpWritable: true,
        networkBlocked: true
      });
      expect(launch.evidence).toEqual({
        backend: "docker",
        image: DOCKER_RUNTIME_IMAGE,
        network: "none",
        packageMount: "read_only"
      });
      expect(await dockerContainers()).not.toContain(containerName);
    } finally {
      await execFileAsync("docker", ["rm", "-f", containerName], {
        encoding: "utf8"
      }).catch(() => undefined);
      await rm(rootPath, { recursive: true, force: true });
    }
  }, 30_000);

  it("passes MCP protocol probes and removes the container after success", async () => {
    const before = await dockerContainers();
    const fixture = await createRuntimeFixture("success");

    try {
      const result = await probeRuntime(fixture.discoveredPackage, {
        sandbox: "docker",
        startupTimeoutMs: 2_000
      });

      expect(result.scorecard.initialize).toBe("pass");
      expect(result.scorecard.toolsList).toBe("pass");
      expect(result.scorecard.toolsCall).toBe("pass");
      expect(result.execution).toEqual({
        backend: "docker",
        image: DOCKER_RUNTIME_IMAGE,
        network: "none",
        packageMount: "read_only"
      });
      await expectNoNewDoctorContainers(before);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  }, 30_000);

  it("force-removes the container after a protocol timeout", async () => {
    const before = await dockerContainers();
    const fixture = await createRuntimeFixture("timeout");

    try {
      const result = await probeRuntime(fixture.discoveredPackage, {
        sandbox: "docker",
        startupTimeoutMs: 100
      });

      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "plugin.runtime.tools_list.timeout",
            severity: "fail"
          })
        ])
      );
      await expectNoNewDoctorContainers(before);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  }, 30_000);

  it("force-removes the container after a post-spawn crash", async () => {
    const before = await dockerContainers();
    const fixture = await createRuntimeFixture("crash");

    try {
      const result = await probeRuntime(fixture.discoveredPackage, {
        sandbox: "docker",
        startupTimeoutMs: 2_000
      });

      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "plugin.runtime.exited_early",
            severity: "fail"
          })
        ])
      );
      await expectNoNewDoctorContainers(before);
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true });
    }
  }, 30_000);
});
