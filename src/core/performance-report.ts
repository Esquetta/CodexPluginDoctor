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
  status: "pass";
  exitCode: 0;
  summary: {
    stageCount: number;
    slowestStage: DoctorPerformanceStageName;
    totalDurationMs: number;
    validationStatus: "pass" | "warn" | "fail";
    securityStatus: "pass" | "warn" | "fail";
    trustScore: number;
    compatibilityFailures: number;
  };
  stages: DoctorPerformanceStage[];
}

export interface BuildDoctorPerformanceReportOptions {
  environment?: CompatibilityEnvironment;
  runCheck?: (targetPath: string) => Promise<CheckResult>;
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

  return {
    schemaVersion: "1.0.0",
    generatedAt: analysis.generatedAt,
    kind: "doctor.perf",
    targetPath: analysis.targetPath,
    status: "pass",
    exitCode: 0,
    summary: {
      stageCount: stages.length,
      slowestStage: slowestStage(stages),
      totalDurationMs: roundDuration(totalDurationMs),
      validationStatus: analysis.validation.status,
      securityStatus: analysis.security.status,
      trustScore: analysis.trust.score,
      compatibilityFailures
    },
    stages
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

  return lines.join("\n");
}
