import type { Finding } from "../domain/types.js";

export interface ResourceTemplateCatalogLocation {
  page: number;
  templateIndex: number;
  relatedTemplateIndex?: number;
}

export interface ResourceTemplateCatalogFinding extends Finding {
  location?: ResourceTemplateCatalogLocation;
}

export const MAX_RESOURCE_TEMPLATES = 500;
const MAX_FINDINGS = 100;
const DUPLICATE_TEMPLATE_NAME = "plugin.catalog.resource_template.name.duplicate";

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// RFC 6570 expressions: an optional operator, then comma-separated variable names with an optional
// prefix (":1" to ":9999") or explode ("*") modifier. Names are letters, digits, "_", percent-encoded
// octets, and single dots between them.
const OPERATORS = new Set(["+", "#", ".", "/", ";", "?", "&"]);
const VARSPEC = /^((?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2})(?:\.?(?:[A-Za-z0-9_]|%[0-9A-Fa-f]{2}))*)(?::[1-9][0-9]{0,3}|\*)?$/u;
// What RFC 6570 excludes from literals: controls, the space, a "%" that does not start a percent-encoded
// octet, lone surrogates, and the listed ASCII characters. Other Unicode, including non-ASCII spaces, is allowed.
const INVALID_LITERAL = /[ \u0000-\u001F\u007F-\u009F"'<>\\^`|\uD800-\uDFFF]|%(?![0-9A-Fa-f]{2})/u;

export interface ParsedUriTemplate {
  // The template with each expression reduced to its operator, such as "file:///{}" or "/users{/}".
  skeleton: string;
  // Variable names in order of appearance.
  variables: string[];
}

/** Parses an RFC 6570 URI template; null when it is not one. */
export function parseUriTemplate(template: string): ParsedUriTemplate | null {
  let skeleton = "";
  const variables: string[] = [];
  let index = 0;
  while (index < template.length) {
    const open = template.indexOf("{", index);
    const literal = template.slice(index, open === -1 ? template.length : open);
    if (literal.includes("}") || INVALID_LITERAL.test(literal)) return null;
    skeleton += literal;
    if (open === -1) break;
    const close = template.indexOf("}", open + 1);
    if (close === -1) return null;
    let body = template.slice(open + 1, close);
    if (body.includes("{")) return null;
    const operator = OPERATORS.has(body[0] ?? "") ? body[0] : "";
    body = body.slice(operator.length);
    if (body === "") return null;
    for (const varspec of body.split(",")) {
      const match = VARSPEC.exec(varspec);
      if (match === null) return null;
      variables.push(match[1]);
    }
    skeleton += `{${operator}}`;
    index = close + 1;
  }
  return { skeleton, variables };
}

function finding(id: string, message: string, impact: string, suggestedFix: string, location: ResourceTemplateCatalogLocation): ResourceTemplateCatalogFinding {
  return { id, severity: id === DUPLICATE_TEMPLATE_NAME ? "warn" : "fail", message, impact, suggestedFix, location };
}

export function inspectMcpResourceTemplateDefinition(
  value: unknown,
  location: { page: number; templateIndex: number }
): ResourceTemplateCatalogFinding[] {
  const findings: ResourceTemplateCatalogFinding[] = [];
  const baseLocation: ResourceTemplateCatalogLocation = { page: location.page, templateIndex: location.templateIndex };

  if (!isJsonObject(value)) {
    findings.push(finding(
      "plugin.catalog.resource_template.invalid_object", "A catalog resource template entry must be an object.",
      "The validator cannot inspect a resource template that is not an object.", "Return each resources/templates/list entry as an object.", baseLocation
    ));
    return findings;
  }
  if (typeof value.name !== "string" || value.name === "") {
    findings.push(finding(
      "plugin.catalog.resource_template.name.invalid", "A catalog resource template name must be a non-empty string.",
      "Clients cannot identify a resource template without a name.", "Provide a non-empty string name for the resource template.", baseLocation
    ));
  }
  if (typeof value.uriTemplate !== "string" || parseUriTemplate(value.uriTemplate) === null) {
    findings.push(finding(
      "plugin.catalog.resource_template.uri_template.invalid", "A catalog resource template uriTemplate must be an RFC 6570 URI template string.",
      "Clients cannot build resource URIs from a missing or malformed template.", "Provide uriTemplate as an RFC 6570 URI template, such as file:///{path}.", baseLocation
    ));
  }
  for (const [field, id] of [["title", "title"], ["description", "description"], ["mimeType", "mime_type"]] as const) {
    if (Object.hasOwn(value, field) && typeof value[field] !== "string") {
      findings.push(finding(
        `plugin.catalog.resource_template.${id}.invalid`, `A catalog resource template ${field} must be a string when provided.`,
        `Clients cannot reliably use a non-string resource template ${field}.`, `Provide a string ${field} or omit the field.`, baseLocation
      ));
    }
  }
  return findings;
}

export interface McpResourceTemplateCatalogInspector {
  readonly findings: ResourceTemplateCatalogFinding[];
  readonly templates: unknown[];
  readonly templatesChecked: number;
  // Adds findings up to the finding limit; returns false when the limit truncated them.
  addFindings(items: ResourceTemplateCatalogFinding[]): boolean;
  // Inspects one enumerated page and returns the limit that stopped inspection, if any.
  inspectPage(pageTemplates: unknown[], page: number, timeExpired: () => boolean): "template-limit" | "finding-limit" | "total-time-limit" | null;
}

// Shared by saved-file inspection and the HTTP and stdio catalogs so all apply the same template, finding, and duplicate-name rules.
export function createMcpResourceTemplateCatalogInspector(): McpResourceTemplateCatalogInspector {
  const findings: ResourceTemplateCatalogFinding[] = [];
  const templates: unknown[] = [];
  const names = new Map<string, number>();
  let templatesChecked = 0;

  const addFindings = (items: ResourceTemplateCatalogFinding[]): boolean => {
    if (findings.length + items.length > MAX_FINDINGS) {
      findings.push(...items.slice(0, MAX_FINDINGS - findings.length));
      return false;
    }
    findings.push(...items);
    return true;
  };

  return {
    findings,
    templates,
    get templatesChecked() {
      return templatesChecked;
    },
    addFindings,
    inspectPage(pageTemplates, page, timeExpired) {
      for (const template of pageTemplates) {
        if (templatesChecked >= MAX_RESOURCE_TEMPLATES) return "template-limit";
        templatesChecked += 1;
        templates.push(template);
        const location = { page, templateIndex: templatesChecked };
        if (!addFindings(inspectMcpResourceTemplateDefinition(template, location))) return "finding-limit";
        if (isJsonObject(template) && typeof template.name === "string" && template.name !== "") {
          const previous = names.get(template.name);
          if (previous !== undefined && !addFindings([finding(
            DUPLICATE_TEMPLATE_NAME, "Two enumerated resource templates use the same name.",
            "Duplicate resource template names can make client selection ambiguous.", "Use a unique name for each resource template.",
            { ...location, relatedTemplateIndex: previous }
          )])) {
            return "finding-limit";
          }
          if (previous === undefined) names.set(template.name, templatesChecked);
        }
        if (timeExpired()) return "total-time-limit";
      }
      return null;
    }
  };
}
