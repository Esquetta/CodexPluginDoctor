import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export interface InitPluginResult {
  rootPath: string;
  manifestPath: string;
  skillPath: string;
}

function toPackageName(inputPath: string): string {
  return path.basename(path.resolve(inputPath))
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "codex-plugin";
}

export async function initPluginPackage(
  targetPath: string
): Promise<InitPluginResult> {
  const rootPath = path.resolve(targetPath);
  const manifestDirectory = path.join(rootPath, ".codex-plugin");
  const skillsDirectory = path.join(rootPath, "skills", "hello");
  const manifestPath = path.join(manifestDirectory, "plugin.json");
  const skillPath = path.join(skillsDirectory, "SKILL.md");

  await mkdir(manifestDirectory, { recursive: true });
  await mkdir(skillsDirectory, { recursive: true });

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        name: toPackageName(rootPath),
        version: "0.1.0",
        description: "A Codex plugin package scaffolded by Codex Plugin Doctor.",
        skills: "skills"
      },
      null,
      2
    )}\n`,
    "utf8"
  );

  await writeFile(
    skillPath,
    [
      "---",
      "name: hello",
      "description: Use when verifying that this Codex plugin package loads correctly.",
      "---",
      "",
      "# Hello",
      "",
      "This starter skill confirms the plugin package structure is valid.",
      ""
    ].join("\n"),
    "utf8"
  );

  return {
    rootPath,
    manifestPath,
    skillPath
  };
}
