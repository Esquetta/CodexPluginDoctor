import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import {
  classifyAddedTool,
  classifyChangedTool,
  classifyRemovedTool
} from "../src/core/mcp-tool-impact.js";

type Definition = Record<string, unknown>;

const FIELDS = ["inputSchema", "outputSchema", "description", "title", "annotations", "other"] as const;

function changedFields(before: Definition, after: Definition): string[] {
  return FIELDS.filter((field) => field === "other"
    ? !isDeepStrictEqual(rest(before), rest(after))
    : !isDeepStrictEqual(before[field], after[field]));
}

function rest(definition: Definition): Definition {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "name" && !(FIELDS as readonly string[]).includes(key)));
}

function classify(before: Definition, after: Definition) {
  return classifyChangedTool(before, after, changedFields(before, after), isDeepStrictEqual);
}

function input(schema: Definition): Definition {
  return { name: "tool", inputSchema: schema };
}

function output(schema: Definition | undefined): Definition {
  return { name: "tool", inputSchema: { type: "object" }, ...(schema === undefined ? {} : { outputSchema: schema }) };
}

const object = (properties: Definition, extra: Definition = {}) => ({ type: "object", properties, ...extra });

describe("tool change impact classification", () => {
  it("treats removals as breaking and additions as compatible", () => {
    expect(classifyRemovedTool()).toEqual({ impact: "breaking", reasons: ["tool-removed"] });
    expect(classifyAddedTool()).toEqual({ impact: "compatible", reasons: [] });
  });

  it.each([
    ["description only", { name: "tool", inputSchema: {}, description: "a" }, { name: "tool", inputSchema: {}, description: "b" }],
    ["title only", { name: "tool", inputSchema: {}, title: "a" }, { name: "tool", inputSchema: {}, title: "b" }],
    ["optional input property added", input(object({ a: { type: "string" } })), input(object({ a: { type: "string" }, b: { type: "number" } }))],
    ["input requirement relaxed", input(object({ a: { type: "string" } }, { required: ["a"] })), input(object({ a: { type: "string" } }))],
    ["input property type widened", input(object({ a: { type: "string" } })), input(object({ a: { type: ["string", "number"] } }))],
    ["input integer widened to number", input(object({ a: { type: "integer" } })), input(object({ a: { type: "number" } }))],
    ["input enum widened", input(object({ a: { enum: ["x"] } })), input(object({ a: { enum: ["x", "y"] } }))],
    ["input enum removed", input(object({ a: { type: "string", enum: ["x"] } })), input(object({ a: { type: "string" } }))],
    ["input additional properties opened", input(object({}, { additionalProperties: false })), input(object({}))],
    ["input property documentation changed", input(object({ a: { type: "string", description: "old" } })), input(object({ a: { type: "string", description: "new", examples: ["x"] } }))],
    ["input root documentation changed", input({ type: "object", description: "old" }), input({ type: "object", description: "new" })],
    ["output schema added", output(undefined), output(object({ a: { type: "string" } }))],
    ["output property added", output(object({ a: { type: "string" } })), output(object({ a: { type: "string" }, b: { type: "string" } }))],
    ["output guarantee added", output(object({ a: { type: "string" } })), output(object({ a: { type: "string" } }, { required: ["a"] }))],
    ["output property type narrowed", output(object({ a: { type: ["string", "null"] } })), output(object({ a: { type: "string" } }))],
    ["output enum narrowed", output(object({ a: { enum: ["x", "y"] } })), output(object({ a: { enum: ["x"] } }))],
    ["output type order changed", output({ type: ["object", "null"] }), output({ type: ["null", "object"] })],
    ["annotations made safer", { name: "tool", inputSchema: {}, annotations: { readOnlyHint: false } }, { name: "tool", inputSchema: {}, annotations: { readOnlyHint: true } }],
    ["annotation title changed", { name: "tool", inputSchema: {}, annotations: { title: "a" } }, { name: "tool", inputSchema: {}, annotations: { title: "b" } }]
  ])("classifies %s as compatible", (_label, before, after) => {
    expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
  });

  it.each([
    ["input root type narrowed", input({ type: ["object", "null"] }), input({ type: "object" }), "input-type-narrowed"],
    ["input root type introduced", input({}), input({ type: "object" }), "input-type-narrowed"],
    ["input property newly required", input(object({ a: { type: "string" } })), input(object({ a: { type: "string" } }, { required: ["a"] })), "input-required-added"],
    ["input property removed", input(object({ a: { type: "string" } })), input(object({})), "input-property-removed"],
    ["input property type narrowed", input(object({ a: { type: "number" } })), input(object({ a: { type: "integer" } })), "input-property-type-narrowed"],
    ["input property enum narrowed", input(object({ a: { enum: ["x", "y"] } })), input(object({ a: { enum: ["x"] } })), "input-property-enum-narrowed"],
    ["input property enum introduced", input(object({ a: { type: "string" } })), input(object({ a: { type: "string", enum: ["x"] } })), "input-property-enum-narrowed"],
    ["input additional properties closed", input(object({})), input(object({}, { additionalProperties: false })), "input-additional-properties-closed"],
    ["output schema removed", output(object({})), output(undefined), "output-schema-removed"],
    ["output type changed", output({ type: "object" }), output({ type: "array" }), "output-type-changed"],
    ["output property removed", output(object({ a: { type: "string" } })), output(object({})), "output-property-removed"],
    ["output guarantee removed", output(object({ a: { type: "string" } }, { required: ["a"] })), output(object({ a: { type: "string" } })), "output-guarantee-removed"],
    ["output property type widened", output(object({ a: { type: "string" } })), output(object({ a: { type: ["string", "null"] } })), "output-property-type-widened"],
    ["output property enum widened", output(object({ a: { enum: ["x"] } })), output(object({ a: { enum: ["x", "y"] } })), "output-property-enum-widened"],
    ["read-only hint dropped", { name: "tool", inputSchema: {}, annotations: { readOnlyHint: true } }, { name: "tool", inputSchema: {} }, "annotation-safety-reduced"],
    ["destructive hint enabled", { name: "tool", inputSchema: {}, annotations: { destructiveHint: false } }, { name: "tool", inputSchema: {}, annotations: { destructiveHint: true } }, "annotation-safety-reduced"],
    ["destructive hint defaulted", { name: "tool", inputSchema: {}, annotations: { destructiveHint: false } }, { name: "tool", inputSchema: {}, annotations: {} }, "annotation-safety-reduced"],
    ["idempotent hint dropped", { name: "tool", inputSchema: {}, annotations: { idempotentHint: true } }, { name: "tool", inputSchema: {}, annotations: { idempotentHint: false } }, "annotation-safety-reduced"],
    ["open world hint enabled", { name: "tool", inputSchema: {}, annotations: { openWorldHint: false } }, { name: "tool", inputSchema: {}, annotations: { openWorldHint: true } }, "annotation-safety-reduced"]
  ])("classifies %s as breaking", (_label, before, after, reason) => {
    expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
  });

  it.each([
    ["input composition keyword", input({ type: "object", anyOf: [{ required: ["a"] }] }), input({ type: "object", anyOf: [{ required: ["b"] }] }), "input-schema-unclassified"],
    ["input nested property constraint", input(object({ a: { type: "string", maxLength: 5 } })), input(object({ a: { type: "string", maxLength: 3 } })), "input-schema-unclassified"],
    ["input non-boolean additional properties", input(object({})), input(object({}, { additionalProperties: { type: "string" } })), "input-schema-unclassified"],
    ["input dialect changed", input({ type: "object", $schema: "a" }), input({ type: "object", $schema: "b" }), "input-schema-unclassified"],
    ["input malformed required", input(object({}, { required: "a" })), input(object({}, { required: ["a"] })), "input-schema-unclassified"],
    ["output additional properties changed", output(object({})), output(object({}, { additionalProperties: false })), "output-schema-unclassified"],
    ["output nested reference", output(object({ a: { $ref: "#/a" } })), output(object({ a: { $ref: "#/b" } })), "output-schema-unclassified"],
    ["extension field", { name: "tool", inputSchema: {}, _meta: { a: 1 } }, { name: "tool", inputSchema: {}, _meta: { a: 2 } }, "other-fields-unclassified"]
  ])("classifies %s as unclassified", (_label, before, after, reason) => {
    expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: [reason] });
  });

  it("lets a breaking reason outrank unclassified reasons and orders reasons deterministically", () => {
    const before = { name: "tool", inputSchema: object({ a: { type: "string" }, b: { type: "string", pattern: "x" } }), annotations: { readOnlyHint: true }, _meta: { a: 1 } };
    const after = { name: "tool", inputSchema: object({ b: { type: "string", pattern: "y" } }, { required: ["b"] }), annotations: {}, _meta: { a: 2 } };
    expect(classify(before, after)).toEqual({
      impact: "breaking",
      reasons: ["input-required-added", "input-property-removed", "input-schema-unclassified", "annotation-safety-reduced", "other-fields-unclassified"]
    });
  });
});
