import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub Action metadata", () => {
  it("exposes a composite action that installs and runs codex-plugin-doctor", async () => {
    const actionMetadata = await readFile("action.yml", "utf8");

    expect(actionMetadata).toContain("name: Codex Plugin Doctor");
    expect(actionMetadata).toContain("using: composite");
    expect(actionMetadata).toContain("npm install -g codex-plugin-doctor@${{ inputs.version }}");
    expect(actionMetadata).toContain("args=(check)");
    expect(actionMetadata).toContain('codex-plugin-doctor "${args[@]}"');
    expect(actionMetadata).toContain("inputs:");
    expect(actionMetadata).toContain("version:");
    expect(actionMetadata).toContain("path:");
    expect(actionMetadata).toContain("runtime:");
    expect(actionMetadata).toContain("history:");
    expect(actionMetadata).toContain('args+=(--history "${{ inputs.history }}")');
  });

  it("documents the public GitHub Action consumer workflow", async () => {
    const readme = await readFile("README.md", "utf8");
    const actionUsage = await readFile("docs/engineering/github-action-usage.md", "utf8");

    expect(readme).toContain("Esquetta/CodexPluginDoctor@v0.7.0");
    expect(readme).toContain("docs/engineering/github-action-usage.md");
    expect(actionUsage).toContain("uses: Esquetta/CodexPluginDoctor@v0.7.0");
    expect(actionUsage).toContain('runtime: "true"');
    expect(actionUsage).toContain('sarif: "true"');
    expect(actionUsage).toContain("history: validation-history.jsonl");
    expect(actionUsage).toContain("--fail-on-regression");
    expect(actionUsage).toContain("--profile publish");
  });
});
