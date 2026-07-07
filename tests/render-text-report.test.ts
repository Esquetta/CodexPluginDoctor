import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import type { CheckResult } from "../src/domain/types.js";
import { renderTextReport } from "../src/reporting/render-text-report.js";

describe("renderTextReport", () => {
  it("renders a rich unicode summary for warn results", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/heuristic-long-plugin-description")
    );
    const output = renderTextReport(result);

    expect(output).toContain("Status: WARN");
    expect(output).toContain(`Target: ${result.targetPath}`);
    expect(output).toContain("Summary: 0 fail, 1 warn, 1 total");
    expect(output).toContain("! plugin.heuristic.description.too_long");
    expect(output).toContain("Suggested fix: Shorten the manifest description");
  });

  it("renders an ASCII-safe summary when requested", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/security-hardcoded-secret")
    );
    const output = renderTextReport(result, { ascii: true });

    expect(output).toContain("Status: FAIL");
    expect(output).toContain(`Target: ${result.targetPath}`);
    expect(output).toContain("Summary: 1 fail, 0 warn, 1 total");
    expect(output).toContain("x plugin.security.hard_coded_secret");
    expect(output).toContain("Suggested fix: Replace the literal value");
    expect(output).toMatch(/Fingerprint: [a-f0-9]{64}/);
    expect(output).toContain("Evidence: serverName=dangerServer");
    expect(output).toContain("envKey=OPENAI_API_KEY");
    expect(output).toContain("envValue=[REDACTED]");
  });

  it("renders deduplicated next actions for explained reports", () => {
    const result: CheckResult = {
      targetPath: "example",
      status: "fail",
      exitCode: 1,
      findings: [
        {
          id: "plugin.manifest.missing",
          severity: "fail",
          message: "Missing manifest.",
          impact: "Codex cannot load the package.",
          suggestedFix: "Create `.codex-plugin/plugin.json`."
        },
        {
          id: "plugin.manifest.name.missing",
          severity: "fail",
          message: "Missing name.",
          impact: "Codex cannot identify the package.",
          suggestedFix: "Create `.codex-plugin/plugin.json`."
        },
        {
          id: "plugin.heuristic.description.too_long",
          severity: "warn",
          message: "Description is too long.",
          impact: "Discovery is less precise.",
          suggestedFix: "Shorten the manifest description."
        }
      ]
    };

    const output = renderTextReport(result, { explain: true });

    expect(output).toContain("Next Actions\n------------");
    expect(output).toContain("1. Create `.codex-plugin/plugin.json`.");
    expect(output).toContain("2. Shorten the manifest description.");
    expect(output).not.toContain("3. Create `.codex-plugin/plugin.json`.");
  });
});
