import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run-cli.js";
import { validateConfigFile, renderConfigValidation, renderConfigValidationJson } from "../src/core/config-validate.js";

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

describe("config validate", () => {
  describe("validateConfigFile", () => {
    it("reports missing file", async () => {
      const report = await validateConfigFile("/nonexistent/path/.codex-doctor.json");

      expect(report.status).toBe("fail");
      expect(report.findings[0].field).toBe("file");
      expect(report.findings[0].message).toContain("not found");
    });

    it("reports invalid JSON", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, "not-valid-json", "utf8");

      const report = await validateConfigFile(configPath);

      expect(report.status).toBe("fail");
      expect(report.findings[0].field).toBe("json");
    });

    it("passes valid config", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({
        ignoreRules: ["plugin.heuristic.description.too_long"],
        failOnWarnings: true,
        suppressions: []
      }), "utf8");

      const report = await validateConfigFile(configPath);

      expect(report.status).toBe("pass");
      expect(report.findings).toEqual([]);
    });

    it("reports unknown fields", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({ unknownField: true }), "utf8");

      const report = await validateConfigFile(configPath);

      expect(report.findings.some((f) => f.field === "unknownField")).toBe(true);
    });

    it("validates ignoreRules type", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({ ignoreRules: "not-an-array" }), "utf8");

      const report = await validateConfigFile(configPath);

      expect(report.findings.some((f) => f.field === "ignoreRules" && f.severity === "fail")).toBe(true);
    });

    it("validates failOnWarnings type", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({ failOnWarnings: "not-a-bool" }), "utf8");

      const report = await validateConfigFile(configPath);

      expect(report.findings.some((f) => f.field === "failOnWarnings" && f.severity === "fail")).toBe(true);
    });

    it("validates suppressions structure", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({
        suppressions: [
          {
            fingerprint: "abc",
            reason: "",
            expiresAt: "invalid-date"
          }
        ]
      }), "utf8");

      const report = await validateConfigFile(configPath);

      expect(report.status).toBe("fail");
      expect(report.findings.length).toBeGreaterThan(0);
    });
  });

  describe("renderers", () => {
    it("renders valid config text", () => {
      const report = {
        configPath: "/test/.codex-doctor.json",
        status: "pass" as const,
        findings: []
      };
      const output = renderConfigValidation(report);

      expect(output).toContain("Config is valid.");
      expect(output).toContain("Status: PASS");
    });

    it("renders findings in text", () => {
      const report = {
        configPath: "/test/.codex-doctor.json",
        status: "fail" as const,
        findings: [
          { field: "ignoreRules", message: "Must be an array.", severity: "fail" as const }
        ]
      };
      const output = renderConfigValidation(report);

      expect(output).toContain("FAIL  ignoreRules");
      expect(output).toContain("Must be an array");
    });

    it("renders JSON output", () => {
      const report = {
        configPath: "/test/.codex-doctor.json",
        status: "pass" as const,
        findings: []
      };
      const json = JSON.parse(renderConfigValidationJson(report));

      expect(json).toMatchObject({
        schemaVersion: "1.0.0",
        status: "pass",
        findings: []
      });
    });
  });

  describe("CLI", () => {
    it("validates a config file via CLI", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({ ignoreRules: [], failOnWarnings: false, suppressions: [] }), "utf8");
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["config", "validate", configPath], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("Config is valid");
    });

    it("outputs config validation as JSON", async () => {
      const dir = await mkdtemp(path.join(os.tmpdir(), "codex-doctor-config-"));
      const configPath = path.join(dir, ".codex-doctor.json");
      await writeFile(configPath, JSON.stringify({}), "utf8");
      const { io, stdout } = createIo();

      const exitCode = await runCli(["config", "validate", configPath, "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(0);
      expect(output).toMatchObject({
        schemaVersion: "1.0.0",
        status: "pass"
      });
    });

    it("rejects config without subcommand", async () => {
      const { io, stderr } = createIo();

      const exitCode = await runCli(["config"], io);

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Usage");
    });
  });
});
