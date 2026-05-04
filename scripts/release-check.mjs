import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Preflight includes: npm view codex-plugin-doctor version
// Preflight includes: npm pack --dry-run
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const allowDirty = args.has("--allow-dirty") || process.env.npm_config_allow_dirty === "true";
const allowPublished =
  args.has("--allow-published") || process.env.npm_config_allow_published === "true";

function run(command, commandArgs, options = {}) {
  const label = [command, ...commandArgs].join(" ");
  console.log(`> ${label}`);
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: options.capture ? "pipe" : "inherit"
  });

  if (result.status !== 0) {
    const stderr = result.stderr?.trim();
    throw new Error(stderr ? `${label} failed: ${stderr}` : `${label} failed`);
  }

  return result.stdout?.trim() ?? "";
}

function getPackageVersion() {
  const packageJson = JSON.parse(
    readFileSync(path.join(repoRoot, "package.json"), "utf8")
  );

  return String(packageJson.version);
}

function assertCleanGit() {
  const status = run("git", ["status", "--short"], { capture: true });

  if (status && !allowDirty) {
    throw new Error("Working tree is dirty. Commit or stash changes, or pass --allow-dirty.");
  }
}

function assertVersionIsPublishable(version) {
  const publishedVersion = run(
    "npm",
    ["view", "codex-plugin-doctor", "version"],
    { capture: true }
  );

  if (publishedVersion === version && !allowPublished) {
    throw new Error(
      `Version ${version} is already published. Bump package.json or pass --allow-published.`
    );
  }
}

function assertTagDoesNotExist(version) {
  const localTag = run("git", ["tag", "--list", `v${version}`], { capture: true });
  const remoteTag = run("git", ["ls-remote", "--tags", "origin", `refs/tags/v${version}`], {
    capture: true
  });

  if ((localTag || remoteTag) && !allowPublished) {
    throw new Error(`Tag v${version} already exists. Bump the version before releasing.`);
  }
}

function main() {
  const version = getPackageVersion();

  console.log(`Codex Plugin Doctor release check for ${version}`);
  assertCleanGit();
  assertVersionIsPublishable(version);
  assertTagDoesNotExist(version);
  run("npm", ["test"]);
  run("npm", ["run", "build"]);
  run("npm", ["pack", "--dry-run"]);
  console.log("Release check passed.");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`release-check failed: ${message}`);
  process.exitCode = 1;
}
