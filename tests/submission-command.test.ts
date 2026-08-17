import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import * as doctor from "../src/index.js";
import { runCli } from "../src/run-cli.js";

function createIo() {
  const stdout: string[] = [];
  const stderr: string[] = [];

  return {
    stdout,
    stderr,
    io: {
      writeStdout(message: string) { stdout.push(message); },
      writeStderr(message: string) { stderr.push(message); }
    }
  };
}

const validManifest = {
  name: "submission-command",
  version: "1.0.0",
  skills: "./skills",
  interface: {
    displayName: "Submission check",
    shortDescription: "Check directory data",
    longDescription: "submission-description-sentinel",
    developerName: "Example Developer",
    category: "Developer Tools",
    logo: "./assets/logo.svg",
    composerIcon: "./assets/composer-icon.svg",
    defaultPrompt: "submission-prompt-sentinel"
  }
};

const validSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48"/></svg>';

async function writeSubmissionPackage(blocked = false): Promise<string> {
  const target = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-submission-command-"));
  const manifest = blocked
    ? {
        ...validManifest,
        interface: {
          ...validManifest.interface,
          websiteURL: "https://user:url-credential-sentinel@example.com"
        },
        mcpServers: "./.mcp.json"
      }
    : validManifest;

  await mkdir(path.join(target, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(target, "assets"), { recursive: true });
  await mkdir(path.join(target, "skills", "check"), { recursive: true });
  await writeFile(path.join(target, ".codex-plugin", "plugin.json"), JSON.stringify(manifest), "utf8");
  await writeFile(path.join(target, "assets", "logo.svg"), validSvg, "utf8");
  await writeFile(path.join(target, "assets", "composer-icon.svg"), validSvg, "utf8");
  await writeFile(
    path.join(target, "skills", "check", "SKILL.md"),
    "---\nname: check\ndescription: skill-description-sentinel\n---\n\nSkill body tool-value-sentinel\n",
    "utf8"
  );

  return target;
}

function expectRedacted(output: string, target: string): void {
  expect(output).not.toContain(target);
  expect(output).not.toContain("submission-description-sentinel");
  expect(output).not.toContain("submission-prompt-sentinel");
  expect(output).not.toContain("url-credential-sentinel");
  expect(output).not.toContain("skill-description-sentinel");
  expect(output).not.toContain("tool-value-sentinel");
}

describe("doctor submission command", () => {
  it("renders a valid package as text without crossing the manual review boundary", async () => {
    const target = await writeSubmissionPackage();
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "submission", target], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain("Ruleset: openai-directory-2026-08-15");
    expect(output).toContain("Target: skills-only");
    expect(output).toContain("Automatic status: PASS");
    expect(output).toContain("Readiness: MANUAL REVIEW REQUIRED");
    expect(output).toContain("Manual checklist");
    expect(output.toLowerCase()).not.toMatch(/accepted|approved|ready for directory/);
    expectRedacted(output, target);
  });

  it.each([
    ["--json", "\"schemaVersion\": \"1.0.0\""],
    ["--markdown", "# Submission preflight"]
  ])("renders %s output and writes the exact same bytes", async (flag, expected) => {
    const target = await writeSubmissionPackage(true);
    const outputPath = path.join(target, `submission${flag === "--json" ? ".json" : ".md"}`);
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "submission", target, flag, "--output", outputPath], io);
    const output = stdout.join("");

    expect(exitCode).toBe(0);
    expect(stderr).toEqual([]);
    expect(output).toContain(expected);
    expect(await readFile(outputPath, "utf8")).toBe(output);
    expectRedacted(output, target);
  });

  it("returns a blocking exit only when --require-ready is selected", async () => {
    const target = await writeSubmissionPackage(true);
    const advisory = createIo();
    const required = createIo();

    expect(await runCli(["doctor", "submission", target], advisory.io)).toBe(0);
    expect(await runCli(["doctor", "submission", target, "--require-ready"], required.io)).toBe(1);
    expect(advisory.stderr).toEqual([]);
    expect(required.stderr).toEqual([]);
  });

  it.each([
    [[], "Missing target path"],
    [["--json", "--markdown"], "Use either --json or --markdown"],
    [["--json", "--json"], "Duplicate submission flag"],
    [["--output"], "Missing path after --output"],
    [["--wat"], "Unknown submission flag"],
    [["one", "two"], "Unexpected submission argument"]
  ])("rejects invalid arguments %#", async (suffix, message) => {
    const target = suffix.length === 0 ? [] : [await writeSubmissionPackage(), ...suffix];
    const { io, stdout, stderr } = createIo();

    const exitCode = await runCli(["doctor", "submission", ...target], io);

    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("")).toContain(message);
  });

  it("exports the submission report API", () => {
    expect(doctor.submissionRuleset.version).toBe("openai-directory-2026-08-15");
    expect(doctor.buildSubmissionPreflight).toBeTypeOf("function");
    expect(doctor.renderSubmissionPreflightJson).toBeTypeOf("function");
    expect(doctor.renderSubmissionPreflightText).toBeTypeOf("function");
    expect(doctor.renderSubmissionPreflightMarkdown).toBeTypeOf("function");
    expect(doctor.submissionPreflightExitCode).toBeTypeOf("function");
  });
});
