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

async function directory(): Promise<string> {
  const created = await mkdtemp(path.join(os.tmpdir(), "doctor-resource-templates-diff-cli-"));
  directories.push(created);
  return created;
}

async function templatesFile(name: string, resourceTemplates: unknown[]): Promise<string> {
  const filePath = path.join(await directory(), name);
  await writeFile(filePath, JSON.stringify({ jsonrpc: "2.0", id: "resource-templates-list", result: { resultType: "complete", resourceTemplates, ttlMs: 0, cacheScope: "private" } }));
  return filePath;
}

const files = (uriTemplate: string) => ({ name: "project-files", uriTemplate });

describe("doctor resource-templates-file", () => {
  it("inspects a saved list and exits by status", async () => {
    const valid = capture();
    expect(await runCli(["doctor", "resource-templates-file", await templatesFile("ok.json", [files("file:///{path}")])], valid.io)).toBe(0);
    expect(valid.stdout.join("\n")).toContain("Offline MCP Resource Template Definitions");

    const invalid = capture();
    expect(await runCli(["doctor", "resource-templates-file", await templatesFile("bad.json", [files("file:///{path")]), "--json"], invalid.io)).toBe(1);
    expect(JSON.parse(invalid.stdout.join("\n"))).toMatchObject({ scope: "resource-template-definitions-file", status: "fail" });
  });

  it("rejects extra arguments before reading", async () => {
    const c = capture();
    const inspectMcpResourceTemplateFileImpl = vi.fn();
    expect(await runCli(["doctor", "resource-templates-file", "a.json", "b.json"], c.io, { inspectMcpResourceTemplateFileImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("Usage: codex-plugin-doctor doctor resource-templates-file <path> [--json]");
    expect(inspectMcpResourceTemplateFileImpl).not.toHaveBeenCalled();
  });
});

describe("doctor resource-templates-diff", () => {
  it("labels an added variable as breaking without printing names or URI templates", async () => {
    const before = await templatesFile("before.json", [files("file:///{path}")]);
    const after = await templatesFile("after.json", [files("file:///{root}/{path}")]);

    const text = capture();
    expect(await runCli(["doctor", "resource-templates-diff", "--before", before, "--after", after, "--fail-on", "breaking"], text.io)).toBe(1);
    expect(text.stdout.join("\n")).toContain("resource-template-variable-added");
    expect(text.stdout.join("\n")).not.toMatch(/project-files|file:\/\/\/|\{root\}|"root"/u);

    const markdown = capture();
    expect(await runCli(["doctor", "resource-templates-diff", "--before", before, "--after", after, "--markdown", "--show-names"], markdown.io)).toBe(1);
    expect(markdown.stdout.join("\n")).toContain("| `\"project-files\"` | `resource-template-variable-added` | `\"root\"` |");
    expect(markdown.stdout.join("\n")).not.toContain("file:///");
  });

  it("passes showNames only when asked and rejects bad arguments", async () => {
    const compareMcpResourceTemplateFilesImpl = vi.fn().mockResolvedValue({ status: "pass", comparison: { breaking: 0, unclassified: 0 } });
    expect(await runCli(["doctor", "resource-templates-diff", "--before", "a.json", "--after", "b.json", "--json"], capture().io, { compareMcpResourceTemplateFilesImpl })).toBe(0);
    expect(compareMcpResourceTemplateFilesImpl).toHaveBeenLastCalledWith("a.json", "b.json");
    expect(await runCli(["doctor", "resource-templates-diff", "--before", "a.json", "--after", "b.json", "--json", "--show-names"], capture().io, { compareMcpResourceTemplateFilesImpl })).toBe(0);
    expect(compareMcpResourceTemplateFilesImpl).toHaveBeenLastCalledWith("a.json", "b.json", { showNames: true });

    const c = capture();
    expect(await runCli(["doctor", "resource-templates-diff", "--after", "b.json"], c.io, { compareMcpResourceTemplateFilesImpl })).toBe(2);
    expect(c.stderr.join("\n")).toContain("Invalid comparison arguments. Usage: codex-plugin-doctor doctor resource-templates-diff");
  });

  it("compares real stdio captures saved by doctor resource-templates", async () => {
    const fixtureRoot = path.resolve("tests", "fixtures", "stdio-resource-template-catalog");
    const target = await directory();
    const modern = path.join(target, "modern.json");
    const legacy = path.join(target, "legacy.json");
    expect(await runCli(["doctor", "resource-templates", fixtureRoot, "--server", "modern", "--runtime", "--save-response", modern], capture().io)).toBe(0);
    expect(await runCli(["doctor", "resource-templates", fixtureRoot, "--server", "legacy", "--runtime", "--save-response", legacy], capture().io)).toBe(0);
    expect(await runCli(["doctor", "resource-templates-file", modern], capture().io)).toBe(0);

    const diff = capture();
    expect(await runCli(["doctor", "resource-templates-diff", "--before", modern, "--after", legacy, "--json"], diff.io)).toBe(0);
    expect(JSON.parse(diff.stdout.join("\n"))).toMatchObject({ status: "pass", comparison: { complete: true, unchanged: 2 } });
  });

  it("documents the commands in help", async () => {
    const diff = capture();
    expect(await runCli(["doctor", "resource-templates-diff", "--help"], diff.io)).toBe(0);
    expect(diff.stdout.join("\n")).toContain("never include URI templates");
    const file = capture();
    expect(await runCli(["doctor", "resource-templates-file", "--help"], file.io)).toBe(0);
    expect(file.stdout.join("\n")).toContain("No server connection or resource read.");
  });
});
