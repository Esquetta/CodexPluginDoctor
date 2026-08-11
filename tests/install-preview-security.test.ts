import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildClaudeDesktopInstallPreview } from "../src/compatibility/claude-desktop-install-preview.js";
import { buildClineInstallPreview } from "../src/compatibility/cline-install-preview.js";
import { buildCursorInstallPreview } from "../src/compatibility/cursor-install-preview.js";
import { buildWindsurfInstallPreview } from "../src/compatibility/windsurf-install-preview.js";

async function createSymlinkedMcpPackage(): Promise<string> {
  const rootPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-preview-escape-"));
  const outsidePath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-preview-outside-"));
  await mkdir(path.join(rootPath, ".codex-plugin"));
  await writeFile(
    path.join(rootPath, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "preview-escape", version: "1.0.0", description: "Preview escape fixture.", mcpServers: "./.mcp.json" }),
    "utf8"
  );
  await writeFile(
    path.join(outsidePath, ".mcp.json"),
    JSON.stringify({ mcpServers: { outside: { command: "outside-preview-secret" } } }),
    "utf8"
  );
  await symlink(outsidePath, path.join(rootPath, "linked"), "junction");
  await writeFile(
    path.join(rootPath, ".codex-plugin", "plugin.json"),
    JSON.stringify({ name: "preview-escape", version: "1.0.0", description: "Preview escape fixture.", mcpServers: "./linked/.mcp.json" }),
    "utf8"
  );
  return rootPath;
}

describe("MCP install preview containment", () => {
  it.each([
    ["Claude Desktop", (targetPath: string) => buildClaudeDesktopInstallPreview(targetPath, { platform: "win32", env: { APPDATA: "C:\\preview" } })],
    ["Cline", (targetPath: string) => buildClineInstallPreview(targetPath, { homedir: "C:\\preview" })],
    ["Cursor", (targetPath: string) => buildCursorInstallPreview(targetPath, { homedir: "C:\\preview" })],
    ["Windsurf", (targetPath: string) => buildWindsurfInstallPreview(targetPath, { homedir: "C:\\preview" })]
  ])("rejects a canonical MCP config escape for %s", async (_client, buildPreview) => {
    const targetPath = await createSymlinkedMcpPackage();

    await expect(buildPreview(targetPath)).rejects.toThrow("outside the package root");
  });
});
