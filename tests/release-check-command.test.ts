import { cp, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runCli } from "../src/run-cli.js";
import { renderReleaseCheck, renderReleaseCheckJson } from "../src/core/release-check.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) { stdout.push(message); },
      writeStderr(message: string) { stderr.push(message); }
    }
  };
}

describe("release-check command", () => {
  describe("renderers", () => {
    it("renders a failing release check as text", () => {
      const report = {
        targetPath: "/test/plugin",
        status: "fail" as const,
        ready: false,
        checks: {
          validation: { status: "pass", findings: 0, exitCode: 0 },
          security: { status: "fail", score: 65 },
          dependencies: { status: "pass", vulnerabilities: 0 },
          compatibility: { status: "pass", score: 100, overallStatus: "pass" as const },
          trust: { status: "pass", score: 80 }
        }
      };

      const output = renderReleaseCheck(report);

      expect(output).toContain("Ready: NO");
      expect(output).toContain("security");
      expect(output).toContain("score: 65");
      expect(output).toContain("Some checks failed");
    });

    it("renders a passing release check as text", () => {
      const report = {
        targetPath: "/test/plugin",
        status: "pass" as const,
        ready: true,
        checks: {
          validation: { status: "pass", findings: 0, exitCode: 0 },
          security: { status: "pass", score: 100 },
          dependencies: { status: "pass", vulnerabilities: 0 },
          compatibility: { status: "pass", score: 100, overallStatus: "pass" as const },
          trust: { status: "pass", score: 80 }
        }
      };

      const output = renderReleaseCheck(report);

      expect(output).toContain("Ready: YES");
      expect(output).toContain("All release checks passed");
    });

    it("renders JSON output", () => {
      const report = {
        targetPath: "/test/plugin",
        status: "fail" as const,
        ready: false,
        checks: {
          validation: { status: "pass", findings: 0, exitCode: 0 },
          security: { status: "fail", score: 65 },
          dependencies: { status: "pass", vulnerabilities: 0 },
          compatibility: { status: "pass", score: 100, overallStatus: "pass" as const },
          trust: { status: "pass", score: 80 }
        }
      };

      const json = JSON.parse(renderReleaseCheckJson(report));

      expect(json).toMatchObject({
        schemaVersion: "1.0.0",
        status: "fail",
        ready: false
      });
    });
  });

  describe("CLI", () => {
    it("keeps runtime probing disabled by default", async () => {
      const { io, stdout, stderr } = createIo();
      const runCheckImpl = vi.fn(async (targetPath: string) => ({
        targetPath,
        status: "pass" as const,
        exitCode: 0 as const,
        findings: []
      }));

      const exitCode = await runCli(
        ["release", "check", "tests/fixtures/valid-plugin-with-mcp", "--json"],
        io,
        { runCheckImpl }
      );
      const output = JSON.parse(stdout.join(""));

      expect(stderr).toEqual([]);
      expect(exitCode).toBeGreaterThanOrEqual(0);
      expect(output).toMatchObject({ schemaVersion: "1.0.0", runtimeProbeEnabled: false });
      expect(runCheckImpl).toHaveBeenCalledWith(expect.any(String), { runtime: false });
      expect(output.checks.validation).toBeDefined();
      expect(output.checks.security).toBeDefined();
      expect(output.checks.dependencies).toBeDefined();
      expect(output.checks.compatibility).toBeDefined();
      expect(output.checks.trust).toBeDefined();
    }, 30000);

    it("runs runtime probing only when --runtime is explicit", async () => {
      const { io, stdout } = createIo();
      const runCheckImpl = vi.fn(async (targetPath: string) => ({
        targetPath,
        status: "pass" as const,
        exitCode: 0 as const,
        findings: []
      }));

      await runCli(
        ["release", "check", "tests/fixtures/valid-plugin-with-mcp", "--runtime", "--json"],
        io,
        { runCheckImpl }
      );
      const output = JSON.parse(stdout.join(""));

      expect(output.runtimeProbeEnabled).toBe(true);
      expect(runCheckImpl).toHaveBeenCalledWith(expect.any(String), { runtime: true });
    }, 30000);

    it("passes the Docker sandbox to release validation", async () => {
      const { io } = createIo();
      const runCheckImpl = vi.fn(async (targetPath: string) => ({
        targetPath,
        status: "pass" as const,
        exitCode: 0 as const,
        findings: []
      }));

      await runCli(
        [
          "release",
          "check",
          "tests/fixtures/valid-plugin-with-mcp",
          "--runtime",
          "--sandbox",
          "docker",
          "--json"
        ],
        io,
        { runCheckImpl }
      );

      expect(runCheckImpl).toHaveBeenCalledWith(expect.any(String), {
        runtime: true,
        runtimeSandbox: "docker"
      });
    }, 30000);

    it("requires --runtime when the Docker sandbox is requested", async () => {
      const { io, stderr } = createIo();
      const runCheckImpl = vi.fn(async (targetPath: string) => ({
        targetPath,
        status: "pass" as const,
        exitCode: 0 as const,
        findings: []
      }));

      const exitCode = await runCli(
        [
          "release",
          "check",
          "tests/fixtures/valid-plugin-with-mcp",
          "--sandbox",
          "docker"
        ],
        io,
        { runCheckImpl }
      );

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("--sandbox docker requires --runtime");
      expect(runCheckImpl).not.toHaveBeenCalled();
    });

    it("rejects unknown runtime sandbox modes", async () => {
      const { io, stderr } = createIo();
      const runCheckImpl = vi.fn(async (targetPath: string) => ({
        targetPath,
        status: "pass" as const,
        exitCode: 0 as const,
        findings: []
      }));

      const exitCode = await runCli(
        [
          "release",
          "check",
          "tests/fixtures/valid-plugin-with-mcp",
          "--runtime",
          "--sandbox",
          "native"
        ],
        io,
        { runCheckImpl }
      );

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Expected --sandbox docker");
      expect(runCheckImpl).not.toHaveBeenCalled();
    });

    it("requires --runtime when runtime approval is requested", async () => {
      const { io, stderr } = createIo();

      const exitCode = await runCli(
        ["release", "check", ".", "--require-runtime-approval"],
        io
      );

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Runtime approval requires --runtime");
    });

    it("rejects a mismatched runtime approval digest before validation", async () => {
      const { io, stderr } = createIo();
      const runCheckImpl = vi.fn();

      const exitCode = await runCli(
        [
          "release",
          "check",
          "tests/fixtures/valid-plugin-with-mcp",
          "--runtime",
          "--require-runtime-approval",
          "--runtime-approval-digest",
          "sha256:wrong"
        ],
        io,
        { runCheckImpl }
      );

      expect(exitCode).toBe(1);
      expect(stderr.join("")).toContain("does not match");
      expect(runCheckImpl).not.toHaveBeenCalled();
    });

    it("fails release readiness when package and lockfile versions differ", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-release-metadata-"));
      await cp("tests/fixtures/valid-plugin-with-mcp", targetPath, { recursive: true });
      await writeFile(
        path.join(targetPath, "package.json"),
        JSON.stringify({ name: "fixture-plugin", version: "2.0.0" }),
        "utf8"
      );
      await writeFile(
        path.join(targetPath, "package-lock.json"),
        JSON.stringify({ version: "1.0.0", packages: { "": { version: "1.0.0" } } }),
        "utf8"
      );
      await writeFile(path.join(targetPath, "CHANGELOG.md"), "## [2.0.0]\n", "utf8");
      const { io, stdout } = createIo();

      const exitCode = await runCli(["release", "check", targetPath, "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(1);
      expect(output.checks.metadata).toMatchObject({
        status: "fail",
        packageVersion: "2.0.0",
        lockfileVersion: "1.0.0"
      });
    }, 30000);

    it("fails release readiness when the changelog omits the package version", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-release-changelog-"));
      await cp("tests/fixtures/valid-plugin-with-mcp", targetPath, { recursive: true });
      await writeFile(
        path.join(targetPath, "package.json"),
        JSON.stringify({ name: "fixture-plugin", version: "2.0.0" }),
        "utf8"
      );
      await writeFile(
        path.join(targetPath, "package-lock.json"),
        JSON.stringify({ version: "2.0.0", packages: { "": { version: "2.0.0" } } }),
        "utf8"
      );
      await writeFile(path.join(targetPath, "CHANGELOG.md"), "## [1.0.0]\n", "utf8");
      const { io, stdout } = createIo();

      const exitCode = await runCli(["release", "check", targetPath, "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(1);
      expect(output.checks.metadata).toMatchObject({
        status: "fail",
        changelogVersion: false
      });
    }, 30000);

    it("rejects release command without subcommand", async () => {
      const { io, stderr } = createIo();

      const exitCode = await runCli(["release"], io);

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Usage");
    });

    it("rejects release with invalid subcommand", async () => {
      const { io, stderr } = createIo();

      const exitCode = await runCli(["release", "invalid"], io);

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Usage");
    });
  });
});
