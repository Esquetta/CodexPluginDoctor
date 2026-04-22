import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import { buildJsonReport } from "../src/reporting/render-json-report.js";

describe("buildJsonReport", () => {
  it("wraps check results in a stable report envelope", async () => {
    const targetPath = path.resolve("tests/fixtures/valid-plugin-with-mcp");
    const result = await runCheck(targetPath);

    const report = buildJsonReport(result, { runtimeProbeEnabled: false });

    expect(report.schemaVersion).toBe("1.0.0");
    expect(report.summary.targetPath).toBe(targetPath);
    expect(report.summary.status).toBe("pass");
    expect(report.summary.exitCode).toBe(0);
    expect(report.summary.runtimeProbeEnabled).toBe(false);
    expect(report.summary.findingCounts).toEqual({
      fail: 0,
      warn: 0,
      total: 0
    });
    expect(Array.isArray(report.findings)).toBe(true);
  });
});

