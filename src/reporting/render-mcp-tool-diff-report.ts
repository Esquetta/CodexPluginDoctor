import type { McpToolDiffReport } from "../core/mcp-tool-diff.js";

export function renderMcpToolDiffReport(report: McpToolDiffReport): string {
  const comparison = report.comparison;
  return [
    "Offline MCP Tool Diff",
    "=====================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Comparison complete: ${comparison.complete}`,
    ...(comparison.reason === null ? [] : [`Reason: ${comparison.reason}`]),
    `Added: ${comparison.added ?? "not compared"}`,
    `Removed: ${comparison.removed ?? "not compared"}`,
    `Changed: ${comparison.changed ?? "not compared"}`,
    `Unchanged: ${comparison.unchanged ?? "not compared"}`,
    `Comparison coverage: ${report.coverage.comparison}`,
    `Schema coverage: ${report.coverage.schema}`,
    `Compatibility: ${report.coverage.compatibility}`,
    `Server catalog: ${report.coverage.serverCatalog}`,
    `Tool execution: ${report.coverage.toolExecution}`,
    "Only the supplied responses are compared. A change does not establish incompatibility; an unchanged result does not establish compatibility.",
    ...(["before", "after"] as const).flatMap((side) => {
      const source = report[side];
      const label = side === "before" ? "Before" : "After";
      return [
        `${label} input: ${source.status}; tools checked: ${source.inspection.toolsChecked}; bytes read: ${source.source.bytesRead}`,
        ...(source.inspection.reason === null ? [] : [`${label} reason: ${source.inspection.reason}`]),
        ...source.findings.map((finding) => {
          const location = finding.location;
          const locator = location ? ` [${side} tool ${location.toolIndex}${location.schema ? `, ${location.schema}` : ""}${location.relatedToolIndex ? `, related tool ${location.relatedToolIndex}` : ""}]` : "";
          return `${label} ${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
        })
      ];
    }),
    ...report.changes.map((change) => {
      const locations = [
        ...(change.beforeToolIndex === null ? [] : [`before tool ${change.beforeToolIndex}`]),
        ...(change.afterToolIndex === null ? [] : [`after tool ${change.afterToolIndex}`])
      ];
      return `${change.kind.toUpperCase()} [${locations.join(" -> ")}]${change.fields.length ? `: ${change.fields.join(", ")}` : ""}`;
    })
  ].join("\n");
}
