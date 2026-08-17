import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";
import { describe, expect, it, vi } from "vitest";

import { buildSubmissionPreflight } from "../src/core/submission-preflight.js";
import { submissionRuleset } from "../src/core/submission-ruleset.js";

const validManifest = {
  name: "submission-preflight",
  version: "1.2.3",
  skills: "./skills",
  interface: {
    displayName: "Submission helper",
    shortDescription: "Check a submission",
    longDescription: "A local submission checker.\nIt remains offline.",
    developerName: "Example Developer",
    category: "Developer Tools",
    logo: "./assets/logo.png",
    composerIcon: "./assets/composer-icon.png",
    capabilities: ["Checks public listing metadata"],
    defaultPrompt: "Check my plugin submission"
  }
};

const crc32 = (data: Uint8Array) => {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const pngChunk = (type: string, content: Uint8Array) => {
  const chunk = new Uint8Array(content.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, content.length);
  chunk.set(type.split("").map((character) => character.charCodeAt(0)), 4);
  chunk.set(content, 8);
  view.setUint32(content.length + 8, crc32(chunk.slice(4, content.length + 8)));
  return chunk;
};

const validPng = (() => {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, 48); view.setUint32(4, 48);
  header.set([1, 0, 0, 0, 0], 8);
  const idat = new Uint8Array(deflateSync(new Uint8Array((1 + Math.ceil(48 / 8)) * 48)));
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header), pngChunk("IDAT", idat), pngChunk("IEND", new Uint8Array())];
  const image = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { image.set(part, offset); offset += part.length; }
  return image;
})();

const validAssetFiles: Record<string, Uint8Array> = {
  "assets/logo.png": validPng,
  "assets/composer-icon.png": validPng
};
const validSkillFiles: Record<string, string> = {
  "skills/check/SKILL.md": "---\nname: check\ndescription: Check a plugin submission\n---\n\nCheck the plugin submission.\n"
};

async function writePackage(
  manifest: unknown,
  files: Record<string, string | Uint8Array> = {},
  includeSkill = true
): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-"));
  const manifestDirectory = path.join(directory, ".codex-plugin");

  await mkdir(manifestDirectory, { recursive: true });
  await writeFile(path.join(manifestDirectory, "plugin.json"), JSON.stringify(manifest), "utf8");

  for (const [relativePath, content] of Object.entries({ ...validAssetFiles, ...(includeSkill ? validSkillFiles : {}), ...files })) {
    const filePath = path.join(directory, relativePath);

    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, content);
  }

  return directory;
}

function findingIds(report: Awaited<ReturnType<typeof buildSubmissionPreflight>>): string[] {
  return report.findings.map((finding) => finding.id);
}

function validMcpManifest(overrides: Record<string, unknown> = {}) {
  return {
    ...validManifest,
    mcpServers: "./.mcp.json",
    interface: {
      ...validManifest.interface,
      websiteURL: "https://example.com",
      supportURL: "https://example.com/support",
      privacyPolicyURL: "https://example.com/privacy",
      termsOfServiceURL: "https://example.com/terms"
    },
    ...overrides
  };
}

describe("submission preflight", () => {
  it("publishes the immutable directory ruleset", () => {
    expect(submissionRuleset).toEqual({
      version: "openai-directory-2026-08-15",
      reviewedAt: "2026-08-15",
      sources: [
        "https://developers.openai.com/plugins/build/plugins",
        "https://developers.openai.com/plugins/deploy/app-review",
        "https://developers.openai.com/plugins/deploy/submission-errors"
      ],
      limits: {
        packageName: 64,
        version: 64,
        displayName: 30,
        shortDescription: 30,
        longDescription: 4000,
        developerName: 80,
        capabilities: 20,
        capability: 120,
        starterPrompts: 3,
        starterPrompt: 128,
        url: 1024
      },
      categories: [
        "Productivity", "Creativity", "Developer Tools", "Business & Operations",
        "Data & Analytics", "Communication", "Education & Research", "Security",
        "Finance", "Healthcare", "Travel", "Entertainment", "Other"
      ]
    });
    expect(Object.isFrozen(submissionRuleset)).toBe(true);
  });

  it.each([
    ["skills-only", validManifest],
    ["mcp-backed", validMcpManifest()],
    ["mcp-backed", { ...validManifest, apps: "./.app.json" }],
    ["mcp-backed", { ...validManifest, mcpServers: null }],
    ["mcp-backed", { ...validManifest, apps: null }]
  ] as const)("classifies declarations by presence as %s", async (targetType, manifest) => {
    const report = await buildSubmissionPreflight(await writePackage(manifest));

    expect(report.targetType).toBe(targetType);
  });

  it("returns a manual-review-ready skills-only report without side effects", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const report = await buildSubmissionPreflight(await writePackage(validManifest));

    expect(report).toMatchObject({
      schemaVersion: "1.0.0",
      rulesetVersion: "openai-directory-2026-08-15",
      targetType: "skills-only",
      status: "pass",
      readiness: "manual_review_required",
      summary: { passed: 4, warnings: 0, blockers: 0, manualChecks: 3 }
    });
    expect(report.checks).toEqual([
      { id: "listing", status: "pass", findingIds: [] },
      { id: "components", status: "pass", findingIds: [] },
      { id: "assets", status: "pass", findingIds: [] },
      { id: "skills", status: "pass", findingIds: [] }
    ]);
    expect(report.manualChecklist).toEqual([
      { id: "developer-business-identity", label: "Developer and business identity", state: "required" },
      { id: "attestations", label: "Required attestations", state: "required" },
      { id: "skill-safety-scan", label: "Skill safety scan", state: "required" },
      { id: "demo-video", label: "Demo video", state: "not_applicable" },
      { id: "tool-tests", label: "Exactly 5 positive and 3 negative tool tests", state: "not_applicable" },
      { id: "release-notes", label: "Release notes", state: "not_applicable" },
      { id: "production-domain-verification", label: "Production domain verification and current tool scan", state: "not_applicable" },
      { id: "tool-annotations", label: "Tool annotations and justifications", state: "not_applicable" },
      { id: "oauth-reviewer-credentials", label: "OAuth reviewer credentials", state: "not_applicable" }
    ]);
    expect(report.manualChecklist.every((item) => item.state !== "passed")).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("integrates bounded skill metadata into the skills check without requiring skills for MCP-only packages", async () => {
    const missingSkill = await buildSubmissionPreflight(await writePackage(validManifest, {}, false));
    const mcpOnly = await buildSubmissionPreflight(await writePackage({
      ...validMcpManifest(),
      skills: undefined
    }, {}, false));

    expect(missingSkill.checks.find((item) => item.id === "skills")).toMatchObject({
      status: "fail",
      findingIds: expect.arrayContaining(["plugin.submission.skill.invalid_path"])
    });
    expect(missingSkill).toMatchObject({ status: "fail", readiness: "blocked" });
    expect(mcpOnly.checks.find((item) => item.id === "skills")).toEqual({ id: "skills", status: "pass", findingIds: [] });
    expect(mcpOnly).toMatchObject({ status: "pass", readiness: "manual_review_required" });
  });

  it("blocks missing and malformed manifests without exposing the package path", async () => {
    const missing = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-missing-"));
    const malformed = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-malformed-"));

    await mkdir(path.join(malformed, ".codex-plugin"));
    await writeFile(path.join(malformed, ".codex-plugin", "plugin.json"), "{", "utf8");

    for (const target of [missing, malformed]) {
      const report = await buildSubmissionPreflight(target);
      const invalid = report.findings.find((finding) => finding.id === "plugin.submission.package.invalid");

      expect(report).toMatchObject({ status: "fail", readiness: "blocked", targetType: "skills-only" });
      expect(invalid).toMatchObject({ severity: "fail" });
      expect(JSON.stringify(report)).not.toContain(target);
    }
  });

  it("bounds the submission manifest before decoding or parsing it", async () => {
    const target = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-large-manifest-"));
    const sentinel = "submission-manifest-secret";
    await mkdir(path.join(target, ".codex-plugin"));
    await writeFile(path.join(target, ".codex-plugin", "plugin.json"), sentinel.padEnd(1024 * 1024 + 1, "x"), "utf8");

    const report = await buildSubmissionPreflight(target);

    expect(report).toMatchObject({ status: "fail", readiness: "blocked" });
    expect(findingIds(report)).toEqual(["plugin.submission.package.too_large"]);
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(JSON.stringify(report)).not.toContain(target);
  });

  it("fails closed for a non-string public target input", async () => {
    const report = await buildSubmissionPreflight(null as unknown as string);

    expect(report).toMatchObject({
      targetType: "skills-only",
      status: "fail",
      readiness: "blocked"
    });
    expect(findingIds(report)).toEqual(["plugin.submission.package.invalid"]);
    expect(JSON.stringify(report)).not.toContain("null");
  });

  it.each([
    ["package name", { ...validMcpManifest({ skills: undefined }), name: "a".repeat(64) }, false],
    ["package name one over", { ...validManifest, name: "a".repeat(65) }, true],
    ["version", { ...validManifest, version: "1.2.3+" + "a".repeat(58) }, false],
    ["version one over", { ...validManifest, version: "1.2.3+" + "a".repeat(59) }, true],
    ["invalid package name", { ...validManifest, name: "bad name" }, true],
    ["invalid strict semver", { ...validManifest, version: "01.2.3" }, true],
    ["malformed package fields", { ...validManifest, name: [], version: {} }, true]
  ])("enforces %s boundaries", async (_caseName, manifest, invalid) => {
    const report = await buildSubmissionPreflight(await writePackage(manifest));

    expect(report.status === "fail").toBe(invalid);
  });

  it.each([
    ["displayName", "a".repeat(30), false],
    ["displayName", "a".repeat(31), true],
    ["shortDescription", "a".repeat(30), false],
    ["shortDescription", "a".repeat(31), true],
    ["longDescription", "a".repeat(4000), false],
    ["longDescription", "a".repeat(4001), true],
    ["developerName", "a".repeat(80), false],
    ["developerName", "a".repeat(81), true]
  ])("enforces %s length boundary", async (field, value, invalid) => {
    const report = await buildSubmissionPreflight(await writePackage({
      ...validManifest,
      interface: { ...validManifest.interface, [field]: value }
    }));

    expect(report.status === "fail").toBe(invalid);
  });

  it("rejects malformed listing mappings, blank fields, forbidden newlines and invisible controls", async () => {
    const cases: Array<{ interface: unknown; expected: string }> = [
      { interface: null, expected: "plugin.submission.interface.required" },
      { interface: { ...validManifest.interface, displayName: " \t " }, expected: "plugin.submission.interface.display_name" },
      { interface: { ...validManifest.interface, shortDescription: "line\nbreak" }, expected: "plugin.submission.interface.short_description" },
      { interface: { ...validManifest.interface, developerName: "a\r\nb" }, expected: "plugin.submission.interface.developer_name" },
      { interface: { ...validManifest.interface, category: "Developer\u2028Tools" }, expected: "plugin.submission.interface.category" },
      { interface: { ...validManifest.interface, displayName: "zero\u200Bwidth" }, expected: "plugin.submission.interface.display_name" },
      { interface: { ...validManifest.interface, longDescription: "bidi\u202Etext" }, expected: "plugin.submission.interface.long_description" },
      { interface: { ...validManifest.interface, longDescription: "acceptable\r\nmultiline" }, expected: "" }
    ];

    for (const testCase of cases) {
      const report = await buildSubmissionPreflight(await writePackage({ ...validManifest, interface: testCase.interface }));

      if (testCase.expected) {
        expect(findingIds(report)).toContain(testCase.expected);
      } else {
        expect(report.status).toBe("pass");
      }
    }
  });

  it("validates categories, capabilities, prompts and redacts listing content", async () => {
    const sentinel = "listing-content-sentinel";
    const report = await buildSubmissionPreflight(await writePackage({
      ...validManifest,
      interface: {
        ...validManifest.interface,
        category: "Not a category",
        capabilities: ["valid", " ", "line\nbreak", "a".repeat(121), ...Array.from({ length: 17 }, (_, index) => `c${index}`)],
        defaultPrompt: [" Prompt", "Ｐｒｏｍｐｔ ", `@app ${sentinel}`, "one too many"]
      }
    }));

    expect(findingIds(report)).toEqual(expect.arrayContaining([
      "plugin.submission.interface.category",
      "plugin.submission.interface.capabilities",
      "plugin.submission.interface.capability",
      "plugin.submission.interface.default_prompt"
    ]));
    expect(JSON.stringify(report)).not.toContain(sentinel);
  });

  it.each([
    ["20 capabilities", Array.from({ length: 20 }, (_, index) => index === 0 ? "a".repeat(120) : `capability ${index}`), ["one", "two", "a".repeat(128)], true],
    ["21 capabilities", Array.from({ length: 21 }, (_, index) => `capability ${index}`), ["one"], false],
    ["prompt one over", ["capability"], ["a".repeat(129)], false],
    ["four prompts", ["capability"], ["one", "two", "three", "four"], false]
  ])("accepts only bounded capability and prompt entries for %s", async (_caseName, capabilities, defaultPrompt, valid) => {
    const report = await buildSubmissionPreflight(await writePackage({
      ...validManifest,
      interface: { ...validManifest.interface, capabilities, defaultPrompt }
    }));

    expect(report.status === "pass").toBe(valid);
  });

  it("requires valid MCP listing URLs and never returns their contents", async () => {
    const sentinel = "url-secret-sentinel";
    const report = await buildSubmissionPreflight(await writePackage(validMcpManifest({
      interface: {
        ...validMcpManifest().interface,
        websiteURL: `https://user:${sentinel}@example.com/path#fragment`,
        supportURL: "http://example.com",
        privacyPolicyURL: " ",
        termsOfServiceURL: "https://example.com/\u200B"
      }
    })));

    expect(findingIds(report)).toContain("plugin.submission.interface.url");
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(report.manualChecklist.filter((item) => item.state === "required")).toHaveLength(9);
  });

  it("warns for unknown interface fields without retaining values and blocks skills-only screenshots", async () => {
    const sentinel = "unknown-value-sentinel";
    const report = await buildSubmissionPreflight(await writePackage({
      ...validManifest,
      interface: { ...validManifest.interface, unknownSubmissionField: sentinel, screenshots: ["./shot.png"] }
    }));

    expect(findingIds(report)).toEqual(expect.arrayContaining([
      "plugin.submission.interface.unknown_field",
      "plugin.submission.component.excluded"
    ]));
    expect(report.status).toBe("fail");
    expect(report.readiness).toBe("blocked");
    expect(report.summary).toMatchObject({ warnings: 1, blockers: 1, passed: 2 });
    expect(report.findings.find((finding) => finding.id === "plugin.submission.component.excluded"))
      .toMatchObject({ severity: "fail" });
    expect(JSON.stringify(report)).not.toContain(sentinel);
  });

  it.each([
    ["missing app", "./.app.json", {}, "plugin.submission.component.app"],
    ["wrong path", "./apps/app.json", { "apps/app.json": "{}" }, "plugin.submission.component.app"],
    ["wrong type", [], {}, "plugin.submission.component.app"],
    ["traversal", "../.app.json", { "../.app.json": "{}" }, "plugin.submission.component.app"],
    ["invalid JSON", "./.app.json", { ".app.json": "{" }, "plugin.submission.component.app"]
  ])("blocks %s at the app boundary", async (_caseName, apps, files, expected) => {
    const report = await buildSubmissionPreflight(await writePackage({ ...validMcpManifest(), apps }, files));

    expect(findingIds(report)).toContain(expected);
  });

  it.each(["null", "[]", "42", "true", "\"a primitive\"", "{}"]) ("accepts parseable %s app JSON without inferring its schema", async (contents) => {
    const report = await buildSubmissionPreflight(await writePackage({ ...validMcpManifest(), apps: "./.app.json" }, { ".app.json": contents }));

    expect(report.status).toBe("pass");
  });

  if (process.platform !== "win32") {
    it("rejects a file symlink whose canonical app path escapes the package", async () => {
      const target = await writePackage({ ...validMcpManifest(), apps: "./.app.json" });
      const external = path.join(os.tmpdir(), `submission-app-escape-${Date.now()}.json`);

      await writeFile(external, "{}", "utf8");
      await symlink(external, path.join(target, ".app.json"), "file");

      const report = await buildSubmissionPreflight(target);

      expect(findingIds(report)).toContain("plugin.submission.app.invalid_path");
      expect(JSON.stringify(report)).not.toContain(external);
    });
  }

  it("rejects a junction whose canonical app path escapes the package before file classification", async () => {
    const target = await writePackage({ ...validMcpManifest(), apps: "./.app.json" });
    const external = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-app-escape-"));

    await symlink(external, path.join(target, ".app.json"), "junction");

    const report = await buildSubmissionPreflight(target);

    expect(findingIds(report)).toContain("plugin.submission.app.invalid_path");
    expect(JSON.stringify(report)).not.toContain(external);
  });

  it("rejects a root app declaration that points at a directory", async () => {
    const target = await writePackage({ ...validMcpManifest(), apps: "./.app.json" });
    await mkdir(path.join(target, ".app.json"));

    const report = await buildSubmissionPreflight(target);

    expect(findingIds(report)).toContain("plugin.submission.component.app");
  });
});
