type JsonObject = Record<string, unknown>;
type Equal = (left: unknown, right: unknown) => boolean;

export type PromptChangeImpact = "breaking" | "compatible" | "unclassified";

export const PROMPT_CHANGE_REASONS = [
  "prompt-removed",
  "prompt-argument-removed",
  "prompt-required-argument-added",
  "prompt-argument-now-required",
  "prompt-argument-fields-unclassified",
  "other-fields-unclassified"
] as const;

export type PromptChangeReason = (typeof PROMPT_CHANGE_REASONS)[number];

export interface PromptChangeLocation {
  reason: PromptChangeReason;
  // The argument name the reason applies to; null when it applies to the prompt itself.
  argument: string | null;
}

export interface PromptChangeClassification {
  impact: PromptChangeImpact;
  reasons: PromptChangeReason[];
  // Present only when locations were requested, because locations name arguments.
  locations?: PromptChangeLocation[];
}

export const MAX_PROMPT_CHANGE_LOCATIONS = 100;

const UNCLASSIFIED_REASONS = new Set<PromptChangeReason>(["prompt-argument-fields-unclassified", "other-fields-unclassified"]);
// Argument fields with a classified effect; a change to any other argument field is unclassified.
const CLASSIFIED_ARGUMENT_FIELDS = new Set(["name", "title", "description", "required"]);

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Arguments by name, in list order; null when the list is not one of uniquely named argument objects.
function argumentsByName(value: unknown): Map<string, JsonObject> | null {
  if (value === undefined) return new Map();
  if (!Array.isArray(value)) return null;
  const byName = new Map<string, JsonObject>();
  for (const argument of value) {
    if (!isJsonObject(argument) || typeof argument.name !== "string" || byName.has(argument.name)) return null;
    byName.set(argument.name, argument);
  }
  return byName;
}

function unclassifiedFields(argument: JsonObject): JsonObject {
  const fields = Object.create(null) as JsonObject;
  for (const key of Object.keys(argument)) {
    if (!CLASSIFIED_ARGUMENT_FIELDS.has(key)) fields[key] = argument[key];
  }
  return fields;
}

function classifyArguments(before: unknown, after: unknown, equal: Equal, add: (reason: PromptChangeReason, argument: string | null) => void): void {
  const beforeArguments = argumentsByName(before);
  const afterArguments = argumentsByName(after);
  // Inspected definitions always have readable arguments; anything else cannot be compared by name.
  if (beforeArguments === null || afterArguments === null) {
    add("prompt-argument-fields-unclassified", null);
    return;
  }
  for (const [name, beforeArgument] of beforeArguments) {
    const afterArgument = afterArguments.get(name);
    if (afterArgument === undefined) {
      add("prompt-argument-removed", name);
      continue;
    }
    if (beforeArgument.required !== true && afterArgument.required === true) add("prompt-argument-now-required", name);
    if (!equal(unclassifiedFields(beforeArgument), unclassifiedFields(afterArgument))) add("prompt-argument-fields-unclassified", name);
  }
  for (const [name, afterArgument] of afterArguments) {
    if (!beforeArguments.has(name) && afterArgument.required === true) add("prompt-required-argument-added", name);
  }
}

function result(reasons: Set<PromptChangeReason>, locations: PromptChangeLocation[] | null): PromptChangeClassification {
  const ordered = PROMPT_CHANGE_REASONS.filter((reason) => reasons.has(reason));
  const impact: PromptChangeImpact = ordered.some((reason) => !UNCLASSIFIED_REASONS.has(reason))
    ? "breaking"
    : ordered.length > 0 ? "unclassified" : "compatible";
  return locations === null ? { impact, reasons: ordered } : { impact, reasons: ordered, locations };
}

export function classifyRemovedPrompt(): PromptChangeClassification {
  return { impact: "breaking", reasons: ["prompt-removed"] };
}

export function classifyAddedPrompt(): PromptChangeClassification {
  return { impact: "compatible", reasons: [] };
}

export function classifyChangedPrompt(
  before: JsonObject,
  after: JsonObject,
  fields: readonly string[],
  equal: Equal,
  options: { locate?: boolean } = {}
): PromptChangeClassification {
  const reasons = new Set<PromptChangeReason>();
  // In comparison order: arguments in before order, then added arguments, then the prompt itself.
  const locations: PromptChangeLocation[] | null = options.locate ? [] : null;
  const seen = new Set<string>();
  const add = (reason: PromptChangeReason, argument: string | null) => {
    reasons.add(reason);
    const key = JSON.stringify([reason, argument]);
    if (locations !== null && locations.length < MAX_PROMPT_CHANGE_LOCATIONS && !seen.has(key)) {
      seen.add(key);
      locations.push({ reason, argument });
    }
  };
  if (fields.includes("arguments")) classifyArguments(before.arguments, after.arguments, equal, add);
  if (fields.includes("other")) add("other-fields-unclassified", null);
  return result(reasons, locations);
}
