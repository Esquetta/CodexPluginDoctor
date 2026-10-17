import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runCli } from "../src/run-cli.js";

function capture() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { stdout, stderr, io: {
    writeStdout: (text: string) => { stdout.push(text); },
    writeStderr: (text: string) => { stderr.push(text); }
  } };
}

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function promptsFile(name: string, prompts: unknown[]): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "doctor-prompts-diff-cli-"));
  directories.push(directory);
  const filePath = path.join(directory, name);
  await writeFile(filePath, JSON.stringify({ jsonrpc: "2.0", id: "prompts-list", result: { resultType: "complete", prompts, ttlMs: 0, cacheScope: "private" } }));
  return filePath;
}

const review = (argumentsList: unknown[]) => ({ name: "code_review", arguments: argumentsList });

describe("doctor prompts-file", () => {
  it("inspects a saved prompts/list response and exits by status", async () => {
    const valid = capture();
    expect(await runCli(["doctor", "prompts-file", await promptsFile("ok.json", [review([{ name: "code" }])])], valid.io)).toBe(0);
    expect(valid.stdout.join("\n")).toContain("Offline MCP Prompt Definitions");

    const invalid = capture();
    expect(await runCli(["doctor", "prompts-file", await promptsFile("bad.json", [{ name: "" }]), "--json"], invalid.io)).toBe(1);
    expect(JSON.parse(invalid.stdout.join("\n"))).toMatchObject({ scope: "prompt-definitions-file", status: "fail" });
  });

  it("rejects extra arguments", async () => {
    const c = capture();
    const inspectMcpPromptFileImpl = vi.fn();
    expect(await runCli(["doctor", "prompts-file", "prompts.json", "--json", "--json"], c.io, { inspectMcpPromptFileImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("Invalid file inspection arguments. Usage: codex-plugin-doctor doctor prompts-file <path> [--json]");
    expect(inspectMcpPromptFileImpl).not.toHaveBeenCalled();
  });
});

describe("doctor prompts-diff", () => {
  it("labels a newly required argument as breaking and gates CI with --fail-on breaking", async () => {
    const before = await promptsFile("before.json", [review([{ name: "code" }]), { name: "summarize" }]);
    const after = await promptsFile("after.json", [review([{ name: "code", required: true }]), { name: "summarize", description: "Shorter" }]);

    const text = capture();
    expect(await runCli(["doctor", "prompts-diff", "--before", before, "--after", after, "--fail-on", "breaking"], text.io)).toBe(1);
    const output = text.stdout.join("\n");
    expect(output).toContain("Offline MCP Prompt Diff");
    expect(output).toContain("prompt-argument-now-required");
    expect(output).not.toMatch(/code_review|summarize/u);

    const compatibleOnly = capture();
    const unchangedArguments = await promptsFile("compatible.json", [review([{ name: "code" }]), { name: "summarize", description: "Shorter" }]);
    expect(await runCli(["doctor", "prompts-diff", "--before", before, "--after", unchangedArguments, "--fail-on", "breaking"], compatibleOnly.io)).toBe(0);
  });

  it("names prompts and arguments only with --show-names", async () => {
    const before = await promptsFile("before.json", [review([{ name: "code" }, { name: "style" }])]);
    const after = await promptsFile("after.json", [review([{ name: "code" }])]);

    const markdown = capture();
    expect(await runCli(["doctor", "prompts-diff", "--before", before, "--after", after, "--markdown", "--show-names"], markdown.io)).toBe(1);
    expect(markdown.stdout.join("\n")).toContain("| `\"code_review\"` | `prompt-argument-removed` | `\"style\"` |");

    const json = capture();
    expect(await runCli(["doctor", "prompts-diff", "--before", before, "--after", after, "--json"], json.io)).toBe(1);
    expect(json.stdout.join("\n")).not.toMatch(/code_review|style/u);
  });

  it("passes showNames to the comparison only when asked and rejects bad arguments", async () => {
    const compareMcpPromptFilesImpl = vi.fn().mockResolvedValue({ status: "pass", comparison: { breaking: 0, unclassified: 0 } });
    expect(await runCli(["doctor", "prompts-diff", "--before", "a.json", "--after", "b.json", "--json"], capture().io, { compareMcpPromptFilesImpl })).toBe(0);
    expect(compareMcpPromptFilesImpl).toHaveBeenLastCalledWith("a.json", "b.json");
    expect(await runCli(["doctor", "prompts-diff", "--before", "a.json", "--after", "b.json", "--json", "--show-names"], capture().io, { compareMcpPromptFilesImpl })).toBe(0);
    expect(compareMcpPromptFilesImpl).toHaveBeenLastCalledWith("a.json", "b.json", { showNames: true });

    const c = capture();
    expect(await runCli(["doctor", "prompts-diff", "--before", "a.json"], c.io, { compareMcpPromptFilesImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("Invalid comparison arguments. Usage: codex-plugin-doctor doctor prompts-diff");
    expect(compareMcpPromptFilesImpl).toHaveBeenCalledTimes(2);
  });

  it("documents the commands in help", async () => {
    const diff = capture();
    expect(await runCli(["doctor", "prompts-diff", "--help"], diff.io)).toBe(0);
    expect(diff.stdout.join("\n")).toContain("--show-names adds prompt names and the argument behind each reason");
    const file = capture();
    expect(await runCli(["doctor", "prompts-file", "--help"], file.io)).toBe(0);
    expect(file.stdout.join("\n")).toContain("No server connection or prompt retrieval.");
  });
});
