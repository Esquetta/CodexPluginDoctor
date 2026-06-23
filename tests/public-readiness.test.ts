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

  it("documents and exposes the release preflight automation", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      scripts?: Record<string, string>;
    };
    const releaseCheck = await readText("scripts/release-check.mjs");
    const readme = await readText("README.md");

    expect(packageJson.scripts?.["release-check"]).toBe("node scripts/release-check.mjs");
    expect(releaseCheck).toContain("npm view codex-plugin-doctor version");
    expect(releaseCheck).toContain("npm pack --dry-run");
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
  });
});
