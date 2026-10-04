import {
  classifyAddedTool,
  classifyChangedTool,
  classifyRemovedTool,
  type ToolChangeImpact,
  type ToolChangeReason
} from "./mcp-tool-impact.js";
import {
  loadMcpToolFileSnapshot,
  type McpToolFileReport
} from "./mcp-tool-file.js";

type DiffField = "inputSchema" | "outputSchema" | "description" | "title" | "annotations" | "other";
type JsonObject = Record<string, unknown>;

export interface McpToolDiffReport {
  schemaVersion: 1;
  scope: "tool-definitions-diff";
  status: "pass" | "warn" | "incomplete" | "blocked";
  before: McpToolFileReport;
  after: McpToolFileReport;
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
    schema: "root-shape-only";
    compatibility: "not-tested";
    serverCatalog: "not-tested";
    toolExecution: "not-tested";
    impactClassification: "heuristic";
  };
  changes: Array<{
    kind: "added" | "removed" | "changed";
    beforeToolIndex: number | null;
    afterToolIndex: number | null;
    fields: DiffField[];
    impact: ToolChangeImpact;
    reasons: ToolChangeReason[];
  }>;
}

interface ToolDefinition {
  index: number;
  value: JsonObject;
}

const FIXED_FIELDS: Exclude<DiffField, "other">[] = [
  "inputSchema",
  "outputSchema",
  "description",
  "title",
  "annotations"
];
const EXCLUDED_OTHER_FIELDS = new Set<string>(["name", ...FIXED_FIELDS]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  const pending: Array<[unknown, unknown]> = [[left, right]];

  while (pending.length > 0) {
    const [currentLeft, currentRight] = pending.pop() as [unknown, unknown];
    if (Object.is(currentLeft, currentRight)) continue;
    if (Array.isArray(currentLeft) || Array.isArray(currentRight)) {
      if (!Array.isArray(currentLeft) || !Array.isArray(currentRight) || currentLeft.length !== currentRight.length) return false;
      for (let index = 0; index < currentLeft.length; index += 1) pending.push([currentLeft[index], currentRight[index]]);
      continue;
    }
    if (!isJsonObject(currentLeft) || !isJsonObject(currentRight)) return false;

    const leftKeys = Object.keys(currentLeft);
    const rightKeys = Object.keys(currentRight);
    if (leftKeys.length !== rightKeys.length) return false;
    for (const key of leftKeys) {
      if (!Object.hasOwn(currentRight, key)) return false;
      pending.push([currentLeft[key], currentRight[key]]);
    }
  }
  return true;
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

function toolDefinitions(tools: unknown[]): Map<string, ToolDefinition> | null {
  const definitions = new Map<string, ToolDefinition>();
  for (let offset = 0; offset < tools.length; offset += 1) {
    const value = tools[offset];
    if (!isJsonObject(value) || typeof value.name !== "string" || definitions.has(value.name)) return null;
    definitions.set(value.name, { index: offset + 1, value });
  }
  return definitions;
}

function incompleteReport(
  before: McpToolFileReport,
  after: McpToolFileReport,
  status: McpToolDiffReport["status"],
  reason: McpToolDiffReport["comparison"]["reason"]
): McpToolDiffReport {
  return {
    schemaVersion: 1,
    scope: "tool-definitions-diff",
    status,
    before,
    after,
    comparison: { complete: false, reason, added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null },
    coverage: {
      comparison: "structural-only",
      schema: "root-shape-only",
      compatibility: "not-tested",
      serverCatalog: "not-tested",
      toolExecution: "not-tested",
      impactClassification: "heuristic"
    },
    changes: []
  };
}

export async function compareMcpToolFiles(beforePath: string, afterPath: string): Promise<McpToolDiffReport> {
  const [beforeSnapshot, afterSnapshot] = await Promise.all([
    loadMcpToolFileSnapshot(beforePath),
    loadMcpToolFileSnapshot(afterPath)
  ]);
  const { report: before } = beforeSnapshot;
  const { report: after } = afterSnapshot;

  if (before.status === "blocked" || after.status === "blocked") {
    return incompleteReport(before, after, "blocked", "input-blocked");
  }
  if (!before.inspection.complete || !after.inspection.complete) {
    return incompleteReport(before, after, "incomplete", "input-incomplete");
  }
  if (before.status === "fail" || after.status === "fail" || beforeSnapshot.tools === null || afterSnapshot.tools === null) {
    return incompleteReport(before, after, "incomplete", "invalid-definitions");
  }

  const beforeDefinitions = toolDefinitions(beforeSnapshot.tools);
  const afterDefinitions = toolDefinitions(afterSnapshot.tools);
  if (beforeDefinitions === null || afterDefinitions === null) {
    return incompleteReport(before, after, "incomplete", "ambiguous-names");
  }

  const changes: McpToolDiffReport["changes"] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const [name, beforeDefinition] of beforeDefinitions) {
    const afterDefinition = afterDefinitions.get(name);
    if (afterDefinition === undefined) {
      removed += 1;
      changes.push({ kind: "removed", beforeToolIndex: beforeDefinition.index, afterToolIndex: null, fields: [], ...classifyRemovedTool() });
      continue;
    }
    const fields = changedFields(beforeDefinition.value, afterDefinition.value);
    if (fields.length === 0) {
      unchanged += 1;
    } else {
      changed += 1;
      changes.push({
        kind: "changed",
        beforeToolIndex: beforeDefinition.index,
        afterToolIndex: afterDefinition.index,
        fields,
        ...classifyChangedTool(beforeDefinition.value, afterDefinition.value, fields, structurallyEqual)
      });
    }
  }
  for (const [name, afterDefinition] of afterDefinitions) {
    if (!beforeDefinitions.has(name)) {
      added += 1;
      changes.push({ kind: "added", beforeToolIndex: null, afterToolIndex: afterDefinition.index, fields: [], ...classifyAddedTool() });
    }
  }

  return {
    schemaVersion: 1,
    scope: "tool-definitions-diff",
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
    coverage: {
      comparison: "structural-only",
      schema: "root-shape-only",
      compatibility: "not-tested",
      serverCatalog: "not-tested",
      toolExecution: "not-tested",
      impactClassification: "heuristic"
    },
    changes
  };
}
