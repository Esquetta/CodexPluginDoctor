import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import path from "node:path";

import type { Finding, RuntimeExecutionEvidence, RuntimeSandboxMode } from "../domain/types.js";
import { packageVersion } from "../version.js";
import { normalizeMcpConfig } from "./mcp-config-normalizer.js";
import {
  classifyMcpDiscoverMessage,
  serializeMcpDiscoverRequest,
  type McpDiscoveryReport,
  type McpJsonObject
} from "./mcp-discovery.js";
import type { CatalogFinding } from "./mcp-tool-definition.js";
import {
  buildMcpToolCatalogReport,
  catalogFinding,
  createMcpToolCatalogInspector,
  finalCatalogStatus,
  hasMatchingEnvelope,
  MAX_CATALOG_PAGES,
  MAX_CATALOG_RESPONSE_BYTES,
  MAX_CATALOG_TOTAL_RESPONSE_BYTES,
  parseToolsResult,
  serializeToolsListRequest,
  validJsonRpcError,
  type CatalogStatus,
  type EnumerationCoverage,
  type McpToolCatalogCache,
  type McpToolCatalogProtocol,
  type McpToolCatalogReport,
  type McpToolCatalogSnapshot
} from "./mcp-tool-catalog.js";
import { resolveContainedPackagePath } from "./package-path.js";
import { readJsonFile } from "./read-json-file.js";
import { cleanupDockerContainer, resolveRuntimeCwd } from "./runtime-probe.js";
import { buildRuntimeLaunch, DOCKER_RUNTIME_STARTUP_TIMEOUT_MS, RuntimeSandboxError } from "./runtime-sandbox.js";

const MODERN_VERSION = "2026-07-28";
const LEGACY_REQUEST_VERSION = "2025-11-25";
const LEGACY_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);
// Legacy tools/list results carry no cache metadata; saved responses use the most conservative values.
const LEGACY_CACHE: McpToolCatalogCache = { ttlMs: 0, cacheScope: "private" };
const NATIVE_STARTUP_TIMEOUT_MS = 10_000;
const REQUEST_TIMEOUT_MS = 5_000;
const NATIVE_TOTAL_TIMEOUT_MS = 30_000;
const DOCKER_TOTAL_TIMEOUT_MS = 90_000;
const SHUTDOWN_GRACE_MS = 2_000;
const DISCOVER_ID = "discover-1";
const INITIALIZE_ID = "initialize-1";

export interface McpStdioServer {
  packageRoot: string;
  command: string;
  args: string[];
  cwd: string;
  source: "manifest" | "mcp-json";
}

export type McpStdioServerResolution =
  | { ok: true; server: McpStdioServer }
  | { ok: false; message: string };

export interface McpStdioToolCatalogOptions {
  sandbox?: RuntimeSandboxMode;
  now?: () => number;
  spawnImpl?: typeof spawn;
  // Resolves true when the named container was removed or no longer exists.
  removeContainerImpl?: (containerName: string) => Promise<boolean>;
  timeouts?: { startupMs?: number; requestMs?: number; totalMs?: number; shutdownMs?: number };
}

type SessionStop = "startup-failed" | "server-exited" | "stdout-invalid" | "response-byte-limit" | "total-response-byte-limit";

type RequestOutcome =
  | { kind: "message"; message: McpJsonObject }
  | { kind: "timeout"; reason: "request-timeout" | "total-time-limit" }
  | { kind: "stopped"; reason: SessionStop };

interface StdioSession {
  readonly spawned: boolean;
  readonly stopped: SessionStop | null;
  request(id: string, body: string, timeoutMs: number): Promise<RequestOutcome>;
  notify(body: string): void;
  close(graceMs: number): Promise<void>;
}

interface StdioLaunch {
  command: string;
  args: string[];
  cwd: string;
  containerName: string | null;
  evidence: RuntimeExecutionEvidence;
}

function isPlainObject(value: unknown): value is McpJsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(message: string): McpStdioServerResolution {
  return { ok: false, message };
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

async function readManifestMcpServers(
  rootPath: string
): Promise<{ declared: false } | { declared: true; value: unknown } | { unreadable: true }> {
  const manifestPath = path.join(rootPath, ".codex-plugin", "plugin.json");
  if (!(await isFile(manifestPath))) return { declared: false };
  let manifest: unknown;
  try {
    manifest = await readJsonFile<unknown>(manifestPath);
  } catch {
    // An existing manifest that cannot be read must not silently fall back to .mcp.json.
    return { unreadable: true };
  }
  if (!isPlainObject(manifest)) return { unreadable: true };
  return Object.hasOwn(manifest, "mcpServers")
    ? { declared: true, value: manifest.mcpServers }
    : { declared: false };
}

// Reads the server the same way runtime planning does: the manifest mcpServers file first,
// then .mcp.json for packages without one. Messages never echo paths or configured values.
export async function resolveMcpStdioServer(targetPath: string, serverName: string): Promise<McpStdioServerResolution> {
  let packageRoot: string;
  try {
    packageRoot = await realpath(path.resolve(targetPath));
    if (!(await stat(packageRoot)).isDirectory()) return failure("The package path is not a directory.");
  } catch {
    return failure("The package path was not found.");
  }

  const manifestServers = await readManifestMcpServers(packageRoot);
  if ("unreadable" in manifestServers) return failure("The plugin manifest could not be read as a JSON object.");
  let configPath: string | null;
  let source: McpStdioServer["source"];
  if (manifestServers.declared) {
    const value = manifestServers.value;
    if (typeof value !== "string" || !value.startsWith("./")) {
      return failure("The plugin manifest mcpServers field must be a non-empty package-relative ./ path.");
    }
    configPath = await resolveContainedPackagePath(packageRoot, value);
    source = "manifest";
  } else {
    configPath = await resolveContainedPackagePath(packageRoot, ".mcp.json");
    source = "mcp-json";
  }
  if (configPath === null) return failure("The MCP server configuration resolves outside the package root.");
  if (!(await isFile(configPath))) {
    return failure(source === "manifest"
      ? "The plugin manifest mcpServers file was not found."
      : "No MCP server configuration was found. Add .mcp.json or a plugin manifest mcpServers path.");
  }

  let parsed: unknown;
  try {
    parsed = await readJsonFile<unknown>(configPath);
  } catch {
    return failure("The MCP server configuration could not be read as JSON.");
  }
  const normalized = normalizeMcpConfig(parsed);
  if (!normalized.ok) return failure("The MCP server configuration does not contain a valid server map.");
  if (!Object.hasOwn(normalized.servers, serverName)) return failure("The named MCP server is not in the package configuration.");

  const config = normalized.servers[serverName];
  if (typeof config.url === "string") {
    return failure("The named MCP server uses HTTP. Run doctor tools <url> --allow-network for HTTP servers.");
  }
  if (typeof config.command !== "string" || config.command.length === 0) {
    return failure("The named MCP server has no command to start.");
  }
  const cwd = await resolveRuntimeCwd(packageRoot, config.cwd);
  if (cwd === null) {
    return failure("The named MCP server cwd must be an existing directory inside the package root.");
  }
  const args = Array.isArray(config.args) ? config.args.filter((value): value is string => typeof value === "string") : [];
  return { ok: true, server: { packageRoot, command: config.command, args, cwd, source } };
}

// A session whose process never started, for launches that spawn rejects synchronously.
const unstartedStdioSession: StdioSession = {
  spawned: false,
  stopped: "startup-failed",
  request: () => Promise.resolve({ kind: "stopped", reason: "startup-failed" }),
  notify: () => undefined,
  close: () => Promise.resolve()
};

function startStdioSession(launch: StdioLaunch, spawnImpl: typeof spawn): StdioSession {
  let child: ReturnType<typeof spawn>;
  try {
    child = spawnImpl(launch.command, launch.args, {
      cwd: launch.cwd,
      // Server stderr is never read or reported; reports exclude raw server output.
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true
    });
  } catch {
    // spawn throws synchronously for some launches (NUL bytes, Windows .cmd/.bat shims);
    // its message can echo the command, so it is reduced to a startup failure.
    return unstartedStdioSession;
  }
  const pending = new Map<string, { resolve: (outcome: RequestOutcome) => void; timer: NodeJS.Timeout }>();
  const exitWaiters = new Set<() => void>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let spawned = false;
  let exited = false;
  let stop: SessionStop | null = null;
  let lineChunks: Buffer[] = [];
  let lineBytes = 0;
  let totalBytes = 0;

  const halt = (reason: SessionStop) => {
    if (stop !== null) return;
    stop = reason;
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.resolve({ kind: "stopped", reason });
    }
    pending.clear();
  };

  const handleLine = (line: Buffer) => {
    let text: string;
    try {
      text = decoder.decode(line);
    } catch {
      halt("stdout-invalid");
      return;
    }
    if (text.endsWith("\r")) text = text.slice(0, -1);
    if (text.trim().length === 0) return;
    let message: unknown;
    try {
      message = JSON.parse(text);
    } catch {
      halt("stdout-invalid");
      return;
    }
    if (!isPlainObject(message) || message.jsonrpc !== "2.0") {
      halt("stdout-invalid");
      return;
    }
    // Notifications and server-initiated requests are neither answered nor reported.
    if (Object.hasOwn(message, "method") || typeof message.id !== "string") return;
    const entry = pending.get(message.id);
    if (entry === undefined) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.resolve({ kind: "message", message });
  };

  child.stdout?.on("data", (chunk: Buffer) => {
    if (stop !== null) return;
    totalBytes += chunk.length;
    if (totalBytes > MAX_CATALOG_TOTAL_RESPONSE_BYTES) {
      halt("total-response-byte-limit");
      return;
    }
    let offset = 0;
    while (stop === null) {
      const newline = chunk.indexOf(0x0a, offset);
      const segment = chunk.subarray(offset, newline === -1 ? chunk.length : newline);
      lineBytes += segment.length;
      if (lineBytes > MAX_CATALOG_RESPONSE_BYTES) {
        halt("response-byte-limit");
        return;
      }
      lineChunks.push(segment);
      if (newline === -1) return;
      const line = Buffer.concat(lineChunks, lineBytes);
      lineChunks = [];
      lineBytes = 0;
      handleLine(line);
      offset = newline + 1;
    }
  });
  // Closing stdout means no further replies can arrive, whether or not the process has exited yet.
  child.stdout?.on("close", () => halt(spawned ? "server-exited" : "startup-failed"));
  child.stdin?.on("error", () => undefined);
  child.on("spawn", () => {
    spawned = true;
  });
  child.on("error", () => {
    if (!spawned) halt("startup-failed");
  });
  child.on("exit", () => {
    exited = true;
    for (const waiter of exitWaiters) waiter();
    exitWaiters.clear();
  });

  const waitForExit = (timeoutMs: number): Promise<boolean> => new Promise((resolve) => {
    if (exited) {
      resolve(true);
      return;
    }
    const timer = setTimeout(() => {
      exitWaiters.delete(onExit);
      resolve(false);
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    exitWaiters.add(onExit);
  });

  return {
    get spawned() {
      return spawned;
    },
    get stopped() {
      return stop;
    },
    request(id, body, timeoutMs) {
      if (stop !== null) return Promise.resolve({ kind: "stopped", reason: stop });
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ kind: "timeout", reason: "request-timeout" });
        }, timeoutMs);
        pending.set(id, { resolve, timer });
        child.stdin?.write(`${body}\n`);
      });
    },
    notify(body) {
      if (stop === null) child.stdin?.write(`${body}\n`);
    },
    async close(graceMs) {
      halt("server-exited");
      // Graceful stdio shutdown: close stdin, then escalate to SIGTERM and SIGKILL.
      if (spawned && !exited) {
        child.stdin?.end();
        if (!(await waitForExit(graceMs))) {
          child.kill("SIGTERM");
          if (!(await waitForExit(graceMs))) {
            child.kill("SIGKILL");
            await waitForExit(graceMs);
          }
        }
      }
      child.stdin?.destroy();
      child.stdout?.destroy();
      if (!exited) child.unref();
    }
  };
}

function stdioDiscovery(
  status: McpDiscoveryReport["status"],
  coverage: McpDiscoveryReport["coverage"]["discovery"],
  findings: Finding[] = [],
  supportedVersions: string[] = []
): McpDiscoveryReport {
  return {
    schemaVersion: 1,
    requestedVersion: MODERN_VERSION,
    scope: "discovery-only",
    status,
    supportedVersions,
    findings,
    coverage: { discovery: coverage, runtime: "not-tested" }
  };
}

function discoveryFinding(id: string, severity: Finding["severity"], message: string, impact: string, suggestedFix: string): Finding {
  return { id, severity, message, impact, suggestedFix };
}

const legacyImpact = "Clients that only support modern MCP versions cannot use this server.";
const legacyFix = "Implement server/discover and per-request metadata for MCP 2026-07-28 to support modern clients.";
const stdoutInvalidImpact = "stdio clients cannot reliably read replies when stdout carries anything other than newline-delimited JSON-RPC messages.";
const stdoutInvalidFix = "Write only MCP messages to stdout and send logs to stderr.";

function stopFinding(reason: SessionStop | "request-timeout" | "total-time-limit", docker: boolean): Finding {
  switch (reason) {
    case "startup-failed":
      return discoveryFinding(
        "plugin.discovery.stdio.startup_failed", "fail", "The MCP server process could not be started.",
        "No tool definitions can be read from a server that does not start.",
        docker
          ? "Verify Docker is installed and the Docker daemon is available."
          : "Verify the configured command is installed and runs from the server working directory without a shell."
      );
    case "stdout-invalid":
      return discoveryFinding(
        "plugin.discovery.stdio.output.invalid", "fail", "The MCP server wrote output to stdout that is not a JSON-RPC message.",
        stdoutInvalidImpact, stdoutInvalidFix
      );
    case "response-byte-limit":
    case "total-response-byte-limit":
      return discoveryFinding(
        "plugin.discovery.transport.failed", "fail", "The MCP server's discovery output exceeded the inspection byte limits.",
        "The discovery reply cannot be read within the inspection bounds.", "Keep each stdio message under 1 MiB."
      );
    default:
      return discoveryFinding(
        "plugin.discovery.transport.timeout", "fail", "Server discovery did not complete within the inspection time limit.",
        "The discovery reply cannot be read within the inspection bounds.", "Reduce server startup latency, then inspect again."
      );
  }
}

interface ProtocolResult {
  status: CatalogStatus;
  protocol: McpToolCatalogProtocol;
  discovery: McpDiscoveryReport;
  catalog: McpToolCatalogReport["catalog"];
  enumeration: EnumerationCoverage;
  findings: CatalogFinding[];
  tools: unknown[] | null;
  cache: McpToolCatalogCache | null;
}

interface CatalogEra {
  request(id: string, cursor: string | undefined): string;
  parse(message: McpJsonObject, id: string): { tools: unknown[]; cursor: string | undefined; cache: McpToolCatalogCache } | null;
  invalidFix: string;
}

const modernEra: CatalogEra = {
  request: serializeToolsListRequest,
  parse: parseToolsResult,
  invalidFix: "Return a matching JSON-RPC complete result with valid tools and cache metadata."
};

const legacyEra: CatalogEra = {
  request: (id, cursor) => JSON.stringify({
    jsonrpc: "2.0",
    id,
    method: "tools/list",
    ...(cursor === undefined ? {} : { params: { cursor } })
  }),
  parse: (message, id) => {
    if (!hasMatchingEnvelope(message, id) || !Object.hasOwn(message, "result") || !isPlainObject(message.result)
      || !Array.isArray(message.result.tools)) {
      return null;
    }
    if (Object.hasOwn(message.result, "nextCursor") && typeof message.result.nextCursor !== "string") return null;
    return { tools: message.result.tools, cursor: message.result.nextCursor as string | undefined, cache: LEGACY_CACHE };
  },
  invalidFix: "Return a matching JSON-RPC result with a tools array and an optional string nextCursor."
};

function legacyInitializeRequest(): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: INITIALIZE_ID,
    method: "initialize",
    params: {
      protocolVersion: LEGACY_REQUEST_VERSION,
      capabilities: {},
      clientInfo: { name: "Codex Plugin Doctor", version: packageVersion }
    }
  });
}

function validInitializeResult(message: McpJsonObject): McpJsonObject | null {
  if (!hasMatchingEnvelope(message, INITIALIZE_ID) || !Object.hasOwn(message, "result")) return null;
  const result = message.result;
  return isPlainObject(result) && typeof result.protocolVersion === "string" && isPlainObject(result.capabilities)
    && isPlainObject(result.serverInfo) && typeof result.serverInfo.name === "string" && typeof result.serverInfo.version === "string"
    ? result
    : null;
}

// Starts one configured stdio server, reads its tool list without calling tools, and stops it.
// Tools and cache metadata are returned only for a complete enumeration.
export async function captureStdioMcpToolCatalog(server: McpStdioServer, options: McpStdioToolCatalogOptions = {}): Promise<McpToolCatalogSnapshot> {
  const docker = options.sandbox === "docker";
  const now = options.now ?? (() => performance.now());
  const startupMs = options.timeouts?.startupMs ?? (docker ? DOCKER_RUNTIME_STARTUP_TIMEOUT_MS : NATIVE_STARTUP_TIMEOUT_MS);
  const requestMs = options.timeouts?.requestMs ?? REQUEST_TIMEOUT_MS;
  const shutdownMs = options.timeouts?.shutdownMs ?? SHUTDOWN_GRACE_MS;
  const deadline = now() + (options.timeouts?.totalMs ?? (docker ? DOCKER_TOTAL_TIMEOUT_MS : NATIVE_TOTAL_TIMEOUT_MS));
  const spawnImpl = options.spawnImpl ?? spawn;
  const removeContainer = options.removeContainerImpl ?? (async (containerName: string) => await cleanupDockerContainer(containerName) === null);
  const emptyCatalog = { complete: false, pagesRead: 0, toolsChecked: 0, reason: null };

  const buildLaunch = (): StdioLaunch => docker
    ? buildRuntimeLaunch({
        sandbox: "docker",
        packageRoot: server.packageRoot,
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        containerName: `codex-doctor-${randomUUID()}`
      })
    : {
        command: server.command,
        args: server.args,
        cwd: server.cwd,
        containerName: null,
        evidence: { backend: "native", image: null, network: "host", packageMount: "host" }
      };

  let firstLaunch: StdioLaunch;
  try {
    firstLaunch = buildLaunch();
  } catch (error) {
    const discovery = stdioDiscovery("blocked", "skipped", [discoveryFinding(
      "plugin.discovery.sandbox.unsupported", "warn",
      error instanceof RuntimeSandboxError ? error.message : "The MCP server cannot run in the requested sandbox.",
      "The tool catalog was not read because the server cannot be isolated as requested.",
      "Use a Node.js command inside the package root with --sandbox docker, or review the command before running it without a sandbox."
    )]);
    return finish(buildMcpToolCatalogReport(discovery, "blocked", { ...emptyCatalog, reason: "sandbox-unsupported" }, "not-tested", []),
      { era: null, version: null }, null, null, null);
  }

  const started: Array<{ session: StdioSession; containerName: string | null }> = [];
  let session: StdioSession;
  const start = (launch: StdioLaunch) => {
    session = startStdioSession(launch, spawnImpl);
    started.push({ session, containerName: launch.containerName });
  };

  const send = async (id: string, body: string, timeoutMs: number): Promise<RequestOutcome> => {
    const remaining = Math.floor(deadline - now());
    if (remaining < 1) return { kind: "timeout", reason: "total-time-limit" };
    const outcome = await session.request(id, body, Math.min(timeoutMs, remaining));
    return outcome.kind === "timeout" && remaining < timeoutMs ? { kind: "timeout", reason: "total-time-limit" } : outcome;
  };

  const enumerate = async (era: CatalogEra, protocol: McpToolCatalogProtocol, discovery: McpDiscoveryReport): Promise<ProtocolResult> => {
    const inspector = createMcpToolCatalogInspector();
    const findings = inspector.findings;
    const seenCursors = new Set<string>();
    let pagesRead = 0;
    let cursor: string | undefined;
    let cache: McpToolCatalogCache | null = null;
    let reason: string | null = null;
    const addFindings = (items: CatalogFinding[]): boolean => {
      if (inspector.addFindings(items)) return true;
      reason = "finding-limit";
      return false;
    };
    const sessionStopped = (stop: SessionStop) => {
      if (stop !== "stdout-invalid") {
        reason = stop;
      } else if (addFindings([catalogFinding("plugin.catalog.stdio.output.invalid", "fail",
        "The MCP server wrote output to stdout that is not a JSON-RPC message.", stdoutInvalidImpact, stdoutInvalidFix)])) {
        reason = stop;
      }
    };

    while (reason === null) {
      if (pagesRead >= MAX_CATALOG_PAGES) {
        reason = "page-limit";
        break;
      }
      const id = `tools-list-${pagesRead + 1}`;
      const outcome = await send(id, era.request(id, cursor), requestMs);
      if (outcome.kind !== "message") {
        if (outcome.kind === "stopped") sessionStopped(outcome.reason);
        else reason = outcome.reason;
        break;
      }
      const message = outcome.message;
      if (hasMatchingEnvelope(message, id) && Object.hasOwn(message, "error") && validJsonRpcError(message.error) && message.error.code === -32601) {
        if (addFindings([catalogFinding(
          "plugin.catalog.tools_list.method_unsupported", "warn", "The MCP server advertised tools but does not implement tools/list.",
          "Tool definitions cannot be enumerated from the advertised capability.", "Implement tools/list for the advertised MCP tools capability."
        )])) reason = "tools-list-method-unsupported";
        break;
      }
      const page = era.parse(message, id);
      if (page === null) {
        if (addFindings([catalogFinding(
          "plugin.catalog.response.invalid", "fail", "The MCP server returned an invalid tools/list response.",
          "The tool catalog cannot be safely enumerated from this response.", era.invalidFix
        )])) reason = "response-invalid";
        break;
      }

      pagesRead += 1;
      cache = cache === null ? page.cache : {
        ttlMs: Math.min(cache.ttlMs, page.cache.ttlMs),
        cacheScope: cache.cacheScope === "private" ? "private" : page.cache.cacheScope
      };
      reason = inspector.inspectPage(page.tools, pagesRead, () => deadline - now() <= 0);
      if (reason !== null) break;
      if (page.cursor === undefined) break;
      if (seenCursors.has(page.cursor)) {
        if (addFindings([catalogFinding(
          "plugin.catalog.cursor.loop", "warn", "The MCP server repeated a tools/list cursor.",
          "The bounded catalog enumeration cannot determine a complete result set.", "Return each continuation cursor at most once for a single enumeration."
        )])) reason = "cursor-loop";
        break;
      }
      seenCursors.add(page.cursor);
      cursor = page.cursor;
    }

    // Output that arrived in the same chunk as the final page is validated before the catalog is accepted;
    // a server exiting after its last reply is not a failure.
    const trailingStop = session.stopped;
    if (reason === null && trailingStop !== null && trailingStop !== "server-exited") sessionStopped(trailingStop);
    if (reason === null && deadline - now() <= 0) reason = "total-time-limit";
    const catalog = { complete: reason === null, pagesRead, toolsChecked: inspector.toolsChecked, reason };
    return reason === null
      ? { status: finalCatalogStatus(findings), protocol, discovery, catalog, enumeration: "complete", findings, tools: inspector.tools, cache }
      : { status: "incomplete", protocol, discovery, catalog, enumeration: "incomplete", findings, tools: null, cache: null };
  };

  const notTested = (
    status: CatalogStatus,
    reason: string | null,
    protocol: McpToolCatalogProtocol,
    discovery: McpDiscoveryReport,
    findings: CatalogFinding[] = []
  ): ProtocolResult => ({
    status, protocol, discovery, catalog: { ...emptyCatalog, reason }, enumeration: "not-tested", findings, tools: null, cache: null
  });

  // answeredDiscovery is false when only silence or an exit suggested a legacy server.
  const runLegacy = async (discovery: McpDiscoveryReport, restart: boolean, answeredDiscovery: boolean): Promise<ProtocolResult> => {
    if (restart) start(buildLaunch());
    const outcome = await send(INITIALIZE_ID, legacyInitializeRequest(), restart ? startupMs : requestMs);
    const unknownVersion = { era: "legacy" as const, version: null };
    const unestablished = answeredDiscovery ? unknownVersion : { era: null, version: null };
    if (outcome.kind !== "message") {
      return notTested("incomplete", outcome.reason, unestablished, discovery, outcome.reason === "stdout-invalid"
        ? [catalogFinding("plugin.catalog.stdio.output.invalid", "fail",
          "The MCP server wrote output to stdout that is not a JSON-RPC message.", stdoutInvalidImpact, stdoutInvalidFix)]
        : []);
    }
    const result = validInitializeResult(outcome.message);
    if (result === null) {
      return notTested("incomplete", "initialize-failed", unestablished, discovery, [catalogFinding(
        "plugin.catalog.initialize.invalid", "fail", "The MCP server did not complete the legacy initialize handshake.",
        "The tool catalog cannot be read from a legacy server that does not initialize.",
        "Return protocolVersion, capabilities, and serverInfo from initialize, or implement server/discover."
      )]);
    }
    const version = result.protocolVersion as string;
    if (!LEGACY_VERSIONS.has(version)) {
      return notTested("unsupported", "protocol-version-unsupported", unknownVersion, discovery, [catalogFinding(
        "plugin.catalog.initialize.version_unsupported", "warn", "The MCP server negotiated a legacy protocol version this inspection does not support.",
        "The tool catalog was not read because the negotiated version is unknown to this inspection.",
        "Support MCP 2025-11-25 or MCP 2026-07-28."
      )]);
    }
    const protocol = { era: "legacy" as const, version };
    session.notify(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }));
    const capabilities = result.capabilities as McpJsonObject;
    if (!isPlainObject(capabilities.tools)) return notTested("not-applicable", null, protocol, discovery);
    return enumerate(legacyEra, protocol, discovery);
  };

  const run = async (): Promise<ProtocolResult> => {
    start(firstLaunch);
    const probe = await send(DISCOVER_ID, serializeMcpDiscoverRequest(DISCOVER_ID), startupMs);
    const undetermined = { era: null, version: null };
    if ((probe.kind === "stopped" && probe.reason === "server-exited") || (probe.kind === "timeout" && probe.reason === "request-timeout")) {
      // stdio era detection: no reply to discovery identifies a legacy server; restart one that exited.
      return runLegacy(stdioDiscovery("unsupported", "skipped", [discoveryFinding(
        "plugin.discovery.stdio.no_response", "warn",
        "The MCP server did not answer server discovery; the legacy initialize handshake was used.", legacyImpact, legacyFix
      )]), probe.kind === "stopped", false);
    }
    if (probe.kind !== "message") {
      const reason = probe.reason;
      return notTested("incomplete", reason, undetermined, stdioDiscovery("failed", "fail", [stopFinding(reason, docker)]));
    }

    const outcome = classifyMcpDiscoverMessage(probe.message, DISCOVER_ID);
    const modernUnknown = { era: "modern" as const, version: null };
    switch (outcome.kind) {
      case "other-error":
        return runLegacy(stdioDiscovery("unsupported", "skipped", [discoveryFinding(
          "plugin.discovery.method.unsupported", "warn",
          "The MCP server does not implement server discovery; the legacy initialize handshake was used.", legacyImpact, legacyFix
        )]), false, true);
      case "version-unsupported":
      case "version-not-listed":
        return notTested("unsupported", "discovery-unsupported", modernUnknown, stdioDiscovery("unsupported", "skipped", [discoveryFinding(
          outcome.kind === "version-unsupported" ? "plugin.discovery.protocol_version.unsupported" : "plugin.discovery.protocol_version.inconsistent",
          "warn",
          outcome.kind === "version-unsupported"
            ? "The MCP server does not support the requested protocol version."
            : "The MCP server completed discovery without listing the requested protocol version.",
          "Discovery-only probing cannot establish support for the requested MCP protocol version.",
          "Configure a server that supports the requested protocol version, then run discovery again."
        )], outcome.supportedVersions));
      case "result-invalid":
      case "envelope-invalid":
        return notTested("incomplete", "discovery-failed", modernUnknown, stdioDiscovery("failed", "fail", [discoveryFinding(
          outcome.kind === "result-invalid" ? "plugin.discovery.result.invalid" : "plugin.discovery.response.invalid", "fail",
          outcome.kind === "result-invalid" ? "The MCP server returned an invalid discovery result." : "The MCP server returned an invalid discovery response.",
          "The discovery response cannot safely establish modern MCP discovery support.",
          "Verify the server returns a valid server/discover response for the requested protocol version."
        )]));
      case "discovered": {
        const discovery = stdioDiscovery("discovered", "pass", [], outcome.supportedVersions);
        const protocol = { era: "modern" as const, version: MODERN_VERSION };
        if (!Object.hasOwn(outcome.capabilities, "tools")) return notTested("not-applicable", null, protocol, discovery);
        return enumerate(modernEra, protocol, discovery);
      }
    }
  };

  let result: ProtocolResult;
  let cleanupFailed = false;
  try {
    result = await run();
  } finally {
    for (const entry of started) {
      await entry.session.close(shutdownMs);
      // A container exists only if the docker client process started.
      if (entry.containerName !== null && entry.session.spawned && !(await removeContainer(entry.containerName))) {
        cleanupFailed = true;
      }
    }
  }

  const findings = result.findings;
  if (cleanupFailed && findings.length < 100) {
    findings.push(catalogFinding(
      "plugin.catalog.stdio.sandbox_cleanup_failed", "fail", "The Docker runtime container could not be removed after reading the tool list.",
      "A leftover runtime container weakens cleanup guarantees and may continue consuming local resources.",
      "Verify the Docker daemon is available, then remove the codex-doctor container."
    ));
  }
  const complete = result.tools !== null;
  const status = complete ? finalCatalogStatus(findings) : result.status;
  const execution = started.some((entry) => entry.session.spawned) ? firstLaunch.evidence : null;
  return finish(
    buildMcpToolCatalogReport(result.discovery, status, result.catalog, result.enumeration, findings),
    result.protocol,
    execution,
    result.tools,
    result.cache
  );
}

function finish(
  report: McpToolCatalogReport,
  protocol: McpToolCatalogProtocol,
  execution: RuntimeExecutionEvidence | null,
  tools: unknown[] | null,
  cache: McpToolCatalogCache | null
): McpToolCatalogSnapshot {
  const { schemaVersion, scope, status, discovery, catalog, coverage, findings } = report;
  return {
    report: { schemaVersion, scope, transport: "stdio", status, protocol, execution, discovery, catalog, coverage, findings },
    tools,
    cache
  };
}
