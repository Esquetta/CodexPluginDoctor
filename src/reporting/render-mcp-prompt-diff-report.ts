import type { McpPromptDiffReport } from "../core/mcp-prompt-diff.js";
import { describePromptLocation } from "./render-mcp-prompt-file-report.js";
import { quoteServerText } from "./quote-server-text.js";

export function renderMcpPromptDiffReport(report: McpPromptDiffReport): string {
  const comparison = report.comparison;
  return [
    "Offline MCP Prompt Diff",
    "=======================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Comparison complete: ${comparison.complete}`,
    ...(comparison.reason === null ? [] : [`Reason: ${comparison.reason}`]),
    `Added: ${comparison.added ?? "not compared"}`,
    `Removed: ${comparison.removed ?? "not compared"}`,
    `Changed: ${comparison.changed ?? "not compared"}`,
    `Unchanged: ${comparison.unchanged ?? "not compared"}`,
    `Breaking: ${comparison.breaking ?? "not compared"}`,
    `Unclassified: ${comparison.unclassified ?? "not compared"}`,
    `Comparison coverage: ${report.coverage.comparison}`,
    `Definition coverage: ${report.coverage.definitions}`,
    `Compatibility: ${report.coverage.compatibility}`,
    `Server catalog: ${report.coverage.serverCatalog}`,
    `Prompt retrieval: ${report.coverage.promptRetrieval}`,
    `Impact classification: ${report.coverage.impactClassification}`,
    "Only the supplied responses are compared. Impact labels are argument heuristics: a compatible label or an unchanged result does not establish compatibility.",
    ...(["before", "after"] as const).flatMap((side) => {
      const source = report[side];
      const label = side === "before" ? "Before" : "After";
      return [
        `${label} input: ${source.status}; prompts checked: ${source.inspection.promptsChecked}; bytes read: ${source.source.bytesRead}`,
        ...(source.inspection.reason === null ? [] : [`${label} reason: ${source.inspection.reason}`]),
        ...source.findings.map((finding) => {
          const locator = finding.location ? ` [${side} ${describePromptLocation(finding.location)}]` : "";
          return `${label} ${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
        })
      ];
    }),
    ...report.changes.map((change) => {
      const locations = [
        ...(change.beforePromptIndex === null ? [] : [`before prompt ${change.beforePromptIndex}`]),
        ...(change.afterPromptIndex === null ? [] : [`after prompt ${change.afterPromptIndex}`])
      ];
      const impact = `${change.impact}${change.reasons.length ? ` (${change.reasons.join(", ")})` : ""}`;
      const name = change.name === undefined ? "" : ` ${quoteServerText(change.name)}`;
      const at = (change.locations ?? []).map((location) =>
        `\n  At ${location.argument === null ? "(prompt)" : `argument ${quoteServerText(location.argument)}`}: ${location.reason}`).join("");
      return `${change.kind.toUpperCase()}${name} [${locations.join(" -> ")}]${change.fields.length ? `: ${change.fields.join(", ")}` : ""}\n  Impact: ${impact}${at}`;
    })
  ].join("\n");
}
