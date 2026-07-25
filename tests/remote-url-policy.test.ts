import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { inspectRemoteMcpUrl } from "../src/core/remote-url-policy.js";
import { validatePlugin } from "../src/core/validate-plugin.js";

async function createPluginWithMcp(mcpConfig: unknown): Promise<string> {
  const targetPath = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-remote-url-"));

  await mkdir(path.join(targetPath, ".codex-plugin"), { recursive: true });
  await mkdir(path.join(targetPath, "skills", "hello"), { recursive: true });
  await writeFile(
    path.join(targetPath, ".codex-plugin", "plugin.json"),
    JSON.stringify({
      name: "remote-url-fixture",
      version: "1.0.0",
      description: "Fixture plugin for remote MCP URL validation.",
      skills: "./skills",
      mcpServers: "./.mcp.json"
    }),
    "utf8"
  );
  await writeFile(
    path.join(targetPath, "skills", "hello", "SKILL.md"),
    "---\nname: hello\ndescription: Fixture skill.\n---\n",
    "utf8"
  );
  await writeFile(path.join(targetPath, ".mcp.json"), JSON.stringify(mcpConfig), "utf8");

  return targetPath;
}

describe("inspectRemoteMcpUrl", () => {
  it("normalizes accepted HTTPS and localhost development URLs", () => {
    expect(inspectRemoteMcpUrl("HTTPS://Example.COM:443/mcp")).toMatchObject({
      sanitizedUrl: "https://example.com/mcp",
      isLoopbackHost: false,
      issues: []
    });
    expect(inspectRemoteMcpUrl("http://LOCALHOST:3000/mcp")).toMatchObject({
      sanitizedUrl: "http://localhost:3000/mcp",
      isLoopbackHost: true,
      issues: []
    });
  });

  it.each([
    ["not-a-url", ["invalid"]],
    ["ftp://example.com/mcp", ["unsupported_scheme"]],
    ["https://user:secret@example.com/mcp", ["credentials"]],
    ["https://example.com/mcp?token=secret", ["query"]],
    ["https://example.com/mcp#secret", ["fragment"]],
    ["https://example.com/mcp?", ["query"]],
    ["https://example.com/mcp#", ["fragment"]],
    ["https://example.com/mcp?#", ["query", "fragment"]],
    ["https://127.0.0.1/mcp", ["ip_literal"]],
    ["https://[::1]/mcp", ["ip_literal"]],
    ["http://example.com/mcp", ["insecure_non_loopback"]]
  ])("classifies %s without retaining unsafe URL components", (rawUrl, issues) => {
    const inspection = inspectRemoteMcpUrl(rawUrl);

    expect(inspection.issues).toEqual(issues);
    expect(inspection.sanitizedUrl === null || !inspection.sanitizedUrl.includes("secret")).toBe(true);
  });

  it("reports empty query and fragment delimiters to plugin validation without exposing the URL", async () => {
    const rawUrl = "https://example.com/mcp?#";
    const targetPath = await createPluginWithMcp({
      mcpServers: {
        remote: { url: rawUrl }
      }
    });

    const result = await validatePlugin(targetPath);
    const serialized = JSON.stringify(result.findings);

    expect(result.status).toBe("fail");
    expect(result.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "plugin.security.remote_mcp_url.query",
        "plugin.security.remote_mcp_url.fragment"
      ])
    );
    expect(serialized).not.toContain(rawUrl);
  });
});

describe("plugin remote MCP validation", () => {
  it("fails conflicting and credential-bearing remote transports without leaking the raw URL", async () => {
    const rawUrl = "https://user:secret@example.com/mcp?token=secret";
    const targetPath = await createPluginWithMcp({
      mcpServers: {
        remote: { command: "node", url: rawUrl }
      }
    });

    const result = await validatePlugin(targetPath);
    const serialized = JSON.stringify(result.findings);

    expect(result.status).toBe("fail");
    expect(result.findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "plugin.mcp.server.transport.conflict",
        "plugin.security.remote_mcp_url.credentials",
        "plugin.security.remote_mcp_url.query"
      ])
    );
    expect(serialized).not.toContain(rawUrl);
    expect(serialized).not.toContain("secret");
  });
});
