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
    const cliName = command === "npm" ? "npm-cli.js" : "npx-cli.js";
    const cliPath =
      command === "npm" && process.env.npm_execpath
        ? process.env.npm_execpath
        : path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", cliName);

    return {
      command: process.execPath,
      args: [cliPath, ...commandArgs]
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

  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";

  return options.includeStderr && stderr
    ? [stdout, stderr].filter(Boolean).join("\n")
    : stdout;
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
    const filename = parsePackedTarballFilename(packOutput);
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

export function parsePackedTarballFilename(packOutput) {
  const parsed = JSON.parse(packOutput);
  const entries = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === "object"
      ? Object.values(parsed)
      : [];
  const metadata = entries.find(
    (entry) => entry && typeof entry === "object" && typeof entry.filename === "string"
  );

  if (!metadata) {
    throw new Error("npm pack did not return tarball metadata.");
  }

  return metadata.filename;
}

export function assertUpdateCheckSmoke(version, options = {}) {
  const commandRunner = options.run ?? run;
  const output = commandRunner(
    "node",
    ["dist/cli.js", "doctor", "--update-check"],
    { capture: true, includeStderr: true }
  );

  if (output.includes("DEP0190")) {
    throw new Error("Update check emitted Node DEP0190 shell warning.");
  }

  if (!output.includes(`Installed: ${version}`) || !output.includes("Status:")) {
    throw new Error("Update check smoke output was incomplete.");
  }
}

export async function assertSecuritySelfScan(options = {}) {
  const scan =
    options.scan ??
    (async (targetPath) => {
      const moduleUrl = pathToFileURL(
        path.join(repoRoot, "dist", "security", "security-audit.js")
      ).href;
      const security = await import(moduleUrl);

      return security.auditChildProcessSourceSurface(targetPath);
    });
  const findings = await scan(repoRoot);

  if (findings.length > 0) {
    const summary = findings.map((finding) => finding.id).join(", ");
    throw new Error(`Security self-scan found risky child_process usage: ${summary}`);
  }
}

async function assertReleaseMetadataSync() {
  const moduleUrl = pathToFileURL(
    path.join(repoRoot, "dist", "core", "release-check.js")
  ).href;
  const releaseCheck = await import(moduleUrl);

  await releaseCheck.assertReleaseMetadataSync(repoRoot);
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

async function main() {
  const version = getPackageVersion();

  console.log(`Codex Plugin Doctor release check for ${version}`);
  assertCleanGit();
  assertVersionIsPublishable(version);
  assertTagDoesNotExist(version);
  run("npm", ["test"]);
  run("npm", ["run", "build"]);
  await assertReleaseMetadataSync();
  assertUpdateCheckSmoke(version);
  await assertSecuritySelfScan();
  run("npm", ["pack", "--dry-run"]);
  assertFreshInstallAudit(version);
  run("npm", ["publish", "--dry-run", "--access", "public"]);
  console.log("Release check passed.");
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`release-check failed: ${message}`);
    process.exitCode = 1;
  });
}
