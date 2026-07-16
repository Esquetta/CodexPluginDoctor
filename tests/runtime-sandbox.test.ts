import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildRuntimeLaunch,
  DOCKER_RUNTIME_IMAGE,
  DOCKER_RUNTIME_STARTUP_TIMEOUT_MS,
  RuntimeSandboxError
} from "../src/core/runtime-sandbox.js";

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
});
