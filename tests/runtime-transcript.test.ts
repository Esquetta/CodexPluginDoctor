import { describe, expect, it } from "vitest";

import {
  formatRequestTranscript,
  formatResponseTranscript,
  sanitizeTranscriptValue
} from "../src/core/runtime-transcript.js";

describe("runtime transcript sanitization", () => {
  it("redacts sensitive query parameter values in resource read requests", () => {
    const transcript = formatRequestTranscript("resources/read", {
      uri: "file:///workspace/README.md?sig=abcdef123456&version=1&token=xyz987654321"
    });

    expect(transcript).toContain("\"sig\":\"[REDACTED]\"");
    expect(transcript).toContain("\"token\":\"[REDACTED]\"");
    expect(transcript).toContain("\"version\":\"1\"");
  });

  it("redacts token-like strings", () => {
    expect(sanitizeTranscriptValue("Bearer sk-live-secret-token-123456")).toBe(
      "[REDACTED]"
    );
  });

  it("truncates very long non-sensitive strings", () => {
    const longValue = "a".repeat(120);

    expect(sanitizeTranscriptValue(longValue)).toBe("[TRUNCATED]");
  });

  it("redacts sensitive error messages in response transcripts", () => {
    const transcript = formatResponseTranscript("prompts/get", {
      jsonrpc: "2.0",
      error: {
        code: -32602,
        message: "Invalid token=abcdef1234567890 and sk-live-1234567890"
      }
    });

    expect(transcript).toContain("\"message\":\"[REDACTED]\"");
  });

  it("summarizes tasks/list responses without task data or cursor values", () => {
    const transcript = formatResponseTranscript("tasks/list", {
      jsonrpc: "2.0",
      result: {
        tasks: [
          {
            taskId: "private-task-id",
            status: "working",
            statusMessage: "private task text"
          }
        ],
        nextCursor: "private-task-cursor"
      }
    });

    expect(transcript).toBe('<- tasks/list {"tasks":1,"nextCursor":"[CURSOR]"}');
    expect(transcript).not.toContain("private-task");
    expect(transcript).not.toContain("working");
  });
});
