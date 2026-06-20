import { describe, expect, it } from "vitest";

import type { CheckResult } from "../src/domain/types.js";
import { buildJsonReport } from "../src/reporting/render-json-report.js";
import { buildMarkdownReport } from "../src/reporting/render-markdown-report.js";
import { renderSarifReport } from "../src/reporting/render-sarif-report.js";
import { renderTextReport } from "../src/reporting/render-text-report.js";

const activeFingerprint = "a".repeat(64);
const suppressedFingerprint = "b".repeat(64);

function suppressionResult(): CheckResult {
  return {
    targetPath: "C:\\repo\\plugin",
    status: "warn",
    exitCode: 0,
    findings: [
      {
        id: "plugin.heuristic.description.too_long",
        severity: "warn",
        message: "Active warning.",
        impact: "Active impact.",
        suggestedFix: "Active fix.",
        fingerprint: activeFingerprint
      }
    ],
    suppressedFindings: [
      {
        id: "plugin.skill.skill_md.missing",
        severity: "fail",
        message: "Suppressed failure.",
        impact: "Suppressed impact.",
        suggestedFix: "Suppressed fix.",
        fingerprint: suppressedFingerprint,
        evidence: {
          skillName: "alpha",
          skillPath: "skills/alpha/SKILL.md"
        },
        suppression: {
          reason: "Accepted until upstream fix.",
          expiresAt: "2026-07-31"
        }
      }
    ],
    suppressionSummary: {
      applied: 1,
      expired: 0,
      invalid: 0
    }
  };
}

describe("suppression report surfaces", () => {
  it("includes suppression metadata in JSON reports", () => {
    const report = buildJsonReport(suppressionResult(), {
      runtimeProbeEnabled: false
    });

    expect(report.suppressionSummary).toEqual({
      applied: 1,
      expired: 0,
      invalid: 0
    });
    expect(report.suppressedFindings).toEqual([
      expect.objectContaining({
        fingerprint: suppressedFingerprint,
        suppression: {
          reason: "Accepted until upstream fix.",
          expiresAt: "2026-07-31"
        }
      })
    ]);
    expect(report.findings).toHaveLength(1);
  });

  it("renders suppression summaries and audit details in text", () => {
    const output = renderTextReport(suppressionResult(), { ascii: true });

    expect(output).toContain("Suppressions: 1 applied, 0 expired, 0 invalid");
    expect(output).toContain("Suppressed Findings");
    expect(output).toContain(`Fingerprint: ${suppressedFingerprint}`);
    expect(output).toContain("Reason: Accepted until upstream fix.");
    expect(output).toContain("Expires: 2026-07-31");
  });

  it("renders suppression summaries and audit details in Markdown", () => {
    const output = buildMarkdownReport(suppressionResult(), {
      runtimeProbeEnabled: false
    });

    expect(output).toContain("| Suppressions Applied | 1 |");
    expect(output).toContain("## Suppressed Findings");
    expect(output).toContain(`- Fingerprint: \`${suppressedFingerprint}\``);
    expect(output).toContain("- Reason: Accepted until upstream fix.");
    expect(output).toContain("- Expires: 2026-07-31");
  });

  it("keeps suppressed findings out of SARIF results but preserves run metadata", () => {
    const report = JSON.parse(renderSarifReport(suppressionResult()));

    expect(report.runs[0].results).toHaveLength(1);
    expect(report.runs[0].results[0].ruleId).toBe(
      "plugin.heuristic.description.too_long"
    );
    expect(report.runs[0].properties.suppressionSummary).toEqual({
      applied: 1,
      expired: 0,
      invalid: 0
    });
    expect(report.runs[0].properties.suppressedFindings).toEqual([
      expect.objectContaining({
        fingerprint: suppressedFingerprint,
        suppression: {
          reason: "Accepted until upstream fix.",
          expiresAt: "2026-07-31"
        }
      })
    ]);
  });
});
