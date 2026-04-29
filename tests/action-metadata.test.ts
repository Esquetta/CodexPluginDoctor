import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("GitHub Action metadata", () => {
  it("exposes a composite action that installs and runs codex-plugin-doctor", async () => {
    const actionMetadata = await readFile("action.yml", "utf8");

    expect(actionMetadata).toContain("name: Codex Plugin Doctor");
    expect(actionMetadata).toContain("using: composite");
    expect(actionMetadata).toContain("npm install -g codex-plugin-doctor@latest");
    expect(actionMetadata).toContain("args=(check)");
    expect(actionMetadata).toContain('codex-plugin-doctor "${args[@]}"');
    expect(actionMetadata).toContain("inputs:");
    expect(actionMetadata).toContain("path:");
    expect(actionMetadata).toContain("runtime:");
  });
});
