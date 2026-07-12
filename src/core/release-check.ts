import path from "node:path";
import { validatePlugin } from "./validate-plugin.js";
import { buildSecurityAudit } from "../security/security-audit.js";
import { buildDepAudit } from "./dep-audit.js";
import { buildCompatibilityMatrix } from "../compatibility/compatibility-matrix.js";
import { buildTrustScore } from "../security/trust-score.js";
import type { CheckResult } from "../domain/types.js";
import type { SecurityAudit } from "../security/security-audit.js";
import type { DepAuditReport } from "./dep-audit.js";
import type { CompatibilityMatrix } from "../compatibility/compatibility-matrix.js";
import type { TrustScoreReport } from "../security/trust-score.js";

export interface ReleaseCheckReport {
  targetPath: string;
  status: "pass" | "fail";
  checks: {
    validation: { status: string; findings: number; exitCode: number };
    security: { status: string; score: number };
    dependencies: { status: string; vulnerabilities: number };
    compatibility: { status: string; score: number; overallStatus: string };
    trust: { status: string; score: number };
  };
  ready: boolean;
}

function matrixOverallStatus(matrix: CompatibilityMatrix): "pass" | "warn" | "fail" {
  const statuses = matrix.results.map((r) => r.status);
  const passCount = statuses.filter((s) => s === "pass").length;
  const total = statuses.length;

  if (total === 0) {
    return "pass";
  }

  if (passCount === total) {
    return "pass";
  }

  const failCount = statuses.filter((s) => s === "fail").length;

  return failCount > 0 ? "fail" : "warn";
}

function matrixScore(matrix: CompatibilityMatrix): number {
  const scoreMap: Record<string, number> = { pass: 100, warn: 70, fail: 0, skipped: 0 };
  const scores = matrix.results.map((r) => scoreMap[r.status] ?? 0);

  if (scores.length === 0) {
    return 0;
  }

  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export async function buildReleaseCheck(
  targetPath: string,
  options: { env?: Record<string, string | undefined>; platform?: NodeJS.Platform } = {}
): Promise<ReleaseCheckReport> {
  const resolvedPath = path.resolve(targetPath);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const validationResult = await validatePlugin(resolvedPath, { runtime: true });
  const securityResult = await buildSecurityAudit(resolvedPath);
  const depResult = await buildDepAudit(resolvedPath);
  const compatResult = await buildCompatibilityMatrix(resolvedPath, { env, platform });
  const trustResult = await buildTrustScore(resolvedPath);

  const checks = {
    validation: {
      status: validationResult.status,
      findings: validationResult.findings.length,
      exitCode: validationResult.exitCode
    },
    security: {
      status: securityResult.status,
      score: securityResult.score
    },
    dependencies: {
      status: depResult.status,
      vulnerabilities: depResult.totalVulnerabilities
    },
    compatibility: {
      status: matrixOverallStatus(compatResult),
      score: matrixScore(compatResult),
      overallStatus: matrixOverallStatus(compatResult)
    },
    trust: {
      status: trustResult.status,
      score: trustResult.score
    }
  };

  const ready =
    checks.validation.status === "pass" &&
    checks.security.status === "pass" &&
    checks.dependencies.status !== "fail" &&
    checks.compatibility.status !== "fail" &&
    checks.trust.status === "pass";

  return {
    targetPath: resolvedPath,
    status: ready ? "pass" : "fail",
    checks,
    ready
  };
}

export function renderReleaseCheck(report: ReleaseCheckReport): string {
  const icon = (pass: boolean) => pass ? "PASS" : pass === undefined ? "SKIP" : "FAIL";

  const lines = [
    "Codex Plugin Doctor Release Check",
    "==================================",
    `Path: ${report.targetPath}`,
    `Ready: ${report.ready ? "YES" : "NO"}`,
    "",
    "Checks",
    "------",
    `  ${icon(report.checks.validation.status === "pass")}  validation    ${report.checks.validation.status}  (${report.checks.validation.findings} findings)`,
    `  ${icon(report.checks.security.status === "pass")}  security      ${report.checks.security.status}  (score: ${report.checks.security.score})`,
    `  ${icon(report.checks.dependencies.status === "pass")}  dependencies  ${report.checks.dependencies.status}  (${report.checks.dependencies.vulnerabilities} vulns)`,
    `  ${icon(report.checks.compatibility.status === "pass")}  compatibility ${report.checks.compatibility.status}  (score: ${report.checks.compatibility.score})`,
    `  ${icon(report.checks.trust.status === "pass")}  trust         ${report.checks.trust.status}  (score: ${report.checks.trust.score})`,
    "",
    report.ready
      ? "All release checks passed. Ready to publish."
      : "Some checks failed. Fix issues before publishing."
  ];

  return lines.join("\n");
}

export function renderReleaseCheckJson(report: ReleaseCheckReport): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      targetPath: report.targetPath,
      status: report.status,
      ready: report.ready,
      checks: report.checks
    },
    null,
    2
  );
}
