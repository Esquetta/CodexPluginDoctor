import type { Finding } from "../domain/types.js";

export interface CatalogLocation {
  page: number;
  toolIndex: number;
  schema?: "inputSchema" | "outputSchema";
  relatedToolIndex?: number;
}

export interface CatalogFinding extends Finding {
  location?: CatalogLocation;
}

type JsonObject = Record<string, unknown>;
type SchemaSlot = "inputSchema" | "outputSchema";

const CANONICAL_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
const JSON_SCHEMA_TYPES = new Set([
  "array",
  "boolean",
  "integer",
  "null",
  "number",
  "object",
  "string"
]);
const MCP_TOOL_NAME = /^[A-Za-z0-9_.-]{1,128}$/;

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(object: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isAbsoluteUri(value: string): boolean {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}

function schemaLocation(location: CatalogLocation, schema: SchemaSlot): CatalogLocation {
  return { ...location, schema };
}

function addFinding(
  findings: CatalogFinding[],
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  location: CatalogLocation
): void {
  const severity: Finding["severity"] =
    id === "plugin.catalog.tool.name.recommended" ||
    id === "plugin.catalog.schema.dialect.unsupported"
      ? "warn"
      : "fail";

  findings.push({ id, severity, message, impact, suggestedFix, location });
}

function inspectRootSchema(
  schema: JsonObject,
  schemaSlot: SchemaSlot,
  location: CatalogLocation,
  findings: CatalogFinding[]
): void {
  const locator = schemaLocation(location, schemaSlot);
  const hasDialect = hasOwn(schema, "$schema");
  const dialect = hasDialect ? schema.$schema : undefined;

  if (hasDialect && (typeof dialect !== "string" || !isAbsoluteUri(dialect))) {
    addFinding(
      findings,
      "plugin.catalog.schema.dialect.invalid",
      "The root schema dialect must be an absolute URI string when provided.",
      "The validator cannot reliably select a schema dialect for this tool.",
      "Omit $schema or provide an absolute JSON Schema dialect URI.",
      locator
    );
  }

  if (
    typeof dialect === "string" &&
    isAbsoluteUri(dialect) &&
    dialect !== CANONICAL_SCHEMA_DIALECT &&
    dialect !== `${CANONICAL_SCHEMA_DIALECT}#`
  ) {
    addFinding(
      findings,
      "plugin.catalog.schema.dialect.unsupported",
      "The root schema uses a dialect outside this validator's supported baseline.",
      "The schema may be valid, but its root keywords are outside this validator's bounded coverage.",
      "Use the JSON Schema 2020-12 dialect or validate this schema with a dialect-aware validator.",
      locator
    );
    return;
  }

  if (hasOwn(schema, "properties") && !isJsonObject(schema.properties)) {
    addFinding(
      findings,
      "plugin.catalog.schema.properties.invalid",
      "The root schema properties keyword must be an object when provided.",
      "Clients cannot reliably interpret the declared object properties.",
      "Set properties to an object or omit it.",
      locator
    );
  }

  if (hasOwn(schema, "required")) {
    const required = schema.required;
    const isValidRequired =
      Array.isArray(required) &&
      required.every((entry) => typeof entry === "string") &&
      new Set(required).size === required.length;

    if (!isValidRequired) {
      addFinding(
        findings,
        "plugin.catalog.schema.required.invalid",
        "The root schema required keyword must be an array of unique strings when provided.",
        "Clients cannot reliably determine which inputs are required.",
        "Set required to an array of unique property names or omit it.",
        locator
      );
    }
  }

  if (hasOwn(schema, "type")) {
    const type = schema.type;
    const isValidType =
      (typeof type === "string" && JSON_SCHEMA_TYPES.has(type)) ||
      (Array.isArray(type) &&
        type.length > 0 &&
        type.every((entry) => typeof entry === "string" && JSON_SCHEMA_TYPES.has(entry)) &&
        new Set(type).size === type.length);

    if (!isValidType) {
      addFinding(
        findings,
        "plugin.catalog.schema.type.invalid",
        "The root schema type keyword must be a supported type string or a non-empty array of unique supported type strings.",
        "Clients cannot reliably interpret the root value type.",
        "Use JSON Schema primitive types for type, or omit the keyword.",
        locator
      );
    }
  }

  if (
    hasOwn(schema, "additionalProperties") &&
    typeof schema.additionalProperties !== "boolean" &&
    !isJsonObject(schema.additionalProperties)
  ) {
    addFinding(
      findings,
      "plugin.catalog.schema.additional_properties.invalid",
      "The root schema additionalProperties keyword must be a boolean or object when provided.",
      "Clients cannot reliably interpret whether additional object properties are allowed.",
      "Set additionalProperties to a boolean or object, or omit it.",
      locator
    );
  }
}

export function inspectMcpToolDefinition(
  value: unknown,
  location: { page: number; toolIndex: number }
): CatalogFinding[] {
  const findings: CatalogFinding[] = [];
  const baseLocation: CatalogLocation = { page: location.page, toolIndex: location.toolIndex };

  if (!isJsonObject(value)) {
    addFinding(
      findings,
      "plugin.catalog.tool.invalid_object",
      "A catalog tool entry must be an object.",
      "The validator cannot inspect a tool definition that is not an object.",
      "Return each tools/list entry as an object.",
      baseLocation
    );
    return findings;
  }

  const name = hasOwn(value, "name") ? value.name : undefined;
  if (typeof name !== "string") {
    addFinding(
      findings,
      "plugin.catalog.tool.name.invalid",
      "A catalog tool name must be a string.",
      "Clients cannot identify or invoke a tool without a string name.",
      "Provide a string name for the tool.",
      baseLocation
    );
  } else if (!MCP_TOOL_NAME.test(name)) {
    addFinding(
      findings,
      "plugin.catalog.tool.name.recommended",
      "The tool name does not meet the MCP recommended ASCII length and character constraints.",
      "Some clients may not accept or consistently display this tool name.",
      "Use 1 to 128 ASCII letters, digits, dots, underscores, or hyphens for the tool name.",
      baseLocation
    );
  }

  if (hasOwn(value, "title") && typeof value.title !== "string") {
    addFinding(
      findings,
      "plugin.catalog.tool.title.invalid",
      "A catalog tool title must be a string when provided.",
      "Clients cannot reliably display a non-string tool title.",
      "Provide a string title or omit the title field.",
      baseLocation
    );
  }

  if (hasOwn(value, "description") && typeof value.description !== "string") {
    addFinding(
      findings,
      "plugin.catalog.tool.description.invalid",
      "A catalog tool description must be a string when provided.",
      "Clients cannot reliably display a non-string tool description.",
      "Provide a string description or omit the description field.",
      baseLocation
    );
  }

  const inputSchema = hasOwn(value, "inputSchema") ? value.inputSchema : undefined;
  if (!isJsonObject(inputSchema)) {
    addFinding(
      findings,
      "plugin.catalog.schema.input.invalid",
      "A catalog tool inputSchema must be a non-null object.",
      "Clients cannot reliably construct valid tool inputs without an object schema.",
      "Provide inputSchema as an object.",
      schemaLocation(baseLocation, "inputSchema")
    );
  } else {
    inspectRootSchema(inputSchema, "inputSchema", baseLocation, findings);
  }

  if (hasOwn(value, "outputSchema")) {
    const outputSchema = value.outputSchema;
    if (!isJsonObject(outputSchema)) {
      addFinding(
        findings,
        "plugin.catalog.schema.output.invalid",
        "A catalog tool outputSchema must be an object when provided.",
        "Clients cannot reliably interpret tool outputs without an object schema.",
        "Provide outputSchema as an object or omit it.",
        schemaLocation(baseLocation, "outputSchema")
      );
    } else {
      inspectRootSchema(outputSchema, "outputSchema", baseLocation, findings);
    }
  }

  return findings;
}
