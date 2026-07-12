import { describe, expect, it } from "vitest";
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
    it("runs release check and returns JSON", async () => {
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["release", "check", "tests/fixtures/valid-plugin-with-mcp", "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(stderr).toEqual([]);
      expect(exitCode).toBeGreaterThanOrEqual(0);
      expect(output).toMatchObject({ schemaVersion: "1.0.0" });
      expect(output.checks.validation).toBeDefined();
      expect(output.checks.security).toBeDefined();
      expect(output.checks.dependencies).toBeDefined();
      expect(output.checks.compatibility).toBeDefined();
      expect(output.checks.trust).toBeDefined();
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
