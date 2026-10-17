import { createMcpPromptCatalogInspector, type PromptCatalogFinding } from "./mcp-prompt-definition.js";
import { isBlockedOfflinePath, readBoundedRegularFile } from "./mcp-tool-file.js";

type JsonObject = Record<string, unknown>;

export interface McpPromptFileReport {
  schemaVersion: 1;
  scope: "prompt-definitions-file";
  status: "pass" | "warn" | "fail" | "incomplete" | "blocked";
  source: {
    kind: "file";
    format: "mcp-prompts-list-response";
    bytesRead: number;
  };
  inspection: {
    complete: boolean;
    promptsChecked: number;
    hasNextCursor: boolean | null;
    reason: string | null;
  };
  coverage: {
    definitions: "shape-only";
    discovery: "not-tested";
    serverCatalog: "not-tested";
    promptRetrieval: "not-tested";
    fullConformance: "not-tested";
  };
  findings: PromptCatalogFinding[];
}

export interface McpPromptFileSnapshot {
  report: McpPromptFileReport;
  prompts: unknown[] | null;
}

function snapshot(report: McpPromptFileReport, prompts: unknown[] | null = null): McpPromptFileSnapshot {
  return { report, prompts };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function report(
  bytesRead: number,
  status: McpPromptFileReport["status"],
  inspection: McpPromptFileReport["inspection"],
  findings: PromptCatalogFinding[]
): McpPromptFileReport {
  return {
    schemaVersion: 1,
    scope: "prompt-definitions-file",
    status,
    source: { kind: "file", format: "mcp-prompts-list-response", bytesRead },
    inspection,
    coverage: {
      definitions: "shape-only",
      discovery: "not-tested",
      serverCatalog: "not-tested",
      promptRetrieval: "not-tested",
      fullConformance: "not-tested"
    },
    findings
  };
}

function fileFinding(id: string, message: string, impact: string, suggestedFix: string): PromptCatalogFinding {
  return { id, severity: "fail", message, impact, suggestedFix };
}

function incompleteFileReport(bytesRead: number, reason: string, finding: PromptCatalogFinding): McpPromptFileReport {
  return report(bytesRead, "incomplete", { complete: false, promptsChecked: 0, hasNextCursor: null, reason }, [finding]);
}

function blockedFileReport(reason: string, finding: PromptCatalogFinding): McpPromptFileReport {
  return report(0, "blocked", { complete: false, promptsChecked: 0, hasNextCursor: null, reason }, [finding]);
}

function finalStatus(findings: PromptCatalogFinding[]): "pass" | "warn" | "fail" {
  if (findings.some((finding) => finding.severity === "fail")) return "fail";
  return findings.some((finding) => finding.severity === "warn") ? "warn" : "pass";
}

function parsePromptsResult(value: unknown): { prompts: unknown[]; hasNextCursor: boolean } | null {
  if (!isJsonObject(value)
    || value.jsonrpc !== "2.0"
    || !Object.hasOwn(value, "id")
    || !(typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id)))
    || !Object.hasOwn(value, "result")
    || Object.hasOwn(value, "error")
    || !isJsonObject(value.result)
    || value.result.resultType !== "complete"
    || !Array.isArray(value.result.prompts)
    || typeof value.result.ttlMs !== "number"
    || !Number.isFinite(value.result.ttlMs)
    || value.result.ttlMs < 0
    || (value.result.cacheScope !== "public" && value.result.cacheScope !== "private")) {
    return null;
  }

  const hasNextCursor = Object.hasOwn(value.result, "nextCursor");
  if (hasNextCursor && typeof value.result.nextCursor !== "string") return null;

  return { prompts: value.result.prompts, hasNextCursor };
}

export async function loadMcpPromptFileSnapshot(filePath: string): Promise<McpPromptFileSnapshot> {
  if (isBlockedOfflinePath(filePath)) {
    return snapshot(blockedFileReport("offline-path-blocked", fileFinding(
      "plugin.prompts_file.path.blocked", "The local prompt definition path is not permitted for offline inspection.",
      "The offline prompt definition inspection does not access remote or device paths.", "Provide a local regular file path."
    )));
  }

  const file = await readBoundedRegularFile(filePath);
  if (file.kind === "unavailable") {
    return snapshot(incompleteFileReport(file.bytesRead, "file-unavailable", fileFinding(
      "plugin.prompts_file.file.unavailable", "The local prompt definition file could not be read.",
      "The offline prompt definition inspection could not start.", "Provide a readable local regular file."
    )));
  }
  if (file.kind === "too-large") {
    return snapshot(incompleteFileReport(file.bytesRead, "file-size-limit", fileFinding(
      "plugin.prompts_file.file.too_large", "The local prompt definition file exceeds the one MiB inspection limit.",
      "The offline prompt definition inspection cannot safely read this file within its byte limit.", "Provide a prompt definition file no larger than one MiB."
    )));
  }
  if (file.kind === "changed") {
    return snapshot(incompleteFileReport(file.bytesRead, "file-changed", fileFinding(
      "plugin.prompts_file.file.changed", "The local prompt definition file changed during inspection.",
      "The offline prompt definition inspection cannot rely on an inconsistent file snapshot.", "Retry after the file is stable."
    )));
  }
  if (file.kind === "symlink") {
    return snapshot(blockedFileReport("final-symlink", fileFinding(
      "plugin.prompts_file.file.symlink", "The local prompt definition target is a symbolic link.",
      "The offline prompt definition inspection does not follow final symbolic links.", "Provide a regular file directly."
    )));
  }
  if (file.kind === "not-regular") {
    return snapshot(blockedFileReport("non-regular-file", fileFinding(
      "plugin.prompts_file.file.not_regular", "The local prompt definition target is not a regular file.",
      "The offline prompt definition inspection reads only bounded regular files.", "Provide a regular file directly."
    )));
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
  } catch {
    return snapshot(incompleteFileReport(file.bytesRead, "invalid-utf8", fileFinding(
      "plugin.prompts_file.encoding.invalid", "The local prompt definition file is not valid UTF-8.",
      "The offline prompt definition inspection cannot parse the file safely.", "Save the prompts/list response as UTF-8 JSON."
    )));
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded) as unknown;
  } catch {
    return snapshot(incompleteFileReport(file.bytesRead, "invalid-json", fileFinding(
      "plugin.prompts_file.json.invalid", "The local prompt definition file is not valid JSON.",
      "The offline prompt definition inspection cannot parse the file safely.", "Provide one UTF-8 JSON-RPC prompts/list response."
    )));
  }

  const parsed = parsePromptsResult(value);
  if (parsed === null) {
    return snapshot(incompleteFileReport(file.bytesRead, "response-invalid", fileFinding(
      "plugin.prompts_file.response.invalid", "The local JSON value is not a supported complete prompts/list response.",
      "The offline prompt definition inspection cannot identify a valid prompt list.", "Provide one JSON-RPC 2.0 complete prompts/list result with valid cache metadata."
    )));
  }

  const inspector = createMcpPromptCatalogInspector();
  const reason = inspector.inspectPage(parsed.prompts, 1, () => false) ?? (parsed.hasNextCursor ? "more-pages-present" : null);
  if (reason !== null) {
    return snapshot(report(file.bytesRead, "incomplete", {
      complete: false,
      promptsChecked: inspector.promptsChecked,
      hasNextCursor: parsed.hasNextCursor,
      reason
    }, inspector.findings), parsed.prompts);
  }
  return snapshot(report(file.bytesRead, finalStatus(inspector.findings), {
    complete: true,
    promptsChecked: inspector.promptsChecked,
    hasNextCursor: false,
    reason: null
  }, inspector.findings), parsed.prompts);
}

export async function inspectMcpPromptFile(filePath: string): Promise<McpPromptFileReport> {
  return (await loadMcpPromptFileSnapshot(filePath)).report;
}
