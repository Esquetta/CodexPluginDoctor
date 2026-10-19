import { loadMcpResourceTemplateFileSnapshot, type McpResourceTemplateFileReport } from "./mcp-resource-template-file.js";
import {
  classifyAddedResourceTemplate,
  classifyChangedResourceTemplate,
  classifyRemovedResourceTemplate,
  type ResourceTemplateChangeImpact,
  type ResourceTemplateChangeLocation,
  type ResourceTemplateChangeReason
} from "./mcp-resource-template-impact.js";
import { structurallyEqual } from "./mcp-tool-diff.js";

type DiffField = "uriTemplate" | "mimeType" | "description" | "title" | "other";
type JsonObject = Record<string, unknown>;

export interface McpResourceTemplateDiffReport {
  schemaVersion: 1;
  scope: "resource-template-definitions-diff";
  status: "pass" | "warn" | "incomplete" | "blocked";
  before: McpResourceTemplateFileReport;
  after: McpResourceTemplateFileReport;
  comparison: {
    complete: boolean;
    reason: "input-blocked" | "input-incomplete" | "invalid-definitions" | "ambiguous-names" | null;
    added: number | null;
    removed: number | null;
    changed: number | null;
    unchanged: number | null;
    breaking: number | null;
    unclassified: number | null;
  };
  coverage: {
    comparison: "structural-only";
    definitions: "shape-only";
    compatibility: "not-tested";
    serverCatalog: "not-tested";
    resourceRead: "not-tested";
    impactClassification: "heuristic";
  };
  changes: Array<{
    kind: "added" | "removed" | "changed";
    beforeTemplateIndex: number | null;
    afterTemplateIndex: number | null;
    fields: DiffField[];
    impact: ResourceTemplateChangeImpact;
    reasons: ResourceTemplateChangeReason[];
    // Present only with showNames, because template and variable names disclose the resource surface.
    name?: string;
    locations?: ResourceTemplateChangeLocation[];
  }>;
}

export interface McpResourceTemplateDiffOptions {
  // Adds template names and the variables that reasons apply to; reports omit both by default and never include URI templates.
  showNames?: boolean;
}

interface ResourceTemplateDefinition {
  index: number;
  value: JsonObject;
}

const FIXED_FIELDS: Exclude<DiffField, "other">[] = ["uriTemplate", "mimeType", "description", "title"];
const EXCLUDED_OTHER_FIELDS = new Set<string>(["name", ...FIXED_FIELDS]);
const COVERAGE: McpResourceTemplateDiffReport["coverage"] = {
  comparison: "structural-only",
  definitions: "shape-only",
  compatibility: "not-tested",
  serverCatalog: "not-tested",
  resourceRead: "not-tested",
  impactClassification: "heuristic"
};

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function filteredOther(definition: JsonObject): JsonObject {
  const other = Object.create(null) as JsonObject;
  for (const key of Object.keys(definition)) {
    if (!EXCLUDED_OTHER_FIELDS.has(key)) other[key] = definition[key];
  }
  return other;
}

function changedFields(before: JsonObject, after: JsonObject): DiffField[] {
  const fields: DiffField[] = [];
  for (const field of FIXED_FIELDS) {
    if (!structurallyEqual(before[field], after[field])) fields.push(field);
  }
  if (!structurallyEqual(filteredOther(before), filteredOther(after))) fields.push("other");
  return fields;
}

function templateDefinitions(templates: unknown[]): Map<string, ResourceTemplateDefinition> | null {
  const definitions = new Map<string, ResourceTemplateDefinition>();
  for (let offset = 0; offset < templates.length; offset += 1) {
    const value = templates[offset];
    if (!isJsonObject(value) || typeof value.name !== "string" || definitions.has(value.name)) return null;
    definitions.set(value.name, { index: offset + 1, value });
  }
  return definitions;
}

function incompleteReport(
  before: McpResourceTemplateFileReport,
  after: McpResourceTemplateFileReport,
  status: McpResourceTemplateDiffReport["status"],
  reason: McpResourceTemplateDiffReport["comparison"]["reason"]
): McpResourceTemplateDiffReport {
  return {
    schemaVersion: 1,
    scope: "resource-template-definitions-diff",
    status,
    before,
    after,
    comparison: { complete: false, reason, added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null },
    coverage: { ...COVERAGE },
    changes: []
  };
}

export async function compareMcpResourceTemplateFiles(
  beforePath: string,
  afterPath: string,
  options: McpResourceTemplateDiffOptions = {}
): Promise<McpResourceTemplateDiffReport> {
  const [beforeSnapshot, afterSnapshot] = await Promise.all([
    loadMcpResourceTemplateFileSnapshot(beforePath),
    loadMcpResourceTemplateFileSnapshot(afterPath)
  ]);
  const { report: before } = beforeSnapshot;
  const { report: after } = afterSnapshot;

  if (before.status === "blocked" || after.status === "blocked") {
    return incompleteReport(before, after, "blocked", "input-blocked");
  }
  if (!before.inspection.complete || !after.inspection.complete) {
    return incompleteReport(before, after, "incomplete", "input-incomplete");
  }
  if (before.status === "fail" || after.status === "fail" || beforeSnapshot.templates === null || afterSnapshot.templates === null) {
    return incompleteReport(before, after, "incomplete", "invalid-definitions");
  }

  const beforeDefinitions = templateDefinitions(beforeSnapshot.templates);
  const afterDefinitions = templateDefinitions(afterSnapshot.templates);
  if (beforeDefinitions === null || afterDefinitions === null) {
    return incompleteReport(before, after, "incomplete", "ambiguous-names");
  }

  const named = (name: string) => (options.showNames === true ? { name } : {});
  const changes: McpResourceTemplateDiffReport["changes"] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const [name, beforeDefinition] of beforeDefinitions) {
    const afterDefinition = afterDefinitions.get(name);
    if (afterDefinition === undefined) {
      removed += 1;
      changes.push({
        kind: "removed", ...named(name), beforeTemplateIndex: beforeDefinition.index, afterTemplateIndex: null, fields: [], ...classifyRemovedResourceTemplate()
      });
      continue;
    }
    const fields = changedFields(beforeDefinition.value, afterDefinition.value);
    if (fields.length === 0) {
      unchanged += 1;
    } else {
      changed += 1;
      changes.push({
        kind: "changed",
        ...named(name),
        beforeTemplateIndex: beforeDefinition.index,
        afterTemplateIndex: afterDefinition.index,
        fields,
        ...classifyChangedResourceTemplate(beforeDefinition.value, afterDefinition.value, fields, structurallyEqual, { locate: options.showNames === true })
      });
    }
  }
  for (const [name, afterDefinition] of afterDefinitions) {
    if (!beforeDefinitions.has(name)) {
      added += 1;
      changes.push({
        kind: "added", ...named(name), beforeTemplateIndex: null, afterTemplateIndex: afterDefinition.index, fields: [], ...classifyAddedResourceTemplate()
      });
    }
  }

  return {
    schemaVersion: 1,
    scope: "resource-template-definitions-diff",
    status: changes.length === 0 && before.status === "pass" && after.status === "pass" ? "pass" : "warn",
    before,
    after,
    comparison: {
      complete: true,
      reason: null,
      added,
      removed,
      changed,
      unchanged,
      breaking: changes.filter((change) => change.impact === "breaking").length,
      unclassified: changes.filter((change) => change.impact === "unclassified").length
    },
    coverage: { ...COVERAGE },
    changes
  };
}
