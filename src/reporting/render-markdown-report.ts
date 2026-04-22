import type { CheckResult } from "../domain/types.js";

export function buildMarkdownReport(
  result: CheckResult,
  options: { runtimeProbeEnabled: boolean }
): string {
  const failCount = result.findings.filter(
    (finding) => finding.severity === "fail"
  ).length;
  const warnCount = result.findings.filter(
    (finding) => finding.severity === "warn"
  ).length;

  const lines = [
    "# Codex Plugin Doctor Report",
    "",
    "| Field | Value |",
    "| --- | --- |",
    `| Target | \`${result.targetPath}\` |`,
    `| Status | ${result.status.toUpperCase()} |`,
    `| Exit Code | ${result.exitCode} |`,
    `| Runtime Probe | ${options.runtimeProbeEnabled ? "enabled" : "disabled"} |`,
    `| Fail Findings | ${failCount} |`,
    `| Warn Findings | ${warnCount} |`,
    `| Total Findings | ${result.findings.length} |`
  ];

  if (result.findings.length === 0) {
    lines.push("", "No findings.");
    return lines.join("\n");
  }

  lines.push("", "## Findings", "");

  for (const finding of result.findings) {
    lines.push(`### ${finding.severity.toUpperCase()} \`${finding.id}\``);
    lines.push("");
    lines.push(`- Message: ${finding.message}`);
    lines.push(`- Impact: ${finding.impact}`);
    lines.push(`- Suggested fix: ${finding.suggestedFix}`);
    lines.push("");
  }

  return lines.join("\n");
}
