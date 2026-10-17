import { loadMcpPromptFileSnapshot, type McpPromptFileReport } from "./mcp-prompt-file.js";
import {
  classifyAddedPrompt,
  classifyChangedPrompt,
  classifyRemovedPrompt,
  type PromptChangeImpact,
  type PromptChangeLocation,
  type PromptChangeReason
} from "./mcp-prompt-impact.js";
import { structurallyEqual } from "./mcp-tool-diff.js";

type DiffField = "arguments" | "description" | "title" | "other";
type JsonObject = Record<string, unknown>;

export interface McpPromptDiffReport {
  schemaVersion: 1;
  scope: "prompt-definitions-diff";
  status: "pass" | "warn" | "incomplete" | "blocked";
  before: McpPromptFileReport;
  after: McpPromptFileReport;
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
    promptRetrieval: "not-tested";
    impactClassification: "heuristic";
  };
  changes: Array<{
    kind: "added" | "removed" | "changed";
    beforePromptIndex: number | null;
    afterPromptIndex: number | null;
    fields: DiffField[];
    impact: PromptChangeImpact;
    reasons: PromptChangeReason[];
    // Present only with showNames, because prompt and argument names disclose the prompt surface.
    name?: string;
    locations?: PromptChangeLocation[];
  }>;
}

export interface McpPromptDiffOptions {
  // Adds prompt names and the arguments that reasons apply to; reports omit both by default.
  showNames?: boolean;
}

interface PromptDefinition {
  index: number;
  value: JsonObject;
}

const FIXED_FIELDS: Exclude<DiffField, "other">[] = ["arguments", "description", "title"];
const EXCLUDED_OTHER_FIELDS = new Set<string>(["name", ...FIXED_FIELDS]);
const COVERAGE: McpPromptDiffReport["coverage"] = {
  comparison: "structural-only",
  definitions: "shape-only",
  compatibility: "not-tested",
  serverCatalog: "not-tested",
  promptRetrieval: "not-tested",
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

function promptDefinitions(prompts: unknown[]): Map<string, PromptDefinition> | null {
  const definitions = new Map<string, PromptDefinition>();
  for (let offset = 0; offset < prompts.length; offset += 1) {
    const value = prompts[offset];
    if (!isJsonObject(value) || typeof value.name !== "string" || definitions.has(value.name)) return null;
    definitions.set(value.name, { index: offset + 1, value });
  }
  return definitions;
}

function incompleteReport(
  before: McpPromptFileReport,
  after: McpPromptFileReport,
  status: McpPromptDiffReport["status"],
  reason: McpPromptDiffReport["comparison"]["reason"]
): McpPromptDiffReport {
  return {
    schemaVersion: 1,
    scope: "prompt-definitions-diff",
    status,
    before,
    after,
    comparison: { complete: false, reason, added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null },
    coverage: { ...COVERAGE },
    changes: []
  };
}

export async function compareMcpPromptFiles(beforePath: string, afterPath: string, options: McpPromptDiffOptions = {}): Promise<McpPromptDiffReport> {
  const [beforeSnapshot, afterSnapshot] = await Promise.all([
    loadMcpPromptFileSnapshot(beforePath),
    loadMcpPromptFileSnapshot(afterPath)
  ]);
  const { report: before } = beforeSnapshot;
  const { report: after } = afterSnapshot;

  if (before.status === "blocked" || after.status === "blocked") {
    return incompleteReport(before, after, "blocked", "input-blocked");
  }
  if (!before.inspection.complete || !after.inspection.complete) {
    return incompleteReport(before, after, "incomplete", "input-incomplete");
  }
  if (before.status === "fail" || after.status === "fail" || beforeSnapshot.prompts === null || afterSnapshot.prompts === null) {
    return incompleteReport(before, after, "incomplete", "invalid-definitions");
  }

  const beforeDefinitions = promptDefinitions(beforeSnapshot.prompts);
  const afterDefinitions = promptDefinitions(afterSnapshot.prompts);
  if (beforeDefinitions === null || afterDefinitions === null) {
    return incompleteReport(before, after, "incomplete", "ambiguous-names");
  }

  const named = (name: string) => (options.showNames === true ? { name } : {});
  const changes: McpPromptDiffReport["changes"] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;

  for (const [name, beforeDefinition] of beforeDefinitions) {
    const afterDefinition = afterDefinitions.get(name);
    if (afterDefinition === undefined) {
      removed += 1;
      changes.push({ kind: "removed", ...named(name), beforePromptIndex: beforeDefinition.index, afterPromptIndex: null, fields: [], ...classifyRemovedPrompt() });
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
        beforePromptIndex: beforeDefinition.index,
        afterPromptIndex: afterDefinition.index,
        fields,
        ...classifyChangedPrompt(beforeDefinition.value, afterDefinition.value, fields, structurallyEqual, { locate: options.showNames === true })
      });
    }
  }
  for (const [name, afterDefinition] of afterDefinitions) {
    if (!beforeDefinitions.has(name)) {
      added += 1;
      changes.push({ kind: "added", ...named(name), beforePromptIndex: null, afterPromptIndex: afterDefinition.index, fields: [], ...classifyAddedPrompt() });
    }
  }

  return {
    schemaVersion: 1,
    scope: "prompt-definitions-diff",
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
