import { createMcpResourceTemplateCatalogInspector, type ResourceTemplateCatalogFinding } from "./mcp-resource-template-definition.js";
import { isBlockedOfflinePath, readBoundedRegularFile } from "./mcp-tool-file.js";

type JsonObject = Record<string, unknown>;

export interface McpResourceTemplateFileReport {
  schemaVersion: 1;
  scope: "resource-template-definitions-file";
  status: "pass" | "warn" | "fail" | "incomplete" | "blocked";
  source: {
    kind: "file";
    format: "mcp-resource-templates-list-response";
    bytesRead: number;
  };
  inspection: {
    complete: boolean;
    templatesChecked: number;
    hasNextCursor: boolean | null;
    reason: string | null;
  };
  coverage: {
    definitions: "shape-only";
    discovery: "not-tested";
    serverCatalog: "not-tested";
    resourceRead: "not-tested";
    fullConformance: "not-tested";
  };
  findings: ResourceTemplateCatalogFinding[];
}

export interface McpResourceTemplateFileSnapshot {
  report: McpResourceTemplateFileReport;
  templates: unknown[] | null;
}

function snapshot(report: McpResourceTemplateFileReport, templates: unknown[] | null = null): McpResourceTemplateFileSnapshot {
  return { report, templates };
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function report(
  bytesRead: number,
  status: McpResourceTemplateFileReport["status"],
  inspection: McpResourceTemplateFileReport["inspection"],
  findings: ResourceTemplateCatalogFinding[]
): McpResourceTemplateFileReport {
  return {
    schemaVersion: 1,
    scope: "resource-template-definitions-file",
    status,
    source: { kind: "file", format: "mcp-resource-templates-list-response", bytesRead },
    inspection,
    coverage: {
      definitions: "shape-only",
      discovery: "not-tested",
      serverCatalog: "not-tested",
      resourceRead: "not-tested",
      fullConformance: "not-tested"
    },
    findings
  };
}

function fileFinding(id: string, message: string, impact: string, suggestedFix: string): ResourceTemplateCatalogFinding {
  return { id, severity: "fail", message, impact, suggestedFix };
}

function incompleteFileReport(bytesRead: number, reason: string, finding: ResourceTemplateCatalogFinding): McpResourceTemplateFileReport {
  return report(bytesRead, "incomplete", { complete: false, templatesChecked: 0, hasNextCursor: null, reason }, [finding]);
}

function blockedFileReport(reason: string, finding: ResourceTemplateCatalogFinding): McpResourceTemplateFileReport {
  return report(0, "blocked", { complete: false, templatesChecked: 0, hasNextCursor: null, reason }, [finding]);
}

function finalStatus(findings: ResourceTemplateCatalogFinding[]): "pass" | "warn" | "fail" {
  if (findings.some((finding) => finding.severity === "fail")) return "fail";
  return findings.some((finding) => finding.severity === "warn") ? "warn" : "pass";
}

function parseResourceTemplatesResult(value: unknown): { templates: unknown[]; hasNextCursor: boolean } | null {
  if (!isJsonObject(value)
    || value.jsonrpc !== "2.0"
    || !Object.hasOwn(value, "id")
    || !(typeof value.id === "string" || (typeof value.id === "number" && Number.isFinite(value.id)))
    || !Object.hasOwn(value, "result")
    || Object.hasOwn(value, "error")
    || !isJsonObject(value.result)
    || value.result.resultType !== "complete"
    || !Array.isArray(value.result.resourceTemplates)
    || typeof value.result.ttlMs !== "number"
    || !Number.isFinite(value.result.ttlMs)
    || value.result.ttlMs < 0
    || (value.result.cacheScope !== "public" && value.result.cacheScope !== "private")) {
    return null;
  }

  const hasNextCursor = Object.hasOwn(value.result, "nextCursor");
  if (hasNextCursor && typeof value.result.nextCursor !== "string") return null;

  return { templates: value.result.resourceTemplates, hasNextCursor };
}

export async function loadMcpResourceTemplateFileSnapshot(filePath: string): Promise<McpResourceTemplateFileSnapshot> {
  if (isBlockedOfflinePath(filePath)) {
    return snapshot(blockedFileReport("offline-path-blocked", fileFinding(
      "plugin.resource_templates_file.path.blocked", "The local resource template definition path is not permitted for offline inspection.",
      "The offline resource template definition inspection does not access remote or device paths.", "Provide a local regular file path."
    )));
  }

  const file = await readBoundedRegularFile(filePath);
  if (file.kind === "unavailable") {
    return snapshot(incompleteFileReport(file.bytesRead, "file-unavailable", fileFinding(
      "plugin.resource_templates_file.file.unavailable", "The local resource template definition file could not be read.",
      "The offline resource template definition inspection could not start.", "Provide a readable local regular file."
    )));
  }
  if (file.kind === "too-large") {
    return snapshot(incompleteFileReport(file.bytesRead, "file-size-limit", fileFinding(
      "plugin.resource_templates_file.file.too_large", "The local resource template definition file exceeds the one MiB inspection limit.",
      "The offline resource template definition inspection cannot safely read this file within its byte limit.",
      "Provide a resource template definition file no larger than one MiB."
    )));
  }
  if (file.kind === "changed") {
    return snapshot(incompleteFileReport(file.bytesRead, "file-changed", fileFinding(
      "plugin.resource_templates_file.file.changed", "The local resource template definition file changed during inspection.",
      "The offline resource template definition inspection cannot rely on an inconsistent file snapshot.", "Retry after the file is stable."
    )));
  }
  if (file.kind === "symlink") {
    return snapshot(blockedFileReport("final-symlink", fileFinding(
      "plugin.resource_templates_file.file.symlink", "The local resource template definition target is a symbolic link.",
      "The offline resource template definition inspection does not follow final symbolic links.", "Provide a regular file directly."
    )));
  }
  if (file.kind === "not-regular") {
    return snapshot(blockedFileReport("non-regular-file", fileFinding(
      "plugin.resource_templates_file.file.not_regular", "The local resource template definition target is not a regular file.",
      "The offline resource template definition inspection reads only bounded regular files.", "Provide a regular file directly."
    )));
  }

  let decoded: string;
  try {
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(file.content);
  } catch {
    return snapshot(incompleteFileReport(file.bytesRead, "invalid-utf8", fileFinding(
      "plugin.resource_templates_file.encoding.invalid", "The local resource template definition file is not valid UTF-8.",
      "The offline resource template definition inspection cannot parse the file safely.", "Save the resources/templates/list response as UTF-8 JSON."
    )));
  }

  let value: unknown;
  try {
    value = JSON.parse(decoded) as unknown;
  } catch {
    return snapshot(incompleteFileReport(file.bytesRead, "invalid-json", fileFinding(
      "plugin.resource_templates_file.json.invalid", "The local resource template definition file is not valid JSON.",
      "The offline resource template definition inspection cannot parse the file safely.", "Provide one UTF-8 JSON-RPC resources/templates/list response."
    )));
  }

  const parsed = parseResourceTemplatesResult(value);
  if (parsed === null) {
    return snapshot(incompleteFileReport(file.bytesRead, "response-invalid", fileFinding(
      "plugin.resource_templates_file.response.invalid", "The local JSON value is not a supported complete resources/templates/list response.",
      "The offline resource template definition inspection cannot identify a valid resource template list.",
      "Provide one JSON-RPC 2.0 complete resources/templates/list result with valid cache metadata."
    )));
  }

  const inspector = createMcpResourceTemplateCatalogInspector();
  const reason = inspector.inspectPage(parsed.templates, 1, () => false) ?? (parsed.hasNextCursor ? "more-pages-present" : null);
  if (reason !== null) {
    return snapshot(report(file.bytesRead, "incomplete", {
      complete: false,
      templatesChecked: inspector.templatesChecked,
      hasNextCursor: parsed.hasNextCursor,
      reason
    }, inspector.findings), parsed.templates);
  }
  return snapshot(report(file.bytesRead, finalStatus(inspector.findings), {
    complete: true,
    templatesChecked: inspector.templatesChecked,
    hasNextCursor: false,
    reason: null
  }, inspector.findings), parsed.templates);
}

export async function inspectMcpResourceTemplateFile(filePath: string): Promise<McpResourceTemplateFileReport> {
  return (await loadMcpResourceTemplateFileSnapshot(filePath)).report;
}
