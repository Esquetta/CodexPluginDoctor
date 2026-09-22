import {
  BoundedHttpError,
  requestBoundedHttp,
  type BoundedHttpResponse
} from "./bounded-http-client.js";
import { RemoteNetworkPolicyError, type RemoteLookup } from "./remote-network-policy.js";
import type { RemoteMcpRequest } from "./remote-mcp-probe.js";
import { inspectRemoteMcpUrl } from "./remote-url-policy.js";
import type { Finding } from "../domain/types.js";
import { packageVersion } from "../version.js";

const REQUESTED_VERSION = "2026-07-28";
const REQUEST_ID = "discover-1";
type JsonObject = Record<string, unknown>;

export interface McpDiscoveryOptions {
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  requestTimeoutMs?: number;
  lookup?: RemoteLookup;
  request?: RemoteMcpRequest;
}

export interface McpDiscoveryReport {
  schemaVersion: 1;
  requestedVersion: "2026-07-28";
  scope: "discovery-only";
  status: "discovered" | "unsupported" | "blocked" | "failed";
  supportedVersions: string[];
  findings: Finding[];
  coverage: { discovery: "pass" | "fail" | "skipped"; runtime: "not-tested" };
}

function finding(id: string, severity: Finding["severity"], message: string, impact: string, suggestedFix: string): Finding {
  return { id, severity, message, impact, suggestedFix };
}

function report(status: McpDiscoveryReport["status"], discovery: McpDiscoveryReport["coverage"]["discovery"], findings: Finding[] = [], supportedVersions: string[] = []): McpDiscoveryReport {
  return { schemaVersion: 1, requestedVersion: REQUESTED_VERSION, scope: "discovery-only", status, supportedVersions, findings, coverage: { discovery, runtime: "not-tested" } };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(source: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(source);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function mediaType(response: BoundedHttpResponse): string | null {
  const contentType = response.headers["content-type"];
  const value = Array.isArray(contentType) ? contentType[0] : contentType;
  return typeof value === "string" ? value.split(";", 1)[0]?.trim().toLowerCase() ?? null : null;
}

function findSseResponse(body: Buffer): JsonObject | null {
  const text = body.toString("utf8").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let offset = 0;
  while (offset < text.length) {
    const boundary = text.indexOf("\n\n", offset);
    if (boundary === -1) return null;
    const data = text.slice(offset, boundary).split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    const candidate = data.length === 0 ? null : parseJsonObject(data.join("\n"));
    if (candidate?.id === REQUEST_ID) return candidate;
    offset = boundary + 2;
  }
  return null;
}

function parseResponse(response: BoundedHttpResponse): JsonObject | null {
  const contentType = mediaType(response);
  return contentType === "application/json" ? parseJsonObject(response.body.toString("utf8"))
    : contentType === "text/event-stream" ? findSseResponse(response.body)
      : null;
}

function isValidVersion(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function validVersions(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 32 && value.every(isValidVersion) && new Set(value).size === value.length;
}

function hasMatchingResponseEnvelope(message: JsonObject): boolean {
  return message.jsonrpc === "2.0" && message.id === REQUEST_ID
    && Object.hasOwn(message, "result") !== Object.hasOwn(message, "error");
}

function validDiscoverResult(value: unknown): value is JsonObject & { supportedVersions: string[] } {
  return isPlainObject(value) && value.resultType === "complete" && validVersions(value.supportedVersions)
    && validCapabilities(value.capabilities) && typeof value.ttlMs === "number" && Number.isFinite(value.ttlMs) && value.ttlMs >= 0
    && (value.cacheScope === "public" || value.cacheScope === "private") && validOptionalServerInfo(value);
}


function validCapabilities(value: unknown): value is JsonObject {
  return isPlainObject(value) && ["tools", "resources", "prompts", "completions", "logging", "tasks", "extensions"]
    .every((name) => !Object.hasOwn(value, name) || isPlainObject(value[name]));
}
function validOptionalServerInfo(value: JsonObject): boolean {
  if (!Object.hasOwn(value, "_meta")) return true;
  if (!isPlainObject(value._meta)) return false;
  const serverInfo = value._meta["io.modelcontextprotocol/serverInfo"];
  return serverInfo === undefined || (isPlainObject(serverInfo) && typeof serverInfo.name === "string" && typeof serverInfo.version === "string");
}

function validError(value: unknown): value is JsonObject & { code: number; message: string } {
  return isPlainObject(value) && typeof value.code === "number" && Number.isFinite(value.code) && typeof value.message === "string";
}

function unsupportedVersions(error: unknown): string[] | null {
  if (!validError(error) || error.code !== -32022 || !isPlainObject(error.data)) return null;
  return error.data.requested === REQUESTED_VERSION && validVersions(error.data.supported) ? error.data.supported : null;
}

function failureReport(id: string, message: string): McpDiscoveryReport {
  return report("failed", "fail", [finding(id, "fail", message, "The discovery response cannot safely establish modern MCP discovery support.", "Verify the endpoint returns a valid server/discover response for the requested protocol version.")]);
}

function unsupportedReport(id: string, message: string, versions: string[] = []): McpDiscoveryReport {
  return report("unsupported", "skipped", [finding(id, "warn", message, "Discovery-only probing cannot establish support for the requested MCP protocol version.", "Configure a server that supports the requested protocol version, then run discovery again.")], versions);
}

export async function discoverMcpServer(rawUrl: string, options: McpDiscoveryOptions = {}): Promise<McpDiscoveryReport> {
  if (!options.allowNetwork) {
    return report("blocked", "skipped", [finding("plugin.discovery.network_not_approved", "warn", "Remote MCP discovery was not contacted because network access is not approved.", "Discovery would create outbound network traffic without explicit approval.", "Enable network access only after reviewing the endpoint.")]);
  }
  if (inspectRemoteMcpUrl(rawUrl).issues.length > 0) {
    return report("blocked", "skipped", [finding("plugin.discovery.url.invalid", "warn", "The MCP discovery endpoint is unsafe or unsupported.", "Unsafe endpoint URLs can bypass network controls or expose credentials.", "Use an absolute HTTP or HTTPS endpoint without credentials, query parameters, fragments, or IP literals.")]);
  }

  const request = options.request ?? requestBoundedHttp;
  const body = JSON.stringify({ jsonrpc: "2.0", id: REQUEST_ID, method: "server/discover", params: { _meta: {
    "io.modelcontextprotocol/protocolVersion": REQUESTED_VERSION,
    "io.modelcontextprotocol/clientInfo": { name: "Codex Plugin Doctor", version: packageVersion },
    "io.modelcontextprotocol/clientCapabilities": {}
  } } });
  let response: BoundedHttpResponse;
  try {
    response = await request(rawUrl, {
      allowLocalNetwork: options.allowLocalNetwork, lookup: options.lookup, timeoutMs: options.requestTimeoutMs,
      method: "POST", body,
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": REQUESTED_VERSION, "Mcp-Method": "server/discover" },
      stopAfter: (received) => findSseResponse(received) !== null
    });
  } catch (error) {
    if (error instanceof RemoteNetworkPolicyError) {
      return report("blocked", "skipped", [finding("plugin.discovery.network.blocked", "warn", "The MCP discovery target is blocked by the remote network policy.", "Discovery could not safely reach the configured target.", "Use an endpoint permitted by the remote network policy.")]);
    }
    return failureReport(error instanceof BoundedHttpError && error.code === "REMOTE_HTTP_TIMEOUT" ? "plugin.discovery.transport.timeout" : "plugin.discovery.transport.failed", "The MCP discovery request did not complete within the configured transport bounds.");
  }

  if (response.statusCode === 401 || response.statusCode === 403) {
    return unsupportedReport("plugin.discovery.authorization.required", "The MCP endpoint requires authorization before discovery can be assessed.");
  }
  const message = parseResponse(response);
  if (!message || !hasMatchingResponseEnvelope(message)) return failureReport("plugin.discovery.response.invalid", "The MCP endpoint returned an invalid discovery response.");
  if (Object.hasOwn(message, "error")) {
    if (!validError(message.error)) return failureReport("plugin.discovery.response.error", "The MCP endpoint returned an invalid discovery error.");
    const versions = unsupportedVersions(message.error);
    if (versions !== null && response.statusCode === 400) return unsupportedReport("plugin.discovery.protocol_version.unsupported", "The MCP endpoint does not support the requested protocol version.", versions);
    if (message.error.code === -32601 && (response.statusCode === 200 || response.statusCode === 404)) return unsupportedReport("plugin.discovery.method.unsupported", "The MCP endpoint does not implement server discovery for this protocol version.");
    return failureReport("plugin.discovery.response.error", "The MCP endpoint returned an unrecognized discovery error.");
  }
  if (response.statusCode !== 200 || !validDiscoverResult(message.result)) return failureReport("plugin.discovery.result.invalid", "The MCP endpoint returned an invalid discovery result.");
  const versions = message.result.supportedVersions;
  if (!versions.includes(REQUESTED_VERSION)) return unsupportedReport("plugin.discovery.protocol_version.inconsistent", "The MCP endpoint completed discovery without listing the requested protocol version.", versions);
  return report("discovered", "pass", [], versions);
}
