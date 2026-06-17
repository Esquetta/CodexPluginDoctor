import type { CheckResult } from "../domain/types.js";
import { formatFindingEvidenceLine } from "./format-finding-evidence.js";

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

  if (result.runtimeScorecard) {
    lines.push("", "## Runtime Scorecard", "");
    lines.push("| Operation | Status |");
    lines.push("| --- | --- |");
    lines.push(`| initialize | ${result.runtimeScorecard.initialize.toUpperCase()} |`);
    lines.push(`| tools/list | ${result.runtimeScorecard.toolsList.toUpperCase()} |`);
    lines.push(`| tools/call | ${result.runtimeScorecard.toolsCall.toUpperCase()} |`);
    lines.push(`| resources/list | ${result.runtimeScorecard.resourcesList.toUpperCase()} |`);
    lines.push(`| resources/read | ${result.runtimeScorecard.resourceRead.toUpperCase()} |`);
    lines.push(`| resources/templates/list | ${result.runtimeScorecard.resourceTemplatesList.toUpperCase()} |`);
    lines.push(`| prompts/list | ${result.runtimeScorecard.promptsList.toUpperCase()} |`);
    lines.push(`| prompts/get | ${result.runtimeScorecard.promptGet.toUpperCase()} |`);
  }

  lines.push("", "## Findings", "");

  for (const finding of result.findings) {
    lines.push(`### ${finding.severity.toUpperCase()} \`${finding.id}\``);
    lines.push("");
    lines.push(`- Message: ${finding.message}`);
    lines.push(`- Impact: ${finding.impact}`);
    lines.push(`- Suggested fix: ${finding.suggestedFix}`);

    const evidence = formatFindingEvidenceLine(finding);

    if (evidence) {
      lines.push(`- Evidence: ${evidence}`);
    }

    lines.push("");
  }

  return lines.join("\n");
}
