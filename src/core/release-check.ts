import { readFile } from "node:fs/promises";
import path from "node:path";
import { validatePlugin } from "./validate-plugin.js";
import { buildSecurityAudit } from "../security/security-audit.js";
import { buildDepAudit } from "./dep-audit.js";
import { buildCompatibilityMatrix } from "../compatibility/compatibility-matrix.js";
import { buildTrustScore } from "../security/trust-score.js";
import type {
  CheckOptions,
  CheckResult,
  RuntimeSandboxMode
} from "../domain/types.js";
import type { SecurityAudit } from "../security/security-audit.js";
import type { DepAuditReport } from "./dep-audit.js";
import type { CompatibilityMatrix } from "../compatibility/compatibility-matrix.js";
import type { TrustScoreReport } from "../security/trust-score.js";

export interface ReleaseCheckReport {
  targetPath: string;
  status: "pass" | "fail";
  runtimeProbeEnabled?: boolean;
  checks: {
    validation: { status: string; findings: number; exitCode: number };
    security: { status: string; score: number };
    dependencies: { status: string; vulnerabilities: number };
    compatibility: { status: string; score: number; overallStatus: string };
    trust: { status: string; score: number };
    metadata?: ReleaseMetadataCheck;
  };
  ready: boolean;
}

export interface ReleaseMetadataCheck {
  status: "pass" | "fail" | "skipped";
  packageVersion: string | null;
  lockfileVersion: string | null;
  changelogVersion: boolean | null;
  findings: string[];
}

export interface BuildReleaseCheckOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  runtime?: boolean;
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  allowSessionLifecycle?: boolean;
  requireRemoteReliability?: boolean;
  runtimeSandbox?: RuntimeSandboxMode;
  runCheck?: (targetPath: string, options: CheckOptions) => Promise<CheckResult>;
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export async function buildReleaseMetadataCheck(targetPath: string): Promise<ReleaseMetadataCheck> {
  const packageContent = await readOptionalFile(path.join(targetPath, "package.json"));

  if (packageContent === null) {
    return {
      status: "skipped",
      packageVersion: null,
      lockfileVersion: null,
      changelogVersion: null,
      findings: []
    };
  }

  const findings: string[] = [];
  let packageVersion: string | null = null;
  let lockfileVersion: string | null = null;

  try {
    const packageJson = JSON.parse(packageContent) as { version?: unknown };
    packageVersion = typeof packageJson.version === "string" ? packageJson.version : null;
  } catch {
    findings.push("package.json is not valid JSON.");
  }

  if (!packageVersion) {
    findings.push("package.json must contain a version.");
  }

  const lockContent = await readOptionalFile(path.join(targetPath, "package-lock.json"));

  if (lockContent !== null) {
    try {
      const lock = JSON.parse(lockContent) as {
        version?: unknown;
        packages?: Record<string, { version?: unknown }>;
      };
      const rootVersion = lock.packages?.[""]?.version ?? lock.version;
      lockfileVersion = typeof rootVersion === "string" ? rootVersion : null;
    } catch {
      findings.push("package-lock.json is not valid JSON.");
    }

    if (!lockfileVersion) {
      findings.push("package-lock.json must contain the root package version.");
    } else if (packageVersion && lockfileVersion !== packageVersion) {
      findings.push(`package-lock.json version ${lockfileVersion} does not match package.json ${packageVersion}.`);
    }
  }

  const changelog = await readOptionalFile(path.join(targetPath, "CHANGELOG.md"));
  const changelogVersion = changelog === null || !packageVersion
    ? null
    : new RegExp(`^## \\[${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\](?:\\s|$)`, "m").test(changelog);

  if (changelogVersion === false) {
    findings.push(`CHANGELOG.md does not contain a ${packageVersion} release section.`);
  }

  return {
    status: findings.length === 0 ? "pass" : "fail",
    packageVersion,
    lockfileVersion,
    changelogVersion,
    findings
  };
}

export async function assertReleaseMetadataSync(targetPath: string): Promise<void> {
  const metadata = await buildReleaseMetadataCheck(path.resolve(targetPath));

  if (metadata.status === "fail") {
    throw new Error(`Release metadata is inconsistent: ${metadata.findings.join(" ")}`);
  }
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
  options: BuildReleaseCheckOptions = {}
): Promise<ReleaseCheckReport> {
  const resolvedPath = path.resolve(targetPath);
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;

  const runtimeProbeEnabled = options.runtime ?? false;
  const validationResult = await (options.runCheck ?? validatePlugin)(resolvedPath, {
    runtime: runtimeProbeEnabled,
    ...(options.allowNetwork ? { allowNetwork: true } : {}),
    ...(options.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
    ...(options.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
    ...(options.requireRemoteReliability ? { requireRemoteReliability: true } : {}),
    ...(options.runtimeSandbox ? { runtimeSandbox: options.runtimeSandbox } : {})
  });
  const securityResult = await buildSecurityAudit(resolvedPath);
  const depResult = await buildDepAudit(resolvedPath);
  const compatResult = await buildCompatibilityMatrix(resolvedPath, { env, platform });
  const trustResult = await buildTrustScore(resolvedPath);
  const metadataResult = await buildReleaseMetadataCheck(resolvedPath);

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
    },
    metadata: metadataResult
  };

  const ready =
    checks.validation.status === "pass" &&
    checks.security.status === "pass" &&
    checks.dependencies.status !== "fail" &&
    checks.compatibility.status !== "fail" &&
    checks.trust.status === "pass" &&
    checks.metadata.status !== "fail";

  return {
    targetPath: resolvedPath,
    status: ready ? "pass" : "fail",
    runtimeProbeEnabled,
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
    `Runtime probe: ${report.runtimeProbeEnabled ? "enabled" : "disabled"}`,
    "",
    "Checks",
    "------",
    `  ${icon(report.checks.validation.status === "pass")}  validation    ${report.checks.validation.status}  (${report.checks.validation.findings} findings)`,
    `  ${icon(report.checks.security.status === "pass")}  security      ${report.checks.security.status}  (score: ${report.checks.security.score})`,
    `  ${icon(report.checks.dependencies.status === "pass")}  dependencies  ${report.checks.dependencies.status}  (${report.checks.dependencies.vulnerabilities} vulns)`,
    `  ${icon(report.checks.compatibility.status === "pass")}  compatibility ${report.checks.compatibility.status}  (score: ${report.checks.compatibility.score})`,
    `  ${icon(report.checks.trust.status === "pass")}  trust         ${report.checks.trust.status}  (score: ${report.checks.trust.score})`,
    ...(report.checks.metadata
      ? [`  ${icon(report.checks.metadata.status !== "fail")}  metadata      ${report.checks.metadata.status}  (${report.checks.metadata.findings.length} findings)`]
      : []),
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
      runtimeProbeEnabled: report.runtimeProbeEnabled ?? false,
      ready: report.ready,
      checks: report.checks
    },
    null,
    2
  );
}
