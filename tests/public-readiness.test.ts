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
    expect(readme).toContain("npm run release-check");
  });

  it("documents the current 1.0 readiness state without stale pre-public wording", async () => {
    const packageJson = JSON.parse(await readText("package.json")) as {
      version: string;
    };
    const readme = await readText("README.md");
    const docsReadme = await readText("docs/README.md");
    const versioning = await readText("docs/engineering/versioning-and-releases.md");
    const publicReleaseChecklist = await readText("docs/operations/public-release-checklist.md");
    const readinessChecklist = await readText("docs/engineering/v1.0-readiness-checklist.md");
    const packageDistTag = packageJson.version.includes("-") ? "next" : "latest";

    expect(readme).not.toContain("early public CLI release");
    expect(readme).toContain("1.0 readiness");
    expect(docsReadme).toContain("v1.0 Readiness Checklist");
    expect(versioning).toContain(`codex-plugin-doctor@${packageJson.version}`);
    expect(versioning).toContain(packageJson.version);
    expect(publicReleaseChecklist).toContain(
      `npm ${packageDistTag}: codex-plugin-doctor@${packageJson.version}`
    );
    expect(publicReleaseChecklist).toContain("1.0 Readiness Checklist");
    expect(readinessChecklist).toContain(packageJson.version);
    expect(readinessChecklist).toContain("Expected result: non-zero status with `plugin.manifest.missing`");
    expect(readinessChecklist).toContain("No new feature work");
    expect(readinessChecklist).toContain("npm run release-check");
  });
});
