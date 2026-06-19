import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runCheck } from "../src/index.js";

async function createPluginWithMissingSkillFiles(): Promise<string> {
  const targetPath = await mkdtemp(
    path.join(os.tmpdir(), "codex-plugin-doctor-evidence-")
  );

  await mkdir(path.join(targetPath, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(targetPath, "skills", "alpha"), { recursive: true });
  await mkdir(path.join(targetPath, "skills", "beta"), { recursive: true });
  await writeFile(
    path.join(targetPath, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "evidence-fixture",
      version: "1.0.0",
      description: "Evidence fixture.",
      skills: "./skills"
    }),
    "utf8"
  );

  return targetPath;
}

describe("runCheck", () => {
  it("distinguishes repeated skill findings with package-relative evidence", async () => {
    const targetPath = await createPluginWithMissingSkillFiles();

    const result = await runCheck(targetPath);
    const findings = result.findings.filter(
      (finding) => finding.id === "plugin.skill.skill_md.missing"
    );

    expect(findings).toHaveLength(2);
    expect(findings.map((finding) => finding.evidence)).toEqual([
      {
        skillName: "alpha",
        skillPath: "skills/alpha/SKILL.md"
      },
      {
        skillName: "beta",
        skillPath: "skills/beta/SKILL.md"
      }
    ]);
    expect(new Set(findings.map((finding) => finding.fingerprint)).size).toBe(2);
  });

  it("returns a blocking failure when the plugin manifest is missing", async () => {
    const targetPath = path.resolve("tests/fixtures/missing-manifest");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.manifest.missing",
          severity: "fail",
          fingerprint: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      ])
    );
  });

  it("explains when the Codex Plugin Doctor source repo is checked instead of a plugin package", async () => {
    const targetPath = path.resolve(".");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "plugin.manifest.missing",
        message: expect.stringContaining("Codex Plugin Doctor source repo"),
        suggestedFix: expect.stringContaining(
          "codex-plugin-doctor check examples/codex-doctor-runtime --runtime --no-animations"
        )
      })
    ]);
  });

  it("guides normal non-plugin projects to pass a Codex plugin package root", async () => {
    const targetPath = path.resolve("tests/fixtures/node-project-missing-manifest");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.findings).toEqual([
      expect.objectContaining({
        id: "plugin.manifest.missing",
        message: expect.stringContaining("does not look like a Codex plugin package"),
        suggestedFix: expect.stringContaining(
          "Run from a Codex plugin package root"
        )
      })
    ]);
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

  it("warns when a skill references a missing local support asset", async () => {
    const targetPath = path.resolve("tests/fixtures/skill-missing-asset-reference");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("warn");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "plugin.skill.asset_reference.missing",
          severity: "warn"
        })
      ])
    );
  });

  it("passes when a skill referenced support asset exists", async () => {
    const targetPath = path.resolve("tests/fixtures/skill-valid-asset-reference");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.exitCode).toBe(0);
    expect(result.findings).toEqual([]);
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

  it("passes when a long description is dense with concrete product and feature terms", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-product-dense-skill-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a precise performance-audit skill description narrowly exceeds the soft length threshold", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-performance-skill-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a long workflow skill description uses concrete triggers and product signals", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-triggered-workflow-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a frontend builder skill description is concrete but not protocol-heavy", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-frontend-builder-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a payment integration skill description is product-dense", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-payment-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when an enterprise workflow skill description uses structured triggers", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-enterprise-workflow-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("warns when a YAML block scalar skill description is long and vague", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-vague-block-scalar-skill-description");

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

  it("passes when a YAML folded block scalar skill description is concrete", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-folded-block-scalar-skill-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a media animation reference skill description is concrete", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-animation-reference-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a long video-production workflow description is concrete", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-video-workflow-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });

  it("passes when a visual design workflow description is concrete", async () => {
    const targetPath = path.resolve("tests/fixtures/heuristic-acceptable-visual-design-description");

    const result = await runCheck(targetPath);

    expect(result.status).toBe("pass");
    expect(result.findings).toEqual([]);
  });
});
