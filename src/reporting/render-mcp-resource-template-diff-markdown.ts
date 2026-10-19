import type { McpResourceTemplateDiffReport } from "../core/mcp-resource-template-diff.js";
import { markdownCodeSpan } from "./quote-server-text.js";
import { describeResourceTemplateLocation } from "./render-mcp-resource-template-file-report.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "not compared" : String(value);
}

function templateIndex(value: number | null): string {
  return value === null ? "-" : String(value);
}

export function renderMcpResourceTemplateDiffMarkdown(report: McpResourceTemplateDiffReport): string {
  const comparison = report.comparison;
  const named = report.changes.some((change) => change.name !== undefined);
  const lines = [
    "## MCP Resource Template Definition Diff",
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
      named ? "| Change | Template | Before template | After template | Fields | Impact | Reasons |" : "| Change | Before template | After template | Fields | Impact | Reasons |",
      named ? "| --- | --- | --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- | --- | --- |",
      ...report.changes.map((change) => `| ${change.kind}${named ? ` | ${change.name === undefined ? "-" : markdownCodeSpan(change.name)}` : ""} | ${templateIndex(change.beforeTemplateIndex)} | ${templateIndex(change.afterTemplateIndex)} | ${change.fields.map((field) => `\`${field}\``).join(", ") || "-"} | **${change.impact}** | ${change.reasons.map((reason) => `\`${reason}\``).join(", ") || "-"} |`)
    );
  }

  const located = report.changes.flatMap((change) => (change.locations ?? []).map((location) =>
    `| ${change.name === undefined ? "-" : markdownCodeSpan(change.name)} | \`${location.reason}\` | ${location.variable === null ? "-" : markdownCodeSpan(location.variable)} |`));
  if (located.length > 0) {
    lines.push("", "### Locations", "", "| Template | Reason | Variable |", "| --- | --- | --- |", ...located);
  }

  const findings = (["before", "after"] as const).flatMap((side) => report[side].findings.map((finding) => {
    const locator = finding.location ? `${side} ${describeResourceTemplateLocation(finding.location)}` : side;
    return `| ${finding.severity} | \`${finding.id}\` | ${locator} | ${finding.message} |`;
  }));
  if (findings.length > 0) {
    lines.push("", "### Input Findings", "", "| Severity | Finding | Location | Message |", "| --- | --- | --- | --- |", ...findings);
  }

  lines.push(
    "",
    named
      ? `Template and variable names are shown because --show-names was used; URI templates, descriptions, and other values are not reported. Impact labels are ${report.coverage.impactClassification} URI template checks, not proof of compatibility.`
      : `Template numbers are one-based positions in the before and after files; names, URI templates, and descriptions are not reported. Impact labels are ${report.coverage.impactClassification} URI template checks, not proof of compatibility.`
  );
  return lines.join("\n");
}
