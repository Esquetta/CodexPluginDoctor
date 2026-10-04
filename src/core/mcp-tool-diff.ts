import {
  loadMcpToolFileSnapshot,
  type McpToolFileReport
} from "./mcp-tool-file.js";

type DiffField = "inputSchema" | "outputSchema" | "description" | "title" | "annotations" | "other";
type JsonObject = Record<string, unknown>;

export const COMPATIBILITY_SIGNALS = [
  "tool-removed",
  "input-required-added",
  "input-property-removed",
  "input-property-type-narrowed",
  "input-property-enum-narrowed",
  "input-additional-properties-closed",
  "output-schema-removed",
  "output-required-removed",
  "output-property-removed",
  "output-property-type-widened",
  "output-property-enum-widened"
] as const;
export type CompatibilitySignal = typeof COMPATIBILITY_SIGNALS[number];

export interface McpToolDiffOptions {
  compatibility?: boolean;
}

export interface McpToolDiffReport {
  schemaVersion: 1;
  scope: "tool-definitions-diff";
  status: "pass" | "warn" | "breaking" | "incomplete" | "blocked";
  before: McpToolFileReport;
  after: McpToolFileReport;
  comparison: {
    complete: boolean;
    reason: "input-blocked" | "input-incomplete" | "invalid-definitions" | "ambiguous-names" | null;
    added: number | null;
    removed: number | null;
    changed: number | null;
    unchanged: number | null;
    breaking?: number | null;
  };
  coverage: {
    comparison: "structural-only";
    schema: "root-shape-only";
    compatibility: "not-tested" | "root-property-signals";
    serverCatalog: "not-tested";
    toolExecution: "not-tested";
  };
  changes: Array<{
    kind: "added" | "removed" | "changed";
    beforeToolIndex: number | null;
    afterToolIndex: number | null;
    fields: DiffField[];
    signals?: CompatibilitySignal[];
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

class CanonicalToken {
  constructor(readonly text: string) {}
}

// Canonical, key-order-independent encoding used to compare enum members as set elements.
function canonicalKey(value: unknown): string {
  const parts: string[] = [];
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current instanceof CanonicalToken) {
      parts.push(current.text);
    } else if (Array.isArray(current)) {
      parts.push("[");
      pending.push(new CanonicalToken("]"));
      for (let index = current.length - 1; index >= 0; index -= 1) {
        pending.push(current[index]);
        if (index > 0) pending.push(new CanonicalToken(","));
      }
    } else if (isJsonObject(current)) {
      const keys = Object.keys(current).sort();
      parts.push("{");
      pending.push(new CanonicalToken("}"));
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        pending.push(current[keys[index]]);
        pending.push(new CanonicalToken(`${index > 0 ? "," : ""}${JSON.stringify(keys[index])}:`));
      }
    } else {
      parts.push(JSON.stringify(current) ?? "null");
    }
  }
  return parts.join("");
}

// null means the constraint is absent ("any value"); undefined means it is present but unreadable,
// in which case no signal is derived from it.
type Constraint = Set<string> | null | undefined;

function typeSet(schema: unknown): Constraint {
  if (!isJsonObject(schema)) return undefined;
  if (!Object.hasOwn(schema, "type")) return null;
  const type = schema.type;
  if (typeof type === "string") return new Set([type]);
  if (Array.isArray(type) && type.length > 0 && type.every((entry) => typeof entry === "string")) return new Set(type as string[]);
  return undefined;
}

function enumSet(schema: unknown): Constraint {
  if (!isJsonObject(schema)) return undefined;
  if (!Object.hasOwn(schema, "enum")) return null;
  return Array.isArray(schema.enum) ? new Set(schema.enum.map(canonicalKey)) : undefined;
}

function typesWithin(inner: Constraint, outer: Constraint): boolean {
  if (inner === undefined || outer === undefined || outer === null) return true;
  if (inner === null) return false;
  for (const type of inner) {
    if (!outer.has(type) && !(type === "integer" && outer.has("number"))) return false;
  }
  return true;
}

function enumWithin(inner: Constraint, outer: Constraint): boolean {
  if (inner === undefined || outer === undefined || outer === null) return true;
  if (inner === null) return false;
  for (const member of inner) if (!outer.has(member)) return false;
  return true;
}

function schemaProperties(schema: unknown): JsonObject {
  return isJsonObject(schema) && isJsonObject(schema.properties) ? schema.properties : {};
}

function schemaRequired(schema: unknown): Set<string> {
  if (!isJsonObject(schema) || !Array.isArray(schema.required)) return new Set();
  return new Set(schema.required.filter((entry): entry is string => typeof entry === "string"));
}

function compatibilitySignals(before: JsonObject, after: JsonObject): CompatibilitySignal[] {
  const signals = new Set<CompatibilitySignal>();

  const beforeInput = before.inputSchema;
  const afterInput = after.inputSchema;
  const beforeInputRequired = schemaRequired(beforeInput);
  for (const name of schemaRequired(afterInput)) {
    if (!beforeInputRequired.has(name)) signals.add("input-required-added");
  }
  const beforeInputProperties = schemaProperties(beforeInput);
  const afterInputProperties = schemaProperties(afterInput);
  for (const name of Object.keys(beforeInputProperties)) {
    if (!Object.hasOwn(afterInputProperties, name)) {
      signals.add("input-property-removed");
      continue;
    }
    const beforeProperty = beforeInputProperties[name];
    const afterProperty = afterInputProperties[name];
    // Inputs break when the accepted set shrinks: every previously valid value must still be accepted.
    if (!typesWithin(typeSet(beforeProperty), typeSet(afterProperty))) signals.add("input-property-type-narrowed");
    if (!enumWithin(enumSet(beforeProperty), enumSet(afterProperty))) signals.add("input-property-enum-narrowed");
  }
  if (isJsonObject(beforeInput) && isJsonObject(afterInput)
    && beforeInput.additionalProperties !== false && afterInput.additionalProperties === false) {
    signals.add("input-additional-properties-closed");
  }

  const beforeOutput = before.outputSchema;
  const afterOutput = after.outputSchema;
  if (Object.hasOwn(before, "outputSchema") && !Object.hasOwn(after, "outputSchema")) {
    signals.add("output-schema-removed");
  } else if (isJsonObject(beforeOutput) && isJsonObject(afterOutput)) {
    const afterOutputRequired = schemaRequired(afterOutput);
    for (const name of schemaRequired(beforeOutput)) {
      if (!afterOutputRequired.has(name)) signals.add("output-required-removed");
    }
    const beforeOutputProperties = schemaProperties(beforeOutput);
    const afterOutputProperties = schemaProperties(afterOutput);
    for (const name of Object.keys(beforeOutputProperties)) {
      if (!Object.hasOwn(afterOutputProperties, name)) {
        signals.add("output-property-removed");
        continue;
      }
      const beforeProperty = beforeOutputProperties[name];
      const afterProperty = afterOutputProperties[name];
      // Outputs break when the produced set grows: every new value must still be one consumers expect.
      if (!typesWithin(typeSet(afterProperty), typeSet(beforeProperty))) signals.add("output-property-type-widened");
      if (!enumWithin(enumSet(afterProperty), enumSet(beforeProperty))) signals.add("output-property-enum-widened");
    }
  }

  return COMPATIBILITY_SIGNALS.filter((signal) => signals.has(signal));
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
  reason: McpToolDiffReport["comparison"]["reason"],
  compatibility: boolean
): McpToolDiffReport {
  return {
    schemaVersion: 1,
    scope: "tool-definitions-diff",
    status,
    before,
    after,
    comparison: {
      complete: false, reason, added: null, removed: null, changed: null, unchanged: null,
      ...(compatibility ? { breaking: null } : {})
    },
    coverage: {
      comparison: "structural-only",
      schema: "root-shape-only",
      compatibility: compatibility ? "root-property-signals" : "not-tested",
      serverCatalog: "not-tested",
      toolExecution: "not-tested"
    },
    changes: []
  };
}

export async function compareMcpToolFiles(
  beforePath: string,
  afterPath: string,
  options: McpToolDiffOptions = {}
): Promise<McpToolDiffReport> {
  const compatibility = options.compatibility === true;
  const [beforeSnapshot, afterSnapshot] = await Promise.all([
    loadMcpToolFileSnapshot(beforePath),
    loadMcpToolFileSnapshot(afterPath)
  ]);
  const { report: before } = beforeSnapshot;
  const { report: after } = afterSnapshot;

  if (before.status === "blocked" || after.status === "blocked") {
    return incompleteReport(before, after, "blocked", "input-blocked", compatibility);
  }
  if (!before.inspection.complete || !after.inspection.complete) {
    return incompleteReport(before, after, "incomplete", "input-incomplete", compatibility);
  }
  if (before.status === "fail" || after.status === "fail" || beforeSnapshot.tools === null || afterSnapshot.tools === null) {
    return incompleteReport(before, after, "incomplete", "invalid-definitions", compatibility);
  }

  const beforeDefinitions = toolDefinitions(beforeSnapshot.tools);
  const afterDefinitions = toolDefinitions(afterSnapshot.tools);
  if (beforeDefinitions === null || afterDefinitions === null) {
    return incompleteReport(before, after, "incomplete", "ambiguous-names", compatibility);
  }

  const changes: McpToolDiffReport["changes"] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unchanged = 0;
  let breaking = 0;

  for (const [name, beforeDefinition] of beforeDefinitions) {
    const afterDefinition = afterDefinitions.get(name);
    if (afterDefinition === undefined) {
      removed += 1;
      if (compatibility) breaking += 1;
      changes.push({
        kind: "removed", beforeToolIndex: beforeDefinition.index, afterToolIndex: null, fields: [],
        ...(compatibility ? { signals: ["tool-removed" as const] } : {})
      });
      continue;
    }
    const fields = changedFields(beforeDefinition.value, afterDefinition.value);
    if (fields.length === 0) {
      unchanged += 1;
    } else {
      changed += 1;
      const signals = compatibility ? compatibilitySignals(beforeDefinition.value, afterDefinition.value) : [];
      if (signals.length > 0) breaking += 1;
      changes.push({
        kind: "changed", beforeToolIndex: beforeDefinition.index, afterToolIndex: afterDefinition.index, fields,
        ...(compatibility ? { signals } : {})
      });
    }
  }
  for (const [name, afterDefinition] of afterDefinitions) {
    if (!beforeDefinitions.has(name)) {
      added += 1;
      changes.push({
        kind: "added", beforeToolIndex: null, afterToolIndex: afterDefinition.index, fields: [],
        ...(compatibility ? { signals: [] } : {})
      });
    }
  }

  return {
    schemaVersion: 1,
    scope: "tool-definitions-diff",
    status: breaking > 0
      ? "breaking"
      : changes.length === 0 && before.status === "pass" && after.status === "pass" ? "pass" : "warn",
    before,
    after,
    comparison: {
      complete: true, reason: null, added, removed, changed, unchanged,
      ...(compatibility ? { breaking } : {})
    },
    coverage: {
      comparison: "structural-only",
      schema: "root-shape-only",
      compatibility: compatibility ? "root-property-signals" : "not-tested",
      serverCatalog: "not-tested",
      toolExecution: "not-tested"
    },
    changes
  };
}
