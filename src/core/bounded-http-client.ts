import * as http from "node:http";
import * as https from "node:https";
import { BlockList, isIP } from "node:net";

import { resolveRemoteTarget, type RemoteLookup, type ResolvedRemoteTarget } from "./remote-network-policy.js";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_RESPONSE_BYTES = 1_024 * 1_024;
const allowedRequestHeaders = new Set([
  "accept",
  "content-type",
  "mcp-protocol-version",
  "mcp-session-id",
  "user-agent"
]);
const safeResponseHeaders = new Set([
  "content-type",
  "www-authenticate",
  "mcp-session-id",
  "mcp-protocol-version",
  "location"
]);

export interface BoundedHttpRequestOptions {
  allowLocalNetwork?: boolean;
  lookup?: RemoteLookup;
  timeoutMs?: number;
  maxResponseBytes?: number;
  method?: string;
  body?: string | Buffer;
  headers?: Record<string, string | undefined>;
  stopAfter?: (body: Buffer) => boolean;
}

export interface BoundedHttpResponse {
  statusCode: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

export class BoundedHttpError extends Error {
  constructor(
    readonly code:
      | "REMOTE_HTTP_ENCODING_UNSUPPORTED"
      | "REMOTE_HTTP_HEADER_FORBIDDEN"
      | "REMOTE_HTTP_OPTIONS_INVALID"
      | "REMOTE_HTTP_PEER_MISMATCH"
      | "REMOTE_HTTP_REDIRECT"
      | "REMOTE_HTTP_REQUEST_FAILED"
      | "REMOTE_HTTP_RESPONSE_TOO_LARGE"
      | "REMOTE_HTTP_STOP_CONDITION_FAILED"
      | "REMOTE_HTTP_TIMEOUT"
      | "REMOTE_HTTP_URL_CREDENTIALS"
      | "REMOTE_HTTP_URL_UNSUPPORTED",
    message: string,
    readonly statusCode?: number,
    readonly headers?: Record<string, string | string[]>
  ) {
    super(message);
    this.name = "BoundedHttpError";
  }
}

function validateHeaders(headers: BoundedHttpRequestOptions["headers"]): Record<string, string> {
  const validated: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined) {
      continue;
    }

    const normalizedName = name.toLowerCase();
    if (!allowedRequestHeaders.has(normalizedName)) {
      throw new BoundedHttpError(
        "REMOTE_HTTP_HEADER_FORBIDDEN",
        `Remote HTTP request header is not allowed: ${normalizedName}.`
      );
    }
    if (normalizedName in validated || typeof value !== "string") {
      throw new BoundedHttpError(
        "REMOTE_HTTP_HEADER_FORBIDDEN",
        `Remote HTTP request header must be a single valid string: ${normalizedName}.`
      );
    }
    try {
      http.validateHeaderValue(normalizedName, value);
    } catch {
      throw new BoundedHttpError(
        "REMOTE_HTTP_HEADER_FORBIDDEN",
        `Remote HTTP request header must be a single valid string: ${normalizedName}.`
      );
    }
    validated[normalizedName] = value;
  }
  return validated;
}

function validateOptions(options: BoundedHttpRequestOptions): {
  timeoutMs: number;
  maxResponseBytes: number;
} {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DEFAULT_TIMEOUT_MS
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > DEFAULT_MAX_RESPONSE_BYTES) {
    throw new BoundedHttpError(
      "REMOTE_HTTP_OPTIONS_INVALID",
      "Remote HTTP request options are invalid."
    );
  }
  return { timeoutMs, maxResponseBytes };
}

async function resolveWithinDeadline(
  url: URL,
  options: BoundedHttpRequestOptions,
  timeoutMs: number
): Promise<ResolvedRemoteTarget> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      resolveRemoteTarget(url, {
        allowLocalNetwork: options.allowLocalNetwork,
        lookup: options.lookup
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "Remote HTTP request timed out."));
        }, timeoutMs);
      })
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

function selectSafeHeaders(headers: http.IncomingHttpHeaders): Record<string, string | string[]> {
  const selected: Record<string, string | string[]> = {};
  for (const name of safeResponseHeaders) {
    const value = headers[name];
    if (value !== undefined) {
      selected[name] = value;
    }
  }
  return selected;
}

function hasIdentityContentEncoding(headers: http.IncomingHttpHeaders): boolean {
  const value = headers["content-encoding"];
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.every((entry) => entry.toLowerCase() === "identity");
}

function matchesTargetPeer(target: ResolvedRemoteTarget, remoteAddress: string | undefined): boolean {
  if (remoteAddress === undefined || isIP(remoteAddress) === 0) {
    return false;
  }

  const peers = new BlockList();
  peers.addAddress(target.address, target.family === 4 ? "ipv4" : "ipv6");
  if (target.family === 4) {
    peers.addAddress(`::ffff:${target.address}`, "ipv6");
  }

  return peers.check(remoteAddress, isIP(remoteAddress) === 4 ? "ipv4" : "ipv6");
}

export async function requestBoundedHttp(
  rawUrl: string,
  options: BoundedHttpRequestOptions = {}
): Promise<BoundedHttpResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BoundedHttpError("REMOTE_HTTP_URL_UNSUPPORTED", "Remote HTTP URL must be absolute HTTP or HTTPS.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BoundedHttpError("REMOTE_HTTP_URL_UNSUPPORTED", "Remote HTTP URL must be absolute HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new BoundedHttpError("REMOTE_HTTP_URL_CREDENTIALS", "Remote HTTP URL must not include credentials.");
  }

  const { timeoutMs, maxResponseBytes } = validateOptions(options);
  const headers = validateHeaders(options.headers);
  const deadline = Date.now() + timeoutMs;
  const target = await resolveWithinDeadline(url, options, timeoutMs);
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) {
    throw new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "Remote HTTP request timed out.");
  }
  const transport = url.protocol === "https:" ? https : http;

  return new Promise<BoundedHttpResponse>((resolve, reject) => {
    let request: http.ClientRequest | undefined;
    let response: http.IncomingMessage | undefined;
    let settled = false;
    const timeout = setTimeout(() => {
      fail(new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "Remote HTTP request timed out."));
    }, remainingMs);

    const fail = (error: Error): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      response?.destroy();
      request?.destroy();
      reject(error);
    };

    const complete = (body: Buffer): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      response?.destroy();
      request?.destroy();
      resolve({
        statusCode: response?.statusCode ?? 0,
        headers: response ? selectSafeHeaders(response.headers) : {},
        body
      });
    };

    try {
      request = transport.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method: options.method ?? "GET",
        headers,
        agent: false,
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) {
            callback(null, [{ address: target.address, family: target.family }]);
            return;
          }
          callback(null, target.address, target.family);
        }
      });
    } catch {
      fail(new BoundedHttpError("REMOTE_HTTP_REQUEST_FAILED", "Remote HTTP request failed."));
      return;
    }

    request.once("error", () => {
      fail(new BoundedHttpError("REMOTE_HTTP_REQUEST_FAILED", "Remote HTTP request failed."));
    });
    request.once("response", (incoming) => {
      response = incoming;
      const safeHeaders = selectSafeHeaders(incoming.headers);

      if (!matchesTargetPeer(target, incoming.socket.remoteAddress)) {
        fail(new BoundedHttpError("REMOTE_HTTP_PEER_MISMATCH", "Remote HTTP peer did not match the resolved target."));
        return;
      }
      if ((incoming.statusCode ?? 0) >= 300 && (incoming.statusCode ?? 0) < 400) {
        fail(new BoundedHttpError(
          "REMOTE_HTTP_REDIRECT",
          "Remote HTTP redirects are not allowed.",
          incoming.statusCode,
          safeHeaders
        ));
        return;
      }
      if (!hasIdentityContentEncoding(incoming.headers)) {
        fail(new BoundedHttpError(
          "REMOTE_HTTP_ENCODING_UNSUPPORTED",
          "Remote HTTP response content encoding must be identity."
        ));
        return;
      }

      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      incoming.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        if (receivedBytes > maxResponseBytes) {
          fail(new BoundedHttpError(
            "REMOTE_HTTP_RESPONSE_TOO_LARGE",
            "Remote HTTP response exceeded the configured size limit."
          ));
          return;
        }
        chunks.push(chunk);
        const body = Buffer.concat(chunks);
        let shouldStop: boolean;
        try {
          shouldStop = options.stopAfter?.(body) ?? false;
        } catch {
          fail(new BoundedHttpError(
            "REMOTE_HTTP_STOP_CONDITION_FAILED",
            "Remote HTTP stop condition failed."
          ));
          return;
        }
        if (shouldStop) {
          complete(body);
          return;
        }
      });
      incoming.once("error", () => {
        fail(new BoundedHttpError("REMOTE_HTTP_REQUEST_FAILED", "Remote HTTP request failed."));
      });
      incoming.once("end", () => {
        if (!settled) {
          complete(Buffer.concat(chunks));
        }
      });
    });
    request.end(options.body);
  });
}
