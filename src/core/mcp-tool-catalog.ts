import {
  BoundedHttpError,
  requestBoundedHttp,
  type BoundedHttpRequestOptions,
  type BoundedHttpResponse
} from "./bounded-http-client.js";
import {
  discoverMcpCapabilities,
  discoverMcpInstructions,
  discoverMcpServer,
  findMcpSseResponse,
  parseMcpResponse,
  type McpDiscoveryReport,
  type McpJsonObject
} from "./mcp-discovery.js";
import { inspectMcpToolDefinition, type CatalogFinding } from "./mcp-tool-definition.js";
import { RemoteNetworkPolicyError, type RemoteLookup } from "./remote-network-policy.js";
import type { RemoteMcpRequest } from "./remote-mcp-probe.js";
import type { Finding, RuntimeExecutionEvidence } from "../domain/types.js";
import { packageVersion } from "../version.js";

const REQUESTED_VERSION = "2026-07-28";
export const MAX_CATALOG_PAGES = 5;
const MAX_TOOLS = 500;
const MAX_FINDINGS = 100;
export const MAX_CATALOG_RESPONSE_BYTES = 1024 * 1024;
export const MAX_CATALOG_TOTAL_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 15_000;

export type CatalogStatus = "pass" | "warn" | "fail" | "unsupported" | "not-applicable" | "incomplete" | "blocked";
export type EnumerationCoverage = "complete" | "incomplete" | "not-tested";

export interface McpToolCatalogOptions {
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  lookup?: RemoteLookup;
  request?: RemoteMcpRequest;
  now?: () => number;
  bearerToken?: string;
}

export interface McpToolCatalogProtocol {
  era: "modern" | "legacy" | null;
  version: string | null;
}

export interface McpToolCatalogReport {
  schemaVersion: 1;
  scope: "tool-catalog-structure";
  // Present only for local stdio servers; HTTP reports keep their original shape.
  transport?: "stdio";
  status: CatalogStatus;
  protocol?: McpToolCatalogProtocol;
  execution?: RuntimeExecutionEvidence | null;
  discovery: McpDiscoveryReport;
  catalog: { complete: boolean; pagesRead: number; toolsChecked: number; reason: string | null };
  coverage: {
    discovery: "pass" | "fail" | "skipped";
    catalogEnumeration: EnumerationCoverage;
    schema: "root-shape-only";
    toolExecution: "not-tested";
    fullConformance: "not-tested";
    customHeaderAnnotations: "not-tested";
  };
  findings: CatalogFinding[];
}

export interface McpToolCatalogCache {
  ttlMs: number;
  cacheScope: "public" | "private";
}

export interface McpToolCatalogSnapshot {
  report: McpToolCatalogReport;
  tools: unknown[] | null;
  cache: McpToolCatalogCache | null;
}

function isPlainObject(value: unknown): value is McpJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function catalogFinding(
  id: string,
  severity: CatalogFinding["severity"],
  message: string,
  impact: string,
  suggestedFix: string
): CatalogFinding {
  return { id, severity, message, impact, suggestedFix };
}


export function validJsonRpcError(value: unknown): value is McpJsonObject & { code: number; message: string } {
  return isPlainObject(value) && typeof value.code === "number" && Number.isFinite(value.code) && typeof value.message === "string";
}


function validCacheMetadata(value: McpJsonObject): boolean {
  return value.resultType === "complete"
    && typeof value.ttlMs === "number" && Number.isFinite(value.ttlMs) && value.ttlMs >= 0
    && (value.cacheScope === "public" || value.cacheScope === "private");
}

export function hasMatchingEnvelope(message: McpJsonObject, requestId: string): boolean {
  return message.jsonrpc === "2.0" && message.id === requestId
    && Object.hasOwn(message, "result") !== Object.hasOwn(message, "error");
}

export function parseListResult(
  message: McpJsonObject,
  requestId: string,
  resultKey: McpCatalogList<Finding>["resultKey"]
): { items: unknown[]; cursor: string | undefined; cache: McpToolCatalogCache } | null {
  if (!hasMatchingEnvelope(message, requestId)) {
    return null;
  }
  if (!Object.hasOwn(message, "result") || !isPlainObject(message.result) || !validCacheMetadata(message.result) || !Array.isArray(message.result[resultKey])) {
    return null;
  }
  if (Object.hasOwn(message.result, "nextCursor") && typeof message.result.nextCursor !== "string") {
    return null;
  }
  return {
    items: message.result[resultKey] as unknown[],
    cursor: message.result.nextCursor as string | undefined,
    cache: { ttlMs: message.result.ttlMs as number, cacheScope: message.result.cacheScope as McpToolCatalogCache["cacheScope"] }
  };
}

export function buildMcpToolCatalogReport(
  discovery: McpDiscoveryReport,
  status: CatalogStatus,
  catalog: McpToolCatalogReport["catalog"],
  catalogEnumeration: EnumerationCoverage,
  findings: CatalogFinding[]
): McpToolCatalogReport {
  return {
    schemaVersion: 1,
    scope: "tool-catalog-structure",
    status,
    discovery,
    catalog,
    coverage: {
      discovery: discovery.coverage.discovery,
      catalogEnumeration,
      schema: "root-shape-only",
      toolExecution: "not-tested",
      fullConformance: "not-tested",
      customHeaderAnnotations: "not-tested"
    },
    findings
  };
}

export function finalCatalogStatus(findings: Finding[]): "pass" | "warn" | "fail" {
  return findings.some((item) => item.severity === "fail")
    ? "fail"
    : findings.some((item) => item.severity === "warn")
      ? "warn"
      : "pass";
}

type CatalogListName = Pick<McpCatalogList<Finding>, "method" | "capability" | "resultKey" | "slug" | "noun">;
// HTTP findings name the "endpoint"; stdio findings name the "MCP server".
type CatalogServer = "endpoint" | "MCP server";

export function listMethodUnsupported(list: CatalogListName, server: CatalogServer): CatalogFinding {
  return catalogFinding(
    `plugin.catalog.${list.slug.replaceAll("-", "_")}_list.method_unsupported`, "warn", `The ${server} advertised ${list.capability} but does not implement ${list.method}.`,
    `${list.noun[0].toUpperCase()}${list.noun.slice(1)} definitions cannot be enumerated from the advertised capability.`,
    `Implement ${list.method} for the advertised ${server === "endpoint" ? "modern " : ""}MCP ${list.capability} capability.`
  );
}

export function modernInvalidFix(list: CatalogListName): string {
  return `Return a matching JSON-RPC complete result with valid ${list.resultKey} and cache metadata.`;
}

export function listResponseInvalid(list: CatalogListName, server: CatalogServer, suggestedFix: string): CatalogFinding {
  return catalogFinding(
    "plugin.catalog.response.invalid", "fail", `The ${server} returned an invalid ${list.method} response.`,
    `The ${list.noun} catalog cannot be safely enumerated from this response.`, suggestedFix
  );
}

export function listCursorLoop(list: CatalogListName, server: CatalogServer): CatalogFinding {
  return catalogFinding(
    "plugin.catalog.cursor.loop", "warn", `The ${server} repeated a ${list.method} cursor.`,
    "The bounded catalog enumeration cannot determine a complete result set.", "Return each continuation cursor at most once for a single enumeration."
  );
}

function isAuthorizationFinding(discovery: McpDiscoveryReport): boolean {
  return discovery.findings.some((item) => item.id === "plugin.discovery.authorization.required" || item.id === "plugin.discovery.authorization.rejected");
}

export interface McpToolCatalogInspector {
  readonly findings: CatalogFinding[];
  readonly tools: unknown[];
  readonly toolsChecked: number;
  // Adds findings up to the finding limit; returns false when the limit truncated them.
  addFindings(items: CatalogFinding[]): boolean;
  // Inspects one enumerated page and returns the limit that stopped inspection, if any.
  inspectPage(pageTools: unknown[], page: number, timeExpired: () => boolean): "tool-limit" | "finding-limit" | "total-time-limit" | null;
}

// Shared by the HTTP and stdio catalogs so both apply the same tool, finding, and duplicate-name rules.
export function createMcpToolCatalogInspector(): McpToolCatalogInspector {
  const findings: CatalogFinding[] = [];
  const tools: unknown[] = [];
  const names = new Map<string, number>();
  let toolsChecked = 0;

  const addFindings = (items: CatalogFinding[]): boolean => {
    if (findings.length + items.length > MAX_FINDINGS) {
      findings.push(...items.slice(0, MAX_FINDINGS - findings.length));
      return false;
    }
    findings.push(...items);
    return true;
  };

  return {
    findings,
    tools,
    get toolsChecked() {
      return toolsChecked;
    },
    addFindings,
    inspectPage(pageTools, page, timeExpired) {
      for (const tool of pageTools) {
        if (toolsChecked >= MAX_TOOLS) {
          return "tool-limit";
        }
        toolsChecked += 1;
        tools.push(tool);
        const location = { page, toolIndex: toolsChecked };
        if (!addFindings(inspectMcpToolDefinition(tool, location))) {
          return "finding-limit";
        }
        if (isPlainObject(tool) && typeof tool.name === "string") {
          const previous = names.get(tool.name);
          if (previous !== undefined && !addFindings([{
            ...catalogFinding(
              "plugin.catalog.tool.name.duplicate", "warn", "Two enumerated tools use the same name.",
              "Duplicate tool names can make client selection ambiguous.", "Use a unique MCP tool name for each definition."
            ),
            location: { ...location, relatedToolIndex: previous }
          }])) {
            return "finding-limit";
          }
          if (previous === undefined) names.set(tool.name, toolsChecked);
        }
        if (timeExpired()) {
          return "total-time-limit";
        }
      }
      return null;
    }
  };
}

/** A catalog page inspector for one kind of definition, shaped like the tool and prompt inspectors. */
export interface McpCatalogInspector<F extends Finding> {
  readonly findings: F[];
  readonly items: unknown[];
  readonly checked: number;
  addFindings(items: Finding[]): boolean;
  inspectPage(items: unknown[], page: number, timeExpired: () => boolean): string | null;
}

/** What differs between enumerating tool, prompt, and resource template definitions; discovery, limits, paging, and findings are shared. */
export interface McpCatalogList<F extends Finding> {
  method: "tools/list" | "prompts/list" | "resources/templates/list";
  // The capability a server must declare.
  capability: "tools" | "prompts" | "resources";
  // The result array's key.
  resultKey: "tools" | "prompts" | "resourceTemplates";
  // Names request ids, reasons, and finding ids, such as "tools-list-1" and "tools-list-method-unsupported".
  slug: "tools" | "prompts" | "resource-templates";
  noun: "tool" | "prompt" | "resource template";
  createInspector(): McpCatalogInspector<F>;
}

export const MCP_TOOLS_LIST: McpCatalogList<CatalogFinding> = {
  method: "tools/list",
  capability: "tools",
  resultKey: "tools",
  slug: "tools",
  noun: "tool",
  createInspector() {
    const inspector = createMcpToolCatalogInspector();
    return {
      findings: inspector.findings,
      items: inspector.tools,
      get checked() {
        return inspector.toolsChecked;
      },
      addFindings: inspector.addFindings,
      inspectPage: inspector.inspectPage
    };
  }
};

/** A capture before it is shaped into a tool or prompt catalog report. */
export interface McpCatalogCapture<F extends Finding> {
  discovery: McpDiscoveryReport;
  status: CatalogStatus;
  catalog: { complete: boolean; pagesRead: number; checked: number; reason: string | null };
  enumeration: EnumerationCoverage;
  findings: F[];
  items: unknown[] | null;
  cache: McpToolCatalogCache | null;
  // The capability names and instructions discovery declared, set by an HTTP capture once discovery completed.
  capabilities?: string[];
  instructions?: string | null;
}

function toolCatalogSnapshot(capture: McpCatalogCapture<CatalogFinding>): McpToolCatalogSnapshot {
  const { complete, pagesRead, checked, reason } = capture.catalog;
  return {
    report: buildMcpToolCatalogReport(capture.discovery, capture.status, { complete, pagesRead, toolsChecked: checked, reason }, capture.enumeration, capture.findings),
    tools: capture.items,
    cache: capture.cache
  };
}

export function serializeListRequest(method: McpCatalogList<Finding>["method"], id: string, cursor: string | undefined): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    params: {
      ...(cursor === undefined ? {} : { cursor }),
      _meta: {
        "io.modelcontextprotocol/protocolVersion": REQUESTED_VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "Codex Plugin Doctor", version: packageVersion },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  });
}

export async function inspectMcpToolCatalog(rawUrl: string, options: McpToolCatalogOptions = {}): Promise<McpToolCatalogReport> {
  return (await captureMcpToolCatalog(rawUrl, options)).report;
}

// Tools and cache metadata are returned only for a complete enumeration.
export async function captureMcpToolCatalog(rawUrl: string, options: McpToolCatalogOptions = {}): Promise<McpToolCatalogSnapshot> {
  return toolCatalogSnapshot(await captureMcpCatalog(rawUrl, MCP_TOOLS_LIST, options));
}

// Definitions and cache metadata are returned only for a complete enumeration.
export async function captureMcpCatalog<F extends Finding>(
  rawUrl: string,
  list: McpCatalogList<F>,
  options: McpToolCatalogOptions = {}
): Promise<McpCatalogCapture<F>> {
  const request = options.request ?? requestBoundedHttp;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + TOTAL_TIMEOUT_MS;
  let receivedBytes = 0;
  let budgetReason: string | null = null;

  const requestWithinBudget = async (url: string, requestOptions: BoundedHttpRequestOptions = {}): Promise<BoundedHttpResponse> => {
    const remainingTime = deadline - now();
    const remainingBytes = MAX_CATALOG_TOTAL_RESPONSE_BYTES - receivedBytes;
    const timeoutMs = Math.floor(Math.min(REQUEST_TIMEOUT_MS, remainingTime));
    if (timeoutMs < 1) {
      budgetReason = "total-time-limit";
      throw new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "Catalog time budget exhausted.");
    }
    if (remainingBytes <= 0) {
      budgetReason = "total-response-byte-limit";
      throw new BoundedHttpError("REMOTE_HTTP_RESPONSE_TOO_LARGE", "Catalog response byte budget exhausted.");
    }
    const maxResponseBytes = Math.min(MAX_CATALOG_RESPONSE_BYTES, remainingBytes);
    const response = await request(url, {
      ...requestOptions,
      timeoutMs,
      maxResponseBytes
    });
    receivedBytes += response.body.length;
    if (response.body.length > maxResponseBytes) {
      budgetReason = receivedBytes > MAX_CATALOG_TOTAL_RESPONSE_BYTES ? "total-response-byte-limit" : "response-byte-limit";
      throw new BoundedHttpError("REMOTE_HTTP_RESPONSE_TOO_LARGE", "Catalog response exceeded the byte budget.");
    }
    return response;
  };

  let discoveryResponse: BoundedHttpResponse | null = null;
  const discovery = await discoverMcpServer(rawUrl, {
    allowNetwork: options.allowNetwork,
    allowLocalNetwork: options.allowLocalNetwork,
    lookup: options.lookup,
    bearerToken: options.bearerToken,
    request: async (url, requestOptions) => {
      const response = await requestWithinBudget(url, requestOptions);
      discoveryResponse = response;
      return response;
    }
  });

  let surface: { capabilities: string[]; instructions: string | null } | undefined;
  const partial = (status: CatalogStatus, catalog: McpCatalogCapture<F>["catalog"], enumeration: EnumerationCoverage, findings: F[]): McpCatalogCapture<F> =>
    ({ discovery, status, catalog, enumeration, findings, items: null, cache: null, ...surface });
  const emptyCatalog = { complete: false, pagesRead: 0, checked: 0, reason: null };
  if (discovery.status === "blocked") {
    const reason = discovery.findings.some((item) => item.id === "plugin.discovery.credentials.insecure_transport")
      ? "credentials-insecure-transport"
      : "network-blocked";
    return partial("blocked", { ...emptyCatalog, reason }, "not-tested", []);
  }
  if (isAuthorizationFinding(discovery)) {
    return partial("incomplete", { ...emptyCatalog, reason: "authorization-required" }, "not-tested", []);
  }
  if (discovery.status === "unsupported") {
    return partial("unsupported", { ...emptyCatalog, reason: "discovery-unsupported" }, "not-tested", []);
  }
  if (discovery.status !== "discovered") {
    return partial("incomplete", { ...emptyCatalog, reason: budgetReason ?? "discovery-failed" }, "not-tested", []);
  }

  const capabilities = discoveryResponse === null ? null : discoverMcpCapabilities(discoveryResponse);
  if (capabilities === null) {
    return partial("incomplete", { ...emptyCatalog, reason: "discovery-response-unavailable" }, "not-tested", []);
  }
  surface = { capabilities: Object.keys(capabilities), instructions: discoveryResponse === null ? null : discoverMcpInstructions(discoveryResponse) };
  if (!Object.hasOwn(capabilities, list.capability)) {
    return partial("not-applicable", emptyCatalog, "not-tested", []);
  }

  const inspector = list.createInspector();
  const findings = inspector.findings;
  const seenCursors = new Set<string>();
  let pagesRead = 0;
  let cursor: string | undefined;
  let incompleteReason: string | null = null;
  let blocked = false;
  let cache: McpToolCatalogCache | null = null;

  const addFindings = (items: Finding[]): boolean => {
    if (inspector.addFindings(items)) return true;
    incompleteReason = "finding-limit";
    return false;
  };

  while (incompleteReason === null && !blocked) {
    if (pagesRead >= MAX_CATALOG_PAGES) {
      incompleteReason = "page-limit";
      break;
    }
    if (Math.floor(deadline - now()) < 1) {
      incompleteReason = "total-time-limit";
      break;
    }

    const requestId = `${list.slug}-list-${pagesRead + 1}`;
    let response: BoundedHttpResponse;
    try {
      response = await requestWithinBudget(rawUrl, {
        allowLocalNetwork: options.allowLocalNetwork,
        lookup: options.lookup,
        bearerToken: options.bearerToken,
        method: "POST",
        body: serializeListRequest(list.method, requestId, cursor),
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": REQUESTED_VERSION,
          "Mcp-Method": list.method
        },
        stopAfter: (received) => findMcpSseResponse(received, requestId) !== null
      });
    } catch (error) {
      if (error instanceof RemoteNetworkPolicyError) {
        blocked = true;
      } else {
        incompleteReason = budgetReason ?? (error instanceof BoundedHttpError && error.code === "REMOTE_HTTP_INSECURE_CREDENTIALS"
          ? "credentials-insecure-transport"
          : error instanceof BoundedHttpError && error.code === "REMOTE_HTTP_TIMEOUT"
          ? "request-timeout"
          : error instanceof BoundedHttpError && error.code === "REMOTE_HTTP_RESPONSE_TOO_LARGE"
            ? "response-byte-limit"
            : "request-failed");
      }
      break;
    }

    if (response.statusCode === 401 || response.statusCode === 403) {
      incompleteReason = "authorization-required";
      break;
    }
    const message = parseMcpResponse(response, requestId);
    if (message !== null && hasMatchingEnvelope(message, requestId) && Object.hasOwn(message, "error")
      && validJsonRpcError(message.error) && message.error.code === -32601 && (response.statusCode === 200 || response.statusCode === 404)) {
      if (addFindings([listMethodUnsupported(list, "endpoint")])) incompleteReason = `${list.slug}-list-method-unsupported`;
      break;
    }
    if (response.statusCode !== 200) {
      if (addFindings([catalogFinding(
        "plugin.catalog.http_status.invalid", "fail", `The endpoint returned an unexpected ${list.method} HTTP status.`,
        `The ${list.noun} catalog cannot be safely enumerated from this response.`, `Return HTTP 200 for a ${list.method} response after authorization succeeds.`
      )])) incompleteReason = "http-status-invalid";
      break;
    }
    const page = message === null ? null : parseListResult(message, requestId, list.resultKey);
    if (page === null) {
      if (addFindings([listResponseInvalid(list, "endpoint", modernInvalidFix(list))])) incompleteReason = "response-invalid";
      break;
    }

    pagesRead += 1;
    cache = cache === null ? page.cache : {
      ttlMs: Math.min(cache.ttlMs, page.cache.ttlMs),
      cacheScope: cache.cacheScope === "private" ? "private" : page.cache.cacheScope
    };
    incompleteReason = inspector.inspectPage(page.items, pagesRead, () => deadline - now() <= 0);
    if (incompleteReason !== null) break;
    if (page.cursor === undefined) break;
    if (seenCursors.has(page.cursor)) {
      if (addFindings([listCursorLoop(list, "endpoint")])) incompleteReason = "cursor-loop";
      break;
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  const checked = inspector.checked;
  if (blocked) {
    return partial("blocked", { complete: false, pagesRead, checked, reason: "network-blocked" }, "incomplete", findings);
  }
  if (incompleteReason !== null) {
    return partial("incomplete", { complete: false, pagesRead, checked, reason: incompleteReason }, "incomplete", findings);
  }
  if (deadline - now() <= 0) {
    return partial("incomplete", { complete: false, pagesRead, checked, reason: "total-time-limit" }, "incomplete", findings);
  }
  return {
    discovery,
    status: finalCatalogStatus(findings),
    catalog: { complete: true, pagesRead, checked, reason: null },
    enumeration: "complete",
    findings,
    items: inspector.items,
    cache,
    ...surface
  };
}
