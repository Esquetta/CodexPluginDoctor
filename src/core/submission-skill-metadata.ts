import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { isAlias, isNode, parseDocument, visit } from "yaml";

import type { DiscoveredPackage } from "../domain/types.js";
import type { SubmissionFinding } from "./submission-preflight.js";

type TargetType = "skills-only" | "mcp-backed";
type Evidence = SubmissionFinding["evidence"];
type Metadata = Record<string, unknown>;

const maxSkillBytes = 1024 * 1024;
const maxAgentBytes = 256 * 1024;
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

function isRecord(value: unknown): value is Metadata {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWithin(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packagePath(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).split(path.sep).join("/");
}

function finding(
  id: `plugin.submission.skill.${string}`,
  message: string,
  evidence?: Evidence
): SubmissionFinding {
  return evidence === undefined
    ? { id, severity: "fail", message }
    : { id, severity: "fail", message, evidence };
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
  if (!match || match[2].trim().length === 0) return null;
  return { frontmatter: match[1], body: match[2] };
}

async function safeDirectory(rootPath: string, skillsPath: string): Promise<{ canonicalRoot: string; canonicalSkills: string } | null> {
  try {
    const [canonicalRoot, canonicalSkills, details] = await Promise.all([realpath(rootPath), realpath(skillsPath), stat(skillsPath)]);
    return details.isDirectory() && isWithin(canonicalRoot, canonicalSkills) ? { canonicalRoot, canonicalSkills } : null;
  } catch {
    return null;
  }
}

async function readSafeUtf8(filePath: string, maximum: number): Promise<string | null> {
  try {
    const details = await stat(filePath);
    if (!details.isFile() || details.size > maximum) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(await readFile(filePath));
  } catch {
    return null;
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

async function validateIconPath(
  rootPath: string,
  canonicalRoot: string,
  skillRoot: string,
  skillPath: string,
  field: "icon_small" | "icon_large",
  value: unknown
): Promise<SubmissionFinding | null> {
  if (typeof value !== "string" || value.trim() !== value || !supportedText(value)
    || path.isAbsolute(value) || /^[A-Za-z]:[\\/]/u.test(value)) {
    return finding("plugin.submission.skill.agent.invalid_path", "Optional agent icon path is invalid.", { path: skillPath, field });
  }
  const iconPath = path.resolve(skillRoot, value);
  if (!isWithin(rootPath, iconPath)) {
    return finding("plugin.submission.skill.agent.invalid_path", "Optional agent icon path is invalid.", { path: skillPath, field });
  }
  try {
    const [canonicalIcon, details] = await Promise.all([realpath(iconPath), stat(iconPath)]);
    if (!details.isFile() || !isWithin(canonicalRoot, canonicalIcon)) throw new Error("unsafe icon");
    return null;
  } catch {
    return finding("plugin.submission.skill.agent.invalid_path", "Optional agent icon path is invalid.", { path: skillPath, field });
  }
}

async function validateAgentFile(
  rootPath: string,
  skillRoot: string,
  skillPath: string
): Promise<SubmissionFinding[]> {
  const agentPath = path.join(skillRoot, "agents", "openai.yaml");
  let agentDetails;
  try {
    agentDetails = await lstat(agentPath);
  } catch {
    return [];
  }
  if (agentDetails.isSymbolicLink()) {
    return [finding("plugin.submission.skill.agent.invalid_path", "Optional agent metadata must not be a symbolic link.", { path: skillPath })];
  }
  if (!agentDetails.isFile()) {
    return [finding("plugin.submission.skill.agent.invalid_file", "Optional agent metadata must be a regular file.", { path: packagePath(rootPath, agentPath) })];
  }

  let canonicalRoot: string;
  let canonicalSkill: string;
  let canonicalAgent: string;
  try {
    [canonicalRoot, canonicalSkill, canonicalAgent] = await Promise.all([realpath(rootPath), realpath(skillRoot), realpath(agentPath)]);
  } catch {
    return [finding("plugin.submission.skill.agent.invalid_file", "Optional agent metadata must be a readable regular file.", { path: packagePath(rootPath, agentPath) })];
  }
  if (!isWithin(canonicalRoot, canonicalAgent) || !isWithin(canonicalSkill, canonicalAgent)) {
    return [finding("plugin.submission.skill.agent.invalid_path", "Optional agent metadata resolves outside its skill.", { path: skillPath })];
  }

  const source = await readSafeUtf8(agentPath, maxAgentBytes);
  if (source === null) {
    return [finding("plugin.submission.skill.agent.invalid_file", "Optional agent metadata must be a bounded UTF-8 regular file.", { path: packagePath(rootPath, agentPath), limit: maxAgentBytes })];
  }
  const parsed = parseSafeYaml(source);
  if ("error" in parsed) {
    return [finding(
      parsed.error === "yaml" ? "plugin.submission.skill.agent.invalid_yaml" : "plugin.submission.skill.agent.invalid_shape",
      "Optional agent metadata must be a safe YAML mapping.",
      { path: packagePath(rootPath, agentPath) }
    )];
  }

  const metadata = parsed.value;
  if (rejectUnknownKeys(metadata, agentKeys) || !isRecord(metadata.interface) || rejectUnknownKeys(metadata.interface, interfaceKeys)
    || !supportedText(metadata.interface.display_name) || !supportedText(metadata.interface.short_description)) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent metadata has an unsupported shape.", { path: packagePath(rootPath, agentPath) })];
  }
  if (metadata.interface.brand_color !== undefined && (typeof metadata.interface.brand_color !== "string" || !/^#[0-9A-Fa-f]{6}$/u.test(metadata.interface.brand_color))) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent metadata has an invalid brand color.", { path: packagePath(rootPath, agentPath), field: "brand_color" })];
  }
  if (metadata.interface.default_prompt !== undefined && !supportedText(metadata.interface.default_prompt)) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent metadata has an invalid default prompt.", { path: packagePath(rootPath, agentPath), field: "default_prompt" })];
  }
  if (metadata.policy !== undefined && (!isRecord(metadata.policy) || rejectUnknownKeys(metadata.policy, policyKeys)
    || (metadata.policy.products !== undefined && (!Array.isArray(metadata.policy.products) || metadata.policy.products.length === 0
      || new Set(metadata.policy.products).size !== metadata.policy.products.length
      || metadata.policy.products.some((product) => product !== "CHAT" && product !== "CODEX")))
    || (metadata.policy.allow_implicit_invocation !== undefined && typeof metadata.policy.allow_implicit_invocation !== "boolean"))) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent policy has an unsupported shape.", { path: packagePath(rootPath, agentPath), field: "policy" })];
  }
  if (metadata.dependencies !== undefined && (!isRecord(metadata.dependencies) || rejectUnknownKeys(metadata.dependencies, dependencyKeys)
    || !Array.isArray(metadata.dependencies.tools) || metadata.dependencies.tools.length === 0
    || metadata.dependencies.tools.some((tool) => !isToolDescriptor(tool)))) {
    return [finding("plugin.submission.skill.agent.invalid_shape", "Optional agent dependencies have an unsupported shape.", { path: packagePath(rootPath, agentPath), field: "dependencies" })];
  }

  for (const field of ["icon_small", "icon_large"] as const) {
    const value = metadata.interface[field];
    if (value === undefined) continue;
    const iconFinding = await validateIconPath(rootPath, canonicalRoot, skillRoot, skillPath, field, value);
    if (iconFinding) return [iconFinding];
  }
  return [];
}

export async function validateSubmissionSkillMetadata(
  discoveredPackage: DiscoveredPackage,
  targetType: TargetType
): Promise<SubmissionSkillMetadataResult> {
  const { manifest, rootPath } = discoveredPackage;
  if (manifest.skills === undefined) {
    return targetType === "skills-only"
      ? { findings: [finding("plugin.submission.skill.required", "Skills-only submissions require a valid skill.")], skillCount: 0 }
      : { findings: [], skillCount: 0 };
  }
  if (manifest.skills !== "./skills" && manifest.skills !== "./skills/") {
    return { findings: [finding("plugin.submission.skill.invalid_manifest", "Skills must be declared as the root ./skills directory.", { field: "skills" })], skillCount: 0 };
  }

  const skillsPath = path.resolve(rootPath, manifest.skills);
  const safe = await safeDirectory(rootPath, skillsPath);
  if (!safe) {
    return { findings: [finding("plugin.submission.skill.invalid_path", "Skills directory must be canonically contained in the package.", { path: "skills" })], skillCount: 0 };
  }

  let entries;
  try {
    entries = await readdir(skillsPath, { withFileTypes: true });
  } catch {
    return { findings: [finding("plugin.submission.skill.invalid_path", "Skills directory cannot be inspected safely.", { path: "skills" })], skillCount: 0 };
  }
  const findings: SubmissionFinding[] = [];
  const identities = new Set<string>();
  let skillCount = 0;
  for (const entry of entries.filter((candidate) => !candidate.name.startsWith(".") && candidate.isDirectory())) {
    const skillRoot = path.join(skillsPath, entry.name);
    const skillFile = path.join(skillRoot, "SKILL.md");
    const relativeSkillPath = packagePath(rootPath, skillFile);
    let canonicalSkill: string;
    try {
      canonicalSkill = await realpath(skillRoot);
      if (!isWithin(safe.canonicalSkills, canonicalSkill)) throw new Error("unsafe skill root");
    } catch {
      findings.push(finding("plugin.submission.skill.invalid_path", "Skill directory resolves outside the declared skills directory.", { path: packagePath(rootPath, skillRoot) }));
      continue;
    }
    try {
      const details = await lstat(skillFile);
      if (details.isSymbolicLink()) {
        findings.push(finding("plugin.submission.skill.invalid_path", "Skill entrypoint must not be a symbolic link.", { path: relativeSkillPath }));
        continue;
      }
      if (!details.isFile() || !isWithin(canonicalSkill, await realpath(skillFile))) {
        findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint must be a contained regular file.", { path: relativeSkillPath }));
        continue;
      }
    } catch {
      findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint must be a contained regular file.", { path: relativeSkillPath }));
      continue;
    }
    const source = await readSafeUtf8(skillFile, maxSkillBytes);
    if (source === null) {
      findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint must be a bounded UTF-8 regular file.", { path: relativeSkillPath, limit: maxSkillBytes }));
      continue;
    }
    const split = splitSkillFile(source);
    if (!split) {
      findings.push(finding("plugin.submission.skill.invalid_file", "Skill entrypoint requires delimited frontmatter and a nonempty body.", { path: relativeSkillPath }));
      continue;
    }
    const parsed = parseSafeYaml(split.frontmatter);
    if ("error" in parsed) {
      findings.push(finding(
        parsed.error === "yaml" ? "plugin.submission.skill.invalid_yaml" : "plugin.submission.skill.invalid_shape",
        "Skill frontmatter must be a safe YAML mapping.",
        { path: relativeSkillPath }
      ));
      continue;
    }
    const name = parsed.value.name;
    const description = parsed.value.description;
    const normalizedName = typeof name === "string" ? name.normalize("NFKC").trim() : "";
    const pluginName = typeof manifest.name === "string" ? manifest.name.normalize("NFKC").trim() : "";
    if (!supportedText(name) || !supportedText(description, 1024) || normalizedName.length === 0
      || `${pluginName}:${normalizedName}`.length > 64 || identities.has(normalizedName)) {
      findings.push(finding("plugin.submission.skill.identity", "Skill identity metadata is invalid or duplicated.", { path: relativeSkillPath, limit: 64 }));
      continue;
    }
    identities.add(normalizedName);
    skillCount += 1;
    findings.push(...await validateAgentFile(rootPath, skillRoot, packagePath(rootPath, skillRoot)));
  }
  if (targetType === "skills-only" && skillCount === 0 && !findings.some((item) => item.id === "plugin.submission.skill.required")) {
    findings.push(finding("plugin.submission.skill.required", "Skills-only submissions require at least one valid skill.", { count: 0 }));
  }
  if (targetType === "mcp-backed" && skillCount === 0 && findings.length === 0) {
    findings.push(finding("plugin.submission.skill.invalid_file", "Declared skills must include at least one valid immediate skill entrypoint.", { path: "skills" }));
  }
  return { findings, skillCount };
}
