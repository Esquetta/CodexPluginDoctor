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
// String keywords that can only be introduced or removed with a known effect; a changed value is unclassified.
const STRING_CONSTRAINT_KEYWORDS = ["pattern", "format"];
const NESTED_STRUCTURAL_KEYWORDS = new Set([
  "type", "enum", "const", "properties", "required", "additionalProperties", "items",
  ...LOWER_BOUND_KEYWORDS, ...UPPER_BOUND_KEYWORDS, ...STRING_CONSTRAINT_KEYWORDS
]);
// When every reference is a same-document fragment, definition containers are compared only
// where a resolved `$ref` reaches into them; otherwise they are compared as written.
const DEFINITION_CONTAINERS = ["$defs", "definitions"];
const ROOT_STRUCTURAL_WITH_DEFINITIONS = new Set([...ROOT_STRUCTURAL_KEYWORDS, ...DEFINITION_CONTAINERS]);
const NESTED_STRUCTURAL_WITH_DEFINITIONS = new Set([...NESTED_STRUCTURAL_KEYWORDS, ...DEFINITION_CONTAINERS]);
// Keywords whose values are data rather than subschemas, so reference-like keys inside them are ignored.
// `example` is the OpenAPI spelling that generated MCP schemas often carry.
const DATA_KEYWORDS = new Set(["enum", "const", "examples", "example", "default"]);
// Keywords whose values map names to subschemas; their keys are names, never keywords.
const NAME_MAP_KEYWORDS = new Set(["properties", "patternProperties", "$defs", "definitions", "dependentSchemas", "dependencies"]);
// Subschemas nested deeper than this below the root are not compared and stay unclassified.
const MAX_NESTED_DEPTH = 8;
// Keywords that only hold or name subschemas and never validate the object's own keys, so a
// new property beside them stays compatible. Any other unclassified keyword may govern keys.
const DEFINITION_KEYWORDS = new Set(["$defs", "definitions", "$id", "$anchor", "$dynamicAnchor"]);
// A `$ref` chain longer than this, such as an alias cycle, is not resolved.
const MAX_REFERENCE_HOPS = 8;
// Schema comparisons allowed per tool field; a schema that needs more is unclassified.
const MAX_COMPARISONS = 10_000;

type Direction = "input" | "output";

/** The root schemas that same-document references resolve against, and the comparison state for them. */
interface ReferenceScope {
  before: unknown;
  after: unknown;
  // True when both roots reach definitions only through same-document `$ref` fragments.
  fragmentsOnly: boolean;
  // Reference pairs being compared further up.
  active: Set<string>;
  // Resolved schema pairs already compared at a depth, so shared definitions are compared once per depth.
  completed: Map<unknown, Map<unknown, Set<number>>>;
  // sameMeaning results for object pairs, which depend only on the pair and the roots.
  same: Map<unknown, Map<unknown, boolean>>;
  // Per pointer: whether its target is equal in both roots, and the pointers inside that target.
  pointers: Map<string, { same: boolean; inner: string[] }>;
  remaining: number;
}

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

/** The values `enum` and `const` together admit; `const` behaves as a single-value `enum`. */
function allowedValues(schema: JsonObject, equal: Equal): unknown {
  if (!Object.hasOwn(schema, "const")) return schema.enum;
  if (schema.enum === undefined) return [schema.const];
  return Array.isArray(schema.enum) ? schema.enum.filter((value) => equal(value, schema.const)) : schema.enum;
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

/** Flags a `pattern` or `format` that `outer` adds and `inner` lacks; a changed value cannot be compared. */
function compareStringConstraints(inner: JsonObject, outer: JsonObject, codes: DirectionCodes, reasons: Set<ToolChangeReason>): void {
  for (const keyword of STRING_CONSTRAINT_KEYWORDS) {
    const outerValue = outer[keyword];
    const innerValue = inner[keyword];
    if ((outerValue !== undefined && typeof outerValue !== "string") || (innerValue !== undefined && typeof innerValue !== "string")) {
      reasons.add(codes.unclassified);
    } else if (outerValue !== undefined && innerValue !== outerValue) {
      reasons.add(innerValue === undefined ? codes.constraint : codes.unclassified);
    }
  }
}

/** Resolves an RFC 6901 JSON Pointer fragment such as `#/$defs/Item` against a root schema. */
function pointerTarget(document: unknown, pointer: string): unknown {
  if (pointer === "#") return document;
  if (!pointer.startsWith("#/")) return undefined;
  let current = document;
  for (const encoded of pointer.slice(2).split("/")) {
    let token: string;
    try {
      token = decodeURIComponent(encoded).replace(/~1/gu, "/").replace(/~0/gu, "~");
    } catch {
      return undefined;
    }
    if (Array.isArray(current) && /^(0|[1-9]\d*)$/u.test(token)) current = current[Number(token)];
    else if (isJsonObject(current) && Object.hasOwn(current, token)) current = current[token];
    else return undefined;
  }
  return current;
}

/**
 * Visits every schema position below `value`. It walks with an explicit stack, because tool files may
 * nest JSON far deeper than the call stack allows, and skips data values but not names in name maps.
 */
function collect(value: unknown, visit: (schema: JsonObject) => void): void {
  const pending: Array<{ value: unknown; names: boolean }> = [{ value, names: false }];
  while (pending.length > 0) {
    const current = pending.pop() as { value: unknown; names: boolean };
    if (Array.isArray(current.value)) {
      for (const entry of current.value) pending.push({ value: entry, names: false });
    } else if (current.names && isJsonObject(current.value)) {
      for (const entry of Object.values(current.value)) pending.push({ value: entry, names: false });
    } else if (isJsonObject(current.value)) {
      visit(current.value);
      for (const [key, entry] of Object.entries(current.value)) {
        if (!DATA_KEYWORDS.has(key)) pending.push({ value: entry, names: NAME_MAP_KEYWORDS.has(key) });
      }
    }
  }
}

const nestedIdCache = new WeakMap<object, boolean>();

/** A nested `$id` starts a new base URI, so fragments below it no longer point into the root. */
function hasNestedId(document: unknown): boolean {
  if (!isJsonObject(document)) return false;
  const cached = nestedIdCache.get(document);
  if (cached !== undefined) return cached;
  let found = false;
  collect(document, (schema) => {
    // Draft-04 names a resource with `id`.
    if (schema !== document && (typeof schema.$id === "string" || typeof schema.id === "string")) found = true;
  });
  nestedIdCache.set(document, found);
  return found;
}

const opaqueCache = new WeakMap<object, boolean>();

/**
 * True when a reference target holds a reference that is not a same-document fragment, or a
 * resource identifier. Whole-document scans skip data values, so a `$ref` that points into one
 * could otherwise reach references those scans never saw.
 */
function opaqueTarget(target: unknown, document: unknown): boolean {
  if (!isJsonObject(target) && !Array.isArray(target)) return false;
  const cached = opaqueCache.get(target);
  if (cached !== undefined) return cached;
  let opaque = false;
  collect(target, (schema) => {
    if (schema.$dynamicRef !== undefined || schema.$recursiveRef !== undefined
      || (typeof schema.$ref === "string" && !schema.$ref.startsWith("#"))
      || (schema !== document && (typeof schema.$id === "string" || typeof schema.id === "string"))) opaque = true;
  });
  opaqueCache.set(target, opaque);
  return opaque;
}

/**
 * False when a definition may be reached other than through a same-document `$ref` fragment:
 * through `$dynamicRef` or `$recursiveRef`, a URI reference, or a nested `$id` resource.
 */
function reachesDefinitionsOnlyThroughFragments(document: unknown): boolean {
  let fragmentsOnly = !hasNestedId(document);
  collect(document, (schema) => {
    if (schema.$dynamicRef !== undefined || schema.$recursiveRef !== undefined
      || (typeof schema.$ref === "string" && !schema.$ref.startsWith("#"))) fragmentsOnly = false;
  });
  return fragmentsOnly;
}

function referenceScope(before: unknown, after: unknown): ReferenceScope {
  return {
    before,
    after,
    fragmentsOnly: reachesDefinitionsOnlyThroughFragments(before) && reachesDefinitionsOnlyThroughFragments(after),
    active: new Set(),
    completed: new Map(),
    same: new Map(),
    pointers: new Map(),
    remaining: MAX_COMPARISONS
  };
}

/** Records a resolved pair as compared at this depth; returns false when it already was. */
function markCompleted(scope: ReferenceScope, before: unknown, after: unknown, depth: number): boolean {
  let byAfter = scope.completed.get(before);
  if (byAfter === undefined) scope.completed.set(before, byAfter = new Map());
  let depths = byAfter.get(after);
  if (depths === undefined) byAfter.set(after, depths = new Set());
  if (depths.has(depth)) return false;
  depths.add(depth);
  return true;
}

/**
 * Follows same-document `$ref` pointers. Returns the referenced schema and the last pointer, the
 * schema itself when it is not a reference, or null when a reference cannot be resolved safely.
 */
function resolveReferences(schema: unknown, document: unknown): { schema: unknown; ref: string | undefined } | null {
  let current = schema;
  let ref: string | undefined;
  for (let hop = 0; isJsonObject(current) && current.$ref !== undefined; hop += 1) {
    const pointer = current.$ref;
    // Siblings other than documentation would validate alongside the target.
    if (hop === MAX_REFERENCE_HOPS || typeof pointer !== "string" || hasNestedId(document)
      || Object.keys(current).some((key) => key !== "$ref" && !DOCUMENTATION_KEYWORDS.has(key))) return null;
    const target = pointerTarget(document, pointer);
    if (target === undefined || opaqueTarget(target, document)) return null;
    ref = pointer;
    current = target;
  }
  return { schema: current, ref };
}

/** True when the schemas are equal and every same-document schema they reach is equal in both roots. */
function sameMeaning(before: unknown, after: unknown, equal: Equal, scope: ReferenceScope): boolean {
  if (typeof before !== "object" || before === null || typeof after !== "object" || after === null) {
    return computeSameMeaning(before, after, equal, scope);
  }
  let byAfter = scope.same.get(before);
  if (byAfter === undefined) scope.same.set(before, byAfter = new Map());
  let result = byAfter.get(after);
  if (result === undefined) byAfter.set(after, result = computeSameMeaning(before, after, equal, scope));
  return result;
}

function fragmentPointers(value: unknown): string[] {
  const pointers: string[] = [];
  collect(value, (schema) => {
    if (typeof schema.$ref === "string" && schema.$ref.startsWith("#")) pointers.push(schema.$ref);
  });
  return pointers;
}

/** Compares a pointer's targets once per scope, so a large shared definition is walked once. */
function pointerInfo(pointer: string, equal: Equal, scope: ReferenceScope): { same: boolean; inner: string[] } {
  let info = scope.pointers.get(pointer);
  if (info === undefined) {
    const target = pointerTarget(scope.before, pointer);
    const afterTarget = pointerTarget(scope.after, pointer);
    info = target === undefined || !equal(target, afterTarget)
      || opaqueTarget(target, scope.before) || opaqueTarget(afterTarget, scope.after)
      ? { same: false, inner: [] }
      : { same: true, inner: fragmentPointers(target) };
    scope.pointers.set(pointer, info);
  }
  return info;
}

function computeSameMeaning(before: unknown, after: unknown, equal: Equal, scope: ReferenceScope): boolean {
  if (!equal(before, after)) return false;
  const pending = fragmentPointers(before);
  if (pending.length > 0 && (hasNestedId(scope.before) || hasNestedId(scope.after))) return false;
  const seen = new Set<string>();
  while (pending.length > 0) {
    const pointer = pending.pop() as string;
    if (seen.has(pointer)) continue;
    seen.add(pointer);
    const info = pointerInfo(pointer, equal, scope);
    if (!info.same) return false;
    for (const inner of info.inner) pending.push(inner);
  }
  return true;
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
  reasons: Set<ToolChangeReason>,
  scope: ReferenceScope
): void {
  const codes = CODES[direction];
  if (scope.remaining <= 0) {
    reasons.add(codes.unclassified);
    return;
  }
  scope.remaining -= 1;
  if (sameMeaning(before, after, equal, scope)) return;
  const resolvedBefore = resolveReferences(before, scope.before);
  const resolvedAfter = resolveReferences(after, scope.after);
  if (resolvedBefore === null || resolvedAfter === null) {
    reasons.add(codes.unclassified);
    return;
  }
  if (resolvedBefore.ref !== undefined || resolvedAfter.ref !== undefined) {
    // A reference pair already being compared further up is assumed to hold, so recursive
    // definitions terminate; a pair with one inline side is bounded by the depth limit. A pair
    // already compared at this depth added its reasons then.
    const pair = resolvedBefore.ref !== undefined && resolvedAfter.ref !== undefined
      ? JSON.stringify([resolvedBefore.ref, resolvedAfter.ref])
      : undefined;
    if (pair !== undefined && scope.active.has(pair)) return;
    if (!markCompleted(scope, resolvedBefore.schema, resolvedAfter.schema, depth)) return;
    if (pair !== undefined) scope.active.add(pair);
    compareSchema(resolvedBefore.schema, resolvedAfter.schema, direction, depth, equal, reasons, scope);
    if (pair !== undefined) scope.active.delete(pair);
    return;
  }
  const root = depth === 0;
  const structural = scope.fragmentsOnly
    ? root ? ROOT_STRUCTURAL_WITH_DEFINITIONS : NESTED_STRUCTURAL_WITH_DEFINITIONS
    : root ? ROOT_STRUCTURAL_KEYWORDS : NESTED_STRUCTURAL_KEYWORDS;
  if (depth > MAX_NESTED_DEPTH || !isJsonObject(before) || !isJsonObject(after)
    || !sameMeaning(keywordsOutside(before, structural), keywordsOutside(after, structural), equal, scope)
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
    const enumResult = enumCovered(allowedValues(inner, equal), allowedValues(outer, equal), equal);
    if (enumResult === null) reasons.add(codes.unclassified);
    else if (!enumResult) reasons.add(codes.enumChanged);
    compareBounds(inner, outer, codes, reasons);
    compareStringConstraints(inner, outer, codes, reasons);
    if (!sameMeaning(before.items, after.items, equal, scope)) {
      if (unevaluated) reasons.add(codes.unclassified);
      else if (outer.items !== undefined && inner.items === undefined) reasons.add(codes.constraint);
      else if (outer.items !== undefined) compareSchema(before.items, after.items, direction, depth + 1, equal, reasons, scope);
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
    else compareSchema(beforeProperties[key], afterProperties[key], direction, depth + 1, equal, reasons, scope);
  }
  // In an object whose undeclared keys were governed by other keywords, or a nested input object
  // that left them open, a newly declared property can reject values callers send (input) or
  // produce values consumers did not expect (output).
  const addedKeys = Object.keys(afterProperties).filter((key) => !Object.hasOwn(beforeProperties, key));
  if (addedKeys.length > 0) {
    // A `const` object fixes every key, so it governs undeclared keys too.
    const governed = isJsonObject(before.additionalProperties) || Object.hasOwn(before, "const")
      || Object.keys(keywordsOutside(before, structural)).some((key) => !DEFINITION_KEYWORDS.has(key));
    const open = !root && Object.keys(beforeProperties).length === 0 && before.additionalProperties !== false;
    if (governed || (direction === "input" && open)) reasons.add(codes.unclassified);
  }
  // Callers already send a key that was required before it was declared, with any value.
  if (direction === "input" && addedKeys.some((key) => innerRequired.has(key))) reasons.add(codes.unclassified);

  if (!sameMeaning(before.additionalProperties, after.additionalProperties, equal, scope)) {
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
  compareSchema(before, after, "output", 0, equal, reasons, referenceScope(before, after));
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
  if (fields.includes("inputSchema")) {
    compareSchema(before.inputSchema, after.inputSchema, "input", 0, equal, reasons, referenceScope(before.inputSchema, after.inputSchema));
  }
  if (fields.includes("outputSchema")) classifyOutputSchema(before.outputSchema, after.outputSchema, equal, reasons);
  if (fields.includes("annotations")) classifyAnnotations(before.annotations, after.annotations, reasons);
  if (fields.includes("other")) reasons.add("other-fields-unclassified");
  return result(reasons);
}
