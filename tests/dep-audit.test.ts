import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/run-cli.js";
import {
  buildDepAudit,
  renderDepAudit,
  renderDepAuditJson,
  type DepAuditReport,
  type DepAuditVulnerability
} from "../src/core/dep-audit.js";

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

function buildEmptyReport(targetPath: string): DepAuditReport {
  return {
    targetPath,
    status: "pass",
    vulnerabilities: [],
    totalVulnerabilities: 0,
    auditJson: null
  };
}

function buildReportWithVulns(
  targetPath: string,
  vulns: DepAuditVulnerability[],
  status: DepAuditReport["status"]
): DepAuditReport {
  return {
    targetPath,
    status,
    vulnerabilities: vulns,
    totalVulnerabilities: vulns.length,
    auditJson: { vulnerabilities: {} }
  };
}

describe("dep-audit", () => {
  describe("renderDepAudit", () => {
    it("renders a pass report with no vulnerabilities", () => {
      const report = buildEmptyReport("/test/plugin");
      const output = renderDepAudit(report);

      expect(output).toContain("Dependency Vulnerability Audit");
      expect(output).toContain("Path: /test/plugin");
      expect(output).toContain("Status: PASS");
      expect(output).toContain("No known vulnerabilities found.");
    });

    it("renders critical vulnerabilities", () => {
      const vulns: DepAuditVulnerability[] = [
        { name: "lodash", severity: "critical", isDirect: true, fixAvailable: false, via: ["CVE-2021-23337"] }
      ];
      const report = buildReportWithVulns("/test", vulns, "fail");
      const output = renderDepAudit(report);

      expect(output).toContain("CRITICAL");
      expect(output).toContain("lodash");
      expect(output).toContain("CVE-2021-23337");
      expect(output).toContain("Direct: yes");
      expect(output).toContain("Fix available: no");
    });

    it("renders high vulnerabilities", () => {
      const vulns: DepAuditVulnerability[] = [
        { name: "express", severity: "high", isDirect: false, fixAvailable: true, via: ["body-parser"] }
      ];
      const report = buildReportWithVulns("/test", vulns, "fail");
      const output = renderDepAudit(report);

      expect(output).toContain("HIGH");
      expect(output).toContain("express");
      expect(output).toContain("Direct: no");
      expect(output).toContain("Fix available: yes");
    });

    it("renders moderate vulnerabilities", () => {
      const vulns: DepAuditVulnerability[] = [
        { name: "axios", severity: "moderate", isDirect: true, fixAvailable: true, via: ["CVE-2023-45857"] }
      ];
      const report = buildReportWithVulns("/test", vulns, "warn");
      const output = renderDepAudit(report);

      expect(output).toContain("MODERATE");
      expect(output).toContain("axios");
    });

    it("renders status correctly for warn", () => {
      const vulns: DepAuditVulnerability[] = [
        { name: "debug", severity: "low", isDirect: true, fixAvailable: false, via: [] }
      ];
      const report = buildReportWithVulns("/test", vulns, "warn");
      const output = renderDepAudit(report);

      expect(output).toContain("Status: WARN");
      expect(output).toContain("LOW");
    });
  });

  describe("renderDepAuditJson", () => {
    it("renders valid JSON with all fields", () => {
      const vulns: DepAuditVulnerability[] = [
        { name: "test-pkg", severity: "high", isDirect: true, fixAvailable: true, via: ["CVE-2024-0001"] }
      ];
      const report = buildReportWithVulns("/test", vulns, "fail");
      const json = JSON.parse(renderDepAuditJson(report));

      expect(json).toMatchObject({
        schemaVersion: "1.0.0",
        targetPath: "/test",
        status: "fail",
        totalVulnerabilities: 1
      });
      expect(json.vulnerabilities).toEqual(vulns);
      expect(json.audit).toBeDefined();
    });

    it("renders empty vulnerabilities array", () => {
      const report = buildEmptyReport("/test");
      const json = JSON.parse(renderDepAuditJson(report));

      expect(json).toMatchObject({
        schemaVersion: "1.0.0",
        status: "pass",
        totalVulnerabilities: 0,
        vulnerabilities: []
      });
      expect(json.audit).toBeNull();
    });
  });

  describe("buildDepAudit", () => {
    it("returns pass when no package.json exists", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-"));
      const report = await buildDepAudit(targetPath);

      expect(report).toMatchObject({
        targetPath: path.resolve(targetPath),
        status: "pass",
        totalVulnerabilities: 0,
        vulnerabilities: [],
        auditJson: null
      });
    });

    it("returns warn when package.json is invalid JSON", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-"));
      await writeFile(path.join(targetPath, "package.json"), "not-valid-json", "utf8");
      const report = await buildDepAudit(targetPath);

      expect(report.status).toBe("warn");
      expect(report.auditJson).toMatchObject({ error: "Failed to parse package.json" });
    });

    it("returns pass when package.json has no dependencies", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-"));
      await writeFile(
        path.join(targetPath, "package.json"),
        JSON.stringify({ name: "test", version: "1.0.0" }),
        "utf8"
      );
      const report = await buildDepAudit(targetPath);

      expect(report.status).toBe("pass");
      expect(report.auditJson).toMatchObject({ message: "No runtime dependencies to audit" });
    });
  });

  describe("audit deps CLI", () => {
    it("renders dependency audit JSON for empty directory", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-audit-"));
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["audit", "deps", targetPath, "--json"], io);
      const output = JSON.parse(stdout.join(""));

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(output).toMatchObject({
        schemaVersion: "1.0.0",
        targetPath: path.resolve(targetPath),
        status: "pass",
        totalVulnerabilities: 0,
        vulnerabilities: [],
        audit: null
      });
    });

    it("renders dependency audit text output", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-audit-"));
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["audit", "deps", targetPath], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);
      expect(stdout.join("")).toContain("Dependency Vulnerability Audit");
      expect(stdout.join("")).toContain("Status: PASS");
      expect(stdout.join("")).toContain("No known vulnerabilities found");
    });

    it("rejects audit deps with missing output path", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-audit-"));
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["audit", "deps", targetPath, "--output"], io);

      expect(exitCode).toBe(2);
      expect(stderr.join("")).toContain("Missing path after --output");
    });

    it("writes JSON output to file", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-audit-"));
      const outputPath = path.join(targetPath, "dep-report.json");
      const { io, stdout, stderr } = createIo();

      const exitCode = await runCli(["audit", "deps", targetPath, "--json", "--output", outputPath], io);

      expect(exitCode).toBe(0);
      expect(stderr).toEqual([]);

      const { readFile } = await import("node:fs/promises");
      const fileContent = await readFile(outputPath, "utf8");
      const parsed = JSON.parse(fileContent);
      expect(parsed).toMatchObject({ schemaVersion: "1.0.0", status: "pass" });
    });

    it("uses current directory when no path given", async () => {
      const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-dep-audit-"));
      const originalCwd = process.cwd();

      try {
        process.chdir(targetPath);
        const { io, stdout, stderr } = createIo();
        const exitCode = await runCli(["audit", "deps", "--json"], io);

        expect(exitCode).toBe(0);
        expect(stderr).toEqual([]);
        const output = JSON.parse(stdout.join(""));
        expect(output).toMatchObject({
          schemaVersion: "1.0.0",
          status: "pass",
          audit: null
        });
      } finally {
        process.chdir(originalCwd);
      }
    });
  });
});
