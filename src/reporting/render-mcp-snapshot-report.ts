import type { McpSnapshotListKey, McpSnapshotReport } from "../core/mcp-snapshot.js";
import type { PromptCatalogLocation } from "../core/mcp-prompt-definition.js";
import type { ResourceTemplateCatalogLocation } from "../core/mcp-resource-template-definition.js";
import type { CatalogLocation } from "../core/mcp-tool-definition.js";
import { describePromptLocation } from "./render-mcp-prompt-file-report.js";
import { describeResourceTemplateLocation } from "./render-mcp-resource-template-file-report.js";

const LIST_LABELS: Record<McpSnapshotListKey, string> = { tools: "Tools", prompts: "Prompts", resourceTemplates: "Resource templates" };

function describeLocation(key: McpSnapshotListKey, location: unknown): string {
  if (key === "prompts") return describePromptLocation(location as PromptCatalogLocation);
  if (key === "resourceTemplates") return describeResourceTemplateLocation(location as ResourceTemplateCatalogLocation);
  const tool = location as CatalogLocation;
  return `tool ${tool.toolIndex}${tool.schema ? `, ${tool.schema}` : ""}${tool.relatedToolIndex ? `, related tool ${tool.relatedToolIndex}` : ""}`;
}

export function renderMcpSnapshotReport(report: McpSnapshotReport): string {
  const keys = Object.keys(LIST_LABELS) as McpSnapshotListKey[];
  return [
    "MCP Snapshot",
    "============",
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
    ...keys.map((key) => {
      const list = report.lists[key];
      return `${LIST_LABELS[key]}: ${list.status}${list.enumeration === "not-tested" ? "" : ` (${list.catalog.checked} checked in ${list.catalog.pagesRead} pages)`}${list.catalog.reason === null ? "" : `, reason ${list.catalog.reason}`}`;
    }),
    `Definition coverage: ${report.coverage.definitions}`,
    `Tool calls, prompt retrieval, and resource reads: ${report.coverage.execution}`,
    "Counts describe inspected content, not a guaranteed server-wide inventory.",
    ...report.discovery.findings.map((finding) => `${finding.severity.toUpperCase()} ${finding.id}: ${finding.message}\n  ${finding.suggestedFix}`),
    ...keys.flatMap((key) => report.lists[key].findings.map((finding) => {
      const location = (finding as { location?: { page: number } }).location;
      const locator = location ? `, page ${location.page}, ${describeLocation(key, location)}` : "";
      return `${finding.severity.toUpperCase()} ${finding.id} [${LIST_LABELS[key].toLowerCase()}${locator}]: ${finding.message}\n  ${finding.suggestedFix}`;
    }))
  ].join("\n");
}
