import type { PromptCatalogLocation } from "../core/mcp-prompt-definition.js";
import type { McpPromptFileReport } from "../core/mcp-prompt-file.js";

/** Describes a finding location by one-based positions only, such as "prompt 2, argument 1, related argument 3". */
export function describePromptLocation(location: PromptCatalogLocation): string {
  return [
    `prompt ${location.promptIndex}`,
    ...(location.argumentIndex === undefined ? [] : [`argument ${location.argumentIndex}`]),
    ...(location.relatedPromptIndex === undefined ? [] : [`related prompt ${location.relatedPromptIndex}`]),
    ...(location.relatedArgumentIndex === undefined ? [] : [`related argument ${location.relatedArgumentIndex}`])
  ].join(", ");
}

export function renderMcpPromptFileReport(report: McpPromptFileReport): string {
  return [
    "Offline MCP Prompt Definitions",
    "==============================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Source: ${report.source.kind} (${report.source.format})`,
    `Bytes read: ${report.source.bytesRead}`,
    `Inspection complete: ${report.inspection.complete}`,
    `Prompts checked: ${report.inspection.promptsChecked}`,
    `More pages advertised: ${report.inspection.hasNextCursor ?? "unknown"}`,
    ...(report.inspection.reason === null ? [] : [`Reason: ${report.inspection.reason}`]),
    `Definition coverage: ${report.coverage.definitions}`,
    `Discovery: ${report.coverage.discovery}`,
    `Server catalog: ${report.coverage.serverCatalog}`,
    `Prompt retrieval: ${report.coverage.promptRetrieval}`,
    `Full conformance: ${report.coverage.fullConformance}`,
    "Only the supplied file was inspected. Its provenance and server completeness are not established.",
    ...report.findings.map((finding) => {
      const locator = finding.location ? ` [${describePromptLocation(finding.location)}]` : "";
      return `${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
    })
  ].join("\n");
}
