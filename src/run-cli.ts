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
  applyValidationBaseline,
  buildValidationBaseline,
  readValidationBaseline,
  writeValidationBaseline
} from "./core/validation-baseline.js";
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
import { buildSubmissionPreflight } from "./core/submission-preflight.js";
import {
  buildDoctorValidationCorpusReport,
  renderDoctorValidationCorpusJson,
  renderDoctorValidationCorpusReport
} from "./core/validation-corpus.js";
import {
  buildExternalValidationCorpusReport,
  ExternalCorpusManifestError
} from "./core/external-validation-corpus.js";
import {
  buildCorpusQualityMetricsDiffReport,
  buildCorpusQualityMetricsReport,
  CorpusMetricsDiffError,
  CorpusMetricsManifestError,
  renderCorpusQualityMetricsDiffJson,
  renderCorpusQualityMetricsDiffMarkdown,
  renderCorpusQualityMetricsDiffText,
  renderCorpusQualityMetricsJson,
  renderCorpusQualityMetricsMarkdown,
  renderCorpusQualityMetricsText,
  type BuildCorpusMetricsOptions,
  type CorpusMetricThresholds
} from "./core/corpus-quality-metrics.js";
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
  buildMcpRegistryReadiness,
  inspectMcpRegistryServer,
  registryReadinessExitCode,
  renderMcpRegistryReadiness,
  renderMcpRegistryReadinessJson
} from "./core/mcp-registry.js";
import {
  buildMcpRegistryPublicationPreflight,
  registryPublicationPreflightExitCode,
  renderMcpRegistryPublicationPreflight,
  renderMcpRegistryPublicationPreflightJson
} from "./core/mcp-registry-preflight.js";
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
import { buildDoctorSize, renderDoctorSize, renderDoctorSizeJson } from "./core/doctor-size.js";
import { initCiWorkflow } from "./core/init-ci.js";
import { watchPlugin } from "./core/watch-plugin.js";
import { buildDepAudit, renderDepAudit, renderDepAuditJson, renderDepAuditSarif } from "./core/dep-audit.js";
import { initGitHooks, removeGitHooks } from "./core/init-git-hooks.js";
import { generateCompletion } from "./core/shell-completion.js";
import { renderConfigValidation, renderConfigValidationJson, validateConfigFile } from "./core/config-validate.js";
import { buildReleaseCheck, renderReleaseCheck, renderReleaseCheckJson } from "./core/release-check.js";
import {
  initPluginPackage,
  initPluginTemplates,
  isInitPluginTemplate
} from "./core/init-plugin.js";
import type { RuntimeSandboxMode } from "./domain/types.js";
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
import {
  renderSuppressionList,
  renderSuppressionListJson,
  renderSuppressionMutation,
  renderSuppressionMutationJson,
  renderSuppressionPrune,
  renderSuppressionPruneJson
} from "./reporting/render-suppression-management.js";
import { renderRuleExplanation } from "./reporting/render-rule-explanation.js";
import { renderSarifReport } from "./reporting/render-sarif-report.js";
import { renderTextReport } from "./reporting/render-text-report.js";
import {
  renderSubmissionPreflightJson,
  renderSubmissionPreflightMarkdown,
  renderSubmissionPreflightText,
  submissionPreflightExitCode
} from "./reporting/render-submission-report.js";
import {
  applyPolicyToDepAudit,
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
import {
  addSuppression,
  listSuppressions,
  pruneSuppressions,
  readRawDoctorConfig,
  removeSuppressionByFingerprint,
  removeSuppressionByIndex,
  SuppressionManagementError,
  writeRawDoctorConfig
} from "./index.js";

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
  writeRawDoctorConfigImpl?: typeof writeRawDoctorConfig;
  now?: () => Date;
  releaseAssetUploadImpl?: (args: string[]) => Promise<void>;
  resolveLatestVersion?: () => Promise<string>;
  buildCorpusMetricsDiffReportImpl?: typeof buildCorpusQualityMetricsDiffReport;
  buildCorpusMetricsReportImpl?: typeof buildCorpusQualityMetricsReport;
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

function writeExactStdout(io: CliIo, message: string): void {
  if (io === defaultIo) {
    process.stdout.write(message);
    return;
  }
  io.writeStdout(message);
}

class CliUsageError extends Error {}

function parseRuntimeSandbox(
  flags: string[],
  options: { requireRuntime?: boolean } = { requireRuntime: true }
): RuntimeSandboxMode | null {
  const index = flags.indexOf("--sandbox");

  if (index === -1) {
    return null;
  }

  const value = flags[index + 1];

  if (value !== "docker") {
    throw new CliUsageError("Expected --sandbox docker.");
  }

  if (options.requireRuntime !== false && !flags.includes("--runtime")) {
    throw new CliUsageError("--sandbox docker requires --runtime.");
  }

  return value;
}

function parseRemoteNetworkFlags(
  flags: string[],
  runtime: boolean
): {
  allowNetwork: boolean;
  allowLocalNetwork: boolean;
  allowSessionLifecycle: boolean;
  requireRemoteReliability: boolean;
} | CliUsageError {
  let allowNetwork = false;
  let allowLocalNetwork = false;
  let allowSessionLifecycle = false;
  let requireRemoteReliability = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--allow-network") {
      if (allowNetwork) return new CliUsageError("Duplicate runtime network flag: --allow-network.");
      if (flags[index + 1] && !flags[index + 1]!.startsWith("--")) {
        return new CliUsageError("--allow-network does not accept a value.");
      }
      allowNetwork = true;
    } else if (flag === "--allow-local-network") {
      if (allowLocalNetwork) return new CliUsageError("Duplicate runtime network flag: --allow-local-network.");
      if (flags[index + 1] && !flags[index + 1]!.startsWith("--")) {
        return new CliUsageError("--allow-local-network does not accept a value.");
      }
      allowLocalNetwork = true;
    } else if (flag === "--allow-session-lifecycle") {
      if (allowSessionLifecycle) return new CliUsageError("Duplicate runtime remote flag: --allow-session-lifecycle.");
      if (flags[index + 1] && !flags[index + 1]!.startsWith("--")) {
        return new CliUsageError("--allow-session-lifecycle does not accept a value.");
      }
      allowSessionLifecycle = true;
    } else if (flag === "--require-remote-reliability") {
      if (requireRemoteReliability) return new CliUsageError("Duplicate runtime remote flag: --require-remote-reliability.");
      if (flags[index + 1] && !flags[index + 1]!.startsWith("--")) {
        return new CliUsageError("--require-remote-reliability does not accept a value.");
      }
      requireRemoteReliability = true;
    } else if (
      flag?.startsWith("--allow-network=") ||
      flag?.startsWith("--allow-local-network=") ||
      flag?.startsWith("--allow-session-lifecycle=") ||
      flag?.startsWith("--require-remote-reliability=")
    ) {
      return new CliUsageError(`${flag.split("=", 1)[0]} does not accept a value.`);
    }
  }

  if (allowSessionLifecycle && !runtime) {
    return new CliUsageError("--allow-session-lifecycle requires --runtime.");
  }

  if (requireRemoteReliability && !runtime) {
    return new CliUsageError("--require-remote-reliability requires --runtime and --allow-network.");
  }

  if ((allowNetwork || allowLocalNetwork) && !runtime) {
    return new CliUsageError("--allow-network requires --runtime.");
  }

  if (allowLocalNetwork && !allowNetwork) {
    return new CliUsageError("--allow-local-network requires --allow-network.");
  }

  if (allowSessionLifecycle && !allowNetwork) {
    return new CliUsageError("--allow-session-lifecycle requires --allow-network.");
  }

  if (requireRemoteReliability && !allowNetwork) {
    return new CliUsageError("--require-remote-reliability requires --runtime and --allow-network.");
  }

  return { allowNetwork, allowLocalNetwork, allowSessionLifecycle, requireRemoteReliability };
}

function printUsage(io: CliIo): void {
  io.writeStderr(
            "Usage: codex-plugin-doctor check <path|--installed> [filter] [--policy codex-publish|mcp-strict|security] [--compat] [--json|--markdown|--badge-json|--badge-markdown] [--output <path>] [--history <path>] [--runtime [--allow-network [--allow-local-network]]] [--sandbox docker] [--require-runtime-approval --runtime-approval-digest <digest>] [--verbose-runtime] [--explain] [--no-animations] [--ascii] [--changed-since <ref>] [--fail-on <rule-id>]\n       codex-plugin-doctor audit --installed [filter] [--policy codex-publish|mcp-strict|security] [--security] [--compat] [--json] [--output <path>] [--cache] [--changed]\n       codex-plugin-doctor audit deps <path> [--policy codex-publish|mcp-strict|security] [--recommend] [--json|--sarif] [--output <path>]\n       codex-plugin-doctor mcp <path> [--runtime [--allow-network [--allow-local-network]]] [--json] [--output <path>]\n       codex-plugin-doctor security <path> [--policy security] [--json|--scorecard]\n       codex-plugin-doctor compat <path> [--all|--client <client>] [--json] [--scorecard] [--output <path>] [--install-preview|--apply --backup]\n       codex-plugin-doctor suppress add <path> [--fingerprint <sha256> --reason <text> --expires-at YYYY-MM-DD] [--config <path>] [--json]\n       codex-plugin-doctor suppress list <path> [--config <path>] [--json]\n       codex-plugin-doctor suppress remove <path> [--fingerprint <sha256>|--index <n>] [--config <path>] [--json]\n       codex-plugin-doctor fix <path> (--dry-run|--interactive --backup|--apply --backup)\n       codex-plugin-doctor history <history.jsonl> [--json] [--fail-on-regression]\n       codex-plugin-doctor watch <path> [--runtime] [--json] [--output <path>] [--debounce-ms <ms>] [--max-iterations <n>] [--fail-fast] [--accumulate-json <path>]\n       codex-plugin-doctor doctor [npm <package>|contract|corpus [--manifest <corpus.json>] [--json] [--output <path>]|corpus metrics --manifest <corpus.json> [--json|--markdown] [--output <path>] [--min-precision <0..1>] [--min-recall <0..1>] [--max-false-positive-rate <0..1>]|runtime-plan <path> [--sandbox docker] [--json|--markdown] [--output <path>]|runtime-policy <path> [--sandbox docker] [--json] [--output <path>]|review-bundle <path> --output <dir> --sign-key-env NAME [--json] [--allow-dirty] [--allow-untagged]|review-bundle verify <bundle-dir> --target <path> --sign-key-env NAME [--json] [--output <path>] [--failures-only]|review-bundle diff --before <dir> --after <dir> [--json]|attest <path> [--sign-key-env NAME]|attest verify <attestation.json> --target <path> --sign-key-env NAME|release-evidence <path> --sign-key-env NAME [--runtime [--allow-network [--allow-local-network]]] [--sandbox docker] [--allow-dirty] [--allow-untagged] [--require-runtime-approval --runtime-approval-digest <digest>]|release-evidence verify <evidence.json> --target <path> --sign-key-env NAME|release-evidence asset <path> --tag <tag> --output <evidence.json> --sign-key-env NAME [--runtime [--allow-network [--allow-local-network]]] [--sandbox docker] [--allow-dirty] [--allow-untagged] [--require-runtime-approval --runtime-approval-digest <digest>] [--upload]|mcp <path> [--runtime [--allow-network [--allow-local-network]]]|inspector <path>|diff --before <path> --after <path>|recommend <path>|trust <path>|perf <path> [--max-total-ms <ms>] [--max-stage-ms stage=ms]|export --bundle <path>|snapshot|clients|--json|--update-check]\n       codex-plugin-doctor init [path] [--template skill-only|mcp-stdio|mcp-http|full-runtime]\n       codex-plugin-doctor init-ci [path]\n       codex-plugin-doctor init-git-hooks [path] [--force] [--json]\n       codex-plugin-doctor init-git-hooks [path] --remove [--json]\n       codex-plugin-doctor completion bash|zsh|fish\n       codex-plugin-doctor config validate <path> [--json]\n       codex-plugin-doctor release check <path> [--json] [--runtime [--allow-network [--allow-local-network]]] [--sandbox docker]\n       codex-plugin-doctor self-test\n       codex-plugin-doctor list --installed\n       codex-plugin-doctor explain <finding-id>\n       codex-plugin-doctor --version\n\nFirst run:\n       codex-plugin-doctor doctor\n       codex-plugin-doctor self-test\n       codex-plugin-doctor init my-plugin\n       codex-plugin-doctor check . --runtime --explain"
  );
  io.writeStderr(
    "Registry readiness: codex-plugin-doctor registry check <server.json|directory> [--json] [--output <path>] [--require-registry-readiness]\n"
    + "       codex-plugin-doctor registry inspect <server-name> --allow-network [--json] [--output <path>] [--require-registry-readiness]\n"
    + "Registry publication preflight: codex-plugin-doctor registry preflight <server.json|directory> [--allow-network] [--json] [--output <path>] [--require-publish-ready]"
  );
  io.writeStderr(
    "Corpus quality regression: codex-plugin-doctor doctor corpus metrics diff --before <metrics.json> --after <metrics.json> [--fail-on-regression] [--json|--markdown] [--output <path>]"
  );
  io.writeStderr(
    "Suppression governance: codex-plugin-doctor suppress list <path> [--fail-on-expired] [--fail-on-invalid] [--warn-expiring-within-days <days>]\n       codex-plugin-doctor suppress prune <path> [--apply] [--json]"
  );
  io.writeStderr(
    "Baseline gating: codex-plugin-doctor baseline create <path> --output <path> [--runtime]\n       codex-plugin-doctor check <path> --baseline <path>"
  );
  io.writeStderr(
    "Remote MCP runtime flags (check, mcp, release check, and doctor release-evidence): --runtime --allow-network [--allow-local-network] [--allow-session-lifecycle] [--require-remote-reliability]\n       --allow-session-lifecycle requires --runtime --allow-network and can terminate a remote session.\n       --require-remote-reliability requires --runtime --allow-network, blocks non-pass reliability, and does not grant network consent."
  );
  io.writeStderr(
    "       codex-plugin-doctor doctor submission <path> [--json|--markdown] [--output <path>] [--require-ready]"
  );
}

const suppressUsageText = [
  "Usage:",
  "       codex-plugin-doctor suppress add <path> [--fingerprint <sha256> --reason <text> --expires-at YYYY-MM-DD] [--config <path>] [--json]",
  "       codex-plugin-doctor suppress list <path> [--config <path>] [--json] [--fail-on-expired] [--fail-on-invalid] [--warn-expiring-within-days <days>]",
  "       codex-plugin-doctor suppress remove <path> [--fingerprint <sha256>|--index <n>] [--config <path>] [--json]",
  "       codex-plugin-doctor suppress prune <path> [--config <path>] [--apply] [--json]"
].join("\n");

type ParsedSuppressCommand =
  | {
      action: "add";
      targetPath: string;
      configPath: string | null;
      jsonOutput: boolean;
      interactive: false;
      fingerprint: string;
      reason: string;
      expiresAt: string;
    }
  | {
      action: "add";
      targetPath: string;
      configPath: string | null;
      jsonOutput: boolean;
      interactive: true;
    }
  | {
      action: "list";
      targetPath: string;
      configPath: string | null;
      jsonOutput: boolean;
      failOnExpired: boolean;
      failOnInvalid: boolean;
      warnExpiringWithinDays: number | null;
    }
  | {
      action: "remove";
      targetPath: string;
      configPath: string | null;
      jsonOutput: boolean;
      interactive: false;
      selector:
        | {
            type: "fingerprint";
            fingerprint: string;
          }
        | {
            type: "index";
            index: number;
          };
    }
  | {
      action: "remove";
      targetPath: string;
      configPath: string | null;
      jsonOutput: boolean;
      interactive: true;
    }
  | {
      action: "prune";
      targetPath: string;
      configPath: string | null;
      jsonOutput: boolean;
      apply: boolean;
    };

type SuppressParseError = {
  message: string;
  showUsage: boolean;
};

function printSuppressUsage(io: CliIo): void {
  io.writeStderr(suppressUsageText);
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

function parseSuppressCommand(args: string[]): ParsedSuppressCommand | SuppressParseError {
  const [action, targetPath, ...flags] = args;

  if (!action) {
    return {
      message: "Missing suppress action.",
      showUsage: true
    };
  }

  if (
    action !== "add" &&
    action !== "list" &&
    action !== "remove" &&
    action !== "prune"
  ) {
    return {
      message: `Unknown suppress action: ${action}.`,
      showUsage: true
    };
  }

  if (!targetPath || targetPath.startsWith("--")) {
    return {
      message: "Missing suppression target path.",
      showUsage: true
    };
  }

  let configPath: string | null = null;
  let jsonOutput = false;
  let fingerprint: string | null = null;
  let reason: string | null = null;
  let expiresAt: string | null = null;
  let indexValue: string | null = null;
  let failOnExpired = false;
  let failOnInvalid = false;
  let apply = false;
  let warnExpiringWithinDays: number | null = null;
  const seenFlags = new Set<string>();

  const markSeenFlag = (flag: string): SuppressParseError | null => {
    if (seenFlags.has(flag)) {
      return {
        message: `Duplicate suppress flag: ${flag}.`,
        showUsage: false
      };
    }

    seenFlags.add(flag);
    return null;
  };

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--json") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      jsonOutput = true;
      continue;
    }

    if (flag === "--config") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing path after --config.",
          showUsage: false
        };
      }

      configPath = value;
      index += 1;
      continue;
    }

    if (action === "list" && flag === "--fail-on-expired") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      failOnExpired = true;
      continue;
    }

    if (action === "list" && flag === "--fail-on-invalid") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      failOnInvalid = true;
      continue;
    }

    if (action === "list" && flag === "--warn-expiring-within-days") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing days after --warn-expiring-within-days.",
          showUsage: false
        };
      }

      if (!/^\d+$/.test(value)) {
        return {
          message: "--warn-expiring-within-days must be a non-negative integer.",
          showUsage: false
        };
      }

      const parsedDays = Number(value);

      if (!Number.isSafeInteger(parsedDays)) {
        return {
          message: "--warn-expiring-within-days must be a non-negative integer.",
          showUsage: false
        };
      }

      warnExpiringWithinDays = parsedDays;
      index += 1;
      continue;
    }

    if (action === "prune" && flag === "--apply") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      apply = true;
      continue;
    }

    if (action === "add" && flag === "--fingerprint") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing fingerprint after --fingerprint.",
          showUsage: false
        };
      }

      fingerprint = value;
      index += 1;
      continue;
    }

    if (action === "add" && flag === "--reason") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing reason after --reason.",
          showUsage: false
        };
      }

      reason = value;
      index += 1;
      continue;
    }

    if (action === "add" && flag === "--expires-at") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing date after --expires-at.",
          showUsage: false
        };
      }

      expiresAt = value;
      index += 1;
      continue;
    }

    if (action === "remove" && flag === "--fingerprint") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing fingerprint after --fingerprint.",
          showUsage: false
        };
      }

      fingerprint = value;
      index += 1;
      continue;
    }

    if (action === "remove" && flag === "--index") {
      const duplicateError = markSeenFlag(flag);

      if (duplicateError) {
        return duplicateError;
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return {
          message: "Missing value after --index.",
          showUsage: false
        };
      }

      indexValue = value;
      index += 1;
      continue;
    }

    return {
      message: `Unknown suppress flag: ${flag}.`,
      showUsage: false
    };
  }

  if (action === "list") {
    return {
      action,
      targetPath,
      configPath,
      jsonOutput,
      failOnExpired,
      failOnInvalid,
      warnExpiringWithinDays
    };
  }

  if (action === "prune") {
    return {
      action,
      targetPath,
      configPath,
      jsonOutput,
      apply
    };
  }

  if (action === "add") {
    const suppliedFlagCount = [fingerprint, reason, expiresAt].filter(
      (value) => value !== null
    ).length;

    if (suppliedFlagCount === 0) {
      return {
        action,
        targetPath,
        configPath,
        jsonOutput,
        interactive: true
      };
    }

    if (suppliedFlagCount !== 3 || !fingerprint || !reason || !expiresAt) {
      return {
        message:
          "suppress add requires --fingerprint, --reason, and --expires-at together.",
        showUsage: false
      };
    }

    return {
      action,
      targetPath,
      configPath,
      jsonOutput,
      interactive: false,
      fingerprint,
      reason,
      expiresAt
    };
  }

  if (fingerprint && indexValue !== null) {
    return {
      message: "Use exactly one of --index or --fingerprint for suppress remove.",
      showUsage: false
    };
  }

  if (!fingerprint && indexValue === null) {
    return {
      action,
      targetPath,
      configPath,
      jsonOutput,
      interactive: true
    };
  }

  if (indexValue !== null) {
    if (!/^\d+$/.test(indexValue)) {
      return {
        message: "--index must be a non-negative integer.",
        showUsage: false
      };
    }

    const parsedIndex = Number(indexValue);

    if (!Number.isSafeInteger(parsedIndex)) {
      return {
        message: "--index must be a non-negative integer.",
        showUsage: false
      };
    }

    return {
      action,
      targetPath,
      configPath,
      jsonOutput,
      interactive: false,
      selector: {
        type: "index",
        index: parsedIndex
      }
    };
  }

  return {
    action,
    targetPath,
    configPath,
    jsonOutput,
    interactive: false,
    selector: {
      type: "fingerprint",
      fingerprint: fingerprint!
    }
  };
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function defaultSuppressionExpiry(now: Date): string {
  const expiry = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  expiry.setDate(expiry.getDate() + 30);
  return formatLocalDate(expiry);
}

function parseSuppressionDateUtcStart(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);

  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
    ? timestamp
    : null;
}

function listExpiringSuppressionIndexes(
  suppressions: ReturnType<typeof listSuppressions>,
  now: Date,
  withinDays: number
): number[] {
  const dayMs = 24 * 60 * 60 * 1000;
  const todayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const cutoffUtc = todayUtc + withinDays * dayMs;

  return suppressions.flatMap((suppression) => {
    if (suppression.status !== "active" || !suppression.expiresAt) {
      return [];
    }

    const expiresAtUtc = parseSuppressionDateUtcStart(suppression.expiresAt);

    return expiresAtUtc !== null &&
      expiresAtUtc >= todayUtc &&
      expiresAtUtc <= cutoffUtc
      ? [suppression.index]
      : [];
  });
}

function parseInteractiveSelection(answer: string, count: number): number | null {
  const trimmed = answer.trim();

  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const selection = Number(trimmed);
  return Number.isSafeInteger(selection) && selection >= 1 && selection <= count
    ? selection - 1
    : null;
}

function renderInteractiveFindingCandidates(
  findings: Array<{
    severity: string;
    id: string;
    message: string;
    fingerprint?: string;
  }>
): string {
  return findings
    .map(
      (finding, index) =>
        `[${index + 1}] ${finding.severity.toUpperCase()} ${finding.id} - ${finding.message}\n    ${finding.fingerprint}`
    )
    .join("\n");
}

function renderInteractiveSuppressionCandidates(
  suppressions: ReturnType<typeof listSuppressions>
): string {
  return suppressions
    .map((suppression, selectionIndex) => {
      const prefix =
        `[${selectionIndex + 1}] ${suppression.status.toUpperCase()} config index ${suppression.index}`;

      return suppression.status === "invalid"
        ? `${prefix} ${suppression.invalidField}`
        : `${prefix} ${suppression.fingerprint}`;
    })
    .join("\n");
}

async function executeSuppressCommand(
  command: ParsedSuppressCommand,
  io: CliIo,
  options: {
    runCheckImpl?: typeof runCheck;
    writeRawDoctorConfigImpl?: typeof writeRawDoctorConfig;
    now?: () => Date;
  } = {}
): Promise<number> {
  const writeConfig = options.writeRawDoctorConfigImpl ?? writeRawDoctorConfig;

  if (
    (command.action === "add" || command.action === "remove") &&
    command.interactive
  ) {
    if (command.jsonOutput) {
      io.writeStderr(`Interactive suppress ${command.action} does not support --json.`);
      return 2;
    }

    if (!io.readStdin) {
      io.writeStderr(`Interactive suppress ${command.action} requires stdin input.`);
      return 2;
    }
  }

  try {
    const rawConfig = await readRawDoctorConfig(command.targetPath, command.configPath);
    const now = options.now?.() ?? new Date();

    if (command.action === "list") {
      const suppressions = listSuppressions(rawConfig.value, now);
      const expiredCount = suppressions.filter(
        (suppression) => suppression.status === "expired"
      ).length;
      const invalidCount = suppressions.filter(
        (suppression) => suppression.status === "invalid"
      ).length;

      io.writeStdout(
        command.jsonOutput
          ? renderSuppressionListJson(rawConfig.configPath, suppressions)
          : renderSuppressionList(rawConfig.configPath, suppressions)
      );

      if (command.warnExpiringWithinDays !== null) {
        const expiringIndexes = listExpiringSuppressionIndexes(
          suppressions,
          now,
          command.warnExpiringWithinDays
        );

        if (expiringIndexes.length > 0) {
          io.writeStderr(
            `Warning: ${expiringIndexes.length} suppression(s) expire within ${command.warnExpiringWithinDays} day(s): indexes ${expiringIndexes.join(", ")}.`
          );
        }
      }

      return (command.failOnExpired && expiredCount > 0) ||
        (command.failOnInvalid && invalidCount > 0)
        ? 1
        : 0;
    }

    if (command.action === "prune") {
      const result = pruneSuppressions(rawConfig.value, now);

      if (command.apply && result.removed.length > 0) {
        await writeConfig(rawConfig.configPath, result.config);
      }

      io.writeStdout(
        command.jsonOutput
          ? renderSuppressionPruneJson(rawConfig.configPath, result, {
              applied: command.apply
            })
          : renderSuppressionPrune(rawConfig.configPath, result, {
              applied: command.apply
            })
      );
      return 0;
    }

    if (command.action === "add") {
      if (command.interactive) {
        listSuppressions(rawConfig.value, now);
        const configuredResult = applyDoctorConfig(
          await (options.runCheckImpl ?? runCheck)(command.targetPath),
          await loadDoctorConfig(command.targetPath, command.configPath),
          { now }
        );
        const candidates = configuredResult.findings.filter(
          (finding) =>
            Boolean(finding.fingerprint) &&
            !finding.id.startsWith("suppression.")
        );

        if (candidates.length === 0) {
          io.writeStderr("No active fingerprinted findings are available to suppress.");
          return 1;
        }

        io.writeStdout(renderInteractiveFindingCandidates(candidates));
        const selection = parseInteractiveSelection(
          await io.readStdin!("Select finding to suppress: "),
          candidates.length
        );

        if (selection === null) {
          io.writeStderr(`Selection must be a number from 1 to ${candidates.length}.`);
          return 2;
        }

        const reason = (await io.readStdin!("Reason: ")).trim();

        if (!reason) {
          io.writeStderr("Suppression reason must not be blank.");
          return 2;
        }

        const defaultExpiry = defaultSuppressionExpiry(now);
        const expiryAnswer = (
          await io.readStdin!(`Expiration date [${defaultExpiry}]: `)
        ).trim();
        const result = addSuppression(rawConfig.value, {
          fingerprint: candidates[selection].fingerprint,
          reason,
          expiresAt: expiryAnswer || defaultExpiry
        });
        const confirmation = await io.readStdin!("Type yes to confirm: ");

        if (confirmation.trim().toLowerCase() !== "yes") {
          io.writeStdout("Suppression add cancelled.");
          return 0;
        }

        await writeConfig(rawConfig.configPath, result.config);
        io.writeStdout(
          renderSuppressionMutation("suppress.add", rawConfig.configPath, result)
        );
        return 0;
      }

      const result = addSuppression(rawConfig.value, {
        fingerprint: command.fingerprint,
        reason: command.reason,
        expiresAt: command.expiresAt
      });

      await writeConfig(rawConfig.configPath, result.config);
      io.writeStdout(
        command.jsonOutput
          ? renderSuppressionMutationJson("suppress.add", rawConfig.configPath, result)
          : renderSuppressionMutation("suppress.add", rawConfig.configPath, result)
      );
      return 0;
    }

    if (command.interactive) {
      const suppressions = listSuppressions(rawConfig.value, now);

      if (suppressions.length === 0) {
        io.writeStderr("No suppressions are available to remove.");
        return 1;
      }

      io.writeStdout(renderInteractiveSuppressionCandidates(suppressions));
      const selection = parseInteractiveSelection(
        await io.readStdin!("Select suppression to remove: "),
        suppressions.length
      );

      if (selection === null) {
        io.writeStderr(`Selection must be a number from 1 to ${suppressions.length}.`);
        return 2;
      }

      const result = removeSuppressionByIndex(
        rawConfig.value,
        suppressions[selection].index
      );
      const confirmation = await io.readStdin!("Type yes to confirm: ");

      if (confirmation.trim().toLowerCase() !== "yes") {
        io.writeStdout("Suppression remove cancelled.");
        return 0;
      }

      await writeConfig(rawConfig.configPath, result.config);
      io.writeStdout(
        renderSuppressionMutation("suppress.remove", rawConfig.configPath, result)
      );
      return 0;
    }

    const result = command.selector.type === "index"
      ? removeSuppressionByIndex(rawConfig.value, command.selector.index)
      : removeSuppressionByFingerprint(rawConfig.value, command.selector.fingerprint);

    await writeConfig(rawConfig.configPath, result.config);
    io.writeStdout(
      command.jsonOutput
        ? renderSuppressionMutationJson("suppress.remove", rawConfig.configPath, result)
        : renderSuppressionMutation("suppress.remove", rawConfig.configPath, result)
    );
    return 0;
  } catch (error) {
    io.writeStderr(error instanceof Error ? error.message : "Unknown suppression command error.");
    return command.action === "add" &&
      command.interactive &&
      error instanceof SuppressionManagementError &&
      error.code === "suppression_invalid_record"
      ? 2
      : 1;
  }
}

function buildGenericMcpDoctorCommandArgs(commandTarget: string, flags: string[]): {
  targetPath: string;
  jsonOutput: boolean;
  outputPath: string | null;
  runtime: boolean;
  allowNetwork: boolean;
  allowLocalNetwork: boolean;
  allowSessionLifecycle: boolean;
  requireRemoteReliability: boolean;
} | string {
  if (!commandTarget || commandTarget.startsWith("--")) {
    return "Missing target path. Usage: codex-plugin-doctor mcp <path> [--runtime] [--json] [--output <path>]";
  }

  let jsonOutput = false;
  let outputPath: string | null = null;
  let runtime = false;
  let allowNetwork = false;
  let allowLocalNetwork = false;
  let allowSessionLifecycle = false;
  let requireRemoteReliability = false;

  for (let index = 0; index < flags.length; index += 1) {
    const flag = flags[index];

    if (flag === "--runtime") {
      if (runtime) {
        return "Duplicate MCP flag: --runtime.";
      }

      runtime = true;
      continue;
    }

    if (flag === "--json") {
      if (jsonOutput) {
        return "Duplicate MCP flag: --json.";
      }

      jsonOutput = true;
      continue;
    }

    if (flag === "--allow-network") {
      if (allowNetwork) return "Duplicate MCP flag: --allow-network.";
      allowNetwork = true;
      continue;
    }

    if (flag === "--allow-local-network") {
      if (allowLocalNetwork) return "Duplicate MCP flag: --allow-local-network.";
      allowLocalNetwork = true;
      continue;
    }

    if (flag === "--allow-session-lifecycle") {
      if (flags[index + 1] && !flags[index + 1]!.startsWith("--")) {
        return "--allow-session-lifecycle does not accept a value.";
      }
      allowSessionLifecycle = true;
      continue;
    }

    if (flag === "--require-remote-reliability") {
      if (flags[index + 1] && !flags[index + 1]!.startsWith("--")) {
        return "--require-remote-reliability does not accept a value.";
      }
      requireRemoteReliability = true;
      continue;
    }

    if (
      flag.startsWith("--allow-network=") ||
      flag.startsWith("--allow-local-network=") ||
      flag.startsWith("--allow-session-lifecycle=") ||
      flag.startsWith("--require-remote-reliability=")
    ) {
      return `${flag.split("=", 1)[0]} does not accept a value.`;
    }

    if (flag === "--output") {
      if (outputPath !== null) {
        return "Duplicate MCP flag: --output.";
      }

      const value = flags[index + 1];

      if (!value || value.startsWith("--")) {
        return "Missing path after --output.";
      }

      outputPath = value;
      index += 1;
      continue;
    }

    return flag.startsWith("--")
      ? `Unknown MCP flag: ${flag}.`
      : `Unexpected MCP argument: ${flag}.`;
  }

  const remoteNetwork = parseRemoteNetworkFlags(flags, runtime);

  if (remoteNetwork instanceof CliUsageError) {
    return remoteNetwork.message;
  }

  return {
    targetPath: commandTarget,
    jsonOutput,
    outputPath,
    runtime,
    allowNetwork: remoteNetwork.allowNetwork,
    allowLocalNetwork: remoteNetwork.allowLocalNetwork,
    allowSessionLifecycle,
    requireRemoteReliability
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  try {
    const response = await fetch("https://registry.npmjs.org/codex-plugin-doctor", {
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`npm registry returned ${response.status}`);
    }

    const data = await response.json() as { "dist-tags"?: { latest?: string } };
    const latestVersion = data["dist-tags"]?.latest;

    if (!latestVersion) {
      throw new Error("npm registry response did not include dist-tags.latest");
    }

    return latestVersion;
  } finally {
    clearTimeout(timeout);
  }
}

async function uploadGitHubReleaseAsset(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      args,
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

function parseSubmissionCommandArgs(args: string[]): {
  targetPath: string;
  jsonOutput: boolean;
  markdownOutput: boolean;
  outputPath: string | null;
  requireReady: boolean;
} | CliUsageError {
  let targetPath: string | null = null;
  let jsonOutput = false;
  let markdownOutput = false;
  let outputPath: string | null = null;
  let requireReady = false;

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];

    if (argument === "--json") {
      if (jsonOutput) return new CliUsageError("Duplicate submission flag: --json.");
      jsonOutput = true;
    } else if (argument === "--markdown") {
      if (markdownOutput) return new CliUsageError("Duplicate submission flag: --markdown.");
      markdownOutput = true;
    } else if (argument === "--require-ready") {
      if (requireReady) return new CliUsageError("Duplicate submission flag: --require-ready.");
      requireReady = true;
    } else if (argument === "--output") {
      if (outputPath !== null) return new CliUsageError("Duplicate submission flag: --output.");
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return new CliUsageError("Missing path after --output.");
      outputPath = value;
      index += 1;
    } else if (argument.startsWith("--")) {
      return new CliUsageError(`Unknown submission flag: ${argument}.`);
    } else if (targetPath === null) {
      targetPath = argument;
    } else {
      return new CliUsageError(`Unexpected submission argument: ${argument}.`);
    }
  }

  if (targetPath === null) return new CliUsageError("Missing target path for submission.");
  if (jsonOutput && markdownOutput) return new CliUsageError("Use either --json or --markdown, not both.");
  return { targetPath, jsonOutput, markdownOutput, outputPath, requireReady };
}

export async function runCli(
  args: string[],
  io: CliIo = defaultIo,
  options: RunCliOptions = {}
): Promise<number> {
  const [command, maybePath, ...remainingArgs] = args;
  const runtimeSandboxSupported =
    (command === "check" &&
      !args.includes("--installed") &&
      !args.includes("--changed-since")) ||
    (command === "release" && maybePath === "check") ||
    (command === "doctor" &&
      (
        ["runtime-plan", "runtime-policy"].includes(maybePath ?? "") ||
        (maybePath === "release-evidence" && remainingArgs[0] !== "verify")
      ));

  if (args.includes("--sandbox") && !runtimeSandboxSupported) {
    io.writeStderr(
      "--sandbox is supported only by single-package check, release check, runtime-plan, runtime-policy, and release-evidence."
    );
    return 2;
  }

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

  if (command === "baseline") {
    if (maybePath !== "create") {
      io.writeStderr("Usage: codex-plugin-doctor baseline create <path> --output <path> [--runtime]");
      return 2;
    }

    const targetPath = remainingArgs[0];
    const baselineFlags = remainingArgs.slice(1);
    const outputIndex = baselineFlags.indexOf("--output");
    const outputPath = outputIndex === -1 ? null : baselineFlags[outputIndex + 1];

    if (!targetPath || targetPath.startsWith("--")) {
      io.writeStderr("Missing target path for baseline create.");
      return 2;
    }

    if (!outputPath || outputPath.startsWith("--")) {
      io.writeStderr("baseline create requires --output <path>.");
      return 2;
    }

    const result = await (options.runCheckImpl ?? runCheck)(targetPath, {
      runtime: baselineFlags.includes("--runtime")
    });
    const baseline = buildValidationBaseline(result);
    await writeValidationBaseline(outputPath, baseline);
    io.writeStdout(`Baseline created: ${path.resolve(outputPath)}\nFindings: ${baseline.findings.length}`);
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

    if (maybePath === "submission") {
      const parsedSubmissionArgs = parseSubmissionCommandArgs(remainingArgs);

      if (parsedSubmissionArgs instanceof CliUsageError) {
        io.writeStderr(parsedSubmissionArgs.message);
        return 2;
      }

      const report = await buildSubmissionPreflight(parsedSubmissionArgs.targetPath);
      const renderedReport = parsedSubmissionArgs.jsonOutput
        ? renderSubmissionPreflightJson(report)
        : parsedSubmissionArgs.markdownOutput
          ? renderSubmissionPreflightMarkdown(report)
          : renderSubmissionPreflightText(report);

      if (parsedSubmissionArgs.outputPath) {
        await writeFile(parsedSubmissionArgs.outputPath, renderedReport, "utf8");
      }

      writeExactStdout(io, renderedReport);
      return submissionPreflightExitCode(report, parsedSubmissionArgs.requireReady);
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
      }, {
        runtime: parsedMcpArgs.runtime,
        allowNetwork: parsedMcpArgs.allowNetwork,
        allowLocalNetwork: parsedMcpArgs.allowLocalNetwork,
        allowSessionLifecycle: parsedMcpArgs.allowSessionLifecycle,
        requireRemoteReliability: parsedMcpArgs.requireRemoteReliability
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
      let runtimeSandbox: RuntimeSandboxMode | null;

      try {
        runtimeSandbox = parseRuntimeSandbox(runtimePlanFlags, { requireRuntime: false });
      } catch (error) {
        io.writeStderr((error as CliUsageError).message);
        return 2;
      }

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

      const plan = await buildDoctorRuntimePlan(
        targetPath,
        new Date().toISOString(),
        runtimeSandbox ? { sandbox: runtimeSandbox } : {}
      );
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
      let runtimeSandbox: RuntimeSandboxMode | null;

      try {
        runtimeSandbox = parseRuntimeSandbox(runtimePolicyFlags, { requireRuntime: false });
      } catch (error) {
        io.writeStderr((error as CliUsageError).message);
        return 2;
      }

      if (!targetPath) {
        io.writeStderr("Missing target path for runtime policy.");
        return 2;
      }

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      const report = await buildDoctorRuntimePolicyReport(
        targetPath,
        new Date().toISOString(),
        runtimeSandbox ? { sandbox: runtimeSandbox } : {}
      );
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
        const failuresOnly = verifyFlags.includes("--failures-only");
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
          : renderDoctorReviewBundleVerification(report, { failuresOnly });

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
        const runtime = assetFlags.includes("--runtime");
        const remoteNetwork = parseRemoteNetworkFlags(assetFlags, runtime);
        let runtimeSandbox: RuntimeSandboxMode | null;

        if (remoteNetwork instanceof CliUsageError) {
          io.writeStderr(remoteNetwork.message);
          return 2;
        }

        try {
          runtimeSandbox = parseRuntimeSandbox(assetFlags);
        } catch (error) {
          io.writeStderr((error as CliUsageError).message);
          return 2;
        }

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
          runtime,
          ...(remoteNetwork.allowNetwork ? { allowNetwork: true } : {}),
          ...(remoteNetwork.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
          ...(remoteNetwork.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
          ...(remoteNetwork.requireRemoteReliability ? { requireRemoteReliability: true } : {}),
          ...(runtimeSandbox ? { sandbox: runtimeSandbox } : {}),
          environment: {
            env: terminalContext.env,
            platform: terminalContext.platform
          },
          runCheck: options.runCheckImpl ?? runCheck,
          performanceThresholds: parsedThresholds.thresholds
        });

        if (!evidence.releaseReady) {
          io.writeStdout(jsonOutput ? renderDoctorReleaseEvidenceJson(evidence) : renderDoctorReleaseEvidence(evidence));
          return evidence.exitCode;
        }
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
      const runtime = evidenceFlags.includes("--runtime");
      const remoteNetwork = parseRemoteNetworkFlags(evidenceFlags, runtime);
      let runtimeSandbox: RuntimeSandboxMode | null;

      if (remoteNetwork instanceof CliUsageError) {
        io.writeStderr(remoteNetwork.message);
        return 2;
      }

      try {
        runtimeSandbox = parseRuntimeSandbox(evidenceFlags);
      } catch (error) {
        io.writeStderr((error as CliUsageError).message);
        return 2;
      }

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
        runtime,
        ...(remoteNetwork.allowNetwork ? { allowNetwork: true } : {}),
        ...(remoteNetwork.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
        ...(remoteNetwork.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
        ...(remoteNetwork.requireRemoteReliability ? { requireRemoteReliability: true } : {}),
        ...(runtimeSandbox ? { sandbox: runtimeSandbox } : {}),
        environment: {
          env: terminalContext.env,
          platform: terminalContext.platform
        },
        runCheck: options.runCheckImpl ?? runCheck,
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
      if (remainingArgs[0] === "metrics") {
        const metricsArgs = remainingArgs.slice(1);
        if (metricsArgs[0] === "diff") {
          const diffArgs = metricsArgs.slice(1);
          const jsonOutput = diffArgs.includes("--json");
          const markdownOutput = diffArgs.includes("--markdown");
          const failOnRegression = diffArgs.includes("--fail-on-regression");
          const valueOptions = new Map<string, string>();
          const valueFlags = new Set(["--before", "--after", "--output"]);
          const booleanFlags = new Set(["--json", "--markdown", "--fail-on-regression"]);

          for (let index = 0; index < diffArgs.length; index += 1) {
            const argument = diffArgs[index];
            if (booleanFlags.has(argument)) continue;
            if (!valueFlags.has(argument)) {
              io.writeStderr(`Unknown corpus metrics diff argument: ${argument}.`);
              return 2;
            }
            const value = diffArgs[index + 1];
            if (!value || value.startsWith("--")) {
              io.writeStderr(`Missing path after ${argument}.`);
              return 2;
            }
            valueOptions.set(argument, value);
            index += 1;
          }

          const beforePath = valueOptions.get("--before");
          const afterPath = valueOptions.get("--after");
          const outputPath = valueOptions.get("--output") ?? null;
          if (!beforePath || !afterPath) {
            io.writeStderr("Corpus metrics diff requires --before <metrics.json> and --after <metrics.json>.");
            return 2;
          }
          if (jsonOutput && markdownOutput) {
            io.writeStderr("Use either --json or --markdown, not both.");
            return 2;
          }

          let report;
          try {
            const builder = options.buildCorpusMetricsDiffReportImpl ?? buildCorpusQualityMetricsDiffReport;
            report = await builder(beforePath, afterPath, { failOnRegression });
          } catch (error) {
            if (error instanceof CorpusMetricsDiffError) {
              io.writeStderr(error.message);
              return 2;
            }
            const message = error instanceof Error ? error.message : "Unknown error";
            io.writeStderr(`Corpus metrics diff failed: ${message}`);
            return 2;
          }

          const rendered = jsonOutput
            ? renderCorpusQualityMetricsDiffJson(report)
            : markdownOutput
              ? renderCorpusQualityMetricsDiffMarkdown(report)
              : renderCorpusQualityMetricsDiffText(report, { outputPath });
          if (outputPath) await writeFile(outputPath, rendered, "utf8");
          io.writeStdout(rendered);
          return report.exitCode;
        }

        const jsonOutput = metricsArgs.includes("--json");
        const markdownOutput = metricsArgs.includes("--markdown");
        const valueOptions = new Map<string, string>();
        const knownValueFlags = new Set([
          "--manifest",
          "--output",
          "--min-precision",
          "--min-recall",
          "--max-false-positive-rate"
        ]);

        for (let index = 0; index < metricsArgs.length; index += 1) {
          const argument = metricsArgs[index];
          if (argument === "--json" || argument === "--markdown") continue;
          if (!knownValueFlags.has(argument)) {
            io.writeStderr(`Unknown corpus metrics argument: ${argument}.`);
            return 2;
          }
          const value = metricsArgs[index + 1];
          if (!value || value.startsWith("--")) {
            const label = argument === "--manifest"
              ? "path after --manifest"
              : argument === "--output"
                ? "path after --output"
                : `value after ${argument}`;
            io.writeStderr(`Missing ${label}.`);
            return 2;
          }
          valueOptions.set(argument, value);
          index += 1;
        }

        const manifestPath = valueOptions.get("--manifest");
        const outputPath = valueOptions.get("--output") ?? null;
        if (!manifestPath) {
          io.writeStderr("Corpus metrics requires --manifest <path>.");
          return 2;
        }
        if (jsonOutput && markdownOutput) {
          io.writeStderr("Use either --json or --markdown, not both.");
          return 2;
        }

        const thresholds: CorpusMetricThresholds = {};
        const thresholdFlags: Array<[string, keyof CorpusMetricThresholds]> = [
          ["--min-precision", "minPrecision"],
          ["--min-recall", "minRecall"],
          ["--max-false-positive-rate", "maxFalsePositiveRate"]
        ];
        for (const [flag, key] of thresholdFlags) {
          const raw = valueOptions.get(flag);
          if (raw === undefined) continue;
          const value = Number(raw);
          if (!Number.isFinite(value) || value < 0 || value > 1) {
            io.writeStderr(`${flag} must be between 0 and 1.`);
            return 2;
          }
          thresholds[key] = value;
        }

        let report;
        try {
          const builder = options.buildCorpusMetricsReportImpl ?? buildCorpusQualityMetricsReport;
          const buildOptions: BuildCorpusMetricsOptions = {
            thresholds,
            environment: {
              env: terminalContext.env,
              platform: terminalContext.platform
            }
          };
          report = await builder(manifestPath, buildOptions);
        } catch (error) {
          if (error instanceof CorpusMetricsManifestError) {
            io.writeStderr(error.message);
            return 2;
          }
          const message = error instanceof Error ? error.message : "Unknown error";
          io.writeStderr(`Corpus metrics analysis failed: ${message}`);
          return 2;
        }

        const rendered = jsonOutput
          ? renderCorpusQualityMetricsJson(report)
          : markdownOutput
            ? renderCorpusQualityMetricsMarkdown(report)
            : renderCorpusQualityMetricsText(report, { outputPath });
        if (outputPath) await writeFile(outputPath, rendered, "utf8");
        io.writeStdout(rendered);
        return report.exitCode;
      }

      const jsonOutput = remainingArgs.includes("--json");
      const outputIndex = remainingArgs.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : remainingArgs[outputIndex + 1];
      const manifestIndex = remainingArgs.indexOf("--manifest");
      const manifestPath = manifestIndex === -1 ? null : remainingArgs[manifestIndex + 1];

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
        return 2;
      }

      if (manifestIndex !== -1 && (!manifestPath || manifestPath.startsWith("--"))) {
        io.writeStderr("Missing path after --manifest.");
        return 2;
      }

      let report;
      try {
        report = manifestPath
          ? await buildExternalValidationCorpusReport(manifestPath, {
            environment: {
              env: terminalContext.env,
              platform: terminalContext.platform
            }
          })
          : await buildDoctorValidationCorpusReport({
            environment: {
              env: terminalContext.env,
              platform: terminalContext.platform
            }
          });
      } catch (error) {
        if (error instanceof ExternalCorpusManifestError) {
          io.writeStderr(error.message);
          return 2;
        }
        throw error;
      }
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

    if (maybePath === "size") {
      const sizeTarget = remainingArgs[0] && !remainingArgs[0].startsWith("--") ? remainingArgs[0] : ".";
      const sizeFlags = remainingArgs[0] && remainingArgs[0].startsWith("--")
        ? remainingArgs
        : remainingArgs.slice(1);
      const jsonOutput = sizeFlags.includes("--json");
      const npmPack = sizeFlags.includes("--npm");
      const report = await buildDoctorSize(sizeTarget, { npmPack });
      const output = jsonOutput
        ? renderDoctorSizeJson(report)
        : renderDoctorSize(report);

      io.writeStdout(output);
      return report.status === "fail" ? 1 : 0;
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

  if (command === "init-git-hooks") {
    const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
    const initFlags = maybePath && maybePath.startsWith("--")
      ? [maybePath, ...remainingArgs]
      : remainingArgs;
    const remove = initFlags.includes("--remove");
    const force = initFlags.includes("--force");
    const jsonOutput = initFlags.includes("--json");

    if (remove) {
      const removeResult = await removeGitHooks(targetPath);

      if (jsonOutput) {
        io.writeStdout(JSON.stringify({
          schemaVersion: "1.0.0",
          kind: "doctor.git.hooks.remove",
          rootPath: removeResult.rootPath,
          removed: removeResult.removed,
          skipped: removeResult.skipped
        }, null, 2));
        return 0;
      }

      const lines = ["Removed Codex Plugin Doctor git hooks", `Root: ${removeResult.rootPath}`];

      if (removeResult.removed.length > 0) {
        lines.push(`Removed: ${removeResult.removed.join(", ")}`);
      }

      if (removeResult.skipped.length > 0) {
        lines.push(`Skipped (not generated by doctor): ${removeResult.skipped.join(", ")}`);
      }

      if (removeResult.removed.length === 0 && removeResult.skipped.length === 0) {
        lines.push("No doctor-generated hooks found.");
      }

      io.writeStdout(lines.join("\n"));
      return 0;
    }

    if (force && remove) {
      io.writeStderr("Use either --force or --remove, not both.");
      return 2;
    }

    const result = await initGitHooks(targetPath, { force });

    if (jsonOutput) {
      io.writeStdout(JSON.stringify({
        schemaVersion: "1.0.0",
        kind: "doctor.git.hooks",
        rootPath: result.rootPath,
        hookPaths: result.hookPaths,
        preExisting: result.preExisting
      }, null, 2));
      return 0;
    }

    const overwritten = result.preExisting.length > 0
      ? `\nOverwritten existing hooks: ${result.preExisting.join(", ")}`
      : "";

    io.writeStdout(
      [
        "Initialized Codex Plugin Doctor git hooks",
        `Root: ${result.rootPath}`,
        `Hooks: ${result.hookPaths.join(", ")}`,
        overwritten
      ].filter(Boolean).join("\n")
    );
    return 0;
  }

  if (command === "watch") {
    const targetPath = maybePath && !maybePath.startsWith("--") ? maybePath : ".";
    const watchFlags = maybePath && maybePath.startsWith("--")
      ? [maybePath, ...remainingArgs]
      : remainingArgs;
    const runtime = watchFlags.includes("--runtime");
    const jsonOutput = watchFlags.includes("--json");
    const failFast = watchFlags.includes("--fail-fast");
    const outputIndex = watchFlags.indexOf("--output");
    const outputPath = outputIndex === -1 ? null : watchFlags[outputIndex + 1];
    const debounceIndex = watchFlags.indexOf("--debounce-ms");
    const debounceRaw = debounceIndex === -1 ? null : watchFlags[debounceIndex + 1];
    const debounceMs = debounceRaw ? Number(debounceRaw) || 300 : 300;
    const maxIterationsIndex = watchFlags.indexOf("--max-iterations");
    const maxIterationsRaw = maxIterationsIndex === -1 ? null : watchFlags[maxIterationsIndex + 1];
    const maxIterations = maxIterationsRaw ? Number(maxIterationsRaw) || 0 : 0;
    const accumulateIndex = watchFlags.indexOf("--accumulate-json");
    const accumulatePath = accumulateIndex === -1 ? null : watchFlags[accumulateIndex + 1];

    if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
      io.writeStderr("Missing path after --output.");
      return 2;
    }

    if (maxIterationsIndex !== -1 && (!maxIterationsRaw || maxIterationsRaw.startsWith("--"))) {
      io.writeStderr("Missing number after --max-iterations.");
      return 2;
    }

    if (accumulateIndex !== -1 && (!accumulatePath || accumulatePath.startsWith("--"))) {
      io.writeStderr("Missing path after --accumulate-json.");
      return 2;
    }

    const result = await watchPlugin({
      targetPath,
      debounceMs,
      runtime,
      jsonOutput,
      outputPath,
      maxIterations,
      failFast,
      accumulateJsonPath: accumulatePath
    });

    const reason = result.iterationsReached ? "max iterations reached" : "stopped";

    io.writeStdout(
      `\nStopped watching ${result.targetPath}: ${result.validations} validations, ${result.failures} failures (${reason}).`
    );
    return result.failures > 0 ? 1 : 0;
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

  if (command === "registry") {
    const subcommand = maybePath;
    const target = remainingArgs[0];
    const flags = remainingArgs.slice(1);
    if ((subcommand !== "check" && subcommand !== "inspect" && subcommand !== "preflight") || !target || target.startsWith("--")) {
      io.writeStderr(
        "Usage: codex-plugin-doctor registry check <server.json|directory> [--json] [--output <path>] [--require-registry-readiness]\n"
        + "       codex-plugin-doctor registry inspect <server-name> --allow-network [--json] [--output <path>] [--require-registry-readiness]\n"
        + "       codex-plugin-doctor registry preflight <server.json|directory> [--allow-network] [--json] [--output <path>] [--require-publish-ready]"
      );
      return 2;
    }

    const allowedFlags = new Set([
      "--json",
      "--output",
      "--allow-network",
      "--require-registry-readiness",
      "--require-publish-ready"
    ]);
    let outputPath: string | null = null;
    for (let index = 0; index < flags.length; index += 1) {
      const flag = flags[index];
      if (!allowedFlags.has(flag)) {
        io.writeStderr(`Unknown registry flag: ${flag}.`);
        return 2;
      }
      if (flag === "--output") {
        const value = flags[index + 1];
        if (!value || value.startsWith("--")) {
          io.writeStderr("Missing path after --output.");
          return 2;
        }
        outputPath = value;
        index += 1;
      }
    }

    const allowNetwork = flags.includes("--allow-network");
    if (subcommand === "check" && allowNetwork) {
      io.writeStderr("--allow-network is not supported by registry check.");
      return 2;
    }
    if (subcommand === "inspect" && !allowNetwork) {
      io.writeStderr("registry inspect requires explicit --allow-network consent.");
      return 2;
    }
    if (subcommand === "preflight" && flags.includes("--require-registry-readiness")) {
      io.writeStderr("--require-registry-readiness is supported only by registry check or registry inspect.");
      return 2;
    }
    if (subcommand !== "preflight" && flags.includes("--require-publish-ready")) {
      io.writeStderr("--require-publish-ready is supported only by registry preflight.");
      return 2;
    }

    try {
      if (subcommand === "preflight") {
        const report = await buildMcpRegistryPublicationPreflight(target, { allowNetwork });
        const rendered = flags.includes("--json")
          ? renderMcpRegistryPublicationPreflightJson(report)
          : renderMcpRegistryPublicationPreflight(report);
        if (outputPath) {
          await writeFile(outputPath, rendered, "utf8");
        }
        io.writeStdout(rendered);
        return registryPublicationPreflightExitCode(report, flags.includes("--require-publish-ready"));
      }
      const report = subcommand === "check"
        ? await buildMcpRegistryReadiness(target)
        : await inspectMcpRegistryServer(target, { allowNetwork: true });
      const rendered = flags.includes("--json")
        ? renderMcpRegistryReadinessJson(report)
        : renderMcpRegistryReadiness(report);
      if (outputPath) {
        await writeFile(outputPath, rendered, "utf8");
      }
      io.writeStdout(rendered);
      return registryReadinessExitCode(report, flags.includes("--require-registry-readiness"));
    } catch (error) {
      if (subcommand === "preflight") {
        io.writeStderr("Registry publication preflight failed.");
      } else {
        io.writeStderr(`Registry inspection failed: ${(error as Error).message}`);
      }
      return 1;
    }
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
    }, {
      runtime: parsedMcpArgs.runtime,
      allowNetwork: parsedMcpArgs.allowNetwork,
      allowLocalNetwork: parsedMcpArgs.allowLocalNetwork,
      allowSessionLifecycle: parsedMcpArgs.allowSessionLifecycle,
      requireRemoteReliability: parsedMcpArgs.requireRemoteReliability
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
    if (maybePath === "deps") {
      const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--") ? remainingArgs[0] : ".";
      const depsFlags = remainingArgs[0] && remainingArgs[0].startsWith("--")
        ? remainingArgs
        : remainingArgs.slice(1);
      const jsonOutput = depsFlags.includes("--json");
      const sarifOutput = depsFlags.includes("--sarif");
      const recommendationsOutput = depsFlags.includes("--recommend");
      const outputIndex = depsFlags.indexOf("--output");
      const outputPath = outputIndex === -1 ? null : depsFlags[outputIndex + 1];
      const policyIndex = depsFlags.indexOf("--policy");
      const policyName = policyIndex === -1 ? null : depsFlags[policyIndex + 1];
      const policy = parsePolicyPack(policyName);

      if (outputIndex !== -1 && (!outputPath || outputPath.startsWith("--"))) {
        io.writeStderr("Missing path after --output.");
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

      if (jsonOutput && sarifOutput) {
        io.writeStderr("Use either --json or --sarif, not both.");
        return 2;
      }

      let report = await buildDepAudit(targetPath);

      if (policy) {
        report = applyPolicyToDepAudit(report, policy);
      }

      const renderedReport = sarifOutput
        ? renderDepAuditSarif(report)
        : jsonOutput
          ? renderDepAuditJson(report, { recommendations: recommendationsOutput })
          : renderDepAudit(report, { recommendations: recommendationsOutput });

      if (outputPath) {
        await writeFile(outputPath, renderedReport, "utf8");
      }

      io.writeStdout(renderedReport);
      return report.status === "fail" ? 1 : 0;
    }

    const auditFlags = maybePath ? [maybePath, ...remainingArgs] : remainingArgs;
    const installed = auditFlags.includes("--installed");

    if (!installed) {
      io.writeStderr(
        "Usage: codex-plugin-doctor audit --installed [filter] [--security] [--compat] [--json] [--output <path>] [--cache] [--changed]\n       codex-plugin-doctor audit deps <path> [--policy codex-publish|mcp-strict|security] [--json|--sarif] [--output <path>]"
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

  if (command === "completion") {
    const shell = maybePath as string;

    if (!shell || !["bash", "zsh", "fish"].includes(shell)) {
      io.writeStderr("Usage: codex-plugin-doctor completion bash|zsh|fish");
      return 2;
    }

    io.writeStdout(generateCompletion(shell as "bash" | "zsh" | "fish"));
    return 0;
  }

  if (command === "config") {
    const subCommand = maybePath;

    if (subCommand !== "validate") {
      io.writeStderr("Usage: codex-plugin-doctor config validate <path> [--json]");
      return 2;
    }

    const configPath = remainingArgs[0] && !remainingArgs[0].startsWith("--") ? remainingArgs[0] : ".codex-doctor.json";
    const configFlags = remainingArgs[0] && remainingArgs[0].startsWith("--")
      ? remainingArgs
      : remainingArgs.slice(1);
    const jsonOutput = configFlags.includes("--json");

    const report = await validateConfigFile(configPath);
    const output = jsonOutput
      ? renderConfigValidationJson(report)
      : renderConfigValidation(report);

    io.writeStdout(output);
    return report.status === "fail" ? 1 : 0;
  }

  if (command === "release") {
    const subCommand = maybePath;

    if (subCommand !== "check") {
      io.writeStderr("Usage: codex-plugin-doctor release check <path> [--json] [--runtime] [--require-runtime-approval --runtime-approval-digest <digest>]");
      return 2;
    }

    const targetPath = remainingArgs[0] && !remainingArgs[0].startsWith("--") ? remainingArgs[0] : ".";
    const releaseFlags = remainingArgs[0] && remainingArgs[0].startsWith("--")
      ? remainingArgs
      : remainingArgs.slice(1);
    const jsonOutput = releaseFlags.includes("--json");
    const runtimeProbeEnabled = releaseFlags.includes("--runtime");
    const remoteNetwork = parseRemoteNetworkFlags(releaseFlags, runtimeProbeEnabled);
    let runtimeSandbox: RuntimeSandboxMode | null;

    if (remoteNetwork instanceof CliUsageError) {
      io.writeStderr(remoteNetwork.message);
      return 2;
    }

    try {
      runtimeSandbox = parseRuntimeSandbox(releaseFlags);
    } catch (error) {
      io.writeStderr((error as CliUsageError).message);
      return 2;
    }

    const requireRuntimeApproval = releaseFlags.includes("--require-runtime-approval");
    const runtimeApprovalDigestIndex = releaseFlags.indexOf("--runtime-approval-digest");
    const runtimeApprovalDigest = runtimeApprovalDigestIndex === -1
      ? null
      : releaseFlags[runtimeApprovalDigestIndex + 1];

    if (requireRuntimeApproval && !runtimeProbeEnabled) {
      io.writeStderr("Runtime approval requires --runtime.");
      return 2;
    }

    if (
      runtimeApprovalDigestIndex !== -1 &&
      (!runtimeApprovalDigest || runtimeApprovalDigest.startsWith("--"))
    ) {
      io.writeStderr("Missing digest after --runtime-approval-digest.");
      return 2;
    }

    if (requireRuntimeApproval) {
      const runtimePlan = await buildDoctorRuntimePlan(
        targetPath,
        new Date().toISOString(),
        runtimeSandbox ? { sandbox: runtimeSandbox } : {}
      );
      const approval = evaluateRuntimeApproval(runtimePlan, {
        required: true,
        approvedDigest: runtimeApprovalDigest
      });

      if (!runtimeApprovalPassed(approval)) {
        io.writeStderr(`${approval.message}\nCurrent runtime plan digest: ${runtimePlan.digest}`);
        return 1;
      }
    }

    const report = await buildReleaseCheck(targetPath, {
      env: terminalContext.env,
      platform: terminalContext.platform,
      runtime: runtimeProbeEnabled,
      ...(remoteNetwork.allowNetwork ? { allowNetwork: true } : {}),
      ...(remoteNetwork.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
      ...(remoteNetwork.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
      ...(remoteNetwork.requireRemoteReliability ? { requireRemoteReliability: true } : {}),
      ...(runtimeSandbox ? { runtimeSandbox } : {}),
      runCheck: options.runCheckImpl
    });
    const output = jsonOutput
      ? renderReleaseCheckJson(report)
      : renderReleaseCheck(report);

    io.writeStdout(output);
    return report.status === "fail" ? 1 : 0;
  }

  if (command === "suppress") {
    const parsedSuppressCommand = parseSuppressCommand([maybePath ?? "", ...remainingArgs]);

    if ("message" in parsedSuppressCommand) {
      io.writeStderr(parsedSuppressCommand.message);

      if (parsedSuppressCommand.showUsage) {
        printSuppressUsage(io);
      }

      return 2;
    }

    return executeSuppressCommand(
      parsedSuppressCommand,
      io,
      {
        runCheckImpl: options.runCheckImpl,
        writeRawDoctorConfigImpl: options.writeRawDoctorConfigImpl,
        now: options.now
      }
    );
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

  let runtimeSandbox: RuntimeSandboxMode | null;

  try {
    runtimeSandbox = parseRuntimeSandbox(normalizedFlags);
  } catch (error) {
    io.writeStderr((error as CliUsageError).message);
    return 2;
  }

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
  const changedSinceIndex = normalizedFlags.indexOf("--changed-since");
  const changedSinceRef = changedSinceIndex === -1 ? null : normalizedFlags[changedSinceIndex + 1];
  const failOnRules: string[] = [];

  for (let i = 0; i < normalizedFlags.length; i += 1) {
    if (normalizedFlags[i] === "--fail-on" && normalizedFlags[i + 1] && !normalizedFlags[i + 1].startsWith("--")) {
      failOnRules.push(normalizedFlags[i + 1]);
      i += 1;
    }
  }
  const baselineIndex = normalizedFlags.indexOf("--baseline");
  const baselinePath = baselineIndex === -1 ? null : normalizedFlags[baselineIndex + 1];

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

  if (changedSinceIndex !== -1 && (!changedSinceRef || changedSinceRef.startsWith("--"))) {
    io.writeStderr("Missing ref after --changed-since.");
    return 2;
  }

  if (changedSinceIndex !== -1 && checkInstalled) {
    io.writeStderr("--changed-since requires a single package target.");
    return 2;
  }

  if (baselineIndex !== -1 && (!baselinePath || baselinePath.startsWith("--"))) {
    io.writeStderr("Missing path after --baseline.");
    return 2;
  }

  if (baselinePath && checkInstalled) {
    io.writeStderr("Baseline gating requires a single package target.");
    return 2;
  }

  if (baselinePath && changedSinceRef) {
    io.writeStderr("Use either --baseline or --changed-since, not both.");
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
  const remoteNetwork = parseRemoteNetworkFlags(normalizedFlags, effectiveRuntimeProbeEnabled);

  if (remoteNetwork instanceof CliUsageError) {
    io.writeStderr(remoteNetwork.message);
    return 2;
  }

  if (requireRuntimeApproval && !effectiveRuntimeProbeEnabled) {
    io.writeStderr("Runtime approval requires runtime probing. Add --runtime, --profile publish, or a runtime-enabled policy.");
    return 2;
  }

  if (checkInstalled && requireRuntimeApproval) {
    io.writeStderr("Runtime approval gating requires a single package target, not --installed.");
    return 2;
  }

  let baseline = null;

  if (baselinePath) {
    try {
      baseline = await readValidationBaseline(baselinePath);
    } catch (error) {
      io.writeStderr(`Invalid baseline file: ${(error as Error).message}`);
      return 2;
    }
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
    const runtimePlan = await buildDoctorRuntimePlan(
      targetPath,
      new Date().toISOString(),
      runtimeSandbox ? { sandbox: runtimeSandbox } : {}
    );
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
            ...(remoteNetwork.allowNetwork ? { allowNetwork: true } : {}),
            ...(remoteNetwork.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
            ...(remoteNetwork.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
            ...(remoteNetwork.requireRemoteReliability ? { requireRemoteReliability: true } : {}),
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

  if (changedSinceRef) {
    const { execFile } = await import("node:child_process");

    try {
      const gitOutput = await new Promise<string>((resolve, reject) => {
        execFile(
          "git",
          ["diff", "--name-only", `${changedSinceRef}...HEAD`],
          { cwd: path.resolve(targetPath) },
          (error, stdout, stderr) => {
            if (error) {
              reject(new Error(stderr.trim() || error.message));
              return;
            }
            resolve(stdout);
          }
        );
      });

      const changedFiles = gitOutput.split("\n").filter(Boolean);

      if (changedFiles.length === 0) {
        io.writeStdout("No changed files since the given ref.");
        return 0;
      }

      const changedDirs = new Set<string>();

      for (const file of changedFiles) {
        const dir = path.dirname(file);
        changedDirs.add(dir);
      }

      let allPassed = true;
      let validatedCount = 0;

      for (const dir of changedDirs) {
        const pluginRoot = path.resolve(targetPath, dir);
        const manifestPath = path.join(pluginRoot, ".codex-plugin", "plugin.json");

        try {
          await (await import("node:fs/promises")).stat(manifestPath);
        } catch {
          continue;
        }

        const pluginResult = applyDoctorConfig(
          await runCheckImpl(pluginRoot, {
            runtime: effectiveRuntimeProbeEnabled,
            ...(remoteNetwork.allowNetwork ? { allowNetwork: true } : {}),
            ...(remoteNetwork.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
            ...(remoteNetwork.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
            ...(remoteNetwork.requireRemoteReliability ? { requireRemoteReliability: true } : {})
          }),
          applyPolicyToDoctorConfig(
            applyCheckProfile(await loadDoctorConfig(pluginRoot, configPath), checkProfile),
            policy
          )
        );

        io.writeStdout(`\n${pluginResult.targetPath}: ${pluginResult.status.toUpperCase()}`);
        validatedCount += 1;

        if (pluginResult.status !== "pass") {
          allPassed = false;
          for (const finding of pluginResult.findings) {
            io.writeStdout(`  ${finding.severity === "fail" ? "FAIL" : "WARN"}  ${finding.id}: ${finding.message}`);
          }
        }
      }

      io.writeStdout(`\n\nValidated ${validatedCount} changed plugins.`);
      return allPassed ? 0 : 1;
    } catch (error) {
      io.writeStderr(`--changed-since requires a git repository. ${(error as Error).message}`);
      return 2;
    }
  }

  const doctorConfig = applyPolicyToDoctorConfig(
    applyCheckProfile(await loadDoctorConfig(targetPath, configPath), checkProfile),
    policy
  );
  const configuredResult = applyDoctorConfig(
    await runCheckImpl(targetPath, {
      runtime: effectiveRuntimeProbeEnabled,
      ...(remoteNetwork.allowNetwork ? { allowNetwork: true } : {}),
      ...(remoteNetwork.allowLocalNetwork ? { allowLocalNetwork: true } : {}),
      ...(remoteNetwork.allowSessionLifecycle ? { allowSessionLifecycle: true } : {}),
      ...(remoteNetwork.requireRemoteReliability ? { requireRemoteReliability: true } : {}),
      ...(runtimeSandbox ? { runtimeSandbox } : {}),
      ...(effectiveRuntimeProbeEnabled && verboseRuntime
        ? { runtimeTranscript: (line: string) => io.writeStderr(line) }
        : {})
    }),
    doctorConfig
  );
  const result = baseline
    ? applyValidationBaseline(configuredResult, baseline, {
        failOnWarnings: doctorConfig.failOnWarnings
      })
    : configuredResult;

  if (failOnRules.length > 0) {
    result.findings = result.findings.map((finding) => {
      if (finding.severity === "warn" && failOnRules.includes(finding.id)) {
        return { ...finding, severity: "fail" as const };
      }
      return finding;
    });

    const hasFail = result.findings.some((f) => f.severity === "fail");
    const hasWarn = result.findings.some((f) => f.severity === "warn");

    if (hasFail) {
      result.status = "fail";
      result.exitCode = 1;
    } else if (hasWarn) {
      result.status = "warn";
      result.exitCode = 0;
    } else {
      result.status = "pass";
      result.exitCode = 0;
    }
  }

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

