import path from "node:path";

import {
  buildCompatibilityMatrix,
  matrixExitCode,
  type CompatibilityEnvironment,
  type CompatibilityMatrix
} from "../compatibility/compatibility-matrix.js";
import {
  applyDoctorConfig,
  loadDoctorConfig
} from "./doctor-config.js";
import {
  buildJsonReport
} from "../reporting/render-json-report.js";
import type {
  CheckResult,
  Finding,
  JsonReport
} from "../domain/types.js";
import type {
  DoctorRecommendationAction,
  DoctorRecommendationsReport,
  RecommendationCategory,
  RecommendationPriority
} from "./doctor-recommendations.js";
import type { DoctorExportBundle } from "./doctor-export-bundle.js";
import {
  buildSecurityAudit,
  type SecurityAudit
} from "../security/security-audit.js";
import {
  buildTrustScore,
  type TrustScoreReport
} from "../security/trust-score.js";
import { validatePlugin } from "./validate-plugin.js";
import { packageVersion } from "../version.js";

export interface PackageAnalysis {
  generatedAt: string;
  targetPath: string;
  validation: CheckResult;
  validationJson: JsonReport;
  security: SecurityAudit;
  compatibility: CompatibilityMatrix;
  trust: TrustScoreReport;
}

export interface PackageAnalysisOptions {
  environment?: CompatibilityEnvironment;
  runCheck?: (targetPath: string) => Promise<CheckResult>;
}

const priorityRank: Record<RecommendationPriority, number> = {
  blocker: 0,
  high: 1,
  medium: 2,
  info: 3
};

function countActions(actions: DoctorRecommendationAction[]): Record<RecommendationPriority, number> {
  return {
    blocker: actions.filter((action) => action.priority === "blocker").length,
    high: actions.filter((action) => action.priority === "high").length,
    medium: actions.filter((action) => action.priority === "medium").length,
    info: actions.filter((action) => action.priority === "info").length
  };
}

function priorityForFinding(finding: Finding): RecommendationPriority {
  if (finding.severity === "fail") {
    return "blocker";
  }

  return finding.id.startsWith("plugin.security.") ? "high" : "medium";
}

function categoryForFinding(finding: Finding): RecommendationCategory {
  return finding.id.startsWith("plugin.security.") ? "security" : "validation";
}

function commandForCategory(
  category: RecommendationCategory,
  targetPath: string
): string {
  if (category === "security") {
    return `codex-plugin-doctor security ${targetPath} --scorecard`;
  }

  if (category === "compatibility") {
    return `codex-plugin-doctor compat ${targetPath} --all --scorecard`;
  }

  return `codex-plugin-doctor check ${targetPath} --explain`;
}

function actionFromFinding(
  finding: Finding,
  targetPath: string
): DoctorRecommendationAction {
  const category = categoryForFinding(finding);

  return {
    priority: priorityForFinding(finding),
    category,
    findingId: finding.id,
    title: finding.message,
    reason: finding.impact,
    nextCommand: commandForCategory(category, targetPath)
  };
}

function dedupeActions(actions: DoctorRecommendationAction[]): DoctorRecommendationAction[] {
  const seen = new Set<string>();

  return actions.filter((action) => {
    const key = `${action.category}\n${action.findingId ?? action.title}\n${action.reason}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function actionsFromCompatibility(
  matrix: CompatibilityMatrix,
  targetPath: string
): DoctorRecommendationAction[] {
  return matrix.results
    .filter((result) => result.status === "fail")
    .map((result) => ({
      priority: "high" as const,
      category: "compatibility" as const,
      title: `${result.client} compatibility failed.`,
      reason: result.summary,
      nextCommand: commandForCategory("compatibility", targetPath)
    }));
}

function sortActions(actions: DoctorRecommendationAction[]): DoctorRecommendationAction[] {
  return [...actions].sort((left, right) => {
    const priorityDelta = priorityRank[left.priority] - priorityRank[right.priority];

    if (priorityDelta !== 0) {
      return priorityDelta;
    }

    return left.category.localeCompare(right.category);
  });
}

export async function buildPackageAnalysis(
  targetPath: string,
  options: PackageAnalysisOptions = {}
): Promise<PackageAnalysis> {
  const rootPath = path.resolve(targetPath);
  const runCheck = options.runCheck ?? validatePlugin;
  const [rawValidation, doctorConfig, security, compatibility] = await Promise.all([
    runCheck(rootPath),
    loadDoctorConfig(rootPath),
    buildSecurityAudit(rootPath),
    buildCompatibilityMatrix(rootPath, options.environment ?? {})
  ]);
  const validation = applyDoctorConfig(rawValidation, doctorConfig);
  const trust = await buildTrustScore(rootPath, { securityAudit: security });

  return {
    generatedAt: new Date().toISOString(),
    targetPath: rootPath,
    validation,
    validationJson: buildJsonReport(validation, { runtimeProbeEnabled: false }),
    security,
    compatibility,
    trust
  };
}

export function buildDoctorRecommendationsFromAnalysis(
  analysis: PackageAnalysis
): DoctorRecommendationsReport {
  const actions = sortActions(dedupeActions([
    ...analysis.validation.findings.map((finding) => actionFromFinding(finding, analysis.targetPath)),
    ...analysis.security.findings.map((finding) => actionFromFinding(finding, analysis.targetPath)),
    ...actionsFromCompatibility(analysis.compatibility, analysis.targetPath)
  ]));
  const finalActions = actions.length > 0
    ? actions
    : [
        {
          priority: "info" as const,
          category: "release" as const,
          title: "No blocker actions.",
          reason: "The package has no validation, security, or compatibility blockers in this recommendation pass.",
          nextCommand: `codex-plugin-doctor check ${analysis.targetPath} --profile publish`
        }
      ];
  const status = finalActions.some((action) => action.priority === "blocker")
    ? "fail"
    : finalActions.some((action) => action.priority === "high" || action.priority === "medium")
      ? "warn"
      : "pass";

  return {
    schemaVersion: "1.0.0",
    generatedAt: analysis.generatedAt,
    targetPath: analysis.targetPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    summary: {
      actionCounts: countActions(finalActions)
    },
    validation: {
      status: analysis.validation.status,
      findingCount: analysis.validation.findings.length
    },
    security: {
      status: analysis.security.status,
      score: analysis.security.score,
      findingCount: analysis.security.findings.length
    },
    compatibility: {
      failedClients: matrixExitCode(analysis.compatibility) === 1
        ? analysis.compatibility.results
            .filter((result) => result.status === "fail")
            .map((result) => result.client)
        : []
    },
    actions: finalActions
  };
}

export function buildDoctorExportBundleFromAnalysis(
  analysis: PackageAnalysis,
  recommendations: DoctorRecommendationsReport = buildDoctorRecommendationsFromAnalysis(analysis)
): DoctorExportBundle {
  return {
    schemaVersion: "1.0.0",
    generatedAt: analysis.generatedAt,
    kind: "doctor.export.bundle",
    version: packageVersion,
    targetPath: analysis.targetPath,
    validation: analysis.validationJson,
    security: analysis.security,
    compatibility: analysis.compatibility,
    recommendations,
    trust: analysis.trust
  };
}
