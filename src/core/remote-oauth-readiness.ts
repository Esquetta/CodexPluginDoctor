import { isIP } from "node:net";

import {
  requestBoundedHttp,
  type BoundedHttpRequestOptions,
  type BoundedHttpResponse
} from "./bounded-http-client.js";
import type { Finding } from "../domain/types.js";

type JsonObject = Record<string, unknown>;

export type RemoteOAuthReadinessRequest = (
  rawUrl: string,
  options?: BoundedHttpRequestOptions
) => Promise<BoundedHttpResponse>;

export interface RemoteOAuthReadinessOptions {
  request?: RemoteOAuthReadinessRequest;
  requestOptions?: Pick<BoundedHttpRequestOptions, "allowLocalNetwork" | "lookup" | "timeoutMs">;
}

export interface RemoteOAuthReadinessResult {
  status: "pass" | "fail";
  findings: Finding[];
}

type MetadataReply =
  | { kind: "ok"; metadata: JsonObject }
  | { kind: "invalid" }
  | { kind: "not-found" }
  | { kind: "unavailable" };

const MAX_DISCOVERY_CANDIDATES = 4;
const MAX_DISCOVERY_TIMEOUT_MS = 3_000;

function failure(id: string): RemoteOAuthReadinessResult {
  return {
    status: "fail",
    findings: [{
      id,
      severity: "fail",
      message: "The remote MCP server authorization metadata could not be validated.",
      impact: "Protected MCP endpoints cannot be safely assessed without valid OAuth discovery metadata.",
      suggestedFix: "Publish valid HTTPS protected-resource and authorization-server metadata without credentials, queries, or fragments."
    }]
  };
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mediaType(headers: BoundedHttpResponse["headers"]): string | null {
  const value = headers["content-type"];
  const source = Array.isArray(value) ? value[0] : value;
  return typeof source === "string" ? source.split(";", 1)[0]?.trim().toLowerCase() ?? null : null;
}

function parseJsonObject(body: Buffer): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(body.toString("utf8"));
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.hostname.startsWith("[") ||
      isIP(url.hostname) !== 0
    ) {
      return null;
    }
    return value;
  } catch {
    return null;
  }
}

function insertWellKnown(resourceUrl: string, suffix: string): string {
  const url = new URL(resourceUrl);
  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/$/, "");
  return `${url.origin}/.well-known/${suffix}${path}`;
}

function oidcDiscoveryUrl(issuer: string): string {
  const url = new URL(issuer);
  return `${url.origin}${url.pathname.replace(/\/$/, "")}/.well-known/openid-configuration`;
}

function splitTopLevelCommas(value: string): string[] | null {
  const parts: string[] = [];
  let start = 0;
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quoted && character === "\\") {
      index += 1;
      if (index >= value.length) return null;
      continue;
    }
    if (character === "\"") {
      quoted = !quoted;
      continue;
    }
    if (!quoted && character === ",") {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }

  return quoted ? null : [...parts, value.slice(start)];
}

function parseAuthParam(value: string): { name: string; value: string } | null {
  const match = /^([!#$%&'*+.^`|~\w-]+)[ \t]*=[ \t]*(.*)$/.exec(value);
  if (match === null) return null;

  const name = match[1]!;
  const rawValue = match[2]!.trim();
  if (rawValue.length === 0) return null;
  if (!rawValue.startsWith("\"")) {
    return /[\s"]/u.test(rawValue) ? null : { name, value: rawValue };
  }
  if (!rawValue.endsWith("\"") || rawValue.length === 1) return null;

  let decoded = "";
  for (let index = 1; index < rawValue.length - 1; index += 1) {
    const character = rawValue[index]!;
    if (character === "\\") {
      index += 1;
      if (index >= rawValue.length - 1) return null;
      decoded += rawValue[index]!;
      continue;
    }
    if (character === "\"") return null;
    decoded += character;
  }
  return { name, value: decoded };
}

function parseChallenge(value: string): { scheme: string; parameter: { name: string; value: string } | null } | null {
  const match = /^([!#$%&'*+.^`|~\w-]+)(?:[ \t]+(.*))?$/.exec(value);
  if (match === null) return null;

  const scheme = match[1]!;
  const credentials = match[2];
  if (credentials === undefined || credentials.trim().length === 0) return { scheme, parameter: null };
  const parameter = parseAuthParam(credentials);
  if (parameter !== null) return { scheme, parameter };
  return /^[A-Za-z0-9\-._~+/]+={0,}$/.test(credentials) ? { scheme, parameter: null } : null;
}

function parseBearerResourceMetadata(headers: Array<string | string[]>): { specified: boolean; values: string[] } | null {
  const values: string[] = [];
  let specified = false;
  for (const header of headers.flatMap((value) => Array.isArray(value) ? value : [value])) {
    const parts = splitTopLevelCommas(header);
    if (parts === null) return null;

    let scheme: string | null = null;
    for (const part of parts) {
      const token = part.trim();
      if (token.length === 0) return null;

      const parameter = parseAuthParam(token);
      if (parameter !== null) {
        if (scheme === null) return null;
        if (scheme.toLowerCase() === "bearer" && parameter.name.toLowerCase() === "resource_metadata") {
          specified = true;
          values.push(parameter.value);
        }
        continue;
      }

      const challenge = parseChallenge(token);
      if (challenge === null) return null;
      scheme = challenge.scheme;
      if (scheme.toLowerCase() === "bearer" && challenge.parameter?.name.toLowerCase() === "resource_metadata") {
        specified = true;
        values.push(challenge.parameter.value);
      }
    }
  }
  return { specified, values };
}

async function fetchMetadata(
  url: string,
  request: RemoteOAuthReadinessRequest,
  requestOptions: RemoteOAuthReadinessOptions["requestOptions"],
  deadline: number
): Promise<MetadataReply> {
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return { kind: "unavailable" };

  let timeout: NodeJS.Timeout | undefined;
  try {
    const response = await Promise.race([
      request(url, {
        ...requestOptions,
        timeoutMs: Math.max(1, Math.floor(remainingMs)),
        method: "GET",
        headers: { Accept: "application/json" }
      }),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("OAuth discovery timed out.")), remainingMs);
      })
    ]);
    if (response.statusCode === 404) return { kind: "not-found" };
    if (response.statusCode !== 200 || mediaType(response.headers) !== "application/json") {
      return { kind: "unavailable" };
    }
    const metadata = parseJsonObject(response.body);
    return metadata === null ? { kind: "invalid" } : { kind: "ok", metadata };
  } catch {
    return { kind: "unavailable" };
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function validProtectedResourceMetadata(metadata: JsonObject, resourceUrl: string): string[] | null {
  if (metadata.resource !== resourceUrl || !Array.isArray(metadata.authorization_servers) || metadata.authorization_servers.length === 0) {
    return null;
  }
  const issuers = metadata.authorization_servers.map(safeHttpsUrl);
  if (!issuers.every((issuer): issuer is string => issuer !== null)) return null;
  const uniqueIssuers = [...new Set(issuers)];
  return uniqueIssuers.length <= MAX_DISCOVERY_CANDIDATES ? uniqueIssuers : null;
}

function validAuthorizationServerMetadata(metadata: JsonObject, issuer: string): boolean {
  return (
    metadata.issuer === issuer &&
    safeHttpsUrl(metadata.authorization_endpoint) !== null &&
    safeHttpsUrl(metadata.token_endpoint) !== null
  );
}

async function authorizationServerIsReady(
  issuer: string,
  request: RemoteOAuthReadinessRequest,
  requestOptions: RemoteOAuthReadinessOptions["requestOptions"],
  deadline: number
): Promise<"pass" | "invalid" | "unavailable"> {
  const rfc8414 = await fetchMetadata(insertWellKnown(issuer, "oauth-authorization-server"), request, requestOptions, deadline);
  if (rfc8414.kind === "ok") return validAuthorizationServerMetadata(rfc8414.metadata, issuer) ? "pass" : "invalid";
  if (rfc8414.kind === "unavailable") return "unavailable";

  const oidcUrls = [...new Set([
    insertWellKnown(issuer, "openid-configuration"),
    oidcDiscoveryUrl(issuer)
  ])];
  for (const oidcUrl of oidcUrls) {
    const oidc = await fetchMetadata(oidcUrl, request, requestOptions, deadline);
    if (oidc.kind === "ok") return validAuthorizationServerMetadata(oidc.metadata, issuer) ? "pass" : "invalid";
    if (oidc.kind === "unavailable") return "unavailable";
  }
  return "invalid";
}

export async function checkRemoteOAuthReadiness(
  resourceUrl: string,
  wwwAuthenticate: Array<string | string[]>,
  options: RemoteOAuthReadinessOptions = {}
): Promise<RemoteOAuthReadinessResult> {
  const request = options.request ?? requestBoundedHttp;
  const explicit = parseBearerResourceMetadata(wwwAuthenticate);
  if (explicit === null) return failure("plugin.runtime.remote.authorization.metadata.invalid");
  const metadataCandidates = explicit.specified
    ? explicit.values.map(safeHttpsUrl)
    : [
      insertWellKnown(resourceUrl, "oauth-protected-resource"),
      `${new URL(resourceUrl).origin}/.well-known/oauth-protected-resource`
    ].map(safeHttpsUrl);
  if (!metadataCandidates.every((url): url is string => url !== null)) {
    return failure("plugin.runtime.remote.authorization.metadata.invalid");
  }
  const metadataUrls = [...new Set(metadataCandidates)];
  if (metadataUrls.length > MAX_DISCOVERY_CANDIDATES) return failure("plugin.runtime.remote.authorization.metadata.invalid");
  const suppliedTimeoutMs = options.requestOptions?.timeoutMs;
  const timeoutMs = typeof suppliedTimeoutMs === "number" && Number.isFinite(suppliedTimeoutMs)
    ? Math.max(0, Math.min(suppliedTimeoutMs, MAX_DISCOVERY_TIMEOUT_MS))
    : MAX_DISCOVERY_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;

  let issuers: string[] | null = null;
  let protectedMetadataFetchedInvalid = false;
  let protectedMetadataUnavailable = false;
  for (const metadataUrl of metadataUrls) {
    const reply = await fetchMetadata(metadataUrl, request, options.requestOptions, deadline);
    if (reply.kind === "ok") {
      const candidateIssuers = validProtectedResourceMetadata(reply.metadata, resourceUrl);
      if (candidateIssuers !== null) {
        issuers = candidateIssuers;
        break;
      }
      protectedMetadataFetchedInvalid = true;
      if (!explicit.specified) return failure("plugin.runtime.remote.authorization.metadata.invalid");
      continue;
    }
    if (reply.kind === "invalid") {
      protectedMetadataFetchedInvalid = true;
      if (!explicit.specified) return failure("plugin.runtime.remote.authorization.metadata.invalid");
      continue;
    }
    protectedMetadataUnavailable = true;
    if (!explicit.specified && reply.kind === "unavailable") {
      return failure("plugin.runtime.remote.authorization.metadata.unavailable");
    }
  }
  if (issuers === null) return failure(protectedMetadataFetchedInvalid
    ? "plugin.runtime.remote.authorization.metadata.invalid"
    : protectedMetadataUnavailable
    ? "plugin.runtime.remote.authorization.metadata.unavailable"
    : "plugin.runtime.remote.authorization.metadata.invalid");

  let unavailable = false;
  for (const issuer of issuers) {
    const readiness = await authorizationServerIsReady(issuer, request, options.requestOptions, deadline);
    if (readiness === "pass") return { status: "pass", findings: [] };
    unavailable ||= readiness === "unavailable";
  }
  return failure(unavailable
    ? "plugin.runtime.remote.authorization.metadata.unavailable"
    : "plugin.runtime.remote.authorization.metadata.invalid");
}
