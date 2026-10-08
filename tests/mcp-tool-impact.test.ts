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
const array = (items: Definition, extra: Definition = {}) => ({ type: "array", items, ...extra });
const nestedInput = (child: Definition) => input(object({ options: child }));
const nestedOutput = (child: Definition) => output(object({ result: child }));
const deeply = (levels: number, leaf: Definition): Definition =>
  levels === 0 ? leaf : object({ next: deeply(levels - 1, leaf) });

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
    ["output type narrowed", output({ type: ["object", "null"] }), output({ type: "object" })],
    ["output type introduced", output({}), output({ type: "object" })],
    ["annotations made safer", { name: "tool", inputSchema: {}, annotations: { readOnlyHint: false } }, { name: "tool", inputSchema: {}, annotations: { readOnlyHint: true } }],
    ["annotation title changed", { name: "tool", inputSchema: {}, annotations: { title: "a" } }, { name: "tool", inputSchema: {}, annotations: { title: "b" } }],
    ["nested optional input property added", nestedInput(object({ a: { type: "string" } })), nestedInput(object({ a: { type: "string" }, b: { type: "number" } }))],
    ["nested input requirement relaxed", nestedInput(object({ a: { type: "string" } }, { required: ["a"] })), nestedInput(object({ a: { type: "string" } }))],
    ["nested input type widened", nestedInput(object({ a: { type: "integer" } })), nestedInput(object({ a: { type: "number" } }))],
    ["input array items widened", input(object({ a: array({ type: "string" }) })), input(object({ a: array({ type: ["string", "number"] }) }))],
    ["input array items constraint removed", input(object({ a: array({ type: "string" }) })), input(object({ a: { type: "array" } }))],
    ["input max length relaxed", input(object({ a: { type: "string", maxLength: 3 } })), input(object({ a: { type: "string", maxLength: 5 } }))],
    ["input minimum lowered", input(object({ a: { type: "number", minimum: 5 } })), input(object({ a: { type: "number", minimum: 1 } }))],
    ["input max items removed", input(object({ a: array({ type: "string" }, { maxItems: 2 }) })), input(object({ a: array({ type: "string" }) }))],
    ["nested output property added", nestedOutput(object({ a: { type: "string" } })), nestedOutput(object({ a: { type: "string" }, b: { type: "string" } }))],
    ["nested output guarantee added", nestedOutput(object({ a: { type: "string" } })), nestedOutput(object({ a: { type: "string" } }, { required: ["a"] }))],
    ["output array items narrowed", output(object({ a: array({ type: ["string", "null"] }) })), output(object({ a: array({ type: "string" }) }))],
    ["output max length tightened", output(object({ a: { type: "string", maxLength: 5 } })), output(object({ a: { type: "string", maxLength: 3 } }))],
    ["output min items introduced", output(object({ a: array({ type: "string" }) })), output(object({ a: array({ type: "string" }, { minItems: 1 }) }))],
    ["property added to a closed nested object", nestedInput(object({}, { additionalProperties: false })), nestedInput(object({ a: { type: "string" } }, { additionalProperties: false }))],
    ["root property added to an empty root schema", input({ type: "object" }), input(object({ a: { type: "string" } }))],
    ["output property added to a free-form nested object", nestedOutput({ type: "object" }), nestedOutput(object({ count: { type: "integer" } }))],
    ["output property added to a closed nested object", nestedOutput(object({ a: { type: "string" } }, { additionalProperties: false })), nestedOutput(object({ a: { type: "string" }, b: { type: "string" } }, { additionalProperties: false }))],
    ["output array items introduced", output(object({ a: { type: "array" } })), output(object({ a: array({ type: "string" }) }))],
    ["documentation changed within the depth limit", input(deeply(8, { type: "string", description: "a" })), input(deeply(8, { type: "string", description: "b" }))],
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
    ["output type changed", output({ type: "object" }), output({ type: "array" }), "output-type-widened"],
    ["output type widened", output({ type: "object" }), output({ type: ["object", "null"] }), "output-type-widened"],
    ["output type restriction removed", output({ type: "object" }), output({}), "output-type-widened"],
    ["output property removed", output(object({ a: { type: "string" } })), output(object({})), "output-property-removed"],
    ["output guarantee removed", output(object({ a: { type: "string" } }, { required: ["a"] })), output(object({ a: { type: "string" } })), "output-guarantee-removed"],
    ["output property type widened", output(object({ a: { type: "string" } })), output(object({ a: { type: ["string", "null"] } })), "output-property-type-widened"],
    ["output property enum widened", output(object({ a: { enum: ["x"] } })), output(object({ a: { enum: ["x", "y"] } })), "output-property-enum-widened"],
    ["read-only hint dropped", { name: "tool", inputSchema: {}, annotations: { readOnlyHint: true } }, { name: "tool", inputSchema: {} }, "annotation-safety-reduced"],
    ["destructive hint enabled", { name: "tool", inputSchema: {}, annotations: { destructiveHint: false } }, { name: "tool", inputSchema: {}, annotations: { destructiveHint: true } }, "annotation-safety-reduced"],
    ["destructive hint defaulted", { name: "tool", inputSchema: {}, annotations: { destructiveHint: false } }, { name: "tool", inputSchema: {}, annotations: {} }, "annotation-safety-reduced"],
    ["idempotent hint dropped", { name: "tool", inputSchema: {}, annotations: { idempotentHint: true } }, { name: "tool", inputSchema: {}, annotations: { idempotentHint: false } }, "annotation-safety-reduced"],
    ["open world hint enabled", { name: "tool", inputSchema: {}, annotations: { openWorldHint: false } }, { name: "tool", inputSchema: {}, annotations: { openWorldHint: true } }, "annotation-safety-reduced"],
    ["nested input property newly required", nestedInput(object({ a: { type: "string" } })), nestedInput(object({ a: { type: "string" } }, { required: ["a"] })), "input-required-added"],
    ["nested input property removed", nestedInput(object({ a: { type: "string" } })), nestedInput(object({})), "input-property-removed"],
    ["nested input type narrowed", nestedInput(object({ a: { type: "number" } })), nestedInput(object({ a: { type: "integer" } })), "input-property-type-narrowed"],
    ["nested input enum narrowed", nestedInput(object({ a: { enum: ["x", "y"] } })), nestedInput(object({ a: { enum: ["x"] } })), "input-property-enum-narrowed"],
    ["nested input additional properties closed", nestedInput(object({})), nestedInput(object({}, { additionalProperties: false })), "input-additional-properties-closed"],
    ["input array items narrowed", input(object({ a: array({ type: ["string", "number"] }) })), input(object({ a: array({ type: "string" }) })), "input-property-type-narrowed"],
    ["input array items constraint introduced", input(object({ a: { type: "array" } })), input(object({ a: array({ type: "string" }) })), "input-constraint-tightened"],
    ["input array item requirement added", input(object({ a: array(object({ id: { type: "string" } })) })), input(object({ a: array(object({ id: { type: "string" } }, { required: ["id"] })) })), "input-required-added"],
    ["input max length tightened", input(object({ a: { type: "string", maxLength: 5 } })), input(object({ a: { type: "string", maxLength: 3 } })), "input-constraint-tightened"],
    ["input minimum raised", input(object({ a: { type: "number", minimum: 1 } })), input(object({ a: { type: "number", minimum: 5 } })), "input-constraint-tightened"],
    ["input min items introduced", input(object({ a: array({ type: "string" }) })), input(object({ a: array({ type: "string" }, { minItems: 1 }) })), "input-constraint-tightened"],
    ["nested output property removed", nestedOutput(object({ a: { type: "string" } })), nestedOutput(object({})), "output-property-removed"],
    ["nested output guarantee removed", nestedOutput(object({ a: { type: "string" } }, { required: ["a"] })), nestedOutput(object({ a: { type: "string" } })), "output-guarantee-removed"],
    ["nested output type widened", nestedOutput(object({ a: { type: "string" } })), nestedOutput(object({ a: { type: ["string", "null"] } })), "output-property-type-widened"],
    ["output array items widened", output(object({ a: array({ type: "string" }) })), output(object({ a: array({ type: ["string", "null"] }) })), "output-property-type-widened"],
    ["output array items constraint removed", output(object({ a: array({ type: "string" }) })), output(object({ a: { type: "array" } })), "output-constraint-loosened"],
    ["output max length relaxed", output(object({ a: { type: "string", maxLength: 3 } })), output(object({ a: { type: "string", maxLength: 5 } })), "output-constraint-loosened"],
    ["output maximum removed", output(object({ a: { type: "number", maximum: 10 } })), output(object({ a: { type: "number" } })), "output-constraint-loosened"],
    ["array item change at the depth limit", input(deeply(7, array({ type: "number" }))), input(deeply(7, array({ type: "integer" }))), "input-property-type-narrowed"],
    ["change at the depth limit", input(deeply(8, { type: "number" })), input(deeply(8, { type: "integer" })), "input-property-type-narrowed"],
  ])("classifies %s as breaking", (_label, before, after, reason) => {
    expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
  });

  it.each([
    ["input composition keyword", input({ type: "object", anyOf: [{ required: ["a"] }] }), input({ type: "object", anyOf: [{ required: ["b"] }] }), "input-schema-unclassified"],
    ["input property pattern", input(object({ a: { type: "string", pattern: "x" } })), input(object({ a: { type: "string", pattern: "y" } })), "input-schema-unclassified"],
    ["input exclusive bound", input(object({ a: { type: "number", exclusiveMinimum: 0 } })), input(object({ a: { type: "number", exclusiveMinimum: 1 } })), "input-schema-unclassified"],
    ["input non-numeric bound", input(object({ a: { type: "string", maxLength: 5 } })), input(object({ a: { type: "string", maxLength: "3" } })), "input-schema-unclassified"],
    ["input tuple items", input(object({ a: array({ type: "string" }) })), input(object({ a: { type: "array", items: [{ type: "string" }] } })), "input-schema-unclassified"],
    ["nested composition keyword", nestedInput(object({ a: { type: "string" } }, { anyOf: [{ required: ["a"] }] })), nestedInput(object({ a: { type: "string" } }, { anyOf: [] })), "input-schema-unclassified"],
    ["nested non-boolean additional properties", nestedInput(object({})), nestedInput(object({}, { additionalProperties: { type: "string" } })), "input-schema-unclassified"],
    ["array item change below the depth limit", input(deeply(8, array({ type: "number" }))), input(deeply(8, array({ type: "integer" }))), "input-schema-unclassified"],
    ["change below the depth limit", input(deeply(9, { type: "string" })), input(deeply(9, { type: "number" })), "input-schema-unclassified"],
    ["output nested additional properties changed", nestedOutput(object({})), nestedOutput(object({}, { additionalProperties: false })), "output-schema-unclassified"],
    ["typed property added to a free-form nested object", nestedInput({ type: "object" }), nestedInput(object({ priority: { type: "integer" } })), "input-schema-unclassified"],
    ["property added beside a nested additional properties schema", nestedInput(object({ a: { type: "string" } }, { additionalProperties: { type: "string" } })), nestedInput(object({ a: { type: "string" }, b: { type: "number" } }, { additionalProperties: { type: "string" } })), "input-schema-unclassified"],
    ["property added beside nested pattern properties", nestedInput(object({ a: { type: "string" } }, { patternProperties: { "^x_": { type: "string" } }, additionalProperties: false })), nestedInput(object({ a: { type: "string" }, x_n: { type: "integer" } }, { patternProperties: { "^x_": { type: "string" } }, additionalProperties: false })), "input-schema-unclassified"],
    ["output property added beside a nested additional properties schema", nestedOutput({ type: "object", additionalProperties: { type: "string" } }), nestedOutput(object({ count: { type: "integer" } }, { additionalProperties: { type: "string" } })), "output-schema-unclassified"],
    ["input items removed beside unevaluated items", input(object({ a: array({ type: "string" }, { unevaluatedItems: false }) })), input(object({ a: { type: "array", unevaluatedItems: false } })), "input-schema-unclassified"],
    ["input additional properties removed beside unevaluated properties", input(object({ a: { type: "string" } }, { additionalProperties: { type: "string" }, unevaluatedProperties: false })), input(object({ a: { type: "string" } }, { unevaluatedProperties: false })), "input-schema-unclassified"],
    ["output items introduced beside unevaluated items", output(object({ a: { type: "array", unevaluatedItems: false } })), output(object({ a: array({ type: "string" }, { unevaluatedItems: false }) })), "output-schema-unclassified"],
    ["already required root key declared", input(object({}, { required: ["id"] })), input(object({ id: { type: "integer" } }, { required: ["id"] })), "input-schema-unclassified"],
    ["already required nested key declared", nestedInput(object({ a: { type: "string" } }, { required: ["a", "b"] })), nestedInput(object({ a: { type: "string" }, b: { type: "integer" } }, { required: ["a", "b"] })), "input-schema-unclassified"],
    ["non-numeric input bound removed", input(object({ a: { type: "string", maxLength: "5" } })), input(object({ a: { type: "string" } })), "input-schema-unclassified"],
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
