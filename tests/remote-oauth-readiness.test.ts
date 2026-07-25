import { describe, expect, it, vi } from "vitest";

import { BoundedHttpError, type BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import {
  checkRemoteOAuthReadiness,
  type RemoteOAuthReadinessRequest
} from "../src/core/remote-oauth-readiness.js";

const resourceUrl = "https://mcp.example/v1/mcp";
const resourceMetadataUrl = "https://mcp.example/.well-known/oauth-protected-resource/v1/mcp";
const rootResourceMetadataUrl = "https://mcp.example/.well-known/oauth-protected-resource";
const issuer = "https://auth.example/tenant";
const authorizationMetadataUrl = "https://auth.example/.well-known/oauth-authorization-server/tenant";
const oidcMetadataUrl = "https://auth.example/tenant/.well-known/openid-configuration";

function json(body: unknown, statusCode = 200): BoundedHttpResponse {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: Buffer.from(JSON.stringify(body))
  };
}

function response(statusCode: number, contentType = "application/json", body = ""): BoundedHttpResponse {
  return { statusCode, headers: { "content-type": contentType }, body: Buffer.from(body) };
}

function protectedMetadata(authorizationServers: unknown = [issuer]): BoundedHttpResponse {
  return json({ resource: resourceUrl, authorization_servers: authorizationServers });
}

function authorizationMetadata(values: Record<string, unknown> = {}): BoundedHttpResponse {
  return json({
    issuer,
    authorization_endpoint: "https://auth.example/authorize",
    token_endpoint: "https://auth.example/token",
    ...values
  });
}

function requestFrom(
  replies: Record<string, BoundedHttpResponse | Error>
): { request: RemoteOAuthReadinessRequest; calls: Array<{ url: string; options: unknown }> } {
  const calls: Array<{ url: string; options: unknown }> = [];
  return {
    calls,
    request: async (url, options) => {
      calls.push({ url, options });
      const reply = replies[url];
      if (reply === undefined) throw new Error("unexpected request");
      if (reply instanceof Error) throw reply;
      return reply;
    }
  };
}

function assertPrivate(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const sentinel of [
    "challenge-secret-sentinel",
    "scope-secret-sentinel",
    "query-secret-sentinel",
    "token-secret-sentinel",
    "session-secret-sentinel"
  ]) {
    expect(serialized).not.toContain(sentinel);
  }
}

describe("checkRemoteOAuthReadiness", () => {
  it("accepts quoted Bearer resource metadata within multiple challenges without sending credentials", async () => {
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata(),
      [authorizationMetadataUrl]: authorizationMetadata()
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [
      'Basic realm="challenge-secret-sentinel", bEaReR scope="scope-secret-sentinel", resource_metadata="https://mcp.example/.well-known/oauth-protected-resource/v1/mcp"'
    ], { request });

    expect(result).toEqual({ status: "pass", findings: [] });
    expect(calls.map((call) => call.url)).toEqual([resourceMetadataUrl, authorizationMetadataUrl]);
    for (const call of calls) {
      expect(call.options).toMatchObject({ method: "GET", headers: { Accept: "application/json" } });
      expect(JSON.stringify(call.options)).not.toMatch(/authorization|cookie|proxy-authorization/i);
    }
    assertPrivate(result);
  });

  it("tries endpoint-specific resource metadata before the root fallback", async () => {
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: response(404),
      [rootResourceMetadataUrl]: protectedMetadata(),
      [authorizationMetadataUrl]: authorizationMetadata()
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result.status).toBe("pass");
    expect(calls.map((call) => call.url)).toEqual([
      resourceMetadataUrl,
      rootResourceMetadataUrl,
      authorizationMetadataUrl
    ]);
  });

  it("refuses HTTP metadata discovery even when an injected request could reach localhost", async () => {
    let requested = false;

    const result = await checkRemoteOAuthReadiness("http://localhost:8080/mcp", [], {
      request: async () => {
        requested = true;
        throw new Error("must not request");
      }
    });

    expect(result.status).toBe("fail");
    expect(requested).toBe(false);
  });

  it("fails closed when protected-resource metadata omits authorization servers", async () => {
    const { request } = requestFrom({ [resourceMetadataUrl]: protectedMetadata([]) });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result).toEqual(expect.objectContaining({
      status: "fail",
      findings: [expect.objectContaining({ id: "plugin.runtime.remote.authorization.metadata.invalid", severity: "fail" })]
    }));
  });

  it("uses a later advertised issuer when earlier issuer metadata is invalid", async () => {
    const secondIssuer = "https://auth-two.example/issuer";
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata([issuer, secondIssuer]),
      [authorizationMetadataUrl]: response(404),
      [oidcMetadataUrl]: response(404),
      "https://auth-two.example/.well-known/oauth-authorization-server/issuer": json({
        issuer: secondIssuer,
        authorization_endpoint: "https://auth-two.example/authorize",
        token_endpoint: "https://auth-two.example/token"
      })
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result).toEqual({ status: "pass", findings: [] });
    expect(calls.map((call) => call.url)).toEqual([
      resourceMetadataUrl,
      authorizationMetadataUrl,
      oidcMetadataUrl,
      "https://auth-two.example/.well-known/oauth-authorization-server/issuer"
    ]);
  });

  it("tries OIDC discovery after RFC 8414 authorization metadata", async () => {
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata(),
      [authorizationMetadataUrl]: response(404),
      [oidcMetadataUrl]: authorizationMetadata()
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result.status).toBe("pass");
    expect(calls.map((call) => call.url)).toEqual([
      resourceMetadataUrl,
      authorizationMetadataUrl,
      oidcMetadataUrl
    ]);
  });

  it.each([
    ["a resource mismatch", protectedMetadata(), authorizationMetadata(), { resource: "https://mcp.example/other", authorization_servers: [issuer] }],
    ["an issuer mismatch", protectedMetadata(), authorizationMetadata({ issuer: "https://auth.example/other" }), undefined],
    ["an unsafe authorization endpoint", protectedMetadata(), authorizationMetadata({ authorization_endpoint: "http://auth.example/authorize" }), undefined],
    ["an unsafe token endpoint", protectedMetadata(), authorizationMetadata({ token_endpoint: "https://127.0.0.1/token" }), undefined]
  ])("fails closed for %s", async (_name, protectedResponse, serverResponse, replacementProtectedMetadata) => {
    const protectedReply = replacementProtectedMetadata === undefined
      ? protectedResponse
      : json(replacementProtectedMetadata);
    const { request } = requestFrom({
      [resourceMetadataUrl]: protectedReply,
      [authorizationMetadataUrl]: serverResponse,
      [oidcMetadataUrl]: serverResponse
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result.status).toBe("fail");
    expect(result.findings[0]).toEqual(expect.objectContaining({
      id: "plugin.runtime.remote.authorization.metadata.invalid",
      severity: "fail"
    }));
  });

  it.each([
    ["a malformed JSON body", response(200, "application/json", "{")],
    ["a non-JSON content type", response(200, "text/plain", "{}")],
    ["an oversized response", new BoundedHttpError("REMOTE_HTTP_RESPONSE_TOO_LARGE", "oversized token-secret-sentinel")],
    ["a redirect", new BoundedHttpError("REMOTE_HTTP_REDIRECT", "redirect query-secret-sentinel")]
  ])("returns a stable private failure for %s", async (_name, metadataReply) => {
    const { request } = requestFrom({ [resourceMetadataUrl]: metadataReply });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result).toEqual(expect.objectContaining({
      status: "fail",
      findings: [expect.objectContaining({ id: "plugin.runtime.remote.authorization.metadata.unavailable", severity: "fail" })]
    }));
    assertPrivate(result);
  });

  it("rejects unsafe explicit metadata and advertised issuers without issuing those requests", async () => {
    const explicit = await checkRemoteOAuthReadiness(resourceUrl, [
      'Bearer resource_metadata="http://metadata.example/.well-known/oauth-protected-resource"'
    ], { request: async () => { throw new Error("must not request"); } });
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata([issuer, "https://auth.example/?query-secret-sentinel"])
    });
    const advertised = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(explicit.status).toBe("fail");
    expect(advertised.status).toBe("fail");
    expect(calls).toHaveLength(1);
    assertPrivate({ explicit, advertised });
  });

  it.each([
    ["a not-found document", response(404)],
    ["an unavailable document", response(503)],
    ["a malformed document", response(200, "application/json", "{")],
    ["a resource-mismatched document", json({ resource: "https://mcp.example/other", authorization_servers: [issuer] })]
  ])("deduplicates explicit metadata candidates and skips %s", async (_name, firstReply) => {
    const alternateMetadataUrl = "https://metadata.example/oauth-protected-resource";
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: firstReply,
      [alternateMetadataUrl]: protectedMetadata(),
      [authorizationMetadataUrl]: authorizationMetadata()
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [
      `Bearer resource_metadata="${resourceMetadataUrl}", Bearer resource_metadata="${resourceMetadataUrl}", Bearer resource_metadata="${alternateMetadataUrl}"`
    ], { request });

    expect(result).toEqual({ status: "pass", findings: [] });
    expect(calls.map((call) => call.url)).toEqual([
      resourceMetadataUrl,
      alternateMetadataUrl,
      authorizationMetadataUrl
    ]);
  });

  it("rejects more than four unique explicit metadata candidates before requesting them", async () => {
    const candidates = Array.from({ length: 5 }, (_, index) => `https://metadata-${index}.example/oauth-protected-resource`);
    let requested = false;

    const result = await checkRemoteOAuthReadiness(resourceUrl, candidates.map((candidate) => `Bearer resource_metadata="${candidate}"`), { request: async () => {
      requested = true;
      throw new Error("must not request");
    } });

    expect(result.findings[0]).toMatchObject({ id: "plugin.runtime.remote.authorization.metadata.invalid" });
    expect(requested).toBe(false);
  });

  it("rejects more than four unique advertised authorization servers before requesting them", async () => {
    const authorizationServers = Array.from({ length: 5 }, (_, index) => `https://auth-${index}.example`);
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata(authorizationServers)
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result.findings[0]).toMatchObject({ id: "plugin.runtime.remote.authorization.metadata.invalid" });
    expect(calls.map((call) => call.url)).toEqual([resourceMetadataUrl]);
  });

  it("deduplicates advertised authorization servers before probing them", async () => {
    const secondIssuer = "https://auth-two.example/issuer";
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata([issuer, issuer, secondIssuer]),
      [authorizationMetadataUrl]: response(404),
      [oidcMetadataUrl]: response(404),
      "https://auth-two.example/.well-known/oauth-authorization-server/issuer": json({
        issuer: secondIssuer,
        authorization_endpoint: "https://auth-two.example/authorize",
        token_endpoint: "https://auth-two.example/token"
      })
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [], { request });

    expect(result).toEqual({ status: "pass", findings: [] });
    expect(calls.map((call) => call.url)).toEqual([
      resourceMetadataUrl,
      authorizationMetadataUrl,
      oidcMetadataUrl,
      "https://auth-two.example/.well-known/oauth-authorization-server/issuer"
    ]);
  });

  it.each([
    ["an explicit metadata URL", 'Bearer resource_metadata="https://[::1]/oauth-protected-resource"', undefined],
    ["an advertised authorization server issuer", undefined, { authorization_servers: ["https://[::1]"] }],
    ["an authorization endpoint", undefined, { authorization_endpoint: "https://[::1]/authorize" }],
    ["a token endpoint", undefined, { token_endpoint: "https://[::1]/token" }]
  ])("rejects bracketed IPv6 literals in %s without an unsafe request", async (_name, header, metadataOverrides) => {
    const { request, calls } = requestFrom({
      [resourceMetadataUrl]: metadataOverrides?.authorization_servers === undefined
        ? protectedMetadata()
        : json({ resource: resourceUrl, ...metadataOverrides }),
      [authorizationMetadataUrl]: authorizationMetadata(metadataOverrides)
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, header === undefined ? [] : [header], { request });

    expect(result.status).toBe("fail");
    expect(calls.some((call) => call.url.includes("[::1]"))).toBe(false);
    if (header !== undefined) {
      expect(calls).toHaveLength(0);
    }
  });

  it("uses one total deadline across delayed authorization discovery requests", async () => {
    vi.useFakeTimers();
    try {
      const calls: Array<{ url: string; timeoutMs: number | undefined; at: number }> = [];
      const request: RemoteOAuthReadinessRequest = (url, requestOptions) => new Promise((resolve) => {
        calls.push({ url, timeoutMs: requestOptions?.timeoutMs, at: Date.now() });
        setTimeout(() => resolve(url === resourceMetadataUrl ? protectedMetadata() : response(404)), 40);
      });

      const resultPromise = checkRemoteOAuthReadiness(resourceUrl, [], {
        request,
        requestOptions: { timeoutMs: 60 }
      });

      await vi.advanceTimersByTimeAsync(60);
      const result = await resultPromise;

      expect(result.findings[0]).toMatchObject({ id: "plugin.runtime.remote.authorization.metadata.unavailable" });
      expect(calls.map((call) => call.url)).toEqual([resourceMetadataUrl, authorizationMetadataUrl]);
      expect(calls.map((call) => call.timeoutMs)).toEqual([60, 20]);
      expect(calls.map((call) => call.at - calls[0]!.at)).toEqual([0, 40]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts a standalone WWW-Authenticate header value", async () => {
    const { request } = requestFrom({
      [resourceMetadataUrl]: protectedMetadata(),
      [authorizationMetadataUrl]: authorizationMetadata()
    });

    const result = await checkRemoteOAuthReadiness(resourceUrl, [
      `Bearer resource_metadata="${resourceMetadataUrl}"`
    ], { request });

    expect(result).toEqual({ status: "pass", findings: [] });
  });
});
