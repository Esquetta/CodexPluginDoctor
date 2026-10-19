import type { ResourceTemplateCatalogLocation } from "../core/mcp-resource-template-definition.js";
import type { McpResourceTemplateFileReport } from "../core/mcp-resource-template-file.js";

/** Describes a finding location by one-based positions only, such as "template 2, related template 1". */
export function describeResourceTemplateLocation(location: ResourceTemplateCatalogLocation): string {
  return [
    `template ${location.templateIndex}`,
    ...(location.relatedTemplateIndex === undefined ? [] : [`related template ${location.relatedTemplateIndex}`])
  ].join(", ");
}

export function renderMcpResourceTemplateFileReport(report: McpResourceTemplateFileReport): string {
  return [
    "Offline MCP Resource Template Definitions",
    "=========================================",
    `Status: ${report.status}`,
    `Scope: ${report.scope}`,
    `Source: ${report.source.kind} (${report.source.format})`,
    `Bytes read: ${report.source.bytesRead}`,
    `Inspection complete: ${report.inspection.complete}`,
    `Templates checked: ${report.inspection.templatesChecked}`,
    `More pages advertised: ${report.inspection.hasNextCursor ?? "unknown"}`,
    ...(report.inspection.reason === null ? [] : [`Reason: ${report.inspection.reason}`]),
    `Definition coverage: ${report.coverage.definitions}`,
    `Discovery: ${report.coverage.discovery}`,
    `Server catalog: ${report.coverage.serverCatalog}`,
    `Resource read: ${report.coverage.resourceRead}`,
    `Full conformance: ${report.coverage.fullConformance}`,
    "Only the supplied file was inspected. Its provenance and server completeness are not established.",
    ...report.findings.map((finding) => {
      const locator = finding.location ? ` [${describeResourceTemplateLocation(finding.location)}]` : "";
      return `${finding.severity.toUpperCase()} ${finding.id}${locator}: ${finding.message}\n  ${finding.suggestedFix}`;
    })
  ].join("\n");
}
