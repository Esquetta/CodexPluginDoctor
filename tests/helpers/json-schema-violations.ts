import { isDeepStrictEqual } from "node:util";

// Checks the JSON Schema keywords the contract uses, so real reports are held to the published bounds.
export function violations(schema: Record<string, any>, value: unknown, at = "$"): string[] {
  const errors: string[] = [];
  if (Object.hasOwn(schema, "const") && !isDeepStrictEqual(schema.const, value)) errors.push(`${at}: const`);
  if (schema.enum && !schema.enum.some((option: unknown) => isDeepStrictEqual(option, value))) errors.push(`${at}: enum`);
  if (schema.type) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    if (![schema.type].flat().includes(actual)) errors.push(`${at}: type ${actual}`);
  }
  if (typeof value === "number" && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) errors.push(`${at}: bounds`);
  if (typeof value === "string" && schema.pattern && !new RegExp(schema.pattern, "u").test(value)) errors.push(`${at}: pattern`);
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: maxItems`);
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) errors.push(`${at}: uniqueItems`);
    if (schema.items) value.forEach((item, index) => errors.push(...violations(schema.items, item, `${at}[${index}]`)));
  } else if (typeof value === "object" && value !== null) {
    for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) errors.push(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) errors.push(...violations(schema.properties[key], item, `${at}.${key}`));
      else if (schema.additionalProperties === false) errors.push(`${at}.${key}: additional`);
    }
  }
  return errors;
}
