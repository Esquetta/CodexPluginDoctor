import type {
  SubmissionArchivePreflightReport
} from "../core/submission-archive-preflight.js";

function upper(value: string): string {
  return value.replace(/[-_]/gu, " ").toUpperCase();
}

function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]()<>#+\-.!|]/gu, "\\$&");
}

function summary(report: SubmissionArchivePreflightReport): string[] {
  return [
    `Ruleset: ${report.rulesetVersion}`,
    `Archive: ${report.archive.fileName}`,
    `Root layout: ${report.archive.rootLayout}`,
    `Automatic status: ${upper(report.status)}`,
    `Readiness: ${upper(report.readiness)}`,
    `Summary: ${report.summary.passed} passed, ${report.summary.warnings} warnings, ${report.summary.blockers} blockers, ${report.summary.manualChecks} manual checks`,
    "Manual review is required; automatic checks do not complete archive review."
  ];
}

export function renderSubmissionArchiveJson(report: SubmissionArchivePreflightReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderSubmissionArchiveText(report: SubmissionArchivePreflightReport): string {
  const lines = ["Submission archive preflight", "============================", ...summary(report), "", "Findings"];
  lines.push(...(report.findings.length === 0
    ? ["  None"]
    : report.findings.map((finding) => `  ${upper(finding.severity)} ${finding.id}: ${finding.message}`)));
  lines.push("", "Coverage");
  lines.push(...(report.coverage.length === 0
    ? ["  None"]
    : report.coverage.map((item) => `  ${upper(item.status)} ${item.id}: ${item.reason}`)));
  lines.push("", "Manual checklist");
  lines.push(...report.manualChecklist.map((item) => `  ${upper(item.state)} ${item.id}: ${item.label}`));
  return `${lines.join("\n")}\n`;
}

export function renderSubmissionArchiveMarkdown(report: SubmissionArchivePreflightReport): string {
  const lines = [
    "# Submission archive preflight",
    "",
    ...summary(report).map((item) => `- ${escapeMarkdown(item)}`),
    "",
    "## Findings"
  ];
  lines.push(...(report.findings.length === 0
    ? ["- None"]
    : report.findings.map((finding) => `- **${escapeMarkdown(upper(finding.severity))}** ${escapeMarkdown(finding.id)}: ${escapeMarkdown(finding.message)}`)));
  lines.push("", "## Coverage");
  lines.push(...(report.coverage.length === 0
    ? ["- None"]
    : report.coverage.map((item) => `- ${escapeMarkdown(upper(item.status))}: ${escapeMarkdown(item.id)} — ${escapeMarkdown(item.reason)}`)));
  lines.push("", "## Manual checklist");
  lines.push(...report.manualChecklist.map((item) => `- ${escapeMarkdown(upper(item.state))}: ${escapeMarkdown(item.id)} — ${escapeMarkdown(item.label)}`));
  return `${lines.join("\n")}\n`;
}
