import { lstat, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { validatePlugin } from "../src/core/validate-plugin.js";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map(async (temporaryPath) => {
      const { rm } = await import("node:fs/promises");
      await rm(temporaryPath, { recursive: true, force: true });
    })
  );
});

async function createPlugin(manifest: Record<string, unknown>): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-components-"));
  temporaryPaths.push(rootPath);
  await mkdir(path.join(rootPath, ".codex-plugin"), { recursive: true });
  await writeFile(
    path.join(rootPath, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "component-fixture",
      version: "1.0.0",
      description: "Component validation fixture.",
      ...manifest
    }),
    "utf8"
  );
  return rootPath;
}

function findingIds(result: Awaited<ReturnType<typeof validatePlugin>>): string[] {
  return result.findings.map((finding) => finding.id);
}

describe("plugin component validation", () => {
  it("accepts valid official metadata and local component paths", async () => {
    const rootPath = await createPlugin({
      author: { name: "Ada", email: "ada@example.test", url: "https://example.test/ada" },
      homepage: "https://example.test",
      repository: "https://github.com/example/plugin",
      license: "MIT",
      keywords: ["codex", "plugin"],
      apps: "./apps/app.json",
      interface: {
        displayName: "Example",
        shortDescription: "Short",
        longDescription: "Long",
        developerName: "Example Inc.",
        category: "productivity",
        websiteURL: "https://example.test",
        privacyPolicyURL: "https://example.test/privacy",
        termsOfServiceURL: "https://example.test/terms",
        brandColor: "#111111",
        composerIcon: "./assets/composer.svg",
        logo: "./assets/logo.svg",
        capabilities: ["chat"],
        defaultPrompt: ["Help me"],
        screenshots: ["./assets/screenshot.png"]
      },
      skills: "./skills",
      mcpServers: "./.mcp.json"
    });
    await mkdir(path.join(rootPath, "apps"));
    await mkdir(path.join(rootPath, "assets"));
    await mkdir(path.join(rootPath, "skills"));
    await writeFile(path.join(rootPath, "apps", "app.json"), "null", "utf8");
    await writeFile(path.join(rootPath, "assets", "composer.svg"), "", "utf8");
    await writeFile(path.join(rootPath, "assets", "logo.svg"), "", "utf8");
    await writeFile(path.join(rootPath, "assets", "screenshot.png"), "", "utf8");
    await writeFile(path.join(rootPath, ".mcp.json"), "{}", "utf8");

    const result = await validatePlugin(rootPath);

    expect(findingIds(result)).not.toContain("plugin.manifest.invalid_field");
    expect(findingIds(result)).not.toContain("plugin.manifest.invalid_path");
    expect(findingIds(result)).not.toContain("plugin.app.missing_file");
    expect(findingIds(result)).not.toContain("plugin.app.invalid_json");
  });

  it("rejects malformed optional metadata without retaining content in evidence", async () => {
    const rootPath = await createPlugin({
      author: "Ada",
      homepage: "mailto:ada@example.test",
      repository: 42,
      license: false,
      keywords: ["codex", 3],
      interface: { displayName: 7, websiteURL: "not-a-url", capabilities: "chat" }
    });

    const result = await validatePlugin(rootPath);
    const findings = result.findings.filter((finding) => finding.id === "plugin.manifest.invalid_field");

    expect(findings).toHaveLength(8);
    expect(findings.every((finding) => finding.severity === "fail")).toBe(true);
    expect(findings.flatMap((finding) => Object.values(finding.evidence ?? {}))).not.toContain("mailto:ada@example.test");
  });

  it.each(["assets/logo.svg", "..\\outside.json", "../outside.json"])("rejects non-package app paths: %s", async (apps) => {
    const rootPath = await createPlugin({ apps });

    const result = await validatePlugin(rootPath);

    expect(findingIds(result)).toContain("plugin.app.invalid_path");
  });

  it.each(["skills", "mcpServers"])("requires a ./ package path for %s", async (field) => {
    const rootPath = await createPlugin({ [field]: field === "skills" ? "skills" : ".mcp.json" });

    const result = await validatePlugin(rootPath);

    expect(findingIds(result)).toContain("plugin.manifest.invalid_path");
  });

  it.each([
    ["skills", "skills"],
    ["mcpServers", ".mcp.json"],
    ["skills", "../outside-skills"],
    ["mcpServers", "../outside/.mcp.json"]
  ])("emits one authoritative path finding for %s: %s", async (field, value) => {
    const rootPath = await createPlugin({ [field]: value });

    const result = await validatePlugin(rootPath);

    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]).toMatchObject({
      id: "plugin.manifest.invalid_path",
      severity: "fail",
      evidence: { manifestPath: ".codex-plugin/plugin.json", field }
    });
    expect(JSON.stringify(result.findings[0].evidence)).not.toContain(rootPath);
  });

  it("reports missing and malformed app manifests while accepting every parseable JSON value", async () => {
    const rootPath = await createPlugin({ apps: "./apps/app.json" });
    await mkdir(path.join(rootPath, "apps"));

    expect(findingIds(await validatePlugin(rootPath))).toContain("plugin.app.missing_file");

    await writeFile(path.join(rootPath, "apps", "app.json"), "{", "utf8");
    expect(findingIds(await validatePlugin(rootPath))).toContain("plugin.app.invalid_json");

    for (const content of ["null", "[]", "{}", "true", "42", "\"text\""]) {
      await writeFile(path.join(rootPath, "apps", "app.json"), content, "utf8");
      expect(findingIds(await validatePlugin(rootPath))).not.toContain("plugin.app.invalid_json");
    }
  });

  it("uses package-relative POSIX evidence and has no process or network behavior", async () => {
    const rootPath = await createPlugin({ apps: "./missing/app.json" });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const result = await validatePlugin(rootPath);
    const finding = result.findings.find((candidate) => candidate.id === "plugin.app.missing_file");

    expect(finding?.evidence).toEqual({ field: "apps", path: "missing/app.json" });
    expect(JSON.stringify(finding?.evidence)).not.toContain(rootPath);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await readFile("src/core/plugin-components.ts", "utf8")).not.toMatch(/node:child_process|fetch\s*\(/);
  });

  it("rejects existing component targets that resolve through a symlink outside the package", async () => {
    const rootPath = await createPlugin({ apps: "./apps/app.json" });
    const externalPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-external-"));
    temporaryPaths.push(externalPath);
    await writeFile(path.join(externalPath, "app.json"), "{}", "utf8");
    await symlink(externalPath, path.join(rootPath, "apps"), "junction");

    const result = await validatePlugin(rootPath);

    expect(await lstat(path.join(rootPath, "apps"))).toBeTruthy();
    expect(findingIds(result)).toContain("plugin.app.invalid_path");
  });
});
