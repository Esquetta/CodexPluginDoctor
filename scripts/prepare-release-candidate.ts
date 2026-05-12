import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  buildReleaseCandidateNotes,
  extractReleaseSection
} from "../src/release/release-notes.js";

function parseArgs(argv: string[]) {
  const args = [...argv];
  let target = "examples/codex-doctor-runtime";
  let runtimeTarget = target;
  let outDir = "";
  const positionalArgs: string[] = [];

  while (args.length > 0) {
    const arg = args.shift();

    if (arg === "--target") {
      target = args.shift() ?? target;
      continue;
    }

    if (arg === "--runtime-target") {
      runtimeTarget = args.shift() ?? runtimeTarget;
      continue;
    }

    if (arg === "--out-dir") {
      outDir = args.shift() ?? outDir;
      continue;
    }

    if (arg) {
      positionalArgs.push(arg);
    }
  }

  target = readNpmConfig("target") ?? positionalArgs[0] ?? target;
  runtimeTarget = readNpmConfig("runtime-target") ?? positionalArgs[1] ?? runtimeTarget;
  outDir = readNpmConfig("out-dir") ?? positionalArgs[2] ?? outDir;

  return { target, runtimeTarget, outDir };
}

function readNpmConfig(name: string): string | null {
  const normalizedName = name.replaceAll("-", "_");
  const value =
    process.env[`npm_config_${name}`] ??
    process.env[`npm_config_${normalizedName}`] ??
    null;

  return value && value !== "true" ? value : null;
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(" ")} failed with exit code ${code}`));
    });
  });
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "..");
  const { target, runtimeTarget, outDir } = parseArgs(process.argv.slice(2));

  const packageJson = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8")
  ) as { version: string; name: string };
  const version = packageJson.version;
  const releaseDir = outDir
    ? path.resolve(repoRoot, outDir)
    : path.join(repoRoot, "release-candidate", version);

  await rm(releaseDir, { recursive: true, force: true });
  await mkdir(releaseDir, { recursive: true });

  await runCommand("npm", ["run", "prepare-release"], repoRoot);
  await runCommand(
    "node",
    [
      "scripts/generate-validation-artifacts.mjs",
      "--target",
      target,
      "--runtime-target",
      runtimeTarget,
      "--out-dir",
      path.relative(repoRoot, releaseDir)
    ],
    repoRoot
  );
  await runCommand(
    "npm",
    ["pack", "--pack-destination", path.relative(repoRoot, releaseDir)],
    repoRoot
  );

  const changelog = await readFile(path.join(repoRoot, "CHANGELOG.md"), "utf8");
  const changelogSection = extractReleaseSection(changelog, version);
  const generatedAt = new Date().toISOString();
  const tarballName = `${packageJson.name}-${version}.tgz`;

  const releaseNotes = buildReleaseCandidateNotes({
    version,
    generatedAt,
    validationTarget: target,
    runtimeTarget,
    packageFilename: tarballName,
    changelogSection
  });

  await writeFile(path.join(releaseDir, "RELEASE-NOTES.md"), releaseNotes, "utf8");
  await writeFile(
    path.join(releaseDir, "MANIFEST.json"),
    JSON.stringify(
      {
        version,
        generatedAt,
        validationTarget: target,
        runtimeTarget,
        tarballName
      },
      null,
      2
    ),
    "utf8"
  );
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`prepare-release-candidate failed: ${message}`);
  process.exitCode = 1;
});
