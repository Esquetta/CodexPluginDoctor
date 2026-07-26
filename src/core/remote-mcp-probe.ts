import {
  BoundedHttpError,
  requestBoundedHttp,
  type BoundedHttpRequestOptions,
  type BoundedHttpResponse
} from "./bounded-http-client.js";
import { RemoteNetworkPolicyError, type RemoteLookup } from "./remote-network-policy.js";
import { checkRemoteOAuthReadiness } from "./remote-oauth-readiness.js";
import {
  probeRemoteTransportReliability
} from "./remote-transport-reliability.js";
import { inspectRemoteMcpUrl } from "./remote-url-policy.js";
import type { Finding, RemoteRuntimeScorecard, RuntimeCapabilityStatus } from "../domain/types.js";
import { packageVersion } from "../version.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";

type JsonObject = Record<string, unknown>;

export type RemoteMcpRequest = (
  rawUrl: string,
  options?: BoundedHttpRequestOptions
) => Promise<BoundedHttpResponse>;

export interface RemoteMcpProbeOptions {
  allowNetwork?: boolean;
  allowLocalNetwork?: boolean;
  requestTimeoutMs?: number;
  lookup?: RemoteLookup;
  request?: RemoteMcpRequest;
  allowSessionLifecycle?: boolean;
}

export interface RemoteMcpProbeResult {
  findings: Finding[];
  scorecard: RemoteRuntimeScorecard;
}

function createScorecard(): RemoteRuntimeScorecard {
  return {
    transport: "skipped",
    networkSafety: "skipped",
    initialize: "skipped",
    contentType: "skipped",
    session: "absent",
    protocolHeaders: "skipped",
    authorization: "skipped",
    overall: "skipped"
  };
}

function failure(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string
): Finding {
  return { id, severity: "fail", message, impact, suggestedFix };
}

function finalize(
  scorecard: RemoteRuntimeScorecard,
  findings: Finding[]
): RemoteMcpProbeResult {
  scorecard.overall = findings.some((finding) => finding.severity === "fail")
    ? "fail"
    : findings.some((finding) => finding.severity === "warn")
      ? "warn"
      : scorecard.initialize === "pass" || scorecard.authorization === "pass"
        ? "pass"
        : "skipped";
  return { findings, scorecard };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function responseHeader(
  headers: BoundedHttpResponse["headers"],
  name: string
): string | null {
  const value = headers[name];
  return typeof value === "string" ? value : null;
}

function mediaType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function parseJsonObject(source: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(source);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isInitializeResponseCandidate(message: JsonObject): boolean {
  return message.id === 1;
}

function findSseInitializeResponse(body: Buffer): JsonObject | null {
  const text = body.toString("utf8").replace(/\r\n/g, "\n");
  let offset = 0;
  while (offset < text.length) {
    const boundary = text.indexOf("\n\n", offset);
    if (boundary === -1) {
      return null;
    }
    const data = text.slice(offset, boundary).split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    const message = data.length > 0 ? parseJsonObject(data.join("\n")) : null;
    if (message && isInitializeResponseCandidate(message)) {
      return message;
    }
    offset = boundary + 2;
  }
  return null;
}

function parseInitializeResponse(body: Buffer, contentType: string): JsonObject | null {
  return contentType === "text/event-stream"
    ? findSseInitializeResponse(body)
    : parseJsonObject(body.toString("utf8"));
}

function isValidInitializeResponse(message: JsonObject): boolean {
  return (
    message.jsonrpc === "2.0" &&
    message.id === 1 &&
    isPlainObject(message.result) &&
    message.result.protocolVersion === MCP_PROTOCOL_VERSION &&
    isPlainObject(message.result.capabilities) &&
    isPlainObject(message.result.serverInfo) &&
    typeof message.result.serverInfo.name === "string" &&
    typeof message.result.serverInfo.version === "string"
  );
}

function validSessionId(value: string | null): boolean {
  return value !== null && /^[\x21-\x7e]+$/.test(value);
}

function transportFailureId(error: unknown): string {
  if (error instanceof BoundedHttpError) {
    if (error.code === "REMOTE_HTTP_TIMEOUT") return "plugin.runtime.remote.transport.timeout";
    if (error.code === "REMOTE_HTTP_RESPONSE_TOO_LARGE") return "plugin.runtime.remote.transport.response_too_large";
  }
  return "plugin.runtime.remote.transport.failed";
}

function transportStatus(error: unknown): RuntimeCapabilityStatus {
  return error instanceof RemoteNetworkPolicyError
    ? "skipped"
    : "fail";
}

export async function probeRemoteMcpServer(
  serverName: string,
  rawUrl: string,
  options: RemoteMcpProbeOptions = {}
): Promise<RemoteMcpProbeResult> {
  const scorecard = createScorecard();
  const findings: Finding[] = [];
  const request = options.request ?? requestBoundedHttp;

  if (!options.allowNetwork) {
    scorecard.networkSafety = "fail";
    findings.push(failure(
      "plugin.runtime.remote.network_not_approved",
      `The remote MCP server \`${serverName}\` was not contacted because network probing is not approved.`,
      "Remote MCP initialization can create outbound network traffic and must be explicitly approved.",
      "Enable remote network probing only after reviewing the server endpoint."
    ));
    return finalize(scorecard, findings);
  }

  const inspection = inspectRemoteMcpUrl(rawUrl);
  if (inspection.issues.length > 0) {
    scorecard.networkSafety = "fail";
    findings.push(failure(
      "plugin.runtime.remote.url.invalid",
      `The remote MCP server \`${serverName}\` has an unsafe or unsupported endpoint URL.`,
      "Unsafe remote endpoint URLs can bypass network controls or expose credentials.",
      "Use an absolute HTTP or HTTPS endpoint without credentials, query parameters, fragments, or IP literals."
    ));
    return finalize(scorecard, findings);
  }

  scorecard.networkSafety = "pass";
  const initializeBody = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "Codex Plugin Doctor", version: packageVersion }
    }
  });
  let initializeResponse: BoundedHttpResponse;
  try {
    initializeResponse = await request(rawUrl, {
      allowLocalNetwork: options.allowLocalNetwork,
      lookup: options.lookup,
      timeoutMs: options.requestTimeoutMs,
      method: "POST",
      body: initializeBody,
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json"
      },
      stopAfter: (body) => findSseInitializeResponse(body) !== null
    });
  } catch (error) {
    scorecard.transport = transportStatus(error);
    if (error instanceof RemoteNetworkPolicyError) {
      scorecard.networkSafety = "fail";
    }
    findings.push(failure(
      transportFailureId(error),
      `The remote MCP server \`${serverName}\` could not complete a bounded initialize request.`,
      "A failed transport prevents safe MCP protocol negotiation.",
      "Verify the endpoint is reachable and complies with the configured remote network policy."
    ));
    return finalize(scorecard, findings);
  }

  scorecard.transport = "pass";
  if (initializeResponse.statusCode === 401) {
    const challenge = initializeResponse.headers["www-authenticate"];
    const readiness = await checkRemoteOAuthReadiness(inspection.sanitizedUrl ?? rawUrl, challenge === undefined ? [] : [challenge], {
      request,
      requestOptions: {
        allowLocalNetwork: options.allowLocalNetwork,
        lookup: options.lookup,
        timeoutMs: options.requestTimeoutMs
      }
    });
    scorecard.authorization = readiness.status;
    findings.push(...readiness.findings);
    return finalize(scorecard, findings);
  }
  if (initializeResponse.statusCode !== 200) {
    scorecard.initialize = "fail";
    findings.push(failure(
      "plugin.runtime.remote.http_status.invalid",
      `The remote MCP server \`${serverName}\` returned an unexpected initialize HTTP status.`,
      "Streamable HTTP MCP initialization requires a successful response before protocol negotiation can continue.",
      "Return HTTP 200 for initialize, or configure authorization before probing a protected endpoint."
    ));
    return finalize(scorecard, findings);
  }

  const contentType = mediaType(responseHeader(initializeResponse.headers, "content-type"));
  if (contentType !== "application/json" && contentType !== "text/event-stream") {
    scorecard.contentType = "fail";
    scorecard.initialize = "fail";
    findings.push(failure(
      "plugin.runtime.remote.content_type.invalid",
      `The remote MCP server \`${serverName}\` returned an unsupported initialize content type.`,
      "MCP initialization responses must be JSON or Server-Sent Events so the JSON-RPC result can be validated.",
      "Return application/json or text/event-stream with a JSON-RPC initialize response."
    ));
    return finalize(scorecard, findings);
  }
  scorecard.contentType = "pass";

  const sessionId = responseHeader(initializeResponse.headers, "mcp-session-id");
  if (sessionId !== null && !validSessionId(sessionId)) {
    scorecard.session = "present-invalid";
    scorecard.initialize = "fail";
    findings.push(failure(
      "plugin.runtime.remote.session.invalid",
      `The remote MCP server \`${serverName}\` returned an invalid MCP session header.`,
      "Invalid session identifiers cannot be safely replayed on the initialized notification.",
      "Return MCP-Session-Id only as visible ASCII characters."
    ));
    return finalize(scorecard, findings);
  }
  if (sessionId !== null) {
    scorecard.session = "present-valid";
  }

  const initializeMessage = parseInitializeResponse(initializeResponse.body, contentType);
  if (!initializeMessage || !isValidInitializeResponse(initializeMessage)) {
    scorecard.initialize = "fail";
    findings.push(failure(
      "plugin.runtime.remote.initialize.invalid",
      `The remote MCP server \`${serverName}\` returned an invalid initialize JSON-RPC result.`,
      "A malformed initialize result prevents protocol version negotiation.",
      "Return a JSON-RPC 2.0 result with id 1 and protocol version 2025-11-25."
    ));
    return finalize(scorecard, findings);
  }
  scorecard.initialize = "pass";

  try {
    const initializedResponse = await request(rawUrl, {
      allowLocalNetwork: options.allowLocalNetwork,
      lookup: options.lookup,
      timeoutMs: options.requestTimeoutMs,
      method: "POST",
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
        ...(sessionId === null ? {} : { "MCP-Session-Id": sessionId })
      }
    });
    if (initializedResponse.statusCode < 200 || initializedResponse.statusCode >= 300) {
      scorecard.protocolHeaders = "fail";
      findings.push(failure(
        "plugin.runtime.remote.initialized.failed",
        `The remote MCP server \`${serverName}\` did not acknowledge the initialized notification.`,
        "The MCP session may not be ready for subsequent protocol traffic.",
        "Accept a successful HTTP response to notifications/initialized at the same MCP endpoint."
      ));
      return finalize(scorecard, findings);
    }
  } catch {
    scorecard.protocolHeaders = "fail";
    findings.push(failure(
      "plugin.runtime.remote.initialized.failed",
      `The remote MCP server \`${serverName}\` could not receive the initialized notification.`,
      "The MCP session may not be ready for subsequent protocol traffic.",
      "Accept a successful HTTP response to notifications/initialized at the same MCP endpoint."
    ));
    return finalize(scorecard, findings);
  }

  scorecard.protocolHeaders = "pass";
  const reliability = await probeRemoteTransportReliability({
    rawUrl,
    protocolVersion: MCP_PROTOCOL_VERSION,
    request,
    requestTimeoutMs: options.requestTimeoutMs,
    requestOptions: {
      allowLocalNetwork: options.allowLocalNetwork,
      lookup: options.lookup
    },
    sessionId,
    allowSessionLifecycle: options.allowSessionLifecycle,
    reinitialize: async (requestWithinBudget) => {
      const restartInitialize = await requestWithinBudget({
        method: "POST",
        body: initializeBody,
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json"
        },
        stopAfter: (body) => findSseInitializeResponse(body) !== null
      });
      if (restartInitialize.statusCode !== 200) {
        throw new Error("restart initialize failed");
      }
      const restartContentType = mediaType(responseHeader(restartInitialize.headers, "content-type"));
      if (restartContentType !== "application/json" && restartContentType !== "text/event-stream") {
        throw new Error("restart initialize content type invalid");
      }
      const replacementSessionId = responseHeader(restartInitialize.headers, "mcp-session-id");
      if (replacementSessionId !== null && !validSessionId(replacementSessionId)) {
        throw new Error("restart session invalid");
      }
      const restartMessage = parseInitializeResponse(restartInitialize.body, restartContentType);
      if (!restartMessage || !isValidInitializeResponse(restartMessage)) {
        throw new Error("restart initialize result invalid");
      }
      const restartInitialized = await requestWithinBudget({
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "MCP-Protocol-Version": MCP_PROTOCOL_VERSION,
          ...(replacementSessionId === null ? {} : { "MCP-Session-Id": replacementSessionId })
        }
      });
      if (restartInitialized.statusCode < 200 || restartInitialized.statusCode >= 300) {
        throw new Error("restart initialized failed");
      }
      return replacementSessionId;
    }
  });
  scorecard.reliability = reliability.scorecard;
  findings.push(...reliability.findings);
  return finalize(scorecard, findings);
}
