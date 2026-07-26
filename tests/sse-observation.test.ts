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

  it("observes a complete LF-delimited event", () => {
    expect(observeFirstSseEvent(Buffer.from("id: event-1\nretry: 125\n\n"))).toEqual({
      complete: true,
      eventId: "event-1",
      retryMs: 125,
      malformed: false
    });
  });

  it("does not replace a valid retry with a later invalid retry", () => {
    expect(observeFirstSseEvent(Buffer.from("retry: 125\nretry: nope\n\n"))).toEqual({
      complete: true,
      eventId: null,
      retryMs: 125,
      malformed: false
    });
  });

  it.each([
    ["an overflowing retry", "9007199254740992"],
    ["an oversized retry", "9".repeat(1_025)]
  ])("ignores %s without replacing a valid retry", (_name, invalidRetry) => {
    expect(observeFirstSseEvent(Buffer.from(`retry: 125\nretry: ${invalidRetry}\n\n`))).toEqual({
      complete: true,
      eventId: null,
      retryMs: 125,
      malformed: false
    });
  });

  it("resets the event ID when the event contains an empty id field", () => {
    expect(observeFirstSseEvent(Buffer.from("id: event-1\nid:\n\n"))).toEqual({
      complete: true,
      eventId: null,
      retryMs: null,
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
