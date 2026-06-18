import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
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
});
