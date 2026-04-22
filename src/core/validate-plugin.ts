import { stat } from "node:fs/promises";
import path from "node:path";

import type { CheckResult, DiscoveredPackage, Finding } from "../domain/types.js";
import { discoverPackage } from "./discover-package.js";

function buildFailure(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string
): Finding {
  return {
    id,
    severity: "fail",
    message,
    impact,
    suggestedFix
  };
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

function validateRequiredManifestFields(
  discoveredPackage: DiscoveredPackage
): Finding[] {
  const findings: Finding[] = [];
  const { manifest } = discoveredPackage;

  if (!manifest.name) {
    findings.push(
      buildFailure(
        "plugin.manifest.name.missing",
        "The plugin manifest is missing a `name` field.",
        "Codex cannot identify the plugin reliably without a stable package name.",
        "Add a kebab-case `name` field to `.codex-plugin/plugin.json`."
      )
    );
  }

  if (!manifest.version) {
    findings.push(
      buildFailure(
        "plugin.manifest.version.missing",
        "The plugin manifest is missing a `version` field.",
        "Release and compatibility workflows cannot reason about the package version.",
        "Add a semantic `version` field to `.codex-plugin/plugin.json`."
      )
    );
  }

  if (!manifest.description) {
    findings.push(
      buildFailure(
        "plugin.manifest.description.missing",
        "The plugin manifest is missing a `description` field.",
        "The package will be harder to understand and present in Codex surfaces.",
        "Add a concise `description` field to `.codex-plugin/plugin.json`."
      )
    );
  }

  return findings;
}

async function validateSkillsDirectory(
  discoveredPackage: DiscoveredPackage
): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;

  if (!manifest.skills) {
    return [];
  }

  const skillsPath = path.resolve(rootPath, manifest.skills);
  const exists = await directoryExists(skillsPath);

  if (exists) {
    return [];
  }

  return [
    buildFailure(
      "plugin.skills.path.missing",
      "The plugin manifest points to a missing skills directory.",
      "Codex will not be able to load the packaged skills as expected.",
      `Create the skills directory at \`${skillsPath}\` or update the manifest path.`
    )
  ];
}

export async function validatePlugin(targetPath: string): Promise<CheckResult> {
  const discoveredPackage = await discoverPackage(targetPath);

  if (!discoveredPackage) {
    return {
      targetPath: path.resolve(targetPath),
      status: "fail",
      exitCode: 1,
      findings: [
        buildFailure(
          "plugin.manifest.missing",
          "Missing required `.codex-plugin/plugin.json` manifest.",
          "Codex cannot treat this directory as a plugin package without the required manifest entry point.",
          "Create `.codex-plugin/plugin.json` with at least `name`, `version`, and `description`."
        )
      ]
    };
  }

  const findings = [
    ...validateRequiredManifestFields(discoveredPackage),
    ...(await validateSkillsDirectory(discoveredPackage))
  ];

  if (findings.length === 0) {
    return {
      targetPath: discoveredPackage.rootPath,
      status: "pass",
      exitCode: 0,
      findings: []
    };
  }

  return {
    targetPath: discoveredPackage.rootPath,
    status: "fail",
    exitCode: 1,
    findings
  };
}

