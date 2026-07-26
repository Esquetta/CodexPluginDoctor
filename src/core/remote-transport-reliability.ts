import {
  BoundedHttpError,
  type BoundedHttpRequestOptions,
  type BoundedHttpResponse
} from "./bounded-http-client.js";
import { observeFirstSseEvent, type SseObservation } from "./sse-observation.js";
import type { Finding, RemoteTransportReliabilityScorecard } from "../domain/types.js";

const DEFAULT_RELIABILITY_TIMEOUT_MS = 3_000;
const MAX_RELIABILITY_REQUESTS = 6;

export interface RemoteTransportReliabilityResult {
  findings: Finding[];
  scorecard: RemoteTransportReliabilityScorecard;
}

export type RemoteTransportReliabilityRequest = (
  options: BoundedHttpRequestOptions
) => Promise<BoundedHttpResponse>;

export interface RemoteTransportReliabilityOptions {
  rawUrl: string;
  protocolVersion: string;
  request: (rawUrl: string, options?: BoundedHttpRequestOptions) => Promise<BoundedHttpResponse>;
  requestTimeoutMs?: number;
  requestOptions?: Pick<BoundedHttpRequestOptions, "allowLocalNetwork" | "lookup">;
  sessionId: string | null;
  allowSessionLifecycle?: boolean;
  reinitialize: (request: RemoteTransportReliabilityRequest) => Promise<string | null>;
}

interface RequestResult {
  response?: BoundedHttpResponse;
  error?: unknown;
  restartFailed?: boolean;
}

function createScorecard(): RemoteTransportReliabilityScorecard {
  return {
    getSse: "skipped",
    sessionPropagation: "skipped",
    resumability: "skipped",
    disconnectSafety: "skipped",
    sessionRestart: "skipped",
    termination: "skipped",
    overall: "skipped"
  };
}

function finding(id: string, severity: "fail" | "warn", message: string, suggestedFix: string): Finding {
  return {
    id,
    severity,
    message,
    impact: "Remote MCP transport reliability could not be verified within the configured safety bounds.",
    suggestedFix
  };
}

function responseHeader(headers: BoundedHttpResponse["headers"], name: string): string | null {
  const value = headers[name];
  return typeof value === "string" ? value : null;
}

function mediaType(value: string | null): string | null {
  return value?.split(";", 1)[0]?.trim().toLowerCase() ?? null;
}

function validSessionId(value: string | null): boolean {
  return value !== null && /^[\x21-\x7e]+$/.test(value);
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function finalize(scorecard: RemoteTransportReliabilityScorecard, findings: Finding[]): RemoteTransportReliabilityResult {
  const statuses = Object.entries(scorecard)
    .filter(([name]) => name !== "overall")
    .map(([, status]) => status);
  scorecard.overall = statuses.includes("fail")
    ? "fail"
    : statuses.includes("warn")
      ? "warn"
      : statuses.includes("pass")
        ? "pass"
        : "skipped";
  return { findings, scorecard };
}

function isSseTimeout(error: unknown): boolean {
  return error instanceof BoundedHttpError
    && error.code === "REMOTE_HTTP_TIMEOUT"
    && error.statusCode === 200
    && mediaType(responseHeader(error.headers ?? {}, "content-type")) === "text/event-stream";
}

function classifySseResponse(
  response: BoundedHttpResponse,
  failurePrefix: "get" | "resume",
  findings: Finding[]
): SseObservation | null {
  if (response.statusCode !== 200) {
    findings.push(finding(
      `plugin.runtime.remote.reliability.${failurePrefix}.status`,
      "fail",
      "The remote MCP endpoint returned an unsupported SSE transport status.",
      "Return HTTP 200 for an accepted SSE transport request."
    ));
    return null;
  }
  if (mediaType(responseHeader(response.headers, "content-type")) !== "text/event-stream") {
    findings.push(finding(
      `plugin.runtime.remote.reliability.${failurePrefix}.content_type`,
      "fail",
      "The remote MCP endpoint returned a non-SSE media type for an SSE transport request.",
      "Return text/event-stream for accepted SSE transport requests."
    ));
    return null;
  }
  return observeFirstSseEvent(response.body);
}

export async function probeRemoteTransportReliability(
  options: RemoteTransportReliabilityOptions
): Promise<RemoteTransportReliabilityResult> {
  const scorecard = createScorecard();
  const findings: Finding[] = [];
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_RELIABILITY_TIMEOUT_MS;
  const deadline = Date.now() + Math.min(timeoutMs, DEFAULT_RELIABILITY_TIMEOUT_MS);
  let currentSessionId = options.sessionId;
  let requestCount = 0;
  let restarted = false;

  const requestWithinBudget: RemoteTransportReliabilityRequest = async (requestOptions) => {
    if (requestCount >= MAX_RELIABILITY_REQUESTS) {
      throw new Error("reliability request ceiling reached");
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new BoundedHttpError("REMOTE_HTTP_TIMEOUT", "Remote reliability deadline elapsed.");
    }
    requestCount += 1;
    return options.request(options.rawUrl, {
      ...requestOptions,
      ...options.requestOptions,
      timeoutMs: Math.max(1, Math.min(remainingMs, DEFAULT_RELIABILITY_TIMEOUT_MS))
    });
  };

  const send = async (
    method: "GET" | "DELETE",
    extraHeaders: Record<string, string> = {},
    stopAfter?: (body: Buffer) => boolean
  ): Promise<RequestResult> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const sessionId = currentSessionId;
      const headers = {
        Accept: "text/event-stream",
        "MCP-Protocol-Version": options.protocolVersion,
        ...(sessionId === null ? {} : { "MCP-Session-Id": sessionId }),
        ...extraHeaders
      };
      if (sessionId !== null) {
        scorecard.sessionPropagation = "pass";
      }
      let response: BoundedHttpResponse;
      try {
        response = await requestWithinBudget({
          method,
          headers,
          stopAfter
        });
      } catch (error) {
        return { error };
      }

      if (method === "GET" && sessionId !== null && response.statusCode === 404) {
        if (restarted) {
          scorecard.sessionRestart = "fail";
          return { restartFailed: true };
        }
        restarted = true;
        currentSessionId = null;
        try {
          const replacementSessionId = await options.reinitialize(requestWithinBudget);
          if (replacementSessionId !== null && !validSessionId(replacementSessionId)) {
            throw new Error("invalid replacement session");
          }
          currentSessionId = replacementSessionId;
          scorecard.sessionRestart = "pass";
        } catch {
          scorecard.sessionRestart = "fail";
          return { restartFailed: true };
        }
        continue;
      }
      return { response };
    }
    return { restartFailed: true };
  };

  const first = await send("GET", {}, (body) => observeFirstSseEvent(body).complete);
  if (first.restartFailed) {
    findings.push(finding(
      "plugin.runtime.remote.reliability.session_restart.failed",
      "fail",
      "The remote MCP session expired and could not be restarted within the bounded probe.",
      "Accept a fresh initialize sequence after an expired MCP session."
    ));
    return finalize(scorecard, findings);
  }
  if (first.error) {
    if (isSseTimeout(first.error)) {
      scorecard.getSse = "warn";
      scorecard.disconnectSafety = "warn";
      findings.push(finding(
        "plugin.runtime.remote.reliability.get.inconclusive",
        "warn",
        "The remote MCP SSE stream did not produce a complete event before the bounded observation deadline.",
        "Emit complete SSE event frames promptly when server-to-client streaming is supported."
      ));
      return finalize(scorecard, findings);
    }
    scorecard.getSse = "fail";
    findings.push(finding(
      "plugin.runtime.remote.reliability.get.failed",
      "fail",
      "The remote MCP SSE transport request could not be completed.",
      "Keep the Streamable HTTP transport reachable within the configured request bounds."
    ));
    return finalize(scorecard, findings);
  }
  const firstResponse = first.response;
  if (!firstResponse) {
    scorecard.getSse = "fail";
    return finalize(scorecard, findings);
  }
  if (firstResponse.statusCode === 405) {
    scorecard.getSse = "pass";
  } else {
    const observation = classifySseResponse(firstResponse, "get", findings);
    if (observation === null) {
      scorecard.getSse = "fail";
      return finalize(scorecard, findings);
    }
    if (!observation.complete) {
      scorecard.getSse = "warn";
      scorecard.disconnectSafety = "warn";
      findings.push(finding(
        "plugin.runtime.remote.reliability.get.inconclusive",
        "warn",
        "The remote MCP SSE response ended before a complete event could be observed.",
        "Emit complete SSE event frames when server-to-client streaming is supported."
      ));
      return finalize(scorecard, findings);
    }
    if (observation.malformed) {
      scorecard.getSse = "fail";
      scorecard.disconnectSafety = "fail";
      findings.push(finding(
        "plugin.runtime.remote.reliability.get.malformed",
        "fail",
        "The remote MCP endpoint emitted malformed SSE event framing.",
        "Return complete SSE events with valid id and retry fields."
      ));
      return finalize(scorecard, findings);
    }
    scorecard.getSse = "pass";
    scorecard.disconnectSafety = "pass";

    if (observation.eventId !== null) {
      const remainingMs = deadline - Date.now();
      if (observation.retryMs !== null) {
        if (observation.retryMs >= remainingMs) {
          scorecard.resumability = "warn";
          findings.push(finding(
            "plugin.runtime.remote.reliability.resume.inconclusive",
            "warn",
            "The remote MCP SSE retry delay exceeded the remaining bounded observation deadline.",
            "Advertise an SSE retry delay that fits within the configured probe deadline."
          ));
          return finalize(scorecard, findings);
        }
        await wait(observation.retryMs);
      }
      const resumed = await send("GET", { "Last-Event-ID": observation.eventId }, (body) => observeFirstSseEvent(body).complete);
      if (resumed.restartFailed) {
        findings.push(finding(
          "plugin.runtime.remote.reliability.session_restart.failed",
          "fail",
          "The remote MCP session expired during SSE resumability validation and could not be restarted.",
          "Accept one fresh initialize sequence after an expired MCP session."
        ));
        return finalize(scorecard, findings);
      }
      if (resumed.error) {
        scorecard.resumability = isSseTimeout(resumed.error) ? "warn" : "fail";
        findings.push(finding(
          isSseTimeout(resumed.error)
            ? "plugin.runtime.remote.reliability.resume.inconclusive"
            : "plugin.runtime.remote.reliability.resume.failed",
          isSseTimeout(resumed.error) ? "warn" : "fail",
          "The remote MCP SSE resume request could not be completed within the bounded probe.",
          "Accept one bounded SSE reconnect using Last-Event-ID."
        ));
        return finalize(scorecard, findings);
      }
      if (!resumed.response) {
        scorecard.resumability = "fail";
        return finalize(scorecard, findings);
      }
      const resumeObservation = classifySseResponse(resumed.response, "resume", findings);
      if (resumeObservation === null || resumeObservation.malformed) {
        scorecard.resumability = "fail";
        if (resumeObservation?.malformed) {
          findings.push(finding(
            "plugin.runtime.remote.reliability.resume.malformed",
            "fail",
            "The remote MCP endpoint emitted malformed SSE framing after a resume request.",
            "Return complete SSE events with valid id and retry fields after reconnecting."
          ));
        }
        return finalize(scorecard, findings);
      }
      scorecard.resumability = resumeObservation.complete ? "pass" : "warn";
      if (!resumeObservation.complete) {
        findings.push(finding(
          "plugin.runtime.remote.reliability.resume.inconclusive",
          "warn",
          "The remote MCP SSE resume response ended before a complete event could be observed.",
          "Emit complete SSE event frames after accepting a reconnect."
        ));
        return finalize(scorecard, findings);
      }
    }
  }

  if (!options.allowSessionLifecycle || currentSessionId === null) {
    return finalize(scorecard, findings);
  }
  const terminated = await send("DELETE");
  if (terminated.restartFailed || terminated.error || !terminated.response
    || (terminated.response.statusCode !== 405 && (terminated.response.statusCode < 200 || terminated.response.statusCode >= 300))) {
    scorecard.termination = "fail";
    findings.push(finding(
      "plugin.runtime.remote.reliability.termination.failed",
      "fail",
      "The remote MCP session could not be terminated with the approved lifecycle request.",
      "Return a successful response or HTTP 405 for a bounded MCP session DELETE request."
    ));
    return finalize(scorecard, findings);
  }
  scorecard.termination = "pass";
  return finalize(scorecard, findings);
}
