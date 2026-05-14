import { performance } from "node:perf_hooks";

import {
  matrixExitCode,
  type CompatibilityEnvironment
} from "../compatibility/compatibility-matrix.js";
import type { CheckResult } from "../domain/types.js";
import {
  buildDoctorRecommendationsFromAnalysis,
  buildPackageAnalysis,
  type PackageAnalysisStage,
  type PackageAnalysisTiming
} from "./package-analysis.js";

export type DoctorPerformanceStageName = PackageAnalysisStage | "recommendations" | "total";

export interface DoctorPerformanceStage {
  name: DoctorPerformanceStageName;
  durationMs: number;
  status?: "pass" | "warn" | "fail";
  itemCount?: number;
}

export interface DoctorPerformanceReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  kind: "doctor.perf";
  targetPath: string;
  status: "pass" | "fail";
  exitCode: 0 | 1;
  summary: {
    stageCount: number;
    slowestStage: DoctorPerformanceStageName;
    totalDurationMs: number;
    validationStatus: "pass" | "warn" | "fail";
    securityStatus: "pass" | "warn" | "fail";
    trustScore: number;
    compatibilityFailures: number;
    thresholdFailures: number;
  };
  stages: DoctorPerformanceStage[];
  thresholds: DoctorPerformanceThresholdResult[];
}

export interface BuildDoctorPerformanceReportOptions {
  environment?: CompatibilityEnvironment;
  runCheck?: (targetPath: string) => Promise<CheckResult>;
  thresholds?: DoctorPerformanceThresholdOptions;
}

export interface DoctorPerformanceThresholdOptions {
  totalMs?: number;
  stages?: Partial<Record<DoctorPerformanceStageName, number>>;
}

export interface DoctorPerformanceThresholdResult {
  stage: DoctorPerformanceStageName;
  limitMs: number;
  actualMs: number;
  status: "pass" | "fail";
}

const stageOrder: DoctorPerformanceStageName[] = [
  "validation",
  "doctorConfig",
  "security",
  "compatibility",
  "trust",
  "recommendations",
  "total"
];

function roundDuration(durationMs: number): number {
  return Number(durationMs.toFixed(3));
}

function compatibilityStatus(exitCode: 0 | 1, warningCount: number): "pass" | "warn" | "fail" {
  if (exitCode === 1) {
    return "fail";
  }

  return warningCount > 0 ? "warn" : "pass";
}

function slowestStage(stages: DoctorPerformanceStage[]): DoctorPerformanceStageName {
  return stages
    .filter((stage) => stage.name !== "total")
    .reduce((slowest, stage) => (
      stage.durationMs > slowest.durationMs ? stage : slowest
    ), stages[0]).name;
}

function evaluateThresholds(
  stages: DoctorPerformanceStage[],
  thresholds: DoctorPerformanceThresholdOptions = {}
): DoctorPerformanceThresholdResult[] {
  const thresholdResults: DoctorPerformanceThresholdResult[] = [];
  const stageByName = new Map(stages.map((stage) => [stage.name, stage]));

  if (thresholds.totalMs !== undefined) {
    const totalStage = stageByName.get("total");

    if (totalStage) {
      thresholdResults.push({
        stage: "total",
        limitMs: thresholds.totalMs,
        actualMs: totalStage.durationMs,
        status: totalStage.durationMs > thresholds.totalMs ? "fail" : "pass"
      });
    }
  }

  for (const [stageName, limitMs] of Object.entries(thresholds.stages ?? {}) as [DoctorPerformanceStageName, number][]) {
    const stage = stageByName.get(stageName);

    if (!stage) {
      continue;
    }

    thresholdResults.push({
      stage: stageName,
      limitMs,
      actualMs: stage.durationMs,
      status: stage.durationMs > limitMs ? "fail" : "pass"
    });
  }

  return thresholdResults;
}

export async function buildDoctorPerformanceReport(
  targetPath: string,
  options: BuildDoctorPerformanceReportOptions = {}
): Promise<DoctorPerformanceReport> {
  const timings: PackageAnalysisTiming[] = [];
  const startedAt = performance.now();
  const analysis = await buildPackageAnalysis(targetPath, {
    environment: options.environment,
    recordTiming: (timing) => timings.push(timing),
    runCheck: options.runCheck
  });
  const recommendationsStartedAt = performance.now();
  const recommendations = buildDoctorRecommendationsFromAnalysis(analysis);
  const recommendationTiming = performance.now() - recommendationsStartedAt;
  const totalDurationMs = performance.now() - startedAt;
  const compatibilityFailures = analysis.compatibility.results
    .filter((result) => result.status === "fail").length;
  const compatibilityWarnings = analysis.compatibility.results
    .filter((result) => result.status === "warn").length;
  const timingByStage = new Map(timings.map((timing) => [timing.stage, timing.durationMs]));
  const stages: DoctorPerformanceStage[] = stageOrder.map((stageName) => {
    if (stageName === "validation") {
      return {
        name: stageName,
        durationMs: roundDuration(timingByStage.get(stageName) ?? 0),
        status: analysis.validation.status,
        itemCount: analysis.validation.findings.length
      };
    }

    if (stageName === "doctorConfig") {
      return {
        name: stageName,
        durationMs: roundDuration(timingByStage.get(stageName) ?? 0),
        status: "pass"
      };
    }

    if (stageName === "security") {
      return {
        name: stageName,
        durationMs: roundDuration(timingByStage.get(stageName) ?? 0),
        status: analysis.security.status,
        itemCount: analysis.security.findings.length
      };
    }

    if (stageName === "compatibility") {
      return {
        name: stageName,
        durationMs: roundDuration(timingByStage.get(stageName) ?? 0),
        status: compatibilityStatus(matrixExitCode(analysis.compatibility), compatibilityWarnings),
        itemCount: analysis.compatibility.results.length
      };
    }

    if (stageName === "trust") {
      return {
        name: stageName,
        durationMs: roundDuration(timingByStage.get(stageName) ?? 0),
        status: analysis.trust.status,
        itemCount: analysis.trust.findings.length
      };
    }

    if (stageName === "recommendations") {
      return {
        name: stageName,
        durationMs: roundDuration(recommendationTiming),
        status: recommendations.status,
        itemCount: recommendations.actions.length
      };
    }

    return {
      name: "total",
      durationMs: roundDuration(totalDurationMs)
    };
  });
  const thresholdResults = evaluateThresholds(stages, options.thresholds);
  const thresholdFailures = thresholdResults
    .filter((threshold) => threshold.status === "fail").length;

  return {
    schemaVersion: "1.0.0",
    generatedAt: analysis.generatedAt,
    kind: "doctor.perf",
    targetPath: analysis.targetPath,
    status: thresholdFailures > 0 ? "fail" : "pass",
    exitCode: thresholdFailures > 0 ? 1 : 0,
    summary: {
      stageCount: stages.length,
      slowestStage: slowestStage(stages),
      totalDurationMs: roundDuration(totalDurationMs),
      validationStatus: analysis.validation.status,
      securityStatus: analysis.security.status,
      trustScore: analysis.trust.score,
      compatibilityFailures,
      thresholdFailures
    },
    stages,
    thresholds: thresholdResults
  };
}

export function renderDoctorPerformanceReportJson(report: DoctorPerformanceReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorPerformanceReport(
  report: DoctorPerformanceReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Performance",
    "==================",
    `Target: ${report.targetPath}`,
    `Status: ${report.status.toUpperCase()}`,
    `Total: ${report.summary.totalDurationMs}ms`,
    `Slowest: ${report.summary.slowestStage}`,
    `Validation: ${report.summary.validationStatus.toUpperCase()}`,
    `Security: ${report.summary.securityStatus.toUpperCase()}`,
    `Trust: ${report.summary.trustScore}/100`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Stages", "------");

  for (const stage of report.stages) {
    const status = stage.status ? ` (${stage.status.toUpperCase()})` : "";
    const count = stage.itemCount === undefined ? "" : `, items: ${stage.itemCount}`;

    lines.push(`${stage.name}: ${stage.durationMs}ms${status}${count}`);
  }

  if (report.thresholds.length > 0) {
    lines.push("", "Thresholds", "----------");

    for (const threshold of report.thresholds) {
      lines.push(
        `${threshold.stage}: ${threshold.actualMs}ms <= ${threshold.limitMs}ms ` +
        `(${threshold.status.toUpperCase()})`
      );
    }
  }

  return lines.join("\n");
}
