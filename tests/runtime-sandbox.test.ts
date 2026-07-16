import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const childProcessMocks = vi.hoisted(() => ({
  execFile: vi.fn(),
  spawn: vi.fn()
}));

vi.mock("node:child_process", () => childProcessMocks);

import {
  buildRuntimeLaunch,
  DOCKER_RUNTIME_IMAGE,
  DOCKER_RUNTIME_STARTUP_TIMEOUT_MS,
  RuntimeSandboxError
} from "../src/core/runtime-sandbox.js";
import { probeRuntime } from "../src/core/runtime-probe.js";

class FakeChildProcess extends EventEmitter {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  killed = false;
  readonly kill = vi.fn(() => {
    this.killed = true;
    this.exitCode = 0;
    queueMicrotask(() => this.emit("exit", 0, null));
    return true;
  });
}

function createProtocolChild(options: { tools?: boolean } = {}): FakeChildProcess {
  const child = new FakeChildProcess();
  let buffer = "";

  child.stdin.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();

    while (buffer.includes("\n")) {
      const newlineIndex = buffer.indexOf("\n");
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (!line) {
        continue;
      }

      const request = JSON.parse(line) as { id?: number; method?: string };

      if (request.method === "initialize") {
        child.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: "2025-11-25",
            capabilities: options.tools ? { tools: {} } : {},
            serverInfo: { name: "sandbox-test", version: "1.0.0" }
          }
        })}\n`);
      } else if (request.method === "tools/list") {
        child.stdout.write(`${JSON.stringify({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [] }
        })}\n`);
      }
    }
  });

  queueMicrotask(() => child.emit("spawn"));
  return child;
}

function runtimePackage() {
  const rootPath = path.resolve("tests/fixtures/runtime-valid");

  return {
    rootPath,
    manifestPath: path.join(rootPath, ".codex-plugin", "plugin.json"),
    manifest: {
      name: "runtime-valid",
      version: "1.0.0",
      mcpServers: "./.mcp.json"
    }
  };
}

async function createRuntimePackage(command: string) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "runtime-sandbox-"));
  const manifestDirectory = path.join(rootPath, ".codex-plugin");

  await mkdir(manifestDirectory);
  await writeFile(
    path.join(rootPath, ".mcp.json"),
    JSON.stringify({
      mcpServers: {
        testServer: {
          command,
          args: ["./server.js"]
        }
      }
    })
  );

  return {
    rootPath,
    manifestPath: path.join(manifestDirectory, "plugin.json"),
    manifest: {
      name: "runtime-sandbox-test",
      version: "1.0.0",
      mcpServers: "./.mcp.json"
    }
  };
}

beforeEach(() => {
  childProcessMocks.spawn.mockReset();
  childProcessMocks.execFile.mockReset();
  childProcessMocks.execFile.mockImplementation(
    (
      _file: string,
      _args: string[],
      _options: object,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      queueMicrotask(() => callback(null, "", ""));
    }
  );
});

describe("Docker runtime launch policy", () => {
  it("builds an immutable, constrained Docker launch for a nested package cwd", () => {
    const packageRoot = path.join(os.tmpdir(), "Work Area", "plugin");
    const cwd = path.join(packageRoot, "server");
    const launch = buildRuntimeLaunch({
      sandbox: "docker",
      packageRoot,
      cwd,
      command: "node.exe",
      args: ["index.js"],
      containerName: "codex-doctor-test"
    });

    expect(launch.command).toBe("docker");
    expect(launch.cwd).toBe(packageRoot);
    expect(launch.containerName).toBe("codex-doctor-test");
    expect(launch.args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "-i",
        "--init",
        "--name",
        "codex-doctor-test",
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--user",
        "65532:65532",
        "--pids-limit",
        "64",
        "--memory",
        "256m",
        "--cpus",
        "1",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,size=16m",
        "--mount",
        `type=bind,source=${packageRoot},target=/workspace,readonly`,
        "--workdir",
        "/workspace/server",
        DOCKER_RUNTIME_IMAGE,
        "node",
        "index.js"
      ])
    );
    expect(launch.evidence).toEqual({
      backend: "docker",
      image: DOCKER_RUNTIME_IMAGE,
      network: "none",
      packageMount: "read_only"
    });
    expect(launch.evidence.image).toMatch(/@sha256:[a-f0-9]{64}$/);
    expect(DOCKER_RUNTIME_STARTUP_TIMEOUT_MS).toBe(60_000);
  });

  it("rejects non-Node commands", () => {
    expect(() =>
      buildRuntimeLaunch({
        sandbox: "docker",
        packageRoot: "/package",
        cwd: "/package",
        command: "npx",
        args: ["server"],
        containerName: "codex-doctor-test"
      })
    ).toThrow(RuntimeSandboxError);
  });

  it("rejects a cwd outside the package root", () => {
    expect(() =>
      buildRuntimeLaunch({
        sandbox: "docker",
        packageRoot: "/package",
        cwd: "/outside",
        command: "node",
        args: [],
        containerName: "codex-doctor-test"
      })
    ).toThrow("Runtime cwd escapes the package root.");
  });

  it("allows an in-root cwd whose basename begins with two dots", () => {
    const packageRoot = path.join(os.tmpdir(), "plugin");
    const cwd = path.join(packageRoot, "..cache");
    const launch = buildRuntimeLaunch({
      sandbox: "docker",
      packageRoot,
      cwd,
      command: "node",
      args: [],
      containerName: "codex-doctor-test"
    });

    expect(launch.args).toContain("/workspace/..cache");
  });

  it("rejects package mount paths containing commas", () => {
    expect(() =>
      buildRuntimeLaunch({
        sandbox: "docker",
        packageRoot: "/package,unsafe",
        cwd: "/package,unsafe",
        command: "node",
        args: [],
        containerName: "codex-doctor-test"
      })
    ).toThrow("Docker sandbox does not support commas in package paths.");
  });

  it("rejects unknown sandbox modes", () => {
    expect(() =>
      buildRuntimeLaunch({
        sandbox: "native" as never,
        packageRoot: "/package",
        cwd: "/package",
        command: "node",
        args: [],
        containerName: "codex-doctor-test"
      })
    ).toThrow("Unsupported sandbox mode.");
  });

  it("routes Docker probes through the constrained launch and force-removes the container", async () => {
    childProcessMocks.spawn.mockImplementation(() => createProtocolChild());

    const result = await probeRuntime(runtimePackage(), {
      sandbox: "docker",
      startupTimeoutMs: 17
    });

    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      "docker",
      expect.arrayContaining(["run", "--rm", "--network", "none"]),
      {
        cwd: runtimePackage().rootPath,
        stdio: ["pipe", "pipe", "pipe"]
      }
    );

    const launchArgs = childProcessMocks.spawn.mock.calls[0][1] as string[];
    const containerName = launchArgs[launchArgs.indexOf("--name") + 1];

    expect(containerName).toMatch(/^codex-doctor-[0-9a-f-]{36}$/);
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", containerName],
      expect.any(Object),
      expect.any(Function)
    );
    expect(result.execution).toEqual({
      backend: "docker",
      image: DOCKER_RUNTIME_IMAGE,
      network: "none",
      packageMount: "read_only"
    });
  });

  it("uses the Docker startup timeout only for initialize", async () => {
    const timeoutSpy = vi.spyOn(globalThis, "setTimeout");
    childProcessMocks.spawn.mockImplementation(() =>
      createProtocolChild({ tools: true })
    );

    try {
      await probeRuntime(runtimePackage(), {
        sandbox: "docker",
        startupTimeoutMs: 17
      });

      const delays = timeoutSpy.mock.calls.map((call) => call[1]);
      expect(delays).toContain(DOCKER_RUNTIME_STARTUP_TIMEOUT_MS);
      expect(delays).toContain(17);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it("turns Docker cleanup failures into sanitized findings", async () => {
    childProcessMocks.spawn.mockImplementation(() => createProtocolChild());
    childProcessMocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        queueMicrotask(() =>
          callback(
            new Error("cleanup exposed HOST_SECRET=top-secret"),
            "",
            "daemon exposed HOST_SECRET=top-secret"
          )
        );
      }
    );

    const result = await probeRuntime(runtimePackage(), { sandbox: "docker" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.sandbox.cleanup_failed",
          severity: "fail"
        })
      ])
    );
    expect(JSON.stringify(result.findings)).not.toContain("HOST_SECRET");
    expect(JSON.stringify(result.findings)).not.toContain("top-secret");
  });

  it("does not clean up a Docker container when the child errors before spawn", async () => {
    const child = new FakeChildProcess();
    childProcessMocks.spawn.mockImplementation(() => {
      queueMicrotask(() =>
        child.emit("error", new Error("spawn exposed HOST_SECRET=top-secret"))
      );
      return child;
    });
    childProcessMocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        queueMicrotask(() =>
          callback(
            new Error("cleanup exposed HOST_SECRET=top-secret"),
            "",
            "daemon exposed HOST_SECRET=top-secret"
          )
        );
      }
    );

    const result = await probeRuntime(runtimePackage(), { sandbox: "docker" });

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.startup.failed",
          severity: "fail"
        })
      ])
    );
    expect(result.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.sandbox.cleanup_failed"
        })
      ])
    );
    expect(childProcessMocks.execFile).not.toHaveBeenCalled();
  });

  it("tolerates Docker not-found after an --rm container exits", async () => {
    childProcessMocks.spawn.mockImplementation(() => createProtocolChild());
    childProcessMocks.execFile.mockImplementation(
      (
        _file: string,
        _args: string[],
        _options: object,
        callback: (error: Error | null, stdout: string, stderr: string) => void
      ) => {
        queueMicrotask(() =>
          callback(
            new Error("container missing"),
            "",
            "Error response from daemon: No such container: codex-doctor-test"
          )
        );
      }
    );

    const result = await probeRuntime(runtimePackage(), { sandbox: "docker" });

    expect(childProcessMocks.execFile).toHaveBeenCalledOnce();
    expect(result.findings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.sandbox.cleanup_failed"
        })
      ])
    );
  });

  it("force-removes the Docker container after initialize times out", async () => {
    vi.useFakeTimers();
    const child = new FakeChildProcess();
    let notifySpawnCalled: () => void;
    const spawnCalled = new Promise<void>((resolve) => {
      notifySpawnCalled = resolve;
    });
    childProcessMocks.spawn.mockImplementation(() => {
      notifySpawnCalled();
      queueMicrotask(() => child.emit("spawn"));
      return child;
    });

    try {
      const resultPromise = probeRuntime(runtimePackage(), {
        sandbox: "docker",
        startupTimeoutMs: 17
      });

      await spawnCalled;
      await vi.advanceTimersByTimeAsync(DOCKER_RUNTIME_STARTUP_TIMEOUT_MS);
      const result = await resultPromise;
      const launchArgs = childProcessMocks.spawn.mock.calls[0][1] as string[];
      const containerName = launchArgs[launchArgs.indexOf("--name") + 1];

      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "plugin.runtime.initialize.timeout",
            severity: "fail"
          })
        ])
      );
      expect(childProcessMocks.execFile).toHaveBeenCalledWith(
        "docker",
        ["rm", "-f", containerName],
        expect.any(Object),
        expect.any(Function)
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("force-removes the Docker container after the runtime crashes without exposing stderr", async () => {
    const child = new FakeChildProcess();
    childProcessMocks.spawn.mockImplementation(() => {
      queueMicrotask(() => {
        child.emit("spawn");
        child.stderr.write("HOST_SECRET=top-secret");
        child.exitCode = 1;
        child.emit("exit", 1, null);
      });
      return child;
    });

    const result = await probeRuntime(runtimePackage(), { sandbox: "docker" });
    const launchArgs = childProcessMocks.spawn.mock.calls[0][1] as string[];
    const containerName = launchArgs[launchArgs.indexOf("--name") + 1];

    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.exited_early",
          severity: "fail"
        })
      ])
    );
    expect(JSON.stringify(result.findings)).not.toContain("HOST_SECRET");
    expect(JSON.stringify(result.findings)).not.toContain("top-secret");
    expect(childProcessMocks.execFile).toHaveBeenCalledWith(
      "docker",
      ["rm", "-f", containerName],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it("does not fall back to native execution for unsupported Docker commands", async () => {
    const discoveredPackage = await createRuntimePackage("npx");

    try {
      const result = await probeRuntime(discoveredPackage, {
        sandbox: "docker"
      });

      expect(childProcessMocks.spawn).not.toHaveBeenCalled();
      expect(result.execution).toBeUndefined();
      expect(result.findings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "plugin.runtime.startup.failed",
            severity: "fail"
          })
        ])
      );
    } finally {
      await rm(discoveredPackage.rootPath, { recursive: true, force: true });
    }
  });
});
