import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { validatePlugin } from "./validate-plugin.js";

export interface FixPlanAction {
  id: string;
  title: string;
  targetPath: string;
  operation: "update-json" | "mkdir";
  details: string;
}

export interface FixPlan {
  targetPath: string;
  actions: FixPlanAction[];
}

export interface ApplyFixPlanResult {
  plan: FixPlan;
  filesChanged: number;
  backupDirectory: string;
}

export interface ApplyFixPlanOptions {
  actionIndexes?: number[];
}

export interface FixPlanJsonReport {
  schemaVersion: "1.0.0";
  mode: "dry-run" | "apply";
  targetPath: string;
  filesChanged: number;
  backupDirectory: string | null;
  actions: Array<FixPlanAction & {
    relativePath: string;
  }>;
}

function relativeToTarget(targetPath: string, candidatePath: string): string {
  return path.relative(targetPath, candidatePath).replace(/\\/g, "/");
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

export async function buildFixPlan(targetPath: string): Promise<FixPlan> {
  const result = await validatePlugin(targetPath);
  const rootPath = result.targetPath;
  const actions: FixPlanAction[] = [];
  const findingIds = new Set(result.findings.map((finding) => finding.id));
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");

  if (
    findingIds.has("plugin.manifest.version.missing") ||
    findingIds.has("plugin.manifest.description.missing")
  ) {
    const fields = [
      findingIds.has("plugin.manifest.version.missing") ? "`version`" : null,
      findingIds.has("plugin.manifest.description.missing") ? "`description`" : null
    ].filter(Boolean);

    actions.push({
      id: "manifest.safe_defaults",
      title: "Add missing safe manifest defaults",
      targetPath: manifestPath,
      operation: "update-json",
      details: `Set ${fields.join(" and ")} in ${relativeToTarget(rootPath, manifestPath)}.`
    });
  }

  if (findingIds.has("plugin.skills.path.missing")) {
    actions.push({
      id: "skills.create_directory",
      title: "Create missing skills directory",
      targetPath: path.join(rootPath, "skills"),
      operation: "mkdir",
      details: "Create the skills directory referenced by the manifest."
    });
  }

  const manifest: { skills?: unknown; mcpServers?: unknown } = await readFile(manifestPath, "utf8")
    .then((content) => JSON.parse(content) as { skills?: unknown; mcpServers?: unknown })
    .catch(() => ({}));

  if (typeof manifest.skills === "string") {
    const skillsPath = path.resolve(rootPath, manifest.skills);

    if (!isPathWithinRoot(rootPath, skillsPath)) {
      return {
        targetPath: rootPath,
        actions
      };
    }

    if (await directoryExists(skillsPath)) {
      for (const entry of await readdir(skillsPath, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillFilePath = path.join(skillsPath, entry.name, "SKILL.md");

        if (!(await fileExists(skillFilePath))) {
          actions.push({
            id: "skill.scaffold_skill_md",
            title: `Create missing SKILL.md for ${entry.name}`,
            targetPath: skillFilePath,
            operation: "update-json",
            details: `Create ${relativeToTarget(rootPath, skillFilePath)} with safe frontmatter.`
          });
          continue;
        }

        const skillContent = await readFile(skillFilePath, "utf8");
        const frontmatter = skillContent.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";

        if (!/^name\s*:/im.test(frontmatter) || !/^description\s*:/im.test(frontmatter)) {
          actions.push({
            id: "skill.safe_frontmatter_defaults",
            title: `Add missing skill frontmatter defaults for ${entry.name}`,
            targetPath: skillFilePath,
            operation: "update-json",
            details: `Set missing name/description fields in ${relativeToTarget(rootPath, skillFilePath)}.`
          });
        }
      }
    }
  }

  if (typeof manifest.mcpServers === "string") {
    const mcpConfigPath = path.resolve(rootPath, manifest.mcpServers);

    if (!isPathWithinRoot(rootPath, mcpConfigPath)) {
      return {
        targetPath: rootPath,
        actions
      };
    }

    if (!(await fileExists(mcpConfigPath))) {
      actions.push({
        id: "mcp.scaffold_config",
        title: "Create missing MCP config",
        targetPath: mcpConfigPath,
        operation: "update-json",
        details: `Create ${relativeToTarget(rootPath, mcpConfigPath)} with an empty mcpServers object.`
      });
    }
  }

  return {
    targetPath: rootPath,
    actions
  };
}

export function renderFixPlan(plan: FixPlan, mode: "dry-run" | "interactive"): string {
  const lines = [
    "Fix Plan",
    "========",
    `Mode: ${mode}`,
    `Target: ${plan.targetPath}`
  ];

  if (plan.actions.length === 0) {
    lines.push("", "No safe automatic fixes available.");
    return lines.join("\n");
  }

  lines.push("", "Actions");
  lines.push("-------");

  plan.actions.forEach((action, index) => {
    lines.push(`${index + 1}. ${action.title}`);
    lines.push(`   Path: ${relativeToTarget(plan.targetPath, action.targetPath)}`);
    lines.push(`   Operation: ${action.operation}`);
    lines.push(`   Details: ${action.details}`);
  });

  lines.push("", "No files changed.");

  return lines.join("\n");
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function defaultManifestDescription(): string {
  return "Codex plugin package.";
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

function skillDescription(skillName: string): string {
  return `Use when running the ${skillName} skill.`;
}

function renderSkillScaffold(skillName: string, body = ""): string {
  return [
    "---",
    `name: ${skillName}`,
    `description: ${skillDescription(skillName)}`,
    "---",
    "",
    body.trim() || `# ${skillName}`
  ].join("\n") + "\n";
}

function replaceFrontmatter(content: string, skillName: string): string {
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  const frontmatter = frontmatterMatch?.[1] ?? "";
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content;
  const lines = frontmatter.split(/\r?\n/).filter((line) => line.trim());
  const hasName = lines.some((line) => /^name\s*:/i.test(line));
  const hasDescription = lines.some((line) => /^description\s*:/i.test(line));

  return [
    "---",
    ...(hasName ? [] : [`name: ${skillName}`]),
    ...(hasDescription ? [] : [`description: ${skillDescription(skillName)}`]),
    ...lines,
    "---",
    "",
    body.trim() || `# ${skillName}`
  ].join("\n") + "\n";
}

async function backupFile(rootPath: string, backupDirectory: string, filePath: string): Promise<void> {
  const relativePath = path.relative(rootPath, filePath);
  const backupPath = path.join(backupDirectory, relativePath);

  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(filePath, backupPath);
}

export async function applyFixPlan(
  targetPath: string,
  options: ApplyFixPlanOptions = {}
): Promise<ApplyFixPlanResult> {
  const plan = await buildFixPlan(targetPath);
  const selectedIndexes = new Set(options.actionIndexes ?? []);
  const actions = selectedIndexes.size === 0
    ? plan.actions
    : plan.actions.filter((_, index) => selectedIndexes.has(index + 1));
  const appliedPlan = {
    ...plan,
    actions
  };
  const backupDirectory = path.join(plan.targetPath, ".codex-doctor-backups", timestampForPath());
  let filesChanged = 0;

  for (const action of appliedPlan.actions) {
    if (action.operation === "update-json" && action.id === "manifest.safe_defaults") {
      await backupFile(plan.targetPath, backupDirectory, action.targetPath);
      const manifest = JSON.parse(await readFile(action.targetPath, "utf8")) as {
        version?: unknown;
        description?: unknown;
      };

      if (typeof manifest.version !== "string" || manifest.version.trim() === "") {
        manifest.version = "0.1.0";
      }

      if (
        typeof manifest.description !== "string" ||
        manifest.description.trim() === ""
      ) {
        manifest.description = defaultManifestDescription();
      }

      await writeFile(action.targetPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
      filesChanged += 1;
      continue;
    }

    if (action.operation === "mkdir" && action.id === "skills.create_directory") {
      await mkdir(action.targetPath, { recursive: true });
      filesChanged += 1;
      continue;
    }

    if (action.operation === "update-json" && action.id === "skill.scaffold_skill_md") {
      await mkdir(path.dirname(action.targetPath), { recursive: true });
      await writeFile(
        action.targetPath,
        renderSkillScaffold(path.basename(path.dirname(action.targetPath))),
        "utf8"
      );
      filesChanged += 1;
      continue;
    }

    if (action.operation === "update-json" && action.id === "skill.safe_frontmatter_defaults") {
      await backupFile(plan.targetPath, backupDirectory, action.targetPath);
      await writeFile(
        action.targetPath,
        replaceFrontmatter(
          await readFile(action.targetPath, "utf8"),
          path.basename(path.dirname(action.targetPath))
        ),
        "utf8"
      );
      filesChanged += 1;
      continue;
    }

    if (action.operation === "update-json" && action.id === "mcp.scaffold_config") {
      await mkdir(path.dirname(action.targetPath), { recursive: true });
      await writeFile(
        action.targetPath,
        `${JSON.stringify({ mcpServers: {} }, null, 2)}\n`,
        "utf8"
      );
      filesChanged += 1;
    }
  }

  return {
    plan: appliedPlan,
    filesChanged,
    backupDirectory
  };
}

export function renderApplyFixResult(result: ApplyFixPlanResult): string {
  return [
    "Fix Plan",
    "========",
    "Mode: apply",
    `Target: ${result.plan.targetPath}`,
    `Files changed: ${result.filesChanged}`,
    `Backup: ${relativeToTarget(result.plan.targetPath, result.backupDirectory)}`
  ].join("\n");
}

export function renderFixPlanJsonReport(
  plan: FixPlan,
  options: {
    mode: "dry-run" | "apply";
    filesChanged?: number;
    backupDirectory?: string | null;
  }
): string {
  const report: FixPlanJsonReport = {
    schemaVersion: "1.0.0",
    mode: options.mode,
    targetPath: plan.targetPath,
    filesChanged: options.filesChanged ?? 0,
    backupDirectory: options.backupDirectory ?? null,
    actions: plan.actions.map((action) => ({
      ...action,
      relativePath: relativeToTarget(plan.targetPath, action.targetPath)
    }))
  };

  return JSON.stringify(report, null, 2);
}
