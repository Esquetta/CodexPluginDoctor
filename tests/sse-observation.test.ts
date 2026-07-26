import { describe, expect, it } from "vitest";

import { observeFirstSseEvent } from "../src/core/sse-observation.js";

describe("observeFirstSseEvent", () => {
  it("observes the first complete CRLF-delimited event without returning its data", () => {
    const observation = observeFirstSseEvent(Buffer.from(
      ": ready\r\nid: event-1\r\nretry: 2500\r\ndata: secret payload\r\nunknown: ignored\r\n\r\nid: event-2\r\n\r\n"
    ));

    expect(observation).toEqual({
      complete: true,
      eventId: "event-1",
      retryMs: 2500,
      malformed: false
    });
    expect(observation).not.toHaveProperty("data");
  });

  it("does not observe an incomplete event", () => {
    expect(observeFirstSseEvent(Buffer.from("id: event-1\ndata: secret payload\n"))).toEqual({
      complete: false,
      eventId: null,
      retryMs: null,
      malformed: false
    });
  });

  it("ignores invalid retry values", () => {
    expect(observeFirstSseEvent(Buffer.from("retry: 12ms\nretry: -1\nretry: 125\n\n"))).toEqual({
      complete: true,
      eventId: null,
      retryMs: 125,
      malformed: false
    });
  });

  it("rejects unsafe event IDs", () => {
    expect(observeFirstSseEvent(Buffer.from("id: event\u0001-1\n\n"))).toEqual({
      complete: true,
      eventId: null,
      retryMs: null,
      malformed: true
    });
  });

  it("rejects oversized event ID fields", () => {
    expect(observeFirstSseEvent(Buffer.from(`id: ${"a".repeat(1_025)}\n\n`))).toEqual({
      complete: true,
      eventId: null,
      retryMs: null,
      malformed: true
    });
  });
});
