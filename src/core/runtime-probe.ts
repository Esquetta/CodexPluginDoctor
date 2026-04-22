import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type { DiscoveredPackage, Finding } from "../domain/types.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";

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

function buildWarning(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string
): Finding {
  return {
    id,
    severity: "warn",
    message,
    impact,
    suggestedFix
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinding(value: unknown): value is Finding {
  return (
    isPlainObject(value) &&
    typeof value.id === "string" &&
    (value.severity === "fail" || value.severity === "warn") &&
    typeof value.message === "string" &&
    typeof value.impact === "string" &&
    typeof value.suggestedFix === "string"
  );
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
    let finalizeRequested = false;

    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    const pendingRequests = new Map<
      number,
      {
        resolve: (message: Record<string, unknown>) => void;
        reject: (finding: Finding) => void;
        timer: NodeJS.Timeout;
      }
    >();

    const settle = (finding: Finding | null) => {
      if (settled) {
        return;
      }

      settled = true;
      stdoutReader.close();
      for (const pendingRequest of pendingRequests.values()) {
        clearTimeout(pendingRequest.timer);
      }
      pendingRequests.clear();

      if (child.exitCode === null && !child.killed) {
        finalizeRequested = true;
        child.stdin.end();
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

    stdoutReader.on("line", (line) => {
      if (settled) {
        return;
      }

      let message: unknown;

      try {
        message = JSON.parse(line);
      } catch {
        settle(
          buildFailure(
            "plugin.runtime.protocol.invalid_message",
            `The MCP server \`${serverName}\` wrote a non-JSON line to stdout.`,
            "MCP stdio transport requires newline-delimited JSON-RPC messages on stdout, so non-JSON output breaks protocol communication.",
            "Ensure the server only writes valid MCP messages to stdout and sends logs to stderr instead."
          )
        );
        return;
      }

      if (!isPlainObject(message)) {
        settle(
          buildFailure(
            "plugin.runtime.protocol.invalid_message",
            `The MCP server \`${serverName}\` wrote a non-object message to stdout.`,
            "MCP stdio transport requires JSON-RPC objects for requests, responses, and notifications.",
            "Ensure the server writes JSON-RPC objects to stdout."
          )
        );
        return;
      }

      const id = message.id;

      if (typeof id === "number" && pendingRequests.has(id)) {
        const pendingRequest = pendingRequests.get(id);

        if (!pendingRequest) {
          return;
        }

        clearTimeout(pendingRequest.timer);
        pendingRequests.delete(id);
        pendingRequest.resolve(message);
      }
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
      if (settled || finalizeRequested) {
        return;
      }

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

    const sendRequest = (
      id: number,
      method: string,
      params: Record<string, unknown> | undefined,
      timeoutFinding: Finding
    ): Promise<Record<string, unknown>> =>
      new Promise((requestResolve, requestReject) => {
        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          requestReject(timeoutFinding);
        }, startupTimeoutMs);

        pendingRequests.set(id, {
          resolve: requestResolve,
          reject: requestReject,
          timer
        });

        child.stdin.write(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id,
            method,
            ...(params ? { params } : {})
          })}\n`
        );
      });

    const isValidInitializeResult = (message: Record<string, unknown>): boolean => {
      if (!isPlainObject(message.result)) {
        return false;
      }

      const result = message.result;

      return (
        typeof result.protocolVersion === "string" &&
        isPlainObject(result.capabilities) &&
        isPlainObject(result.serverInfo) &&
        typeof result.serverInfo.name === "string" &&
        typeof result.serverInfo.version === "string"
      );
    };

    const hasToolsCapability = (message: Record<string, unknown>): boolean => {
      if (!isPlainObject(message.result)) {
        return false;
      }

      const capabilities = message.result.capabilities;

      return isPlainObject(capabilities) && isPlainObject(capabilities.tools);
    };

    const isValidToolsListResult = (message: Record<string, unknown>): boolean => {
      if (!isPlainObject(message.result)) {
        return false;
      }

      const tools = message.result.tools;

      if (!Array.isArray(tools)) {
        return false;
      }

      return tools.every((tool) => {
        if (!isPlainObject(tool)) {
          return false;
        }

        return (
          typeof tool.name === "string" &&
          isPlainObject(tool.inputSchema) &&
          tool.inputSchema.type === "object"
        );
      });
    };

    const runProtocolProbe = async () => {
      const initializeResponse = await sendRequest(
        1,
        "initialize",
        {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "codex-plugin-doctor",
            version: "0.1.0"
          }
        },
        buildFailure(
          "plugin.runtime.initialize.timeout",
          `The MCP server \`${serverName}\` did not answer the initialize request in time.`,
          "If initialize never completes, Codex cannot negotiate protocol capabilities with this server.",
          "Reduce server startup latency or inspect why the initialize request is not being handled."
        )
      );

      if (!isValidInitializeResult(initializeResponse)) {
        settle(
          buildFailure(
            "plugin.runtime.initialize.invalid",
            `The MCP server \`${serverName}\` returned an invalid initialize result.`,
            "A malformed initialize response means the server is not completing the MCP handshake correctly.",
            "Return `protocolVersion`, `capabilities`, and `serverInfo` in the initialize result."
          )
        );
        return;
      }

      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized"
        })}\n`
      );

      if (!hasToolsCapability(initializeResponse)) {
        settle(
          buildWarning(
            "plugin.runtime.tools.unsupported",
            `The MCP server \`${serverName}\` does not advertise tools capability.`,
            "Codex cannot use `tools/list` for deeper validation if the server does not declare tools support.",
            "Expose `capabilities.tools` during initialize if this server is expected to provide tools."
          )
        );
        return;
      }

      const toolsListResponse = await sendRequest(
        2,
        "tools/list",
        undefined,
        buildFailure(
          "plugin.runtime.tools_list.timeout",
          `The MCP server \`${serverName}\` did not answer the tools/list request in time.`,
          "A server that cannot return its tool catalog in time will feel broken or invisible in Codex.",
          "Inspect the tool discovery path and reduce latency before returning the tool list."
        )
      );

      if (!isValidToolsListResult(toolsListResponse)) {
        settle(
          buildFailure(
            "plugin.runtime.tools_list.invalid",
            `The MCP server \`${serverName}\` returned an invalid tools/list result.`,
            "Codex cannot safely consume malformed tool definitions from `tools/list`.",
            "Return a `tools` array where every tool has a string `name` and an object-shaped `inputSchema` with `type: \"object\"`."
          )
        );
        return;
      }

      settle(null);
    };

    runProtocolProbe().catch((error) => {
      if (settled) {
        return;
      }

      if (isFinding(error)) {
        settle(error);
        return;
      }

      settle(
        buildFailure(
          "plugin.runtime.protocol.unhandled",
          `The MCP server \`${serverName}\` triggered an unexpected protocol probe failure.`,
          "Unexpected probe failures reduce confidence in runtime validation results.",
          stderrPreview.trim().length > 0
            ? `Inspect stderr for details: ${stderrPreview.trim()}`
            : "Inspect the server output and protocol implementation for unexpected runtime errors."
        )
      );
    });
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
