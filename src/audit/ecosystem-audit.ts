import type { CompatibilityEnvironment, CompatibilityMatrix } from "../compatibility/compatibility-matrix.js";
import { buildCompatibilityMatrix, matrixExitCode } from "../compatibility/compatibility-matrix.js";
import type { InstalledPlugin } from "../core/discover-installed-plugins.js";
import { discoverInstalledPlugins, filterInstalledPlugins } from "../core/discover-installed-plugins.js";
import type { CheckResult } from "../domain/types.js";
import type { SecurityAudit } from "../security/security-audit.js";
import { buildSecurityAudit } from "../security/security-audit.js";

export interface EcosystemAuditOptions {
  env?: Record<string, string | undefined>;
  platform?: NodeJS.Platform;
  filter?: string | null;
  includeSecurity?: boolean;
  includeCompatibility?: boolean;
  validatePlugin: (targetPath: string) => Promise<CheckResult>;
}

export interface EcosystemAuditPluginResult {
  plugin: InstalledPlugin;
  status: "pass" | "warn" | "fail";
  validation: CheckResult;
  security?: SecurityAudit;
  compatibility?: CompatibilityMatrix;
}

export interface EcosystemAuditReport {
  schemaVersion: "1.0.0";
  generatedAt: string;
  status: "pass" | "warn" | "fail";
  summary: {
    totalPlugins: number;
    pass: number;
    warn: number;
    fail: number;
  };
  plugins: EcosystemAuditPluginResult[];
  priorityActions: string[];
}

function mergeStatus(statuses: Array<"pass" | "warn" | "fail">): "pass" | "warn" | "fail" {
  if (statuses.includes("fail")) {
    return "fail";
  }

  if (statuses.includes("warn")) {
    return "warn";
  }

  return "pass";
}

function compatibilityStatus(matrix: CompatibilityMatrix | undefined): "pass" | "warn" | "fail" {
  if (!matrix) {
    return "pass";
  }

  if (matrixExitCode(matrix) === 1) {
    return "fail";
  }

  return matrix.results.some((result) => result.status === "warn") ? "warn" : "pass";
}

function summarizePlugins(plugins: EcosystemAuditPluginResult[]): EcosystemAuditReport["summary"] {
  return {
    totalPlugins: plugins.length,
    pass: plugins.filter((plugin) => plugin.status === "pass").length,
    warn: plugins.filter((plugin) => plugin.status === "warn").length,
    fail: plugins.filter((plugin) => plugin.status === "fail").length
  };
}

function buildPriorityActions(plugins: EcosystemAuditPluginResult[]): string[] {
  const actions: string[] = [];
  const cleanReason = (reason: string) => reason.replace(/[.。]+$/u, "");

  for (const plugin of plugins.filter((item) => item.status === "fail")) {
    const validationFinding = plugin.validation.findings[0];
    const securityFinding = plugin.security?.findings[0];
    const compatibilityFinding = plugin.compatibility?.results.find((result) => result.status === "fail");
    const reason =
      validationFinding?.id ??
      securityFinding?.id ??
      compatibilityFinding?.summary ??
      "unknown failure";

    actions.push(`${plugin.plugin.name}: fix ${cleanReason(reason)}.`);
  }

  for (const plugin of plugins.filter((item) => item.status === "warn")) {
    const securityFinding = plugin.security?.findings[0];
    const compatibilityFinding = plugin.compatibility?.results.find((result) => result.status === "warn");
    const reason =
      securityFinding?.id ??
      compatibilityFinding?.summary ??
      plugin.validation.findings[0]?.id ??
      "warning";

    actions.push(`${plugin.plugin.name}: review ${cleanReason(reason)}.`);
  }

  return actions;
}

export async function buildEcosystemAudit(
  options: EcosystemAuditOptions
): Promise<EcosystemAuditReport> {
  const installedPlugins = filterInstalledPlugins(
    await discoverInstalledPlugins({ env: options.env }),
    options.filter ?? null
  );
  const environment: CompatibilityEnvironment = {
    env: options.env,
    platform: options.platform
  };
  const plugins: EcosystemAuditPluginResult[] = [];

  for (const plugin of installedPlugins) {
    const validation = await options.validatePlugin(plugin.rootPath);
    const security = options.includeSecurity
      ? await buildSecurityAudit(plugin.rootPath)
      : undefined;
    const compatibility = options.includeCompatibility
      ? await buildCompatibilityMatrix(plugin.rootPath, environment)
      : undefined;
    const status = mergeStatus([
      validation.status,
      security?.status ?? "pass",
      compatibilityStatus(compatibility)
    ]);

    plugins.push({
      plugin,
      status,
      validation,
      ...(security ? { security } : {}),
      ...(compatibility ? { compatibility } : {})
    });
  }

  const summary = summarizePlugins(plugins);
  const status = summary.fail > 0
    ? "fail"
    : summary.warn > 0
      ? "warn"
      : "pass";

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    status,
    summary,
    plugins,
    priorityActions: buildPriorityActions(plugins)
  };
}

export function renderEcosystemAuditJson(report: EcosystemAuditReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderEcosystemAudit(report: EcosystemAuditReport): string {
  const lines = [
    "Local Ecosystem Audit",
    "=====================",
    `Status: ${report.status.toUpperCase()}`,
    `Installed plugins: ${report.summary.totalPlugins}`,
    `Summary: ${report.summary.fail} fail, ${report.summary.warn} warn, ${report.summary.pass} pass`
  ];

  if (report.plugins.length === 0) {
    lines.push("", "No installed Codex plugins found.");
    return lines.join("\n");
  }

  lines.push("", "Plugins", "-------");

  for (const item of report.plugins) {
    const version = item.plugin.version ? `@${item.plugin.version}` : "";

    lines.push(`- ${item.plugin.name}${version}: ${item.status.toUpperCase()}`);
    lines.push(`  Validation: ${item.validation.status.toUpperCase()}`);

    if (item.security) {
      lines.push(`  Security: ${item.security.status.toUpperCase()} (${item.security.score}/100)`);
    }

    if (item.compatibility) {
      const compatibilitySummary = item.compatibility.results
        .map((result) => `${result.client}=${result.status}`)
        .join(", ");
      lines.push(`  Compatibility: ${compatibilitySummary}`);
    }
  }

  if (report.priorityActions.length > 0) {
    lines.push("", "Priority Actions", "----------------");
    lines.push(...report.priorityActions.map((action) => `- ${action}`));
  }

  return lines.join("\n");
}
