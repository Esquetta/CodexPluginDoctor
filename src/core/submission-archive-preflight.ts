import type { PluginManifest } from "../domain/types.js";
import { validateSubmissionAssetsFromReader } from "./submission-assets.js";
import {
  inspectSubmissionArchive,
  type SubmissionArchiveCoverage,
  type SubmissionArchiveFinding,
  type SubmissionArchiveInspection
} from "./submission-archive-reader.js";
import { submissionArchiveRuleset } from "./submission-archive-ruleset.js";
import type { SubmissionPackageEntry, SubmissionPackageReader } from "./submission-package-reader.js";
import {
  type SubmissionCheck,
  type SubmissionFinding,
  type SubmissionManualCheck,
  type SubmissionPreflightReport,
  type SubmissionTargetType,
  validateSubmissionListing
} from "./submission-preflight.js";
import { submissionManualChecks } from "./submission-ruleset.js";
import { validateSubmissionSkillMetadataFromReader } from "./submission-skill-metadata.js";

const manifestPaths = [".codex-plugin/plugin.json", ".agent-plugin/plugin.json", ".claude-plugin/plugin.json"] as const;
const maxManifestBytes = 1024 * 1024;

export type SubmissionArchiveRootLayout = "archive-root" | "single-top-level-directory" | "unavailable";

export interface SubmissionArchivePreflightReport {
  schemaVersion: "1.0.0";
  rulesetVersion: "openai-directory-archive-2026-08-23";
  status: "pass" | "fail";
  readiness: "blocked" | "manual_review_required";
  archive: {
    fileName: string;
    compressedBytes: number;
    uncompressedBytes: number;
    entryCount: number;
    rootLayout: SubmissionArchiveRootLayout;
  };
  summary: SubmissionPreflightReport["summary"];
  archiveChecks: readonly SubmissionCheck[];
  submission: SubmissionPreflightReport | null;
  findings: readonly SubmissionArchiveFinding[] | readonly (SubmissionArchiveFinding | SubmissionFinding)[];
  coverage: readonly SubmissionArchiveCoverage[];
  manualChecklist: readonly SubmissionManualCheck[];
}

interface RootDiscovery {
  rootPrefix: string;
  rootLayout: Exclude<SubmissionArchiveRootLayout, "unavailable">;
  manifestPath: string;
  manifestFormat: typeof manifestPaths[number];
}

function archiveFinding(
  id: SubmissionArchiveFinding["id"],
  severity: SubmissionArchiveFinding["severity"],
  message: string,
  portalCode?: string
): SubmissionArchiveFinding {
  return portalCode === undefined ? { id, severity, message } : { id, severity, message, portalCode };
}

function archiveCoverage(): SubmissionArchiveCoverage[] {
  return submissionArchiveRuleset.portalRules.map(({ id, status, reason }) => ({ id, status, reason }));
}

function checkStatus(findings: readonly SubmissionFinding[]): SubmissionCheck["status"] {
  return findings.some((finding) => finding.severity === "fail")
    ? "fail"
    : findings.some((finding) => finding.severity === "warn") ? "warn" : "pass";
}

function submissionCheck(id: SubmissionCheck["id"], findings: SubmissionFinding[]): SubmissionCheck {
  return { id, status: checkStatus(findings), findingIds: findings.map((finding) => finding.id) };
}

function manualChecklist(): SubmissionManualCheck[] {
  return submissionManualChecks.map((item) => ({
    id: item.id,
    label: item.label,
    state: item.mcpOnly ? "not_applicable" : "required"
  }));
}

function reportSummary(checks: readonly SubmissionCheck[], findings: readonly SubmissionFinding[], checklist: readonly SubmissionManualCheck[]) {
  return {
    passed: checks.filter((check) => check.status === "pass").length,
    warnings: findings.filter((finding) => finding.severity === "warn").length,
    blockers: findings.filter((finding) => finding.severity === "fail").length,
    manualChecks: checklist.filter((item) => item.state === "required").length
  };
}

function normalizePath(value: string, allowRoot = false): string | null {
  if (value === "" && allowRoot) return "";
  if (typeof value !== "string" || value === "" || value.startsWith("/") || value.startsWith("\\")
    || /^[A-Za-z]:/u.test(value) || value.includes("\\") || /[\u0000-\u001F\u007F]/u.test(value)) return null;
  const segments = value.split("/");
  return segments.some((segment) => segment === "" || segment === "." || segment === "..") ? null : segments.join("/");
}

function discoverRoot(entries: readonly SubmissionPackageEntry[]): { discovery: RootDiscovery | null; findings: SubmissionArchiveFinding[] } {
  const paths = entries.map((entry) => entry.packagePath);
  if (paths.length === 0) {
    return { discovery: null, findings: [archiveFinding("plugin.submission.archive.root_missing", "fail", "Archive does not contain a plugin root.")] };
  }
  const rootManifests = manifestPaths.filter((manifestPath) => paths.includes(manifestPath));
  const nestedRoots = new Set<string>();
  for (const entryPath of paths) {
    const separator = entryPath.indexOf("/");
    if (separator > 0 && manifestPaths.includes(entryPath.slice(separator + 1) as typeof manifestPaths[number])) {
      nestedRoots.add(entryPath.slice(0, separator));
    }
  }
  if (rootManifests.length + nestedRoots.size > 1) {
    return { discovery: null, findings: [archiveFinding("plugin.submission.archive.root_ambiguous", "fail", "Archive contains more than one plugin root.")] };
  }
  if (rootManifests.length === 1) {
    return {
      discovery: { rootPrefix: "", rootLayout: "archive-root", manifestPath: rootManifests[0]!, manifestFormat: rootManifests[0]! },
      findings: []
    };
  }
  if (nestedRoots.size === 0) {
    return { discovery: null, findings: [archiveFinding("plugin.submission.archive.manifest_missing", "fail", "Archive root does not contain a recognized plugin manifest.")] };
  }
  const hasRootFile = entries.some((entry) => !entry.packagePath.includes("/") && entry.resolvedKind === "file");
  const topLevels = new Set(paths.map((entryPath) => entryPath.split("/", 1)[0]!));
  if (hasRootFile || nestedRoots.size !== 1 || topLevels.size !== 1) {
    return { discovery: null, findings: [archiveFinding("plugin.submission.archive.root_siblings", "fail", "A top-level plugin directory cannot have siblings.")] };
  }
  const topLevel = [...nestedRoots][0]!;
  const prefix = `${topLevel}/`;
  const nestedManifests = manifestPaths.filter((manifestPath) => paths.includes(`${prefix}${manifestPath}`));
  if (nestedManifests.length === 0) {
    return { discovery: null, findings: [archiveFinding("plugin.submission.archive.manifest_missing", "fail", "Archive root does not contain a recognized plugin manifest.")] };
  }
  if (nestedManifests.length > 1) {
    return { discovery: null, findings: [archiveFinding("plugin.submission.archive.root_ambiguous", "fail", "Archive contains more than one plugin manifest.")] };
  }
  return {
    discovery: {
      rootPrefix: prefix,
      rootLayout: "single-top-level-directory",
      manifestPath: `${prefix}${nestedManifests[0]!}`,
      manifestFormat: nestedManifests[0]!
    },
    findings: []
  };
}

function rootedReader(inspection: SubmissionArchiveInspection, rootPrefix: string): SubmissionPackageReader | null {
  if (inspection.reader === null) return null;
  const entries = inspection.entries
    .filter((entry) => entry.packagePath.startsWith(rootPrefix))
    .map((entry) => ({ ...entry, packagePath: entry.packagePath.slice(rootPrefix.length) }));
  const byPath = new Map(entries.map((entry) => [entry.packagePath, entry]));
  const reader = inspection.reader;

  function directoryEntry(packagePath: string): SubmissionPackageEntry | null {
    if (entries.some((entry) => entry.packagePath.startsWith(`${packagePath}/`))) {
      return { packagePath, kind: "directory", resolvedKind: "directory", size: 0, safeResolution: "safe" };
    }
    return null;
  }

  return {
    async list(directory: string): Promise<readonly SubmissionPackageEntry[]> {
      const normalizedDirectory = normalizePath(directory, true);
      if (normalizedDirectory === null) return [];
      const prefix = normalizedDirectory === "" ? "" : `${normalizedDirectory}/`;
      const children = new Map<string, SubmissionPackageEntry>();
      for (const entry of entries) {
        if (!entry.packagePath.startsWith(prefix)) continue;
        const remaining = entry.packagePath.slice(prefix.length);
        if (remaining === "") continue;
        const [name] = remaining.split("/", 1);
        const packagePath = normalizedDirectory === "" ? name! : `${normalizedDirectory}/${name!}`;
        if (remaining.includes("/")) {
          children.set(packagePath, directoryEntry(packagePath)!);
        } else {
          children.set(packagePath, entry);
        }
      }
      return [...children.values()].sort((left, right) => left.packagePath.localeCompare(right.packagePath));
    },
    async stat(packagePath: string): Promise<SubmissionPackageEntry | null> {
      const normalizedPath = normalizePath(packagePath);
      return normalizedPath === null ? null : byPath.get(normalizedPath) ?? directoryEntry(normalizedPath);
    },
    async read(packagePath: string, maxBytes: number): Promise<Uint8Array | null> {
      const normalizedPath = normalizePath(packagePath);
      if (normalizedPath === null || !byPath.has(normalizedPath)) return null;
      return reader.read(`${rootPrefix}${normalizedPath}`, maxBytes);
    }
  };
}

async function parseManifest(reader: SubmissionPackageReader, manifestPath: string): Promise<PluginManifest | null> {
  const bytes = await reader.read(manifestPath, maxManifestBytes).catch(() => null);
  if (bytes === null) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed as PluginManifest : null;
  } catch {
    return null;
  }
}

function hasImmediateSkill(entries: readonly SubmissionPackageEntry[]): boolean {
  return entries.some((entry) => /^skills\/[^/]+\/SKILL\.md$/u.test(entry.packagePath) && entry.resolvedKind === "file");
}

function exclusionFindings(manifest: PluginManifest, entries: readonly SubmissionPackageEntry[]): SubmissionArchiveFinding[] {
  const findings: SubmissionArchiveFinding[] = [];
  const interfaceValue = manifest.interface;
  if (manifest.mcpServers !== undefined || entries.some((entry) => entry.packagePath === ".mcp.json")) {
    findings.push(archiveFinding("plugin.submission.archive.mcp_excluded", "warn", "MCP configuration requires the MCP-backed submission flow.", "mcp_configuration_excluded"));
  }
  if (manifest.apps !== undefined || entries.some((entry) => entry.packagePath === ".app.json")) {
    findings.push(archiveFinding("plugin.submission.archive.app_excluded", "warn", "App configuration requires the MCP-backed submission flow.", "app_configuration_excluded"));
  }
  if (typeof interfaceValue === "object" && interfaceValue !== null && !Array.isArray(interfaceValue)
    && "screenshots" in interfaceValue && (interfaceValue as Record<string, unknown>).screenshots !== undefined) {
    findings.push(archiveFinding("plugin.submission.archive.screenshot_excluded", "warn", "Screenshots require the MCP-backed submission flow.", "screenshot_configuration_excluded"));
  }
  return findings;
}

async function nestedSubmission(manifest: PluginManifest, reader: SubmissionPackageReader): Promise<SubmissionPreflightReport> {
  const targetType: SubmissionTargetType = "skills-only";
  const listing = validateSubmissionListing(manifest as Record<string, unknown>, targetType);
  const components: SubmissionFinding[] = [];
  const assets = (await validateSubmissionAssetsFromReader(manifest, reader)).findings;
  const skills = (await validateSubmissionSkillMetadataFromReader(manifest, targetType, reader)).findings;
  const checks = [
    submissionCheck("listing", listing),
    submissionCheck("components", components),
    submissionCheck("assets", assets),
    submissionCheck("skills", skills)
  ];
  const findings = [...listing, ...components, ...assets, ...skills];
  const manual = manualChecklist();
  const summary = reportSummary(checks, findings, manual);
  return {
    schemaVersion: "1.0.0",
    rulesetVersion: "openai-directory-2026-08-15",
    targetType,
    status: summary.blockers > 0 ? "fail" : "pass",
    readiness: summary.blockers > 0 ? "blocked" : "manual_review_required",
    summary,
    checks,
    findings,
    manualChecklist: manual
  };
}

export function submissionArchiveExitCode(report: SubmissionArchivePreflightReport, requireReady: boolean): 0 | 1 {
  return requireReady && report.status === "fail" ? 1 : 0;
}

export async function buildSubmissionArchivePreflight(archivePath: string): Promise<SubmissionArchivePreflightReport> {
  const inspection = await inspectSubmissionArchive(archivePath);
  const coverage = [...inspection.coverage, ...archiveCoverage()];
  const manual = manualChecklist();
  const archiveFindings: SubmissionArchiveFinding[] = [...inspection.findings];
  let rootLayout: SubmissionArchiveRootLayout = "unavailable";
  let submission: SubmissionPreflightReport | null = null;

  if (!archiveFindings.some((finding) => finding.severity === "fail") && inspection.reader !== null) {
    const root = discoverRoot(inspection.entries);
    archiveFindings.push(...root.findings);
    if (root.discovery !== null) {
      rootLayout = root.discovery.rootLayout;
      const reader = rootedReader(inspection, root.discovery.rootPrefix);
      const manifest = reader === null ? null : await parseManifest(reader, root.discovery.manifestPath.slice(root.discovery.rootPrefix.length));
      if (manifest === null || reader === null) {
        archiveFindings.push(archiveFinding("plugin.submission.archive.manifest_missing", "fail", "Plugin manifest must be a bounded UTF-8 JSON object."));
      } else {
        const entries = inspection.entries
          .filter((entry) => entry.packagePath.startsWith(root.discovery!.rootPrefix))
          .map((entry) => ({ ...entry, packagePath: entry.packagePath.slice(root.discovery!.rootPrefix.length) }));
        if (!hasImmediateSkill(entries)) {
          archiveFindings.push(archiveFinding("plugin.submission.archive.skill_missing", "fail", "Archive must contain an immediate skills/<skill>/SKILL.md entrypoint."));
        }
        archiveFindings.push(...exclusionFindings(manifest, entries));
        submission = await nestedSubmission(manifest, reader);
      }
    }
  }

  const findings = [...archiveFindings, ...(submission?.findings ?? [])];
  const blockers = findings.filter((finding) => finding.severity === "fail").length;
  const summary = submission === null
    ? { passed: 0, warnings: findings.filter((finding) => finding.severity === "warn").length, blockers, manualChecks: manual.filter((item) => item.state === "required").length }
    : { ...submission.summary, warnings: findings.filter((finding) => finding.severity === "warn").length, blockers };
  return {
    schemaVersion: "1.0.0",
    rulesetVersion: submissionArchiveRuleset.version,
    status: blockers > 0 ? "fail" : "pass",
    readiness: blockers > 0 ? "blocked" : "manual_review_required",
    archive: {
      fileName: inspection.fileName,
      compressedBytes: inspection.compressedBytes,
      uncompressedBytes: inspection.uncompressedBytes,
      entryCount: inspection.entryCount,
      rootLayout
    },
    summary,
    archiveChecks: [],
    submission,
    findings,
    coverage,
    manualChecklist: manual
  };
}
