import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run-cli.js";
import { watchPlugin } from "../src/core/watch-plugin.js";

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

async function createPluginFixture(): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-watch-"));
  const manifestDir = path.join(targetPath, ".codex-plugin");
  const { mkdir } = await import("node:fs/promises");

  await mkdir(manifestDir, { recursive: true });
  await writeFile(
    path.join(manifestDir, "plugin.json"),
    JSON.stringify({ name: "watch-test", version: "0.1.0", description: "A test plugin for watch mode." }),
    "utf8"
  );

  return targetPath;
}

describe("watch command", () => {
  it("rejects watch with missing output path", async () => {
    const { io, stdout, stderr } = createIo();
    const exitCode = await runCli(["watch", ".", "--output"], io);

    expect(exitCode).toBe(2);
    expect(stderr.join("")).toContain("Missing path after --output");
    expect(stdout).toEqual([]);
  });

  it("starts watching and resolves on signal", async () => {
    const targetPath = await createPluginFixture();

    const result = await new Promise((resolve) => {
      const promise = watchPlugin({
        targetPath,
        debounceMs: 10,
        runtime: false,
        jsonOutput: false,
        outputPath: null
      });

      setTimeout(() => {
        process.emit("SIGTERM" as unknown as NodeJS.Signals);
      }, 200);

      promise.then(resolve);
    });

    expect(result.targetPath).toBe(path.resolve(targetPath));
    expect(result.validations).toBeGreaterThanOrEqual(0);
    expect(typeof result.failures).toBe("number");
  });

  it("runs a validation after debounce delay", async () => {
    const targetPath = await createPluginFixture();

    const result = await new Promise((resolve) => {
      const promise = watchPlugin({
        targetPath,
        debounceMs: 50,
        runtime: false,
        jsonOutput: false,
        outputPath: null
      });

      setTimeout(() => {
        process.emit("SIGTERM" as unknown as NodeJS.Signals);
      }, 500);

      promise.then(resolve);
    });

    expect(result.validations).toBeGreaterThanOrEqual(1);
  });

  it("counts failures for invalid plugin packages", async () => {
    const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-watch-"));

    const result = await new Promise((resolve) => {
      const promise = watchPlugin({
        targetPath,
        debounceMs: 10,
        runtime: false,
        jsonOutput: false,
        outputPath: null
      });

      setTimeout(() => {
        process.emit("SIGTERM" as unknown as NodeJS.Signals);
      }, 300);

      promise.then(resolve);
    });

    expect(result.validations).toBeGreaterThanOrEqual(1);
    expect(result.failures).toBe(result.validations);
  });

  it("passes with zero failures for valid plugins", async () => {
    const targetPath = await createPluginFixture();

    const result = await new Promise((resolve) => {
      const promise = watchPlugin({
        targetPath,
        debounceMs: 10,
        runtime: false,
        jsonOutput: false,
        outputPath: null
      });

      setTimeout(() => {
        process.emit("SIGTERM" as unknown as NodeJS.Signals);
      }, 300);

      promise.then(resolve);
    });

    expect(result.validations).toBeGreaterThanOrEqual(1);
    expect(result.failures).toBe(0);
  });

  it("writes JSON output to file when outputPath is set", async () => {
    const targetPath = await createPluginFixture();
    const outputPath = path.join(targetPath, "watch-output.json");

    const result = await new Promise((resolve) => {
      const promise = watchPlugin({
        targetPath,
        debounceMs: 10,
        runtime: false,
        jsonOutput: true,
        outputPath
      });

      setTimeout(() => {
        process.emit("SIGTERM" as unknown as NodeJS.Signals);
      }, 300);

      promise.then(resolve);
    });

    const { readFile } = await import("node:fs/promises");
    const content = await readFile(outputPath, "utf8");
    const parsed = JSON.parse(content);

    expect(parsed).toMatchObject({
      schemaVersion: "1.0.0",
      targetPath: path.resolve(targetPath),
      status: "pass",
      findingsCount: 0
    });
    expect(parsed.findings).toEqual([]);
    expect(result.failures).toBe(0);
  });
});
