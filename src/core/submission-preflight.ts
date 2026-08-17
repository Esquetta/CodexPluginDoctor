import { lstat, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredPackage, PluginManifest } from "../domain/types.js";
import { validateSubmissionAssets } from "./submission-assets.js";
import { submissionManualChecks, submissionRuleset } from "./submission-ruleset.js";
import { validateSubmissionSkillMetadata } from "./submission-skill-metadata.js";

export interface SubmissionFinding {
  id: `plugin.submission.${string}`;
  severity: "warn" | "fail";
  message: string;
  portalCode?: string;
  evidence?: Record<string, string | number | boolean | null>;
}

export interface SubmissionCheck {
  id: "listing" | "components" | "assets" | "skills";
  status: "pass" | "warn" | "fail";
  findingIds: string[];
}

export interface SubmissionManualCheck {
  id: string;
  label: string;
  state: "required" | "not_applicable";
}

export interface SubmissionPreflightReport {
  schemaVersion: "1.0.0";
  rulesetVersion: "openai-directory-2026-08-15";
  targetType: "skills-only" | "mcp-backed";
  status: "pass" | "fail";
  readiness: "blocked" | "manual_review_required";
  summary: { passed: number; warnings: number; blockers: number; manualChecks: number };
  checks: SubmissionCheck[];
  findings: SubmissionFinding[];
  manualChecklist: SubmissionManualCheck[];
}

type Evidence = SubmissionFinding["evidence"];
type TargetType = SubmissionPreflightReport["targetType"];

const packageNamePattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const semverPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const singleLineUnsupported = /[\u0000-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const multilineUnsupported = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const knownInterfaceFields = new Set([
  "displayName", "shortDescription", "longDescription", "developerName", "category",
  "capabilities", "websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL",
  "brandColor", "brandColorDark", "defaultPrompt", "composerIcon", "logo", "screenshots"
]);
const maxSubmissionManifestBytes = 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(
  id: `plugin.submission.${string}`,
  severity: SubmissionFinding["severity"],
  message: string,
  evidence?: Evidence
): SubmissionFinding {
  return evidence === undefined ? { id, severity, message } : { id, severity, message, evidence };
}

function invalidField(field: string, evidence?: Evidence): SubmissionFinding {
  return finding(`plugin.submission.interface.${field}`, "fail", "Listing field is invalid.", {
    field,
    ...evidence
  });
}

function hasValidText(value: unknown, maximum: number, multiline = false): value is string {
  return typeof value === "string"
    && value.trim().length > 0
    && value.length <= maximum
    && !(multiline ? multilineUnsupported : singleLineUnsupported).test(value);
}

function validateRequiredText(
  source: Record<string, unknown>,
  property: string,
  field: string,
  limit: number,
  multiline: boolean,
  findings: SubmissionFinding[]
): void {
  if (!hasValidText(source[property], limit, multiline)) {
    findings.push(invalidField(field, { limit }));
  }
}

function validatePackage(manifest: Record<string, unknown>, findings: SubmissionFinding[]): void {
  const name = manifest.name;
  if (typeof name !== "string" || name.length > submissionRuleset.limits.packageName || !packageNamePattern.test(name)) {
    findings.push(finding("plugin.submission.package.name", "fail", "Package name is invalid.", {
      field: "name", limit: submissionRuleset.limits.packageName
    }));
  }

  const version = manifest.version;
  if (typeof version !== "string" || version.length > submissionRuleset.limits.version || !semverPattern.test(version)) {
    findings.push(finding("plugin.submission.package.version", "fail", "Package version is invalid.", {
      field: "version", limit: submissionRuleset.limits.version
    }));
  }
}

function validateCapabilities(value: unknown, findings: SubmissionFinding[]): void {
  if (value === undefined) {
    return;
  }
  if (!Array.isArray(value) || value.length > submissionRuleset.limits.capabilities) {
    findings.push(invalidField("capabilities", { limit: submissionRuleset.limits.capabilities }));
  }
  if (!Array.isArray(value)) {
    return;
  }
  if (value.some((capability) => !hasValidText(capability, submissionRuleset.limits.capability))) {
    findings.push(invalidField("capability", { limit: submissionRuleset.limits.capability }));
  }
}

function normalizePrompt(prompt: string): string {
  return prompt.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

function validateDefaultPrompt(value: unknown, findings: SubmissionFinding[]): void {
  if (value === undefined) {
    return;
  }
  const prompts = typeof value === "string" ? [value] : value;
  if (!Array.isArray(prompts) || prompts.length > submissionRuleset.limits.starterPrompts) {
    findings.push(invalidField("default_prompt", { limit: submissionRuleset.limits.starterPrompts }));
    return;
  }
  const normalized = new Set<string>();
  const invalid = prompts.some((prompt) => {
    if (!hasValidText(prompt, submissionRuleset.limits.starterPrompt) || prompt.includes("@")) {
      return true;
    }
    const normalizedPrompt = normalizePrompt(prompt);
    if (normalized.has(normalizedPrompt)) {
      return true;
    }
    normalized.add(normalizedPrompt);
    return false;
  });
  if (invalid) {
    findings.push(invalidField("default_prompt", { limit: submissionRuleset.limits.starterPrompt }));
  }
}

function isValidHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > submissionRuleset.limits.url
    || value.trim() !== value || singleLineUnsupported.test(value)) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.hostname.length > 0
      && parsed.username.length === 0 && parsed.password.length === 0 && parsed.hash.length === 0;
  } catch {
    return false;
  }
}

function validateListing(manifest: Record<string, unknown>, targetType: TargetType): SubmissionFinding[] {
  const findings: SubmissionFinding[] = [];
  validatePackage(manifest, findings);

  const listing = manifest.interface;
  if (!isRecord(listing)) {
    findings.push(finding("plugin.submission.interface.required", "fail", "Listing interface mapping is required.", { field: "interface" }));
    return findings;
  }

  validateRequiredText(listing, "displayName", "display_name", submissionRuleset.limits.displayName, false, findings);
  validateRequiredText(listing, "shortDescription", "short_description", submissionRuleset.limits.shortDescription, false, findings);
  validateRequiredText(listing, "longDescription", "long_description", submissionRuleset.limits.longDescription, true, findings);
  validateRequiredText(listing, "developerName", "developer_name", submissionRuleset.limits.developerName, false, findings);
  validateRequiredText(listing, "category", "category", 80, false, findings);
  if (typeof listing.category === "string" && !submissionRuleset.categories.includes(listing.category as never)) {
    findings.push(invalidField("category"));
  }
  validateCapabilities(listing.capabilities, findings);
  validateDefaultPrompt(listing.defaultPrompt, findings);

  if (targetType === "mcp-backed") {
    for (const property of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) {
      if (!isValidHttpsUrl(listing[property])) {
        findings.push(finding("plugin.submission.interface.url", "fail", "Required listing URL is invalid.", {
          field: property, limit: submissionRuleset.limits.url
        }));
      }
    }
  }

  for (const key of Object.keys(listing)) {
    if (!knownInterfaceFields.has(key)) {
      findings.push(finding("plugin.submission.interface.unknown_field", "warn", "Listing interface contains an unsupported field.", { field: key }));
    }
  }
  return findings;
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function validateApp(rootPath: string, declaration: unknown): Promise<SubmissionFinding[]> {
  if (declaration === undefined) {
    return [];
  }
  const invalid = () => [finding("plugin.submission.component.app", "fail", "App declaration must reference a contained parseable root file.", { path: ".app.json" })];
  const invalidPath = () => [finding("plugin.submission.app.invalid_path", "fail", "App declaration resolves outside the package.", { path: ".app.json" })];
  if (declaration !== "./.app.json") {
    return invalid();
  }
  const candidatePath = path.resolve(rootPath, ".app.json");
  try {
    const [canonicalRoot, canonicalCandidate, details] = await Promise.all([
      realpath(rootPath),
      realpath(candidatePath),
      stat(candidatePath)
    ]);
    if (!isWithin(canonicalRoot, canonicalCandidate)) {
      return invalidPath();
    }
    if (!details.isFile() || details.size > 5 * 1024 * 1024) {
      return invalid();
    }
    JSON.parse(await readFile(candidatePath, "utf8"));
    return [];
  } catch {
    return invalid();
  }
}

function checkStatus(findings: SubmissionFinding[]): SubmissionCheck["status"] {
  if (findings.some((item) => item.severity === "fail")) {
    return "fail";
  }
  return findings.some((item) => item.severity === "warn") ? "warn" : "pass";
}

function check(id: SubmissionCheck["id"], findings: SubmissionFinding[]): SubmissionCheck {
  return { id, status: checkStatus(findings), findingIds: findings.map((item) => item.id) };
}

function checklist(targetType: TargetType): SubmissionManualCheck[] {
  return submissionManualChecks.map((item) => ({
    id: item.id,
    label: item.label,
    state: item.mcpOnly && targetType === "skills-only" ? "not_applicable" : "required"
  }));
}

function invalidPackageReport(): SubmissionPreflightReport {
  const findings = [finding("plugin.submission.package.invalid", "fail", "Plugin manifest is missing or invalid.")];
  const checks = [check("listing", findings), check("components", []), check("assets", []), check("skills", [])];
  return {
    schemaVersion: "1.0.0",
    rulesetVersion: submissionRuleset.version,
    targetType: "skills-only",
    status: "fail",
    readiness: "blocked",
    summary: { passed: 3, warnings: 0, blockers: 1, manualChecks: 3 },
    checks,
    findings,
    manualChecklist: checklist("skills-only")
  };
}

function oversizedPackageReport(): SubmissionPreflightReport {
  const findings = [finding("plugin.submission.package.too_large", "fail", "Plugin manifest exceeds the submission preflight size limit.", {
    path: ".codex-plugin/plugin.json", limit: maxSubmissionManifestBytes
  })];
  const checks = [check("listing", findings), check("components", []), check("assets", []), check("skills", [])];
  return {
    schemaVersion: "1.0.0",
    rulesetVersion: submissionRuleset.version,
    targetType: "skills-only",
    status: "fail",
    readiness: "blocked",
    summary: { passed: 3, warnings: 0, blockers: 1, manualChecks: 3 },
    checks,
    findings,
    manualChecklist: checklist("skills-only")
  };
}

async function discoverSubmissionPackage(targetPath: string): Promise<DiscoveredPackage | "too_large" | null> {
  const rootPath = path.resolve(targetPath);
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");
  try {
    const linkDetails = await lstat(manifestPath);
    if (!linkDetails.isFile()) return null;
    const details = await stat(manifestPath);
    if (details.size > maxSubmissionManifestBytes) return "too_large";
    const content = new TextDecoder("utf-8", { fatal: true }).decode(await readFile(manifestPath));
    return { rootPath, manifestPath, manifest: JSON.parse(content) as PluginManifest };
  } catch {
    return null;
  }
}

export async function buildSubmissionPreflight(targetPath: string): Promise<SubmissionPreflightReport> {
  if (typeof targetPath !== "string") {
    return invalidPackageReport();
  }
  const discovered = await discoverSubmissionPackage(targetPath);
  if (discovered === "too_large") {
    return oversizedPackageReport();
  }
  if (!discovered || !isRecord(discovered.manifest)) {
    return invalidPackageReport();
  }

  const manifest = discovered.manifest;
  const targetType: TargetType = manifest.mcpServers !== undefined || manifest.apps !== undefined
    ? "mcp-backed"
    : "skills-only";
  const listingFindings = validateListing(manifest, targetType);
  const componentFindings = await validateApp(discovered.rootPath, manifest.apps);
  const assetFindings = (await validateSubmissionAssets(discovered)).findings;
  const skillFindings = (await validateSubmissionSkillMetadata(discovered, targetType)).findings;
  const interfaceValue = manifest.interface;
  if (targetType === "skills-only" && isRecord(interfaceValue) && interfaceValue.screenshots !== undefined) {
    componentFindings.push(finding("plugin.submission.component.excluded", "fail", "Screenshots are excluded for skills-only submissions.", { field: "screenshots" }));
  }
  const findings = [...listingFindings, ...componentFindings, ...assetFindings, ...skillFindings];
  const checks = [
    check("listing", listingFindings),
    check("components", componentFindings),
    check("assets", assetFindings),
    check("skills", skillFindings)
  ];
  const blockers = findings.filter((item) => item.severity === "fail").length;
  const manualChecklist = checklist(targetType);

  return {
    schemaVersion: "1.0.0",
    rulesetVersion: submissionRuleset.version,
    targetType,
    status: blockers > 0 ? "fail" : "pass",
    readiness: blockers > 0 ? "blocked" : "manual_review_required",
    summary: {
      passed: checks.filter((item) => item.status === "pass").length,
      warnings: findings.filter((item) => item.severity === "warn").length,
      blockers,
      manualChecks: manualChecklist.filter((item) => item.state === "required").length
    },
    checks,
    findings,
    manualChecklist
  };
}
