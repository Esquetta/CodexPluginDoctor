import type { RuntimeExecutionEvidence } from "../domain/types.js";
import type { McpDiscoveryReport } from "./mcp-discovery.js";
import { createMcpPromptCatalogInspector, type PromptCatalogFinding } from "./mcp-prompt-definition.js";
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

export const MCP_PROMPTS_LIST: McpCatalogList<PromptCatalogFinding> = {
  method: "prompts/list",
  capability: "prompts",
  noun: "prompt",
  createInspector() {
    const inspector = createMcpPromptCatalogInspector();
    return {
      findings: inspector.findings,
      items: inspector.prompts,
      get checked() {
        return inspector.promptsChecked;
      },
      addFindings: inspector.addFindings,
      inspectPage: inspector.inspectPage
    };
  }
};

export interface McpPromptCatalogReport {
  schemaVersion: 1;
  scope: "prompt-catalog-structure";
  // Present only for local stdio servers.
  transport?: "stdio";
  status: CatalogStatus;
  protocol?: McpToolCatalogProtocol;
  execution?: RuntimeExecutionEvidence | null;
  discovery: McpDiscoveryReport;
  catalog: { complete: boolean; pagesRead: number; promptsChecked: number; reason: string | null };
  coverage: {
    discovery: "pass" | "fail" | "skipped";
    catalogEnumeration: EnumerationCoverage;
    definitions: "shape-only";
    promptRetrieval: "not-tested";
    fullConformance: "not-tested";
  };
  findings: PromptCatalogFinding[];
}

export interface McpPromptCatalogSnapshot {
  report: McpPromptCatalogReport;
  prompts: unknown[] | null;
  cache: McpToolCatalogCache | null;
}

function promptSnapshot(
  capture: McpCatalogCapture<PromptCatalogFinding>,
  stdio?: { protocol: McpToolCatalogProtocol; execution: RuntimeExecutionEvidence | null }
): McpPromptCatalogSnapshot {
  const { complete, pagesRead, checked, reason } = capture.catalog;
  return {
    report: {
      schemaVersion: 1,
      scope: "prompt-catalog-structure",
      ...(stdio === undefined ? {} : { transport: "stdio" as const }),
      status: capture.status,
      ...(stdio === undefined ? {} : { protocol: stdio.protocol, execution: stdio.execution }),
      discovery: capture.discovery,
      catalog: { complete, pagesRead, promptsChecked: checked, reason },
      coverage: {
        discovery: capture.discovery.coverage.discovery,
        catalogEnumeration: capture.enumeration,
        definitions: "shape-only",
        promptRetrieval: "not-tested",
        fullConformance: "not-tested"
      },
      findings: capture.findings
    },
    prompts: capture.items,
    cache: capture.cache
  };
}

// Prompts and cache metadata are returned only for a complete enumeration; prompts are never retrieved.
export async function captureMcpPromptCatalog(rawUrl: string, options: McpToolCatalogOptions = {}): Promise<McpPromptCatalogSnapshot> {
  return promptSnapshot(await captureMcpCatalog(rawUrl, MCP_PROMPTS_LIST, options));
}

// Starts one configured stdio server, reads its prompt list without retrieving prompts, and stops it.
export async function captureStdioMcpPromptCatalog(server: McpStdioServer, options: McpStdioToolCatalogOptions = {}): Promise<McpPromptCatalogSnapshot> {
  const { capture, protocol, execution } = await captureStdioMcpCatalog(server, MCP_PROMPTS_LIST, options);
  return promptSnapshot(capture, { protocol, execution });
}
