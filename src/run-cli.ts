import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import {
  discoverInstalledPlugins,
  filterInstalledPlugins,
  type InstalledPlugin
} from "./core/discover-installed-plugins.js";
import {
  buildEcosystemAudit,
  renderEcosystemAudit,
  renderEcosystemAuditJson
} from "./audit/ecosystem-audit.js";
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
  buildDoctorSnapshot,
  renderDoctorSnapshot,
  renderDoctorSnapshotJson
} from "./core/doctor-snapshot.js";
import {
  buildDoctorRecommendations,
  renderDoctorRecommendations,
  renderDoctorRecommendationsJson
} from "./core/doctor-recommendations.js";
import {
  buildDoctorExportBundle,
  renderDoctorExportBundle,
  renderDoctorExportBundleJson
} from "./core/doctor-export-bundle.js";
import {
  buildDoctorAttestation,
  renderDoctorAttestation,
  renderDoctorAttestationJson,
  renderDoctorAttestationVerification,
  renderDoctorAttestationVerificationJson,
  verifyDoctorAttestation
} from "./core/attestation.js";
import {
  buildDoctorOutputContract,
  renderDoctorOutputContract,
  renderDoctorOutputContractJson
} from "./core/output-contract.js";
import {
  buildDoctorValidationCorpusReport,
  renderDoctorValidationCorpusJson,
  renderDoctorValidationCorpusReport
} from "./core/validation-corpus.js";
import {
  buildDoctorPerformanceReport,
  renderDoctorPerformanceReport,
  renderDoctorPerformanceReportJson,
  type DoctorPerformanceStageName,
  type DoctorPerformanceThresholdOptions
} from "./core/performance-report.js";
import {
  buildDoctorRuntimePlan,
  evaluateRuntimeApproval,
  renderDoctorRuntimePlan,
  renderDoctorRuntimePlanMarkdown,
  renderDoctorRuntimePlanJson,
  runtimeApprovalPassed
} from "./core/runtime-plan.js";
import {
  buildDoctorRuntimePolicyReport,
  renderDoctorRuntimePolicy,
  renderDoctorRuntimePolicyJson
} from "./core/runtime-policy.js";
import {
  buildDoctorReviewBundle,
  diffDoctorReviewBundles,
  renderDoctorReviewBundle,
  renderDoctorReviewBundleDiff,
  renderDoctorReviewBundleDiffJson,
  renderDoctorReviewBundleJson,
  renderDoctorReviewBundleVerification,
  renderDoctorReviewBundleVerificationJson,
  verifyDoctorReviewBundle
} from "./core/review-bundle.js";
import {
  buildDoctorReleaseEvidenceAssetReport,
  buildDoctorReleaseEvidenceReport,
  renderDoctorReleaseEvidenceAsset,
  renderDoctorReleaseEvidenceAssetJson,
  renderDoctorReleaseEvidence,
  renderDoctorReleaseEvidenceJson,
  renderDoctorReleaseEvidenceVerification,
  renderDoctorReleaseEvidenceVerificationJson,
  verifyDoctorReleaseEvidence
} from "./core/release-evidence.js";
import {
  buildDoctorNpmPackageReport,
  renderDoctorNpmPackageReport,
  renderDoctorNpmPackageReportJson
} from "./core/npm-package-doctor.js";
import {
  buildDoctorRiskDiffReport,
  renderDoctorRiskDiffReport,
  renderDoctorRiskDiffReportJson
} from "./core/risk-diff.js";
import {
  buildDoctorInspectorReport,
  renderDoctorInspectorReport,
  renderDoctorInspectorReportJson
} from "./core/inspector-bridge.js";
import {
  applyFixPlan,
  buildFixPlan,
  renderApplyFixResult,
  renderFixPlanJsonReport,
  renderFixPlan
} from "./core/fix-plan.js";
import {
  renderClientDoctor,
  renderEnvironmentDoctor,
  renderEnvironmentDoctorJson
} from "./core/environment-doctor.js";
import { initCiWorkflow } from "./core/init-ci.js";
import {
  initPluginPackage,
  initPluginTemplates,
  isInitPluginTemplate
} from "./core/init-plugin.js";
import { runCheck } from "./index.js";
import {
  buildGenericMcpDoctor,
  renderGenericMcpDoctor,
  renderGenericMcpDoctorJson
} from "./mcp/generic-mcp-doctor.js";
import { renderInstalledSummary } from "./reporting/render-installed-summary.js";
import {
  renderInstalledJsonReport,
  renderInstalledSarifReport
} from "./reporting/render-installed-machine-report.js";
import { renderBadgeJson, renderBadgeMarkdown } from "./reporting/render-badge-report.js";
import { renderCompatibilityScorecard } from "./reporting/render-compatibility-scorecard.js";
import { renderCompatibilityReport } from "./reporting/render-compatibility-report.js";
import { renderHistorySummary } from "./reporting/render-history-summary.js";
import { renderJsonReport } from "./reporting/render-json-report.js";
import { buildMarkdownReport } from "./reporting/render-markdown-report.js";
import { renderRuleExplanation } from "./reporting/render-rule-explanation.js";
import { renderSarifReport } from "./reporting/render-sarif-report.js";
import { renderTextReport } from "./reporting/render-text-report.js";
import {
  applyPolicyToDoctorConfig,
  applyPolicyToSecurityAudit,
  parsePolicyPack,
  policyEnablesRuntime,
  policyFailsOnWarnings,
  policyPackNames
} from "./policy/policy-packs.js";
import { findRuleDefinition } from "./rules/rule-catalog.js";
import {
  buildSecurityAudit,
  renderSecurityAuditJson,
  renderSecurityScorecard
} from "./security/security-audit.js";
import {
  buildTrustScore,
  renderTrustScore,
  renderTrustScoreJson
} from "./security/trust-score.js";
import { createLiveStatusRenderer } from "./terminal/live-status-renderer.js";
import { determineOutputPolicy } from "./terminal/output-policy.js";
import { getSpinner } from "./terminal/spinner-registry.js";
import { packageVersion } from "./version.js";

export interface CliIo {
  writeStdout(message: string): void;
  writeStderr(message: string): void;
  readStdin?(prompt: string): Promise<string>;
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
  releaseAssetUploadImpl?: (args: string[]) => Promise<void>;
  resolveLatestVersion?: () => Promise<string>;
}

const defaultIo: CliIo = {
  writeStdout(message: string) {
    process.stdout.write(`${message}\n`);
  },
  writeStderr(message: string) {
    process.stderr.write(`${message}\n`);
  },
  async readStdin(prompt: string) {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    try {
      return await readline.question(prompt);
    } finally {
      readline.close();
    }
  }
};

function printUsage(io: CliIo): void {
  io.writeStderr(
    "Usage: codex-plugin-doctor check <path|--installed> [filter] [--policy codex-publish|mcp-strict|security] [--compat] [--json|--markdown|--badge-json|--badge-markdown] [--output <path>] [--history <path>] [--runtime] [--require-runtime-approval --runtime-approval-digest <digest>] [--verbose-runtime] [--explain] [--no-animations] [--ascii]\n       codex-plugin-doctor audit --installed [filter] [--policy codex-publish|mcp-strict|security] [--security] [--compat] [--json] [--output <path>] [--cache] [--changed]\n       codex-plugin-doctor mcp <path> [--json] [--output <path>]\n       codex-plugin-doctor security <path> [--policy security] [--json|--scorecard]\n       codex-plugin-doctor compat <path> [--all|--client <client>] [--json] [--scorecard] [--output <path>] [--install-preview|--apply --backup]\n       codex-plugin-doctor fix <path> (--dry-run|--interactive --backup|--apply --backup)\n       codex-plugin-doctor history <history.jsonl> [--json] [--fail-on-regression]\n       codex-plugin-doctor doctor [npm <package>|contract|corpus|runtime-plan <path> [--json|--markdown] [--output <path>]|runtime-policy <path> [--json] [--output <path>]|review-bundle <path> --output <dir> --sign-key-env NAME [--json] [--allow-dirty] [--allow-untagged]|review-bundle verify <bundle-dir> --target <path> --sign-key-env NAME [--json] [--output <path>]|review-bundle diff --before <dir> --after <dir> [--json]|attest <path> [--sign-key-env NAME]|attest verify <attestation.json> --target <path> --sign-key-env NAME|release-evidence <path> --sign-key-env NAME [--allow-dirty] [--allow-untagged] [--require-runtime-approval --runtime-approval-digest <digest>]|release-evidence verify <evidence.json> --target <path> --sign-key-env NAME|release-evidence asset <path> --tag <tag> --output <evidence.json> --sign-key-env NAME [--upload]|mcp <path>|inspector <path>|diff --before <path> --after <path>|recommend <path>|trust <path>|perf <path> [--max-total-ms <ms>] [--max-stage-ms stage=ms]|export --bundle <path>|snapshot|clients|--json|--update-check]\n       codex-plugin-doctor init [path] [--template skill-only|mcp-stdio|mcp-http|full-runtime]\n       codex-plugin-doctor init-ci [path]\n       codex-plugin-doctor self-test\n       codex-plugin-doctor list --installed\n       codex-plugin-doctor explain <finding-id>\n       codex-plugin-doctor --version\n\nFirst run:\n       codex-plugin-doctor doctor\n       codex-plugin-doctor self-test\n       codex-plugin-doctor init my-plugin\n       codex-plugin-doctor check . --runtime --explain"
  );
}

const performanceStageNames = new Set<DoctorPerformanceStageName>([
  "validation",
  "doctorConfig",
  "security",
  "compatibility",
  "trust",
  "recommendations",
  "total"
]);

function parseNonNegativeNumber(value: string | undefined): number | null {
  if (value === undefined || value.startsWith("--")) {
    return null;
  }

  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function buildGenericMcpDoctorCommandArgs(commandTarget: string, flags: string[]): {
  targetPath: string;
  jsonOutput: boolean;
  outputPath: string | null;
} | string {
  if (!commandTarget || commandTarget.startsWith("--")) {
    return "Missing target path. Usage: codex-plugin-doctor mcp <path> [--json] [--output <path>]";
  }

  const outputIndex = flags.indexOf("--output");
  const outputPath = outputIndex === -1 ? null : flags[outputIndex + 1];

  if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
    return "Missing path after --output.";
  }

  return {
    targetPath: commandTarget,
    jsonOutput: flags.includes("--json"),
    outputPath
  };
}

function parsePerformanceThresholds(flags: string[]): {
  thresholds: DoctorPerformanceThresholdOptions;
} | string {
  const thresholds: DoctorPerformanceThresholdOptions = {};
  const totalIndex = flags.indexOf("--max-total-ms");

  if (totalIndex !== -1) {
    const totalMs = parseNonNegativeNumber(flags[totalIndex + 1]);

    if (totalMs === null) {
      return "Missing or invalid number after --max-total-ms.";
    }

    thresholds.totalMs = totalMs;
  }

  for (let index = 0; index < flags.length; index += 1) {
    if (flags[index] !== "--max-stage-ms") {
      continue;
    }

    const value = flags[index + 1];

    if (!value || value.startsWith("--") || !value.includes("=")) {
      return "Missing or invalid stage threshold after --max-stage-ms. Use stage=milliseconds.";
    }

    const [stageName, rawLimit] = value.split("=", 2);

    if (!performanceStageNames.has(stageName as DoctorPerformanceStageName)) {
      return `Unknown performance stage: ${stageName}.`;
    }

    const limitMs = parseNonNegativeNumber(rawLimit);

    if (limitMs === null) {
      return "Missing or invalid number after --max-stage-ms.";
    }

    thresholds.stages = {
      ...thresholds.stages,
      [stageName]: limitMs
    };
  }

  return { thresholds };
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

async function resolveLatestNpmVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "npm",
      ["view", "codex-plugin-doctor", "version"],
      { shell: process.platform === "win32" },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve(stdout.trim());
      }
    );
  });
}

async function uploadGitHubReleaseAsset(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
      { shell: process.platform === "win32" },
      (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }

        resolve();
      }
    );
  });
}

function renderUpdateCheck(latestVersion: string): string {
  const updateAvailable = latestVersion !== packageVersion;

  return [
    "Codex Plugin Doctor Update Check",
    "================================",
    `Installed: ${packageVersion}`,
    `Latest: ${latestVersion}`,
    `Status: ${updateAvailable ? "UPDATE AVAILABLE" : "UP TO DATE"}`,
    "",
    updateAvailable
      ? "Next: npm install -g codex-plugin-doctor@latest"
      : "Next: no update needed"
  ].join("\n");
}

function parseSelectedFixActionIndexes(
  answer: string,
  actionCount: number
): number[] | null {
  if (!/^\d+(\s*,\s*\d+)*$/.test(answer)) {
    return null;
  }

  const actionIndexes = [...new Set(answer.split(",").map((item) => Number(item.trim())))];

  return actionIndexes.every((index) =>
    Number.isInteger(index) &&
    index >= 1 &&
    index <= actionCount
  )
    ? actionIndexes
    : null;
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
    const doctorFlags = maybePath?.startsWith("--")
      ? [maybePath, ...remainingArgs]
      : remainingArgs;

    if (maybePath === "recommend") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : ".";
      const recommendFlags = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs.slice(1)
        : remainingArgs;
      const jsonOutput = recommendFlags.includes("--json");
      const outputIndex = recommendFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : recommendFlags[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildDoctorRecommendations(targetPath, {
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        },
        runCheck: options.runCheckImpl
          ? (pathToCheck) => options.runCheckImpl!(pathToCheck)
          : undefined
      });
      const renderedReport = jsonOutput
        ? renderDoctorRecommendationsJson(report)
        : renderDoctorRecommendations(report);

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "contract") {
      const jsonOutput = remainingArgs.includes("--json");
      const outputIndex = remainingArgs.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : remainingArgs[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const contract = buildDoctorOutputContract();
      const contractJson = renderDoctorOutputContractJson(contract);

      if (outputPath) {
        await writeFile(outputPath, contractJson, "utf8");
      }

      io.writeStdout(
        jsonOutput
          ? contractJson
          : renderDoctorOutputContract(contract, { outputPath })
      );
      return 0;
    }

    if (maybePath === "mcp") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : "";
      const mcpFlags = targetPath ? remainingArgs.slice(1) : remainingArgs;
      const parsedMcpArgs = buildGenericMcpDoctorCommandArgs(targetPath, mcpFlags);

      if (typeof parsedMcpArgs === "string") {
        io.writeStderr(parsedMcpArgs);
        return 2;
      }

      const report = await buildGenericMcpDoctor(parsedMcpArgs.targetPath, {
        env: terminalContext.env,
        platform: terminalContext.platform
      });
      const renderedReport = parsedMcpArgs.jsonOutput
        ? renderGenericMcpDoctorJson(report)
        : renderGenericMcpDoctor(report);

      if (parsedMcpArgs.outputPath) {
        await writeFile(parsedMcpArgs.outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "runtime-plan") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : null;
      const runtimePlanFlags = targetPath ? remainingArgs.slice(1) : remainingArgs;
      const jsonOutput = runtimePlanFlags.includes("--json");
      const markdownOutput = runtimePlanFlags.includes("--markdown");
      const outputIndex = runtimePlanFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : runtimePlanFlags[outputIndex + 1];

      if (!targetPath) {
        io.writeStderr("Missing target path for runtime plan.");
        return 2;
      }

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      if (jsonOutput && markdownOutput) {
        io.writeStderr("Use either --json or --markdown, not both.");
        return 2;
      }

      const plan = await buildDoctorRuntimePlan(targetPath);
      const renderedPlan = jsonOutput
        ? renderDoctorRuntimePlanJson(plan)
        : markdownOutput
          ? renderDoctorRuntimePlanMarkdown(plan)
        : renderDoctorRuntimePlan(plan);

      if (outputPath) {
        await writeFile(
          outputPath,
          markdownOutput ? renderDoctorRuntimePlanMarkdown(plan) : renderDoctorRuntimePlanJson(plan),
          "utf8"
        );
      }

      io.writeStdout(renderedPlan);
      return plan.exitCode;
    }

    if (maybePath === "runtime-policy") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : null;
      const runtimePolicyFlags = targetPath ? remainingArgs.slice(1) : remainingArgs;
      const jsonOutput = runtimePolicyFlags.includes("--json");
      const outputIndex = runtimePolicyFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : runtimePolicyFlags[outputIndex + 1];

      if (!targetPath) {
        io.writeStderr("Missing target path for runtime policy.");
        return 2;
      }

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildDoctorRuntimePolicyReport(targetPath);
      const renderedReport = jsonOutput
        ? renderDoctorRuntimePolicyJson(report)
        : renderDoctorRuntimePolicy(report);

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "review-bundle") {
      if (remainingArgs[0] === "diff") {
        const diffFlags = remainingArgs.slice(1);
        const jsonOutput = diffFlags.includes("--json");
        const beforeIndex = diffFlags.indexOf("--before");
        const afterIndex = diffFlags.indexOf("--after");
        const beforeDirectory = beforeIndex === -1 ? null : diffFlags[beforeIndex + 1];
        const afterDirectory = afterIndex === -1 ? null : diffFlags[afterIndex + 1];

        if (beforeIndex === -1) {
          io.writeStderr("Missing before bundle directory. Use --before <dir>.");
          return 2;
        }

        if (!beforeDirectory || beforeDirectory.startsWith("--")) {
          io.writeStderr("Missing directory after --before.");
          return 2;
        }

        if (afterIndex === -1) {
          io.writeStderr("Missing after bundle directory. Use --after <dir>.");
          return 2;
        }

        if (!afterDirectory || afterDirectory.startsWith("--")) {
          io.writeStderr("Missing directory after --after.");
          return 2;
        }

        const report = await diffDoctorReviewBundles(beforeDirectory, afterDirectory);

        io.writeStdout(
          jsonOutput
            ? renderDoctorReviewBundleDiffJson(report)
            : renderDoctorReviewBundleDiff(report)
        );
        return report.exitCode;
      }

      if (remainingArgs[0] === "verify") {
        const bundleDirectory = remainingArgs[1] && !remainingArgs[1].startsWith("--")
          ? remainingArgs[1]
          : null;
        const verifyFlags = bundleDirectory ? remainingArgs.slice(2) : remainingArgs.slice(1);
        const jsonOutput = verifyFlags.includes("--json");
        const outputIndex = verifyFlags.indexOf("--output");
        const outputPath = outputIndex === -1 ? null : verifyFlags[outputIndex + 1];
        const targetIndex = verifyFlags.indexOf("--target");
        const targetPath = targetIndex === -1 ? null : verifyFlags[targetIndex + 1];
        const signKeyEnvIndex = verifyFlags.indexOf("--sign-key-env");
        const signKeyEnv = signKeyEnvIndex === -1 ? null : verifyFlags[signKeyEnvIndex + 1];

        if (!bundleDirectory) {
          io.writeStderr("Missing review bundle directory.");
          return 2;
        }

        if (targetIndex === -1) {
          io.writeStderr("Missing target path. Use --target <path>.");
          return 2;
        }

        if (!targetPath || targetPath.startsWith("--")) {
          io.writeStderr("Missing path after --target.");
          return 2;
        }

        if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
          io.writeStderr("Missing path after --output.");
          return 2;
        }

        if (signKeyEnvIndex === -1) {
          io.writeStderr("Missing signing key. Use --sign-key-env <name>.");
          return 2;
        }

        if (!signKeyEnv || signKeyEnv.startsWith("--")) {
          io.writeStderr("Missing environment variable name after --sign-key-env.");
          return 2;
        }

        const signingKey = terminalContext.env[signKeyEnv];

        if (!signingKey) {
          io.writeStderr(`Signing key environment variable is not set: ${signKeyEnv}`);
          return 2;
        }

        const report = await verifyDoctorReviewBundle(bundleDirectory, {
          signingKey,
          targetPath
        });
        const renderedReport = jsonOutput
          ? renderDoctorReviewBundleVerificationJson(report)
          : renderDoctorReviewBundleVerification(report);

        if (outputPath) {
          await writeFile(outputPath, renderedReport, "utf8");
        }

        io.writeStdout(renderedReport);
        return report.exitCode;
      }

      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : null;
      const reviewBundleFlags = targetPath ? remainingArgs.slice(1) : remainingArgs;
      const jsonOutput = reviewBundleFlags.includes("--json");
      const outputIndex = reviewBundleFlags.indexOf("--output");
      const outputDirectory = outputIndex === -1 ? null : reviewBundleFlags[outputIndex + 1];
      const signKeyEnvIndex = reviewBundleFlags.indexOf("--sign-key-env");
      const signKeyEnv = signKeyEnvIndex === -1 ? null : reviewBundleFlags[signKeyEnvIndex + 1];
      const allowDirty = reviewBundleFlags.includes("--allow-dirty");
      const allowUntagged = reviewBundleFlags.includes("--allow-untagged");

      if (!targetPath) {
        io.writeStderr("Missing target path for review bundle.");
        return 2;
      }

      if (outputIndex === -1) {
        io.writeStderr("Missing output directory. Use --output <dir>.");
        return 2;
      }

      if (!outputDirectory || outputDirectory.startsWith("--")) {
        io.writeStderr("Missing directory after --output.");
        return 2;
      }

      if (signKeyEnvIndex === -1) {
        io.writeStderr("Missing signing key. Use --sign-key-env <name>.");
        return 2;
      }

      if (!signKeyEnv || signKeyEnv.startsWith("--")) {
        io.writeStderr("Missing environment variable name after --sign-key-env.");
        return 2;
      }

      const signingKey = terminalContext.env[signKeyEnv];

      if (!signingKey) {
        io.writeStderr(`Signing key environment variable is not set: ${signKeyEnv}`);
        return 2;
      }

      const bundle = await buildDoctorReviewBundle(targetPath, {
        outputDirectory,
        signingKey,
        signingKeyEnv: signKeyEnv,
        allowDirty,
        allowUntagged
      });

      io.writeStdout(
        jsonOutput
          ? renderDoctorReviewBundleJson(bundle)
          : renderDoctorReviewBundle(bundle)
      );
      return bundle.manifest.exitCode;
    }

    if (maybePath === "release-evidence") {
      if (remainingArgs[0] === "asset") {
        const targetPath = remainingArgs[1] && !remainingArgs[1].startsWith("--")
          ? remainingArgs[1]
          : null;
        const assetFlags = targetPath ? remainingArgs.slice(2) : remainingArgs.slice(1);
        const jsonOutput = assetFlags.includes("--json");
        const upload = assetFlags.includes("--upload");
        const outputIndex = assetFlags.indexOf("--output");
        const outputPath = outputIndex === -1 ? null : assetFlags[outputIndex + 1];
        const tagIndex = assetFlags.indexOf("--tag");
        const tag = tagIndex === -1 ? null : assetFlags[tagIndex + 1];
        const signKeyIndex = assetFlags.indexOf("--sign-key");
        const signKeyEnvIndex = assetFlags.indexOf("--sign-key-env");
        const signKeyEnv = signKeyEnvIndex === -1 ? null : assetFlags[signKeyEnvIndex + 1];
        const allowDirty = assetFlags.includes("--allow-dirty");
        const allowUntagged = assetFlags.includes("--allow-untagged");
        const requireRuntimeApproval = assetFlags.includes("--require-runtime-approval");
        const runtimeApprovalDigestIndex = assetFlags.indexOf("--runtime-approval-digest");
        const runtimeApprovalDigest = runtimeApprovalDigestIndex === -1
          ? null
          : assetFlags[runtimeApprovalDigestIndex + 1];

        if (!targetPath) {
          io.writeStderr("Missing target path for release evidence asset.");
          return 2;
        }

        if (tagIndex === -1) {
          io.writeStderr("Missing release tag. Use --tag <tag>.");
          return 2;
        }

        if (!tag || tag.startsWith("--")) {
          io.writeStderr("Missing release tag after --tag.");
          return 2;
        }

        if (outputIndex === -1) {
          io.writeStderr("Missing output path. Use --output <path>.");
          return 2;
        }

        if (!outputPath || outputPath.startsWith("--")) {
          io.writeStderr("Missing path after --output.");
          return 2;
        }

        if (signKeyIndex !== -1) {
          io.writeStderr("Use --sign-key-env for release evidence assets; inline signing keys are not supported.");
          return 2;
        }

        if (signKeyEnvIndex === -1) {
          io.writeStderr("Missing signing key. Use --sign-key-env <name>.");
          return 2;
        }

        if (!signKeyEnv || signKeyEnv.startsWith("--")) {
          io.writeStderr("Missing environment variable name after --sign-key-env.");
          return 2;
        }

        if (
          runtimeApprovalDigestIndex !== -1 &&
          (!runtimeApprovalDigest || runtimeApprovalDigest.startsWith("--"))
        ) {
          io.writeStderr("Missing digest after --runtime-approval-digest.");
          return 2;
        }

        const signingKey = terminalContext.env[signKeyEnv];

        if (!signingKey) {
          io.writeStderr(`Environment variable ${signKeyEnv} is not set.`);
          return 2;
        }

        const parsedThresholds = parsePerformanceThresholds(assetFlags);

        if (typeof parsedThresholds === "string") {
          io.writeStderr(parsedThresholds);
          return 2;
        }

        const resolvedOutputPath = path.resolve(outputPath);
        const evidence = await buildDoctorReleaseEvidenceReport(targetPath, {
          signingKey,
          signingKeyEnv: signKeyEnv,
          allowDirty,
          allowUntagged,
          requireRuntimeApproval,
          runtimeApprovalDigest,
          environment: {
            env: terminalContext.env,
            platform: terminalContext.platform
          },
          runCheck: options.runCheckImpl
            ? (pathToCheck) => options.runCheckImpl!(pathToCheck)
            : undefined,
          performanceThresholds: parsedThresholds.thresholds
        });
        await writeFile(resolvedOutputPath, renderDoctorReleaseEvidenceJson(evidence), "utf8");

        let uploaded = false;
        const uploadArgs = ["release", "upload", tag, resolvedOutputPath, "--clobber"];

        if (upload && evidence.status === "pass" && evidence.releaseReady) {
          const uploadImpl = options.releaseAssetUploadImpl ?? uploadGitHubReleaseAsset;
          await uploadImpl(uploadArgs);
          uploaded = true;
        }

        const report = buildDoctorReleaseEvidenceAssetReport(evidence, {
          tag,
          artifactPath: resolvedOutputPath,
          uploaded
        });
        const reportJson = renderDoctorReleaseEvidenceAssetJson(report);

        io.writeStdout(jsonOutput ? reportJson : renderDoctorReleaseEvidenceAsset(report));
        return report.exitCode;
      }

      if (remainingArgs[0] === "verify") {
        const artifactPath = remainingArgs[1] && !remainingArgs[1].startsWith("--")
          ? remainingArgs[1]
          : null;
        const verifyFlags = artifactPath ? remainingArgs.slice(2) : remainingArgs.slice(1);
        const jsonOutput = verifyFlags.includes("--json");
        const outputIndex = verifyFlags.indexOf("--output");
        const outputPath = outputIndex === -1 ? null : verifyFlags[outputIndex + 1];
        const targetIndex = verifyFlags.indexOf("--target");
        const targetPath = targetIndex === -1 ? null : verifyFlags[targetIndex + 1];
        const signKeyIndex = verifyFlags.indexOf("--sign-key");
        const signKeyEnvIndex = verifyFlags.indexOf("--sign-key-env");
        const signKeyEnv = signKeyEnvIndex === -1 ? null : verifyFlags[signKeyEnvIndex + 1];

        if (!artifactPath) {
          io.writeStderr("Missing release evidence artifact path.");
          return 2;
        }

        if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
          io.writeStderr("Missing path after --output.");
          return 2;
        }

        if (targetIndex !== -1 && (!targetPath || targetPath.startsWith("--"))) {
          io.writeStderr("Missing path after --target.");
          return 2;
        }

        if (targetIndex === -1) {
          io.writeStderr("Missing target path. Use --target <path>.");
          return 2;
        }

        if (signKeyIndex !== -1) {
          io.writeStderr("Use --sign-key-env for release evidence verification; inline signing keys are not supported.");
          return 2;
        }

        if (signKeyEnvIndex === -1) {
          io.writeStderr("Missing signing key. Use --sign-key-env <name>.");
          return 2;
        }

        if (!signKeyEnv || signKeyEnv.startsWith("--")) {
          io.writeStderr("Missing environment variable name after --sign-key-env.");
          return 2;
        }

        const signingKey = terminalContext.env[signKeyEnv];

        if (!signingKey) {
          io.writeStderr(`Environment variable ${signKeyEnv} is not set.`);
          return 2;
        }

        const report = await verifyDoctorReleaseEvidence(artifactPath, {
          signingKey,
          targetPath: targetPath!
        });
        const reportJson = renderDoctorReleaseEvidenceVerificationJson(report);
        const renderedReport = jsonOutput
          ? reportJson
          : renderDoctorReleaseEvidenceVerification(report, { outputPath });

        if (outputPath) {
          await writeFile(outputPath, reportJson, "utf8");
        }

        io.writeStdout(renderedReport);
        return report.exitCode;
      }

      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : ".";
      const evidenceFlags = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs.slice(1)
        : remainingArgs;
      const jsonOutput = evidenceFlags.includes("--json");
      const outputIndex = evidenceFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : evidenceFlags[outputIndex + 1];
      const signKeyIndex = evidenceFlags.indexOf("--sign-key");
      const signKeyEnvIndex = evidenceFlags.indexOf("--sign-key-env");
      const signKeyEnv = signKeyEnvIndex === -1 ? null : evidenceFlags[signKeyEnvIndex + 1];
      const allowDirty = evidenceFlags.includes("--allow-dirty");
      const allowUntagged = evidenceFlags.includes("--allow-untagged");
      const requireRuntimeApproval = evidenceFlags.includes("--require-runtime-approval");
      const runtimeApprovalDigestIndex = evidenceFlags.indexOf("--runtime-approval-digest");
      const runtimeApprovalDigest = runtimeApprovalDigestIndex === -1
        ? null
        : evidenceFlags[runtimeApprovalDigestIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      if (signKeyIndex !== -1) {
        io.writeStderr("Use --sign-key-env for release evidence; inline signing keys are not supported.");
        return 2;
      }

      if (signKeyEnvIndex === -1) {
        io.writeStderr("Missing signing key. Use --sign-key-env <name>.");
        return 2;
      }

      if (!signKeyEnv || signKeyEnv.startsWith("--")) {
        io.writeStderr("Missing environment variable name after --sign-key-env.");
        return 2;
      }

      if (
        runtimeApprovalDigestIndex !== -1 &&
        (!runtimeApprovalDigest || runtimeApprovalDigest.startsWith("--"))
      ) {
        io.writeStderr("Missing digest after --runtime-approval-digest.");
        return 2;
      }

      const signingKey = terminalContext.env[signKeyEnv];

      if (!signingKey) {
        io.writeStderr(`Environment variable ${signKeyEnv} is not set.`);
        return 2;
      }

      const parsedThresholds = parsePerformanceThresholds(evidenceFlags);

      if (typeof parsedThresholds === "string") {
        io.writeStderr(parsedThresholds);
        return 2;
      }

      const report = await buildDoctorReleaseEvidenceReport(targetPath, {
        signingKey,
        signingKeyEnv: signKeyEnv,
        allowDirty,
        allowUntagged,
        requireRuntimeApproval,
        runtimeApprovalDigest,
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        },
        runCheck: options.runCheckImpl
          ? (pathToCheck) => options.runCheckImpl!(pathToCheck)
          : undefined,
        performanceThresholds: parsedThresholds.thresholds
      });
      const reportJson = renderDoctorReleaseEvidenceJson(report);
      const renderedReport = jsonOutput ? reportJson : renderDoctorReleaseEvidence(report);

      if (outputPath) {
        await writeFile(outputPath, reportJson, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "corpus") {
      const jsonOutput = remainingArgs.includes("--json");
      const outputIndex = remainingArgs.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : remainingArgs[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildDoctorValidationCorpusReport({
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        }
      });
      const reportJson = renderDoctorValidationCorpusJson(report);

      if (outputPath) {
        await writeFile(outputPath, reportJson, "utf8");
      }

      io.writeStdout(
        jsonOutput
          ? reportJson
          : renderDoctorValidationCorpusReport(report, { outputPath })
      );
      return report.summary.status === "pass" ? 0 : 1;
    }

    if (maybePath === "attest") {
      if (remainingArgs[0] === "verify") {
        const artifactPath = remainingArgs[1] && !remainingArgs[1].startsWith("--")
          ? remainingArgs[1]
          : null;
        const verifyFlags = artifactPath ? remainingArgs.slice(2) : remainingArgs.slice(1);
        const jsonOutput = verifyFlags.includes("--json");
        const outputIndex = verifyFlags.indexOf("--output");
        const outputPath = outputIndex === -1 ? null : verifyFlags[outputIndex + 1];
        const targetIndex = verifyFlags.indexOf("--target");
        const targetPath = targetIndex === -1 ? null : verifyFlags[targetIndex + 1];
        const signKeyIndex = verifyFlags.indexOf("--sign-key");
        const signKeyEnvIndex = verifyFlags.indexOf("--sign-key-env");
        const signKeyEnv = signKeyEnvIndex === -1 ? null : verifyFlags[signKeyEnvIndex + 1];

        if (!artifactPath) {
          io.writeStderr("Missing attestation artifact path. Usage: codex-plugin-doctor doctor attest verify <attestation.json> --target <path> --sign-key-env <name>");
          return 2;
        }

        if (targetIndex === -1 || !targetPath || targetPath.startsWith("--")) {
          io.writeStderr("Missing target path after --target.");
          return 2;
        }

        if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
          io.writeStderr("Missing path after --output.");
          return 2;
        }

        if (signKeyEnvIndex !== -1 && (!signKeyEnv || signKeyEnv.startsWith("--"))) {
          io.writeStderr("Missing environment variable name after --sign-key-env.");
          return 2;
        }

        if (signKeyIndex !== -1) {
          io.writeStderr("Use --sign-key-env for verification; inline verification keys are not supported.");
          return 2;
        }

        if (signKeyEnvIndex === -1) {
          io.writeStderr("Missing signing key. Use --sign-key-env <name> for verification.");
          return 2;
        }

        const envSigningKey = signKeyEnv ? terminalContext.env[signKeyEnv] : undefined;

        if (signKeyEnv && !envSigningKey) {
          io.writeStderr(`Environment variable ${signKeyEnv} is not set.`);
          return 2;
        }

        const report = await verifyDoctorAttestation(artifactPath, targetPath, {
          signingKey: envSigningKey!
        });
        const renderedReport = jsonOutput
          ? renderDoctorAttestationVerificationJson(report)
          : renderDoctorAttestationVerification(report, { outputPath });

        if (outputPath) {
          await writeFile(outputPath, renderedReport, "utf8");
        }

        io.writeStdout(renderedReport);
        return report.exitCode;
      }

      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : ".";
      const attestFlags = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs.slice(1)
        : remainingArgs;
      const jsonOutput = attestFlags.includes("--json");
      const outputIndex = attestFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : attestFlags[outputIndex + 1];
      const signKeyIndex = attestFlags.indexOf("--sign-key");
      const signKeyEnvIndex = attestFlags.indexOf("--sign-key-env");
      const signKey = signKeyIndex === -1 ? null : attestFlags[signKeyIndex + 1];
      const signKeyEnv = signKeyEnvIndex === -1 ? null : attestFlags[signKeyEnvIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      if (signKeyIndex !== -1 && (!signKey || signKey.startsWith("--"))) {
        io.writeStderr("Missing key after --sign-key.");
        return 2;
      }

      if (signKeyEnvIndex !== -1 && (!signKeyEnv || signKeyEnv.startsWith("--"))) {
        io.writeStderr("Missing environment variable name after --sign-key-env.");
        return 2;
      }

      if (signKeyIndex !== -1 && signKeyEnvIndex !== -1) {
        io.writeStderr("Use either --sign-key or --sign-key-env, not both.");
        return 2;
      }

      const envSigningKey = signKeyEnv ? terminalContext.env[signKeyEnv] : undefined;

      if (signKeyEnv && !envSigningKey) {
        io.writeStderr(`Environment variable ${signKeyEnv} is not set.`);
        return 2;
      }

      const attestation = await buildDoctorAttestation(targetPath, {
        signingKey: signKey ?? envSigningKey,
        signingKeyHint: signKeyEnv ? `env:${signKeyEnv}` : signKey ? "inline" : undefined,
        recomputeKeyEnv: signKeyEnv ?? undefined
      });
      const attestationJson = renderDoctorAttestationJson(attestation);

      if (outputPath) {
        await writeFile(outputPath, attestationJson, "utf8");
      }

      io.writeStdout(
        jsonOutput
          ? attestationJson
          : renderDoctorAttestation(attestation, { outputPath })
      );
      return attestation.summary.status === "fail" ? 1 : 0;
    }

    if (maybePath === "npm") {
      const packageSpec = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : null;

      if (!packageSpec) {
        io.writeStderr("Missing package spec. Usage: codex-plugin-doctor doctor npm <package> [--json] [--output <path>]");
        return 2;
      }

      const npmFlags = remainingArgs.slice(1);
      const jsonOutput = npmFlags.includes("--json");
      const outputIndex = npmFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : npmFlags[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildDoctorNpmPackageReport(packageSpec, {
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        }
      });
      const renderedReport = jsonOutput
        ? renderDoctorNpmPackageReportJson(report)
        : renderDoctorNpmPackageReport(report, { outputPath });

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.summary.exitCode;
    }

    if (maybePath === "diff") {
      const beforeIndex = remainingArgs.indexOf("--before");
      const afterIndex = remainingArgs.indexOf("--after");
      const beforePath = beforeIndex === -1 ? null : remainingArgs[beforeIndex + 1];
      const afterPath = afterIndex === -1 ? null : remainingArgs[afterIndex + 1];

      if (!beforePath || beforePath.startsWith("--") || !afterPath || afterPath.startsWith("--")) {
        io.writeStderr("Usage: codex-plugin-doctor doctor diff --before <path> --after <path> [--json] [--output <path>]");
        return 2;
      }

      const jsonOutput = remainingArgs.includes("--json");
      const outputIndex = remainingArgs.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : remainingArgs[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildDoctorRiskDiffReport(beforePath, afterPath, {
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        }
      });
      const renderedReport = jsonOutput
        ? renderDoctorRiskDiffReportJson(report)
        : renderDoctorRiskDiffReport(report, { outputPath });

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "inspector") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : ".";
      const inspectorFlags = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs.slice(1)
        : remainingArgs;
      const jsonOutput = inspectorFlags.includes("--json");
      const outputIndex = inspectorFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : inspectorFlags[outputIndex + 1];
      const serverIndex = inspectorFlags.indexOf("--server");
      const serverName = serverIndex === -1 ? null : inspectorFlags[serverIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      if (serverIndex !== -1 && (!serverName || serverName.startsWith("--"))) {
        io.writeStderr("Missing server name after --server.");
        return 2;
      }

      const report = await buildDoctorInspectorReport(targetPath, { serverName });
      const renderedReport = jsonOutput
        ? renderDoctorInspectorReportJson(report)
        : renderDoctorInspectorReport(report, { outputPath });

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "trust") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : ".";
      const trustFlags = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs.slice(1)
        : remainingArgs;
      const jsonOutput = trustFlags.includes("--json");
      const outputIndex = trustFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : trustFlags[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildTrustScore(targetPath);
      const renderedReport = jsonOutput
        ? renderTrustScoreJson(report)
        : renderTrustScore(report);

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "perf") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs[0]
        : ".";
      const perfFlags = remainingArgs[0] && !remainingArgs[0].startsWith("--")
        ? remainingArgs.slice(1)
        : remainingArgs;
      const jsonOutput = perfFlags.includes("--json");
      const outputIndex = perfFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : perfFlags[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const parsedThresholds = parsePerformanceThresholds(perfFlags);

      if (typeof parsedThresholds === "string") {
        io.writeStderr(parsedThresholds);
        return 2;
      }

      const report = await buildDoctorPerformanceReport(targetPath, {
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        },
        runCheck: options.runCheckImpl
          ? (pathToCheck) => options.runCheckImpl!(pathToCheck)
          : undefined,
        thresholds: parsedThresholds.thresholds
      });
      const renderedReport = jsonOutput
        ? renderDoctorPerformanceReportJson(report)
        : renderDoctorPerformanceReport(report, { outputPath });

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.exitCode;
    }

    if (maybePath === "export") {
      const bundleIndex = remainingArgs.indexOf("--bundle");

      if (bundleIndex === -1) {
        io.writeStderr(
          "Usage: codex-plugin-doctor doctor export --bundle <path> [--json] [--output <path>]"
        );
        return 2;
      }

      const targetPath = remainingArgs[bundleIndex + 1] && !remainingArgs[bundleIndex + 1].startsWith("--")
        ? remainingArgs[bundleIndex + 1]
        : ".";
      const jsonOutput = remainingArgs.includes("--json");
      const outputIndex = remainingArgs.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : remainingArgs[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const bundle = await buildDoctorExportBundle(targetPath, {
        env: terminalContext.env,
        platform: terminalContext.platform
      });
      const bundleJson = renderDoctorExportBundleJson(bundle);

      if (outputPath) {
        await writeFile(outputPath, bundleJson, "utf8");
      }

      io.writeStdout(
        jsonOutput
          ? bundleJson
          : renderDoctorExportBundle(bundle, { outputPath })
      );
      return 0;
    }

    if (maybePath === "snapshot") {
      const jsonOutput = doctorFlags.includes("--json");
      const outputIndex = doctorFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : doctorFlags[outputIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const snapshot = await buildDoctorSnapshot(terminalContext);
      const snapshotJson = renderDoctorSnapshotJson(snapshot);

      if (outputPath) {
        await writeFile(outputPath, snapshotJson, "utf8");
      }

      io.writeStdout(
        jsonOutput
          ? snapshotJson
          : renderDoctorSnapshot(snapshot, { outputPath })
      );
      return 0;
    }

    if (doctorFlags.includes("--update-check")) {
      const latestVersion = await (options.resolveLatestVersion ?? resolveLatestNpmVersion)();

      io.writeStdout(renderUpdateCheck(latestVersion));
      return 0;
    }

    if (maybePath === "clients") {
      io.writeStdout(await renderClientDoctor(terminalContext));
      return 0;
    }

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
    const initFlags = maybePath && maybePath.startsWith("--")
      ? [maybePath, ...remainingArgs]
      : remainingArgs;
    const templateIndex = initFlags.indexOf("--template");
    const templateName = templateIndex === -1 ? "skill-only" : initFlags[templateIndex + 1];

    if (templateIndex !== -1 && (!templateName || templateName.startsWith("--"))) {
      io.writeStderr("Missing template after --template.");
      return 2;
    }

    if (!isInitPluginTemplate(templateName)) {
      io.writeStderr(
        `Unknown init template: ${templateName}. Supported templates: ${initPluginTemplates.join(", ")}.`
      );
      return 2;
    }

    const result = await initPluginPackage(targetPath, { template: templateName });
    const lines = [
      "Initialized Codex plugin package",
      `Template: ${result.template}`,
      `Root: ${result.rootPath}`,
      `Manifest: ${result.manifestPath}`,
      `Skill: ${result.skillPath}`
    ];

    if (result.mcpConfigPath) {
      lines.push(`MCP config: ${result.mcpConfigPath}`);
    }

    if (result.serverPath) {
      lines.push(`Server: ${result.serverPath}`);
    }

    io.writeStdout(
      [
        ...lines,
        "",
        `Next: codex-plugin-doctor check ${result.rootPath}${result.template === "full-runtime" ? " --runtime" : ""}`
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
        "Missing target path. Usage: codex-plugin-doctor fix <path> (--dry-run|--interactive --backup|--apply --backup)"
      );
      return 2;
    }

    const dryRun = remainingArgs.includes("--dry-run");
    const apply = remainingArgs.includes("--apply");
    const interactive = remainingArgs.includes("--interactive");
    const backup = remainingArgs.includes("--backup");
    const jsonOutput = remainingArgs.includes("--json");

    if ((apply || interactive) && !backup) {
      io.writeStderr("Fix mode requires --backup.");
      return 2;
    }

    if ([dryRun, apply, interactive].filter(Boolean).length !== 1) {
      io.writeStderr("Choose exactly one fix mode: --dry-run, --interactive --backup, or --apply --backup.");
      return 2;
    }

    if (interactive && jsonOutput) {
      io.writeStderr("Interactive fix mode does not support --json.");
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

    if (interactive) {
      const plan = await buildFixPlan(maybePath);

      io.writeStdout(
        [
          renderFixPlan(plan, "interactive"),
          "",
          "Type yes to apply these fixes with a backup, or enter action numbers like 1,3. Anything else cancels."
        ].join("\n")
      );

      const answer = (await io.readStdin?.("Apply fixes? ") ?? "").trim().toLowerCase();
      const selectedActionIndexes = answer === "yes"
        ? null
        : parseSelectedFixActionIndexes(answer, plan.actions.length);

      if (answer !== "yes" && !selectedActionIndexes) {
        io.writeStdout("Fix cancelled. No files changed.");
        return 0;
      }

      io.writeStdout(
        renderApplyFixResult(
          await applyFixPlan(
            maybePath,
            selectedActionIndexes ? { actionIndexes: selectedActionIndexes } : {}
          )
        )
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

  if (command === "security") {
    if (!maybePath || maybePath.startsWith("--")) {
      io.writeStderr("Missing target path. Usage: codex-plugin-doctor security <path> [--json|--scorecard]");
      return 2;
    }

    const jsonOutput = remainingArgs.includes("--json");
    const scorecardOutput = remainingArgs.includes("--scorecard");
    const policyIndex = remainingArgs.indexOf("--policy");
    const policyName = policyIndex === -1 ? null : remainingArgs[policyIndex + 1];
    const policy = parsePolicyPack(policyName);

    if (jsonOutput && scorecardOutput) {
      io.writeStderr("Use either --json or --scorecard, not both.");
      return 2;
    }

    if (policyIndex !== -1 && (!policyName || policyName.startsWith("--"))) {
      io.writeStderr("Missing policy after --policy.");
      return 2;
    }

    if (policyIndex !== -1 && !policy) {
      io.writeStderr(`Unknown policy: ${policyName}. Supported policies: ${policyPackNames.join(", ")}.`);
      return 2;
    }

    const audit = applyPolicyToSecurityAudit(await buildSecurityAudit(maybePath), policy);

    io.writeStdout(
      jsonOutput
        ? renderSecurityAuditJson(audit)
        : renderSecurityScorecard(audit, { includeFindings: !scorecardOutput })
    );

    return audit.status === "fail" ? 1 : 0;
  }

  if (command === "mcp") {
    const parsedMcpArgs = buildGenericMcpDoctorCommandArgs(maybePath ?? "", remainingArgs);

    if (typeof parsedMcpArgs === "string") {
      io.writeStderr(parsedMcpArgs);
      return 2;
    }

    const report = await buildGenericMcpDoctor(parsedMcpArgs.targetPath, {
      env: terminalContext.env,
      platform: terminalContext.platform
    });
    const renderedReport = parsedMcpArgs.jsonOutput
      ? renderGenericMcpDoctorJson(report)
      : renderGenericMcpDoctor(report);

    if (parsedMcpArgs.outputPath) {
      await writeFile(parsedMcpArgs.outputPath, renderedReport, "utf8");
    }

    io.writeStdout(renderedReport);
    return report.exitCode;
  }

  if (command === "audit") {
    const auditFlags = maybePath ? [maybePath, ...remainingArgs] : remainingArgs;
    const installed = auditFlags.includes("--installed");

    if (!installed) {
      io.writeStderr(
        "Usage: codex-plugin-doctor audit --installed [filter] [--security] [--compat] [--json] [--output <path>] [--cache] [--changed]"
      );
      return 2;
    }

    const installedIndex = auditFlags.indexOf("--installed");
    const installedFilter =
      auditFlags[installedIndex + 1] && !auditFlags[installedIndex + 1].startsWith("--")
        ? auditFlags[installedIndex + 1]
        : null;
    const jsonOutput = auditFlags.includes("--json");
    const includeSecurity = auditFlags.includes("--security");
    const includeCompatibility = auditFlags.includes("--compat");
    const outputIndex = auditFlags.indexOf("--output");
    const outputPath = outputIndex === -1 ? null : auditFlags[outputIndex + 1];
    const policyIndex = auditFlags.indexOf("--policy");
    const policyName = policyIndex === -1 ? null : auditFlags[policyIndex + 1];
    const policy = parsePolicyPack(policyName);
    const cacheEnabled = auditFlags.includes("--cache") || auditFlags.includes("--changed");
    const changedOnly = auditFlags.includes("--changed");
    const cacheFileIndex = auditFlags.indexOf("--cache-file");
    const cachePath = cacheFileIndex === -1 ? null : auditFlags[cacheFileIndex + 1];

    if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
      io.writeStderr("Missing path after --output.");
      return 2;
    }

    if (policyIndex !== -1 && (!policyName || policyName.startsWith("--"))) {
      io.writeStderr("Missing policy after --policy.");
      return 2;
    }

    if (cacheFileIndex !== -1 && (!cachePath || cachePath.startsWith("--"))) {
      io.writeStderr("Missing path after --cache-file.");
      return 2;
    }

    if (policyIndex !== -1 && !policy) {
      io.writeStderr(`Unknown policy: ${policyName}. Supported policies: ${policyPackNames.join(", ")}.`);
      return 2;
    }

    const report = await buildEcosystemAudit({
      env: terminalContext.env,
      platform: terminalContext.platform,
      filter: installedFilter,
      includeSecurity,
      includeCompatibility,
      failOnWarnings: policyFailsOnWarnings(policy),
      cache: {
        enabled: cacheEnabled,
        changedOnly,
        cachePath
      },
      validatePlugin: options.runCheckImpl ?? runCheck
    });

    if (report.summary.totalPlugins === 0 && !changedOnly) {
      io.writeStderr(
        installedFilter
          ? `No installed Codex plugins matched '${installedFilter}'.`
          : "No installed Codex plugins found."
      );
      return 1;
    }

    const renderedReport = jsonOutput
      ? renderEcosystemAuditJson(report)
      : renderEcosystemAudit(report);

    if (outputPath) {
      await writeFile(outputPath, renderedReport, "utf8");
    }

    io.writeStdout(renderedReport);
    return report.status === "fail" ? 1 : 0;
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
  const explainFindings = normalizedFlags.includes("--explain");
  const noAnimations = normalizedFlags.includes("--no-animations");
  const asciiMode = normalizedFlags.includes("--ascii");
  const installedSummary = normalizedFlags.includes("--all-summary");
  const installedCompatibility = normalizedFlags.includes("--compat");
  const outputIndex = normalizedFlags.indexOf("--output");
  const outputPath = outputIndex === -1 ? null : normalizedFlags[outputIndex + 1];
  const configIndex = normalizedFlags.indexOf("--config");
  const configPath = configIndex === -1 ? null : normalizedFlags[configIndex + 1];
  const profileIndex = normalizedFlags.indexOf("--profile");
  const profileName = profileIndex === -1 ? null : normalizedFlags[profileIndex + 1];
  const checkProfile = parseCheckProfile(profileName);
  const policyIndex = normalizedFlags.indexOf("--policy");
  const policyName = policyIndex === -1 ? null : normalizedFlags[policyIndex + 1];
  const policy = parsePolicyPack(policyName);
  const historyIndex = normalizedFlags.indexOf("--history");
  const historyPath = historyIndex === -1 ? null : normalizedFlags[historyIndex + 1];
  const requireRuntimeApproval = normalizedFlags.includes("--require-runtime-approval");
  const runtimeApprovalDigestIndex = normalizedFlags.indexOf("--runtime-approval-digest");
  const runtimeApprovalDigest = runtimeApprovalDigestIndex === -1
    ? null
    : normalizedFlags[runtimeApprovalDigestIndex + 1];

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

  if (policyIndex !== -1 && (!policyName || policyName.startsWith("--"))) {
    io.writeStderr("Missing policy after --policy.");
    return 2;
  }

  if (policyIndex !== -1 && !policy) {
    io.writeStderr(`Unknown policy: ${policyName}. Supported policies: ${policyPackNames.join(", ")}.`);
    return 2;
  }

  if (historyIndex !== -1 && (!historyPath || historyPath.startsWith("--"))) {
    io.writeStderr("Missing path after --history.");
    return 2;
  }

  if (
    runtimeApprovalDigestIndex !== -1 &&
    (!runtimeApprovalDigest || runtimeApprovalDigest.startsWith("--"))
  ) {
    io.writeStderr("Missing digest after --runtime-approval-digest.");
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

  const effectiveRuntimeProbeEnabled =
    runtimeProbeEnabled ||
    checkProfile === "publish" ||
    policyEnablesRuntime(policy);

  if (requireRuntimeApproval && !effectiveRuntimeProbeEnabled) {
    io.writeStderr("Runtime approval requires runtime probing. Add --runtime, --profile publish, or a runtime-enabled policy.");
    return 2;
  }

  if (checkInstalled && requireRuntimeApproval) {
    io.writeStderr("Runtime approval gating requires a single package target, not --installed.");
    return 2;
  }

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

  if (!checkInstalled && effectiveRuntimeProbeEnabled && requireRuntimeApproval) {
    const runtimePlan = await buildDoctorRuntimePlan(targetPath);
    const approval = evaluateRuntimeApproval(runtimePlan, {
      required: true,
      approvedDigest: runtimeApprovalDigest
    });

    if (!runtimeApprovalPassed(approval)) {
      io.writeStderr(`${approval.message}\nCurrent runtime plan digest: ${runtimePlan.digest}`);
      return 1;
    }
  }

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
      const compatibilityMatrix = installedCompatibility
        ? await buildCompatibilityMatrix(plugin.rootPath, {
            env: terminalContext.env,
            platform: terminalContext.platform
          })
        : undefined;

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
          applyPolicyToDoctorConfig(applyCheckProfile(config, checkProfile), policy)
        ),
        compatibilityMatrix
      });
    }

    const report = installedSummary
      ? renderInstalledSummary(checkedPlugins)
      : sarifOutput
      ? renderInstalledSarifReport(checkedPlugins)
      : jsonOutput
        ? renderInstalledJsonReport(checkedPlugins, { runtimeProbeEnabled: effectiveRuntimeProbeEnabled })
        : checkedPlugins
          .map((item) =>
            markdownOutput
              ? buildMarkdownReport(item.result, { runtimeProbeEnabled: effectiveRuntimeProbeEnabled })
              : renderTextReport(item.result, {
                  ascii: outputPolicy.style === "ascii",
                  explain: explainFindings
                })
          )
          .join("\n\n");

    if (outputPath) {
      await writeFile(outputPath, report, "utf8");
    }

    io.writeStdout(report);

    return checkedPlugins.some((item) =>
      item.result.exitCode === 1 ||
      (item.compatibilityMatrix && matrixExitCode(item.compatibilityMatrix) === 1)
    )
      ? 1
      : 0;
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
    applyPolicyToDoctorConfig(
      applyCheckProfile(await loadDoctorConfig(targetPath, configPath), checkProfile),
      policy
    )
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
      : renderTextReport(result, {
          ascii: outputPolicy.style === "ascii",
          explain: explainFindings
        });

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

