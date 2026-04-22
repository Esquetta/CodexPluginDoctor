import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";

describe("runCheck", () => {
  it("returns a blocking failure when the plugin manifest is missing", async () => {
    const targetPath = path.resolve("tests/fixtures/missing-manifest");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.manifest.missing",
          severity: "fail"
        })
      ])
    );
  });

  it("passes when the plugin manifest and referenced skills directory exist", async () => {
    const targetPath = path.resolve("tests/fixtures/valid-plugin");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });
});

