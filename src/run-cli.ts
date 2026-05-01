import { writeFile } from "node:fs/promises";

import {
  discoverInstalledPlugins,
  filterInstalledPlugins,
  type InstalledPlugin
} from "./core/discover-installed-plugins.js";
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
import { applyDoctorConfig, loadDoctorConfig } from "./core/doctor-config.js";
import { initPluginPackage } from "./core/init-plugin.js";
import { runCheck } from "./index.js";
import { renderInstalledSummary } from "./reporting/render-installed-summary.js";
import { renderCompatibilityScorecard } from "./reporting/render-compatibility-scorecard.js";
import { renderCompatibilityReport } from "./reporting/render-compatibility-report.js";
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
    "Usage: codex-plugin-doctor check <path|--installed> [filter] [--json|--markdown] [--output <path>] [--runtime] [--verbose-runtime] [--no-animations] [--ascii]\n       codex-plugin-doctor compat <path> [--client <client>] [--json] [--scorecard] [--output <path>] [--install-preview|--apply --backup]\n       codex-plugin-doctor list --installed\n       codex-plugin-doctor explain <finding-id>\n       codex-plugin-doctor --version"
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
  cursor: "Cursor"
};

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
    env: process.env
  };

  if (command === "list" && maybePath === "--installed") {
    const installedPlugins = await discoverInstalledPlugins({
      env: terminalContext.env
    });

    io.writeStdout(renderInstalledPlugins(installedPlugins));
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
    const clientIndex = compatFlags.indexOf("--client");
    const clientFilter = clientIndex === -1 ? null : compatFlags[clientIndex + 1];
    const outputIndex = compatFlags.indexOf("--output");
    const outputPath = outputIndex === -1 ? null : compatFlags[outputIndex + 1];

    if (clientIndex !== -1 && (!clientFilter || clientFilter.startsWith("--"))) {
      io.writeStderr("Missing client after --client.");
      return 2;
    }

    if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
      io.writeStderr("Missing path after --output.");
      return 2;
    }

    if (
      (installPreview || applyInstall) &&
      clientFilter?.toLowerCase() !== "claude-desktop" &&
      clientFilter?.toLowerCase() !== "cursor"
    ) {
      io.writeStderr("--install-preview and --apply require --client claude-desktop or --client cursor.");
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
        const preview = clientFilter?.toLowerCase() === "cursor"
          ? await buildCursorInstallPreview(targetPath, {
              env: terminalContext.env
            })
          : await buildClaudeDesktopInstallPreview(targetPath, {
              env: terminalContext.env
            });
        const report = applyInstall
          ? renderApplyInstallResult(
              await applyInstallPreview(
                clientFilter?.toLowerCase() === "cursor" ? "Cursor" : "Claude Desktop",
                preview
              )
            )
          : clientFilter?.toLowerCase() === "cursor"
            ? renderCursorInstallPreview(preview)
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
      env: terminalContext.env
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

  if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
    io.writeStderr("Missing path after --output.");
    return 2;
  }

  if (configIndex !== -1 && (!configPath || configPath.startsWith("--"))) {
    io.writeStderr("Missing path after --config.");
    return 2;
  }

  const outputPolicy = determineOutputPolicy({
    jsonOutput,
    markdownOutput,
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
            runtime: runtimeProbeEnabled,
            runtimeTranscript:
              runtimeProbeEnabled && verboseRuntime
                ? (line) => io.writeStderr(line)
                : undefined
          }),
          config
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
            ? buildMarkdownReport(item.result, { runtimeProbeEnabled })
            : jsonOutput
              ? renderJsonReport(item.result, { runtimeProbeEnabled })
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
      runtime: runtimeProbeEnabled,
      runtimeTranscript:
        runtimeProbeEnabled && verboseRuntime
          ? (line) => io.writeStderr(line)
          : undefined
    }),
    await loadDoctorConfig(targetPath, configPath)
  );
  if (renderer) {
    if (result.status === "fail") {
      renderer.stopFailure("Validation failed");
    } else {
      renderer.stopSuccess("Validation complete");
    }
  }

  const report = markdownOutput
    ? buildMarkdownReport(result, { runtimeProbeEnabled })
    : sarifOutput
      ? renderSarifReport(result)
    : jsonOutput
      ? renderJsonReport(result, { runtimeProbeEnabled })
      : renderTextReport(result, { ascii: outputPolicy.style === "ascii" });

  if (outputPath) {
    await writeFile(outputPath, report, "utf8");
  }

  io.writeStdout(report);

  return result.exitCode;
}
