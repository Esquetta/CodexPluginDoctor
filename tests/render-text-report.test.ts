import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";
import { renderTextReport } from "../src/reporting/render-text-report.js";

describe("renderTextReport", () => {
  it("renders a rich unicode summary for warn results", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/heuristic-long-plugin-description")
    );

    expect(renderTextReport(result)).toMatchInlineSnapshot(`
      "Codex Plugin Doctor
      ===================
      Status: WARN
      Target: D:\\Workstation\\CodexPluginDoctor\\tests\\fixtures\\heuristic-long-plugin-description
      Summary: 0 fail, 1 warn, 1 total
      
      Warnings
      --------
      ! plugin.heuristic.description.too_long
        Message: The plugin manifest description is likely too verbose.
        Impact: Overly long metadata increases context cost and can dilute plugin discovery quality.
        Suggested fix: Shorten the manifest description to a precise one- or two-sentence summary."
    `);
  });

  it("renders an ASCII-safe summary when requested", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/security-hardcoded-secret")
    );

    expect(renderTextReport(result, { ascii: true })).toMatchInlineSnapshot(`
      "Codex Plugin Doctor
      ===================
      Status: FAIL
      Target: D:\\Workstation\\CodexPluginDoctor\\tests\\fixtures\\security-hardcoded-secret
      Summary: 1 fail, 0 warn, 1 total
      
      Failures
      --------
      x plugin.security.hard_coded_secret
        Message: The MCP server \`dangerServer\` contains a hard-coded secret-like env value for \`OPENAI_API_KEY\`.
        Impact: Hard-coded credentials inside plugin bundles increase leakage risk and make secure rotation difficult.
        Suggested fix: Replace the literal value for \`OPENAI_API_KEY\` with an environment reference or injected secret outside the package."
    `);
  });
});
