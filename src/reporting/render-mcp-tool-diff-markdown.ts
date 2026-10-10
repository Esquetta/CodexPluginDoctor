import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "not compared" : String(value);
}

function toolIndex(value: number | null): string {
  return value === null ? "-" : String(value);
}

export function renderMcpToolDiffMarkdown(report: McpToolDiffReport): string {
  const comparison = report.comparison;
  const lines = [
    "## MCP Tool Definition Diff",
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
      "| Change | Before tool | After tool | Fields | Impact | Reasons |",
      "| --- | --- | --- | --- | --- | --- |",
      ...report.changes.map((change) => `| ${change.kind} | ${toolIndex(change.beforeToolIndex)} | ${toolIndex(change.afterToolIndex)} | ${change.fields.map((field) => `\`${field}\``).join(", ") || "-"} | **${change.impact}** | ${change.reasons.map((reason) => `\`${reason}\``).join(", ") || "-"} |`)
    );
  }

  const findings = (["before", "after"] as const).flatMap((side) => report[side].findings.map((finding) => {
    const location = finding.location;
    const locator = location
      ? `${side} tool ${location.toolIndex}${location.schema ? `, ${location.schema}` : ""}${location.relatedToolIndex ? `, related tool ${location.relatedToolIndex}` : ""}`
      : side;
    return `| ${finding.severity} | \`${finding.id}\` | ${locator} | ${finding.message} |`;
  }));
  if (findings.length > 0) {
    lines.push("", "### Input Findings", "", "| Severity | Finding | Location | Message |", "| --- | --- | --- | --- |", ...findings);
  }

  lines.push(
    "",
    `Tool numbers are one-based positions in the before and after files; names and schema values are not reported. Impact labels are ${report.coverage.impactClassification} schema checks, not proof of compatibility.`
  );
  return lines.join("\n");
}
