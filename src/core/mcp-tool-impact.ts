type JsonObject = Record<string, unknown>;

export type ToolChangeImpact = "breaking" | "compatible" | "unclassified";

export const TOOL_CHANGE_REASONS = [
  "tool-removed",
  "input-type-narrowed",
  "input-required-added",
  "input-property-removed",
  "input-property-type-narrowed",
  "input-property-enum-narrowed",
  "input-constraint-tightened",
  "input-additional-properties-closed",
  "input-schema-unclassified",
  "output-schema-removed",
  "output-type-widened",
  "output-property-removed",
  "output-guarantee-removed",
  "output-property-type-widened",
  "output-property-enum-widened",
  "output-constraint-loosened",
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
const LOWER_BOUND_KEYWORDS = ["minimum", "minLength", "minItems"];
const UPPER_BOUND_KEYWORDS = ["maximum", "maxLength", "maxItems"];
const NESTED_STRUCTURAL_KEYWORDS = new Set([
  "type", "enum", "properties", "required", "additionalProperties", "items", ...LOWER_BOUND_KEYWORDS, ...UPPER_BOUND_KEYWORDS
]);
// Subschemas nested deeper than this below the root are not compared and stay unclassified.
const MAX_NESTED_DEPTH = 8;
// Keywords that only hold or name subschemas and never validate the object's own keys, so a
// new property beside them stays compatible. Any other unclassified keyword may govern keys.
const DEFINITION_KEYWORDS = new Set(["$defs", "definitions", "$id", "$anchor", "$dynamicAnchor"]);

type Direction = "input" | "output";

interface DirectionCodes {
  unclassified: ToolChangeReason;
  rootType: ToolChangeReason;
  propertyType: ToolChangeReason;
  enumChanged: ToolChangeReason;
  constraint: ToolChangeReason;
  required: ToolChangeReason;
  propertyRemoved: ToolChangeReason;
}

const CODES: Record<Direction, DirectionCodes> = {
  input: {
    unclassified: "input-schema-unclassified",
    rootType: "input-type-narrowed",
    propertyType: "input-property-type-narrowed",
    enumChanged: "input-property-enum-narrowed",
    constraint: "input-constraint-tightened",
    required: "input-required-added",
    propertyRemoved: "input-property-removed"
  },
  output: {
    unclassified: "output-schema-unclassified",
    rootType: "output-type-widened",
    propertyType: "output-property-type-widened",
    enumChanged: "output-property-enum-widened",
    constraint: "output-constraint-loosened",
    required: "output-guarantee-removed",
    propertyRemoved: "output-property-removed"
  }
};

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

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Flags bounds of `outer` that `inner` does not satisfy, so `inner` values may fall outside `outer`. */
function compareBounds(inner: JsonObject, outer: JsonObject, codes: DirectionCodes, reasons: Set<ToolChangeReason>): void {
  for (const [keywords, covered] of [
    [LOWER_BOUND_KEYWORDS, (innerBound: number, outerBound: number) => innerBound >= outerBound],
    [UPPER_BOUND_KEYWORDS, (innerBound: number, outerBound: number) => innerBound <= outerBound]
  ] as const) {
    for (const keyword of keywords) {
      const outerBound = outer[keyword];
      const innerBound = inner[keyword];
      if ((outerBound !== undefined && !isFiniteNumber(outerBound)) || (innerBound !== undefined && !isFiniteNumber(innerBound))) {
        reasons.add(codes.unclassified);
      } else if (outerBound !== undefined && (innerBound === undefined || !covered(innerBound, outerBound))) {
        reasons.add(codes.constraint);
      }
    }
  }
}

/**
 * Compares one schema and its object and array subschemas. `direction` is "input" when callers
 * must keep being accepted (after must cover before) and "output" when consumers must keep
 * understanding results (before must cover after). Depth 0 is the tool's root schema.
 */
function compareSchema(
  before: unknown,
  after: unknown,
  direction: Direction,
  depth: number,
  equal: Equal,
  reasons: Set<ToolChangeReason>
): void {
  if (equal(before, after)) return;
  const codes = CODES[direction];
  const root = depth === 0;
  const structural = root ? ROOT_STRUCTURAL_KEYWORDS : NESTED_STRUCTURAL_KEYWORDS;
  if (depth > MAX_NESTED_DEPTH || !isJsonObject(before) || !isJsonObject(after)
    || !equal(keywordsOutside(before, structural), keywordsOutside(after, structural))
    || !equal(before.$schema, after.$schema)) {
    reasons.add(codes.unclassified);
    return;
  }

  const [inner, outer] = direction === "input" ? [before, after] : [after, before];
  // unevaluatedItems/unevaluatedProperties apply to whatever items/additionalProperties leave
  // uncovered, so a change in either cannot be judged on its own.
  const unevaluated = ["unevaluatedItems", "unevaluatedProperties"].some((key) => before[key] !== undefined || after[key] !== undefined);
  if (!typesCovered(typeSet(inner), typeSet(outer))) reasons.add(root ? codes.rootType : codes.propertyType);
  if (!root) {
    const enumResult = enumCovered(inner.enum, outer.enum, equal);
    if (enumResult === null) reasons.add(codes.unclassified);
    else if (!enumResult) reasons.add(codes.enumChanged);
    compareBounds(inner, outer, codes, reasons);
    if (!equal(before.items, after.items)) {
      if (unevaluated) reasons.add(codes.unclassified);
      else if (outer.items !== undefined && inner.items === undefined) reasons.add(codes.constraint);
      else if (outer.items !== undefined) compareSchema(before.items, after.items, direction, depth + 1, equal, reasons);
    }
  }

  const innerRequired = stringSet(inner.required);
  const outerRequired = stringSet(outer.required);
  const beforeProperties = objectMap(before.properties);
  const afterProperties = objectMap(after.properties);
  if (innerRequired === null || outerRequired === null || beforeProperties === null || afterProperties === null) {
    reasons.add(codes.unclassified);
    return;
  }
  for (const key of outerRequired) {
    if (!innerRequired.has(key)) reasons.add(codes.required);
  }
  for (const key of Object.keys(beforeProperties)) {
    if (!Object.hasOwn(afterProperties, key)) reasons.add(codes.propertyRemoved);
    else compareSchema(beforeProperties[key], afterProperties[key], direction, depth + 1, equal, reasons);
  }
  // In an object whose undeclared keys were governed by other keywords, or a nested input object
  // that left them open, a newly declared property can reject values callers send (input) or
  // produce values consumers did not expect (output).
  const addedKeys = Object.keys(afterProperties).filter((key) => !Object.hasOwn(beforeProperties, key));
  if (addedKeys.length > 0) {
    const governed = isJsonObject(before.additionalProperties)
      || Object.keys(keywordsOutside(before, structural)).some((key) => !DEFINITION_KEYWORDS.has(key));
    const open = !root && Object.keys(beforeProperties).length === 0 && before.additionalProperties !== false;
    if (governed || (direction === "input" && open)) reasons.add(codes.unclassified);
  }
  // Callers already send a key that was required before it was declared, with any value.
  if (direction === "input" && addedKeys.some((key) => innerRequired.has(key))) reasons.add(codes.unclassified);

  if (!equal(before.additionalProperties, after.additionalProperties)) {
    if (unevaluated) reasons.add(codes.unclassified);
    else if (direction === "input" && after.additionalProperties === false) reasons.add("input-additional-properties-closed");
    else if (direction === "output" || !(after.additionalProperties === undefined || after.additionalProperties === true)) reasons.add(codes.unclassified);
  }
}

function classifyOutputSchema(before: unknown, after: unknown, equal: Equal, reasons: Set<ToolChangeReason>): void {
  if (before === undefined) return;
  if (after === undefined) {
    reasons.add("output-schema-removed");
    return;
  }
  compareSchema(before, after, "output", 0, equal, reasons);
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
  if (fields.includes("inputSchema")) compareSchema(before.inputSchema, after.inputSchema, "input", 0, equal, reasons);
  if (fields.includes("outputSchema")) classifyOutputSchema(before.outputSchema, after.outputSchema, equal, reasons);
  if (fields.includes("annotations")) classifyAnnotations(before.annotations, after.annotations, reasons);
  if (fields.includes("other")) reasons.add("other-fields-unclassified");
  return result(reasons);
}
