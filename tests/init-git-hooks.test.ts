import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run-cli.js";
import { initGitHooks } from "../src/core/init-git-hooks.js";

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

async function createGitRepo(): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-hooks-"));
  const hooksDir = path.join(targetPath, ".git", "hooks");
  const { mkdir } = await import("node:fs/promises");

  await mkdir(hooksDir, { recursive: true });
  return targetPath;
}

describe("init-git-hooks", () => {
  describe("initGitHooks core function", () => {
    it("creates pre-commit and pre-push hooks in a fresh directory", async () => {
      const targetPath = await createGitRepo();
      const result = await initGitHooks(targetPath);

      expect(result.rootPath).toBe(path.resolve(targetPath));
      expect(result.hookPaths).toHaveLength(2);
      expect(result.hookPaths[0]).toBe(path.join(result.rootPath, ".git", "hooks", "pre-commit"));
      expect(result.hookPaths[1]).toBe(path.join(result.rootPath, ".git", "hooks", "pre-push"));
      expect(result.preExisting).toEqual([]);

      const preCommitContent = await readFile(result.hookPaths[0], "utf8");
      expect(preCommitContent).toContain("Codex Plugin Doctor: running pre-commit validation");
      expect(preCommitContent).toContain("codex-plugin-doctor check . --profile ci");

      const prePushContent = await readFile(result.hookPaths[1], "utf8");
      expect(prePushContent).toContain("Codex Plugin Doctor: running pre-push validation");
      expect(prePushContent).toContain("codex-plugin-doctor check . --profile ci --runtime");
    });

    it("overwrites existing hooks when force is true", async () => {
      const targetPath = await createGitRepo();
      const hookPath = path.join(targetPath, ".git", "hooks", "pre-commit");

      await writeFile(hookPath, "echo old", "utf8");
      const result = await initGitHooks(targetPath, { force: true });

      expect(result.preExisting).toContain(hookPath);
      const content = await readFile(hookPath, "utf8");
      expect(content).toContain("Codex Plugin Doctor: running pre-commit validation");
      expect(content).not.toContain("echo old");
    });

    it("does not overwrite existing hooks when force is false", async () => {
      const targetPath = await createGitRepo();
      const hookPath = path.join(targetPath, ".git", "hooks", "pre-commit");

      await writeFile(hookPath, "echo old", "utf8");
      const result = await initGitHooks(targetPath, { force: false });

      const content = await readFile(hookPath, "utf8");
      expect(content).toBe("echo old");
      expect(result.preExisting).not.toContain(hookPath);
    });

    it("creates .git/hooks directory if it does not exist", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-hooks-"));
      const result = await initGitHooks(targetPath);

      const { stat } = await import("node:fs/promises");
      const hookDirStat = await stat(path.join(targetPath, ".git", "hooks"));
      expect(hookDirStat.isDirectory()).toBe(true);

      expect(result.hookPaths).toHaveLength(2);
    });

    it("returns empty preExisting for fresh hooks", async () => {
      const targetPath = await createGitRepo();
      const result = await initGitHooks(targetPath);

      expect(result.preExisting).toEqual([]);
    });
  });

  describe("init-git-hooks CLI", () => {
    it("initializes git hooks and prints summary", async () => {
      const targetPath = await createGitRepo();
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["init-git-hooks", targetPath], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("Initialized Codex Plugin Doctor git hooks");
      expect(stdout.join("")).toContain(targetPath);

      const preCommitContent = await readFile(
        path.join(targetPath, ".git", "hooks", "pre-commit"),
        "utf8"
      );
      expect(preCommitContent).toContain("codex-plugin-doctor check");
    });

    it("renders JSON output for automation consumers", async () => {
      const targetPath = await createGitRepo();
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["init-git-hooks", targetPath, "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(output).toMatchObject({
        schemaVersion: "1.0.0",
        kind: "doctor.git.hooks",
        rootPath: path.resolve(targetPath),
        preExisting: []
      });
      expect(output.hookPaths).toEqual([
        path.join(path.resolve(targetPath), ".git", "hooks", "pre-commit"),
        path.join(path.resolve(targetPath), ".git", "hooks", "pre-push")
      ]);
    });

    it("uses current directory when no path given", async () => {
      const { io, stdout, stderr } = createIo();
      const exitCode = await runCli(["init-git-hooks", "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(output).toMatchObject({ kind: "doctor.git.hooks" });
    });

    it("reports overwritten hooks with force flag", async () => {
      const targetPath = await createGitRepo();
      const hookPath = path.join(targetPath, ".git", "hooks", "pre-commit");

      await writeFile(hookPath, "echo old", "utf8");
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["init-git-hooks", targetPath, "--force"], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("Overwritten existing hooks");
      expect(stdout.join("")).toContain(hookPath);
    });

    it("skips overwrite without force flag", async () => {
      const targetPath = await createGitRepo();
      const hookPath = path.join(targetPath, ".git", "hooks", "pre-commit");

      await writeFile(hookPath, "echo old", "utf8");
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["init-git-hooks", targetPath], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).not.toContain("Overwritten");

      const content = await readFile(hookPath, "utf8");
      expect(content).toBe("echo old");
    });

    it("writes hooks with correct shell script content", async () => {
      const targetPath = await createGitRepo();
      const { io } = createIo();

      await runCli(["init-git-hooks", targetPath], io);

      const preCommit = await readFile(
        path.join(targetPath, ".git", "hooks", "pre-commit"),
        "utf8"
      );
      expect(preCommit).toContain("#!/usr/bin/env sh");
      expect(preCommit).toContain("Plugin validation failed. Commit blocked.");

      const prePush = await readFile(
        path.join(targetPath, ".git", "hooks", "pre-push"),
        "utf8"
      );
      expect(prePush).toContain("#!/usr/bin/env sh");
      expect(prePush).toContain("Plugin validation failed. Push blocked.");
      expect(prePush).toContain("--runtime");
    });
  });
});
