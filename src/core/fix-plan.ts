import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
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

  return {
    targetPath: rootPath,
    actions
  };
}

export function renderFixPlan(plan: FixPlan, mode: "dry-run"): string {
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

async function backupFile(rootPath: string, backupDirectory: string, filePath: string): Promise<void> {
  const relativePath = path.relative(rootPath, filePath);
  const backupPath = path.join(backupDirectory, relativePath);

  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(filePath, backupPath);
}

export async function applyFixPlan(targetPath: string): Promise<ApplyFixPlanResult> {
  const plan = await buildFixPlan(targetPath);
  const backupDirectory = path.join(plan.targetPath, ".codex-doctor-backups", timestampForPath());
  let filesChanged = 0;

  for (const action of plan.actions) {
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
    }
  }

  return {
    plan,
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
