import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredPackage, Finding, FindingEvidence, PluginManifest } from "../domain/types.js";

const interfaceStringFields = [
  "displayName",
  "shortDescription",
  "longDescription",
  "developerName",
  "category",
  "websiteURL",
  "privacyPolicyURL",
  "termsOfServiceURL",
  "brandColor"
] as const;
const interfaceUrlFields = new Set(["websiteURL", "privacyPolicyURL", "termsOfServiceURL"]);
const interfacePathFields = ["composerIcon", "logo"] as const;
const interfaceStringArrayFields = ["capabilities", "defaultPrompt"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function relativePackagePath(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== ".." && !path.isAbsolute(relativePath));
}

export interface SafePackagePath {
  path: string;
  packagePath: string;
}

export async function resolveSafePackagePath(
  rootPath: string,
  value: string
): Promise<SafePackagePath | null> {
  if (!value.startsWith("./")) {
    return null;
  }

  const resolvedPath = path.resolve(rootPath, value);
  if (!isWithinRoot(rootPath, resolvedPath)) {
    return null;
  }

  try {
    const canonicalRoot = await realpath(rootPath);
    const canonicalPath = await realpath(resolvedPath);
    if (!isWithinRoot(canonicalRoot, canonicalPath)) {
      return null;
    }
  } catch {
    // The path may be intentionally absent; callers that require it report that separately.
  }

  return { path: resolvedPath, packagePath: relativePackagePath(rootPath, resolvedPath) };
}

function invalidField(field: string, manifestPath: string): Finding {
  return failure(
    "plugin.manifest.invalid_field",
    `The plugin manifest field \`${field}\` has an invalid value.`,
    "Malformed optional metadata cannot be interpreted reliably by Codex clients.",
    `Use the official type for \`${field}\` in .codex-plugin/plugin.json.`,
    { manifestPath, field }
  );
}

function invalidPath(id: "plugin.manifest.invalid_path" | "plugin.app.invalid_path", field: string, manifestPath: string): Finding {
  return failure(
    id,
    `The plugin manifest field \`${field}\` must reference a safe package-relative path.`,
    "Paths outside the plugin package can expose files that are not part of the plugin bundle.",
    `Use a \`./\` path that remains inside the plugin package for \`${field}\`.`,
    { manifestPath, field }
  );
}

function failure(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  evidence: FindingEvidence
): Finding {
  return { id, severity: "fail", message, impact, suggestedFix, evidence };
}

async function safePath(
  rootPath: string,
  manifestPath: string,
  field: string,
  value: unknown,
  id: "plugin.manifest.invalid_path" | "plugin.app.invalid_path"
): Promise<{ path: string; packagePath: string } | Finding> {
  if (typeof value !== "string") {
    return invalidField(field, manifestPath);
  }

  return (await resolveSafePackagePath(rootPath, value)) ?? invalidPath(id, field, manifestPath);
}

function validateString(value: unknown, field: string, manifestPath: string, findings: Finding[]): void {
  if (value !== undefined && typeof value !== "string") {
    findings.push(invalidField(field, manifestPath));
  }
}

function validateHttpUrl(value: unknown, field: string, manifestPath: string, findings: Finding[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !isHttpUrl(value)) {
    findings.push(invalidField(field, manifestPath));
  }
}

function validateStringArray(value: unknown, field: string, manifestPath: string, findings: Finding[]): void {
  if (value !== undefined && (!Array.isArray(value) || value.some((item) => typeof item !== "string"))) {
    findings.push(invalidField(field, manifestPath));
  }
}

function validateMetadata(manifest: PluginManifest, manifestPath: string): Finding[] {
  const findings: Finding[] = [];

  if (manifest.author !== undefined) {
    if (!isPlainObject(manifest.author)) {
      findings.push(invalidField("author", manifestPath));
    } else {
      validateString(manifest.author.name, "author.name", manifestPath, findings);
      validateString(manifest.author.email, "author.email", manifestPath, findings);
      validateHttpUrl(manifest.author.url, "author.url", manifestPath, findings);
    }
  }
  validateHttpUrl(manifest.homepage, "homepage", manifestPath, findings);
  validateHttpUrl(manifest.repository, "repository", manifestPath, findings);
  validateString(manifest.license, "license", manifestPath, findings);
  validateStringArray(manifest.keywords, "keywords", manifestPath, findings);

  if (manifest.interface === undefined) return findings;
  if (!isPlainObject(manifest.interface)) {
    findings.push(invalidField("interface", manifestPath));
    return findings;
  }
  for (const field of interfaceStringFields) {
    const value = manifest.interface[field];
    if (interfaceUrlFields.has(field)) {
      validateHttpUrl(value, `interface.${field}`, manifestPath, findings);
    } else {
      validateString(value, `interface.${field}`, manifestPath, findings);
    }
  }
  for (const field of interfaceStringArrayFields) {
    validateStringArray(manifest.interface[field], `interface.${field}`, manifestPath, findings);
  }
  return findings;
}

export async function validatePluginComponents(discoveredPackage: DiscoveredPackage): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;
  const manifestPath = relativePackagePath(rootPath, discoveredPackage.manifestPath);
  const findings = validateMetadata(manifest, manifestPath);

  const componentPaths: Array<[string, unknown]> = [
    ["skills", manifest.skills],
    ["mcpServers", manifest.mcpServers]
  ];
  if (isPlainObject(manifest.interface)) {
    for (const field of interfacePathFields) componentPaths.push([`interface.${field}`, manifest.interface[field]]);
    const screenshots = manifest.interface.screenshots;
    if (screenshots !== undefined && (!Array.isArray(screenshots) || screenshots.some((item) => typeof item !== "string"))) {
      findings.push(invalidField("interface.screenshots", manifestPath));
    } else if (Array.isArray(screenshots)) {
      screenshots.forEach((screenshot, index) => componentPaths.push([`interface.screenshots[${index}]`, screenshot]));
    }
  }

  for (const [field, value] of componentPaths) {
    if (value === undefined) continue;
    const result = await safePath(rootPath, manifestPath, field, value, "plugin.manifest.invalid_path");
    if ("id" in result) findings.push(result);
  }

  if (manifest.apps === undefined) return findings;
  const appPath = await safePath(rootPath, manifestPath, "apps", manifest.apps, "plugin.app.invalid_path");
  if ("id" in appPath) return [...findings, appPath];
  try {
    if (!(await stat(appPath.path)).isFile()) throw new Error("not a regular file");
  } catch {
    return [...findings, failure(
      "plugin.app.missing_file",
      "The plugin manifest points to a missing .app.json file.",
      "Codex cannot load an app manifest that is absent or not a regular file.",
      "Create the referenced app manifest as a regular JSON file inside the plugin package.",
      { field: "apps", path: appPath.packagePath }
    )];
  }
  try {
    JSON.parse(await readFile(appPath.path, "utf8"));
  } catch {
    findings.push(failure(
      "plugin.app.invalid_json",
      "The referenced .app.json file is not valid JSON.",
      "Codex cannot parse the app manifest.",
      "Fix the JSON syntax in the referenced app manifest.",
      { field: "apps", path: appPath.packagePath }
    ));
  }
  return findings;
}
