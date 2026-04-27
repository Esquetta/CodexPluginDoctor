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

  it("fails when the manifest points to a missing .mcp.json file", async () => {
    const targetPath = path.resolve("tests/fixtures/mcp-config-missing");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.mcp.path.missing",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when .mcp.json does not expose a valid mcpServers object", async () => {
    const targetPath = path.resolve("tests/fixtures/mcp-config-invalid");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.mcp.invalid_shape",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when a declared skill directory does not contain SKILL.md", async () => {
    const targetPath = path.resolve("tests/fixtures/skill-missing-skill-md");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.skill.skill_md.missing",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when SKILL.md is missing required frontmatter fields", async () => {
    const targetPath = path.resolve("tests/fixtures/skill-missing-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.skill.description.missing",
          severity: "fail"
        })
      ])
    );
  });

  it("passes when the plugin includes a valid .mcp.json file and valid skills", async () => {
    const targetPath = path.resolve("tests/fixtures/valid-plugin-with-mcp");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("fails when plugin paths escape the package root", async () => {
    const targetPath = path.resolve("tests/fixtures/security-path-traversal");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.security.path_traversal",
          severity: "fail"
        })
      ])
    );
  });

  it("fails when MCP config contains hard-coded secret values", async () => {
    const targetPath = path.resolve("tests/fixtures/security-hardcoded-secret");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.security.hard_coded_secret",
          severity: "fail"
        })
      ])
    );
  });

  it("returns a warn status when only plugin metadata verbosity heuristics fail", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-long-plugin-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.heuristic.description.too_long",
          severity: "warn"
        })
      ])
    );
  });

  it("returns a warn status when skill descriptions are overly verbose", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-long-skill-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.heuristic.skill_description.too_long",
          severity: "warn"
        })
      ])
    );
  });

  it("passes when a long skill description is specific and operationally dense", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-long-skill-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
  });

  it("still warns when a long skill description is vague despite its length", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-vague-long-skill-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("warn");
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.heuristic.skill_description.too_long",
          severity: "warn"
        })
      ])
    );
  });
});
