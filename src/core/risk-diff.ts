import type { CompatibilityEnvironment } from "../compatibility/compatibility-matrix.js";
import type { Finding } from "../domain/types.js";
import {
  buildPackageAnalysis,
  type PackageAnalysis
} from "./package-analysis.js";

export type RiskFindingCategory = "validation" | "security";

export interface RiskDiffFinding extends Finding {
  category: RiskFindingCategory;
}

export interface DoctorRiskDiffReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  kind: "doctor.risk.diff";
  beforePath: string;
  afterPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  summary: {
    riskIncreased: boolean;
    newFindings: number;
    resolvedFindings: number;
    trustScoreBefore: number;
    trustScoreAfter: number;
    trustScoreDelta: number;
  };
  newFindings: RiskDiffFinding[];
  resolvedFindings: RiskDiffFinding[];
}

export interface BuildDoctorRiskDiffReportOptions {
  environment?: CompatibilityEnvironment;
}

function findingKey(finding: RiskDiffFinding): string {
  return `${finding.category}\n${finding.id}\n${finding.message}`;
}

function collectComparableFindings(analysis: PackageAnalysis): RiskDiffFinding[] {
  const findings = [
    ...analysis.validation.findings.map((finding) => ({
      ...finding,
      category: "validation" as const
    })),
    ...analysis.security.findings.map((finding) => ({
      ...finding,
      category: "security" as const
    }))
  ];
  const seen = new Set<string>();

  return findings.filter((finding) => {
    const key = findingKey(finding);

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function compareFindings(
  beforeFindings: RiskDiffFinding[],
  afterFindings: RiskDiffFinding[]
): {
  newFindings: RiskDiffFinding[];
  resolvedFindings: RiskDiffFinding[];
} {
  const beforeKeys = new Set(beforeFindings.map(findingKey));
  const afterKeys = new Set(afterFindings.map(findingKey));

  return {
    newFindings: afterFindings.filter((finding) => !beforeKeys.has(findingKey(finding))),
    resolvedFindings: beforeFindings.filter((finding) => !afterKeys.has(findingKey(finding)))
  };
}

export async function buildDoctorRiskDiffReport(
  beforePath: string,
  afterPath: string,
  options: BuildDoctorRiskDiffReportOptions = {}
): Promise<DoctorRiskDiffReport> {
  const [beforeAnalysis, afterAnalysis] = await Promise.all([
    buildPackageAnalysis(beforePath, { environment: options.environment }),
    buildPackageAnalysis(afterPath, { environment: options.environment })
  ]);
  const { newFindings, resolvedFindings } = compareFindings(
    collectComparableFindings(beforeAnalysis),
    collectComparableFindings(afterAnalysis)
  );
  const trustScoreDelta = afterAnalysis.trust.score - beforeAnalysis.trust.score;
  const hasNewFailure = newFindings.some((finding) => finding.severity === "fail");
  const hasNewWarning = newFindings.some((finding) => finding.severity === "warn");
  const riskIncreased = hasNewFailure || trustScoreDelta < 0;
  const status = riskIncreased
    ? "fail"
    : hasNewWarning
      ? "warn"
      : "pass";

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    kind: "doctor.risk.diff",
    beforePath: beforeAnalysis.targetPath,
    afterPath: afterAnalysis.targetPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    summary: {
      riskIncreased,
      newFindings: newFindings.length,
      resolvedFindings: resolvedFindings.length,
      trustScoreBefore: beforeAnalysis.trust.score,
      trustScoreAfter: afterAnalysis.trust.score,
      trustScoreDelta
    },
    newFindings,
    resolvedFindings
  };
}

export function renderDoctorRiskDiffReportJson(report: DoctorRiskDiffReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorRiskDiffReport(
  report: DoctorRiskDiffReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Risk Diff",
    "================",
    `Status: ${report.status.toUpperCase()}`,
    `Before: ${report.beforePath}`,
    `After: ${report.afterPath}`,
    `Risk increased: ${report.summary.riskIncreased ? "yes" : "no"}`,
    `Trust score delta: ${report.summary.trustScoreDelta}`,
    `New findings: ${report.summary.newFindings}`,
    `Resolved findings: ${report.summary.resolvedFindings}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  if (report.newFindings.length > 0) {
    lines.push("", "New Findings", "------------");

    for (const finding of report.newFindings) {
      lines.push(`[${finding.severity.toUpperCase()}] ${finding.category}: ${finding.id}`);
      lines.push(`  Message: ${finding.message}`);
    }
  }

  if (report.resolvedFindings.length > 0) {
    lines.push("", "Resolved Findings", "-----------------");

    for (const finding of report.resolvedFindings) {
      lines.push(`[${finding.severity.toUpperCase()}] ${finding.category}: ${finding.id}`);
      lines.push(`  Message: ${finding.message}`);
    }
  }

  return lines.join("\n");
}
