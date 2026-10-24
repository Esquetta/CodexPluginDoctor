import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import type { Finding, RuntimeExecutionEvidence } from "../domain/types.js";
import type { McpDiscoveryReport } from "./mcp-discovery.js";
import { MCP_PROMPTS_LIST } from "./mcp-prompt-catalog.js";
import { MCP_RESOURCE_TEMPLATES_LIST } from "./mcp-resource-template-catalog.js";
import { captureStdioMcpCatalogs, type McpStdioServer, type McpStdioToolCatalogOptions } from "./mcp-stdio-tool-catalog.js";
import {
  captureMcpCatalog,
  MCP_TOOLS_LIST,
  type CatalogStatus,
  type EnumerationCoverage,
  type McpCatalogCapture,
  type McpCatalogList,
  type McpToolCatalogCache,
  type McpToolCatalogOptions,
  type McpToolCatalogProtocol
} from "./mcp-tool-catalog.js";
import { saveLocalFile, saveMcpListResponse, type McpListResponseSaveResult, type McpLocalFileSaveResult } from "./mcp-tool-response-file.js";

export type McpSnapshotListKey = "tools" | "prompts" | "resourceTemplates";

// The lists a snapshot reads, in order, with the file each complete one is saved to.
const SNAPSHOT_LISTS: Array<{ key: McpSnapshotListKey; list: McpCatalogList<Finding>; fileName: string }> = [
  { key: "tools", list: MCP_TOOLS_LIST, fileName: "mcp-tools-current.json" },
  { key: "prompts", list: MCP_PROMPTS_LIST, fileName: "mcp-prompts-current.json" },
  { key: "resourceTemplates", list: MCP_RESOURCE_TEMPLATES_LIST, fileName: "mcp-resource-templates-current.json" }
];
export const SNAPSHOT_LIST_KEYS = SNAPSHOT_LISTS.map(({ key }) => key);
export const SNAPSHOT_LIST_FILES = Object.fromEntries(SNAPSHOT_LISTS.map(({ key, fileName }) => [key, fileName])) as Record<McpSnapshotListKey, string>;
export const SNAPSHOT_MANIFEST_FILE = "mcp-snapshot-manifest.json";

// The protocol and capabilities a server offers, which clients depend on beyond its lists.
export interface McpServerSurface {
  era: "modern" | "legacy";
  // Supported protocol versions: discovery's supportedVersions, or the version initialize negotiated.
  versions: string[];
  // Top-level capability names only; their values are not recorded.
  capabilities: string[];
}
export const MAX_SURFACE_VERSIONS = 32;
export const MAX_SURFACE_CAPABILITIES = 64;
export const MAX_SURFACE_NAME_LENGTH = 128;

// Records why each list file is present or absent, so a comparison never guesses from file presence.
export interface McpSnapshotManifest {
  schemaVersion: 1;
  scope: "mcp-snapshot-manifest";
  // file is the list's file name when this snapshot saved it, otherwise null.
  lists: Record<McpSnapshotListKey, { status: CatalogStatus; file: string | null }>;
  // Null when the snapshot did not establish it; absent from manifests written before 1.84.0.
  server?: McpServerSurface | null;
}

export interface McpSnapshotList {
  status: CatalogStatus;
  catalog: { complete: boolean; pagesRead: number; checked: number; reason: string | null };
  enumeration: EnumerationCoverage;
  findings: Finding[];
}

export interface McpSnapshotReport {
  schemaVersion: 1;
  scope: "mcp-surface-snapshot";
  // Present only for local stdio servers.
  transport?: "stdio";
  status: CatalogStatus;
  protocol?: McpToolCatalogProtocol;
  execution?: RuntimeExecutionEvidence | null;
  discovery: McpDiscoveryReport;
  // Null when discovery or the initialize handshake did not complete.
  server: McpServerSurface | null;
  lists: Record<McpSnapshotListKey, McpSnapshotList>;
  coverage: {
    discovery: "pass" | "fail" | "skipped";
    definitions: "shape-only";
    // No tool is called, no prompt is retrieved, and no resource is read.
    execution: "not-tested";
    fullConformance: "not-tested";
  };
}

export interface McpSnapshot {
  report: McpSnapshotReport;
  // Complete enumerations, which are the ones that can be saved.
  responses: Record<McpSnapshotListKey, { items: unknown[]; cache: McpToolCatalogCache } | null>;
}

// Sorted, without duplicates, and bounded, so a manifest stays small and compares in a stable order.
function serverSurface(era: McpServerSurface["era"], versions: string[], capabilities: string[]): McpServerSurface {
  const bounded = (values: string[], max: number) =>
    [...new Set(values.filter((value) => value.length > 0 && value.length <= MAX_SURFACE_NAME_LENGTH))].sort().slice(0, max);
  return { era, versions: bounded(versions, MAX_SURFACE_VERSIONS), capabilities: bounded(capabilities, MAX_SURFACE_CAPABILITIES) };
}

// The worst list status leads, but a list the server does not offer never makes the snapshot fail.
const STATUS_ORDER: CatalogStatus[] = ["blocked", "incomplete", "unsupported", "fail", "warn", "pass", "not-applicable"];

function snapshot(
  captures: Array<McpCatalogCapture<Finding>>,
  server: McpServerSurface | null,
  stdio?: { protocol: McpToolCatalogProtocol; execution: RuntimeExecutionEvidence | null }
): McpSnapshot {
  const discovery = captures[0].discovery;
  const status = STATUS_ORDER.find((candidate) => captures.some((capture) => capture.status === candidate)) ?? "not-applicable";
  const lists = {} as Record<McpSnapshotListKey, McpSnapshotList>;
  const responses = {} as McpSnapshot["responses"];
  SNAPSHOT_LISTS.forEach(({ key }, index) => {
    const capture = captures[index];
    lists[key] = { status: capture.status, catalog: capture.catalog, enumeration: capture.enumeration, findings: capture.findings };
    responses[key] = capture.items !== null && capture.cache !== null ? { items: capture.items, cache: capture.cache } : null;
  });
  return {
    report: {
      schemaVersion: 1,
      scope: "mcp-surface-snapshot",
      ...(stdio === undefined ? {} : { transport: "stdio" as const }),
      status,
      ...(stdio === undefined ? {} : { protocol: stdio.protocol, execution: stdio.execution }),
      discovery,
      server,
      lists,
      coverage: { discovery: discovery.coverage.discovery, definitions: "shape-only", execution: "not-tested", fullConformance: "not-tested" }
    },
    responses
  };
}

// HTTP requests carry no session, so each list is captured on its own; the report shows the first discovery.
export async function captureMcpSnapshot(rawUrl: string, options: McpToolCatalogOptions = {}): Promise<McpSnapshot> {
  const captures: Array<McpCatalogCapture<Finding>> = [];
  for (const { list } of SNAPSHOT_LISTS) captures.push(await captureMcpCatalog(rawUrl, list, options));
  const { discovery, capabilities } = captures[0];
  return snapshot(captures, capabilities === undefined ? null : serverSurface("modern", discovery.supportedVersions, capabilities));
}

// Starts the stdio server once and reads every list it offers in that one session.
export async function captureStdioMcpSnapshot(server: McpStdioServer, options: McpStdioToolCatalogOptions = {}): Promise<McpSnapshot> {
  const { captures, protocol, execution, capabilities } = await captureStdioMcpCatalogs(server, SNAPSHOT_LISTS.map(({ list }) => list), options);
  const versions = protocol.era === "modern" ? captures[0].discovery.supportedVersions : protocol.version === null ? [] : [protocol.version];
  const surface = capabilities === null || protocol.era === null ? null : serverSurface(protocol.era, versions, capabilities);
  return snapshot(captures, surface, { protocol, execution });
}

export interface McpSnapshotSaveResult {
  key: McpSnapshotListKey;
  fileName: string;
  method: McpCatalogList<Finding>["method"];
  result: McpListResponseSaveResult;
}

/**
 * Saves each complete list as its own response file in the directory, which is created when missing,
 * then the manifest that names the files this run saved. An earlier manifest is removed first, so a
 * run that stops before writing its own leaves no manifest that names files this run did not save.
 */
export async function saveMcpSnapshot(
  directory: string,
  { report, responses }: McpSnapshot
): Promise<{ lists: McpSnapshotSaveResult[]; manifest: McpLocalFileSaveResult }> {
  await mkdir(directory, { recursive: true });
  await rm(path.join(directory, SNAPSHOT_MANIFEST_FILE), { force: true }).catch(() => undefined);
  const results: McpSnapshotSaveResult[] = [];
  const manifest: McpSnapshotManifest = { schemaVersion: 1, scope: "mcp-snapshot-manifest", lists: {} as McpSnapshotManifest["lists"], server: report.server };
  for (const { key, list, fileName } of SNAPSHOT_LISTS) {
    const response = responses[key];
    let saved = false;
    if (response !== null) {
      const result = await saveMcpListResponse(path.join(directory, fileName), list.resultKey, response.items, response.cache);
      results.push({ key, fileName, method: list.method, result });
      saved = result.kind === "saved";
    }
    manifest.lists[key] = { status: report.lists[key].status, file: saved ? fileName : null };
  }
  return { lists: results, manifest: await saveLocalFile(path.join(directory, SNAPSHOT_MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`) };
}
