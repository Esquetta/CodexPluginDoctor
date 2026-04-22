import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import type { DiscoveredPackage, Finding } from "../domain/types.js";

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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

async function loadMcpServers(
  discoveredPackage: DiscoveredPackage
): Promise<Record<string, unknown> | null> {
  const { manifest, rootPath } = discoveredPackage;

  if (!manifest.mcpServers) {
    return null;
  }

  const mcpConfigPath = path.resolve(rootPath, manifest.mcpServers);
  const exists = await fileExists(mcpConfigPath);

  if (!exists) {
    return null;
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(await readFile(mcpConfigPath, "utf8"));
  } catch {
    return null;
  }

  if (!isPlainObject(parsedConfig)) {
    return null;
  }

  const servers = parsedConfig.mcpServers;

  if (!isPlainObject(servers)) {
    return null;
  }

  return servers;
}

async function probeCommandServer(input: {
  serverName: string;
  command: string;
  args: string[];
  cwd: string;
  startupTimeoutMs: number;
}): Promise<Finding | null> {
  const { serverName, command, args, cwd, startupTimeoutMs } = input;

  return new Promise((resolve) => {
    let settled = false;
    let stderrPreview = "";
    let exitCode: number | null = null;

    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const settle = (finding: Finding | null) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(startupTimer);

      if (child.exitCode === null && !child.killed) {
        child.kill("SIGTERM");
      }

      resolve(finding);
    };

    child.stderr?.on("data", (chunk: Buffer | string) => {
      if (stderrPreview.length >= 160) {
        return;
      }

      stderrPreview += chunk.toString();
    });

    child.on("error", () => {
      settle(
        buildFailure(
          "plugin.runtime.startup.failed",
          `The MCP server \`${serverName}\` could not be started.`,
          "The configured stdio server could not be launched, so runtime validation cannot proceed.",
          `Verify the command \`${command}\` is installed and executable from \`${cwd}\`.`
        )
      );
    });

    child.on("exit", (code) => {
      exitCode = code;

      settle(
        buildFailure(
          "plugin.runtime.exited_early",
          `The MCP server \`${serverName}\` exited before the startup probe completed.`,
          "A server that exits immediately is unlikely to remain available for Codex during normal use.",
          stderrPreview.trim().length > 0
            ? `Inspect the startup error output: ${stderrPreview.trim()}`
            : `Keep the \`${serverName}\` process running after startup and inspect its command or arguments.`
        )
      );
    });

    const startupTimer = setTimeout(() => {
      if (exitCode !== null) {
        return;
      }

      settle(null);
    }, startupTimeoutMs);
  });
}

export async function probeRuntime(
  discoveredPackage: DiscoveredPackage,
  startupTimeoutMs = 400
): Promise<Finding[]> {
  const servers = await loadMcpServers(discoveredPackage);

  if (!servers) {
    return [];
  }

  const findings: Finding[] = [];

  for (const [serverName, config] of Object.entries(servers)) {
    if (!isPlainObject(config)) {
      continue;
    }

    const command = config.command;

    if (typeof command !== "string") {
      continue;
    }

    const args = Array.isArray(config.args)
      ? config.args
          .filter((value): value is string => typeof value === "string")
      : [];
    const cwd =
      typeof config.cwd === "string"
        ? path.resolve(discoveredPackage.rootPath, config.cwd)
        : discoveredPackage.rootPath;

    const finding = await probeCommandServer({
      serverName,
      command,
      args,
      cwd,
      startupTimeoutMs
    });

    if (finding) {
      findings.push(finding);
    }
  }

  return findings;
}
