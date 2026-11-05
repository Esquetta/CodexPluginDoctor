import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  pluginHookEvents,
  type DiscoveredPackage,
  type Finding,
  type FindingEvidence
} from "../domain/types.js";
import { auditHookCommand } from "../security/security-audit.js";
import { resolveSafePackagePath } from "./plugin-components.js";

const ignoredMatcherEvents = new Set(["Stop", "UserPromptSubmit", "PreModelRequest", "PostModelRequest", "Interrupt"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

// Codex stores MCP hook input as TOML, which has no null.
function containsNull(value: unknown): boolean {
  if (value === null) return true;
  if (Array.isArray(value)) return value.some(containsNull);
  return isPlainObject(value) && Object.values(value).some(containsNull);
}

function packagePath(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).replace(/\\/g, "/") || ".";
}

function finding(
  severity: "fail" | "warn",
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  evidence: FindingEvidence
): Finding {
  return { severity, id, message, impact, suggestedFix, evidence };
}

function invalidShape(sourcePath: string, field: string): Finding {
  return finding(
    "fail",
    "plugin.hook.invalid_shape",
    "The plugin lifecycle hook configuration has an invalid shape.",
    "Codex cannot safely interpret malformed lifecycle hook metadata.",
    "Use the official hook configuration schema for this field.",
    { sourcePath, field }
  );
}

function unsupportedEvent(sourcePath: string, event: string): Finding {
  return finding(
    "fail",
    "plugin.hook.unsupported_event",
    `The plugin lifecycle hook event \`${event}\` is not supported.`,
    "Codex will not invoke hook events outside the official lifecycle event set.",
    "Use one of the official plugin lifecycle hook events.",
    { sourcePath, event }
  );
}

function invalidHookPath(manifestPath: string): Finding {
  return finding(
    "fail",
    "plugin.hook.invalid_path",
    "The plugin lifecycle hook source must be a safe package-relative path.",
    "Paths outside the plugin package can expose unreviewed files to hook configuration loading.",
    "Use a `./` hook configuration path that stays within the plugin package.",
    { sourcePath: manifestPath, field: "hooks" }
  );
}

function warning(id: string, sourcePath: string, event: string, field: string): Finding {
  const messages: Record<string, [string, string, string]> = {
    "plugin.hook.unsupported_handler": [
      "A plugin lifecycle hook uses a handler type the host skips.",
      "The host skips prompt and agent handlers, and MCP tool handlers on `SessionEnd`.",
      "Use a command handler, or an MCP tool handler on another event, for behavior that must run."
    ],
    "plugin.hook.async_unsupported": [
      "A plugin lifecycle hook requests unsupported asynchronous execution.",
      "The host runs `SessionEnd` hooks and MCP tool handlers synchronously and skips prompt and agent handlers.",
      "Remove `async: true` from this handler."
    ],
    "plugin.hook.matcher_ignored": [
      "A plugin lifecycle hook matcher is ignored for this event.",
      "This lifecycle event does not use matcher filtering.",
      "Remove the matcher from this event group."
    ]
  };
  const [message, impact, suggestedFix] = messages[id];
  return finding("warn", id, message, impact, suggestedFix, { sourcePath, event, field });
}

function validateTimeoutAndStatus(
  value: Record<string, unknown>,
  sourcePath: string,
  event: string,
  field: string
): Finding[] {
  const findings: Finding[] = [];
  if (value.timeout !== undefined && (
    typeof value.timeout !== "number" || !Number.isFinite(value.timeout) || value.timeout <= 0
  )) {
    findings.push(invalidShape(sourcePath, `${field}.timeout`));
  }
  if (event === "SessionEnd" && typeof value.timeout === "number" && value.timeout > 3) {
    findings.push(invalidShape(sourcePath, `${field}.timeout`));
  }
  if (value.statusMessage !== undefined && typeof value.statusMessage !== "string") {
    findings.push(invalidShape(sourcePath, `${field}.statusMessage`));
  }
  return findings;
}

function validateHandler(
  rootPath: string,
  value: unknown,
  sourcePath: string,
  event: string,
  groupIndex: number,
  handlerIndex: number
): Finding[] {
  const field = `hooks.${event}[${groupIndex}].hooks[${handlerIndex}]`;
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return [invalidShape(sourcePath, field)];
  }

  const findings: Finding[] = [];
  if (value.type !== "command" && value.type !== "mcp_tool" && value.type !== "prompt" && value.type !== "agent") {
    return [invalidShape(sourcePath, `${field}.type`)];
  }

  // Codex runs command hooks asynchronously on every event except SessionEnd; other handler types have no async field.
  if (value.type === "command" && value.async !== undefined && typeof value.async !== "boolean") {
    findings.push(invalidShape(sourcePath, `${field}.async`));
  } else if (value.async === true && (value.type !== "command" || event === "SessionEnd")) {
    findings.push(warning("plugin.hook.async_unsupported", sourcePath, event, `${field}.async`));
  }

  if (value.type === "prompt" || value.type === "agent") {
    findings.push(warning("plugin.hook.unsupported_handler", sourcePath, event, `${field}.type`));
    return findings;
  }

  if (value.type === "mcp_tool") {
    if (event === "SessionEnd") {
      findings.push(warning("plugin.hook.unsupported_handler", sourcePath, event, `${field}.type`));
    }
    if (!isNonBlankString(value.server)) findings.push(invalidShape(sourcePath, `${field}.server`));
    if (!isNonBlankString(value.tool)) findings.push(invalidShape(sourcePath, `${field}.tool`));
    if (value.input !== undefined && (!isPlainObject(value.input) || containsNull(value.input))) {
      findings.push(invalidShape(sourcePath, `${field}.input`));
    }
    findings.push(...validateTimeoutAndStatus(value, sourcePath, event, field));
    return findings;
  }

  if (typeof value.command !== "string") {
    findings.push(invalidShape(sourcePath, `${field}.command`));
  } else {
    findings.push(...auditHookCommand(rootPath, sourcePath, event, `${field}.command`, value.command));
  }
  if (value.commandWindows !== undefined) {
    if (typeof value.commandWindows !== "string") {
      findings.push(invalidShape(sourcePath, `${field}.commandWindows`));
    } else {
      findings.push(...auditHookCommand(rootPath, sourcePath, event, `${field}.commandWindows`, value.commandWindows));
    }
  }
  findings.push(...validateTimeoutAndStatus(value, sourcePath, event, field));
  if (value.additionalContextLimit !== undefined && (
    typeof value.additionalContextLimit !== "number" ||
    !Number.isFinite(value.additionalContextLimit) ||
    value.additionalContextLimit < 0
  )) {
    findings.push(invalidShape(sourcePath, `${field}.additionalContextLimit`));
  }
  return findings;
}

function validateConfig(rootPath: string, config: unknown, sourcePath: string): Finding[] {
  if (!isPlainObject(config)) return [invalidShape(sourcePath, "root")];
  const findings: Finding[] = [];
  if (config.description !== undefined && typeof config.description !== "string") {
    findings.push(invalidShape(sourcePath, "description"));
  }
  if (!isPlainObject(config.hooks)) {
    findings.push(invalidShape(sourcePath, "hooks"));
    return findings;
  }

  for (const [event, groups] of Object.entries(config.hooks)) {
    if (!(pluginHookEvents as readonly string[]).includes(event)) {
      findings.push(unsupportedEvent(sourcePath, event));
      continue;
    }
    if (!Array.isArray(groups)) {
      findings.push(invalidShape(sourcePath, `hooks.${event}`));
      continue;
    }
    groups.forEach((group, groupIndex) => {
      const groupField = `hooks.${event}[${groupIndex}]`;
      if (!isPlainObject(group)) {
        findings.push(invalidShape(sourcePath, groupField));
        return;
      }
      if (group.matcher !== undefined && typeof group.matcher !== "string") {
        findings.push(invalidShape(sourcePath, `${groupField}.matcher`));
      } else if (typeof group.matcher === "string" && ignoredMatcherEvents.has(event)) {
        findings.push(warning("plugin.hook.matcher_ignored", sourcePath, event, `${groupField}.matcher`));
      }
      if (!Array.isArray(group.hooks)) {
        findings.push(invalidShape(sourcePath, `${groupField}.hooks`));
        return;
      }
      group.hooks.forEach((handler, handlerIndex) => {
        findings.push(...validateHandler(rootPath, handler, sourcePath, event, groupIndex, handlerIndex));
      });
    });
  }
  return findings;
}

async function validateHookFile(
  rootPath: string,
  manifestPath: string,
  source: string
): Promise<Finding[]> {
  const resolved = await resolveSafePackagePath(rootPath, source);
  if (!resolved) {
    return [invalidHookPath(manifestPath)];
  }
  try {
    if (!(await stat(resolved.path)).isFile()) throw new Error("not a regular file");
  } catch {
    return [finding(
      "fail",
      "plugin.hook.missing_file",
      "The plugin lifecycle hook source file is missing.",
      "Codex cannot load a hook configuration file that is absent or not a regular file.",
      "Create the referenced hook configuration JSON file inside the plugin package.",
      { sourcePath: resolved.packagePath }
    )];
  }
  try {
    return validateConfig(rootPath, JSON.parse(await readFile(resolved.path, "utf8")), resolved.packagePath);
  } catch {
    return [finding(
      "fail",
      "plugin.hook.invalid_json",
      "The plugin lifecycle hook source is not valid JSON.",
      "Codex cannot parse the hook configuration.",
      "Fix the JSON syntax in the hook configuration file.",
      { sourcePath: resolved.packagePath }
    )];
  }
}

export async function validatePluginHooks(discoveredPackage: DiscoveredPackage): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;
  const manifestPath = packagePath(rootPath, discoveredPackage.manifestPath);
  const configuredHooks = manifest.hooks;

  if (configuredHooks === undefined) {
    const defaultPath = "./hooks/hooks.json";
    const resolved = await resolveSafePackagePath(rootPath, defaultPath);
    if (!resolved) return [invalidHookPath(manifestPath)];
    try {
      if (!(await stat(resolved.path)).isFile()) return [];
    } catch {
      return [];
    }
    return validateHookFile(rootPath, manifestPath, defaultPath);
  }

  if (typeof configuredHooks === "string") {
    return validateHookFile(rootPath, manifestPath, configuredHooks);
  }
  if (Array.isArray(configuredHooks)) {
    if (configuredHooks.length === 0) return [];
    if (configuredHooks.every((value) => typeof value === "string")) {
      return (await Promise.all(configuredHooks.map((source) => validateHookFile(rootPath, manifestPath, source)))).flat();
    }
    if (configuredHooks.every(isPlainObject)) {
      return configuredHooks.flatMap((config) => validateConfig(rootPath, config, manifestPath));
    }
    return [invalidShape(manifestPath, "hooks")];
  }
  return validateConfig(rootPath, configuredHooks, manifestPath);
}
