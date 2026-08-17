import type {
  SubmissionCheck,
  SubmissionFinding,
  SubmissionPreflightReport
} from "../core/submission-preflight.js";

function upper(value: string): string {
  return value.replace(/[-_]/gu, " ").toUpperCase();
}

function findingsByCheck(report: SubmissionPreflightReport): Array<{
  check: SubmissionCheck;
  findings: SubmissionFinding[];
}> {
  const findings = new Map<string, SubmissionFinding>(
    report.findings.map((finding) => [finding.id, finding])
  );

  return report.checks.map((check) => ({
    check,
    findings: check.findingIds.flatMap((id) => {
      const finding = findings.get(id);
      return finding ? [finding] : [];
    })
  }));
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, "\\$&");
}

function textSummary(report: SubmissionPreflightReport): string[] {
  return [
    `Ruleset: ${report.rulesetVersion}`,
    `Target: ${report.targetType}`,
    `Automatic status: ${upper(report.status)}`,
    `Readiness: ${upper(report.readiness)}`,
    `Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.blockers} blockers, ${report.summary.manualChecks} manual checks`,
    "Manual review is required; automatic checks do not complete directory review."
  ];
}

export function renderSubmissionPreflightJson(report: SubmissionPreflightReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderSubmissionPreflightText(report: SubmissionPreflightReport): string {
  const lines = ["Submission preflight", "====================", ...textSummary(report), "", "Findings by check"];

  for (const { check, findings } of findingsByCheck(report)) {
    lines.push(`${check.id} (${upper(check.status)})`);
    lines.push(...(findings.length === 0
      ? ["  None"]
      : findings.map((finding) => `  ${upper(finding.severity)} ${finding.id}: ${finding.message}`)));
  }

  lines.push("", "Manual checklist");
  lines.push(...report.manualChecklist.map((item) => `  ${upper(item.state)} ${item.id}: ${item.label}`));
  return `${lines.join("\n")}\n`;
}

export function renderSubmissionPreflightMarkdown(report: SubmissionPreflightReport): string {
  const lines = [
    "# Submission preflight",
    "",
    `- Ruleset: ${escapeMarkdown(report.rulesetVersion)}`,
    `- Target: ${escapeMarkdown(report.targetType)}`,
    `- Automatic status: ${escapeMarkdown(upper(report.status))}`,
    `- Readiness: ${escapeMarkdown(upper(report.readiness))}`,
    `- Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.blockers} blockers, ${report.summary.manualChecks} manual checks`,
    "",
    "Manual review is required; automatic checks do not complete directory review.",
    "",
    "## Findings by check"
  ];

  for (const { check, findings } of findingsByCheck(report)) {
    lines.push("", `### ${escapeMarkdown(check.id)} (${escapeMarkdown(upper(check.status))})`);
    lines.push(...(findings.length === 0
      ? ["- None"]
      : findings.map((finding) => `- **${escapeMarkdown(upper(finding.severity))}** ${escapeMarkdown(finding.id)}: ${escapeMarkdown(finding.message)}`)));
  }

  lines.push("", "## Manual checklist");
  lines.push(...report.manualChecklist.map((item) => `- ${escapeMarkdown(upper(item.state))}: ${escapeMarkdown(item.id)} — ${escapeMarkdown(item.label)}`));
  return `${lines.join("\n")}\n`;
}

export function submissionPreflightExitCode(
  report: SubmissionPreflightReport,
  requireReady: boolean
): 0 | 1 {
  return requireReady && report.status === "fail" ? 1 : 0;
}
