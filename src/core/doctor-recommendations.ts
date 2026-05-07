import type { CompatibilityEnvironment } from "../compatibility/compatibility-matrix.js";
import type { CheckResult } from "../domain/types.js";
import type { SecurityAudit } from "../security/security-audit.js";
import {
  buildDoctorRecommendationsFromAnalysis,
  buildPackageAnalysis
} from "./package-analysis.js";

export type RecommendationPriority = "blocker" | "high" | "medium" | "info";
export type RecommendationCategory = "validation" | "security" | "compatibility" | "release";

export interface DoctorRecommendationAction {
  priority: RecommendationPriority;
  category: RecommendationCategory;
  title: string;
  reason: string;
  nextCommand: string;
  findingId?: string;
}

export interface DoctorRecommendationsReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  targetPath: string;
  status: "pass" | "warn" | "fail";
  exitCode: 0 | 1;
  summary: {
    actionCounts: Record<RecommendationPriority, number>;
  };
  validation: {
    status: CheckResult["status"];
    findingCount: number;
  };
  security: {
    status: SecurityAudit["status"];
    score: number;
    findingCount: number;
  };
  compatibility: {
    failedClients: string[];
  };
  actions: DoctorRecommendationAction[];
}

export async function buildDoctorRecommendations(
  targetPath: string,
  options: {
    environment?: CompatibilityEnvironment;
    runCheck?: (targetPath: string) => Promise<CheckResult>;
  } = {}
): Promise<DoctorRecommendationsReport> {
  return buildDoctorRecommendationsFromAnalysis(
    await buildPackageAnalysis(targetPath, {
      environment: options.environment,
      runCheck: options.runCheck
    })
  );
}

export function renderDoctorRecommendationsJson(report: DoctorRecommendationsReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorRecommendations(report: DoctorRecommendationsReport): string {
  const lines = [
    "Doctor Recommendations",
    "======================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Actions: ${report.summary.actionCounts.blocker} blocker, ${report.summary.actionCounts.high} high, ${report.summary.actionCounts.medium} medium, ${report.summary.actionCounts.info} info`,
    `Security: ${report.security.status.toUpperCase()} (${report.security.score}/100)`
  ];

  lines.push("", "Actions", "-------");

  for (const action of report.actions) {
    lines.push(`[${action.priority.toUpperCase()}] ${action.title}`);

    if (action.findingId) {
      lines.push(`  Finding: ${action.findingId}`);
    }

    lines.push(`  Category: ${action.category}`);
    lines.push(`  Reason: ${action.reason}`);
    lines.push(`  Next: ${action.nextCommand}`);
  }

  return lines.join("\n");
}
