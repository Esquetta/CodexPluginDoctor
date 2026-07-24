import type { CheckResult } from "../domain/types.js";
import { formatFindingEvidenceLine } from "./format-finding-evidence.js";
import { formatFindingFingerprintLine } from "./finding-fingerprint.js";
import { buildRecommendedCommands } from "./recommended-commands.js";

function appendRuntimeScorecard(lines: string[], result: CheckResult) {
  if (!result.runtimeScorecard) {
    return;
  }

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

  const conformance = result.runtimeScorecard.conformance;

  if (!conformance) {
    return;
  }

  lines.push("", "## MCP Conformance", "");
  lines.push("| Check | Status |");
  lines.push("| --- | --- |");
  lines.push(`| Protocol version | ${conformance.protocolVersion ?? "unavailable"} |`);
  lines.push(`| Profile | ${conformance.profile ?? "unavailable"} |`);
  lines.push(`| Capability consistency | ${conformance.capabilityConsistency.toUpperCase()} |`);
  lines.push(`| Task declarations | ${conformance.taskDeclarations.toUpperCase()} |`);
  lines.push(`| Tasks list | ${conformance.tasksList.toUpperCase()} |`);
  lines.push(`| Schema dialect | ${conformance.schemaDialect.toUpperCase()} |`);
  lines.push(`| Overall | ${conformance.overall.toUpperCase()} |`);
}

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

  if (result.suppressionSummary) {
    lines.push(
      `| Suppressions Applied | ${result.suppressionSummary.applied} |`,
      `| Suppressions Expired | ${result.suppressionSummary.expired} |`,
      `| Suppressions Invalid | ${result.suppressionSummary.invalid} |`
    );
  }

  if (result.baselineSummary) {
    lines.push(
      `| Baseline New | ${result.baselineSummary.new} |`,
      `| Baseline Matched | ${result.baselineSummary.matched} |`,
      `| Baseline Resolved | ${result.baselineSummary.resolved} |`
    );
  }

  if (result.runtimeExecution) {
    lines.push(
      "",
      `Runtime backend: ${result.runtimeExecution.backend.toUpperCase()}`,
      `Runtime isolation: network=${result.runtimeExecution.network}, package=${result.runtimeExecution.packageMount}`
    );
  }

  appendRuntimeScorecard(lines, result);

  if (result.findings.length === 0 && !result.suppressedFindings?.length) {
    lines.push("", result.baselineSummary ? "No new findings." : "No findings.");
    return lines.join("\n");
  }

  if (result.findings.length > 0) {
    const nextActions = Array.from(
      new Set(result.findings.map((finding) => finding.suggestedFix))
    ).slice(0, 5);

    if (nextActions.length > 0) {
      lines.push("", "## Next Actions", "");

      for (const [index, action] of nextActions.entries()) {
        lines.push(`${index + 1}. ${action}`);
      }
    }

    lines.push("", "## Findings", "");

    for (const finding of result.findings) {
      lines.push(`### ${finding.severity.toUpperCase()} \`${finding.id}\``);
      lines.push("");
      lines.push(`- Message: ${finding.message}`);
      lines.push(`- Impact: ${finding.impact}`);
      lines.push(`- Suggested fix: ${finding.suggestedFix}`);

      const fingerprint = formatFindingFingerprintLine(finding);

      if (fingerprint) {
        lines.push(`- Fingerprint: \`${fingerprint}\``);
      }

      const evidence = formatFindingEvidenceLine(finding);

      if (evidence) {
        lines.push(`- Evidence: ${evidence}`);
      }

      lines.push("");
    }
  } else {
    lines.push("", "No active findings.");
  }

  if (result.suppressedFindings?.length) {
    lines.push("", "## Suppressed Findings", "");

    for (const finding of result.suppressedFindings) {
      lines.push(`### ${finding.severity.toUpperCase()} \`${finding.id}\``);
      lines.push("");
      lines.push(`- Message: ${finding.message}`);
      lines.push(`- Fingerprint: \`${finding.fingerprint ?? "unavailable"}\``);
      lines.push(`- Reason: ${finding.suppression.reason}`);
      lines.push(`- Expires: ${finding.suppression.expiresAt}`);
      lines.push("");
    }
  }

  const recommendedCommands = buildRecommendedCommands(result);

  if (recommendedCommands.length > 0) {
    lines.push("", "## Recommended Commands", "");

    for (const command of recommendedCommands) {
      lines.push(`- \`${command}\``);
    }
  }

  return lines.join("\n");
}
