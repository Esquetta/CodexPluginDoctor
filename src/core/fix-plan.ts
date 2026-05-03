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
