import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoName = "Esquetta/CodexPluginDoctor";

function parseVersionArg() {
  const versionIndex = process.argv.indexOf("--version");

  if (versionIndex === -1) {
    return null;
  }

  return process.argv[versionIndex + 1] ?? null;
}

function parseStringArg(name, fallback) {
  const index = process.argv.indexOf(name);
  const npmConfigValue = readNpmConfig(name);

  if (npmConfigValue && npmConfigValue !== "true") {
    return npmConfigValue;
  }

  if (index !== -1) {
    return process.argv[index + 1] ?? fallback;
  }

  if (npmConfigValue === "true") {
    return readNpmConfigPositional(name) ?? fallback;
  }

  return fallback;
}

function hasFlag(name) {
  const npmConfigValue = readNpmConfig(name);

  return process.argv.includes(name) || npmConfigValue === "true";
}

function readNpmConfig(name) {
  const configName = name.replace(/^--/, "");
  const normalizedConfigName = configName.replaceAll("-", "_");

  return (
    process.env[`npm_config_${configName}`] ??
    process.env[`npm_config_${normalizedConfigName}`] ??
    null
  );
}

function readNpmConfigPositional(name) {
  const positionals = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

  if (name === "--version" && readNpmConfig("--dist-tag") === "true") {
    return positionals[0] ?? null;
  }

  if (name === "--dist-tag" && readNpmConfig("--version") === "true") {
    return positionals[1] ?? null;
  }

  return positionals[0] ?? null;
}

function run(command, commandArgs, options = {}) {
  const label = [command, ...commandArgs].join(" ");
  const result = spawnSync(command, commandArgs, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "pipe"
  });

  if (result.status !== 0 && !options.allowFailure) {
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

function readGitHubRelease(expectedTag) {
  const output = run(
    "gh",
    [
      "release",
      "view",
      expectedTag,
      "--repo",
      repoName,
      "--json",
      "tagName,isDraft,isPrerelease"
    ],
    { allowFailure: true }
  );

  return output ? JSON.parse(output) : null;
}

async function main() {
  const version = parseVersionArg() ?? getPackageVersion();
  const npmDistTag = parseStringArg("--dist-tag", "latest");
  const expectPrerelease = hasFlag("--prerelease");

  if (!version) {
    throw new Error("Missing version. Pass --version <semver> or set package.json version.");
  }

  run("npm", ["run", "build"]);
  const {
    evaluateReleaseSync,
    renderReleaseSyncReport
  } = await import("../dist/release/release-sync.js");

  const expectedTag = `v${version}`;
  const report = evaluateReleaseSync({
    version,
    npmVersion: run("npm", ["view", "codex-plugin-doctor", `dist-tags.${npmDistTag}`]),
    npmDistTag,
    remoteTagOutput: run("git", ["ls-remote", "--tags", "origin", `refs/tags/${expectedTag}`]),
    githubRelease: readGitHubRelease(expectedTag),
    expectPrerelease,
    requireLatestRelease: !expectPrerelease,
    latestReleaseTag: run("gh", ["api", `repos/${repoName}/releases/latest`, "--jq", ".tag_name"], {
      allowFailure: true
    })
  });

  console.log(renderReleaseSyncReport(report));

  if (report.status === "fail") {
    process.exitCode = 1;
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`verify-release-sync failed: ${message}`);
  process.exitCode = 1;
}
