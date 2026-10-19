import { parseUriTemplate } from "./mcp-resource-template-definition.js";

type JsonObject = Record<string, unknown>;
type Equal = (left: unknown, right: unknown) => boolean;

export type ResourceTemplateChangeImpact = "breaking" | "compatible" | "unclassified";

export const RESOURCE_TEMPLATE_CHANGE_REASONS = [
  "resource-template-removed",
  "resource-template-uri-changed",
  "resource-template-variable-removed",
  "resource-template-variable-added",
  "resource-template-mime-type-changed",
  "other-fields-unclassified"
] as const;

export type ResourceTemplateChangeReason = (typeof RESOURCE_TEMPLATE_CHANGE_REASONS)[number];

export interface ResourceTemplateChangeLocation {
  reason: ResourceTemplateChangeReason;
  // The URI template variable the reason applies to; null when it applies to the template itself.
  variable: string | null;
}

export interface ResourceTemplateChangeClassification {
  impact: ResourceTemplateChangeImpact;
  reasons: ResourceTemplateChangeReason[];
  // Present only when locations were requested, because locations name variables.
  locations?: ResourceTemplateChangeLocation[];
}

export const MAX_RESOURCE_TEMPLATE_CHANGE_LOCATIONS = 100;

const UNCLASSIFIED_REASONS = new Set<ResourceTemplateChangeReason>(["resource-template-mime-type-changed", "other-fields-unclassified"]);

function classifyUriTemplate(before: unknown, after: unknown, equal: Equal, add: (reason: ResourceTemplateChangeReason, variable: string | null) => void): void {
  const beforeTemplate = typeof before === "string" ? parseUriTemplate(before) : null;
  const afterTemplate = typeof after === "string" ? parseUriTemplate(after) : null;
  // Inspected definitions always have parseable templates; anything else cannot be compared by variable.
  if (beforeTemplate === null || afterTemplate === null) {
    add("resource-template-uri-changed", null);
    return;
  }
  const beforeVariables = new Set(beforeTemplate.variables);
  const afterVariables = new Set(afterTemplate.variables);
  let variablesChanged = false;
  for (const variable of beforeVariables) {
    if (!afterVariables.has(variable)) {
      variablesChanged = true;
      add("resource-template-variable-removed", variable);
    }
  }
  // Clients do not supply a new variable, so the server receives URIs without it.
  for (const variable of afterVariables) {
    if (!beforeVariables.has(variable)) {
      variablesChanged = true;
      add("resource-template-variable-added", variable);
    }
  }
  // With the same variables, any other difference, such as order, modifiers, or literals, changes the URIs clients build.
  if (beforeTemplate.skeleton !== afterTemplate.skeleton || (!variablesChanged && !equal(before, after))) {
    add("resource-template-uri-changed", null);
  }
}

function result(reasons: Set<ResourceTemplateChangeReason>, locations: ResourceTemplateChangeLocation[] | null): ResourceTemplateChangeClassification {
  const ordered = RESOURCE_TEMPLATE_CHANGE_REASONS.filter((reason) => reasons.has(reason));
  const impact: ResourceTemplateChangeImpact = ordered.some((reason) => !UNCLASSIFIED_REASONS.has(reason))
    ? "breaking"
    : ordered.length > 0 ? "unclassified" : "compatible";
  return locations === null ? { impact, reasons: ordered } : { impact, reasons: ordered, locations };
}

export function classifyRemovedResourceTemplate(): ResourceTemplateChangeClassification {
  return { impact: "breaking", reasons: ["resource-template-removed"] };
}

export function classifyAddedResourceTemplate(): ResourceTemplateChangeClassification {
  return { impact: "compatible", reasons: [] };
}

export function classifyChangedResourceTemplate(
  before: JsonObject,
  after: JsonObject,
  fields: readonly string[],
  equal: Equal,
  options: { locate?: boolean } = {}
): ResourceTemplateChangeClassification {
  const reasons = new Set<ResourceTemplateChangeReason>();
  // In comparison order: removed variables in before order, then added variables in after order, then the template itself.
  const locations: ResourceTemplateChangeLocation[] | null = options.locate ? [] : null;
  const seen = new Set<string>();
  const add = (reason: ResourceTemplateChangeReason, variable: string | null) => {
    reasons.add(reason);
    const key = JSON.stringify([reason, variable]);
    if (locations !== null && locations.length < MAX_RESOURCE_TEMPLATE_CHANGE_LOCATIONS && !seen.has(key)) {
      seen.add(key);
      locations.push({ reason, variable });
    }
  };
  if (fields.includes("uriTemplate")) classifyUriTemplate(before.uriTemplate, after.uriTemplate, equal, add);
  if (fields.includes("mimeType")) add("resource-template-mime-type-changed", null);
  if (fields.includes("other")) add("other-fields-unclassified", null);
  return result(reasons, locations);
}
