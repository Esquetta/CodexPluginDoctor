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

export interface ToolChangeLocation {
  reason: ToolChangeReason;
  // RFC 6901 JSON Pointer into the tool definition; "" is the definition itself.
  pointer: string;
}

export interface ToolChangeClassification {
  impact: ToolChangeImpact;
  reasons: ToolChangeReason[];
  // Present only when locations were requested, because pointers name properties.
  locations?: ToolChangeLocation[];
}

const MAX_LOCATIONS = 100;

/**
 * A reason set that also records, for each reason, the JSON Pointer of the schema position being
 * compared when it was added. A shared definition is compared once, so it is located at the first
 * reference that reached it.
 */
class LocatingReasons extends Set<ToolChangeReason> {
  readonly path: string[] = [];
  readonly locations: ToolChangeLocation[] = [];
  private readonly seen = new Set<string>();

  override add(reason: ToolChangeReason): this {
    const pointer = this.path.map((token) => `/${token.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
    const key = JSON.stringify([reason, pointer]);
    if (!this.seen.has(key) && this.locations.length < MAX_LOCATIONS) {
      this.seen.add(key);
      this.locations.push({ reason, pointer });
    }
    return super.add(reason);
  }
}

/** Runs `compare` with `tokens` appended to the recorded location, when locations are recorded. */
function within(reasons: Set<ToolChangeReason>, tokens: string[], compare: () => void): void {
  if (!(reasons instanceof LocatingReasons)) {
    compare();
    return;
  }
  reasons.path.push(...tokens);
  try {
    compare();
  } finally {
    reasons.path.length -= tokens.length;
  }
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
const LOWER_BOUND_KEYWORDS = ["minLength", "minItems"];
const UPPER_BOUND_KEYWORDS = ["maxLength", "maxItems"];
// Numeric bounds, compared as one effective bound per side because the exclusive form may replace the inclusive one.
const NUMERIC_BOUND_KEYWORDS = ["minimum", "exclusiveMinimum", "maximum", "exclusiveMaximum"];
// String keywords that can only be introduced or removed with a known effect; a changed value is unclassified.
const STRING_CONSTRAINT_KEYWORDS = ["pattern", "format"];
const NESTED_STRUCTURAL_KEYWORDS = new Set([
  "type", "enum", "const", "properties", "required", "additionalProperties", "items", "multipleOf", "uniqueItems",
  ...LOWER_BOUND_KEYWORDS, ...UPPER_BOUND_KEYWORDS, ...NUMERIC_BOUND_KEYWORDS, ...STRING_CONSTRAINT_KEYWORDS
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
// Subschemas nested deeper than this below the root are not compared and stay unclassified; composition
// wrappers keep the depth of the schema they wrap and are bounded by MAX_WRAPPER_HOPS instead.
const MAX_NESTED_DEPTH = 8;
// Keywords that only hold or name subschemas and never validate the object's own keys, so a
// new property beside them stays compatible. Any other unclassified keyword may govern keys.
const DEFINITION_KEYWORDS = new Set(["$defs", "definitions", "$id", "$anchor", "$dynamicAnchor"]);
// `anyOf` or discriminated `oneOf` alternatives beyond this many on either side are not paired.
const MAX_ALTERNATIVES = 32;
// Composition wrappers (`allOf`, `anyOf`, and discriminated `oneOf`) followed along one path; deeper wrappers are unclassified.
const MAX_WRAPPER_HOPS = 16;
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
  // Resolved schema pairs still being compared at a depth; meeting one again means a cycle without progress.
  inProgress: Map<unknown, Map<unknown, Set<number>>>;
  // Composition wrappers entered along the current path.
  wrappers: number;
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

type NumericBound = { value: number; exclusive: boolean };

/**
 * The tighter of a schema's inclusive and exclusive bound on one side, undefined when it has neither,
 * or null when either is not a finite number (such as a draft-04 boolean `exclusiveMinimum`).
 */
function numericBound(schema: JsonObject, inclusive: string, exclusive: string, lower: boolean): NumericBound | undefined | null {
  if (typeof schema[exclusive] === "boolean") {
    // Draft-04 marks the inclusive keyword itself as exclusive; a boolean alone is invalid in every draft.
    const value = schema[inclusive];
    return isFiniteNumber(value) ? { value, exclusive: schema[exclusive] as boolean } : null;
  }
  const candidates: NumericBound[] = [];
  for (const [keyword, isExclusive] of [[inclusive, false], [exclusive, true]] as const) {
    const value = schema[keyword];
    if (value === undefined) continue;
    if (!isFiniteNumber(value)) return null;
    candidates.push({ value, exclusive: isExclusive });
  }
  return candidates.reduce<NumericBound | undefined>((tightest, candidate) => {
    if (tightest === undefined) return candidate;
    if (candidate.value === tightest.value) return candidate.exclusive ? candidate : tightest;
    return (lower ? candidate.value > tightest.value : candidate.value < tightest.value) ? candidate : tightest;
  }, undefined);
}

/** Flags numeric bounds, `multipleOf`, and `uniqueItems` of `outer` that `inner` does not satisfy. */
function compareNumericAndArrayConstraints(inner: JsonObject, outer: JsonObject, codes: DirectionCodes, reasons: Set<ToolChangeReason>): void {
  for (const [inclusive, exclusive, lower] of [["minimum", "exclusiveMinimum", true], ["maximum", "exclusiveMaximum", false]] as const) {
    const innerBound = numericBound(inner, inclusive, exclusive, lower);
    const outerBound = numericBound(outer, inclusive, exclusive, lower);
    if (innerBound === null || outerBound === null) {
      // A bound that cannot be read still means the same when it did not change.
      const unchanged = Object.is(inner[inclusive], outer[inclusive]) && Object.is(inner[exclusive], outer[exclusive]);
      if (!unchanged) reasons.add(codes.unclassified);
    } else if (outerBound !== undefined) {
      const covered = innerBound !== undefined && (innerBound.value === outerBound.value
        ? innerBound.exclusive || !outerBound.exclusive
        : lower ? innerBound.value > outerBound.value : innerBound.value < outerBound.value);
      if (!covered) reasons.add(codes.constraint);
    }
  }

  const outerMultiple = outer.multipleOf;
  const innerMultiple = inner.multipleOf;
  const validMultiple = (value: unknown) => value === undefined || (isFiniteNumber(value) && value > 0);
  if (!validMultiple(outerMultiple) || !validMultiple(innerMultiple)) {
    if (!Object.is(innerMultiple, outerMultiple)) reasons.add(codes.unclassified);
  } else if (outerMultiple !== undefined) {
    if (innerMultiple === undefined) {
      reasons.add(codes.constraint);
    } else if (Number.isInteger(innerMultiple) && Number.isInteger(outerMultiple)) {
      // Every multiple of innerMultiple is a multiple of outerMultiple when outerMultiple divides it.
      if ((innerMultiple as number) % (outerMultiple as number) !== 0) reasons.add(codes.constraint);
    } else if (innerMultiple !== outerMultiple) {
      // Validators test fractional multiples with floating-point division, which can reject 0.3
      // under multipleOf 0.1, so a changed fractional multipleOf cannot be judged.
      reasons.add(codes.unclassified);
    }
  }

  if ((outer.uniqueItems !== undefined && typeof outer.uniqueItems !== "boolean")
    || (inner.uniqueItems !== undefined && typeof inner.uniqueItems !== "boolean")) {
    if (!Object.is(inner.uniqueItems, outer.uniqueItems)) reasons.add(codes.unclassified);
  } else if (outer.uniqueItems === true && inner.uniqueItems !== true) {
    reasons.add(codes.constraint);
  }
}

/** The subschema of a schema that is only a one-element `allOf` with documentation, or null. */
function singleAllOf(schema: unknown): { inner: unknown } | null {
  if (!isJsonObject(schema) || !Array.isArray(schema.allOf) || schema.allOf.length !== 1) return null;
  return Object.keys(schema).every((key) => key === "allOf" || DOCUMENTATION_KEYWORDS.has(key)) ? { inner: schema.allOf[0] } : null;
}

interface Alternatives {
  list: unknown[];
  // The discriminator property of a oneOf whose alternatives exclude each other, or null for anyOf.
  discriminator: string | null;
}

function discriminatorProperty(value: unknown): string | null {
  if (!isJsonObject(value) || typeof value.propertyName !== "string") return null;
  return Object.keys(value).every((key) => key === "propertyName" || key === "mapping") ? value.propertyName : null;
}

/**
 * The discriminator value of each alternative, when every alternative resolves to an object schema
 * that requires the property and fixes it to one value no other alternative uses; null otherwise.
 * Such alternatives cannot both match one value, so their oneOf accepts what an anyOf would.
 */
function discriminatorValues(list: unknown[], property: string, document: unknown): Map<unknown, string> | null {
  // Draft-04 has no const, and many validators of earlier drafts drop keywords beside a $ref.
  if (list.length > MAX_ALTERNATIVES || (isJsonObject(document) && typeof document.$schema === "string" && /draft-0[34]/u.test(document.$schema))) return null;
  const values = new Map<unknown, string>();
  const seen = new Set<string>();
  for (const alternative of list) {
    const schema = resolveReferences(alternative, document)?.schema;
    if (!isJsonObject(schema)) return null;
    const types = typeSet(schema);
    const declared = objectMap(schema.properties)?.[property];
    if (types === null || types.size !== 1 || !types.has("object") || !stringSet(schema.required)?.has(property)
      || !isJsonObject(declared) || declared.$ref !== undefined) return null;
    const fixed = Object.hasOwn(declared, "const") ? [declared.const] : declared.enum;
    if (!Array.isArray(fixed) || fixed.length !== 1 || (Array.isArray(declared.enum) && Object.hasOwn(declared, "const")
      && !(declared.enum.length === 1 && Object.is(declared.enum[0], declared.const)))) return null;
    const value = fixed[0];
    if (value !== null && !["string", "number", "boolean"].includes(typeof value)) return null;
    const key = JSON.stringify(value);
    if (seen.has(key)) return null;
    seen.add(key);
    values.set(alternative, key);
  }
  return values;
}

/**
 * The alternatives of a schema that is only `anyOf`, or only a discriminated `oneOf` whose
 * alternatives exclude each other, with documentation beside it; null otherwise.
 */
function alternatives(schema: unknown, document: unknown): Alternatives | null {
  if (!isJsonObject(schema)) return null;
  if (Array.isArray(schema.anyOf)) {
    return Object.keys(schema).every((key) => key === "anyOf" || DOCUMENTATION_KEYWORDS.has(key)) ? { list: schema.anyOf, discriminator: null } : null;
  }
  if (!Array.isArray(schema.oneOf) || !Object.keys(schema).every((key) => key === "oneOf" || key === "discriminator" || DOCUMENTATION_KEYWORDS.has(key))) return null;
  const property = discriminatorProperty(schema.discriminator);
  return property !== null && discriminatorValues(schema.oneOf, property, document) !== null ? { list: schema.oneOf, discriminator: property } : null;
}

function isComposition(schema: unknown, document: unknown): boolean {
  return singleAllOf(schema) !== null || alternatives(schema, document) !== null;
}

/**
 * Compares two schemas when at least one is a one-element `allOf`, an `anyOf`, or a discriminated
 * `oneOf` with only documentation beside it. Wrappers keep the depth, so their own count bounds how far one path unwraps.
 */
function compareComposition(
  before: unknown,
  after: unknown,
  direction: Direction,
  depth: number,
  equal: Equal,
  reasons: Set<ToolChangeReason>,
  scope: ReferenceScope
): void {
  if (scope.wrappers >= MAX_WRAPPER_HOPS) {
    reasons.add(CODES[direction].unclassified);
    return;
  }
  const wrappedBefore = singleAllOf(before);
  const wrappedAfter = singleAllOf(after);
  scope.wrappers += 1;
  if (wrappedBefore !== null || wrappedAfter !== null) {
    // A one-element allOf with only documentation beside it means the same as its subschema.
    compareSchema(wrappedBefore === null ? before : wrappedBefore.inner, wrappedAfter === null ? after : wrappedAfter.inner, direction, depth, equal, reasons, scope);
  } else {
    // A schema that is not an anyOf compares as an anyOf with that schema as its only alternative.
    const beforeAlternatives = alternatives(before, scope.before) ?? { list: [before], discriminator: null };
    const afterAlternatives = alternatives(after, scope.after) ?? { list: [after], discriminator: null };
    compareAlternatives(beforeAlternatives, afterAlternatives, direction, depth, equal, reasons, scope);
  }
  scope.wrappers -= 1;
}

/** The reference target or declared type that pairs an alternative with its counterpart. */
function alternativeKey(alternative: unknown): string | null {
  if (!isJsonObject(alternative)) return null;
  if (typeof alternative.$ref === "string") return `ref:${alternative.$ref}`;
  return alternative.type === undefined ? null : `type:${JSON.stringify(alternative.type)}`;
}

/**
 * Compares `anyOf` alternatives, or discriminated `oneOf` alternatives that exclude each other. A
 * value is accepted when any alternative accepts it, so inputs stay compatible when every earlier
 * alternative is covered by a later one, and outputs when every later alternative is covered by an
 * earlier one. Identical alternatives match first, then alternatives with the same discriminator
 * value, then the same reference target or type, then a single remaining alternative on each side.
 */
function compareAlternatives(
  before: Alternatives,
  after: Alternatives,
  direction: Direction,
  depth: number,
  equal: Equal,
  reasons: Set<ToolChangeReason>,
  scope: ReferenceScope
): void {
  const codes = CODES[direction];
  if (before.list.length > MAX_ALTERNATIVES || after.list.length > MAX_ALTERNATIVES) {
    reasons.add(codes.unclassified);
    return;
  }
  const unpairedBefore = [...before.list];
  const unpairedAfter = [...after.list];
  for (let index = unpairedBefore.length - 1; index >= 0; index -= 1) {
    const match = unpairedAfter.findIndex((candidate) => sameMeaning(unpairedBefore[index], candidate, equal, scope));
    if (match !== -1) {
      unpairedBefore.splice(index, 1);
      unpairedAfter.splice(match, 1);
    }
  }

  const pairs: Array<[unknown, unknown]> = [];
  const pairBy = (beforeKey: (alternative: unknown) => string | null, afterKey: (alternative: unknown) => string | null) => {
    for (const key of new Set(unpairedBefore.map(beforeKey))) {
      if (key === null) continue;
      const beforeMatches = unpairedBefore.filter((alternative) => beforeKey(alternative) === key);
      const afterMatches = unpairedAfter.filter((alternative) => afterKey(alternative) === key);
      if (beforeMatches.length !== 1 || afterMatches.length !== 1) continue;
      pairs.push([beforeMatches[0], afterMatches[0]]);
      unpairedBefore.splice(unpairedBefore.indexOf(beforeMatches[0]), 1);
      unpairedAfter.splice(unpairedAfter.indexOf(afterMatches[0]), 1);
    }
  };
  if (before.discriminator !== null && before.discriminator === after.discriminator) {
    const beforeValues = discriminatorValues(before.list, before.discriminator, scope.before);
    const afterValues = discriminatorValues(after.list, after.discriminator, scope.after);
    pairBy((alternative) => beforeValues?.get(alternative) ?? null, (alternative) => afterValues?.get(alternative) ?? null);
  }
  pairBy(alternativeKey, alternativeKey);
  if (unpairedBefore.length === 1 && unpairedAfter.length === 1) {
    pairs.push([unpairedBefore.pop(), unpairedAfter.pop()]);
  } else if (unpairedBefore.length > 0 && unpairedAfter.length > 0) {
    reasons.add(codes.unclassified);
  }

  for (const [beforeAlternative, afterAlternative] of pairs) {
    compareSchema(beforeAlternative, afterAlternative, direction, depth, equal, reasons, scope);
  }
  // A dropped input alternative may reject values callers send; an added output alternative may
  // produce values consumers do not expect. The opposite changes only narrow or widen safely.
  const narrowedOrWidened = direction === "input" ? unpairedAfter.length === 0 && unpairedBefore.length > 0 : unpairedBefore.length === 0 && unpairedAfter.length > 0;
  if (narrowedOrWidened) reasons.add(depth === 0 ? codes.rootType : codes.propertyType);
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
  // RFC 6901 section 6: the fragment is percent-decoded as a whole before it is split into tokens.
  let decoded: string;
  try {
    decoded = decodeURIComponent(pointer.slice(2));
  } catch {
    return undefined;
  }
  let current = document;
  for (const escaped of decoded.split("/")) {
    const token = escaped.replace(/~1/gu, "/").replace(/~0/gu, "~");
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
    inProgress: new Map(),
    wrappers: 0,
    same: new Map(),
    pointers: new Map(),
    remaining: MAX_COMPARISONS
  };
}

function pairDepths(pairs: Map<unknown, Map<unknown, Set<number>>>, before: unknown, after: unknown): Set<number> {
  let byAfter = pairs.get(before);
  if (byAfter === undefined) pairs.set(before, byAfter = new Map());
  let depths = byAfter.get(after);
  if (depths === undefined) byAfter.set(after, depths = new Set());
  return depths;
}

/**
 * Records a resolved pair as compared at this depth and wrapper count; returns false when it already
 * was. The wrapper count is part of the key because it limits how far that comparison may unwrap.
 */
function markCompleted(scope: ReferenceScope, before: unknown, after: unknown, depth: number): boolean {
  const depths = pairDepths(scope.completed, before, after);
  const key = depth * (MAX_WRAPPER_HOPS + 1) + scope.wrappers;
  if (depths.has(key)) return false;
  depths.add(key);
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
  if (resolvedBefore === null || resolvedAfter === null || depth > MAX_NESTED_DEPTH) {
    reasons.add(codes.unclassified);
    return;
  }
  // When only one side is a composition, the other keeps its reference unresolved, so it can still
  // pair with an alternative that refers to the same definition, as when a model becomes optional.
  const beforeComposed = isComposition(resolvedBefore.schema, scope.before);
  const afterComposed = isComposition(resolvedAfter.schema, scope.after);
  // True when the original schema, before its reference is resolved, pairs with an alternative of
  // the composite, as a model or a union does with its nullable anyOf.
  const pairsWithAlternative = (original: unknown, composite: unknown, document: unknown) => {
    const key = alternativeKey(original);
    return (alternatives(composite, document)?.list ?? [])
      .some((alternative) => (key !== null && alternativeKey(alternative) === key) || sameMeaning(original, alternative, equal, scope));
  };
  if (beforeComposed !== afterComposed) {
    // The reference is kept only when an alternative can pair with it; otherwise its target compares
    // with inline alternatives by type.
    const composite = beforeComposed ? resolvedBefore.schema : resolvedAfter.schema;
    const original = beforeComposed ? after : before;
    const keepReference = pairsWithAlternative(original, composite, beforeComposed ? scope.before : scope.after);
    const plain = keepReference ? original : (beforeComposed ? resolvedAfter.schema : resolvedBefore.schema);
    compareComposition(beforeComposed ? composite : plain, beforeComposed ? plain : composite, direction, depth, equal, reasons, scope);
    return;
  }
  if (beforeComposed && afterComposed) {
    // A composite that appears whole as one alternative of the other side, such as a union made
    // nullable, compares as that single alternative rather than alternative by alternative.
    // A reference match counts only while the matched alternative is still a composite, so a
    // definition that stopped being a union compares alternative by alternative instead.
    const isWholeAlternative = (original: unknown, composite: unknown, document: unknown) =>
      (alternatives(composite, document)?.list ?? []).some((alternative) => sameMeaning(original, alternative, equal, scope)
        || (alternativeKey(original) !== null && alternativeKey(alternative) === alternativeKey(original)
          && isComposition(resolveReferences(alternative, document)?.schema, document)));
    const beforeIsAlternative = isWholeAlternative(before, resolvedAfter.schema, scope.after);
    const afterIsAlternative = isWholeAlternative(after, resolvedBefore.schema, scope.before);
    if (beforeIsAlternative !== afterIsAlternative) {
      if (scope.wrappers >= MAX_WRAPPER_HOPS) {
        reasons.add(codes.unclassified);
        return;
      }
      const side = (whole: boolean, original: unknown, composite: unknown, document: unknown): Alternatives =>
        whole ? { list: [original], discriminator: null } : alternatives(composite, document) ?? { list: [composite], discriminator: null };
      scope.wrappers += 1;
      compareAlternatives(
        side(beforeIsAlternative, before, resolvedBefore.schema, scope.before),
        side(afterIsAlternative, after, resolvedAfter.schema, scope.after),
        direction, depth, equal, reasons, scope
      );
      scope.wrappers -= 1;
      return;
    }
  }
  if (resolvedBefore.ref !== undefined || resolvedAfter.ref !== undefined) {
    // A reference pair already being compared further up is assumed to hold, so recursive
    // definitions terminate; a pair with one inline side is bounded by the depth limit. A pair
    // already compared at this depth added its reasons then.
    const pair = resolvedBefore.ref !== undefined && resolvedAfter.ref !== undefined
      ? JSON.stringify([resolvedBefore.ref, resolvedAfter.ref])
      : undefined;
    // Reaching a pair again at the same depth, for example through a definition that wraps a
    // reference to itself, is a cycle that never reaches a value, so it cannot be judged.
    const inProgress = pairDepths(scope.inProgress, resolvedBefore.schema, resolvedAfter.schema);
    if (inProgress.has(depth)) {
      reasons.add(codes.unclassified);
      return;
    }
    if (pair !== undefined && scope.active.has(pair)) return;
    if (!markCompleted(scope, resolvedBefore.schema, resolvedAfter.schema, depth)) return;
    if (pair !== undefined) scope.active.add(pair);
    inProgress.add(depth);
    compareSchema(resolvedBefore.schema, resolvedAfter.schema, direction, depth, equal, reasons, scope);
    inProgress.delete(depth);
    if (pair !== undefined) scope.active.delete(pair);
    return;
  }
  if (beforeComposed) {
    compareComposition(before, after, direction, depth, equal, reasons, scope);
    return;
  }
  const root = depth === 0;
  const structural = scope.fragmentsOnly
    ? root ? ROOT_STRUCTURAL_WITH_DEFINITIONS : NESTED_STRUCTURAL_WITH_DEFINITIONS
    : root ? ROOT_STRUCTURAL_KEYWORDS : NESTED_STRUCTURAL_KEYWORDS;
  if (!isJsonObject(before) || !isJsonObject(after)
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
    compareNumericAndArrayConstraints(inner, outer, codes, reasons);
    compareStringConstraints(inner, outer, codes, reasons);
    if (!sameMeaning(before.items, after.items, equal, scope)) {
      within(reasons, ["items"], () => {
        if (unevaluated) reasons.add(codes.unclassified);
        else if (outer.items !== undefined && inner.items === undefined) reasons.add(codes.constraint);
        else if (outer.items !== undefined) compareSchema(before.items, after.items, direction, depth + 1, equal, reasons, scope);
      });
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
    if (!innerRequired.has(key)) within(reasons, ["properties", key], () => reasons.add(codes.required));
  }
  for (const key of Object.keys(beforeProperties)) {
    within(reasons, ["properties", key], () => {
      if (!Object.hasOwn(afterProperties, key)) reasons.add(codes.propertyRemoved);
      else compareSchema(beforeProperties[key], afterProperties[key], direction, depth + 1, equal, reasons, scope);
    });
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
  return reasons instanceof LocatingReasons ? { impact, reasons: ordered, locations: reasons.locations } : { impact, reasons: ordered };
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
  equal: Equal,
  options: { locate?: boolean } = {}
): ToolChangeClassification {
  const reasons = options.locate ? new LocatingReasons() : new Set<ToolChangeReason>();
  if (fields.includes("inputSchema")) {
    within(reasons, ["inputSchema"], () =>
      compareSchema(before.inputSchema, after.inputSchema, "input", 0, equal, reasons, referenceScope(before.inputSchema, after.inputSchema)));
  }
  if (fields.includes("outputSchema")) within(reasons, ["outputSchema"], () => classifyOutputSchema(before.outputSchema, after.outputSchema, equal, reasons));
  if (fields.includes("annotations")) within(reasons, ["annotations"], () => classifyAnnotations(before.annotations, after.annotations, reasons));
  if (fields.includes("other")) reasons.add("other-fields-unclassified");
  return result(reasons);
}
