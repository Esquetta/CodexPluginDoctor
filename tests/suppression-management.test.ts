import { describe, expect, it } from "vitest";

import * as publicApi from "../src/index.js";
import type { RawDoctorConfig } from "../src/core/doctor-config-store.js";
import {
  addSuppression,
  listSuppressions,
  pruneSuppressions,
  removeSuppressionByFingerprint,
  removeSuppressionByIndex,
  SuppressionManagementError,
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
            reason: "token sk_live_invalid_reason",
            expiresAt: "secret-date-2026-07-31",
            token: "ghp_should_not_echo"
          },
          {
            fingerprint: invalidReasonFingerprint,
            reason: "   ",
            expiresAt: "2026-07-31",
            metadata: { internal: true },
            secret: "sk_test_hidden"
          },
          "sk_live_raw_string_secret"
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
        invalidField: "fingerprint"
      },
      {
        index: 3,
        status: "invalid",
        invalidField: "reason"
      },
      {
        index: 4,
        status: "invalid",
        invalidField: "record"
      }
    ]);
    expect(records[2]).not.toHaveProperty("fingerprint");
    expect(records[2]).not.toHaveProperty("reason");
    expect(records[2]).not.toHaveProperty("expiresAt");
    expect(JSON.stringify(records)).not.toContain("ghp_should_not_echo");
    expect(JSON.stringify(records)).not.toContain("sk_live_raw_string_secret");
    expect(JSON.stringify(records)).not.toContain("sk_test_hidden");
  });

  it("rejects a non-array suppressions value consistently", () => {
    const config = {
      suppressions: {
        fingerprint: activeFingerprint
      }
    };

    for (const operation of [
      () => listSuppressions(config),
      () =>
        addSuppression(config, {
          fingerprint: removableFingerprint,
          reason: "Reviewed exception.",
          expiresAt: "2026-08-31"
        }),
      () => removeSuppressionByIndex(config, 0),
      () => removeSuppressionByFingerprint(config, removableFingerprint)
    ]) {
      try {
        operation();
        throw new Error("expected operation to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SuppressionManagementError);
        expect(error).toMatchObject({
          code: "suppression_non_array"
        });
      }
    }
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
            expiresAt: "2026-08-31"
          }
        ],
        unknownTopLevel: { keep: true }
      },
      index: 1,
      suppression: {
        fingerprint: removableFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-08-31"
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
    try {
      addSuppression(
        { suppressions: [] },
        {
          fingerprint: "A".repeat(64),
          reason: "Reviewed exception.",
          expiresAt: "2026-08-31"
        }
      );
      throw new Error("expected addSuppression to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressionManagementError);
      expect(error).toMatchObject({
        code: "suppression_invalid_record",
        field: "fingerprint"
      });
    }
  });

  it("rejects a duplicate fingerprint using the first matching config index", () => {
    try {
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
      );
      throw new Error("expected addSuppression to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressionManagementError);
      expect(error).toMatchObject({
        code: "suppression_duplicate_fingerprint",
        index: 0
      });
    }
  });
});

describe("removeSuppressionByIndex", () => {
  it("removes exactly one invalid suppression by index using a safe summary", () => {
    const invalidSuppression = {
      fingerprint: removableFingerprint,
      reason: "   ",
      expiresAt: "2026-08-31",
      note: "broken",
      secret: "ghp_invalid_secret"
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
      suppression: {
        invalidField: "reason"
      }
    });
    expect(result.suppression).not.toBe(invalidSuppression);
    expect(result.suppression).not.toHaveProperty("secret");
    expect(result.config).not.toBe(config);
    expect(result.config.suppressions).not.toBe(config.suppressions);
    expect(config).toEqual({
      suppressions: [keptSuppression, invalidSuppression],
      failOnWarnings: true
    });
  });

  it("removes exactly one valid suppression by index using a canonical summary", () => {
    const removedSuppression = {
      fingerprint: removableFingerprint,
      reason: "Reviewed exception.",
      expiresAt: "2026-08-31",
      secret: "sk_live_keep_out"
    };
    const config: RawDoctorConfig = {
      suppressions: [removedSuppression]
    };
    const result = removeSuppressionByIndex(config, 0);

    expect(result).toEqual({
      config: {
        suppressions: []
      },
      index: 0,
      suppression: {
        fingerprint: removableFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-08-31"
      }
    });
    expect(result.suppression).not.toBe(removedSuppression);
    expect(result.suppression).not.toHaveProperty("secret");
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

    for (const invalidIndex of [1, 0.5]) {
      try {
        removeSuppressionByIndex(config, invalidIndex);
        throw new Error("expected removeSuppressionByIndex to reject");
      } catch (error) {
        expect(error).toBeInstanceOf(SuppressionManagementError);
        expect(error).toMatchObject({
          code: "suppression_invalid_index",
          index: invalidIndex
        });
      }
    }
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
      suppression: {
        fingerprint: removableFingerprint,
        reason: "Reviewed exception.",
        expiresAt: "2026-08-31"
      }
    });
    expect(result.suppression).not.toBe(removedSuppression);
    expect(result.suppression).not.toHaveProperty("source");
    expect(result.config).not.toBe(config);
    expect(result.config.suppressions).not.toBe(config.suppressions);
    expect(config).toEqual({
      suppressions: [firstSuppression, removedSuppression],
      unknownTopLevel: "kept"
    });
  });

  it("rejects invalid fingerprints, missing matches, and ambiguous matches", () => {
    try {
      removeSuppressionByFingerprint({ suppressions: [] }, "A".repeat(64));
      throw new Error("expected invalid fingerprint to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressionManagementError);
      expect(error).toMatchObject({
        code: "suppression_invalid_fingerprint"
      });
    }
    try {
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
      );
      throw new Error("expected missing fingerprint to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressionManagementError);
      expect(error).toMatchObject({
        code: "suppression_fingerprint_not_found"
      });
    }

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

    try {
      removeSuppressionByFingerprint(duplicateConfig, removableFingerprint);
      throw new Error("expected ambiguous fingerprint to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SuppressionManagementError);
      expect(error).toMatchObject({
        code: "suppression_fingerprint_ambiguous",
        indexes: [0, 1]
      });
    }
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

describe("pruneSuppressions", () => {
  it("removes expired and invalid suppressions without mutating the input config", () => {
    const activeSuppression = {
      fingerprint: activeFingerprint,
      reason: "Active exception.",
      expiresAt: "2026-09-01"
    };
    const expiredSuppression = {
      fingerprint: expiredFingerprint,
      reason: "Expired exception.",
      expiresAt: "2026-07-31",
      secret: "sk_expired_secret"
    };
    const invalidSuppression = {
      fingerprint: invalidReasonFingerprint,
      reason: "   ",
      expiresAt: "2026-09-01",
      secret: "ghp_invalid_secret"
    };
    const config: RawDoctorConfig = {
      unknownTopLevel: { keep: true },
      suppressions: [activeSuppression, expiredSuppression, invalidSuppression]
    };

    const result = pruneSuppressions(
      config,
      new Date("2026-08-01T00:00:00.000Z")
    );

    expect(result).toEqual({
      config: {
        unknownTopLevel: { keep: true },
        suppressions: [activeSuppression]
      },
      removed: [
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
          invalidField: "reason"
        }
      ]
    });
    expect(result.config).not.toBe(config);
    expect(result.config.suppressions).not.toBe(config.suppressions);
    expect(JSON.stringify(result.removed)).not.toContain("sk_expired_secret");
    expect(JSON.stringify(result.removed)).not.toContain("ghp_invalid_secret");
    expect(config).toEqual({
      unknownTopLevel: { keep: true },
      suppressions: [activeSuppression, expiredSuppression, invalidSuppression]
    });
  });
});

describe("public API exports", () => {
  it("re-exports suppression management, suppression record, and config store APIs", () => {
    expect(publicApi.listSuppressions).toBe(listSuppressions);
    expect(publicApi.addSuppression).toBe(addSuppression);
    expect(publicApi.pruneSuppressions).toBe(pruneSuppressions);
    expect(publicApi.removeSuppressionByIndex).toBe(removeSuppressionByIndex);
    expect(publicApi.removeSuppressionByFingerprint).toBe(
      removeSuppressionByFingerprint
    );
    expect(publicApi.SuppressionManagementError).toBe(
      SuppressionManagementError
    );
    expect(publicApi.isValidSuppressionFingerprint).toBeTypeOf("function");
    expect(publicApi.validateSuppressionRecord).toBeTypeOf("function");
    expect(publicApi.classifySuppressionRecord).toBeTypeOf("function");
    expect(publicApi.readRawDoctorConfig).toBeTypeOf("function");
    expect(publicApi.writeRawDoctorConfig).toBeTypeOf("function");
  });
});
