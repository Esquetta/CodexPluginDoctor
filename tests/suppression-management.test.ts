import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.js";
import type { RawDoctorConfig } from "../src/core/doctor-config-store.js";
import {
  addSuppression,
  listSuppressions,
  removeSuppressionByFingerprint,
  removeSuppressionByIndex,
  type ManagedSuppressionRecord,
  type SuppressionMutationResult
} from "../src/core/suppression-management.js";

const activeFingerprint = "a".repeat(64);
const expiredFingerprint = "b".repeat(64);
const invalidReasonFingerprint = "c".repeat(64);
const removableFingerprint = "d".repeat(64);

describe("listSuppressions", () => {
  it("returns an empty list when suppressions are missing", () => {
    expect(listSuppressions({ ignoreRules: ["plugin.example"] })).toEqual([]);
  });

  it("lists active, expired, and invalid suppressions with safe fields", () => {
    const records: ManagedSuppressionRecord[] = listSuppressions(
      {
        suppressions: [
          {
            fingerprint: activeFingerprint,
            reason: "  Reviewed exception.  ",
            expiresAt: "2026-08-31"
          },
          {
            fingerprint: expiredFingerprint,
            reason: "Expired exception.",
            expiresAt: "2026-07-31"
          },
          {
            fingerprint: "A".repeat(64),
            reason: { secret: "do-not-echo" },
            expiresAt: "2026-07-31",
            token: "do-not-echo"
          },
          {
            fingerprint: invalidReasonFingerprint,
            reason: "   ",
            expiresAt: "2026-07-31",
            metadata: { internal: true }
          },
          "opaque-secret"
        ]
      },
      new Date("2026-08-01T00:00:00.000Z")
    );

    expect(records).toEqual([
      {
        index: 0,
        status: "active",
        fingerprint: activeFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-08-31"
      },
      {
        index: 1,
        status: "expired",
        fingerprint: expiredFingerprint,
        reason: "Expired exception.",
        expiresAt: "2026-07-31"
      },
      {
        index: 2,
        status: "invalid",
        fingerprint: "A".repeat(64),
        expiresAt: "2026-07-31",
        invalidField: "fingerprint"
      },
      {
        index: 3,
        status: "invalid",
        fingerprint: invalidReasonFingerprint,
        expiresAt: "2026-07-31",
        invalidField: "reason"
      },
      {
        index: 4,
        status: "invalid",
        invalidField: "record"
      }
    ]);
  });

  it("rejects a non-array suppressions value consistently", () => {
    const config = {
      suppressions: {
        fingerprint: activeFingerprint
      }
    };

    expect(() => listSuppressions(config)).toThrow(
      "Doctor config suppressions must be an array when present."
    );
    expect(() =>
      addSuppression(config, {
        fingerprint: removableFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-08-31"
      })
    ).toThrow("Doctor config suppressions must be an array when present.");
    expect(() => removeSuppressionByIndex(config, 0)).toThrow(
      "Doctor config suppressions must be an array when present."
    );
    expect(() =>
      removeSuppressionByFingerprint(config, removableFingerprint)
    ).toThrow("Doctor config suppressions must be an array when present.");
  });
});

describe("addSuppression", () => {
  it("adds a normalized suppression without mutating the input config", () => {
    const existingSuppression = {
      fingerprint: activeFingerprint,
      reason: "Existing exception.",
      expiresAt: "2026-09-01",
      source: "existing"
    };
    const config: RawDoctorConfig = {
      ignoreRules: ["plugin.example"],
      suppressions: [existingSuppression],
      unknownTopLevel: { keep: true }
    };
    const result: SuppressionMutationResult = addSuppression(config, {
      fingerprint: removableFingerprint,
      reason: "  Reviewed exception.  ",
      expiresAt: "2026-08-31",
      source: "manual"
    });

    expect(result).toEqual({
      config: {
        ignoreRules: ["plugin.example"],
        suppressions: [
          existingSuppression,
          {
            fingerprint: removableFingerprint,
            reason: "Reviewed exception.",
            expiresAt: "2026-08-31",
            source: "manual"
          }
        ],
        unknownTopLevel: { keep: true }
      },
      index: 1,
      suppression: {
        fingerprint: removableFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-08-31",
        source: "manual"
      }
    });
    expect(result.config).not.toBe(config);
    expect(result.config.suppressions).not.toBe(config.suppressions);
    expect((result.config.suppressions as unknown[])[0]).toBe(existingSuppression);
    expect(config).toEqual({
      ignoreRules: ["plugin.example"],
      suppressions: [existingSuppression],
      unknownTopLevel: { keep: true }
    });
  });

  it("rejects an invalid suppression record using the shared validator", () => {
    expect(() =>
      addSuppression(
        { suppressions: [] },
        {
          fingerprint: "A".repeat(64),
          reason: "Reviewed exception.",
          expiresAt: "2026-08-31"
        }
      )
    ).toThrow("Suppression record is invalid: fingerprint.");
  });

  it("rejects a duplicate fingerprint using the first matching config index", () => {
    expect(() =>
      addSuppression(
        {
          suppressions: [
            {
              fingerprint: removableFingerprint,
              reason: "   ",
              expiresAt: "2026-08-31"
            },
            {
              fingerprint: removableFingerprint,
              reason: "Expired exception.",
              expiresAt: "2025-08-31"
            }
          ]
        },
        {
          fingerprint: removableFingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-09-30"
        }
      )
    ).toThrow("Suppression fingerprint already exists at index 0.");
  });
});

describe("removeSuppressionByIndex", () => {
  it("removes exactly one suppression by index, including invalid records", () => {
    const invalidSuppression = {
      fingerprint: removableFingerprint,
      reason: "   ",
      expiresAt: "2026-08-31",
      note: "broken"
    };
    const keptSuppression = {
      fingerprint: activeFingerprint,
      reason: "Existing exception.",
      expiresAt: "2026-09-01"
    };
    const config: RawDoctorConfig = {
      suppressions: [keptSuppression, invalidSuppression],
      failOnWarnings: true
    };
    const result: SuppressionMutationResult = removeSuppressionByIndex(config, 1);

    expect(result).toEqual({
      config: {
        suppressions: [keptSuppression],
        failOnWarnings: true
      },
      index: 1,
      suppression: invalidSuppression
    });
    expect(result.config).not.toBe(config);
    expect(result.config.suppressions).not.toBe(config.suppressions);
    expect(config).toEqual({
      suppressions: [keptSuppression, invalidSuppression],
      failOnWarnings: true
    });
  });

  it("rejects suppression indexes that are not integers within range", () => {
    const config = {
      suppressions: [
        {
          fingerprint: activeFingerprint,
          reason: "Existing exception.",
          expiresAt: "2026-09-01"
        }
      ]
    };

    expect(() => removeSuppressionByIndex(config, 1)).toThrow(
      "Suppression index must be an integer within range."
    );
    expect(() => removeSuppressionByIndex(config, 0.5)).toThrow(
      "Suppression index must be an integer within range."
    );
  });
});

describe("removeSuppressionByFingerprint", () => {
  it("removes a unique suppression by fingerprint", () => {
    const firstSuppression = {
      fingerprint: activeFingerprint,
      reason: "Existing exception.",
      expiresAt: "2026-09-01"
    };
    const removedSuppression = {
      fingerprint: removableFingerprint,
      reason: "Reviewed exception.",
      expiresAt: "2026-08-31",
      source: "manual"
    };
    const config: RawDoctorConfig = {
      suppressions: [firstSuppression, removedSuppression],
      unknownTopLevel: "kept"
    };
    const result: SuppressionMutationResult = removeSuppressionByFingerprint(
      config,
      removableFingerprint
    );

    expect(result).toEqual({
      config: {
        suppressions: [firstSuppression],
        unknownTopLevel: "kept"
      },
      index: 1,
      suppression: removedSuppression
    });
    expect(result.config).not.toBe(config);
    expect(result.config.suppressions).not.toBe(config.suppressions);
    expect(config).toEqual({
      suppressions: [firstSuppression, removedSuppression],
      unknownTopLevel: "kept"
    });
  });

  it("rejects invalid fingerprints, missing matches, and ambiguous matches", () => {
    expect(() =>
      removeSuppressionByFingerprint({ suppressions: [] }, "A".repeat(64))
    ).toThrow("Suppression fingerprint is invalid.");
    expect(() =>
      removeSuppressionByFingerprint(
        {
          suppressions: [
            {
              fingerprint: activeFingerprint,
              reason: "Existing exception.",
              expiresAt: "2026-09-01"
            }
          ]
        },
        removableFingerprint
      )
    ).toThrow("Suppression fingerprint not found.");

    const duplicateConfig: RawDoctorConfig = {
      suppressions: [
        {
          fingerprint: removableFingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-08-31"
        },
        {
          fingerprint: removableFingerprint,
          reason: "   ",
          expiresAt: "2026-08-31"
        }
      ]
    };

    expect(() =>
      removeSuppressionByFingerprint(duplicateConfig, removableFingerprint)
    ).toThrow(
      "Suppression fingerprint matches multiple suppressions at indexes: 0, 1."
    );
    expect(duplicateConfig).toEqual({
      suppressions: [
        {
          fingerprint: removableFingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-08-31"
        },
        {
          fingerprint: removableFingerprint,
          reason: "   ",
          expiresAt: "2026-08-31"
        }
      ]
    });
  });
});

describe("public API exports", () => {
  it("re-exports suppression management, suppression record, and config store APIs", () => {
    expect(publicApi.listSuppressions).toBe(listSuppressions);
    expect(publicApi.addSuppression).toBe(addSuppression);
    expect(publicApi.removeSuppressionByIndex).toBe(removeSuppressionByIndex);
    expect(publicApi.removeSuppressionByFingerprint).toBe(
      removeSuppressionByFingerprint
    );
    expect(publicApi.validateSuppressionRecord).toBeTypeOf("function");
    expect(publicApi.classifySuppressionRecord).toBeTypeOf("function");
    expect(publicApi.readRawDoctorConfig).toBeTypeOf("function");
    expect(publicApi.writeRawDoctorConfig).toBeTypeOf("function");
  });
});
