type JsonObject = Record<string, unknown>;

export type ToolChangeImpact = "breaking" | "compatible" | "unclassified";

export const TOOL_CHANGE_REASONS = [
  "tool-removed",
  "input-type-narrowed",
  "input-required-added",
  "input-property-removed",
  "input-property-type-narrowed",
  "input-property-enum-narrowed",
  "input-additional-properties-closed",
  "input-schema-unclassified",
  "output-schema-removed",
  "output-type-widened",
  "output-property-removed",
  "output-guarantee-removed",
  "output-property-type-widened",
  "output-property-enum-widened",
  "output-schema-unclassified",
  "annotation-safety-reduced",
  "other-fields-unclassified"
] as const;

export type ToolChangeReason = (typeof TOOL_CHANGE_REASONS)[number];

export interface ToolChangeClassification {
  impact: ToolChangeImpact;
  reasons: ToolChangeReason[];
}

type Equal = (left: unknown, right: unknown) => boolean;

const UNCLASSIFIED_REASONS = new Set<ToolChangeReason>([
  "input-schema-unclassified",
  "output-schema-unclassified",
  "other-fields-unclassified"
]);

// Keywords that document a schema without constraining accepted or produced values.
const DOCUMENTATION_KEYWORDS = new Set(["title", "description", "examples", "default", "deprecated", "$comment"]);
const ROOT_STRUCTURAL_KEYWORDS = new Set(["type", "properties", "required", "additionalProperties", "$schema"]);
const PROPERTY_STRUCTURAL_KEYWORDS = new Set(["type", "enum"]);

// MCP tool annotation defaults, oriented so `true` is the safer reading.
const SAFETY_HINTS: Array<{ key: string; absent: boolean; safe: boolean }> = [
  { key: "readOnlyHint", absent: false, safe: true },
  { key: "destructiveHint", absent: true, safe: false },
  { key: "idempotentHint", absent: false, safe: true },
  { key: "openWorldHint", absent: true, safe: false }
];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Returns the set of declared JSON types, or null when the schema does not restrict type. */
function typeSet(schema: JsonObject): Set<string> | null {
  const declared = schema.type;
  if (typeof declared === "string") return new Set([declared]);
  if (Array.isArray(declared) && declared.every((entry) => typeof entry === "string")) return new Set(declared as string[]);
  return null;
}

/** True when every value admitted by `inner` is also admitted by `outer`. */
function typesCovered(inner: Set<string> | null, outer: Set<string> | null): boolean {
  if (outer === null) return true;
  if (inner === null) return false;
  for (const type of inner) {
    if (outer.has(type)) continue;
    if (type === "integer" && outer.has("number")) continue;
    return false;
  }
  return true;
}

function enumCovered(inner: unknown, outer: unknown, equal: Equal): boolean | null {
  if (outer === undefined) return true;
  if (!Array.isArray(outer)) return null;
  if (inner === undefined) return false;
  if (!Array.isArray(inner)) return null;
  return inner.every((value) => outer.some((candidate) => equal(value, candidate)));
}

function stringSet(value: unknown): Set<string> | null {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) return null;
  return new Set(value as string[]);
}

function objectMap(value: unknown): JsonObject | null {
  if (value === undefined) return {};
  return isJsonObject(value) ? value : null;
}

function keywordsOutside(schema: JsonObject, allowed: Set<string>): JsonObject {
  const rest = Object.create(null) as JsonObject;
  for (const key of Object.keys(schema)) {
    if (!allowed.has(key) && !DOCUMENTATION_KEYWORDS.has(key)) rest[key] = schema[key];
  }
  return rest;
}

/**
 * Compares one property subschema. `direction` is "input" when callers must keep being
 * accepted (after must cover before) and "output" when consumers must keep understanding
 * results (before must cover after).
 */
function compareProperty(
  before: unknown,
  after: unknown,
  direction: "input" | "output",
  equal: Equal,
  reasons: Set<ToolChangeReason>
): void {
  if (equal(before, after)) return;
  const unclassified: ToolChangeReason = direction === "input" ? "input-schema-unclassified" : "output-schema-unclassified";
  if (!isJsonObject(before) || !isJsonObject(after)
    || !equal(keywordsOutside(before, PROPERTY_STRUCTURAL_KEYWORDS), keywordsOutside(after, PROPERTY_STRUCTURAL_KEYWORDS))) {
    reasons.add(unclassified);
    return;
  }
  const [inner, outer] = direction === "input" ? [before, after] : [after, before];
  if (!typesCovered(typeSet(inner), typeSet(outer))) {
    reasons.add(direction === "input" ? "input-property-type-narrowed" : "output-property-type-widened");
  }
  const enumResult = enumCovered(inner.enum, outer.enum, equal);
  if (enumResult === null) reasons.add(unclassified);
  else if (!enumResult) reasons.add(direction === "input" ? "input-property-enum-narrowed" : "output-property-enum-widened");
}

function classifyInputSchema(before: unknown, after: unknown, equal: Equal, reasons: Set<ToolChangeReason>): void {
  if (!isJsonObject(before) || !isJsonObject(after)
    || !equal(keywordsOutside(before, ROOT_STRUCTURAL_KEYWORDS), keywordsOutside(after, ROOT_STRUCTURAL_KEYWORDS))
    || !equal(before.$schema, after.$schema)) {
    reasons.add("input-schema-unclassified");
    return;
  }
  if (!typesCovered(typeSet(before), typeSet(after))) reasons.add("input-type-narrowed");

  const beforeRequired = stringSet(before.required);
  const afterRequired = stringSet(after.required);
  const beforeProperties = objectMap(before.properties);
  const afterProperties = objectMap(after.properties);
  if (beforeRequired === null || afterRequired === null || beforeProperties === null || afterProperties === null) {
    reasons.add("input-schema-unclassified");
    return;
  }
  for (const key of afterRequired) {
    if (!beforeRequired.has(key)) reasons.add("input-required-added");
  }
  for (const key of Object.keys(beforeProperties)) {
    if (!Object.hasOwn(afterProperties, key)) reasons.add("input-property-removed");
    else compareProperty(beforeProperties[key], afterProperties[key], "input", equal, reasons);
  }

  if (!equal(before.additionalProperties, after.additionalProperties)) {
    if (after.additionalProperties === false) reasons.add("input-additional-properties-closed");
    else if (!(after.additionalProperties === undefined || after.additionalProperties === true)) reasons.add("input-schema-unclassified");
  }
}

function classifyOutputSchema(before: unknown, after: unknown, equal: Equal, reasons: Set<ToolChangeReason>): void {
  if (before === undefined) return;
  if (after === undefined) {
    reasons.add("output-schema-removed");
    return;
  }
  if (!isJsonObject(before) || !isJsonObject(after)
    || !equal(keywordsOutside(before, ROOT_STRUCTURAL_KEYWORDS), keywordsOutside(after, ROOT_STRUCTURAL_KEYWORDS))
    || !equal(before.$schema, after.$schema)) {
    reasons.add("output-schema-unclassified");
    return;
  }
  if (!typesCovered(typeSet(after), typeSet(before))) reasons.add("output-type-widened");

  const beforeRequired = stringSet(before.required);
  const afterRequired = stringSet(after.required);
  const beforeProperties = objectMap(before.properties);
  const afterProperties = objectMap(after.properties);
  if (beforeRequired === null || afterRequired === null || beforeProperties === null || afterProperties === null) {
    reasons.add("output-schema-unclassified");
    return;
  }
  for (const key of beforeRequired) {
    if (!afterRequired.has(key)) reasons.add("output-guarantee-removed");
  }
  for (const key of Object.keys(beforeProperties)) {
    if (!Object.hasOwn(afterProperties, key)) reasons.add("output-property-removed");
    else compareProperty(beforeProperties[key], afterProperties[key], "output", equal, reasons);
  }
  if (!equal(before.additionalProperties, after.additionalProperties)) reasons.add("output-schema-unclassified");
}

function hint(annotations: unknown, key: string, absent: boolean): boolean | null {
  if (annotations === undefined) return absent;
  if (!isJsonObject(annotations)) return null;
  const value = annotations[key];
  if (value === undefined) return absent;
  return typeof value === "boolean" ? value : null;
}

function classifyAnnotations(before: unknown, after: unknown, reasons: Set<ToolChangeReason>): void {
  for (const { key, absent, safe } of SAFETY_HINTS) {
    const beforeValue = hint(before, key, absent);
    const afterValue = hint(after, key, absent);
    if (beforeValue === safe && afterValue !== safe) reasons.add("annotation-safety-reduced");
  }
}

function result(reasons: Set<ToolChangeReason>): ToolChangeClassification {
  const ordered = TOOL_CHANGE_REASONS.filter((reason) => reasons.has(reason));
  const impact: ToolChangeImpact = ordered.some((reason) => !UNCLASSIFIED_REASONS.has(reason))
    ? "breaking"
    : ordered.length > 0 ? "unclassified" : "compatible";
  return { impact, reasons: ordered };
}

export function classifyRemovedTool(): ToolChangeClassification {
  return { impact: "breaking", reasons: ["tool-removed"] };
}

export function classifyAddedTool(): ToolChangeClassification {
  return { impact: "compatible", reasons: [] };
}

export function classifyChangedTool(
  before: JsonObject,
  after: JsonObject,
  fields: readonly string[],
  equal: Equal
): ToolChangeClassification {
  const reasons = new Set<ToolChangeReason>();
  if (fields.includes("inputSchema")) classifyInputSchema(before.inputSchema, after.inputSchema, equal, reasons);
  if (fields.includes("outputSchema")) classifyOutputSchema(before.outputSchema, after.outputSchema, equal, reasons);
  if (fields.includes("annotations")) classifyAnnotations(before.annotations, after.annotations, reasons);
  if (fields.includes("other")) reasons.add("other-fields-unclassified");
  return result(reasons);
}
