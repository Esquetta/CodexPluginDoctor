import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { validateSubmissionSkillMetadata } from "../src/core/submission-skill-metadata.js";

const skill = (name = "check", description = "Checks plugin metadata") => `---\nname: ${name}\ndescription: ${description}\n---\n\nUse the checker.\n`;
const agent = `interface:\n  display_name: Check\n  short_description: Check plugin metadata\n`;
const toolDescriptors = `dependencies:\n  tools:\n    - type: mcp\n      value: figma\n      description: Figma design tools\n      transport: streamable_http\n      url: https://example.com/mcp\n    - type: cli\n      value: adb\n      description: Android device bridge\n`;

async function packageWith(
  skills: unknown,
  files: Record<string, string | Uint8Array> = {},
  name = "submission-plugin"
) {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-skills-"));
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify({ name, skills }), "utf8");
  for (const [relativePath, contents] of Object.entries(files)) {
    const target = path.join(rootPath, relativePath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, contents);
  }
  return { rootPath, manifestPath, manifest: { name, skills } };
}

function ids(result: Awaited<ReturnType<typeof validateSubmissionSkillMetadata>>) {
  return result.findings.map((finding) => finding.id);
}

describe("submission skill metadata", () => {
  it("requires a declared valid skill for skills-only targets", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith(undefined), "skills-only");

    expect(ids(result)).toEqual(["plugin.submission.skill.required"]);
    expect(result.skillCount).toBe(0);
  });

  it("allows an MCP-backed target with no skills declaration", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith(undefined), "mcp-backed");

    expect(result).toEqual({ findings: [], skillCount: 0 });
  });

  it.each(["skills", "./skills/child", "../skills", [], null])("rejects invalid skills declaration %j", async (skills) => {
    const result = await validateSubmissionSkillMetadata(await packageWith(skills), "mcp-backed");

    expect(ids(result)).toContain("plugin.submission.skill.invalid_manifest");
  });

  it("accepts an immediate skill with no optional agent metadata", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill()
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it("inspects only non-hidden immediate skill directories", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/.ignored/SKILL.md": "not valid frontmatter"
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it("rejects a visible immediate skill directory without a regular entrypoint", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/.keep": ""
    }), "skills-only");

    expect(ids(result)).toEqual(expect.arrayContaining([
      "plugin.submission.skill.invalid_file",
      "plugin.submission.skill.required"
    ]));
  });

  it("rejects agent fields at the top level", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills/", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `${agent}icon_small: ./icon.png\nicon_large: ./icon.png\nbrand_color: \"#123ABC\"\ndefault_prompt: Check this plugin\npolicy:\n  products: [CHAT, CODEX]\n  allow_implicit_invocation: true\ndependencies:\n  tools: [read_file]\n`,
      "skills/check/icon.png": "not-inspected-as-image"
    }), "skills-only");

    expect(ids(result)).toContain("plugin.submission.skill.agent.invalid_shape");
  });

  it("accepts complete safe agent metadata inside interface", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills/", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `interface:\n  display_name: Check\n  short_description: Check plugin metadata\n  icon_small: ./icon.png\n  icon_large: ./icon.png\n  brand_color: \"#123ABC\"\n  default_prompt: Check this plugin\npolicy:\n  products: [CHAT, CODEX]\n  allow_implicit_invocation: true\n${toolDescriptors}`,
      "skills/check/icon.png": "not-inspected-as-image"
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it.each([
    ["missing frontmatter", "name: check\ndescription: text\n", "plugin.submission.skill.invalid_file"],
    ["frontmatter root array", "---\n- name: check\n---\nbody\n", "plugin.submission.skill.invalid_shape"],
    ["alias", "---\nname: &name check\ndescription: *name\n---\nbody\n", "plugin.submission.skill.invalid_yaml"],
    ["custom tag", "---\nname: !custom check\ndescription: text\n---\nbody\n", "plugin.submission.skill.invalid_yaml"],
    ["duplicate key", "---\nname: check\nname: again\ndescription: text\n---\nbody\n", "plugin.submission.skill.invalid_yaml"],
    ["blank metadata", "---\nname: \" \"\ndescription: \" \"\n---\nbody\n", "plugin.submission.skill.identity"],
    ["missing body", "---\nname: check\ndescription: text\n---\n", "plugin.submission.skill.invalid_file"]
  ] as const)("rejects %s", async (_caseName, contents, expected) => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": contents
    }), "skills-only");

    expect(ids(result)).toContain(expected);
  });

  it("rejects invalid UTF-8 and oversized skill files", async () => {
    const invalidUtf8 = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": new Uint8Array([0xff, 0xfe])
    }), "skills-only");
    const oversized = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": `${skill()}${"x".repeat(1024 * 1024)}`
    }), "skills-only");

    expect(ids(invalidUtf8)).toContain("plugin.submission.skill.invalid_file");
    expect(ids(oversized)).toContain("plugin.submission.skill.invalid_file");
  });

  it("uses normalized unique plugin and skill identities at the 64 character boundary", async () => {
    const packageName = "p".repeat(58);
    const boundary = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill("c".repeat(5))
    }, packageName), "skills-only");
    const duplicate = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/one/SKILL.md": skill("café"),
      "skills/two/SKILL.md": skill("cafe\u0301")
    }), "skills-only");
    const oneOver = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill("c".repeat(6))
    }, packageName), "skills-only");

    expect(boundary.findings).toEqual([]);
    expect(ids(duplicate)).toContain("plugin.submission.skill.identity");
    expect(ids(oneOver)).toContain("plugin.submission.skill.identity");
  });

  it.each([
    ["missing interface", "policy: { products: [CHAT], allow_implicit_invocation: true }\ndependencies: { tools: [read_file] }\n", "plugin.submission.skill.agent.invalid_shape"],
    ["wrong interface", "interface: []\n", "plugin.submission.skill.agent.invalid_shape"],
    ["malformed yaml", "interface: [\n", "plugin.submission.skill.agent.invalid_yaml"],
    ["alias", "interface: &meta { display_name: Check, short_description: Check }\npolicy: *meta\n", "plugin.submission.skill.agent.invalid_yaml"],
    ["custom tag", "interface: !custom { display_name: Check, short_description: Check }\n", "plugin.submission.skill.agent.invalid_yaml"],
    ["unsupported key", `${agent}unexpected: value\n`, "plugin.submission.skill.agent.invalid_shape"],
    ["policy shape", `${agent}policy: { products: [CHAT, CHAT], allow_implicit_invocation: yes }\n`, "plugin.submission.skill.agent.invalid_shape"],
    ["string dependency", `${agent}dependencies: { tools: [read_file] }\n`, "plugin.submission.skill.agent.invalid_shape"],
    ["unsupported descriptor", `${agent}dependencies: { tools: [{ type: mcp, value: figma, unsupported: no }] }\n`, "plugin.submission.skill.agent.invalid_shape"],
    ["blank descriptor", `${agent}dependencies: { tools: [{ type: cli, value: \" \" }] }\n`, "plugin.submission.skill.agent.invalid_shape"]
  ] as const)("rejects agent metadata with %s", async (_caseName, contents, expected) => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": contents
    }), "skills-only");

    expect(ids(result)).toContain(expected);
  });

  it.each([
    "policy: { products: [CHAT] }\n",
    "policy: { allow_implicit_invocation: false }\n",
    "policy: {}\n"
  ])("accepts partial policy metadata %j", async (policy) => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `${agent}${policy}`
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it("accepts MCP and CLI tool descriptors without retaining their values", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `${agent}${toolDescriptors}`
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it("accepts package-root and relative icon assets", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `interface:\n  display_name: Check\n  short_description: Check plugin metadata\n  icon_small: assets/local.svg\n  icon_large: ../../assets/logo.svg\n`,
      "skills/check/assets/local.svg": "local",
      "assets/logo.svg": "root"
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it("accepts dot-prefixed and parent-relative icon assets inside the package", async () => {
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `interface:\n  display_name: Check\n  short_description: Check plugin metadata\n  icon_small: ./assets/local.svg\n  icon_large: ../.shared/icon.svg\n`,
      "skills/check/assets/local.svg": "local",
      "skills/.shared/icon.svg": "shared"
    }), "skills-only");

    expect(result).toEqual({ findings: [], skillCount: 1 });
  });

  it("rejects icon paths outside the package without retaining the path", async () => {
    const sentinel = "icon-path-secret";
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `interface:\n  display_name: Check\n  short_description: Check plugin metadata\n  icon_small: ../../../${sentinel}.svg\n`
    }), "skills-only");

    expect(ids(result)).toContain("plugin.submission.skill.agent.invalid_path");
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("redacts invalid tool descriptor values, URLs, and descriptions", async () => {
    const sentinel = "tool-descriptor-secret";
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `${agent}dependencies:\n  tools:\n    - type: invalid\n      value: ${sentinel}\n      description: ${sentinel}\n      url: https://${sentinel}.example\n`
    }), "skills-only");

    expect(ids(result)).toContain("plugin.submission.skill.agent.invalid_shape");
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("rejects oversized and invalid UTF-8 agent metadata", async () => {
    const invalidUtf8 = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": new Uint8Array([0xff, 0xfe])
    }), "skills-only");
    const oversized = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `${agent}${"x".repeat(256 * 1024)}`
    }), "skills-only");

    expect(ids(invalidUtf8)).toContain("plugin.submission.skill.agent.invalid_file");
    expect(ids(oversized)).toContain("plugin.submission.skill.agent.invalid_file");
  });

  it("rejects agent file paths that escape a skill and does not expose their contents", async () => {
    const sentinel = "agent-secret-sentinel";
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": skill(),
      "skills/check/agents/openai.yaml": `interface:\n  display_name: Check\n  short_description: Check plugin metadata\n  icon_small: ../${sentinel}.png\n`
    }), "skills-only");

    expect(ids(result)).toContain("plugin.submission.skill.agent.invalid_path");
    expect(JSON.stringify(result)).not.toContain(sentinel);
  });

  it("rejects a junction that makes the skills directory escape the package", async () => {
    const discovered = await packageWith("./skills");
    const external = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-skills-escape-"));
    await mkdir(path.join(external, "check"));
    await writeFile(path.join(external, "check", "SKILL.md"), skill(), "utf8");
    await symlink(external, path.join(discovered.rootPath, "skills"), "junction");

    const result = await validateSubmissionSkillMetadata(discovered, "skills-only");

    expect(ids(result)).toContain("plugin.submission.skill.invalid_path");
    expect(JSON.stringify(result)).not.toContain(external);
  });

  if (process.platform !== "win32") {
    it("rejects a SKILL.md symlink that escapes its skill without reading external content", async () => {
      const sentinel = "external-skill-secret";
      const discovered = await packageWith("./skills", { "skills/check/SKILL.md": skill() });
      const external = path.join(os.tmpdir(), `codex-plugin-doctor-external-${Date.now()}.md`);
      const skillFile = path.join(discovered.rootPath, "skills", "check", "SKILL.md");
      await writeFile(external, `---\nname: check\ndescription: ${sentinel}\n---\nbody\n`, "utf8");
      await unlink(skillFile);
      await symlink(external, skillFile, "file");

      const result = await validateSubmissionSkillMetadata(discovered, "skills-only");

      expect(ids(result)).toEqual(expect.arrayContaining([
        "plugin.submission.skill.invalid_path",
        "plugin.submission.skill.required"
      ]));
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(result)).not.toContain(external);
    });
  }

  if (process.platform === "win32") {
    it("rejects a SKILL.md junction without following its reparse target", async () => {
      const sentinel = "external-junction-secret";
      const discovered = await packageWith("./skills", { "skills/check/SKILL.md": skill() });
      const external = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-external-skill-junction-"));
      const skillFile = path.join(discovered.rootPath, "skills", "check", "SKILL.md");
      await writeFile(path.join(external, "secret.md"), sentinel, "utf8");
      await unlink(skillFile);
      await symlink(external, skillFile, "junction");

      const result = await validateSubmissionSkillMetadata(discovered, "skills-only");

      expect(ids(result)).toEqual(expect.arrayContaining([
        "plugin.submission.skill.required"
      ]));
      expect(ids(result)).toEqual(expect.arrayContaining([
        expect.stringMatching(/^plugin\.submission\.skill\.invalid_(path|file)$/u)
      ]));
      expect(JSON.stringify(result)).not.toContain(sentinel);
      expect(JSON.stringify(result)).not.toContain(external);
    });
  }

  if (process.platform !== "win32") {
    it("rejects an in-skill agent-file symlink before parsing its content", async () => {
      const discovered = await packageWith("./skills", {
        "skills/check/SKILL.md": skill(),
        "skills/check/agents/metadata.yaml": agent
      });
      const agentPath = path.join(discovered.rootPath, "skills", "check", "agents", "openai.yaml");
      await symlink(path.join(discovered.rootPath, "skills", "check", "agents", "metadata.yaml"), agentPath, "file");

      const result = await validateSubmissionSkillMetadata(discovered, "skills-only");

      expect(ids(result)).toContain("plugin.submission.skill.agent.invalid_path");
    });
  }

  if (process.platform === "win32") {
    it("rejects an agents junction that escapes the skill", async () => {
      const discovered = await packageWith("./skills", { "skills/check/SKILL.md": skill() });
      const external = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-external-agents-junction-"));
      await writeFile(path.join(external, "openai.yaml"), agent, "utf8");
      await symlink(external, path.join(discovered.rootPath, "skills", "check", "agents"), "junction");

      const result = await validateSubmissionSkillMetadata(discovered, "skills-only");

      expect(ids(result)).toContain("plugin.submission.skill.agent.invalid_path");
      expect(JSON.stringify(result)).not.toContain(external);
    });
  }

  it("does not fetch, spawn processes, or expose untrusted skill content", async () => {
    const sentinel = "skill-secret-sentinel";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await validateSubmissionSkillMetadata(await packageWith("./skills", {
      "skills/check/SKILL.md": `---\nname: check\ndescription: ${sentinel}\n---\nbody\n`
    }), "skills-only");

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(sentinel);
    expect(await readFile(new URL("../src/core/submission-skill-metadata.ts", import.meta.url), "utf8"))
      .not.toMatch(/child_process|node:child_process/u);
  });
});
