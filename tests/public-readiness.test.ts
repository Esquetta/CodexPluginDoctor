import { access, readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readText(path: string): Promise<string> {
  return readFile(path, "utf8");
}

describe("public repository readiness", () => {
  it("documents contribution, security, and conduct expectations", async () => {
    const contributing = await readText("CONTRIBUTING.md");
    const security = await readText("SECURITY.md");
    const conduct = await readText("CODE_OF_CONDUCT.md");

    expect(contributing).toContain("npm test");
    expect(contributing).toContain("npm run build");
    expect(contributing).toContain("codex-plugin-doctor compat");
    expect(security).toContain("Please do not open a public issue for suspected vulnerabilities");
    expect(security).toContain("Supported Versions");
    expect(conduct).toContain("Contributor Covenant");
  });

  it("provides a pull request template and public README badges", async () => {
    const pullRequestTemplate = await readText(".github/PULL_REQUEST_TEMPLATE.md");
    const readme = await readText("README.md");

    expect(pullRequestTemplate).toContain("Verification");
    expect(pullRequestTemplate).toContain("npm test");
    expect(readme).toContain("img.shields.io/npm/v/codex-plugin-doctor");
    expect(readme).toContain("CONTRIBUTING.md");
    expect(readme).toContain("SECURITY.md");
    expect(readme).toContain("CODE_OF_CONDUCT.md");
  });

  it("documents and exposes the release preflight automation", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    const releaseCheck = await readText("scripts/release-check.mjs");
    const readme = await readText("README.md");

    expect(packageJson.scripts?.["release-check"]).toBe("node scripts/release-check.mjs");
    expect(releaseCheck).toContain("npm view codex-plugin-doctor@<version> version");
    expect(releaseCheck).toContain("npm pack --dry-run");
    expect(releaseCheck).toContain("assertReleaseMetadataSync");
    expect(releaseCheck).toContain(
      'run("npm", ["publish", "--dry-run", "--access", "public"]);'
    );
    expect(readme).toContain("npm run release-check");
  });

  it("keeps public documentation focused on users and contributors", async () => {
    const readme = await readText("README.md");
    const docsReadme = await readText("docs/README.md");
    const releasing = await readText("docs/contributing/releasing.md");

    expect(readme).not.toContain("early public CLI release");
    expect(readme).toContain("1.0 Stability");
    expect(docsReadme).toContain("## Architecture");
    expect(docsReadme).toContain("## Guides");
    expect(docsReadme).toContain("## Security");
    expect(docsReadme).toContain("## Contributing");
    expect(docsReadme).not.toContain("Go-To-Market");
    expect(docsReadme).not.toContain("superpowers");
    expect(releasing).toContain("npm run release-check");
    expect(releasing).toContain("npm run verify-release-sync");
    await expect(access("validation-sessions")).rejects.toThrow();
    expect(`${readme}\n${docsReadme}`).not.toMatch(/validation-sessions|internal only/i);
  });

  it("documents remote MCP transport and endpoint validation rules", async () => {
    const catalog = await readText("docs/rules/catalog.md");

    expect(catalog).toContain(
      "| `mcp.server.transport.conflict` | fail | An MCP server defines both command and URL transports. |"
    );
    expect(catalog).toContain(
      "| `plugin.mcp.server.transport.conflict` | fail | A bundled MCP server defines both command and URL transports. |"
    );
    expect(catalog).toContain(
      "| `plugin.security.remote_mcp_url.invalid` | fail | An MCP server URL is not an absolute HTTP or HTTPS URL. |"
    );
    expect(catalog).toContain(
      "| `plugin.security.remote_mcp_url.unsupported_scheme` | fail | An MCP server URL uses an unsupported scheme. |"
    );
    expect(catalog).toContain(
      "| `plugin.security.remote_mcp_url.credentials` | fail | An MCP server URL embeds credentials. |"
    );
    expect(catalog).toContain(
      "| `plugin.security.remote_mcp_url.query` | fail | An MCP server URL contains a query string. |"
    );
    expect(catalog).toContain(
      "| `plugin.security.remote_mcp_url.fragment` | fail | An MCP server URL contains a fragment. |"
    );
    expect(catalog).toContain(
      "| `plugin.security.remote_mcp_url.ip_literal` | fail | An MCP server URL uses a numeric IP literal. |"
    );
  });

  it("documents official plugin component validation and its static boundary", async () => {
    const readme = await readText("README.md");
    const docsReadme = await readText("docs/README.md");
    const catalog = await readText("docs/rules/catalog.md");
    const guide = await readText("docs/architecture/official-plugin-components.md");

    expect(readme).toContain("Official Plugin Components");
    expect(docsReadme).toContain("Official Plugin Components");
    expect(guide).toContain("direct top-level server map");
    expect(guide).toContain("`mcp_servers`");
    expect(guide).toContain("`mcpServers`");
    expect(guide).toContain("ambiguous");
    expect(guide).toContain("camel-case `mcpServers`");
    expect(guide).toMatch(/optional metadata/i);
    expect(guide).toContain("`hooks/hooks.json`");
    expect(guide).toContain("PreToolUse");
    expect(guide).toContain("SessionEnd");
    expect(guide).toContain("unsupported");
    expect(guide).toContain("ignored");
    expect(guide).toContain("not published");
    expect(guide).toContain("does not execute hooks or apps");

    for (const [id, severity] of [
      ["plugin.mcp.ambiguous_shape", "fail"],
      ["plugin.manifest.invalid_field", "fail"],
      ["plugin.manifest.invalid_path", "fail"],
      ["plugin.app.missing_file", "fail"],
      ["plugin.app.invalid_json", "fail"],
      ["plugin.app.invalid_path", "fail"],
      ["plugin.hook.missing_file", "fail"],
      ["plugin.hook.invalid_json", "fail"],
      ["plugin.hook.invalid_shape", "fail"],
      ["plugin.hook.invalid_path", "fail"],
      ["plugin.hook.unsupported_event", "fail"],
      ["plugin.hook.unsupported_handler", "warn"],
      ["plugin.hook.async_unsupported", "warn"],
      ["plugin.hook.matcher_ignored", "warn"]
    ]) {
      expect(catalog).toContain(`| \`${id}\` | ${severity} |`);
    }
  });

  it("publishes the remote MCP readiness boundary without exposing internal planning", async () => {
    const readme = await readText("README.md");
    const actionGuide = await readText("docs/guides/github-action.md");
    const conformance = await readText("docs/architecture/mcp-2025-11-conformance.md");
    const readiness = await readText("docs/architecture/remote-mcp-readiness.md");
    const reliability = await readText("docs/architecture/remote-mcp-transport-reliability.md");
    const releaseGating = await readText("docs/guides/release-gating.md");
    const runtimeSecurity = await readText("docs/security/runtime-approval-and-sandboxing.md");
    const docsReadme = await readText("docs/README.md");
    const security = await readText("docs/security/security-architecture.md");
    expect(readme).toContain("Remote MCP Readiness");
    expect(actionGuide).toContain('allow-network: "true"');
    expect(actionGuide).toContain('allow-local-network: "true"');
    expect(conformance).toContain("OAuth metadata discovery");
    expect(readiness).toMatch(/explicit consent/i);
    expect(readiness).toContain("SSRF");
    expect(readiness).toContain("NAT64 Pref64");
    expect(readiness).toContain("authenticated OAuth");
    expect(readiness).toContain("custom headers");
    expect(readiness).toContain("remote tool/resource/prompt/task calls");
    expect(readiness).toContain("one bounded GET request");
    expect(readiness).toContain("redirects");
    expect(docsReadme).toContain("Remote MCP Readiness");
    expect(docsReadme).toContain("Remote MCP Transport Reliability");
    expect(readme).toContain("--allow-session-lifecycle");
    expect(readme).toContain("--require-remote-reliability");
    expect(readiness).toContain("--allow-session-lifecycle");
    expect(readiness).toContain("--require-remote-reliability");
    expect(reliability).toContain("GET returning 405");
    expect(reliability).toContain("--runtime --allow-network");
    expect(reliability).toContain("one bounded `DELETE` request");
    expect(reliability).toContain("does not claim delivery guarantees");
    expect(reliability).toContain("GET carrying an issued session identifier");
    expect(reliability).toContain("DELETE 404 never restarts or retries");
    for (const document of [reliability, readme, readiness, releaseGating, runtimeSecurity, actionGuide]) {
      expect(document).toMatch(/every attempted remote\s+reliability scorecard passes/);
      expect(document).toContain("Local-only runs are unaffected.");
    }
    expect(releaseGating).toContain("--require-remote-reliability");
    expect(runtimeSecurity).toContain("--allow-session-lifecycle");
    expect(security).toContain("runner or host egress controls");
    expect(readiness).not.toMatch(/internal (implementation )?plan/i);
  });

  it("publishes the MCP Registry readiness and non-execution boundary", async () => {
    const readme = await readText("README.md");
    const docsReadme = await readText("docs/README.md");
    const registry = await readText("docs/architecture/mcp-registry-readiness.md");
    const actionGuide = await readText("docs/guides/github-action.md");
    const releaseGating = await readText("docs/guides/release-gating.md");
    const security = await readText("docs/security/security-architecture.md");

    expect(readme).toContain("MCP Registry Readiness");
    expect(docsReadme).toContain("MCP Registry Readiness");
    expect(registry).toContain("registry inspect");
    expect(registry).toContain("--allow-network");
    expect(registry).toContain("does not prove that the referenced code");
    expect(registry).toContain("never edits Codex configuration");
    expect(registry).toContain("does not follow package, icon, repository, website, or remote MCP URLs");
    expect(actionGuide).toContain("registry-metadata: ./server.json");
    expect(actionGuide).toContain('require-registry-readiness: "true"');
    expect(actionGuide).toContain("registry-report-path");
    expect(releaseGating).toContain("--require-registry-readiness");
    expect(security).toContain("Registry publication proves namespace control");
  });

  it("documents offline public directory submission preflight without implying portal approval", async () => {
    const readme = await readText("README.md");
    const docsReadme = await readText("docs/README.md");
    const architecture = await readText("docs/architecture/public-directory-submission-preflight.md");
    const actionGuide = await readText("docs/guides/github-action.md");
    const catalog = await readText("docs/rules/catalog.md");

    expect(readme).toContain("codex-plugin-doctor doctor submission <path>");
    expect(readme).toContain("--json");
    expect(readme).toContain("--markdown");
    expect(readme).toContain("--require-ready");
    expect(readme).toContain("manual_review_required");
    expect(docsReadme).toContain("Public Directory Submission Preflight");
    expect(architecture).toContain("no network requests");
    expect(architecture).toContain("does not submit a package");
    expect(architecture).toContain("manual_review_required");
    expect(actionGuide).toContain("Esquetta/CodexPluginDoctor@v1.59.0");
    expect(actionGuide).toContain('submission: "true"');
    expect(actionGuide).toContain('require-submission-ready: "true"');
    expect(actionGuide).toContain("submission-json-path");
    expect(actionGuide).toContain("submission-summary-path");
    expect(actionGuide).toContain("does not require runtime or network access");
    expect(actionGuide).toContain("requires `submission: \"true\"`");
    expect(actionGuide).not.toMatch(/internal (implementation )?plan/i);
    expect(actionGuide).not.toMatch(/portal acceptance|automatic manual pass/i);

    for (const [id, severity] of [
      ["plugin.submission.package.invalid", "fail"],
      ["plugin.submission.interface.unknown_field", "warn"],
      ["plugin.submission.asset.extension_mismatch", "fail"],
      ["plugin.submission.package.too_large", "fail"],
      ["plugin.submission.skill.agent.invalid_yaml", "fail"],
      ["plugin.submission.skill.required", "fail"],
      ["plugin.submission.skill.too_many", "fail"],
      ["plugin.submission.skill.budget_exceeded", "fail"]
    ]) {
      expect(catalog).toContain(`| \`${id}\` | ${severity} |`);
    }
  });
});
