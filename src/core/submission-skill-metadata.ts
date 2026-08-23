import path from "node:path";

import { isAlias, isNode, parseDocument, visit } from "yaml";

import type { DiscoveredPackage, PluginManifest } from "../domain/types.js";
import { createDirectorySubmissionPackageReader, type SubmissionPackageEntry, type SubmissionPackageReader } from "./submission-package-reader.js";
import type { SubmissionFinding, SubmissionPreflightReport } from "./submission-preflight.js";

type TargetType = SubmissionPreflightReport["targetType"];
type Evidence = SubmissionFinding["evidence"];
type Metadata = Record<string, unknown>;
type AggregateRead = { kind: "source"; source: string } | { kind: "invalid" } | { kind: "budget"; nextBytes: number };

const maxSkillBytes = 1024 * 1024;
const maxAgentBytes = 256 * 1024;
const maxAggregateMetadataBytes = 16 * 1024 * 1024;
const maxDirectoryEntries = 256;
const maxSkillDirectories = 100;
const unsupportedText = /[\u0000-\u001F\u007F\u2028\u2029\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/u;
const interfaceKeys = new Set(["display_name", "short_description", "icon_small", "icon_large", "brand_color", "default_prompt"]);
const policyKeys = new Set(["products", "allow_implicit_invocation"]);
const dependencyKeys = new Set(["tools"]);
const toolDescriptorKeys = new Set(["type", "value", "description", "transport", "url"]);
const agentKeys = new Set(["interface", "policy", "dependencies"]);

export interface SubmissionSkillMetadataResult {
  findings: SubmissionFinding[];
  skillCount: number;
}

interface AggregateBudget {
  bytes: number;
}

function isRecord(value: unknown): value is Metadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(id: `plugin.submission.skill.${string}`, message: string, evidence?: Evidence): SubmissionFinding {
  return evidence === undefined ? { id, severity: "fail", message } : { id, severity: "fail", message, evidence };
}

function supportedText(value: unknown, limit = Number.MAX_SAFE_INTEGER): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= limit && !unsupportedText.test(value);
}

function parseSafeYaml(source: string): { value: Metadata } | { error: "yaml" | "shape" } {
  const document = parseDocument(source, { schema: "core", uniqueKeys: true, strict: true, prettyErrors: false });
  let alias = false;
  let nonCoreTag = false;
  visit(document, (_key, node) => {
    if (isAlias(node)) alias = true;
    if (isNode(node) && node.tag !== undefined && !node.tag.startsWith("tag:yaml.org,2002:")) nonCoreTag = true;
  });
  if (document.errors.length > 0 || alias || nonCoreTag) return { error: "yaml" };
  try {
    const value = document.toJS({ maxAliasCount: 0 });
    return isRecord(value) ? { value } : { error: "shape" };
  } catch {
    return { error: "yaml" };
  }
}

function splitSkillFile(source: string): { frontmatter: string; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source);
  return !match || match[2].trim().length === 0 ? null : { frontmatter: match[1], body: match[2] };
}

function skillsRoot(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("./") || value.includes("\\") || /[\u0000-\u001F\u007F]/u.test(value)) return null;
  const normalized = path.posix.normalize(value.slice(2)).replace(/\/$/u, "");
  return normalized === "skills" ? normalized : null;
}

function relativePackagePath(base: string, value: string): string | null {
  if (path.posix.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value)) return null;
  const resolved = path.posix.normalize(path.posix.join(base, value));
  return resolved === ".." || resolved.startsWith("../") || resolved === "." ? null : resolved;
}

function isWithinPackagePath(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function budgetFinding(bytes: number): SubmissionFinding {
  return finding("plugin.submission.skill.budget_exceeded", "Skill metadata exceeds the aggregate submission preflight size limit.", {
    count: bytes, limit: maxAggregateMetadataBytes
  });
}

async function safeStat(reader: SubmissionPackageReader, packagePath: string): Promise<SubmissionPackageEntry | null> {
  return reader.stat(packagePath).catch(() => null);
}

async function readSafeUtf8(reader: SubmissionPackageReader, packagePath: string, maximum: number, budget: AggregateBudget): Promise<AggregateRead> {
  const details = await safeStat(reader, packagePath);
  if (details === null || details.safeResolution !== "safe" || details.resolvedKind !== "file" || details.size > maximum) return { kind: "invalid" };
  const nextBytes = budget.bytes + details.size;
  if (nextBytes > maxAggregateMetadataBytes) return { kind: "budget", nextBytes };
  const bytes = await reader.read(packagePath, maximum).catch(() => null);
  if (bytes === null || bytes.byteLength !== details.size) return { kind: "invalid" };
  try {
    budget.bytes = nextBytes;
    return { kind: "source", source: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { kind: "invalid" };
  }
}

function rejectUnknownKeys(value: Metadata, allowed: Set<string>): boolean {
  return Object.keys(value).some((key) => !allowed.has(key));
}

function isToolDescriptor(value: unknown): value is Metadata {
  return isRecord(value) && !rejectUnknownKeys(value, toolDescriptorKeys)
    && (value.type === "mcp" || value.type === "cli")
    && (value.type !== "cli" || (value.transport === undefined && value.url === undefined))
    && supportedText(value.value)
    && (value.description === undefined || supportedText(value.description))
    && (value.transport === undefined || supportedText(value.transport))
    && (value.url === undefined || supportedText(value.url));
}

async function validateIconPath(reader: SubmissionPackageReader, skillRoot: string, skillPath: string, field: "icon_small" | "icon_large", value: unknown): Promise<SubmissionFinding | null> {
  if (typeof value !== "string" || value.trim() !== value || !supportedText(value)) {
    return finding("plugin.submission.skill.agent.invalid_path", "Optional agent icon path is invalid.", { path: skillPath, field });
  }
  const iconPath = relativePackagePath(skillRoot, value);
  const details = iconPath === null ? null : await safeStat(reader, iconPath);
  if (details === null || details.safeResolution !== "safe" || details.resolvedKind !== "file") {
    return finding("plugin.submission.skill.agent.invalid_path", "Optional agent icon path is invalid.", { path: skillPath, field });
  }
  return null;
}

async function validateAgentFile(reader: SubmissionPackageReader, skillRoot: string, resolvedSkillRoot: string, budget: AggregateBudget): Promise<SubmissionFinding[]> {
  const skillPath = skillRoot;
  const agentPath = `${skillRoot}/agents/openai.yaml`;
  const agentDetails = await safeStat(reader, agentPath);
  if (agentDetails === null) return [];
  if (agentDetails.kind === "symlink") {
    return [finding("plugin.submission.skill.agent.invalid_path", "Optional agent metadata must not be a symbolic link.", { path: skillPath })];
  }
  if (agentDetails.safeResolution === "outside") {
    return [finding("plugin.submission.skill.agent.invalid_path", "Optional agent metadata resolves outside its skill.", { path: skillPath })];
  }
  if (agentDetails.safeResolution !== "safe") {
    return [finding("plugin.submission.skill.agent.invalid_file", "Optional agent metadata must be a readable regular file.", { path: agentPath })];
  }
  if (agentDetails.resolvedKind !== "file") {
    return [finding("plugin.submission.skill.agent.invalid_file", "Optional agent metadata must be a regular file.", { path: agentPath })];
  }
  const resolvedAgentPath = agentDetails.resolvedPackagePath ?? agentPath;
  if (!isWithinPackagePath(resolvedSkillRoot, resolvedAgentPath)) {
    return [finding("plugin.submission.skill.agent.invalid_path", "Optional agent metadata resolves outside its skill.", { path: skillPath })];
  }
  const source = await readSafeUtf8(reader, agentPath, maxAgentBytes, budget);
  if (source.kind === "budget") return [budgetFinding(source.nextBytes)];
  if (source.kind === "invalid") {
    return [finding("plugin.submission.skill.agent.invalid_file", "Optional agent metadata must be a bounded UTF-8 regular file.", { path: agentPath, limit: maxAgentBytes })];
  }
  const parsed = parseSafeYaml(source.source);
  if ("error" in parsed) {
    return [finding(parsed.error === "yaml" ? "plugin.submission.skill.agent.invalid_yaml" : "plugin.submission.skill.agent.invalid_shape", "Optional agent metadata must be a safe YAML mapping.", { path: agentPath })];
  }
  const metadata = parsed.value;
  if (rejectUnknownKeys(metadata, agentKeys) || !isRecord(metadata.interface) || rejectUnknownKeys(metadata.interface, interfaceKeys)
    || !supportedText(metadata.interface.display_name) || !supportedText(metadata.interface.short_description)) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent metadata has an unsupported shape.", { path: agentPath })];
  }
  if (metadata.interface.brand_color !== undefined && (typeof metadata.interface.brand_color !== "string" || !/^#[0-9A-Fa-f]{6}$/u.test(metadata.interface.brand_color))) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent metadata has an invalid brand color.", { path: agentPath, field: "brand_color" })];
  }
  if (metadata.interface.default_prompt !== undefined && !supportedText(metadata.interface.default_prompt)) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent metadata has an invalid default prompt.", { path: agentPath, field: "default_prompt" })];
  }
  if (metadata.policy !== undefined && (!isRecord(metadata.policy) || rejectUnknownKeys(metadata.policy, policyKeys)
    || (metadata.policy.products !== undefined && (!Array.isArray(metadata.policy.products) || metadata.policy.products.length === 0
      || new Set(metadata.policy.products).size !== metadata.policy.products.length || metadata.policy.products.some((product) => product !== "CHAT" && product !== "CODEX")))
    || (metadata.policy.allow_implicit_invocation !== undefined && typeof metadata.policy.allow_implicit_invocation !== "boolean"))) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent policy has an unsupported shape.", { path: agentPath, field: "policy" })];
  }
  if (metadata.dependencies !== undefined && (!isRecord(metadata.dependencies) || rejectUnknownKeys(metadata.dependencies, dependencyKeys)
    || !Array.isArray(metadata.dependencies.tools) || metadata.dependencies.tools.length === 0 || metadata.dependencies.tools.some((tool) => !isToolDescriptor(tool)))) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent dependencies have an unsupported shape.", { path: agentPath, field: "dependencies" })];
  }
  for (const field of ["icon_small", "icon_large"] as const) {
    const value = metadata.interface[field];
    if (value === undefined) continue;
    const iconFinding = await validateIconPath(reader, skillRoot, skillPath, field, value);
    if (iconFinding !== null) return [iconFinding];
  }
  return [];
}

export async function validateSubmissionSkillMetadataFromReader(manifest: PluginManifest, targetType: SubmissionPreflightReport["targetType"], reader: SubmissionPackageReader): Promise<SubmissionSkillMetadataResult> {
  if (manifest.skills === undefined) {
    return targetType === "skills-only" ? { findings: [finding("plugin.submission.skill.required", "Skills-only submissions require a valid skill.")], skillCount: 0 } : { findings: [], skillCount: 0 };
  }
  const root = skillsRoot(manifest.skills);
  if (root === null) {
    return { findings: [finding("plugin.submission.skill.invalid_manifest", "Skills must be declared as the root ./skills directory.", { field: "skills" })], skillCount: 0 };
  }
  const rootDetails = await safeStat(reader, root);
  if (rootDetails === null || rootDetails.safeResolution !== "safe" || rootDetails.resolvedKind !== "directory") {
    return { findings: [finding("plugin.submission.skill.invalid_path", "Skills directory must be canonically contained in the package.", { path: root })], skillCount: 0 };
  }
  const listed = await reader.list(root).catch(() => null);
  if (listed === null) {
    return { findings: [finding("plugin.submission.skill.invalid_path", "Skills directory cannot be inspected safely.", { path: root })], skillCount: 0 };
  }
  const findings: SubmissionFinding[] = [];
  const identities = new Set<string>();
  const budget: AggregateBudget = { bytes: 0 };
  let skillCount = 0;
  let skillDirectoryCount = 0;
  const entries = [...listed].sort((left, right) => left.packagePath.localeCompare(right.packagePath));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const entryCount = index + 1;
    if (entryCount > maxDirectoryEntries) {
      findings.push(finding("plugin.submission.skill.too_many", "Skills directory exceeds the submission preflight entry limit.", { count: entryCount, limit: maxDirectoryEntries }));
      break;
    }
    const name = path.posix.basename(entry.packagePath);
    if (path.posix.dirname(entry.packagePath) !== root || name.startsWith(".") || entry.resolvedKind !== "directory") continue;
    if (entry.safeResolution !== "safe" || entry.kind === "symlink") {
      findings.push(finding("plugin.submission.skill.invalid_path", "Skill directory resolves outside the declared skills directory.", { path: entry.packagePath }));
      continue;
    }
    skillDirectoryCount += 1;
    if (skillDirectoryCount > maxSkillDirectories) {
      findings.push(finding("plugin.submission.skill.too_many", "Skills directory exceeds the submission preflight skill limit.", { count: skillDirectoryCount, limit: maxSkillDirectories }));
      break;
    }
    const skillRoot = entry.packagePath;
    const skillFile = `${skillRoot}/SKILL.md`;
    const fileDetails = await safeStat(reader, skillFile);
    if (fileDetails?.kind === "symlink" || fileDetails?.safeResolution === "outside") {
      findings.push(finding("plugin.submission.skill.invalid_path", "Skill entrypoint must not be a symbolic link.", { path: skillFile }));
      continue;
    }
    if (fileDetails === null || fileDetails.safeResolution !== "safe" || fileDetails.resolvedKind !== "file") {
      findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint must be a contained regular file.", { path: skillFile }));
      continue;
    }
    const source = await readSafeUtf8(reader, skillFile, maxSkillBytes, budget);
    if (source.kind === "budget") {
      findings.push(budgetFinding(source.nextBytes));
      break;
    }
    if (source.kind === "invalid") {
      findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint must be a bounded UTF-8 regular file.", { path: skillFile, limit: maxSkillBytes }));
      continue;
    }
    const split = splitSkillFile(source.source);
    if (split === null) {
      findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint requires delimited frontmatter and a nonempty body.", { path: skillFile }));
      continue;
    }
    const parsed = parseSafeYaml(split.frontmatter);
    if ("error" in parsed) {
      findings.push(finding(parsed.error === "yaml" ? "plugin.submission.skill.invalid_yaml" : "plugin.submission.skill.invalid_shape", "Skill frontmatter must be a safe YAML mapping.", { path: skillFile }));
      continue;
    }
    const nameValue = parsed.value.name;
    const description = parsed.value.description;
    const normalizedName = typeof nameValue === "string" ? nameValue.normalize("NFKC").trim() : "";
    const pluginName = typeof manifest.name === "string" ? manifest.name.normalize("NFKC").trim() : "";
    if (!supportedText(nameValue) || !supportedText(description, 1024) || normalizedName.length === 0 || `${pluginName}:${normalizedName}`.length > 64 || identities.has(normalizedName)) {
      findings.push(finding("plugin.submission.skill.identity", "Skill identity metadata is invalid or duplicated.", { path: skillFile, limit: 64 }));
      continue;
    }
    identities.add(normalizedName);
    skillCount += 1;
    const resolvedSkillRoot = entry.resolvedPackagePath ?? skillRoot;
    const agentFindings = await validateAgentFile(reader, skillRoot, resolvedSkillRoot, budget);
    findings.push(...agentFindings);
    if (agentFindings.some((item) => item.id === "plugin.submission.skill.budget_exceeded")) break;
  }
  if (targetType === "skills-only" && skillCount === 0) {
    findings.push(finding("plugin.submission.skill.required", "Skills-only submissions require at least one valid skill.", { count: 0 }));
  }
  if (targetType === "mcp-backed" && skillCount === 0 && findings.length === 0) {
    findings.push(finding("plugin.submission.skill.invalid_file", "Declared skills must include at least one valid immediate skill entrypoint.", { path: root }));
  }
  return { findings, skillCount };
}

export async function validateSubmissionSkillMetadata(discoveredPackage: DiscoveredPackage, targetType: TargetType): Promise<SubmissionSkillMetadataResult> {
  return validateSubmissionSkillMetadataFromReader(discoveredPackage.manifest, targetType, createDirectorySubmissionPackageReader(discoveredPackage.rootPath));
}
