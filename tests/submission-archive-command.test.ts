import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as doctor from "../src/index.js";
import { generateCompletion } from "../src/core/shell-completion.js";
import { runCli } from "../src/run-cli.js";
import { createZipFixture } from "./helpers/zip-fixture.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: { writeStdout(message: string) { stdout.push(message); }, writeStderr(message: string) { stderr.push(message); } } };
}

const validSkill = `---
name: check
description: Check archive
---

Check archive.
`;

describe("doctor submission archive command", () => {
  it("renders redacted JSON and writes the exact same bytes", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-command-"));
    const archivePath = path.join(directory, "plugin.zip");
    const outputPath = path.join(directory, "archive.json");
    const sentinel = "archive-content-sentinel";
    const manifest = {
      name: "archive-command", version: "1.0.0", skills: "./skills",
      interface: {
        displayName: "Archive command", shortDescription: "Check archive", longDescription: sentinel,
        developerName: "Doctor", category: "Developer Tools", logo: "./assets/logo.svg", composerIcon: "./assets/composer.svg"
      }
    };
    const svg = '<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg" />';
    const io = createIo();

    try {
      await writeFile(archivePath, createZipFixture([
        { name: ".codex-plugin/plugin.json", content: JSON.stringify(manifest) },
        { name: "assets/logo.svg", content: svg },
        { name: "assets/composer.svg", content: svg },
        { name: "skills/check/SKILL.md", content: validSkill }
      ]));

      expect(await runCli(["doctor", "submission", "archive", archivePath, "--json", "--output", outputPath], io.io)).toBe(0);
      expect(io.stderr).toEqual([]);
      expect(JSON.parse(io.stdout.join(""))).toMatchObject({ schemaVersion: "1.0.0", archive: { fileName: "plugin.zip" } });
      expect(await readFile(outputPath, "utf8")).toBe(io.stdout.join(""));
      expect(io.stdout.join("")).not.toContain(archivePath);
      expect(io.stdout.join("")).not.toContain(sentinel);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exports the archive API and publishes its contract and contextual completions", async () => {
    const contractIo = createIo();

    expect(doctor.buildSubmissionArchivePreflight).toBeTypeOf("function");
    expect(doctor.renderSubmissionArchiveJson).toBeTypeOf("function");
    expect(doctor.renderSubmissionArchiveText).toBeTypeOf("function");
    expect(doctor.renderSubmissionArchiveMarkdown).toBeTypeOf("function");
    expect(doctor.submissionArchiveExitCode).toBeTypeOf("function");
    expect(await runCli(["doctor", "contract", "--json"], contractIo.io)).toBe(0);
    expect(JSON.parse(contractIo.stdout.join("")).schemas).toContainEqual(expect.objectContaining({
      id: "doctor.submission.archive.json",
      command: "codex-plugin-doctor doctor submission archive <zip> --json"
    }));
    expect(generateCompletion("bash")).toContain('local submission_targets="archive"');
    expect(generateCompletion("zsh")).toContain("'3:archive target:(archive)'");
    expect(generateCompletion("fish")).toContain('-a "archive" -d \'ZIP archive\'');
    expect(generateCompletion("zsh")).toContain('[[ "$words[2]" == "doctor" && "$words[3]" == "submission" ]]');
    expect(generateCompletion("fish")).toContain('__fish_seen_subcommand_from doctor; and __fish_seen_subcommand_from submission');
  });

  it("renders redacted text and Markdown, and keeps archive blockers advisory unless strict", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-human-render-"));
    const archivePath = path.join(directory, "safe.zip");
    const sentinel = "archive-human-secret";
    const textOutputPath = path.join(directory, "archive.txt");
    const markdownOutputPath = path.join(directory, "archive.md");
    const text = createIo(); const markdown = createIo(); const advisory = createIo(); const strict = createIo();
    try {
      await writeFile(archivePath, createZipFixture([{ name: ".codex-plugin/plugin.json", content: JSON.stringify({
        name: "human-render", version: "1.0.0", skills: "./skills", interface: { displayName: "Human", shortDescription: "Human", longDescription: sentinel, developerName: "Doctor", category: "Developer Tools", logo: "./assets/logo.svg", composerIcon: "./assets/composer.svg" }
      }) }, { name: "assets/logo.svg", content: '<svg width="48" height="48" />' }, { name: "assets/composer.svg", content: '<svg width="48" height="48" />' }, { name: "skills/check/SKILL.md", content: validSkill }]));
      expect(await runCli(["doctor", "submission", "archive", archivePath, "--output", textOutputPath], text.io)).toBe(0);
      expect(await runCli(["doctor", "submission", "archive", archivePath, "--markdown", "--output", markdownOutputPath], markdown.io)).toBe(0);
      for (const output of [text.stdout.join(""), markdown.stdout.join("")]) {
        expect(output).toContain("Submission archive preflight");
        expect(output).not.toContain(archivePath);
        expect(output).not.toContain(sentinel);
      }
      expect(await readFile(textOutputPath, "utf8")).toBe(text.stdout.join(""));
      expect(await readFile(markdownOutputPath, "utf8")).toBe(markdown.stdout.join(""));
      const missingPath = path.join(directory, "missing.zip");
      expect(await runCli(["doctor", "submission", "archive", missingPath], advisory.io)).toBe(0);
      expect(await runCli(["doctor", "submission", "archive", missingPath, "--require-ready"], strict.io)).toBe(1);
      expect(advisory.stderr).toEqual([]); expect(strict.stderr).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it("keeps warning-only archives strict-ready and validates archive parser edge cases", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "submission-archive-warning-"));
    const archivePath = path.join(directory, "warning.zip");
    try {
      await writeFile(archivePath, createZipFixture([{ name: ".codex-plugin/plugin.json", content: JSON.stringify({
        name: "warning-render", version: "1.0.0", skills: "./skills", mcpServers: "./.mcp.json", interface: { displayName: "Warning", shortDescription: "Warning", longDescription: "Warning", developerName: "Doctor", category: "Developer Tools", logo: "./assets/logo.svg", composerIcon: "./assets/composer.svg" }
      }) }, { name: ".mcp.json", content: "{}" }, { name: "assets/logo.svg", content: '<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg" />' }, { name: "assets/composer.svg", content: '<svg width="48" height="48" xmlns="http://www.w3.org/2000/svg" />' }, { name: "skills/check/SKILL.md", content: validSkill }]));
      const warning = createIo();
      expect(await runCli(["doctor", "submission", "archive", archivePath, "--require-ready"], warning.io)).toBe(0);
      expect(warning.stderr).toEqual([]);
      for (const [args, expected] of [
        [["doctor", "submission", "archive"], "Missing archive path"],
        [["doctor", "submission", "archive", "x.zip", "--wat"], "Unknown submission archive flag"],
        [["doctor", "submission", "archive", "x.zip", "--json", "--json"], "Duplicate submission archive flag"],
        [["doctor", "submission", "archive", "x.zip", "--json", "--markdown"], "Use either --json or --markdown"],
        [["doctor", "submission", "archive", "--", "--literal.zip", "--require-ready"], "Unexpected submission archive argument"]
      ] as const) {
        const io = createIo();
        expect(await runCli([...args], io.io)).toBe(2);
        expect(io.stderr.join("")).toContain(expected);
      }
      const delimiter = createIo();
      expect(await runCli(["doctor", "submission", "archive", "--", "--literal.zip"], delimiter.io)).toBe(0);
      expect(delimiter.stderr).toEqual([]);
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
