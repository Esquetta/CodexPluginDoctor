import { describe, expect, it } from "vitest";

import { BoundedHttpError, type BoundedHttpRequestOptions, type BoundedHttpResponse } from "../src/core/bounded-http-client.js";
import { probeRemoteTransportReliability } from "../src/core/remote-transport-reliability.js";
import { renderJsonReport } from "../src/reporting/render-json-report.js";
import { buildMarkdownReport } from "../src/reporting/render-markdown-report.js";
import { renderTextReport } from "../src/reporting/render-text-report.js";

const endpoint = "https://mcp.example/mcp";
const protocolVersion = "2025-11-25";

function response(statusCode: number, contentType?: string, body = ""): BoundedHttpResponse {
  return {
    statusCode,
    headers: contentType === undefined ? {} : { "content-type": contentType },
    body: Buffer.from(body)
  };
}

function scriptedRequest(responses: Array<BoundedHttpResponse | Error>) {
  const requests: BoundedHttpRequestOptions[] = [];
  return {
    requests,
    request: async (_url: string, options?: BoundedHttpRequestOptions): Promise<BoundedHttpResponse> => {
      requests.push(options ?? {});
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("unexpected request");
      return next;
    }
  };
}

function probe(request: (url: string, options?: BoundedHttpRequestOptions) => Promise<BoundedHttpResponse>, overrides: {
  sessionId?: string | null;
  allowSessionLifecycle?: boolean;
  requestTimeoutMs?: number;
  reinitialize?: () => Promise<string | null>;
} = {}) {
  return probeRemoteTransportReliability({
    rawUrl: endpoint,
    protocolVersion,
    request,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 50,
    sessionId: overrides.sessionId ?? null,
    allowSessionLifecycle: overrides.allowSessionLifecycle,
    reinitialize: overrides.reinitialize ?? (async () => null)
  });
}

function assertRedacted(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const secret of [
    "session-secret-sentinel",
    "event-secret-sentinel",
    "999999",
    "remote-body-secret-sentinel"
  ]) {
    expect(serialized).not.toContain(secret);
  }
}

describe("probeRemoteTransportReliability", () => {
  it("keeps remote transport canaries out of CLI and Action-facing report content", async () => {
    const fixture = scriptedRequest([
      response(
        200,
        "text/event-stream",
        "id: report-event-canary-91ac\nretry: 917431\ndata: report-sse-data-canary-c8e5\n\n"
      )
    ]);
    const result = await probe(fixture.request, {
      sessionId: "report-session-canary-7d31",
      requestTimeoutMs: 10
    });
    const report = {
      targetPath: "example",
      status: "warn" as const,
      exitCode: 0,
      findings: result.findings,
      runtimeScorecard: {
        initialize: "pass" as const,
        toolsList: "skipped" as const,
        toolsCall: "skipped" as const,
        resourcesList: "skipped" as const,
        resourceRead: "skipped" as const,
        resourceTemplatesList: "skipped" as const,
        promptsList: "skipped" as const,
        promptGet: "skipped" as const,
        remote: {
          transport: "pass" as const,
          networkSafety: "pass" as const,
          initialize: "pass" as const,
          contentType: "pass" as const,
          session: "present-valid" as const,
          protocolHeaders: "pass" as const,
          authorization: "skipped" as const,
          overall: "warn" as const,
          reliability: result.scorecard
        }
      }
    };

    for (const output of [
      renderJsonReport(report, { runtimeProbeEnabled: true }),
      renderTextReport(report),
      buildMarkdownReport(report, { runtimeProbeEnabled: true })
    ]) {
      for (const canary of [
        "report-session-canary-7d31",
        "report-event-canary-91ac",
        "917431",
        "report-sse-data-canary-c8e5"
      ]) {
        expect(output).not.toContain(canary);
      }
    }
  });

  it("accepts GET 405 as compliant without attempting resume", async () => {
    const fixture = scriptedRequest([response(405)]);

    const result = await probe(fixture.request);

    expect(result.findings).toEqual([]);
    expect(result.scorecard).toMatchObject({ getSse: "pass", resumability: "skipped", overall: "pass" });
    expect(fixture.requests).toHaveLength(1);
  });

  it("uses a safe event id for exactly one resume without retaining it", async () => {
    const fixture = scriptedRequest([
      response(200, "text/event-stream", "id: event-secret-sentinel\ndata: remote-body-secret-sentinel\n\n"),
      response(200, "text/event-stream", "\n"),
      response(204)
    ]);

    const result = await probe(fixture.request, { sessionId: "session-secret-sentinel", allowSessionLifecycle: true });

    expect(result.findings).toEqual([]);
    expect(result.scorecard).toMatchObject({ getSse: "pass", sessionPropagation: "pass", resumability: "pass", overall: "pass" });
    expect(fixture.requests).toHaveLength(3);
    expect(fixture.requests[0]?.headers).toMatchObject({
      Accept: "text/event-stream",
      "MCP-Protocol-Version": protocolVersion,
      "MCP-Session-Id": "session-secret-sentinel"
    });
    expect(fixture.requests[0]?.headers?.["Last-Event-ID"]).toBeUndefined();
    expect(fixture.requests[1]?.headers).toMatchObject({
      "MCP-Protocol-Version": protocolVersion,
      "MCP-Session-Id": "session-secret-sentinel",
      "Last-Event-ID": "event-secret-sentinel"
    });
    expect(fixture.requests[2]?.headers).toMatchObject({
      "MCP-Protocol-Version": protocolVersion,
      "MCP-Session-Id": "session-secret-sentinel"
    });
    expect(fixture.requests[2]?.headers?.["Last-Event-ID"]).toBeUndefined();
    assertRedacted(result);
  });

  it("accepts a complete SSE event without an id without attempting resume", async () => {
    const fixture = scriptedRequest([
      response(200, "text/event-stream", "event: message\ndata: remote-body-secret-sentinel\n\n")
    ]);

    const result = await probe(fixture.request);

    expect(result.findings).toEqual([]);
    expect(result.scorecard).toMatchObject({ getSse: "pass", resumability: "skipped", overall: "pass" });
    expect(fixture.requests).toHaveLength(1);
    assertRedacted(result);
  });

  it("honors a retry delay only when it remains within the reliability deadline", async () => {
    const withinDeadline = scriptedRequest([
      response(200, "text/event-stream", "id: event-secret-sentinel\nretry: 1\n\n"),
      response(200, "text/event-stream", "\n")
    ]);
    const withinResult = await probe(withinDeadline.request, { requestTimeoutMs: 50 });

    const overDeadline = scriptedRequest([
      response(200, "text/event-stream", "id: event-secret-sentinel\nretry: 999999\n\n")
    ]);
    const overResult = await probe(overDeadline.request, { requestTimeoutMs: 10 });

    expect(withinResult.scorecard.resumability).toBe("pass");
    expect(withinDeadline.requests).toHaveLength(2);
    expect(overResult.scorecard.resumability).toBe("warn");
    expect(overDeadline.requests).toHaveLength(1);
    assertRedacted(overResult);
  });

  it.each([
    [response(500), "plugin.runtime.remote.reliability.get.status"],
    [response(200, "application/json"), "plugin.runtime.remote.reliability.get.content_type"],
    [response(200, "text/event-stream", "id: invalid event-secret-sentinel\n\n"), "plugin.runtime.remote.reliability.get.malformed"]
  ])("fails invalid GET evidence with stable redacted findings", async (fixtureResponse, findingId) => {
    const fixture = scriptedRequest([fixtureResponse]);

    const result = await probe(fixture.request);

    expect(result.findings).toEqual([expect.objectContaining({ id: findingId, severity: "fail" })]);
    expect(result.scorecard.overall).toBe("fail");
    assertRedacted(result);
  });

  it("treats an incomplete SSE response after headers as inconclusive", async () => {
    const timeout = new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "timeout", 200, { "content-type": "text/event-stream" });
    const fixture = scriptedRequest([timeout]);

    const result = await probe(fixture.request);

    expect(result.findings).toEqual([expect.objectContaining({ id: "plugin.runtime.remote.reliability.get.inconclusive", severity: "warn" })]);
    expect(result.scorecard.overall).toBe("warn");
  });

  it("treats a bounded SSE resume timeout as inconclusive", async () => {
    const timeout = new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "timeout", 200, { "content-type": "text/event-stream" });
    const fixture = scriptedRequest([
      response(200, "text/event-stream", "id: event-secret-sentinel\n\n"),
      timeout
    ]);

    const result = await probe(fixture.request);

    expect(result.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.reliability.resume.inconclusive", severity: "warn" })
    ]);
    expect(result.scorecard).toMatchObject({ resumability: "warn", overall: "warn" });
    assertRedacted(result);
  });

  it("reinitializes once after a session-bound GET 404 and uses the replacement session", async () => {
    const fixture = scriptedRequest([response(404), response(405)]);
    let restarts = 0;

    const result = await probe(fixture.request, {
      sessionId: "session-secret-sentinel",
      reinitialize: async () => {
        restarts += 1;
        return "replacement-session-secret-sentinel";
      }
    });

    expect(restarts).toBe(1);
    expect(fixture.requests).toHaveLength(2);
    expect(fixture.requests[1]?.headers?.["MCP-Session-Id"]).toBe("replacement-session-secret-sentinel");
    expect(result.scorecard).toMatchObject({ sessionRestart: "pass", overall: "pass" });
    assertRedacted(result);
  });

  it("counts both restart POST requests against the shared reliability request budget", async () => {
    const fixture = scriptedRequest([
      response(404),
      response(200, "application/json", "{}"),
      response(202),
      response(405)
    ]);

    const result = await probe(fixture.request, {
      sessionId: "session-secret-sentinel",
      reinitialize: async (requestWithinBudget: unknown) => {
        if (typeof requestWithinBudget !== "function") {
          throw new Error("restart requests must share the reliability budget");
        }
        const bounded = requestWithinBudget as (options: BoundedHttpRequestOptions) => Promise<BoundedHttpResponse>;
        await bounded({ method: "POST", headers: { "Content-Type": "application/json" } });
        await bounded({ method: "POST", headers: { "Content-Type": "application/json" } });
        return "replacement-session-secret-sentinel";
      }
    });

    expect(result.scorecard).toMatchObject({ sessionRestart: "pass", overall: "pass" });
    expect(fixture.requests.map((request) => request.method)).toEqual(["GET", "POST", "POST", "GET"]);
    expect(fixture.requests).toHaveLength(4);
    assertRedacted(result);
  });

  it("refuses a seventh request through the restart budget", async () => {
    const fixture = scriptedRequest([
      response(404),
      response(202),
      response(202),
      response(202),
      response(202),
      response(202)
    ]);
    let ceilingReached = false;

    await probe(fixture.request, {
      sessionId: "session-secret-sentinel",
      reinitialize: async (requestWithinBudget: unknown) => {
        if (typeof requestWithinBudget !== "function") {
          throw new Error("restart requests must share the reliability budget");
        }
        const bounded = requestWithinBudget as (options: BoundedHttpRequestOptions) => Promise<BoundedHttpResponse>;
        for (let index = 0; index < 5; index += 1) {
          await bounded({ method: "POST" });
        }
        try {
          await bounded({ method: "POST" });
        } catch {
          ceilingReached = true;
        }
        return "replacement-session-secret-sentinel";
      }
    });

    expect(ceilingReached).toBe(true);
    expect(fixture.requests).toHaveLength(6);
  });

  it("fails a single bounded session restart without recursion", async () => {
    const fixture = scriptedRequest([response(404)]);
    let restarts = 0;

    const result = await probe(fixture.request, {
      sessionId: "session-secret-sentinel",
      reinitialize: async () => {
        restarts += 1;
        throw new Error("session-secret-sentinel");
      }
    });

    expect(restarts).toBe(1);
    expect(fixture.requests).toHaveLength(1);
    expect(result.findings).toEqual([expect.objectContaining({ id: "plugin.runtime.remote.reliability.session_restart.failed", severity: "fail" })]);
    assertRedacted(result);
  });

  it("does not restart a replacement session or exceed the request ceiling", async () => {
    const fixture = scriptedRequest([response(404), response(404)]);
    let restarts = 0;

    const result = await probe(fixture.request, {
      sessionId: "session-secret-sentinel",
      reinitialize: async () => {
        restarts += 1;
        return "replacement-session-secret-sentinel";
      }
    });

    expect(restarts).toBe(1);
    expect(fixture.requests).toHaveLength(2);
    expect(result.scorecard.sessionRestart).toBe("fail");
    expect(result.findings).toEqual([expect.objectContaining({ id: "plugin.runtime.remote.reliability.session_restart.failed", severity: "fail" })]);
    assertRedacted(result);
  });

  it("treats a session-bound DELETE 404 as one failed termination without restart", async () => {
    const fixture = scriptedRequest([response(405), response(404)]);
    let restarts = 0;

    const result = await probe(fixture.request, {
      sessionId: "session-secret-sentinel",
      allowSessionLifecycle: true,
      reinitialize: async () => {
        restarts += 1;
        return "replacement-session-secret-sentinel";
      }
    });

    expect(fixture.requests.map((request) => request.method)).toEqual(["GET", "DELETE"]);
    expect(restarts).toBe(0);
    expect(result.scorecard).toMatchObject({ termination: "fail", overall: "fail" });
    expect(result.findings).toEqual([
      expect.objectContaining({ id: "plugin.runtime.remote.reliability.termination.failed", severity: "fail" })
    ]);
    assertRedacted(result);
  });

  it.each([
    [false, response(405), "skipped", "pass"],
    [true, response(204), "pass", "pass"],
    [true, response(405), "pass", "pass"],
    [true, response(500), "fail", "fail"]
  ])("limits DELETE lifecycle behavior to explicit consent", async (allowSessionLifecycle, deleteResponse, termination, overall) => {
    const fixture = scriptedRequest([response(405), deleteResponse]);

    const result = await probe(fixture.request, { sessionId: "session-secret-sentinel", allowSessionLifecycle });

    expect(result.scorecard.termination).toBe(termination);
    expect(result.scorecard.overall).toBe(overall);
    expect(fixture.requests.map((request) => request.method)).toEqual(
      allowSessionLifecycle ? ["GET", "DELETE"] : ["GET"]
    );
    assertRedacted(result);
  });
});
