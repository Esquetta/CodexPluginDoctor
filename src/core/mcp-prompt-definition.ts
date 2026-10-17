import type { Finding } from "../domain/types.js";

export interface PromptCatalogLocation {
  page: number;
  promptIndex: number;
  argumentIndex?: number;
  relatedPromptIndex?: number;
  relatedArgumentIndex?: number;
}

export interface PromptCatalogFinding extends Finding {
  location?: PromptCatalogLocation;
}

export const MAX_PROMPTS = 500;
const MAX_FINDINGS = 100;
const DUPLICATE_PROMPT_NAME = "plugin.catalog.prompt.name.duplicate";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finding(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  location: PromptCatalogLocation
): PromptCatalogFinding {
  return { id, severity: id === DUPLICATE_PROMPT_NAME ? "warn" : "fail", message, impact, suggestedFix, location };
}

function inspectArguments(value: unknown, location: PromptCatalogLocation, findings: PromptCatalogFinding[]): void {
  if (!Array.isArray(value)) {
    findings.push(finding(
      "plugin.catalog.prompt.arguments.invalid", "A catalog prompt arguments field must be an array when provided.",
      "Clients cannot determine which arguments the prompt accepts.", "Provide arguments as an array of argument objects or omit the field.", location
    ));
    return;
  }
  const names = new Map<string, number>();
  value.forEach((argument, offset) => {
    const argumentLocation = { ...location, argumentIndex: offset + 1 };
    if (!isJsonObject(argument)) {
      findings.push(finding(
        "plugin.catalog.prompt.argument.invalid_object", "A catalog prompt argument must be an object.",
        "Clients cannot read an argument definition that is not an object.", "Return each prompt argument as an object.", argumentLocation
      ));
      return;
    }
    if (typeof argument.name !== "string" || argument.name === "") {
      findings.push(finding(
        "plugin.catalog.prompt.argument.name.invalid", "A catalog prompt argument name must be a non-empty string.",
        "Clients cannot supply an argument without a name.", "Provide a non-empty string name for the argument.", argumentLocation
      ));
    } else {
      const previous = names.get(argument.name);
      if (previous === undefined) {
        names.set(argument.name, offset + 1);
      } else {
        findings.push(finding(
          "plugin.catalog.prompt.argument.name.duplicate", "Two arguments of a catalog prompt use the same name.",
          "Clients cannot tell which definition applies to the argument they supply.", "Use a unique name for each prompt argument.",
          { ...argumentLocation, relatedArgumentIndex: previous }
        ));
      }
    }
    if (Object.hasOwn(argument, "required") && typeof argument.required !== "boolean") {
      findings.push(finding(
        "plugin.catalog.prompt.argument.required.invalid", "A catalog prompt argument required field must be a boolean when provided.",
        "Clients cannot tell whether the argument must be supplied.", "Set required to true or false, or omit it.", argumentLocation
      ));
    }
    for (const field of ["title", "description"] as const) {
      if (Object.hasOwn(argument, field) && typeof argument[field] !== "string") {
        findings.push(finding(
          `plugin.catalog.prompt.argument.${field}.invalid`, `A catalog prompt argument ${field} must be a string when provided.`,
          `Clients cannot reliably display a non-string argument ${field}.`, `Provide a string ${field} or omit the field.`, argumentLocation
        ));
      }
    }
  });
}

export function inspectMcpPromptDefinition(value: unknown, location: { page: number; promptIndex: number }): PromptCatalogFinding[] {
  const findings: PromptCatalogFinding[] = [];
  const baseLocation: PromptCatalogLocation = { page: location.page, promptIndex: location.promptIndex };

  if (!isJsonObject(value)) {
    findings.push(finding(
      "plugin.catalog.prompt.invalid_object", "A catalog prompt entry must be an object.",
      "The validator cannot inspect a prompt definition that is not an object.", "Return each prompts/list entry as an object.", baseLocation
    ));
    return findings;
  }
  if (typeof value.name !== "string" || value.name === "") {
    findings.push(finding(
      "plugin.catalog.prompt.name.invalid", "A catalog prompt name must be a non-empty string.",
      "Clients cannot identify or retrieve a prompt without a name.", "Provide a non-empty string name for the prompt.", baseLocation
    ));
  }
  for (const field of ["title", "description"] as const) {
    if (Object.hasOwn(value, field) && typeof value[field] !== "string") {
      findings.push(finding(
        `plugin.catalog.prompt.${field}.invalid`, `A catalog prompt ${field} must be a string when provided.`,
        `Clients cannot reliably display a non-string prompt ${field}.`, `Provide a string ${field} or omit the field.`, baseLocation
      ));
    }
  }
  if (Object.hasOwn(value, "arguments")) inspectArguments(value.arguments, baseLocation, findings);
  return findings;
}

export interface McpPromptCatalogInspector {
  readonly findings: PromptCatalogFinding[];
  readonly prompts: unknown[];
  readonly promptsChecked: number;
  // Adds findings up to the finding limit; returns false when the limit truncated them.
  addFindings(items: PromptCatalogFinding[]): boolean;
  // Inspects one enumerated page and returns the limit that stopped inspection, if any.
  inspectPage(pagePrompts: unknown[], page: number, timeExpired: () => boolean): "prompt-limit" | "finding-limit" | "total-time-limit" | null;
}

// Shared by saved-file inspection and the HTTP and stdio catalogs so all apply the same prompt, finding, and duplicate-name rules.
export function createMcpPromptCatalogInspector(): McpPromptCatalogInspector {
  const findings: PromptCatalogFinding[] = [];
  const prompts: unknown[] = [];
  const names = new Map<string, number>();
  let promptsChecked = 0;

  const addFindings = (items: PromptCatalogFinding[]): boolean => {
    if (findings.length + items.length > MAX_FINDINGS) {
      findings.push(...items.slice(0, MAX_FINDINGS - findings.length));
      return false;
    }
    findings.push(...items);
    return true;
  };

  return {
    findings,
    prompts,
    get promptsChecked() {
      return promptsChecked;
    },
    addFindings,
    inspectPage(pagePrompts, page, timeExpired) {
      for (const prompt of pagePrompts) {
        if (promptsChecked >= MAX_PROMPTS) return "prompt-limit";
        promptsChecked += 1;
        prompts.push(prompt);
        const location = { page, promptIndex: promptsChecked };
        if (!addFindings(inspectMcpPromptDefinition(prompt, location))) return "finding-limit";
        if (isJsonObject(prompt) && typeof prompt.name === "string" && prompt.name !== "") {
          const previous = names.get(prompt.name);
          if (previous !== undefined && !addFindings([finding(
            DUPLICATE_PROMPT_NAME, "Two enumerated prompts use the same name.",
            "Duplicate prompt names can make client selection ambiguous.", "Use a unique MCP prompt name for each definition.",
            { ...location, relatedPromptIndex: previous }
          )])) {
            return "finding-limit";
          }
          if (previous === undefined) names.set(prompt.name, promptsChecked);
        }
        if (timeExpired()) return "total-time-limit";
      }
      return null;
    }
  };
}
