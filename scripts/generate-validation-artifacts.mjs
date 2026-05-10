import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = [...argv];
  let target = "examples/codex-doctor-runtime";
  let runtimeTarget = target;
  let outDir = ".";
  const positional = [];

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

    positional.push(arg);
  }

  if (positional.length > 0) {
    target = positional[0];
  }

  if (positional.length > 1) {
    runtimeTarget = positional[1];
  }

  if (positional.length > 2) {
    outDir = positional[2];
  }

  return { target, runtimeTarget, outDir };
}

async function runCommand(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: "inherit",
      shell: false
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      resolve(code ?? 1);
    });
  });
}

async function main() {
  const scriptPath = fileURLToPath(import.meta.url);
  const repoRoot = path.resolve(path.dirname(scriptPath), "..");
  const { target, runtimeTarget, outDir } = parseArgs(process.argv.slice(2));
  const resolvedOutDir = path.isAbsolute(outDir)
    ? outDir
    : path.resolve(repoRoot, outDir);

  await mkdir(resolvedOutDir, { recursive: true });

  const summaryPath = path.join(resolvedOutDir, "codex-plugin-doctor-summary.md");
  const jsonPath = path.join(resolvedOutDir, "codex-plugin-doctor-report.json");
  const runtimeJsonPath = path.join(
    resolvedOutDir,
    "codex-plugin-doctor-runtime-report.json"
  );
  const sarifPath = path.join(resolvedOutDir, "codex-plugin-doctor.sarif");
  let exitCode = 0;

  async function collectReport(args) {
    const code = await runCommand(process.execPath, args, repoRoot);

    if (code !== 0 && exitCode === 0) {
      exitCode = code;
    }
  }

  await collectReport(["dist/cli.js", "check", target, "--markdown", "--output", summaryPath]);
  await collectReport(["dist/cli.js", "check", target, "--json", "--output", jsonPath]);
  await collectReport([
    "dist/cli.js",
    "check",
    runtimeTarget,
    "--json",
    "--runtime",
    "--output",
    runtimeJsonPath
  ]);
  await collectReport(["dist/cli.js", "check", target, "--sarif", "--output", sarifPath]);

  process.exitCode = exitCode;
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`generate-validation-artifacts failed: ${message}`);
  process.exitCode = 1;
});
