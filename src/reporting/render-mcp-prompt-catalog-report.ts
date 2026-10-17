import type { McpPromptCatalogReport } from "../core/mcp-prompt-catalog.js";
import { describePromptLocation } from "./render-mcp-prompt-file-report.js";

export function renderMcpPromptCatalogReport(report: McpPromptCatalogReport): string {
  return [
    "MCP Prompt Catalog",
    "==================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    ...(report.transport === "stdio"
      ? [
          "Transport: stdio",
          `Protocol: ${report.protocol?.era ?? "not established"}${report.protocol?.version ? ` (${report.protocol.version})` : ""}`,
          `Execution: ${report.execution?.backend ?? "not started"}`
        ]
      : []),
    `Discovery: ${report.discovery.status}`,
    `Catalog complete: ${report.catalog.complete}`,
    `Pages read: ${report.catalog.pagesRead}`,
    `Prompts checked: ${report.catalog.promptsChecked}`,
    ...(report.catalog.reason === null ? [] : [`Reason: ${report.catalog.reason}`]),
    `Enumeration: ${report.coverage.catalogEnumeration}`,
    `Definition coverage: ${report.coverage.definitions}`,
    `Prompt retrieval: ${report.coverage.promptRetrieval}`,
    `Full conformance: ${report.coverage.fullConformance}`,
    "Counts describe inspected content, not a guaranteed server-wide inventory.",
    ...report.discovery.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.id}: ${finding.message}\n  ${finding.suggestedFix}`),
    ...report.findings.map((finding) => {
      const locator = finding.location ? ` [page ${finding.location.page}, ${describePromptLocation(finding.location)}]` : "";
      return `${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
    })
  ].join("\n");
}
