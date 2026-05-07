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
import type { CheckResult, Finding } from "../domain/types.js";
import {
  buildSecurityAudit,
  type SecurityAudit
} from "../security/security-audit.js";
import { validatePlugin } from "./validate-plugin.js";

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

export async function buildDoctorRecommendations(
  targetPath: string,
  options: {
    environment?: CompatibilityEnvironment;
    runCheck?: (targetPath: string) => Promise<CheckResult>;
  } = {}
): Promise<DoctorRecommendationsReport> {
  const rootPath = path.resolve(targetPath);
  const runCheck = options.runCheck ?? validatePlugin;
  const [rawValidation, security, compatibility] = await Promise.all([
    runCheck(rootPath),
    buildSecurityAudit(rootPath),
    buildCompatibilityMatrix(rootPath, options.environment ?? {})
  ]);
  const validation = applyDoctorConfig(rawValidation, await loadDoctorConfig(rootPath));
  const actions = sortActions(dedupeActions([
    ...validation.findings.map((finding) => actionFromFinding(finding, rootPath)),
    ...security.findings.map((finding) => actionFromFinding(finding, rootPath)),
    ...actionsFromCompatibility(compatibility, rootPath)
  ]));
  const finalActions = actions.length > 0
    ? actions
    : [
        {
          priority: "info" as const,
          category: "release" as const,
          title: "No blocker actions.",
          reason: "The package has no validation, security, or compatibility blockers in this recommendation pass.",
          nextCommand: `codex-plugin-doctor check ${rootPath} --profile publish`
        }
      ];
  const status = finalActions.some((action) => action.priority === "blocker")
    ? "fail"
    : finalActions.some((action) => action.priority === "high" || action.priority === "medium")
      ? "warn"
      : "pass";

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    targetPath: rootPath,
    status,
    exitCode: status === "fail" ? 1 : 0,
    summary: {
      actionCounts: countActions(finalActions)
    },
    validation: {
      status: validation.status,
      findingCount: validation.findings.length
    },
    security: {
      status: security.status,
      score: security.score,
      findingCount: security.findings.length
    },
    compatibility: {
      failedClients: matrixExitCode(compatibility) === 1
        ? compatibility.results
            .filter((result) => result.status === "fail")
            .map((result) => result.client)
        : []
    },
    actions: finalActions
  };
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
