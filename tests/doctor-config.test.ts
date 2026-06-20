import { describe, expect, it } from "vitest";

import {
  applyDoctorConfig,
  type DoctorConfig
} from "../src/core/doctor-config.js";
import type { CheckResult, Finding } from "../src/domain/types.js";

const alphaFingerprint = "a".repeat(64);
const betaFingerprint = "b".repeat(64);

function finding(
  id: string,
  fingerprint: string,
  severity: Finding["severity"] = "fail"
): Finding {
  return {
    id,
    severity,
    message: `${id} message`,
    impact: `${id} impact`,
    suggestedFix: `${id} fix`,
    fingerprint
  };
}

function result(findings: Finding[]): CheckResult {
  return {
    targetPath: "C:\\repo\\plugin",
    status: findings.some((item) => item.severity === "fail") ? "fail" : "warn",
    exitCode: findings.some((item) => item.severity === "fail") ? 1 : 0,
    findings
  };
}

function config(overrides: Partial<DoctorConfig> = {}): DoctorConfig {
  return {
    ignoreRules: [],
    failOnWarnings: false,
    suppressions: [],
    ...overrides
  };
}

describe("targeted suppressions", () => {
  it("moves one exact active finding to suppressed findings", () => {
    const configured = config({
      suppressions: [
        {
          fingerprint: alphaFingerprint,
          reason: "  Accepted risk.  ",
          expiresAt: "2026-07-31"
        }
      ]
    });

    const applied = applyDoctorConfig(
      result([
        finding("plugin.skill.skill_md.missing", alphaFingerprint),
        finding("plugin.skill.skill_md.missing", betaFingerprint)
      ]),
      configured,
      { now: new Date("2026-07-31T23:59:59.999Z") }
    );

    expect(applied.status).toBe("fail");
    expect(applied.findings.map((item) => item.fingerprint)).toEqual([
      betaFingerprint
    ]);
    expect(applied.suppressedFindings).toEqual([
      expect.objectContaining({
        fingerprint: alphaFingerprint,
        suppression: {
          reason: "Accepted risk.",
          expiresAt: "2026-07-31"
        }
      })
    ]);
    expect(applied.suppressionSummary).toEqual({
      applied: 1,
      expired: 0,
      invalid: 0
    });
  });

  it("treats the suppression as expired at the next UTC day", () => {
    const applied = applyDoctorConfig(
      result([finding("plugin.skill.skill_md.missing", alphaFingerprint)]),
      config({
        suppressions: [
          {
            fingerprint: alphaFingerprint,
            reason: "Accepted risk.",
            expiresAt: "2026-07-31"
          }
        ]
      }),
      { now: new Date("2026-08-01T00:00:00.000Z") }
    );

    expect(applied.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fingerprint: alphaFingerprint }),
        expect.objectContaining({
          id: "suppression.expired",
          severity: "warn",
          evidence: {
            suppressionIndex: 0,
            fingerprint: alphaFingerprint,
            expiresAt: "2026-07-31"
          }
        })
      ])
    );
    expect(applied.suppressionSummary).toEqual({
      applied: 0,
      expired: 1,
      invalid: 0
    });
  });

  it.each([
    [null, "record"],
    [{ fingerprint: "INVALID", reason: "Accepted.", expiresAt: "2026-07-31" }, "fingerprint"],
    [{ fingerprint: alphaFingerprint, reason: "   ", expiresAt: "2026-07-31" }, "reason"],
    [{ fingerprint: alphaFingerprint, reason: "Accepted.", expiresAt: "2026-02-30" }, "expiresAt"]
  ])("reports one bounded invalid warning for %j", (suppression, field) => {
    const applied = applyDoctorConfig(
      result([finding("plugin.skill.skill_md.missing", alphaFingerprint)]),
      config({ suppressions: [suppression] }),
      { now: new Date("2026-07-01T00:00:00.000Z") }
    );

    expect(applied.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "suppression.invalid",
          evidence: {
            suppressionIndex: 0,
            field
          }
        })
      ])
    );
    expect(JSON.stringify(applied.findings)).not.toContain("INVALID");
    expect(applied.suppressionSummary?.invalid).toBe(1);
  });

  it("uses the first active duplicate and keeps unmatched valid records silent", () => {
    const applied = applyDoctorConfig(
      result([finding("plugin.skill.skill_md.missing", alphaFingerprint)]),
      config({
        suppressions: [
          {
            fingerprint: alphaFingerprint,
            reason: "First.",
            expiresAt: "2026-07-31"
          },
          {
            fingerprint: alphaFingerprint,
            reason: "Second.",
            expiresAt: "2026-08-31"
          },
          {
            fingerprint: betaFingerprint,
            reason: "Unmatched.",
            expiresAt: "2026-08-31"
          }
        ]
      }),
      { now: new Date("2026-07-01T00:00:00.000Z") }
    );

    expect(applied.findings).toEqual([]);
    expect(applied.suppressedFindings?.[0].suppression.reason).toBe("First.");
    expect(applied.suppressionSummary).toEqual({
      applied: 1,
      expired: 0,
      invalid: 0
    });
  });

  it("applies ignore rules before suppressions and fail-on-warnings after warnings", () => {
    const applied = applyDoctorConfig(
      result([
        finding("plugin.ignored", alphaFingerprint),
        finding("plugin.active", betaFingerprint)
      ]),
      config({
        ignoreRules: ["plugin.ignored"],
        failOnWarnings: true,
        suppressions: [
          {
            fingerprint: alphaFingerprint,
            reason: "Ignored first.",
            expiresAt: "2026-07-31"
          },
          {
            fingerprint: "invalid",
            reason: "Not echoed.",
            expiresAt: "2026-07-31"
          },
          {
            fingerprint: betaFingerprint,
            reason: "Active suppression.",
            expiresAt: "2026-07-31"
          }
        ]
      }),
      { now: new Date("2026-07-01T00:00:00.000Z") }
    );

    expect(applied.status).toBe("fail");
    expect(applied.exitCode).toBe(1);
    expect(applied.suppressedFindings).toHaveLength(1);
    expect(applied.findings).toEqual([
      expect.objectContaining({ id: "suppression.invalid", severity: "warn" })
    ]);
  });
});
