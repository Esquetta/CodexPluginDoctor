import type { McpToolCatalogReport } from "../core/mcp-tool-catalog.js";

export function renderMcpToolCatalogReport(report: McpToolCatalogReport): string {
  return [
    "MCP Tool Catalog",
    "================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Discovery: ${report.discovery.status}`,
    `Catalog complete: ${report.catalog.complete}`,
    `Pages read: ${report.catalog.pagesRead}`,
    `Tools checked: ${report.catalog.toolsChecked}`,
    ...(report.catalog.reason === null ? [] : [`Reason: ${report.catalog.reason}`]),
    `Enumeration: ${report.coverage.catalogEnumeration}`,
    `Schema coverage: ${report.coverage.schema}`,
    `Tool execution: ${report.coverage.toolExecution}`,
    `Custom header annotations: ${report.coverage.customHeaderAnnotations}`,
    `Full conformance: ${report.coverage.fullConformance}`,
    "Counts describe inspected content, not a guaranteed server-wide inventory.",
    ...report.discovery.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.id}: ${finding.message}\n  ${finding.suggestedFix}`),
    ...report.findings.map((finding) => {
      const location = finding.location;
      const locator = location ? ` [page ${location.page}, tool ${location.toolIndex}${location.schema ? `, ${location.schema}` : ""}${location.relatedToolIndex ? `, related tool ${location.relatedToolIndex}` : ""}]` : "";
      return `${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
    })
  ].join("\n");
}
