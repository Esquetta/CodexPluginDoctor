import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";

describe("runtime protocol probing", () => {
  it("passes when the stdio server completes initialize, returns a valid tools list, and supports tools/call", async () => {
    const result = await runCheck(path.resolve("tests/fixtures/runtime-valid"), {
      runtime: true
    });

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("fails when initialize returns an invalid MCP response", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-initialize"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.initialize.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when tools/list returns invalid tool definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-tools"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tools_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when tools/call returns an invalid result payload", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-call"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tool_call.invalid",
          severity: "fail"
        })
      ])
    );
  });
});
