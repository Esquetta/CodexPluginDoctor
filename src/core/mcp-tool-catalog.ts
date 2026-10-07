import {
  BoundedHttpError,
  requestBoundedHttp,
  type BoundedHttpRequestOptions,
  type BoundedHttpResponse
} from "./bounded-http-client.js";
import {
  discoverMcpCapabilities,
  discoverMcpServer,
  findMcpSseResponse,
  parseMcpResponse,
  type McpDiscoveryReport,
  type McpJsonObject
} from "./mcp-discovery.js";
import { inspectMcpToolDefinition, type CatalogFinding } from "./mcp-tool-definition.js";
import { RemoteNetworkPolicyError, type RemoteLookup } from "./remote-network-policy.js";
import type { RemoteMcpRequest } from "./remote-mcp-probe.js";
import { packageVersion } from "../version.js";

const REQUESTED_VERSION = "2026-07-28";
const MAX_PAGES = 5;
const MAX_TOOLS = 500;
const MAX_FINDINGS = 100;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_TOTAL_RESPONSE_BYTES = 4 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 3_000;
const TOTAL_TIMEOUT_MS = 15_000;

type CatalogStatus = "pass" | "warn" | "fail" | "unsupported" | "not-applicable" | "incomplete" | "blocked";
type EnumerationCoverage = "complete" | "incomplete" | "not-tested";

export interface McpToolCatalogOptions {
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  lookup?: RemoteLookup;
  request?: RemoteMcpRequest;
  now?: () => number;
}

export interface McpToolCatalogReport {
  schemaVersion: 1;
  scope: "tool-catalog-structure";
  status: CatalogStatus;
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

function finding(
  id: string,
  severity: CatalogFinding["severity"],
  message: string,
  impact: string,
  suggestedFix: string
): CatalogFinding {
  return { id, severity, message, impact, suggestedFix };
}

function validError(value: unknown): value is McpJsonObject & { code: number; message: string } {
  return isPlainObject(value) && typeof value.code === "number" && Number.isFinite(value.code) && typeof value.message === "string";
}

function validCacheMetadata(value: McpJsonObject): boolean {
  return value.resultType === "complete"
    && typeof value.ttlMs === "number" && Number.isFinite(value.ttlMs) && value.ttlMs >= 0
    && (value.cacheScope === "public" || value.cacheScope === "private");
}

function hasMatchingEnvelope(message: McpJsonObject, requestId: string): boolean {
  return message.jsonrpc === "2.0" && message.id === requestId
    && Object.hasOwn(message, "result") !== Object.hasOwn(message, "error");
}

function parseToolsResult(message: McpJsonObject, requestId: string): { tools: unknown[]; cursor: string | undefined; cache: McpToolCatalogCache } | null {
  if (!hasMatchingEnvelope(message, requestId)) {
    return null;
  }
  if (!Object.hasOwn(message, "result") || !isPlainObject(message.result) || !validCacheMetadata(message.result) || !Array.isArray(message.result.tools)) {
    return null;
  }
  if (Object.hasOwn(message.result, "nextCursor") && typeof message.result.nextCursor !== "string") {
    return null;
  }
  return {
    tools: message.result.tools,
    cursor: message.result.nextCursor as string | undefined,
    cache: { ttlMs: message.result.ttlMs as number, cacheScope: message.result.cacheScope as McpToolCatalogCache["cacheScope"] }
  };
}

function catalogReport(
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

function finalStatus(findings: CatalogFinding[]): "pass" | "warn" | "fail" {
  return findings.some((item) => item.severity === "fail")
    ? "fail"
    : findings.some((item) => item.severity === "warn")
      ? "warn"
      : "pass";
}

function isAuthorizationFinding(discovery: McpDiscoveryReport): boolean {
  return discovery.findings.some((item) => item.id === "plugin.discovery.authorization.required");
}

function requestBody(id: string, cursor: string | undefined): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/list",
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
  const request = options.request ?? requestBoundedHttp;
  const now = options.now ?? (() => performance.now());
  const deadline = now() + TOTAL_TIMEOUT_MS;
  let receivedBytes = 0;
  let budgetReason: string | null = null;

  const requestWithinBudget = async (url: string, requestOptions: BoundedHttpRequestOptions = {}): Promise<BoundedHttpResponse> => {
    const remainingTime = deadline - now();
    const remainingBytes = MAX_TOTAL_RESPONSE_BYTES - receivedBytes;
    const timeoutMs = Math.floor(Math.min(REQUEST_TIMEOUT_MS, remainingTime));
    if (timeoutMs < 1) {
      budgetReason = "total-time-limit";
      throw new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "Catalog time budget exhausted.");
    }
    if (remainingBytes <= 0) {
      budgetReason = "total-response-byte-limit";
      throw new BoundedHttpError("REMOTE_HTTP_RESPONSE_TOO_LARGE", "Catalog response byte budget exhausted.");
    }
    const maxResponseBytes = Math.min(MAX_RESPONSE_BYTES, remainingBytes);
    const response = await request(url, {
      ...requestOptions,
      timeoutMs,
      maxResponseBytes
    });
    receivedBytes += response.body.length;
    if (response.body.length > maxResponseBytes) {
      budgetReason = receivedBytes > MAX_TOTAL_RESPONSE_BYTES ? "total-response-byte-limit" : "response-byte-limit";
      throw new BoundedHttpError("REMOTE_HTTP_RESPONSE_TOO_LARGE", "Catalog response exceeded the byte budget.");
    }
    return response;
  };

  let discoveryResponse: BoundedHttpResponse | null = null;
  const discovery = await discoverMcpServer(rawUrl, {
    allowNetwork: options.allowNetwork,
    allowLocalNetwork: options.allowLocalNetwork,
    lookup: options.lookup,
    request: async (url, requestOptions) => {
      const response = await requestWithinBudget(url, requestOptions);
      discoveryResponse = response;
      return response;
    }
  });

  const partial = (report: McpToolCatalogReport): McpToolCatalogSnapshot => ({ report, tools: null, cache: null });
  const emptyCatalog = { complete: false, pagesRead: 0, toolsChecked: 0, reason: null };
  if (discovery.status === "blocked") {
    return partial(catalogReport(discovery, "blocked", { ...emptyCatalog, reason: "network-blocked" }, "not-tested", []));
  }
  if (isAuthorizationFinding(discovery)) {
    return partial(catalogReport(discovery, "incomplete", { ...emptyCatalog, reason: "authorization-required" }, "not-tested", []));
  }
  if (discovery.status === "unsupported") {
    return partial(catalogReport(discovery, "unsupported", { ...emptyCatalog, reason: "discovery-unsupported" }, "not-tested", []));
  }
  if (discovery.status !== "discovered") {
    return partial(catalogReport(discovery, "incomplete", { ...emptyCatalog, reason: budgetReason ?? "discovery-failed" }, "not-tested", []));
  }

  const capabilities = discoveryResponse === null ? null : discoverMcpCapabilities(discoveryResponse);
  if (capabilities === null) {
    return partial(catalogReport(discovery, "incomplete", { ...emptyCatalog, reason: "discovery-response-unavailable" }, "not-tested", []));
  }
  if (!Object.hasOwn(capabilities, "tools")) {
    return partial(catalogReport(discovery, "not-applicable", emptyCatalog, "not-tested", []));
  }

  const findings: CatalogFinding[] = [];
  const names = new Map<string, number>();
  const seenCursors = new Set<string>();
  let pagesRead = 0;
  let toolsChecked = 0;
  let cursor: string | undefined;
  let incompleteReason: string | null = null;
  let blocked = false;
  const tools: unknown[] = [];
  let cache: McpToolCatalogCache | null = null;

  const addFindings = (items: CatalogFinding[]): boolean => {
    if (findings.length + items.length > MAX_FINDINGS) {
      findings.push(...items.slice(0, MAX_FINDINGS - findings.length));
      incompleteReason = "finding-limit";
      return false;
    }
    findings.push(...items);
    return true;
  };

  while (incompleteReason === null && !blocked) {
    if (pagesRead >= MAX_PAGES) {
      incompleteReason = "page-limit";
      break;
    }
    if (Math.floor(deadline - now()) < 1) {
      incompleteReason = "total-time-limit";
      break;
    }

    const requestId = `tools-list-${pagesRead + 1}`;
    let response: BoundedHttpResponse;
    try {
      response = await requestWithinBudget(rawUrl, {
        allowLocalNetwork: options.allowLocalNetwork,
        lookup: options.lookup,
        method: "POST",
        body: requestBody(requestId, cursor),
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": REQUESTED_VERSION,
          "Mcp-Method": "tools/list"
        },
        stopAfter: (received) => findMcpSseResponse(received, requestId) !== null
      });
    } catch (error) {
      if (error instanceof RemoteNetworkPolicyError) {
        blocked = true;
      } else {
        incompleteReason = budgetReason ?? (error instanceof BoundedHttpError && error.code === "REMOTE_HTTP_TIMEOUT"
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
      && validError(message.error) && message.error.code === -32601 && (response.statusCode === 200 || response.statusCode === 404)) {
      if (addFindings([finding(
        "plugin.catalog.tools_list.method_unsupported", "warn", "The endpoint advertised tools but does not implement tools/list.",
        "Tool definitions cannot be enumerated from the advertised capability.", "Implement tools/list for the advertised modern MCP tools capability."
      )])) incompleteReason = "tools-list-method-unsupported";
      break;
    }
    if (response.statusCode !== 200) {
      if (addFindings([finding(
        "plugin.catalog.http_status.invalid", "fail", "The endpoint returned an unexpected tools/list HTTP status.",
        "The tool catalog cannot be safely enumerated from this response.", "Return HTTP 200 for a tools/list response after authorization succeeds."
      )])) incompleteReason = "http-status-invalid";
      break;
    }
    const page = message === null ? null : parseToolsResult(message, requestId);
    if (page === null) {
      if (addFindings([finding(
        "plugin.catalog.response.invalid", "fail", "The endpoint returned an invalid tools/list response.",
        "The tool catalog cannot be safely enumerated from this response.", "Return a matching JSON-RPC complete result with valid tools and cache metadata."
      )])) incompleteReason = "response-invalid";
      break;
    }

    pagesRead += 1;
    cache = cache === null ? page.cache : {
      ttlMs: Math.min(cache.ttlMs, page.cache.ttlMs),
      cacheScope: cache.cacheScope === "private" ? "private" : page.cache.cacheScope
    };
    for (const tool of page.tools) {
      if (toolsChecked >= MAX_TOOLS) {
        incompleteReason = "tool-limit";
        break;
      }
      toolsChecked += 1;
      tools.push(tool);
      const location = { page: pagesRead, toolIndex: toolsChecked };
      if (!addFindings(inspectMcpToolDefinition(tool, location))) {
        break;
      }
      if (isPlainObject(tool) && typeof tool.name === "string") {
        const previous = names.get(tool.name);
        if (previous !== undefined && !addFindings([{
          ...finding(
            "plugin.catalog.tool.name.duplicate", "warn", "Two enumerated tools use the same name.",
            "Duplicate tool names can make client selection ambiguous.", "Use a unique MCP tool name for each definition."
          ),
          location: { ...location, relatedToolIndex: previous }
        }])) {
          break;
        }
        if (previous === undefined) names.set(tool.name, toolsChecked);
      }
      if (deadline - now() <= 0) {
        incompleteReason = "total-time-limit";
        break;
      }
    }
    if (incompleteReason !== null) break;
    if (page.cursor === undefined) break;
    if (seenCursors.has(page.cursor)) {
      if (addFindings([finding(
        "plugin.catalog.cursor.loop", "warn", "The endpoint repeated a tools/list cursor.",
        "The bounded catalog enumeration cannot determine a complete result set.", "Return each continuation cursor at most once for a single enumeration."
      )])) incompleteReason = "cursor-loop";
      break;
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  }

  if (blocked) {
    return partial(catalogReport(discovery, "blocked", { complete: false, pagesRead, toolsChecked, reason: "network-blocked" }, "incomplete", findings));
  }
  if (incompleteReason !== null) {
    return partial(catalogReport(discovery, "incomplete", { complete: false, pagesRead, toolsChecked, reason: incompleteReason }, "incomplete", findings));
  }
  if (deadline - now() <= 0) {
    return partial(catalogReport(discovery, "incomplete", { complete: false, pagesRead, toolsChecked, reason: "total-time-limit" }, "incomplete", findings));
  }
  return {
    report: catalogReport(discovery, finalStatus(findings), { complete: true, pagesRead, toolsChecked, reason: null }, "complete", findings),
    tools,
    cache
  };
}
