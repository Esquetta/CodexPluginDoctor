import { describe, expect, it } from "vitest";

import type { ManagedSuppressionRecord, SuppressionMutationResult } from "../src/core/suppression-management.js";
import {
  renderSuppressionList,
  renderSuppressionListJson,
  renderSuppressionMutation,
  renderSuppressionMutationJson
} from "../src/reporting/render-suppression-management.js";

const configPath = "C:\\repo\\.codex-doctor.json";
const activeFingerprint = "a".repeat(64);
const expiredFingerprint = "b".repeat(64);
const addedFingerprint = "c".repeat(64);

describe("renderSuppressionList", () => {
  it("renders active, expired, and invalid suppression entries in ASCII-safe text", () => {
    const suppressions: ManagedSuppressionRecord[] = [
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
        invalidField: "fingerprint",
        fingerprint: "should-not-render",
        reason: "sk_test_should_not_render",
        expiresAt: "2099-12-31"
      } as ManagedSuppressionRecord
    ];

    expect(renderSuppressionList(configPath, suppressions)).toBe(
      [
        `Config: ${configPath}`,
        "Total suppressions: 3",
        "",
        "Suppressions",
        "------------",
        `[0] ACTIVE ${activeFingerprint}`,
        "  Reason: Reviewed exception.",
        "  Expires: 2026-08-31",
        `[1] EXPIRED ${expiredFingerprint}`,
        "  Reason: Expired exception.",
        "  Expires: 2026-07-31",
        "[2] INVALID fingerprint"
      ].join("\n")
    );
  });

  it("renders an empty list clearly", () => {
    expect(renderSuppressionList(configPath, [])).toBe(
      [`Config: ${configPath}`, "Total suppressions: 0", "", "No suppressions."].join(
        "\n"
      )
    );
  });
});

describe("renderSuppressionListJson", () => {
  it("renders a stable JSON envelope without leaking invalid raw values", () => {
    const suppressions: ManagedSuppressionRecord[] = [
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
        invalidField: "record",
        fingerprint: "should-not-render",
        reason: "ghp_should_not_render",
        expiresAt: "2099-12-31"
      } as ManagedSuppressionRecord
    ];
    const output = renderSuppressionListJson(configPath, suppressions);

    expect(JSON.parse(output)).toEqual({
      schemaVersion: "1.0.0",
      command: "suppress.list",
      configPath,
      suppressions: [
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
          invalidField: "record"
        }
      ]
    });
    expect(output).not.toContain("should-not-render");
    expect(output).not.toContain("ghp_should_not_render");
  });
});

describe("renderSuppressionMutation", () => {
  it("renders a canonical added suppression summary", () => {
    const result: SuppressionMutationResult = {
      config: { suppressions: [] },
      index: 2,
      suppression: {
        fingerprint: addedFingerprint,
        reason: "Accepted until upstream fix.",
        expiresAt: "2026-09-15"
      }
    };

    expect(
      renderSuppressionMutation("suppress.add", configPath, result)
    ).toBe(
      [
        "Action: Added",
        `Config: ${configPath}`,
        "Index: 2",
        "",
        `Fingerprint: ${addedFingerprint}`,
        "Reason: Accepted until upstream fix.",
        "Expires: 2026-09-15"
      ].join("\n")
    );
  });

  it("renders a canonical removed suppression summary for valid entries", () => {
    const result: SuppressionMutationResult = {
      config: { suppressions: [] },
      index: 1,
      suppression: {
        fingerprint: expiredFingerprint,
        reason: "Expired exception.",
        expiresAt: "2026-07-31"
      }
    };

    expect(
      renderSuppressionMutation("suppress.remove", configPath, result)
    ).toBe(
      [
        "Action: Removed",
        `Config: ${configPath}`,
        "Index: 1",
        "",
        `Fingerprint: ${expiredFingerprint}`,
        "Reason: Expired exception.",
        "Expires: 2026-07-31"
      ].join("\n")
    );
  });

  it("renders invalid removals with only the invalid field", () => {
    const result: SuppressionMutationResult = {
      config: { suppressions: [] },
      index: 4,
      suppression: {
        invalidField: "reason",
        fingerprint: "should-not-render",
        reason: "sk_test_should_not_render",
        expiresAt: "2099-12-31"
      }
    };
    const output = renderSuppressionMutation(
      "suppress.remove",
      configPath,
      result
    );

    expect(output).toBe(
      [
        "Action: Removed",
        `Config: ${configPath}`,
        "Index: 4",
        "",
        "Invalid field: reason"
      ].join("\n")
    );
    expect(output).not.toContain("should-not-render");
    expect(output).not.toContain("sk_test_should_not_render");
  });
});

describe("renderSuppressionMutationJson", () => {
  it("renders add results in the stable JSON envelope", () => {
    const result: SuppressionMutationResult = {
      config: { suppressions: [] },
      index: 2,
      suppression: {
        fingerprint: addedFingerprint,
        reason: "Accepted until upstream fix.",
        expiresAt: "2026-09-15"
      }
    };

    expect(
      JSON.parse(
        renderSuppressionMutationJson("suppress.add", configPath, result)
      )
    ).toEqual({
      schemaVersion: "1.0.0",
      command: "suppress.add",
      configPath,
      index: 2,
      suppression: {
        fingerprint: addedFingerprint,
        reason: "Accepted until upstream fix.",
        expiresAt: "2026-09-15"
      }
    });
  });

  it("renders invalid remove results without raw values", () => {
    const result: SuppressionMutationResult = {
      config: { suppressions: [] },
      index: 4,
      suppression: {
        invalidField: "reason",
        fingerprint: "should-not-render",
        reason: "ghp_should_not_render",
        expiresAt: "2099-12-31"
      }
    };
    const output = renderSuppressionMutationJson(
      "suppress.remove",
      configPath,
      result
    );

    expect(JSON.parse(output)).toEqual({
      schemaVersion: "1.0.0",
      command: "suppress.remove",
      configPath,
      index: 4,
      suppression: {
        invalidField: "reason"
      }
    });
    expect(output).not.toContain("should-not-render");
    expect(output).not.toContain("ghp_should_not_render");
  });
});
