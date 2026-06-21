import { describe, expect, it } from "vitest";

import {
  classifySuppressionRecord,
  isSuppressionExpired,
  validateSuppressionRecord
} from "../src/core/suppression-record.js";

const fingerprint = "a".repeat(64);

describe("validateSuppressionRecord", () => {
  it("returns a trimmed valid suppression record", () => {
    expect(
      validateSuppressionRecord({
        fingerprint,
        reason: "  Reviewed exception.  ",
        expiresAt: "2026-07-31"
      })
    ).toEqual({
      valid: true,
      fingerprint,
      reason: "Reviewed exception.",
      expiresAt: "2026-07-31"
    });
  });

  it.each([
    [null, { valid: false, field: "record" }],
    [{ fingerprint: "A".repeat(64), reason: "Reviewed exception.", expiresAt: "2026-07-31" }, { valid: false, field: "fingerprint" }],
    [{ fingerprint, reason: "   ", expiresAt: "2026-07-31" }, { valid: false, field: "reason" }],
    [{ fingerprint, reason: "Reviewed exception.", expiresAt: "2026-7-31" }, { valid: false, field: "expiresAt" }],
    [{ fingerprint, reason: "Reviewed exception.", expiresAt: "2026-02-30" }, { valid: false, field: "expiresAt" }]
  ])("rejects %j", (value, expected) => {
    expect(validateSuppressionRecord(value)).toEqual(expected);
  });
});

describe("isSuppressionExpired", () => {
  it("expires at the next UTC day boundary", () => {
    expect(
      isSuppressionExpired("2026-07-31", new Date("2026-07-31T23:59:59.999Z"))
    ).toBe(false);
    expect(
      isSuppressionExpired("2026-07-31", new Date("2026-08-01T00:00:00.000Z"))
    ).toBe(true);
  });
});

describe("classifySuppressionRecord", () => {
  it("classifies valid active and expired records", () => {
    expect(
      classifySuppressionRecord(
        {
          fingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-07-31"
        },
        new Date("2026-07-31T23:59:59.999Z")
      )
    ).toEqual({
      status: "active",
      valid: true,
      fingerprint,
      reason: "Reviewed exception.",
      expiresAt: "2026-07-31"
    });

    expect(
      classifySuppressionRecord(
        {
          fingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-07-31"
        },
        new Date("2026-08-01T00:00:00.000Z")
      )
    ).toEqual({
      status: "expired",
      valid: true,
      fingerprint,
      reason: "Reviewed exception.",
      expiresAt: "2026-07-31"
    });
  });

  it("classifies invalid records without echoing valid fields", () => {
    expect(
      classifySuppressionRecord(
        {
          fingerprint: "invalid",
          reason: "Reviewed exception.",
          expiresAt: "2026-07-31"
        },
        new Date("2026-07-01T00:00:00.000Z")
      )
    ).toEqual({
      status: "invalid",
      valid: false,
      field: "fingerprint"
    });
  });
});
