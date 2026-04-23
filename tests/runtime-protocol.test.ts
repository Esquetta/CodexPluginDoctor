import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";

describe("runtime protocol probing", () => {
  it("passes when the stdio server completes initialize and supports tools, resources, prompts, read, and get probing", async () => {
    const result = await runCheck(path.resolve("tests/fixtures/runtime-valid"), {
      runtime: true
    });

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard).toBeDefined();
    expect(result.runtimeScorecard?.initialize).toBe("pass");
    expect(result.runtimeScorecard?.toolsList).toBe("pass");
    expect(result.runtimeScorecard?.toolsCall).toBe("pass");
    expect(result.runtimeScorecard?.resourcesList).toBe("pass");
    expect(result.runtimeScorecard?.resourceRead).toBe("pass");
    expect(result.runtimeScorecard?.resourceTemplatesList).toBe("pass");
    expect(result.runtimeScorecard?.promptsList).toBe("pass");
    expect(result.runtimeScorecard?.promptGet).toBe("pass");
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

  it("passes when a safe tool requires generated arguments from its schema", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-generated-tool"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard?.toolsCall).toBe("pass");
  });

  it("warns and skips tool invocation when only destructive tools are available", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-destructive-tool"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.runtimeScorecard?.toolsCall).toBe("skipped");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tool_call.skipped",
          severity: "warn"
        })
      ])
    );
  });

  it("fails when resources/list returns invalid resource definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-resources"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.resources_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when prompts/list returns invalid prompt definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-prompts"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.prompts_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when resources/read returns invalid resource contents", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-read"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.resource_read.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when prompts/get returns invalid prompt messages", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-get"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.prompt_get.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("passes when list operations paginate across multiple pages", async () => {
    const result = await runCheck(path.resolve("tests/fixtures/runtime-paginated"), {
      runtime: true
    });

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
    expect(result.runtimeScorecard?.toolsList).toBe("pass");
    expect(result.runtimeScorecard?.resourcesList).toBe("pass");
    expect(result.runtimeScorecard?.resourceTemplatesList).toBe("pass");
    expect(result.runtimeScorecard?.promptsList).toBe("pass");
  });

  it("fails when resources/templates/list returns invalid resource template definitions", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-invalid-templates"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.resource_templates_list.invalid",
          severity: "fail"
        })
      ])
    );
  });

  it("warns when runtime payloads are structurally valid but excessively large", async () => {
    const result = await runCheck(
      path.resolve("tests/fixtures/runtime-large-payloads"),
      {
        runtime: true
      }
    );

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.runtime.tool_call.content_too_large",
          severity: "warn"
        }),
        expect.objectContaining({
          id: "plugin.runtime.resource_read.content_too_large",
          severity: "warn"
        }),
        expect.objectContaining({
          id: "plugin.runtime.prompt_get.content_too_large",
          severity: "warn"
        })
      ])
    );
  });
});
