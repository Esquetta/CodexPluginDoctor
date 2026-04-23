import { spawn } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

import type {
  DiscoveredPackage,
  Finding,
  RuntimeProbeResult,
  RuntimeScorecard
} from "../domain/types.js";
import {
  formatRequestTranscript as formatRequestTranscriptForLog,
  formatResponseTranscript as formatResponseTranscriptForLog
} from "./runtime-transcript.js";

const MCP_PROTOCOL_VERSION = "2025-11-25";
const PROMPT_PROBE_PLACEHOLDER = "codex-plugin-doctor-probe";
const METHOD_NOT_FOUND = -32601;

type JsonObject = Record<string, unknown>;

type ToolDefinition = {
  name: string;
  inputSchema: JsonObject;
};

type ResourceDefinition = {
  name: string;
  uri: string;
};

type ResourceTemplateDefinition = {
  name: string;
  uriTemplate: string;
};

type PromptDefinition = {
  name: string;
  arguments?: Array<{
    name: string;
    required?: boolean;
  }>;
};

type PendingRequest = {
  method: string;
  resolve: (message: JsonObject) => void;
  reject: (finding: Finding) => void;
  timer: NodeJS.Timeout;
};

function createRuntimeScorecard(): RuntimeScorecard {
  return {
    initialize: "skipped",
    toolsList: "unsupported",
    toolsCall: "unsupported",
    resourcesList: "unsupported",
    resourceRead: "unsupported",
    resourceTemplatesList: "unsupported",
    promptsList: "unsupported",
    promptGet: "unsupported"
  };
}

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

function isPlainObject(value: unknown): value is JsonObject {
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

function isErrorResponse(message: JsonObject): boolean {
  return isPlainObject(message.error);
}

function getErrorObject(message: JsonObject): JsonObject | null {
  return isErrorResponse(message) ? (message.error as JsonObject) : null;
}

function getErrorCode(message: JsonObject): number | null {
  const error = getErrorObject(message);

  return error && typeof error.code === "number" ? error.code : null;
}

function sanitizeTranscriptValue(
  value: unknown,
  pathSegments: string[] = []
): unknown {
  const currentKey = pathSegments[pathSegments.length - 1];

  if (typeof value === "string") {
    if (
      currentKey === "text" ||
      currentKey === "blob" ||
      currentKey === "data" ||
      currentKey === "diff" ||
      currentKey === "arguments" ||
      /(token|secret|password|api[_-]?key|private[_-]?key)/i.test(
        currentKey ?? ""
      ) ||
      pathSegments.includes("arguments")
    ) {
      return "[REDACTED]";
    }

    if (value.length > 80) {
      return "[REDACTED]";
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeTranscriptValue(entry, [...pathSegments, String(index)])
    );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizeTranscriptValue(entryValue, [...pathSegments, key])
      ])
    );
  }

  return value;
}

function formatRequestTranscript(
  method: string,
  params: JsonObject | undefined
): string {
  if (!params) {
    return `-> ${method}`;
  }

  return `-> ${method} ${JSON.stringify(sanitizeTranscriptValue(params))}`;
}

function formatResponseTranscript(method: string, message: JsonObject): string {
  const error = getErrorObject(message);

  if (error) {
    const code = typeof error.code === "number" ? error.code : "?";
    const messageText =
      typeof error.message === "string" ? error.message : "error";

    return `<- ${method} error {"code":${code},"message":"${messageText}"}`;
  }

  if (!isPlainObject(message.result)) {
    return `<- ${method} result`;
  }

  const result = message.result;

  switch (method) {
    case "initialize":
      return `<- initialize ${JSON.stringify({
        protocolVersion: result.protocolVersion,
        capabilities: isPlainObject(result.capabilities)
          ? Object.keys(result.capabilities)
          : []
      })}`;
    case "tools/list":
      return `<- tools/list ${JSON.stringify({
        tools: Array.isArray(result.tools) ? result.tools.length : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "tools/call":
      return `<- tools/call ${JSON.stringify({
        content: Array.isArray(result.content) ? result.content.length : 0
      })}`;
    case "resources/list":
      return `<- resources/list ${JSON.stringify({
        resources: Array.isArray(result.resources) ? result.resources.length : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "resources/read":
      return `<- resources/read ${JSON.stringify({
        contents: Array.isArray(result.contents) ? result.contents.length : 0
      })}`;
    case "resources/templates/list":
      return `<- resources/templates/list ${JSON.stringify({
        resourceTemplates: Array.isArray(result.resourceTemplates)
          ? result.resourceTemplates.length
          : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "prompts/list":
      return `<- prompts/list ${JSON.stringify({
        prompts: Array.isArray(result.prompts) ? result.prompts.length : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "prompts/get":
      return `<- prompts/get ${JSON.stringify({
        messages: Array.isArray(result.messages) ? result.messages.length : 0
      })}`;
    default:
      return `<- ${method}`;
  }
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

function getCapabilities(message: JsonObject): JsonObject | null {
  if (!isPlainObject(message.result)) {
    return null;
  }

  const capabilities = message.result.capabilities;

  return isPlainObject(capabilities) ? capabilities : null;
}

function hasToolsCapability(message: JsonObject): boolean {
  const capabilities = getCapabilities(message);

  return capabilities !== null && isPlainObject(capabilities.tools);
}

function hasResourcesCapability(message: JsonObject): boolean {
  const capabilities = getCapabilities(message);

  return capabilities !== null && isPlainObject(capabilities.resources);
}

function hasPromptsCapability(message: JsonObject): boolean {
  const capabilities = getCapabilities(message);

  return capabilities !== null && isPlainObject(capabilities.prompts);
}

function getNextCursor(result: JsonObject): string | null {
  if (result.nextCursor === undefined) {
    return null;
  }

  return typeof result.nextCursor === "string" ? result.nextCursor : "__invalid__";
}

function extractToolsPage(
  message: JsonObject
): { items: ToolDefinition[]; nextCursor: string | null } | null {
  if (!isPlainObject(message.result)) {
    return null;
  }

  const tools = message.result.tools;

  if (!Array.isArray(tools)) {
    return null;
  }

  const parsedTools: ToolDefinition[] = [];

  for (const tool of tools) {
    if (
      !isPlainObject(tool) ||
      typeof tool.name !== "string" ||
      !isPlainObject(tool.inputSchema) ||
      tool.inputSchema.type !== "object"
    ) {
      return null;
    }

    parsedTools.push({
      name: tool.name,
      inputSchema: tool.inputSchema
    });
  }

  const nextCursor = getNextCursor(message.result);

  if (nextCursor === "__invalid__") {
    return null;
  }

  return {
    items: parsedTools,
    nextCursor
  };
}

function extractResourcesPage(
  message: JsonObject
): { items: ResourceDefinition[]; nextCursor: string | null } | null {
  if (!isPlainObject(message.result)) {
    return null;
  }

  const resources = message.result.resources;

  if (!Array.isArray(resources)) {
    return null;
  }

  const parsedResources: ResourceDefinition[] = [];

  for (const resource of resources) {
    if (
      !isPlainObject(resource) ||
      typeof resource.name !== "string" ||
      typeof resource.uri !== "string"
    ) {
      return null;
    }

    parsedResources.push({
      name: resource.name,
      uri: resource.uri
    });
  }

  const nextCursor = getNextCursor(message.result);

  if (nextCursor === "__invalid__") {
    return null;
  }

  return {
    items: parsedResources,
    nextCursor
  };
}

function extractResourceTemplatesPage(
  message: JsonObject
): { items: ResourceTemplateDefinition[]; nextCursor: string | null } | null {
  if (!isPlainObject(message.result)) {
    return null;
  }

  const resourceTemplates = message.result.resourceTemplates;

  if (!Array.isArray(resourceTemplates)) {
    return null;
  }

  const parsedTemplates: ResourceTemplateDefinition[] = [];

  for (const template of resourceTemplates) {
    if (
      !isPlainObject(template) ||
      typeof template.name !== "string" ||
      typeof template.uriTemplate !== "string"
    ) {
      return null;
    }

    parsedTemplates.push({
      name: template.name,
      uriTemplate: template.uriTemplate
    });
  }

  const nextCursor = getNextCursor(message.result);

  if (nextCursor === "__invalid__") {
    return null;
  }

  return {
    items: parsedTemplates,
    nextCursor
  };
}

function extractPromptsPage(
  message: JsonObject
): { items: PromptDefinition[]; nextCursor: string | null } | null {
  if (!isPlainObject(message.result)) {
    return null;
  }

  const prompts = message.result.prompts;

  if (!Array.isArray(prompts)) {
    return null;
  }

  const parsedPrompts: PromptDefinition[] = [];

  for (const prompt of prompts) {
    if (!isPlainObject(prompt) || typeof prompt.name !== "string") {
      return null;
    }

    let promptArguments:
      | Array<{ name: string; required?: boolean }>
      | undefined;

    if (prompt.arguments !== undefined) {
      if (!Array.isArray(prompt.arguments)) {
        return null;
      }

      promptArguments = [];

      for (const argument of prompt.arguments) {
        if (
          !isPlainObject(argument) ||
          typeof argument.name !== "string" ||
          (argument.required !== undefined &&
            typeof argument.required !== "boolean")
        ) {
          return null;
        }

        promptArguments.push({
          name: argument.name,
          required:
            typeof argument.required === "boolean"
              ? argument.required
              : undefined
        });
      }
    }

    parsedPrompts.push({
      name: prompt.name,
      arguments: promptArguments
    });
  }

  const nextCursor = getNextCursor(message.result);

  if (nextCursor === "__invalid__") {
    return null;
  }

  return {
    items: parsedPrompts,
    nextCursor
  };
}

function isDestructiveTool(tool: ToolDefinition): boolean {
  return /(delete|remove|drop|destroy|erase|wipe|purge|send|deploy|refund|payment|charge|merge|push)/i.test(
    tool.name
  );
}

function buildSchemaValue(
  schema: unknown
): unknown {
  if (!isPlainObject(schema)) {
    return undefined;
  }

  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0];
  }

  switch (schema.type) {
    case "string":
      return "codex-plugin-doctor-sample";
    case "integer":
      return 1;
    case "number":
      return 1.5;
    case "boolean":
      return false;
    case "array": {
      const itemValue = buildSchemaValue(schema.items);

      return itemValue === undefined ? undefined : [itemValue];
    }
    case "object": {
      const properties = isPlainObject(schema.properties) ? schema.properties : {};
      const required = Array.isArray(schema.required)
        ? schema.required.filter((value): value is string => typeof value === "string")
        : [];
      const value: Record<string, unknown> = {};

      for (const key of required) {
        const propertyValue = buildSchemaValue(properties[key]);

        if (propertyValue === undefined) {
          return undefined;
        }

        value[key] = propertyValue;
      }

      return value;
    }
    default:
      return undefined;
  }
}

function buildToolArguments(
  tool: ToolDefinition
): Record<string, unknown> | undefined {
  const schemaValue = buildSchemaValue(tool.inputSchema);

  if (schemaValue === undefined) {
    return undefined;
  }

  return isPlainObject(schemaValue) ? schemaValue : undefined;
}

function findCallableTool(
  tools: ToolDefinition[]
): { tool: ToolDefinition; args: Record<string, unknown> } | null {
  for (const tool of tools) {
    if (isDestructiveTool(tool)) {
      continue;
    }

    const args = buildToolArguments(tool);

    if (args !== undefined) {
      return {
        tool,
        args
      };
    }
  }

  return null;
}

function buildPromptArguments(
  prompt: PromptDefinition
): Record<string, string> | undefined {
  if (!prompt.arguments || prompt.arguments.length === 0) {
    return undefined;
  }

  const requiredArguments = prompt.arguments.filter((argument) => argument.required);

  if (requiredArguments.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    requiredArguments.map((argument) => [argument.name, PROMPT_PROBE_PLACEHOLDER])
  );
}

function findPromptForGet(prompts: PromptDefinition[]): PromptDefinition | null {
  return prompts[0] ?? null;
}

function isValidContentBlock(value: unknown): boolean {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return false;
  }

  switch (value.type) {
    case "text":
      return typeof value.text === "string";
    case "image":
    case "audio":
      return typeof value.data === "string" && typeof value.mimeType === "string";
    case "resource":
      return (
        isPlainObject(value.resource) &&
        typeof value.resource.uri === "string" &&
        (typeof value.resource.text === "string" ||
          typeof value.resource.blob === "string")
      );
    case "resource_link":
      return typeof value.uri === "string";
    default:
      return false;
  }
}

function isValidCallToolResult(message: JsonObject): boolean {
  if (!isPlainObject(message.result)) {
    return false;
  }

  const result = message.result;

  if (!Array.isArray(result.content)) {
    return false;
  }

  if (
    result.structuredContent !== undefined &&
    !isPlainObject(result.structuredContent)
  ) {
    return false;
  }

  if (result.isError !== undefined && typeof result.isError !== "boolean") {
    return false;
  }

  return result.content.every((content) => isValidContentBlock(content));
}

function isValidReadResourceResult(message: JsonObject): boolean {
  if (!isPlainObject(message.result)) {
    return false;
  }

  const contents = message.result.contents;

  if (!Array.isArray(contents)) {
    return false;
  }

  return contents.every((content) => {
    if (!isPlainObject(content) || typeof content.uri !== "string") {
      return false;
    }

    const hasText = typeof content.text === "string";
    const hasBlob = typeof content.blob === "string";

    return hasText || hasBlob;
  });
}

function isValidPromptGetResult(message: JsonObject): boolean {
  if (!isPlainObject(message.result)) {
    return false;
  }

  const messages = message.result.messages;

  if (!Array.isArray(messages)) {
    return false;
  }

  return messages.every((promptMessage) => {
    return (
      isPlainObject(promptMessage) &&
      (promptMessage.role === "user" || promptMessage.role === "assistant") &&
      isValidContentBlock(promptMessage.content)
    );
  });
}

async function probeCommandServer(input: {
  serverName: string;
  command: string;
  args: string[];
  cwd: string;
  startupTimeoutMs: number;
  transcript?: (line: string) => void;
}): Promise<RuntimeProbeResult> {
  const { serverName, command, args, cwd, startupTimeoutMs, transcript } = input;

  return new Promise((resolve) => {
    const scorecard = createRuntimeScorecard();
    let settled = false;
    let stderrPreview = "";
    let finalizeRequested = false;
    let nextRequestId = 1;

    const child = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });

    const stdoutReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity
    });

    const pendingRequests = new Map<number, PendingRequest>();

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

      resolve({
        findings: finding ? [finding] : [],
        scorecard
      });
    };

    const sendRequest = (
      method: string,
      params: JsonObject | undefined,
      timeoutFinding: Finding
    ): Promise<JsonObject> =>
      new Promise((requestResolve, requestReject) => {
        const id = nextRequestId++;
        transcript?.(formatRequestTranscriptForLog(method, params));

        const timer = setTimeout(() => {
          pendingRequests.delete(id);
          requestReject(timeoutFinding);
        }, startupTimeoutMs);

        pendingRequests.set(id, {
          method,
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

    const sendNotification = (method: string, params?: JsonObject) => {
      transcript?.(formatRequestTranscriptForLog(method, params));
      child.stdin.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          method,
          ...(params ? { params } : {})
        })}\n`
      );
    };

    const fetchPaginated = async <T>(input: {
      method: string;
      timeoutFinding: Finding;
      extractPage: (message: JsonObject) => { items: T[]; nextCursor: string | null } | null;
      onMethodNotFound?: () => void;
    }): Promise<T[] | null> => {
      let cursor: string | null = null;
      const items: T[] = [];

      do {
        const response = await sendRequest(
          input.method,
          cursor ? { cursor } : undefined,
          input.timeoutFinding
        );

        transcript?.(formatResponseTranscriptForLog(input.method, response));

        if (isErrorResponse(response)) {
          if (getErrorCode(response) === METHOD_NOT_FOUND && input.onMethodNotFound) {
            input.onMethodNotFound();
            return null;
          }

          return null;
        }

        const page = input.extractPage(response);

        if (!page) {
          return null;
        }

        items.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);

      return items;
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
        transcript?.(formatResponseTranscriptForLog(pendingRequest.method, message));
        pendingRequest.resolve(message);
      }
    });

    child.on("error", () => {
      scorecard.initialize = "fail";
      settle(
        buildFailure(
          "plugin.runtime.startup.failed",
          `The MCP server \`${serverName}\` could not be started.`,
          "The configured stdio server could not be launched, so runtime validation cannot proceed.",
          `Verify the command \`${command}\` is installed and executable from \`${cwd}\`.`
        )
      );
    });

    child.on("exit", () => {
      if (settled || finalizeRequested) {
        return;
      }

      if (scorecard.initialize === "skipped") {
        scorecard.initialize = "fail";
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

    const runProtocolProbe = async () => {
      const initializeResponse = await sendRequest(
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

      if (!isPlainObject(initializeResponse.result)) {
        scorecard.initialize = "fail";
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

      const result = initializeResponse.result;

      if (
        typeof result.protocolVersion !== "string" ||
        !isPlainObject(result.capabilities) ||
        !isPlainObject(result.serverInfo) ||
        typeof result.serverInfo.name !== "string" ||
        typeof result.serverInfo.version !== "string"
      ) {
        scorecard.initialize = "fail";
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

      scorecard.initialize = "pass";
      sendNotification("notifications/initialized");

      if (!hasToolsCapability(initializeResponse)) {
        scorecard.toolsList = "unsupported";
        scorecard.toolsCall = "unsupported";
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

      const tools = await fetchPaginated<ToolDefinition>({
        method: "tools/list",
        timeoutFinding: buildFailure(
          "plugin.runtime.tools_list.timeout",
          `The MCP server \`${serverName}\` did not answer the tools/list request in time.`,
          "A server that cannot return its tool catalog in time will feel broken or invisible in Codex.",
          "Inspect the tool discovery path and reduce latency before returning the tool list."
        ),
        extractPage: extractToolsPage
      });

      if (!tools) {
        scorecard.toolsList = "fail";
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

      scorecard.toolsList = "pass";

      const callableTool = findCallableTool(tools);

      if (!callableTool) {
        scorecard.toolsCall = "skipped";
        settle(
          buildWarning(
            "plugin.runtime.tool_call.skipped",
            `The MCP server \`${serverName}\` does not expose a safely callable tool for probing.`,
            "The validator confirmed tool discovery but could not safely perform a non-destructive `tools/call` probe.",
            "Expose at least one non-destructive tool with a JSON schema the validator can generate arguments for."
          )
        );
        return;
      } else {
        const toolCallResponse = await sendRequest(
          "tools/call",
          {
            name: callableTool.tool.name,
            arguments: callableTool.args
          },
          buildFailure(
            "plugin.runtime.tool_call.timeout",
            `The MCP server \`${serverName}\` did not answer the tools/call request in time.`,
            "A server that cannot complete a basic tool invocation in time will feel broken in real Codex usage.",
            "Inspect the selected tool implementation and reduce its response latency."
          )
        );

        if (isErrorResponse(toolCallResponse) || !isValidCallToolResult(toolCallResponse)) {
          scorecard.toolsCall = "fail";
          settle(
            buildFailure(
              "plugin.runtime.tool_call.invalid",
              `The MCP server \`${serverName}\` returned an invalid tools/call result.`,
              "Codex cannot safely consume malformed tool call results from the server.",
              "Return a CallToolResult with a `content` array containing valid MCP content blocks."
            )
          );
          return;
        }

        scorecard.toolsCall = "pass";
      }

      if (!hasResourcesCapability(initializeResponse)) {
        scorecard.resourcesList = "unsupported";
        scorecard.resourceRead = "unsupported";
        scorecard.resourceTemplatesList = "unsupported";
      } else {
        const resources = await fetchPaginated<ResourceDefinition>({
          method: "resources/list",
          timeoutFinding: buildFailure(
            "plugin.runtime.resources_list.timeout",
            `The MCP server \`${serverName}\` did not answer the resources/list request in time.`,
            "A server that advertises resources support but cannot list resources in time will feel incomplete or broken in Codex.",
            "Inspect the resources implementation and reduce latency before returning the resource list."
          ),
          extractPage: extractResourcesPage
        });

        if (!resources) {
          scorecard.resourcesList = "fail";
          settle(
            buildFailure(
              "plugin.runtime.resources_list.invalid",
              `The MCP server \`${serverName}\` returned an invalid resources/list result.`,
              "Codex cannot safely consume malformed resource definitions from `resources/list`.",
              "Return a `resources` array where every resource has at least a string `name` and string `uri`."
            )
          );
          return;
        }

        scorecard.resourcesList = "pass";

        if (resources.length > 0) {
          const resourceReadResponse = await sendRequest(
            "resources/read",
            {
              uri: resources[0].uri
            },
            buildFailure(
              "plugin.runtime.resource_read.timeout",
              `The MCP server \`${serverName}\` did not answer the resources/read request in time.`,
              "A server that lists resources but cannot read them in time will feel broken in Codex.",
              "Inspect the resource read path and reduce latency before returning resource contents."
            )
          );

          if (
            isErrorResponse(resourceReadResponse) ||
            !isValidReadResourceResult(resourceReadResponse)
          ) {
            scorecard.resourceRead = "fail";
            settle(
              buildFailure(
                "plugin.runtime.resource_read.invalid",
                `The MCP server \`${serverName}\` returned an invalid resources/read result.`,
                "Codex cannot safely consume malformed resource contents from `resources/read`.",
                "Return a `contents` array where each entry has a string `uri` plus either string `text` or string `blob`."
              )
            );
            return;
          }

          scorecard.resourceRead = "pass";
        } else {
          scorecard.resourceRead = "skipped";
        }

        scorecard.resourceTemplatesList = "skipped";
        let resourceTemplatesUnsupported = false;

        const resourceTemplates = await fetchPaginated<ResourceTemplateDefinition>({
          method: "resources/templates/list",
          timeoutFinding: buildFailure(
            "plugin.runtime.resource_templates_list.timeout",
            `The MCP server \`${serverName}\` did not answer the resources/templates/list request in time.`,
            "A server that advertises resources support but cannot list resource templates in time will feel incomplete in Codex.",
            "Inspect the resource template implementation and reduce latency before returning template definitions."
          ),
          extractPage: extractResourceTemplatesPage,
          onMethodNotFound: () => {
            resourceTemplatesUnsupported = true;
            scorecard.resourceTemplatesList = "unsupported";
          }
        });

        if (!resourceTemplates) {
          if (!resourceTemplatesUnsupported) {
            scorecard.resourceTemplatesList = "fail";
            settle(
              buildFailure(
                "plugin.runtime.resource_templates_list.invalid",
                `The MCP server \`${serverName}\` returned an invalid resources/templates/list result.`,
                "Codex cannot safely consume malformed resource template definitions from `resources/templates/list`.",
                "Return a `resourceTemplates` array where every template has string `name` and `uriTemplate` fields."
              )
            );
            return;
          }
        } else {
          scorecard.resourceTemplatesList = "pass";
        }
      }

      if (!hasPromptsCapability(initializeResponse)) {
        scorecard.promptsList = "unsupported";
        scorecard.promptGet = "unsupported";
      } else {
        const prompts = await fetchPaginated<PromptDefinition>({
          method: "prompts/list",
          timeoutFinding: buildFailure(
            "plugin.runtime.prompts_list.timeout",
            `The MCP server \`${serverName}\` did not answer the prompts/list request in time.`,
            "A server that advertises prompts support but cannot list prompts in time will feel incomplete or broken in Codex.",
            "Inspect the prompts implementation and reduce latency before returning the prompt list."
          ),
          extractPage: extractPromptsPage
        });

        if (!prompts) {
          scorecard.promptsList = "fail";
          settle(
            buildFailure(
              "plugin.runtime.prompts_list.invalid",
              `The MCP server \`${serverName}\` returned an invalid prompts/list result.`,
              "Codex cannot safely consume malformed prompt definitions from `prompts/list`.",
              "Return a `prompts` array where every prompt has a string `name`, and any prompt arguments have string `name` fields."
            )
          );
          return;
        }

        scorecard.promptsList = "pass";

        const promptForGet = findPromptForGet(prompts);

        if (!promptForGet) {
          scorecard.promptGet = "skipped";
        } else {
          const promptGetResponse = await sendRequest(
            "prompts/get",
            {
              name: promptForGet.name,
              ...(buildPromptArguments(promptForGet)
                ? { arguments: buildPromptArguments(promptForGet) }
                : {})
            },
            buildFailure(
              "plugin.runtime.prompt_get.timeout",
              `The MCP server \`${serverName}\` did not answer the prompts/get request in time.`,
              "A server that lists prompts but cannot return prompt content in time will feel broken in Codex.",
              "Inspect the prompt retrieval path and reduce latency before returning prompt messages."
            )
          );

          if (
            isErrorResponse(promptGetResponse) ||
            !isValidPromptGetResult(promptGetResponse)
          ) {
            scorecard.promptGet = "fail";
            settle(
              buildFailure(
                "plugin.runtime.prompt_get.invalid",
                `The MCP server \`${serverName}\` returned an invalid prompts/get result.`,
                "Codex cannot safely consume malformed prompt messages from `prompts/get`.",
                "Return a `messages` array where each entry has a valid `role` and a valid MCP content block."
              )
            );
            return;
          }

          scorecard.promptGet = "pass";
        }
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

      if (scorecard.initialize === "skipped") {
        scorecard.initialize = "fail";
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
  options: {
    startupTimeoutMs?: number;
    transcript?: (line: string) => void;
  } = {}
): Promise<RuntimeProbeResult> {
  const startupTimeoutMs = options.startupTimeoutMs ?? 400;
  const servers = await loadMcpServers(discoveredPackage);

  if (!servers) {
    return {
      findings: [],
      scorecard: createRuntimeScorecard()
    };
  }

  const findings: Finding[] = [];
  let scorecard = createRuntimeScorecard();

  for (const [serverName, config] of Object.entries(servers)) {
    if (!isPlainObject(config)) {
      continue;
    }

    const command = config.command;

    if (typeof command !== "string") {
      continue;
    }

    const args = Array.isArray(config.args)
      ? config.args.filter((value): value is string => typeof value === "string")
      : [];
    const cwd =
      typeof config.cwd === "string"
        ? path.resolve(discoveredPackage.rootPath, config.cwd)
        : discoveredPackage.rootPath;

    const result = await probeCommandServer({
      serverName,
      command,
      args,
      cwd,
      startupTimeoutMs,
      transcript: options.transcript
    });

    scorecard = result.scorecard;

    if (result.findings.length > 0) {
      findings.push(...result.findings);
    }
  }

  return {
    findings,
    scorecard
  };
}
