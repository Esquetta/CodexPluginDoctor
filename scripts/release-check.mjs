import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Preflight includes: npm view codex-plugin-doctor@<version> version
// Preflight includes: npm pack --dry-run
// Preflight includes: npm publish --dry-run --access public
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const allowDirty = args.has("--allow-dirty") || process.env.npm_config_allow_dirty === "true";
const allowPublished =
  args.has("--allow-published") || process.env.npm_config_allow_published === "true";

function resolveCommand(command, commandArgs) {
  if (process.platform === "win32" && ["npm", "npx"].includes(command)) {
    return {
      command: process.env.ComSpec ?? "cmd.exe",
      args: ["/d", "/s", "/c", command, ...commandArgs]
    };
  }

  return { command, args: commandArgs };
}

function run(command, commandArgs, options = {}) {
  const label = [command, ...commandArgs].join(" ");
  console.log(`> ${label}`);
  const resolved = resolveCommand(command, commandArgs);
  const result = spawnSync(resolved.command, resolved.args, {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
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

function isUnpublishedVersionError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /\bE404\b|npm (?:error|ERR!) 404\b/i.test(message);
}

export function assertVersionIsPublishable(
  version,
  options = {}
) {
  const commandRunner = options.run ?? run;
  const publishedAllowed = options.allowPublished ?? allowPublished;

  try {
    commandRunner(
      "npm",
      ["view", `codex-plugin-doctor@${version}`, "version"],
      { capture: true }
    );
  } catch (error) {
    if (isUnpublishedVersionError(error)) {
      return;
    }

    throw error;
  }

  if (!publishedAllowed) {
    throw new Error(
      `Version ${version} is already published. Bump package.json or pass --allow-published.`
    );
  }
}

export function assertFreshInstallAudit(version, options = {}) {
  const commandRunner = options.run ?? run;
  const tempDirectory =
    options.tempDirectory ?? mkdtempSync(path.join(os.tmpdir(), "codex-plugin-doctor-release-"));

  try {
    const packOutput = commandRunner(
      "npm",
      ["pack", "--json", "--pack-destination", tempDirectory],
      { capture: true }
    );
    const [{ filename }] = JSON.parse(packOutput);
    const tarballPath = path.join(tempDirectory, filename);

    commandRunner("npm", ["init", "-y"], { cwd: tempDirectory });
    commandRunner("npm", ["install", "--no-fund", "--no-audit", tarballPath], {
      cwd: tempDirectory
    });

    const installedVersion = commandRunner(
      "npx",
      ["--no-install", "codex-plugin-doctor", "--version"],
      { cwd: tempDirectory, capture: true }
    );

    if (installedVersion !== version) {
      throw new Error(
        `Fresh install resolved ${installedVersion || "no version"} instead of ${version}.`
      );
    }

    commandRunner("npm", ["audit", "--audit-level=low"], { cwd: tempDirectory });
  } finally {
    if (!options.tempDirectory) {
      rmSync(tempDirectory, { recursive: true, force: true });
    }
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
  assertFreshInstallAudit(version);
  run("npm", ["publish", "--dry-run", "--access", "public"]);
  console.log("Release check passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release-check failed: ${message}`);
    process.exitCode = 1;
  }
}
