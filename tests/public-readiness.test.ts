import { readFile } from "node:fs/promises";
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
});
