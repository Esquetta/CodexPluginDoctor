import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "not compared" : String(value);
}

function toolIndex(value: number | null): string {
  return value === null ? "-" : String(value);
}

// Names and pointers come from the server, so they are escaped before they reach a table cell.
function cell(text: string): string {
  return text
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/[\\|`*_[\]]/gu, (character) => `\\${character}`)
    .replace(/\s+/gu, " ");
}

function code(text: string): string {
  return text.includes("`") || /\s/u.test(text) ? cell(text) : `\`${text.replace(/\|/gu, "\\|")}\``;
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

  const located = report.changes.flatMap((change) => (change.locations ?? []).map((location) =>
    `| ${cell(change.name ?? "")} | \`${location.reason}\` | ${location.pointer === "" ? "(tool)" : code(location.pointer)} |`));
  if (located.length > 0) {
    lines.push("", "### Locations", "", "| Tool | Reason | Location |", "| --- | --- | --- |", ...located);
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
    report.changes.some((change) => change.name !== undefined)
      ? `Tool names and schema locations are shown because --show-names was used; schema values are not reported. Impact labels are ${report.coverage.impactClassification} schema checks, not proof of compatibility.`
      : `Tool numbers are one-based positions in the before and after files; names and schema values are not reported. Impact labels are ${report.coverage.impactClassification} schema checks, not proof of compatibility.`
  );
  return lines.join("\n");
}
