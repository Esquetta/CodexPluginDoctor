import type { McpPromptDiffReport } from "../core/mcp-prompt-diff.js";
import { markdownCodeSpan } from "./quote-server-text.js";
import { describePromptLocation } from "./render-mcp-prompt-file-report.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "not compared" : String(value);
}

function promptIndex(value: number | null): string {
  return value === null ? "-" : String(value);
}

export function renderMcpPromptDiffMarkdown(report: McpPromptDiffReport): string {
  const comparison = report.comparison;
  const named = report.changes.some((change) => change.name !== undefined);
  const lines = [
    "## MCP Prompt Definition Diff",
    "",
    `**Status:** \`${report.status}\` · **Comparison complete:** ${comparison.complete ? "yes" : "no"}${comparison.reason === null ? "" : ` · **Reason:** \`${comparison.reason}\``}`,
    "",
    "| Added | Removed | Changed | Unchanged | Breaking | Unclassified |",
    "| --- | --- | --- | --- | --- | --- |",
    `| ${count(comparison.added)} | ${count(comparison.removed)} | ${count(comparison.changed)} | ${count(comparison.unchanged)} | ${count(comparison.breaking)} | ${count(comparison.unclassified)} |`
  ];

  if (report.changes.length > 0) {
    lines.push(
      "",
      "### Changes",
      "",
      named ? "| Change | Prompt | Before prompt | After prompt | Fields | Impact | Reasons |" : "| Change | Before prompt | After prompt | Fields | Impact | Reasons |",
      named ? "| --- | --- | --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- | --- | --- |",
      ...report.changes.map((change) => `| ${change.kind}${named ? ` | ${change.name === undefined ? "-" : markdownCodeSpan(change.name)}` : ""} | ${promptIndex(change.beforePromptIndex)} | ${promptIndex(change.afterPromptIndex)} | ${change.fields.map((field) => `\`${field}\``).join(", ") || "-"} | **${change.impact}** | ${change.reasons.map((reason) => `\`${reason}\``).join(", ") || "-"} |`)
    );
  }

  const located = report.changes.flatMap((change) => (change.locations ?? []).map((location) =>
    `| ${change.name === undefined ? "-" : markdownCodeSpan(change.name)} | \`${location.reason}\` | ${location.argument === null ? "-" : markdownCodeSpan(location.argument)} |`));
  if (located.length > 0) {
    lines.push("", "### Locations", "", "| Prompt | Reason | Argument |", "| --- | --- | --- |", ...located);
  }

  const findings = (["before", "after"] as const).flatMap((side) => report[side].findings.map((finding) => {
    const locator = finding.location ? `${side} ${describePromptLocation(finding.location)}` : side;
    return `| ${finding.severity} | \`${finding.id}\` | ${locator} | ${finding.message} |`;
  }));
  if (findings.length > 0) {
    lines.push("", "### Input Findings", "", "| Severity | Finding | Location | Message |", "| --- | --- | --- | --- |", ...findings);
  }

  lines.push(
    "",
    named
      ? `Prompt and argument names are shown because --show-names was used; descriptions and other values are not reported. Impact labels are ${report.coverage.impactClassification} argument checks, not proof of compatibility.`
      : `Prompt numbers are one-based positions in the before and after files; names and descriptions are not reported. Impact labels are ${report.coverage.impactClassification} argument checks, not proof of compatibility.`
  );
  return lines.join("\n");
}
