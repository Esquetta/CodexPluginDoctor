import { access, cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { probeRuntime } from "../src/core/runtime-probe.js";
import type { DiscoveredPackage } from "../src/domain/types.js";
import { validatePlugin } from "../src/core/validate-plugin.js";
import { runCheck } from "../src/index.js";

function markerServerSource(markerPath: string): string {
  return `import fs from "node:fs";
import readline from "node:readline";
fs.writeFileSync(${JSON.stringify(markerPath)}, "executed");
const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        serverInfo: { name: "runtime-cwd", version: "1.0.0" }
      }
    }) + "\\n");
  }
});
`;
}

async function createRuntimeCwdPackage(
  rootPath: string,
  cwd: string
): Promise<DiscoveredPackage> {
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: "runtime-cwd",
      version: "1.0.0",
      description: "Runtime cwd validation fixture.",
      mcpServers: "./.mcp.json"
    })
  );
  await writeFile(
    path.join(rootPath, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        cwdServer: { command: "node", args: ["server.mjs"], cwd }
      }
    })
  );

  return {
    rootPath,
    manifestPath,
    manifest: {
      name: "runtime-cwd",
      version: "1.0.0",
      description: "Runtime cwd validation fixture.",
      mcpServers: "./.mcp.json"
    }
  };
}

async function createRuntimeLayoutPackage(
  config: unknown
): Promise<{ discoveredPackage: DiscoveredPackage; markerPath: string; rootPath: string }> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-runtime-layout-"));
  const markerPath = path.join(rootPath, "runtime-started");
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(
    manifestPath,
    JSON.stringify({
      name: "runtime-layout",
      version: "1.0.0",
      description: "Runtime MCP layout fixture.",
      mcpServers: "./.mcp.json"
    })
  );
  await writeFile(path.join(rootPath, "server.mjs"), markerServerSource(markerPath));
  await writeFile(path.join(rootPath, ".mcp.json"), JSON.stringify(config));

  return {
    rootPath,
    markerPath,
    discoveredPackage: {
      rootPath,
      manifestPath,
      manifest: {
        name: "runtime-layout",
        version: "1.0.0",
        description: "Runtime MCP layout fixture.",
        mcpServers: "./.mcp.json"
      }
    }
  };
}

describe("runtime protocol probing", () => {
  it.each([
    { layout: "direct", config: { layoutServer: { command: "node", args: ["server.mjs"] } } },
    { layout: "snake case", config: { mcp_servers: { layoutServer: { command: "node", args: ["server.mjs"] } } } }
  ])("probes a $layout package-source server layout", async ({ config }) => {
    const fixture = await createRuntimeLayoutPackage(config);

    try {
      const result = await probeRuntime(fixture.discoveredPackage, { startupTimeoutMs: 2_000 });

      expect(result.scorecard.initialize).toBe("pass");
      await expect(access(fixture.markerPath)).resolves.toBeUndefined();
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("does not launch an ambiguous MCP source layout", async () => {
    const fixture = await createRuntimeLayoutPackage({});
    const commandConfig = {
      command: "node",
      args: ["-e", `require('node:fs').writeFileSync(${JSON.stringify(fixture.markerPath)}, 'started')`]
    };
    await writeFile(
      path.join(fixture.rootPath, ".mcp.json"),
      JSON.stringify({
        mcpServers: { layoutServer: commandConfig },
        mcp_servers: { layoutServer: commandConfig }
      })
    );

    try {
      const result = await probeRuntime(fixture.discoveredPackage, { startupTimeoutMs: 2_000 });

      expect(result.scorecard.initialize).toBe("skipped");
      await expect(access(fixture.markerPath)).rejects.toThrow();
    } finally {
      await rm(fixture.rootPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    }
  });

  it("does not start runtime probes when static validation fails", async () => {
    const packageRoot = await mkdtemp(
      path.join(os.tmpdir(), "codex-plugin-doctor-static-first-")
    );
    const markerPath = path.join(packageRoot, "runtime-started");

    try {
      await cp(path.resolve("tests/fixtures/security-hardcoded-secret"), packageRoot, {
        recursive: true
      });
      await writeFile(
        path.join(packageRoot, "marker-server.js"),
        `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "started");\nprocess.stdin.resume();\n`
      );
      await writeFile(
        path.join(packageRoot, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            dangerServer: {
              command: "node",
              args: ["./marker-server.js"],
              env: {
                OPENAI_API_KEY: "sk-live-super-secret-token-value"
              }
            }
          }
        })
      );

      const result = await validatePlugin(packageRoot, {
        runtime: true,
        runtimeStartupTimeoutMs: 2_000
      });

      expect(result.findings.map((finding) => finding.id)).toContain(
        "plugin.security.hard_coded_secret"
      );
      await expect(access(markerPath)).rejects.toThrow();
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  it("reports URL servers as unapproved without opening a remote connection by default", async () => {
    const packageRoot = await mkdtemp(
      path.join(os.tmpdir(), "codex-plugin-doctor-runtime-remote-")
    );

    try {
      const manifestPath = path.join(packageRoot, ".codex-plugin", "plugin.json");
      await mkdir(path.dirname(manifestPath), { recursive: true });
      await writeFile(manifestPath, JSON.stringify({
        name: "runtime-remote",
        version: "1.0.0",
        description: "Remote runtime validation fixture.",
        mcpServers: "./.mcp.json"
      }));
      await writeFile(path.join(packageRoot, ".mcp.json"), JSON.stringify({
        mcpServers: { remoteServer: { url: "https://mcp.example/mcp" } }
      }));

      const result = await probeRuntime({
        rootPath: packageRoot,
        manifestPath,
        manifest: { mcpServers: "./.mcp.json" }
      });

      expect(result.findings).toEqual([
        expect.objectContaining({ id: "plugin.runtime.remote.network_not_approved", severity: "fail" })
      ]);
      expect(result.scorecard.remote).toEqual(expect.objectContaining({
        networkSafety: "fail",
        overall: "fail"
      }));
      expect(result.scorecard.initialize).toBe("skipped");
    } finally {
      await rm(packageRoot, { recursive: true, force: true });
    }
  });

  it.each(["missing-cwd", "not-a-directory"])(
    "rejects a %s runtime cwd before spawn",
    async (cwd) => {
      const packageRoot = await mkdtemp(
        path.join(os.tmpdir(), "codex-plugin-doctor-runtime-cwd-invalid-")
      );
      const markerPath = path.join(packageRoot, "runtime-started");

      try {
        if (cwd === "not-a-directory") {
          await writeFile(path.join(packageRoot, cwd), "not a directory");
        }

        const result = await probeRuntime(
          await createRuntimeCwdPackage(packageRoot, cwd)
        );

        expect(result.findings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              id: "plugin.runtime.startup.invalid_cwd",
              severity: "fail",
              evidence: { serverName: "cwdServer", method: "startup" }
            })
          ])
        );
        expect(result.scorecard.initialize).toBe("fail");
        expect(result.execution).toBeUndefined();
        await expect(access(markerPath)).rejects.toThrow();
      } finally {
        await rm(packageRoot, { recursive: true, force: true });
      }
    }
  );

  it.skipIf(process.platform === "win32")(
    "rejects an in-root cwd symlink that resolves outside the package before spawn",
    async () => {
      const packageRoot = await mkdtemp(
        path.join(os.tmpdir(), "codex-plugin-doctor-runtime-cwd-root-")
      );
      const externalPath = await mkdtemp(
        path.join(os.tmpdir(), "codex-plugin-doctor-runtime-cwd-external-")
      );
      const markerPath = path.join(externalPath, "runtime-started");

      try {
        await writeFile(
          path.join(externalPath, "server.mjs"),
          markerServerSource(markerPath)
        );
        await symlink(externalPath, path.join(packageRoot, "linked-cwd"), "dir");

        const result = await probeRuntime(
          await createRuntimeCwdPackage(packageRoot, "linked-cwd")
        );

        expect(result.findings.map((finding) => finding.id)).toContain(
          "plugin.runtime.startup.invalid_cwd"
        );
        expect(result.execution).toBeUndefined();
        await expect(access(markerPath)).rejects.toThrow();
      } finally {
        await rm(packageRoot, { recursive: true, force: true });
        await rm(externalPath, { recursive: true, force: true });
      }
    }
  );

  it("starts an ordinary in-root cwd", async () => {
    const packageRoot = await mkdtemp(
      path.join(os.tmpdir(), "codex-plugin-doctor-runtime-cwd-in-root-")
    );
    const serverPath = path.join(packageRoot, "server");
    const markerPath = path.join(serverPath, "runtime-started");

    try {
      await mkdir(serverPath);
      await writeFile(
        path.join(serverPath, "server.mjs"),
        markerServerSource(markerPath)
      );

      const result = await probeRuntime(
        await createRuntimeCwdPackage(packageRoot, "server"),
        { startupTimeoutMs: 2_000 }
      );

      expect(result.scorecard.initialize).toBe("pass");
      expect(result.findings.map((finding) => finding.id)).not.toContain(
        "plugin.runtime.startup.invalid_cwd"
      );
      expect(await access(markerPath)).toBeUndefined();
    } finally {
      await rm(packageRoot, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100
      });
    }
  });

  it("passes when the stdio server completes initialize and supports tools, resources, prompts, read, and get probing", async () => {
    const result = await runCheck(path.resolve("tests/fixtures/runtime-valid"), {
      runtime: true
    });

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard).toBeDefined();
    expect(result.runtimeScorecard?.initialize).toBe("pass");
    expect(result.runtimeScorecard?.toolsList).toBe("pass");
    expect(result.runtimeScorecard?.toolsCall).toBe("pass");
    expect(result.runtimeScorecard?.resourcesList).toBe("pass");
    expect(result.runtimeScorecard?.resourceRead).toBe("pass");
    expect(result.runtimeScorecard?.resourceTemplatesList).toBe("pass");
    expect(result.runtimeScorecard?.promptsList).toBe("pass");
    expect(result.runtimeScorecard?.promptGet).toBe("pass");
  });

  it("fails when initialize returns an invalid MCP response", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-initialize"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.initialize.invalid",
          severity: "fail"
        })
      ])
    );
    expect(result.runtimeScorecard?.conformance).toMatchObject({
      protocolVersion: null,
      profile: null,
      capabilityConsistency: "skipped",
      taskDeclarations: "skipped",
      tasksList: "skipped",
      schemaDialect: "skipped"
    });
  });

  it.each(["latest", "2025-02-30", "2025-99-99"])(
    "rejects an invalid negotiated protocol version: %s",
    async (protocolVersion) => {
      const packageRoot = await mkdtemp(
        path.join(os.tmpdir(), "codex-plugin-doctor-invalid-protocol-version-")
      );

      try {
        await mkdir(path.join(packageRoot, ".codex-plugin"));
        await writeFile(
          path.join(packageRoot, ".codex-plugin", "plugin.json"),
          JSON.stringify({
            name: "runtime-invalid-protocol-version",
            version: "1.0.0",
            description: "Fixture generated for malformed protocol-version coverage.",
            mcpServers: "./.mcp.json"
          })
        );
        await writeFile(
          path.join(packageRoot, ".mcp.json"),
          JSON.stringify({
            mcpServers: {
              mockServer: {
                command: "node",
                args: ["./mock-server.js"]
              }
            }
          })
        );
        await writeFile(
          path.join(packageRoot, "mock-server.js"),
          `import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: ${JSON.stringify(protocolVersion)},
        capabilities: {},
        serverInfo: { name: "invalid-protocol-version", version: "1.0.0" }
      }
    }) + "\\n");
  }
});
`
        );

        const result = await runCheck(packageRoot, { runtime: true });

        expect(result.status).toBe("fail");
        expect(result.findings).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ id: "plugin.runtime.initialize.invalid" })
          ])
        );
        expect(result.runtimeScorecard?.conformance).toMatchObject({
          protocolVersion: null,
          profile: null,
          capabilityConsistency: "skipped",
          taskDeclarations: "skipped",
          tasksList: "skipped",
          schemaDialect: "skipped"
        });
      } finally {
        await rm(packageRoot, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100
        });
      }
    }
  );

  it("records legacy conformance when tools are unsupported without sending task methods", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-conformance-legacy"),
      { runtime: true }
    );

    expect(result.status).toBe("warn");
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "plugin.runtime.tools.unsupported"
    ]);
    expect(result.runtimeScorecard?.conformance).toEqual({
      protocolVersion: "2025-06-18",
      profile: "legacy",
      capabilityConsistency: "skipped",
      taskDeclarations: "skipped",
      tasksList: "skipped",
      schemaDialect: "skipped",
      overall: "pass"
    });
  });

  it("warns only for a newer protocol and keeps conformance evidence at the observed method", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-conformance-future"),
      { runtime: true }
    );

    expect(result.status).toBe("warn");
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "mcp.conformance.protocol.unknown_newer",
        severity: "warn",
        evidence: {
          serverName: "futureConformanceServer",
          method: "initialize",
          protocolVersion: "2026-01-01"
        }
      })
    ]);
    expect(result.runtimeScorecard?.conformance).toEqual({
      protocolVersion: "2026-01-01",
      profile: "future-compatible",
      capabilityConsistency: "pass",
      taskDeclarations: "pass",
      tasksList: "skipped",
      schemaDialect: "pass",
      overall: "warn"
    });
  });

  it("observes paginated tasks/list metadata without retaining private task data", async () => {
    const transcript: string[] = [];
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-conformance-tasks-valid"),
      { runtime: true, runtimeTranscript: (line) => transcript.push(line) }
    );

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard?.conformance?.tasksList).toBe("pass");
    expect(JSON.stringify(result)).not.toContain("private-task");
    expect(transcript).toContain(
      '<- tasks/list {"tasks":1,"nextCursor":"[CURSOR]"}'
    );
    expect(transcript).toContain('<- tasks/list {"tasks":1}');
    expect(transcript.join("\n")).not.toContain("private-task");
    expect(transcript.join("\n")).not.toContain("working");
    expect(transcript.join("\n")).not.toContain("private-task-cursor");
  });

  it("fails task-list conformance when tasks/list returns a non-array", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-conformance-tasks-invalid"),
      { runtime: true }
    );

    expect(result.status).toBe("fail");
    expect(result.findings.filter((finding) => finding.id === "mcp.conformance.tasks_list.invalid")).toHaveLength(1);
    expect(result.runtimeScorecard?.conformance?.tasksList).toBe("fail");
  });

  it("fails task-list conformance when tasks/list times out", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-conformance-tasks-timeout"),
      { runtime: true, runtimeStartupTimeoutMs: 500 }
    );

    expect(result.status).toBe("fail");
    expect(result.findings.filter((finding) => finding.id === "mcp.conformance.tasks_list.timeout")).toHaveLength(1);
    expect(result.runtimeScorecard?.conformance?.tasksList).toBe("fail");
  });

  it("probes tasks/list without tools and preserves the existing no-tools warning", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-conformance-tasks-list-only"),
      { runtime: true }
    );

    expect(result.status).toBe("warn");
    expect(result.findings.map((finding) => finding.id)).toEqual([
      "plugin.runtime.tools.unsupported"
    ]);
    expect(result.runtimeScorecard?.conformance?.tasksList).toBe("pass");
  });

  it("bounds repeated shared cursors and task pagination at 100 pages", async () => {
    const transcript: string[] = [];
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-pagination-bounds"),
      {
        runtime: true,
        runtimeStartupTimeoutMs: 2_000,
        runtimeTranscript: (line) => transcript.push(line)
      }
    );

    expect(result.status).toBe("fail");
    expect(
      result.findings.filter(
        (finding) => finding.id === "plugin.runtime.tools_list.invalid"
      )
    ).toHaveLength(1);
    expect(
      result.findings.filter(
        (finding) => finding.id === "mcp.conformance.tasks_list.invalid"
      )
    ).toHaveLength(1);
    expect(result.runtimeScorecard?.conformance?.tasksList).toBe("fail");
    expect(
      transcript.filter((line) => line.startsWith("-> tools/list"))
    ).toHaveLength(2);
    expect(
      transcript.filter((line) => line.startsWith("-> tasks/list"))
    ).toHaveLength(100);
  });

  it("fails when tools/list returns invalid tool definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-tools"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tools_list.invalid",
          severity: "fail",
          evidence: {
            serverName: "mockServer",
            method: "tools/list"
          }
        })
      ])
    );
    expect(result.runtimeScorecard?.conformance).toEqual({
      protocolVersion: null,
      profile: null,
      capabilityConsistency: "skipped",
      taskDeclarations: "skipped",
      tasksList: "skipped",
      schemaDialect: "skipped",
      overall: "skipped"
    });
  });

  it("probes declared tasks/list when tools/list is invalid", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-tools-and-tasks"),
      { runtime: true, runtimeStartupTimeoutMs: 2_000 }
    );

    expect(result.status).toBe("fail");
    expect(result.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "plugin.runtime.tools_list.invalid",
        "mcp.conformance.tasks_list.invalid"
      ])
    );
    expect(result.runtimeScorecard?.conformance).toEqual({
      protocolVersion: "2025-11-25",
      profile: "2025-11-25",
      capabilityConsistency: "skipped",
      taskDeclarations: "skipped",
      tasksList: "fail",
      schemaDialect: "skipped",
      overall: "fail"
    });
  });

  it("skips conformance when a parseable tool has an invalid input schema", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-tool-schema"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "plugin.runtime.tools_list.invalid" })
      ])
    );
    expect(result.runtimeScorecard?.conformance).toEqual({
      protocolVersion: null,
      profile: null,
      capabilityConsistency: "skipped",
      taskDeclarations: "skipped",
      tasksList: "skipped",
      schemaDialect: "skipped",
      overall: "skipped"
    });
  });

  it("fails when tools/call returns an invalid result payload", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-call"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tool_call.invalid",
          severity: "fail",
          evidence: {
            serverName: "mockServer",
            method: "tools/call",
            toolName: "ping"
          }
        })
      ])
    );
  });

  it("passes when a safe tool requires generated arguments from its schema", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-generated-tool"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard?.toolsCall).toBe("pass");
  });

  it("warns and skips tool invocation when only destructive tools are available", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-destructive-tool"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.runtimeScorecard?.toolsCall).toBe("skipped");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tool_call.skipped",
          severity: "warn"
        })
      ])
    );
  });

  it("fails when resources/list returns invalid resource definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-resources"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.resources_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when prompts/list returns invalid prompt definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-prompts"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.prompts_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when resources/read returns invalid resource contents", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-read"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.resource_read.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when prompts/get returns invalid prompt messages", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-get"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.prompt_get.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("passes when list operations paginate across multiple pages", async () => {
    const result = await runCheck(path.resolve("tests/fixtures/runtime-paginated"), {
      runtime: true
    });

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard?.toolsList).toBe("pass");
    expect(result.runtimeScorecard?.resourcesList).toBe("pass");
    expect(result.runtimeScorecard?.resourceTemplatesList).toBe("pass");
    expect(result.runtimeScorecard?.promptsList).toBe("pass");
  });

  it("fails when resources/templates/list returns invalid resource template definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-templates"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.resource_templates_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("warns when runtime payloads are structurally valid but excessively large", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-large-payloads"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tool_call.content_too_large",
          severity: "warn",
          evidence: {
            serverName: "mockServer",
            method: "tools/call",
            toolName: "ping",
            contentLength: 6000
          }
        }),
        expect.objectContaining({
          id: "plugin.runtime.resource_read.content_too_large",
          severity: "warn",
          evidence: {
            serverName: "mockServer",
            method: "resources/read",
            resourceUri: "file:///workspace/README.md",
            contentLength: 6000
          }
        }),
        expect.objectContaining({
          id: "plugin.runtime.prompt_get.content_too_large",
          severity: "warn",
          evidence: {
            serverName: "mockServer",
            method: "prompts/get",
            promptName: "summary",
            contentLength: 6000
          }
        })
      ])
    );
    expect(JSON.stringify(result.findings)).not.toContain("XXXX");
  });
});
