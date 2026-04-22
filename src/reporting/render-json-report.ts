import type { CheckResult, JsonReport } from "../domain/types.js";

export function buildJsonReport(
  result: CheckResult,
  options: { runtimeProbeEnabled: boolean }
): JsonReport {
  const failCount = result.findings.filter(
    (finding) => finding.severity === "fail"
  ).length;
  const warnCount = result.findings.filter(
    (finding) => finding.severity === "warn"
  ).length;

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    summary: {
      targetPath: result.targetPath,
      status: result.status,
      exitCode: result.exitCode,
      runtimeProbeEnabled: options.runtimeProbeEnabled,
      ...(result.runtimeScorecard
        ? { runtimeScorecard: result.runtimeScorecard }
        : {}),
      findingCounts: {
        fail: failCount,
        warn: warnCount,
        total: result.findings.length
      }
    },
    findings: result.findings
  };
}

export function renderJsonReport(
  result: CheckResult,
  options: { runtimeProbeEnabled: boolean }
): string {
  return JSON.stringify(buildJsonReport(result, options), null, 2);
}
