import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { buildSubmissionArchivePreflight, submissionArchiveExitCode } from "../src/core/submission-archive-preflight.js";
import { submissionArchiveRuleset } from "../src/core/submission-archive-ruleset.js";
import { createZipFixture } from "./helpers/zip-fixture.js";

const temporaryDirectories: string[] = [];
const skill = "---\nname: check\ndescription: Check an archive submission\n---\n\nCheck the archive submission.\n";
const svg = '<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg" />';

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    name: "archive-preflight",
    version: "1.0.0",
    skills: "./skills",
    interface: {
      displayName: "Archive preflight",
      shortDescription: "Check a ZIP package",
      longDescription: "Check an archive before submission.",
      developerName: "Doctor",
      category: "Developer Tools",
      logo: "./assets/logo.svg",
      composerIcon: "./assets/composer.svg"
    },
    ...overrides
  };
}

function packageEntries(
  manifestPath = ".codex-plugin/plugin.json",
  manifestValue: Record<string, unknown> = manifest(),
  prefix = ""
) {
  const rooted = (entryPath: string) => prefix === "" ? entryPath : `${prefix}/${entryPath}`;
  return [
    { name: rooted(manifestPath), content: JSON.stringify(manifestValue) },
    { name: rooted("assets/logo.svg"), content: svg },
    { name: rooted("assets/composer.svg"), content: svg },
    { name: rooted("skills/check/SKILL.md"), content: skill }
  ];
}

async function reportFor(entries: ReturnType<typeof packageEntries>, fileName = "plugin.zip") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-preflight-"));
  temporaryDirectories.push(directory);
  const archivePath = path.join(directory, fileName);
  await writeFile(archivePath, createZipFixture(entries));
  return buildSubmissionArchivePreflight(archivePath);
}

function findingIds(report: Awaited<ReturnType<typeof buildSubmissionArchivePreflight>>): string[] {
  return report.findings.map((finding) => finding.id);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 50
  })));
});

describe("submission archive preflight", () => {
  it("aggregates a valid archive-root package through listing, asset, and skill readers", async () => {
    const report = await reportFor(packageEntries());

    expect(report).toMatchObject({
      schemaVersion: "1.0.0",
      rulesetVersion: "openai-directory-archive-2026-08-23",
      status: "pass",
      readiness: "manual_review_required",
      archive: { fileName: "plugin.zip", rootLayout: "archive-root" },
      summary: { passed: 4, warnings: 0, blockers: 0, manualChecks: 3 }
    });
    expect(report.submission?.checks).toEqual([
      { id: "listing", status: "pass", findingIds: [] },
      { id: "components", status: "pass", findingIds: [] },
      { id: "assets", status: "pass", findingIds: [] },
      { id: "skills", status: "pass", findingIds: [] }
    ]);
    expect(report.archiveChecks).toEqual([]);
    expect(submissionArchiveExitCode(report, false)).toBe(0);
    expect(submissionArchiveExitCode(report, true)).toBe(0);
  });

  it.each([
    ["codex", ".codex-plugin/plugin.json"],
    ["agent", ".agent-plugin/plugin.json"],
    ["claude", ".claude-plugin/plugin.json"]
  ])("recognizes a single top-level directory with the %s manifest path", async (_kind, manifestPath) => {
    const report = await reportFor(packageEntries(manifestPath, manifest(), "plugin"));

    expect(report).toMatchObject({ status: "pass", archive: { rootLayout: "single-top-level-directory" } });
    expect(report.submission?.status).toBe("pass");
  });

  it("reports root siblings, ambiguous manifests, and a missing immediate skill as archive blockers", async () => {
    const siblings = await reportFor([
      ...packageEntries(".codex-plugin/plugin.json", manifest(), "plugin"),
      { name: "README.md", content: "sibling" }
    ]);
    const ambiguous = await reportFor([
      ...packageEntries(),
      { name: ".agent-plugin/plugin.json", content: JSON.stringify(manifest()) }
    ]);
    const rootAndNested = await reportFor([
      ...packageEntries(),
      { name: "nested/.agent-plugin/plugin.json", content: JSON.stringify(manifest()) }
    ]);
    const missingSkill = await reportFor(packageEntries().filter((entry) => !String(entry.name).endsWith("SKILL.md")));

    expect(findingIds(siblings)).toContain("plugin.submission.archive.root_siblings");
    expect(findingIds(ambiguous)).toContain("plugin.submission.archive.root_ambiguous");
    expect(findingIds(rootAndNested)).toContain("plugin.submission.archive.root_ambiguous");
    expect(rootAndNested).toMatchObject({ status: "fail", readiness: "blocked", submission: null });
    expect(findingIds(missingSkill)).toContain("plugin.submission.archive.skill_missing");
    expect([siblings, ambiguous, missingSkill].every((report) => report.status === "fail" && report.readiness === "blocked")).toBe(true);
    expect(submissionArchiveExitCode(missingSkill, false)).toBe(0);
    expect(submissionArchiveExitCode(missingSkill, true)).toBe(1);
  });

  it("retains exact portal codes only for warning-only skills-only exclusions", async () => {
    const report = await reportFor(packageEntries(".codex-plugin/plugin.json", manifest({
      mcpServers: "./.mcp.json",
      apps: "./.app.json",
      interface: { ...manifest().interface as object, screenshots: ["./shot.png"] }
    })).concat([
      { name: ".mcp.json", content: "{}" },
      { name: ".app.json", content: "{}" }
    ]));

    expect(report.status).toBe("pass");
    expect(report.readiness).toBe("manual_review_required");
    expect(report.findings.filter((finding) => finding.id.startsWith("plugin.submission.archive.") && finding.severity === "warn"))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: "plugin.submission.archive.mcp_excluded", portalCode: "mcp_configuration_excluded" }),
        expect.objectContaining({ id: "plugin.submission.archive.app_excluded", portalCode: "app_configuration_excluded" }),
        expect.objectContaining({ id: "plugin.submission.archive.screenshot_excluded", portalCode: "screenshot_configuration_excluded" })
      ]));
  });

  it("keeps portal history and normalization requirements unavailable without exposing archive paths or contents", async () => {
    const sentinel = "archive-secret-sentinel";
    const report = await reportFor(packageEntries(".codex-plugin/plugin.json", manifest({ description: sentinel })));

    expect(report.coverage).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "plugin.submission.archive.plugin_name_mismatch", status: "unavailable" }),
      expect.objectContaining({ id: "plugin.submission.archive.plugin_version_unchanged", status: "unavailable" }),
      expect.objectContaining({ id: "plugin.submission.archive.manifest_normalized", status: "unavailable" }),
      expect.objectContaining({ id: "plugin.submission.archive.developer_name_defaulted", status: "unavailable" })
    ]));
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(JSON.stringify(report)).not.toContain("submission-archive-preflight-");
  });

  it("preserves reader-backed listing, asset, and skill findings inside the aggregate report", async () => {
    const invalidListing = await reportFor(packageEntries(".codex-plugin/plugin.json", manifest({
      interface: { ...manifest().interface as object, displayName: " " }
    })));
    const missingAsset = await reportFor(packageEntries().filter((entry) => entry.name !== "assets/composer.svg"));
    const invalidSkill = await reportFor(packageEntries().map((entry) => entry.name === "skills/check/SKILL.md"
      ? { ...entry, content: "not a skill manifest" }
      : entry));

    expect(invalidListing.submission?.findings.map((finding) => finding.id)).toContain("plugin.submission.interface.display_name");
    expect(missingAsset.submission?.findings.map((finding) => finding.id)).toContain("plugin.submission.asset.missing");
    expect(invalidSkill.submission?.findings.map((finding) => finding.id)).toContain("plugin.submission.skill.invalid_file");
    expect([invalidListing, missingAsset, invalidSkill].every((report) => report.status === "fail" && report.readiness === "blocked")).toBe(true);
  });

  it("reports a manifest missing from the only top-level directory", async () => {
    const report = await reportFor([{ name: "plugin/README.md", content: "not a manifest" }]);

    expect(findingIds(report)).toContain("plugin.submission.archive.manifest_missing");
    expect(report).toMatchObject({ status: "fail", archive: { rootLayout: "unavailable" }, submission: null });
  });

  it("reports a structurally valid zero-entry ZIP as a missing archive root", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-preflight-empty-"));
    temporaryDirectories.push(directory);
    const archivePath = path.join(directory, "empty.zip");
    await writeFile(archivePath, createZipFixture([]));

    const report = await buildSubmissionArchivePreflight(archivePath);

    expect(findingIds(report)).toEqual(["plugin.submission.archive.root_missing"]);
    expect(report).toMatchObject({
      status: "fail",
      readiness: "blocked",
      archive: { entryCount: 0, rootLayout: "unavailable" },
      submission: null
    });
  });

  it("distinguishes an archive-root content file without a manifest from a sibling root", async () => {
    const contentOnly = await reportFor([{ name: "README.md", content: "content only" }]);
    const sibling = await reportFor([
      ...packageEntries(".codex-plugin/plugin.json", manifest(), "plugin"),
      { name: "README.md", content: "sibling" }
    ]);

    expect(findingIds(contentOnly)).toEqual(["plugin.submission.archive.manifest_missing"]);
    expect(findingIds(sibling)).toContain("plugin.submission.archive.root_siblings");
  });

  it("reports multiple archive-root content directories without a manifest as manifest_missing", async () => {
    const report = await reportFor([
      { name: "assets/logo.svg", content: svg },
      { name: "skills/check/SKILL.md", content: skill }
    ]);

    expect(findingIds(report)).toEqual(["plugin.submission.archive.manifest_missing"]);
  });

  it("does not treat a deep manifest-like path as an immediate nested plugin root", async () => {
    const report = await reportFor([
      { name: "README.md", content: "archive-root content" },
      { name: "plugin/nested/.codex-plugin/plugin.json", content: JSON.stringify(manifest()) },
      { name: "plugin/nested/skills/check/SKILL.md", content: skill }
    ]);

    expect(findingIds(report)).toEqual(["plugin.submission.archive.manifest_missing"]);
  });

  it("publishes immutable archive governance and derives portal coverage from it", async () => {
    const report = await reportFor(packageEntries());

    expect(Object.isFrozen(submissionArchiveRuleset)).toBe(true);
    expect(submissionArchiveRuleset).toMatchObject({
      structures: {
        eocdComments: "automatic",
        zip64: "automatic",
        dataDescriptors: "automatic"
      },
      compression: { stored: "automatic", deflate: "automatic" },
      collisionAlgorithm: "NFKC + toLowerCase per segment"
    });
    expect(submissionArchiveRuleset.automaticChecks).toContain("plugin.submission.archive.path_invalid");
    expect(submissionArchiveRuleset.automaticChecks).toEqual(expect.arrayContaining([
      "plugin.submission.archive.mcp_excluded",
      "plugin.submission.archive.app_excluded",
      "plugin.submission.archive.screenshot_excluded"
    ]));
    expect(submissionArchiveRuleset.portalRules).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "plugin.submission.archive.plugin_name_mismatch", status: "unavailable", source: "submission-errors" }),
      expect.objectContaining({ id: "plugin.submission.archive.manifest_normalized", status: "unavailable", source: "submission-errors" })
    ]));
    expect(report.coverage).toEqual(expect.arrayContaining(
      submissionArchiveRuleset.portalRules.map(({ id, status, reason }) => ({ id, status, reason }))
    ));
  });

  it("redacts an unsafe archive basename before it reaches the report", async () => {
    const sentinel = "unsafe-archive-name";
    const report = await buildSubmissionArchivePreflight(path.join(os.tmpdir(), `${sentinel}\n\u202E.zip`));

    expect(report.archive.fileName).toBe("archive.zip");
    expect(JSON.stringify(report)).not.toContain(sentinel);
    expect(JSON.stringify(report)).not.toContain("\u202E");
  });
});
