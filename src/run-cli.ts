import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  discoverInstalledPlugins,
  filterInstalledPlugins,
  type InstalledPlugin
} from "./core/discover-installed-plugins.js";
import {
  appendValidationHistoryEntry,
  readValidationHistory,
  summarizeValidationHistory
} from "./core/validation-history.js";
import {
  buildCompatibilityMatrix,
  type CompatibilityMatrix,
  matrixExitCode
} from "./compatibility/compatibility-matrix.js";
import {
  applyInstallPreview,
  renderApplyInstallResult
} from "./compatibility/apply-install-preview.js";
import {
  buildClaudeDesktopInstallPreview,
  renderClaudeDesktopInstallPreview
} from "./compatibility/claude-desktop-install-preview.js";
import {
  buildCursorInstallPreview,
  renderCursorInstallPreview
} from "./compatibility/cursor-install-preview.js";
import {
  buildClineInstallPreview,
  renderClineInstallPreview
} from "./compatibility/cline-install-preview.js";
import {
  buildWindsurfInstallPreview,
  renderWindsurfInstallPreview
} from "./compatibility/windsurf-install-preview.js";
import {
  applyDoctorConfig,
  loadDoctorConfig,
  type DoctorConfig
} from "./core/doctor-config.js";
import {
  applyFixPlan,
  buildFixPlan,
  renderApplyFixResult,
  renderFixPlanJsonReport,
  renderFixPlan
} from "./core/fix-plan.js";
import {
  renderEnvironmentDoctor,
  renderEnvironmentDoctorJson
} from "./core/environment-doctor.js";
import { initCiWorkflow } from "./core/init-ci.js";
import { initPluginPackage } from "./core/init-plugin.js";
import { runCheck } from "./index.js";
import { renderInstalledSummary } from "./reporting/render-installed-summary.js";
import { renderBadgeJson, renderBadgeMarkdown } from "./reporting/render-badge-report.js";
import { renderCompatibilityScorecard } from "./reporting/render-compatibility-scorecard.js";
import { renderCompatibilityReport } from "./reporting/render-compatibility-report.js";
import { renderHistorySummary } from "./reporting/render-history-summary.js";
import { renderJsonReport } from "./reporting/render-json-report.js";
import { buildMarkdownReport } from "./reporting/render-markdown-report.js";
import { renderRuleExplanation } from "./reporting/render-rule-explanation.js";
import { renderSarifReport } from "./reporting/render-sarif-report.js";
import { renderTextReport } from "./reporting/render-text-report.js";
import { findRuleDefinition } from "./rules/rule-catalog.js";
import { createLiveStatusRenderer } from "./terminal/live-status-renderer.js";
import { determineOutputPolicy } from "./terminal/output-policy.js";
import { getSpinner } from "./terminal/spinner-registry.js";
import { packageVersion } from "./version.js";

export interface CliIo {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
}

export interface CliTerminalContext {
  stdoutIsTTY: boolean;
  stderrIsTTY: boolean;
  env: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
}

export interface RunCliOptions {
  terminalContext?: CliTerminalContext;
  runCheckImpl?: typeof runCheck;
}

const defaultIo: CliIo = {
  writeStdout(message: string) {
    process.stdout.write(`${message}\n`);
  },
  writeStderr(message: string) {
    process.stderr.write(`${message}\n`);
  }
};

function printUsage(io: CliIo): void {
  io.writeStderr(
    "Usage: codex-plugin-doctor check <path|--installed> [filter] [--json|--markdown|--badge-json|--badge-markdown] [--output <path>] [--history <path>] [--runtime] [--verbose-runtime] [--no-animations] [--ascii]\n       codex-plugin-doctor compat <path> [--all|--client <client>] [--json] [--scorecard] [--output <path>] [--install-preview|--apply --backup]\n       codex-plugin-doctor fix <path> (--dry-run|--apply --backup)\n       codex-plugin-doctor history <history.jsonl> [--json] [--fail-on-regression]\n       codex-plugin-doctor doctor\n       codex-plugin-doctor init-ci [path]\n       codex-plugin-doctor self-test\n       codex-plugin-doctor list --installed\n       codex-plugin-doctor explain <finding-id>\n       codex-plugin-doctor --version"
  );
}

function renderInstalledPlugins(plugins: InstalledPlugin[]): string {
  const lines = [
    "Installed Codex Plugins",
    "======================="
  ];

  if (plugins.length === 0) {
    lines.push("", "No installed Codex plugins found.");
    return lines.join("\n");
  }

  for (const plugin of plugins) {
    const version = plugin.version ? `@${plugin.version}` : "";

    lines.push("", `- ${plugin.name}${version}`);
    lines.push(`  Path: ${plugin.rootPath}`);
    lines.push(`  Cache: ${plugin.relativePath}`);
  }

  return lines.join("\n");
}

const compatibilityClientAliases: Record<string, string> = {
  codex: "Codex",
  "generic-mcp": "Generic MCP",
  generic: "Generic MCP",
  mcp: "Generic MCP",
  "claude-desktop": "Claude Desktop",
  claude: "Claude Desktop",
  cursor: "Cursor",
  cline: "Cline",
  windsurf: "Windsurf"
};

const checkProfiles = ["ci", "strict", "publish"] as const;
type CheckProfile = (typeof checkProfiles)[number];

function parseCheckProfile(value: string | null): CheckProfile | null {
  if (!value) {
    return null;
  }

  return checkProfiles.includes(value as CheckProfile)
    ? value as CheckProfile
    : null;
}

function applyCheckProfile(config: DoctorConfig, profile: CheckProfile | null): DoctorConfig {
  if (profile === "strict" || profile === "publish") {
    return {
      ...config,
      failOnWarnings: true
    };
  }

  return config;
}

function filterCompatibilityMatrix(
  matrix: CompatibilityMatrix,
  clientFilter: string
): CompatibilityMatrix | null {
  const client = compatibilityClientAliases[clientFilter.toLowerCase()];

  if (!client) {
    return null;
  }

  return {
    ...matrix,
    results: matrix.results.filter((result) => result.client === client)
  };
}

function resolveBundledSelfTestTarget(): string {
  return path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "examples",
    "codex-doctor-runtime"
  );
}

function renderSelfTestReport(
  targetPath: string,
  validationStatus: string,
  findingsCount: number,
  compatibilityMatrix: CompatibilityMatrix
): string {
  return [
    "Codex Plugin Doctor Self-Test",
    "=============================",
    `Version: ${packageVersion}`,
    `Sample: ${targetPath}`,
    `Validation: ${validationStatus.toUpperCase()}`,
    "Runtime probes: enabled",
    `Findings: ${findingsCount}`,
    "",
    renderCompatibilityScorecard(compatibilityMatrix)
  ].join("\n");
}

export async function runCli(
  args: string[],
  io: CliIo = defaultIo,
  options: RunCliOptions = {}
): Promise<number> {
  const [command, maybePath, ...remainingArgs] = args;

  if (command === "--version" || command === "-v" || command === "version") {
    io.writeStdout(packageVersion);
    return 0;
  }

  const terminalContext: CliTerminalContext = options.terminalContext ?? {
    stdoutIsTTY: Boolean(process.stdout.isTTY),
    stderrIsTTY: Boolean(process.stderr.isTTY),
    env: process.env,
    platform: process.platform
  };

  if (command === "list" && maybePath === "--installed") {
    const installedPlugins = await discoverInstalledPlugins({
      env: terminalContext.env
    });

    io.writeStdout(renderInstalledPlugins(installedPlugins));
    return 0;
  }

  if (command === "doctor") {
    io.writeStdout(
      maybePath === "--json"
        ? await renderEnvironmentDoctorJson(terminalContext)
        : await renderEnvironmentDoctor(terminalContext)
    );
    return 0;
  }

  if (command === "explain") {
    if (!maybePath || maybePath.startsWith("--")) {
      io.writeStderr("Missing finding id. Usage: codex-plugin-doctor explain <finding-id>");
      return 2;
    }

    const rule = findRuleDefinition(maybePath);

    if (!rule) {
      io.writeStderr(`Unknown finding id: ${maybePath}`);
      return 1;
    }

    io.writeStdout(renderRuleExplanation(rule));
    return 0;
  }

  if (command === "history") {
    if (!maybePath || maybePath.startsWith("--")) {
      io.writeStderr(
        "Missing history path. Usage: codex-plugin-doctor history <history.jsonl> [--json] [--fail-on-regression]"
      );
      return 2;
    }

    try {
      const entries = await readValidationHistory(maybePath);
      const summary = summarizeValidationHistory(entries);
      const jsonOutput = remainingArgs.includes("--json");
      const failOnRegression = remainingArgs.includes("--fail-on-regression");

      io.writeStdout(
        jsonOutput
          ? JSON.stringify(summary, null, 2)
          : renderHistorySummary(entries)
      );

      if (failOnRegression && summary.regression) {
        io.writeStderr("Validation history regression detected.");
        return 1;
      }

      return 0;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to read validation history.";
      io.writeStderr(message);
      return 1;
    }
  }

  if (command === "self-test" || command === "demo") {
    const targetPath = resolveBundledSelfTestTarget();
    const runCheckImpl = options.runCheckImpl ?? runCheck;
    const result = applyDoctorConfig(
      await runCheckImpl(targetPath, { runtime: true }),
      await loadDoctorConfig(targetPath)
    );
    const compatibilityMatrix = await buildCompatibilityMatrix(targetPath, {
      env: terminalContext.env,
      platform: terminalContext.platform
    });

    io.writeStdout(
      renderSelfTestReport(
        targetPath,
        result.status,
        result.findings.length,
        compatibilityMatrix
      )
    );

    return result.exitCode === 1 || matrixExitCode(compatibilityMatrix) === 1 ? 1 : 0;
  }

  if (command === "init") {
    const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
    const result = await initPluginPackage(targetPath);

    io.writeStdout(
      [
        "Initialized Codex plugin package",
        `Root: ${result.rootPath}`,
        `Manifest: ${result.manifestPath}`,
        `Skill: ${result.skillPath}`,
        "",
        `Next: codex-plugin-doctor check ${result.rootPath}`
      ].join("\n")
    );
    return 0;
  }

  if (command === "init-ci") {
    const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
    const result = await initCiWorkflow(targetPath);

    io.writeStdout(
      [
        "Initialized Codex Plugin Doctor workflow",
        `Root: ${result.rootPath}`,
        `Workflow: ${result.workflowPath}`
      ].join("\n")
    );
    return 0;
  }

  if (command === "fix") {
    if (!maybePath || maybePath.startsWith("--")) {
      io.writeStderr(
        "Missing target path. Usage: codex-plugin-doctor fix <path> (--dry-run|--apply --backup)"
      );
      return 2;
    }

    const dryRun = remainingArgs.includes("--dry-run");
    const apply = remainingArgs.includes("--apply");
    const backup = remainingArgs.includes("--backup");
    const jsonOutput = remainingArgs.includes("--json");

    if (apply && !backup) {
      io.writeStderr("Fix apply requires --backup.");
      return 2;
    }

    if (dryRun === apply) {
      io.writeStderr("Choose exactly one fix mode: --dry-run or --apply --backup.");
      return 2;
    }

    if (dryRun) {
      const plan = await buildFixPlan(maybePath);
      io.writeStdout(
        jsonOutput
          ? renderFixPlanJsonReport(plan, { mode: "dry-run" })
          : renderFixPlan(plan, "dry-run")
      );
      return 0;
    }

    const result = await applyFixPlan(maybePath);
    io.writeStdout(
      jsonOutput
        ? renderFixPlanJsonReport(result.plan, {
            mode: "apply",
            filesChanged: result.filesChanged,
            backupDirectory: result.backupDirectory
          })
        : renderApplyFixResult(result)
    );
    return 0;
  }

  if (command === "compat") {
    const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
    const compatFlags = maybePath && maybePath.startsWith("--")
      ? [maybePath, ...remainingArgs]
      : remainingArgs;
    const jsonOutput = compatFlags.includes("--json");
    const scorecardOutput = compatFlags.includes("--scorecard");
    const installPreview = compatFlags.includes("--install-preview");
    const applyInstall = compatFlags.includes("--apply");
    const backupInstall = compatFlags.includes("--backup");
    const allClients = compatFlags.includes("--all");
    const clientIndex = compatFlags.indexOf("--client");
    const clientFilter = clientIndex === -1 ? null : compatFlags[clientIndex + 1];
    const outputIndex = compatFlags.indexOf("--output");
    const outputPath = outputIndex === -1 ? null : compatFlags[outputIndex + 1];

    if (clientIndex !== -1 && (!clientFilter || clientFilter.startsWith("--"))) {
      io.writeStderr("Missing client after --client.");
      return 2;
    }

    if (allClients && clientFilter) {
      io.writeStderr("Use either --all or --client, not both.");
      return 2;
    }

    if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
      io.writeStderr("Missing path after --output.");
      return 2;
    }

    if (
      (installPreview || applyInstall) &&
      clientFilter?.toLowerCase() !== "claude-desktop" &&
      clientFilter?.toLowerCase() !== "cursor" &&
      clientFilter?.toLowerCase() !== "cline" &&
      clientFilter?.toLowerCase() !== "windsurf"
    ) {
      io.writeStderr("--install-preview and --apply require --client claude-desktop, cursor, cline, or windsurf.");
      return 2;
    }

    if (installPreview && applyInstall) {
      io.writeStderr("Use either --install-preview or --apply, not both.");
      return 2;
    }

    if (applyInstall && !backupInstall) {
      io.writeStderr("--apply requires --backup.");
      return 2;
    }

    if (installPreview || applyInstall) {
      try {
        const normalizedClient = clientFilter?.toLowerCase();
        const preview = normalizedClient === "cursor"
          ? await buildCursorInstallPreview(targetPath, {
              env: terminalContext.env,
              platform: terminalContext.platform
            })
          : normalizedClient === "cline"
            ? await buildClineInstallPreview(targetPath, {
                env: terminalContext.env,
                platform: terminalContext.platform
              })
            : normalizedClient === "windsurf"
              ? await buildWindsurfInstallPreview(targetPath, {
                  env: terminalContext.env,
                  platform: terminalContext.platform
                })
            : await buildClaudeDesktopInstallPreview(targetPath, {
                env: terminalContext.env,
                platform: terminalContext.platform
              });
        const report = applyInstall
          ? renderApplyInstallResult(
              await applyInstallPreview(
                normalizedClient === "cursor"
                  ? "Cursor"
                  : normalizedClient === "cline"
                    ? "Cline"
                    : normalizedClient === "windsurf"
                      ? "Windsurf"
                    : "Claude Desktop",
                preview
              )
            )
          : normalizedClient === "cursor"
            ? renderCursorInstallPreview(preview)
            : normalizedClient === "cline"
              ? renderClineInstallPreview(preview)
              : normalizedClient === "windsurf"
                ? renderWindsurfInstallPreview(preview)
              : renderClaudeDesktopInstallPreview(preview);

        if (outputPath) {
          await writeFile(outputPath, report, "utf8");
        }

        io.writeStdout(report);
        return 0;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown install preview error.";
        io.writeStderr(message);
        return 1;
      }
    }

    let matrix = await buildCompatibilityMatrix(targetPath, {
      env: terminalContext.env,
      platform: terminalContext.platform
    });

    if (clientFilter) {
      const filteredMatrix = filterCompatibilityMatrix(matrix, clientFilter);

      if (!filteredMatrix) {
        io.writeStderr(`Unknown compatibility client: ${clientFilter}`);
        return 2;
      }

      matrix = filteredMatrix;
    }

    const report = jsonOutput
      ? JSON.stringify({ schemaVersion: "1.0.0", ...matrix }, null, 2)
      : scorecardOutput
        ? renderCompatibilityScorecard(matrix)
      : renderCompatibilityReport(matrix);

    if (outputPath) {
      await writeFile(outputPath, report, "utf8");
    }

    io.writeStdout(report);
    return matrixExitCode(matrix);
  }

  if (command !== "check") {
    printUsage(io);
    return 2;
  }

  const checkInstalled = maybePath === "--installed";
  const installedFilter =
    checkInstalled && remainingArgs[0] && !remainingArgs[0].startsWith("--")
      ? remainingArgs[0]
      : null;
  const flagsAfterInstalledFilter =
    checkInstalled && installedFilter
      ? remainingArgs.slice(1)
      : remainingArgs;
  const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
  const normalizedFlags =
    checkInstalled
      ? [maybePath, ...flagsAfterInstalledFilter]
      : maybePath && maybePath.startsWith("--")
        ? [maybePath, ...remainingArgs]
      : remainingArgs;

  const jsonOutput = normalizedFlags.includes("--json");
  const markdownOutput = normalizedFlags.includes("--markdown");
  const badgeJsonOutput = normalizedFlags.includes("--badge-json");
  const badgeMarkdownOutput = normalizedFlags.includes("--badge-markdown");
  const sarifOutput = normalizedFlags.includes("--sarif");
  const runtimeProbeEnabled = normalizedFlags.includes("--runtime");
  const verboseRuntime = normalizedFlags.includes("--verbose-runtime");
  const noAnimations = normalizedFlags.includes("--no-animations");
  const asciiMode = normalizedFlags.includes("--ascii");
  const installedSummary = normalizedFlags.includes("--all-summary");
  const outputIndex = normalizedFlags.indexOf("--output");
  const outputPath = outputIndex === -1 ? null : normalizedFlags[outputIndex + 1];
  const configIndex = normalizedFlags.indexOf("--config");
  const configPath = configIndex === -1 ? null : normalizedFlags[configIndex + 1];
  const profileIndex = normalizedFlags.indexOf("--profile");
  const profileName = profileIndex === -1 ? null : normalizedFlags[profileIndex + 1];
  const checkProfile = parseCheckProfile(profileName);
  const historyIndex = normalizedFlags.indexOf("--history");
  const historyPath = historyIndex === -1 ? null : normalizedFlags[historyIndex + 1];

  if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
    io.writeStderr("Missing path after --output.");
    return 2;
  }

  if (configIndex !== -1 && (!configPath || configPath.startsWith("--"))) {
    io.writeStderr("Missing path after --config.");
    return 2;
  }

  if (profileIndex !== -1 && (!profileName || profileName.startsWith("--"))) {
    io.writeStderr("Missing profile after --profile.");
    return 2;
  }

  if (profileIndex !== -1 && !checkProfile) {
    io.writeStderr("Unknown profile. Supported profiles: ci, strict, publish.");
    return 2;
  }

  if (historyIndex !== -1 && (!historyPath || historyPath.startsWith("--"))) {
    io.writeStderr("Missing path after --history.");
    return 2;
  }

  if (checkInstalled && (badgeJsonOutput || badgeMarkdownOutput)) {
    io.writeStderr("Badge output requires a single package target.");
    return 2;
  }

  if (checkInstalled && historyPath) {
    io.writeStderr("History output requires a single package target.");
    return 2;
  }

  const effectiveRuntimeProbeEnabled = runtimeProbeEnabled || checkProfile === "publish";

  const outputPolicy = determineOutputPolicy({
    jsonOutput: jsonOutput || badgeJsonOutput,
    markdownOutput: markdownOutput || badgeMarkdownOutput,
    outputPath,
    noAnimations,
    asciiMode,
    stdoutIsTTY: terminalContext.stdoutIsTTY,
    stderrIsTTY: terminalContext.stderrIsTTY,
    env: terminalContext.env
  });

  const runCheckImpl = options.runCheckImpl ?? runCheck;

  if (checkInstalled) {
    const installedPlugins = filterInstalledPlugins(
      await discoverInstalledPlugins({ env: terminalContext.env }),
      installedFilter
    );

    if (installedPlugins.length === 0) {
      io.writeStderr(
        installedFilter
          ? `No installed Codex plugins matched '${installedFilter}'.`
          : "No installed Codex plugins found."
      );
      return 1;
    }

    const checkedPlugins = [];

    for (const plugin of installedPlugins) {
      const config = await loadDoctorConfig(plugin.rootPath, configPath);
      checkedPlugins.push({
        plugin,
        result: applyDoctorConfig(
          await runCheckImpl(plugin.rootPath, {
            runtime: effectiveRuntimeProbeEnabled,
            runtimeTranscript:
              effectiveRuntimeProbeEnabled && verboseRuntime
                ? (line) => io.writeStderr(line)
                : undefined
          }),
          applyCheckProfile(config, checkProfile)
        )
      });
    }

    const report = installedSummary
      ? renderInstalledSummary(checkedPlugins)
      : checkedPlugins
        .map((item) =>
          sarifOutput
            ? renderSarifReport(item.result)
            : markdownOutput
            ? buildMarkdownReport(item.result, { runtimeProbeEnabled: effectiveRuntimeProbeEnabled })
            : jsonOutput
              ? renderJsonReport(item.result, { runtimeProbeEnabled: effectiveRuntimeProbeEnabled })
              : renderTextReport(item.result, { ascii: outputPolicy.style === "ascii" })
        )
        .join("\n\n");

    if (outputPath) {
      await writeFile(outputPath, report, "utf8");
    }

    io.writeStdout(report);

    return checkedPlugins.some((item) => item.result.exitCode === 1) ? 1 : 0;
  }

  const renderer = outputPolicy.interactive
    && !verboseRuntime
    ? createLiveStatusRenderer(
        io,
        getSpinner(outputPolicy.style === "ascii" ? "ascii" : "doctor")
      )
    : null;

  renderer?.start("Validating package");
  const result = applyDoctorConfig(
    await runCheckImpl(targetPath, {
      runtime: effectiveRuntimeProbeEnabled,
      runtimeTranscript:
        effectiveRuntimeProbeEnabled && verboseRuntime
          ? (line) => io.writeStderr(line)
          : undefined
    }),
    applyCheckProfile(await loadDoctorConfig(targetPath, configPath), checkProfile)
  );
  if (renderer) {
    if (result.status === "fail") {
      renderer.stopFailure("Validation failed");
    } else {
      renderer.stopSuccess("Validation complete");
    }
  }

  const report = markdownOutput
    ? buildMarkdownReport(result, { runtimeProbeEnabled: effectiveRuntimeProbeEnabled })
    : sarifOutput
      ? renderSarifReport(result)
    : jsonOutput
      ? renderJsonReport(result, { runtimeProbeEnabled: effectiveRuntimeProbeEnabled })
    : badgeJsonOutput
      ? renderBadgeJson(result)
    : badgeMarkdownOutput
      ? renderBadgeMarkdown(result)
      : renderTextReport(result, { ascii: outputPolicy.style === "ascii" });

  if (outputPath) {
    await writeFile(outputPath, report, "utf8");
  }

  if (historyPath) {
    await appendValidationHistoryEntry(historyPath, result, {
      runtimeProbeEnabled: effectiveRuntimeProbeEnabled
    });
  }

  io.writeStdout(report);

  return result.exitCode;
}
