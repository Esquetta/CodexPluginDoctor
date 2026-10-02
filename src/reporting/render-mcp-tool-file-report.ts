import type { McpToolFileReport } from "../core/mcp-tool-file.js";

export function renderMcpToolFileReport(report: McpToolFileReport): string {
  return [
    "Offline MCP Tool Definitions",
    "============================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Source: ${report.source.kind} (${report.source.format})`,
    `Bytes read: ${report.source.bytesRead}`,
    `Inspection complete: ${report.inspection.complete}`,
    `Tools checked: ${report.inspection.toolsChecked}`,
    `More pages advertised: ${report.inspection.hasNextCursor ?? "unknown"}`,
    ...(report.inspection.reason === null ? [] : [`Reason: ${report.inspection.reason}`]),
    `Schema coverage: ${report.coverage.schema}`,
    `Discovery: ${report.coverage.discovery}`,
    `Server catalog: ${report.coverage.serverCatalog}`,
    `Tool execution: ${report.coverage.toolExecution}`,
    `Full conformance: ${report.coverage.fullConformance}`,
    `Custom header annotations: ${report.coverage.customHeaderAnnotations}`,
    "Only the supplied file was inspected. Its provenance and server completeness are not established.",
    ...report.findings.map((finding) => {
      const location = finding.location;
      const locator = location ? ` [tool ${location.toolIndex}${location.schema ? `, ${location.schema}` : ""}${location.relatedToolIndex ? `, related tool ${location.relatedToolIndex}` : ""}]` : "";
      return `${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
    })
  ].join("\n");
}
