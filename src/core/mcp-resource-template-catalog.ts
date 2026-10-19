import type { RuntimeExecutionEvidence } from "../domain/types.js";
import type { McpDiscoveryReport } from "./mcp-discovery.js";
import { createMcpResourceTemplateCatalogInspector, type ResourceTemplateCatalogFinding } from "./mcp-resource-template-definition.js";
import { captureStdioMcpCatalog, type McpStdioServer, type McpStdioToolCatalogOptions } from "./mcp-stdio-tool-catalog.js";
import {
  captureMcpCatalog,
  type CatalogStatus,
  type EnumerationCoverage,
  type McpCatalogCapture,
  type McpCatalogList,
  type McpToolCatalogCache,
  type McpToolCatalogOptions,
  type McpToolCatalogProtocol
} from "./mcp-tool-catalog.js";

export const MCP_RESOURCE_TEMPLATES_LIST: McpCatalogList<ResourceTemplateCatalogFinding> = {
  method: "resources/templates/list",
  capability: "resources",
  resultKey: "resourceTemplates",
  slug: "resource-templates",
  noun: "resource template",
  createInspector() {
    const inspector = createMcpResourceTemplateCatalogInspector();
    return {
      findings: inspector.findings,
      items: inspector.templates,
      get checked() {
        return inspector.templatesChecked;
      },
      addFindings: inspector.addFindings,
      inspectPage: inspector.inspectPage
    };
  }
};

export interface McpResourceTemplateCatalogReport {
  schemaVersion: 1;
  scope: "resource-template-catalog-structure";
  // Present only for local stdio servers.
  transport?: "stdio";
  status: CatalogStatus;
  protocol?: McpToolCatalogProtocol;
  execution?: RuntimeExecutionEvidence | null;
  discovery: McpDiscoveryReport;
  catalog: { complete: boolean; pagesRead: number; templatesChecked: number; reason: string | null };
  coverage: {
    discovery: "pass" | "fail" | "skipped";
    catalogEnumeration: EnumerationCoverage;
    definitions: "shape-only";
    resourceRead: "not-tested";
    fullConformance: "not-tested";
  };
  findings: ResourceTemplateCatalogFinding[];
}

export interface McpResourceTemplateCatalogSnapshot {
  report: McpResourceTemplateCatalogReport;
  templates: unknown[] | null;
  cache: McpToolCatalogCache | null;
}

function templateSnapshot(
  capture: McpCatalogCapture<ResourceTemplateCatalogFinding>,
  stdio?: { protocol: McpToolCatalogProtocol; execution: RuntimeExecutionEvidence | null }
): McpResourceTemplateCatalogSnapshot {
  const { complete, pagesRead, checked, reason } = capture.catalog;
  return {
    report: {
      schemaVersion: 1,
      scope: "resource-template-catalog-structure",
      ...(stdio === undefined ? {} : { transport: "stdio" as const }),
      status: capture.status,
      ...(stdio === undefined ? {} : { protocol: stdio.protocol, execution: stdio.execution }),
      discovery: capture.discovery,
      catalog: { complete, pagesRead, templatesChecked: checked, reason },
      coverage: {
        discovery: capture.discovery.coverage.discovery,
        catalogEnumeration: capture.enumeration,
        definitions: "shape-only",
        resourceRead: "not-tested",
        fullConformance: "not-tested"
      },
      findings: capture.findings
    },
    templates: capture.items,
    cache: capture.cache
  };
}

// Templates and cache metadata are returned only for a complete enumeration; no resource is read.
export async function captureMcpResourceTemplateCatalog(rawUrl: string, options: McpToolCatalogOptions = {}): Promise<McpResourceTemplateCatalogSnapshot> {
  return templateSnapshot(await captureMcpCatalog(rawUrl, MCP_RESOURCE_TEMPLATES_LIST, options));
}

// Starts one configured stdio server, reads its resource template list without reading resources, and stops it.
export async function captureStdioMcpResourceTemplateCatalog(
  server: McpStdioServer,
  options: McpStdioToolCatalogOptions = {}
): Promise<McpResourceTemplateCatalogSnapshot> {
  const { capture, protocol, execution } = await captureStdioMcpCatalog(server, MCP_RESOURCE_TEMPLATES_LIST, options);
  return templateSnapshot(capture, { protocol, execution });
}
