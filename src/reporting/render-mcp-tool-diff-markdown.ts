import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";
import { quoteServerText } from "./quote-server-text.js";

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "not compared" : String(value);
}

function toolIndex(value: number | null): string {
  return value === null ? "-" : String(value);
}

// Names and pointers come from the server, so they are quoted and put in a code span, where Markdown,
// HTML, mentions, and links stay inert; the fence outgrows any backtick run, and pipes are escaped for the table.
function code(text: string): string {
  const quoted = quoteServerText(text);
  let run = 0;
  let longest = 0;
  for (const character of quoted) {
    run = character === "`" ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const fence = "`".repeat(longest + 1);
  return `${fence}${quoted.replace(/\|/gu, "\\|")}${fence}`;
}

export function renderMcpToolDiffMarkdown(report: McpToolDiffReport): string {
  const comparison = report.comparison;
  const named = report.changes.some((change) => change.name !== undefined);
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
      named ? "| Change | Tool | Before tool | After tool | Fields | Impact | Reasons |" : "| Change | Before tool | After tool | Fields | Impact | Reasons |",
      named ? "| --- | --- | --- | --- | --- | --- | --- |" : "| --- | --- | --- | --- | --- | --- |",
      ...report.changes.map((change) => `| ${change.kind}${named ? ` | ${change.name === undefined ? "-" : code(change.name)}` : ""} | ${toolIndex(change.beforeToolIndex)} | ${toolIndex(change.afterToolIndex)} | ${change.fields.map((field) => `\`${field}\``).join(", ") || "-"} | **${change.impact}** | ${change.reasons.map((reason) => `\`${reason}\``).join(", ") || "-"} |`)
    );
  }

  const located = report.changes.flatMap((change) => (change.locations ?? []).map((location) =>
    `| ${change.name === undefined ? "-" : code(change.name)} | \`${location.reason}\` | ${location.pointer === "" ? "(tool)" : code(location.pointer)} |`));
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
    named
      ? `Tool names and schema locations are shown because --show-names was used; schema values are not reported. Impact labels are ${report.coverage.impactClassification} schema checks, not proof of compatibility.`
      : `Tool numbers are one-based positions in the before and after files; names and schema values are not reported. Impact labels are ${report.coverage.impactClassification} schema checks, not proof of compatibility.`
  );
  return lines.join("\n");
}
