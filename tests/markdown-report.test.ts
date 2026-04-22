import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import { buildMarkdownReport } from "../src/reporting/render-markdown-report.js";

describe("buildMarkdownReport", () => {
  it("renders a CI-friendly markdown summary", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-long-plugin-description");
    const result = await runCheck(targetPath);

    const report = buildMarkdownReport(result, { runtimeProbeEnabled: false });

    expect(report).toContain("# Codex Plugin Doctor Report");
    expect(report).toContain("Status | WARN");
    expect(report).toContain("plugin.heuristic.description.too_long");
  });
});
