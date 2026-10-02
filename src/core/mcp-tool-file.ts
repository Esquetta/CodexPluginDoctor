import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import type { Stats } from "node:fs";

import type { CatalogFinding } from "./mcp-tool-definition.js";
import { inspectMcpToolDefinition } from "./mcp-tool-definition.js";

const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOOLS = 500;
const MAX_FINDINGS = 100;

type JsonObject = Record<string, unknown>;

export interface McpToolFileReport {
  schemaVersion: 1;
  scope: "tool-definitions-file";
  status: "pass" | "warn" | "fail" | "incomplete" | "blocked";
  source: {
    kind: "file";
    format: "mcp-tools-list-response";
    bytesRead: number;
  };
  inspection: {
    complete: boolean;
    toolsChecked: number;
    hasNextCursor: boolean | null;
    reason: string | null;
  };
  coverage: {
    schema: "root-shape-only";
    discovery: "not-tested";
    serverCatalog: "not-tested";
    toolExecution: "not-tested";
    fullConformance: "not-tested";
    customHeaderAnnotations: "not-tested";
  };
  findings: CatalogFinding[];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.hasOwn(object, key);
}

function sameFile(left: Stats, right: Stats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: Stats, right: Stats): boolean {
  return sameFile(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function isBlockedOfflinePath(filePath: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]+:/u.test(filePath)
    || /^[A-Za-z]:\/\//u.test(filePath)
    || /^[\\/]{2}/u.test(filePath);
}

function baseReport(bytesRead: number): Omit<McpToolFileReport, "status" | "inspection" | "findings"> {
  return {
    schemaVersion: 1,
    scope: "tool-definitions-file",
    source: { kind: "file", format: "mcp-tools-list-response", bytesRead },
    coverage: {
      schema: "root-shape-only",
      discovery: "not-tested",
      serverCatalog: "not-tested",
      toolExecution: "not-tested",
      fullConformance: "not-tested",
      customHeaderAnnotations: "not-tested"
    }
  };
}

function report(
  bytesRead: number,
  status: McpToolFileReport["status"],
  inspection: McpToolFileReport["inspection"],
  findings: CatalogFinding[]
): McpToolFileReport {
  return { ...baseReport(bytesRead), status, inspection, findings };
}

function fileFinding(
  id: string,
  severity: CatalogFinding["severity"],
  message: string,
  impact: string,
  suggestedFix: string
): CatalogFinding {
  return { id, severity, message, impact, suggestedFix };
}

function incompleteFileReport(
  bytesRead: number,
  reason: string,
  finding: CatalogFinding
): McpToolFileReport {
  return report(bytesRead, "incomplete", {
    complete: false,
    toolsChecked: 0,
    hasNextCursor: null,
    reason
  }, [finding]);
}

function blockedFileReport(reason: string, finding: CatalogFinding): McpToolFileReport {
  return report(0, "blocked", {
    complete: false,
    toolsChecked: 0,
    hasNextCursor: null,
    reason
  }, [finding]);
}

function finalStatus(findings: CatalogFinding[]): "pass" | "warn" | "fail" {
  if (findings.some((finding) => finding.severity === "fail")) return "fail";
  return findings.some((finding) => finding.severity === "warn") ? "warn" : "pass";
}

function parseToolsResult(value: unknown): { tools: unknown[]; hasNextCursor: boolean } | null {
  if (!isJsonObject(value)
    || value.jsonrpc !== "2.0"
    || !hasOwn(value, "id")
    || !(typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id)))
    || !hasOwn(value, "result")
    || hasOwn(value, "error")
    || !isJsonObject(value.result)
    || value.result.resultType !== "complete"
    || !Array.isArray(value.result.tools)
    || typeof value.result.ttlMs !== "number"
    || !Number.isFinite(value.result.ttlMs)
    || value.result.ttlMs < 0
    || (value.result.cacheScope !== "public" && value.result.cacheScope !== "private")) {
    return null;
  }

  const hasNextCursor = hasOwn(value.result, "nextCursor");
  if (hasNextCursor && typeof value.result.nextCursor !== "string") return null;

  return { tools: value.result.tools, hasNextCursor };
}

async function readBoundedRegularFile(filePath: string): Promise<
  | { kind: "content"; content: Buffer; bytesRead: number }
  | { kind: "unavailable"; bytesRead: number }
  | { kind: "too-large"; bytesRead: number }
  | { kind: "changed"; bytesRead: number }
  | { kind: "symlink"; bytesRead: number }
  | { kind: "not-regular"; bytesRead: number }
> {
  let initial: Stats;
  try {
    initial = await lstat(filePath);
  } catch {
    return { kind: "unavailable", bytesRead: 0 };
  }

  if (initial.isSymbolicLink()) return { kind: "symlink", bytesRead: 0 };
  if (!initial.isFile()) return { kind: "not-regular", bytesRead: 0 };
  if (!Number.isSafeInteger(initial.size) || initial.size < 0 || initial.size > MAX_FILE_BYTES) {
    return { kind: "too-large", bytesRead: 0 };
  }

  const flags = process.platform === "win32"
    ? constants.O_RDONLY
    : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null;
  let bytesRead = 0;

  try {
    fileHandle = await open(filePath, flags);
    const opened = await fileHandle.stat();
    const current = await lstat(filePath);
    if (!opened.isFile() || current.isSymbolicLink() || !current.isFile() || !sameSnapshot(initial, opened) || !sameSnapshot(opened, current)) {
      return { kind: "changed", bytesRead };
    }
    if (!Number.isSafeInteger(opened.size) || opened.size < 0 || opened.size > MAX_FILE_BYTES) {
      return { kind: "too-large", bytesRead };
    }

    const content = Buffer.alloc(opened.size);
    while (bytesRead < content.length) {
      const read = await fileHandle.read(content, bytesRead, content.length - bytesRead, bytesRead);
      if (read.bytesRead === 0) return { kind: "changed", bytesRead };
      bytesRead += read.bytesRead;
    }

    const probe = Buffer.alloc(1);
    const extra = await fileHandle.read(probe, 0, 1, bytesRead);
    bytesRead += extra.bytesRead;
    if (extra.bytesRead !== 0) return { kind: "changed", bytesRead };

    const completed = await fileHandle.stat();
    const final = await lstat(filePath);
    if (!final.isFile() || final.isSymbolicLink() || !sameSnapshot(opened, completed) || !sameSnapshot(completed, final)) {
      return { kind: "changed", bytesRead };
    }

    return { kind: "content", content, bytesRead };
  } catch {
    return { kind: "unavailable", bytesRead };
  } finally {
    await fileHandle?.close().catch(() => undefined);
  }
}

export async function inspectMcpToolFile(filePath: string): Promise<McpToolFileReport> {
  if (isBlockedOfflinePath(filePath)) {
    return blockedFileReport("offline-path-blocked", fileFinding(
      "plugin.tools_file.path.blocked", "fail", "The local tool definition path is not permitted for offline inspection.",
      "The offline tool definition inspection does not access remote or device paths.", "Provide a local regular file path."
    ));
  }

  const file = await readBoundedRegularFile(filePath);
  if (file.kind === "unavailable") {
    return incompleteFileReport(file.bytesRead, "file-unavailable", fileFinding(
      "plugin.tools_file.file.unavailable", "fail", "The local tool definition file could not be read.",
      "The offline tool definition inspection could not start.", "Provide a readable local regular file."
    ));
  }
  if (file.kind === "too-large") {
    return incompleteFileReport(file.bytesRead, "file-size-limit", fileFinding(
      "plugin.tools_file.file.too_large", "fail", "The local tool definition file exceeds the one MiB inspection limit.",
      "The offline tool definition inspection cannot safely read this file within its byte limit.", "Provide a tool definition file no larger than one MiB."
    ));
  }
  if (file.kind === "changed") {
    return incompleteFileReport(file.bytesRead, "file-changed", fileFinding(
      "plugin.tools_file.file.changed", "fail", "The local tool definition file changed during inspection.",
      "The offline tool definition inspection cannot rely on an inconsistent file snapshot.", "Retry after the file is stable."
    ));
  }
  if (file.kind === "symlink") {
    return blockedFileReport("final-symlink", fileFinding(
      "plugin.tools_file.file.symlink", "fail", "The local tool definition target is a symbolic link.",
      "The offline tool definition inspection does not follow final symbolic links.", "Provide a regular file directly."
    ));
  }
  if (file.kind === "not-regular") {
    return blockedFileReport("non-regular-file", fileFinding(
      "plugin.tools_file.file.not_regular", "fail", "The local tool definition target is not a regular file.",
      "The offline tool definition inspection reads only bounded regular files.", "Provide a regular file directly."
    ));
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
  } catch {
    return incompleteFileReport(file.bytesRead, "invalid-utf8", fileFinding(
      "plugin.tools_file.encoding.invalid", "fail", "The local tool definition file is not valid UTF-8.",
      "The offline tool definition inspection cannot parse the file safely.", "Save the tools/list response as UTF-8 JSON."
    ));
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded) as unknown;
  } catch {
    return incompleteFileReport(file.bytesRead, "invalid-json", fileFinding(
      "plugin.tools_file.json.invalid", "fail", "The local tool definition file is not valid JSON.",
      "The offline tool definition inspection cannot parse the file safely.", "Provide one UTF-8 JSON-RPC tools/list response."
    ));
  }

  const parsed = parseToolsResult(value);
  if (parsed === null) {
    return incompleteFileReport(file.bytesRead, "response-invalid", fileFinding(
      "plugin.tools_file.response.invalid", "fail", "The local JSON value is not a supported complete tools/list response.",
      "The offline tool definition inspection cannot identify a valid tool list.", "Provide one JSON-RPC 2.0 complete tools/list result with valid cache metadata."
    ));
  }

  const findings: CatalogFinding[] = [];
  const names = new Map<string, number>();
  let reason: string | null = null;
  let toolsChecked = 0;

  const addFindings = (items: CatalogFinding[]): boolean => {
    const remaining = MAX_FINDINGS - findings.length;
    if (items.length > remaining) {
      findings.push(...items.slice(0, remaining));
      reason = "finding-limit";
      return false;
    }
    findings.push(...items);
    return true;
  };

  for (const tool of parsed.tools) {
    if (toolsChecked >= MAX_TOOLS) {
      reason = "tool-limit";
      break;
    }
    toolsChecked += 1;
    const location = { page: 1, toolIndex: toolsChecked };
    if (!addFindings(inspectMcpToolDefinition(tool, location))) break;
    if (isJsonObject(tool) && typeof tool.name === "string") {
      const previous = names.get(tool.name);
      if (previous !== undefined && !addFindings([fileFinding(
        "plugin.catalog.tool.name.duplicate", "warn", "Two enumerated tools use the same name.",
        "Duplicate tool names can make client selection ambiguous.", "Use a unique MCP tool name for each definition."
      )])) {
        break;
      }
      if (previous !== undefined) {
        findings[findings.length - 1] = {
          ...findings[findings.length - 1],
          location: { ...location, relatedToolIndex: previous }
        };
      } else {
        names.set(tool.name, toolsChecked);
      }
    }
  }

  if (reason === null && parsed.tools.length > MAX_TOOLS) reason = "tool-limit";
  if (reason === null && parsed.hasNextCursor) reason = "more-pages-present";
  if (reason !== null) {
    return report(file.bytesRead, "incomplete", {
      complete: false,
      toolsChecked,
      hasNextCursor: parsed.hasNextCursor,
      reason
    }, findings);
  }
  return report(file.bytesRead, finalStatus(findings), {
    complete: true,
    toolsChecked,
    hasNextCursor: false,
    reason: null
  }, findings);
}
