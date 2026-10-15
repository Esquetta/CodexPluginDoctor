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
    ["root property added beside $defs", input(object({ a: { type: "string" } }, { $defs: { Item: { type: "string" } } })), input(object({ a: { type: "string" }, b: { type: "number" } }, { $defs: { Item: { type: "string" } } }))],
    ["nested property added beside definitions", nestedInput(object({ a: { type: "string" } }, { definitions: { Item: { type: "string" } } })), nestedInput(object({ a: { type: "string" }, b: { type: "number" } }, { definitions: { Item: { type: "string" } } }))],
    ["nested property added beside $defs", nestedInput(object({ a: { type: "string" } }, { $defs: { Item: { type: "string" } } })), nestedInput(object({ a: { type: "string" }, b: { type: "number" } }, { $defs: { Item: { type: "string" } } }))],
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
    ["root property added beside an additional properties schema", input(object({ a: { type: "string" } }, { additionalProperties: { type: "string" } })), input(object({ a: { type: "string" }, b: { type: "number" } }, { additionalProperties: { type: "string" } })), "input-schema-unclassified"],
    ["root property added beside pattern properties", input(object({ a: { type: "string" } }, { patternProperties: { "^x_": { type: "string" } } })), input(object({ a: { type: "string" }, x_n: { type: "integer" } }, { patternProperties: { "^x_": { type: "string" } } })), "input-schema-unclassified"],
    ["root output property added beside an additional properties schema", output(object({ a: { type: "string" } }, { additionalProperties: { type: "string" } })), output(object({ a: { type: "string" }, count: { type: "integer" } }, { additionalProperties: { type: "string" } })), "output-schema-unclassified"],
    ["nested key declared beside dependentRequired", nestedInput(object({ a: { type: "string" } }, { dependentRequired: { b: ["a"] } })), nestedInput(object({ a: { type: "string" }, b: { type: "integer" } }, { dependentRequired: { b: ["a"] } })), "input-schema-unclassified"],
    ["nested key declared beside const", nestedInput(object({ a: { type: "number" } }, { const: { a: 1, b: "x" } })), nestedInput(object({ a: { type: "number" }, b: { type: "integer" } }, { const: { a: 1, b: "x" } })), "input-schema-unclassified"],
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

  describe("local references", () => {
    const withDefs = (properties: Definition, defs: Definition, key = "$defs") => input(object(properties, { [key]: defs }));
    const outputWithDefs = (properties: Definition, defs: Definition) => output(object(properties, { $defs: defs }));
    const ref = (name: string, key = "$defs") => ({ $ref: `#/${key}/${name}` });
    const tree = (node: Definition) => ({ Node: object({ value: node, children: array(ref("Node")) }) });

    it.each([
      ["unchanged reference beside a changed definition it does not use", withDefs({ a: ref("A") }, { A: { type: "string" }, B: { type: "string" } }), withDefs({ a: ref("A") }, { A: { type: "string" }, B: { type: "integer" } })],
      ["optional property added inside a referenced definition", withDefs({ a: ref("A") }, { A: object({ x: { type: "string" } }) }), withDefs({ a: ref("A") }, { A: object({ x: { type: "string" }, y: { type: "number" } }) })],
      ["input type widened through definitions", withDefs({ a: ref("A", "definitions") }, { A: { type: "integer" } }, "definitions"), withDefs({ a: ref("A", "definitions") }, { A: { type: "number" } }, "definitions")],
      ["reference inlined with the same schema", withDefs({ a: ref("A") }, { A: { type: "string" } }), input(object({ a: { type: "string" } }))],
      ["reference documentation sibling changed", withDefs({ a: { ...ref("A"), description: "old" } }, { A: { type: "string" } }), withDefs({ a: { ...ref("A"), description: "new" } }, { A: { type: "string" } })],
      ["escaped definition name", withDefs({ a: { $ref: "#/$defs/a~1b~0c" } }, { "a/b~c": { type: "integer" } }), withDefs({ a: { $ref: "#/$defs/a~1b~0c" } }, { "a/b~c": { type: "number" } })],
      ["recursive definition widened", withDefs({ root: ref("Node") }, tree({ type: "integer" })), withDefs({ root: ref("Node") }, tree({ type: "number" }))],
      ["array items through a reference", withDefs({ a: array(ref("A")) }, { A: { enum: ["x"] } }), withDefs({ a: array(ref("A")) }, { A: { enum: ["x", "y"] } })],
      ["unchanged remote reference beside a widened property", input(object({ a: { $ref: "https://example.test/a.json" }, b: { type: "integer" } })), input(object({ a: { $ref: "https://example.test/a.json" }, b: { type: "number" } }))]
    ])("classifies %s as compatible", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
    });

    it.each([
      ["input property removed inside a referenced definition", withDefs({ a: ref("A") }, { A: object({ x: { type: "string" } }) }), withDefs({ a: ref("A") }, { A: object({}) }), "input-property-removed"],
      ["input requirement added inside a referenced definition", withDefs({ a: ref("A") }, { A: object({ x: { type: "string" } }) }), withDefs({ a: ref("A") }, { A: object({ x: { type: "string" } }, { required: ["x"] }) }), "input-required-added"],
      ["reference retargeted to a narrower definition", withDefs({ a: ref("A") }, { A: { type: "number" }, B: { type: "integer" } }), withDefs({ a: ref("B") }, { A: { type: "number" }, B: { type: "integer" } }), "input-property-type-narrowed"],
      ["inline schema replaced by a narrower reference", input(object({ a: { type: "number" } })), withDefs({ a: ref("A") }, { A: { type: "integer" } }), "input-property-type-narrowed"],
      ["recursive definition narrowed", withDefs({ root: ref("Node") }, tree({ type: "number" })), withDefs({ root: ref("Node") }, tree({ type: "integer" })), "input-property-type-narrowed"],
      ["output enum widened through a reference", outputWithDefs({ a: ref("A") }, { A: { enum: ["x"] } }), outputWithDefs({ a: ref("A") }, { A: { enum: ["x", "y"] } }), "output-property-enum-widened"],
      ["reference to another property narrowed", input(object({ a: { $ref: "#/properties/b" }, b: { type: "number" } })), input(object({ a: { $ref: "#/properties/b" }, b: { type: "integer" } })), "input-property-type-narrowed"],
      ["unchanged composition whose referenced definition changed", withDefs({ a: { anyOf: [ref("A"), { type: "null" }] } }, { A: { type: "number" } }), withDefs({ a: { anyOf: [ref("A"), { type: "null" }] } }, { A: { type: "integer" } }), "input-property-type-narrowed"],
      ["unchanged array items whose definition narrowed", withDefs({ a: array(ref("A")) }, { A: { enum: ["x", "y"] } }), withDefs({ a: array(ref("A")) }, { A: { enum: ["x"] } }), "input-property-enum-narrowed"]
    ])("classifies %s as breaking", (_label, before, after, reason) => {
      expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
    });

    it.each([
      ["reference to a missing definition", withDefs({ a: ref("A") }, { A: { type: "string" } }), withDefs({ a: ref("B") }, { A: { type: "string" } })],
      ["unchanged anchor reference beside a widened property", input(object({ a: { $ref: "#Item" }, b: { type: "integer" } })), input(object({ a: { $ref: "#Item" }, b: { type: "number" } }))],
      ["remote reference changed", input(object({ a: { $ref: "https://example.test/a.json" } })), input(object({ a: { $ref: "https://example.test/b.json" } }))],
      ["reference inside a nested resource", withDefs({ a: { $id: "item", $defs: { A: { type: "string" } }, ...ref("A") } }, { A: { type: "integer" } }), withDefs({ a: { $id: "item", $defs: { A: { type: "string" } }, ...ref("A") } }, { A: { type: "number" } })],
      ["reference with a validating sibling", withDefs({ a: { ...ref("A"), minLength: 1 } }, { A: { type: "string" } }), withDefs({ a: { ...ref("A"), minLength: 1 } }, { A: { type: "integer" } })],
      ["definition reached through $dynamicRef", withDefs({ a: { $dynamicRef: "#/$defs/A" } }, { A: { enum: ["x", "y"] } }), withDefs({ a: { $dynamicRef: "#/$defs/A" } }, { A: { enum: ["x"] } })],
      ["definition reached through an absolute URI reference", input(object({ a: { $ref: "https://example.test/tool.json#/$defs/A" } }, { $id: "https://example.test/tool.json", $defs: { A: { enum: ["x", "y"] } } })), input(object({ a: { $ref: "https://example.test/tool.json#/$defs/A" } }, { $id: "https://example.test/tool.json", $defs: { A: { enum: ["x"] } } }))],
      ["definition reached through an embedded resource identifier", withDefs({ a: { $ref: "urn:item" } }, { A: { $id: "urn:item", enum: ["x", "y"] } }), withDefs({ a: { $ref: "urn:item" } }, { A: { $id: "urn:item", enum: ["x"] } })],
      ["alias cycle introduced", withDefs({ a: ref("A") }, { A: { type: "string" }, B: ref("A") }), withDefs({ a: ref("A") }, { A: ref("B"), B: ref("A") })]
    ])("classifies %s as unclassified", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });
  });

  it("compares a widely shared definition once per depth instead of once per path", () => {
    // Ten levels of definitions where every level refers to the next ten times: 10^9 paths.
    const defs = (leaf: Definition) => Object.fromEntries(Array.from({ length: 10 }, (_, level) => [
      `L${level}`,
      level === 9 ? leaf : object(Object.fromEntries(Array.from({ length: 10 }, (_, key) => [`p${key}`, { $ref: `#/$defs/L${level + 1}` }])))
    ]));
    const started = performance.now();
    const result = classify(input(object({ root: { $ref: "#/$defs/L0" } }, { $defs: defs({ enum: ["x", "y"] }) })), input(object({ root: { $ref: "#/$defs/L0" } }, { $defs: defs({ enum: ["x"] }) })));
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(result.impact).not.toBe("compatible");
  });

  it.each(["default", "examples", "enum", "const"])("follows references below a property named %s", (name) => {
    const tool = (modes: string[]) => input(object({ config: { $ref: "#/$defs/Config" } }, {
      $defs: { Config: object({ [name]: { $ref: "#/$defs/Mode" } }), Mode: { enum: modes } }
    }));
    expect(classify(tool(["a", "b"]), tool(["a"]))).toEqual({ impact: "breaking", reasons: ["input-property-enum-narrowed"] });
  });

  it.each([
    ["a $dynamicRef", { $dynamicRef: "#/$defs/A" }, {}],
    ["a URI reference", { $ref: "https://example.test/tool.json#/$defs/A" }, { $id: "https://example.test/tool.json" }]
  ])("compares definitions as written when %s sits below a property named like a data keyword", (_label, property, root) => {
    const tool = (values: string[]) => input(object({ default: property }, { ...root, $defs: { A: { enum: values } } }));
    expect(classify(tool(["x", "y"]), tool(["x"]))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
  });

  it("follows references in draft-07 dependencies keyed by a data keyword name", () => {
    const tool = (modes: string[]) => input(object({ default: { type: "string" } }, {
      dependencies: { default: { $ref: "#/definitions/X" } },
      definitions: { X: object({ m: { enum: modes } }) }
    }));
    expect(classify(tool(["a", "b"]), tool(["a"])).impact).not.toBe("compatible");
  });

  it("does not trust a reference into a data value that hides a dynamic reference", () => {
    const tool = (type: string) => input(object({
      a: { type: "object", default: { $dynamicRef: "#n" } },
      b: { $ref: "#/properties/a/default" }
    }, { $defs: { N: { $dynamicAnchor: "n", type } } }));
    expect(classify(tool("string"), tool("integer")).impact).not.toBe("compatible");
  });

  it("follows a pointer to the root when only the root declares $id", () => {
    const tool = (type: string) => input(object({ child: { type: "object", properties: { self: { $ref: "#" } } }, n: { type } }, { $id: "https://example.test/tool.json" }));
    expect(classify(tool("integer"), tool("number"))).toEqual({ impact: "compatible", reasons: [] });
    expect(classify(tool("number"), tool("integer"))).toEqual({ impact: "breaking", reasons: ["input-property-type-narrowed"] });
  });

  it("percent-decodes the whole fragment before splitting it into pointer tokens", () => {
    // RFC 6901 section 6: "#/$defs/a%2Fb" is the pointer "/$defs/a/b", which reaches $defs.a.b.
    const tool = (values: string[]) => input(object({ x: { $ref: "#/$defs/a%2Fb" } }, {
      $defs: { "a/b": { enum: ["x", "y"] }, a: { b: { enum: values } } }
    }));
    expect(classify(tool(["x", "y"]), tool(["x"]))).toEqual({ impact: "breaking", reasons: ["input-property-enum-narrowed"] });
  });

  it("treats OpenAPI example values as data", () => {
    const tool = (type: string) => input(object({ a: { $ref: "#/$defs/A" }, b: { type: "string", example: { id: "123" } } }, { $defs: { A: { type } } }));
    expect(classify(tool("integer"), tool("number"))).toEqual({ impact: "compatible", reasons: [] });
  });

  it("reports a schema that exceeds the comparison budget as unclassified", () => {
    const properties = (type: string) => Object.fromEntries(Array.from({ length: 10_001 }, (_, index) => [`p${index}`, { type }]));
    expect(classify(input(object(properties("integer"))), input(object(properties("number"))))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
  });

  it("checks a large shared definition once per pointer instead of once per property", () => {
    const big = object(Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`f${index}`, { type: "string", description: "x".repeat(20) }])));
    const tool = (type: string) => input(object({
      ...Object.fromEntries(Array.from({ length: 2_000 }, (_, index) => [`p${index}`, { not: { $ref: "#/$defs/Big" } }])),
      changed: { type }
    }, { $defs: { Big: big } }));
    const started = performance.now();
    expect(classify(tool("integer"), tool("number"))).toEqual({ impact: "compatible", reasons: [] });
    expect(performance.now() - started).toBeLessThan(5_000);
  });

  it("treats a nested draft-04 id as a separate resource", () => {
    const tool = (values: string[]) => input(object({ a: { $ref: "#/definitions/A" } }, {
      definitions: { A: { enum: values }, B: { id: "http://example.test/b.json", type: "string" } }
    }));
    expect(classify(tool(["x", "y"]), tool(["x"]))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
  });

  it("handles very large arrays without exhausting the call stack", () => {
    const big = Array.from({ length: 200_000 }, (_, index) => ({ const: index }));
    expect(classify(
      input(object({ a: { anyOf: big }, b: { type: "integer" } })),
      input(object({ a: { anyOf: big }, b: { type: "number" } }))
    )).toEqual({ impact: "compatible", reasons: [] });
  });

  it("ignores reference-like keys inside enum, const, and example values", () => {
    const values = { enum: [{ $ref: "#/$defs/Missing" }, { $id: "x" }], examples: [{ $ref: "#/nowhere" }] };
    expect(classify(
      input(object({ a: { ...values }, b: { $ref: "#/$defs/B" } }, { $defs: { B: { type: "integer" } } })),
      input(object({ a: { ...values }, b: { $ref: "#/$defs/B" } }, { $defs: { B: { type: "number" } } }))
    )).toEqual({ impact: "compatible", reasons: [] });
  });

  describe("composition wrappers", () => {
    const prop = (schema: Definition, defs: Definition = {}) => input(object({ a: schema }, Object.keys(defs).length > 0 ? { $defs: defs } : {}));
    const outputProp = (schema: Definition, defs: Definition = {}) => output(object({ a: schema }, Object.keys(defs).length > 0 ? { $defs: defs } : {}));
    const optional = (schema: Definition) => ({ anyOf: [schema, { type: "null" }], default: null });
    const model = (properties: Definition, extra: Definition = {}) => ({ Model: object(properties, extra) });

    it.each([
      ["optional model widened inside", prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "integer" } })), prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "number" } }))],
      ["optional model gained an optional field", prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "string" } })), prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "string" }, y: { type: "string" } }))],
      ["input made nullable", prop({ type: "string" }), prop(optional({ type: "string" }))],
      ["input alternative added", prop({ anyOf: [{ type: "string" }, { type: "integer" }] }), prop({ anyOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }] })],
      ["alternatives reordered", prop({ anyOf: [{ type: "string" }, { type: "integer" }] }), prop({ anyOf: [{ type: "integer" }, { type: "string" }] })],
      ["output alternative removed", outputProp({ anyOf: [{ type: "string" }, { type: "null" }] }), outputProp({ type: "string" })],
      ["optional enum widened", prop(optional({ enum: ["a"] })), prop(optional({ enum: ["a", "b"] }))],
      ["single allOf wrapper widened", prop({ allOf: [{ $ref: "#/$defs/A" }], description: "A" }, { A: { type: "integer" } }), prop({ allOf: [{ $ref: "#/$defs/A" }], description: "A" }, { A: { type: "number" } })],
      ["single allOf wrapper removed", prop({ allOf: [{ type: "string" }], description: "A" }), prop({ type: "string", description: "A" })]
    ])("classifies %s as compatible", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
    });

    it.each([
      ["optional model lost a field", prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "string" } })), prop(optional({ $ref: "#/$defs/Model" }), model({})), "input-property-removed"],
      ["optional model field became required", prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "string" } })), prop(optional({ $ref: "#/$defs/Model" }), model({ x: { type: "string" } }, { required: ["x"] })), "input-required-added"],
      ["input no longer nullable", prop(optional({ type: "string" })), prop({ type: "string" }), "input-property-type-narrowed"],
      ["input alternative removed", prop({ anyOf: [{ type: "string" }, { type: "integer" }] }), prop({ anyOf: [{ type: "string" }] }), "input-property-type-narrowed"],
      ["optional enum narrowed", prop(optional({ enum: ["a", "b"] })), prop(optional({ enum: ["a"] })), "input-property-enum-narrowed"],
      ["output made nullable", outputProp({ type: "string" }), outputProp(optional({ type: "string" })), "output-property-type-widened"],
      ["single allOf wrapper narrowed", prop({ allOf: [{ type: "number" }] }), prop({ allOf: [{ type: "integer" }] }), "input-property-type-narrowed"],
      ["retargeted optional reference narrowed", prop(optional({ $ref: "#/$defs/A" }), { A: { type: "number" }, B: { type: "integer" } }), prop(optional({ $ref: "#/$defs/B" }), { A: { type: "number" }, B: { type: "integer" } }), "input-property-type-narrowed"]
    ])("classifies %s as breaking", (_label, before, after, reason) => {
      expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
    });

    it.each([
      ["alternatives that cannot be paired", prop({ anyOf: [{ type: "string" }, { type: "integer" }] }), prop({ anyOf: [{ minLength: 1 }, { maximum: 3 }] })],
      ["oneOf changed", prop({ oneOf: [{ type: "string" }, { type: "integer" }] }), prop({ oneOf: [{ type: "string" }, { type: "integer" }, { type: "boolean" }] })],
      ["anyOf beside a validating keyword", prop({ type: "string", anyOf: [{ minLength: 1 }] }), prop({ type: "string", anyOf: [{ minLength: 2 }] })],
      ["allOf with two subschemas", prop({ allOf: [{ type: "string" }, { minLength: 1 }] }), prop({ allOf: [{ type: "string" }, { minLength: 2 }] })]
    ])("classifies %s as unclassified", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });
  });

  describe("discriminated oneOf", () => {
    // The shape Pydantic emits for a discriminated union of models.
    const pet = (kind: string, properties: Definition = {}) => object({ pet_type: { const: kind, type: "string" }, ...properties }, { required: ["pet_type"] });
    const union = (names: string[]) => ({
      oneOf: names.map((name) => ({ $ref: `#/$defs/${name}` })),
      discriminator: { propertyName: "pet_type", mapping: Object.fromEntries(names.map((name) => [name.toLowerCase(), `#/$defs/${name}`])) }
    });
    const tool = (names: string[], defs: Definition) => input(object({ pet: union(names) }, { $defs: defs }));
    const outputTool = (names: string[], defs: Definition) => output(object({ pet: union(names) }, { $defs: defs }));
    const pets = { Cat: pet("cat", { lives: { type: "integer" } }), Dog: pet("dog") };

    it.each([
      ["alternative added", tool(["Cat"], pets), tool(["Cat", "Dog"], pets)],
      ["alternative widened inside", tool(["Cat", "Dog"], pets), tool(["Cat", "Dog"], { ...pets, Cat: pet("cat", { lives: { type: "number" } }) })],
      ["alternatives reordered", tool(["Cat", "Dog"], pets), tool(["Dog", "Cat"], pets)],
      ["mapping changed only", input(object({ pet: { ...union(["Cat", "Dog"]), discriminator: { propertyName: "pet_type" } } }, { $defs: pets })), tool(["Cat", "Dog"], pets)],
      ["definitions renamed but paired by discriminator", tool(["Cat", "Dog"], pets), input(object({ pet: { oneOf: [{ $ref: "#/$defs/Feline" }, { $ref: "#/$defs/Canine" }], discriminator: { propertyName: "pet_type" } } }, { $defs: { Feline: pets.Cat, Canine: pets.Dog } }))]
    ])("classifies an input union with an %s as compatible", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
    });

    it.each([
      ["alternative removed", tool(["Cat", "Dog"], pets), tool(["Cat"], pets), "input-property-type-narrowed"],
      ["field removed inside an alternative", tool(["Cat", "Dog"], pets), tool(["Cat", "Dog"], { ...pets, Cat: pet("cat") }), "input-property-removed"],
      ["discriminator value changed", tool(["Cat", "Dog"], pets), tool(["Cat", "Dog"], { ...pets, Dog: pet("hound") }), "input-property-enum-narrowed"]
    ])("classifies an input union with an %s as breaking", (_label, before, after, reason) => {
      expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
    });

    it("classifies an output union with an added alternative as breaking", () => {
      expect(classify(outputTool(["Cat"], pets), outputTool(["Cat", "Dog"], pets))).toEqual({ impact: "breaking", reasons: ["output-property-type-widened"] });
    });

    it.each([
      ["a repeated discriminator value", { Cat: pet("cat"), Dog: pet("cat") }],
      ["an alternative that does not require the discriminator", { Cat: pet("cat"), Dog: object({ pet_type: { const: "dog", type: "string" } }) }],
      ["an alternative that is not an object", { Cat: pet("cat"), Dog: { type: "string" } }],
      ["an alternative without a constant discriminator", { Cat: pet("cat"), Dog: object({ pet_type: { type: "string" } }, { required: ["pet_type"] }) }]
    ])("keeps a changed union unclassified when alternatives may overlap: %s", (_label, defs) => {
      expect(classify(tool(["Cat"], defs), tool(["Cat", "Dog"], defs))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    describe("made nullable or no longer nullable", () => {
      const nullable = (schema: Definition) => ({ anyOf: [schema, { type: "null" }], default: null });
      const ref = { $ref: "#/$defs/Pet" };
      const withPet = (property: Definition) => input(object({ pet: property }, { $defs: { ...pets, Pet: union(["Cat", "Dog"]) } }));
      const outputWithPet = (property: Definition) => output(object({ pet: property }, { $defs: { ...pets, Pet: union(["Cat", "Dog"]) } }));
      const inline = (property: (schema: Definition) => Definition) => input(object({ pet: property(union(["Cat", "Dog"])) }, { $defs: pets }));

      it("classifies an input union made nullable as compatible", () => {
        expect(classify(withPet(ref), withPet(nullable(ref)))).toEqual({ impact: "compatible", reasons: [] });
        expect(classify(inline((schema) => schema), inline(nullable))).toEqual({ impact: "compatible", reasons: [] });
      });

      it("classifies an input union no longer nullable as breaking", () => {
        expect(classify(withPet(nullable(ref)), withPet(ref))).toEqual({ impact: "breaking", reasons: ["input-property-type-narrowed"] });
      });

      it("classifies an output union made nullable as breaking and no longer nullable as compatible", () => {
        expect(classify(outputWithPet(ref), outputWithPet(nullable(ref)))).toEqual({ impact: "breaking", reasons: ["output-property-type-widened"] });
        expect(classify(outputWithPet(nullable(ref)), outputWithPet(ref))).toEqual({ impact: "compatible", reasons: [] });
      });

      it("compares a nullable union whose members changed", () => {
        const before = input(object({ pet: nullable(ref) }, { $defs: { ...pets, Pet: union(["Cat"]) } }));
        expect(classify(before, withPet(nullable(ref)))).toEqual({ impact: "compatible", reasons: [] });
      });
    });

    it("accepts a one-value enum as the discriminator value", () => {
      const enumPet = (kind: string) => object({ pet_type: { enum: [kind], type: "string" } }, { required: ["pet_type"] });
      expect(classify(tool(["Cat"], { Cat: enumPet("cat"), Dog: enumPet("dog") }), tool(["Cat", "Dog"], { Cat: enumPet("cat"), Dog: enumPet("dog") }))).toEqual({ impact: "compatible", reasons: [] });
    });

    it("classifies an output union with a dropped alternative as compatible", () => {
      expect(classify(outputTool(["Cat", "Dog"], pets), outputTool(["Cat"], pets))).toEqual({ impact: "compatible", reasons: [] });
    });

    it.each([
      ["a const that disagrees with an enum", { Cat: pet("cat"), Dog: object({ pet_type: { const: "dog", enum: ["cat"] } }, { required: ["pet_type"] }) }],
      ["a discriminator value beside a $ref", { Cat: pet("cat"), Dog: object({ pet_type: { $ref: "#/$defs/Kind", const: "dog" } }, { required: ["pet_type"] }), Kind: { type: "string" } }]
    ])("keeps a changed union unclassified for %s", (_label, defs) => {
      expect(classify(tool(["Cat"], defs), tool(["Cat", "Dog"], defs))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    it("keeps a changed union unclassified when the discriminator has unknown keys or too many alternatives", () => {
      const strange = (names: string[]) => input(object({ pet: { ...union(names), discriminator: { propertyName: "pet_type", extra: true } } }, { $defs: pets }));
      expect(classify(strange(["Cat"]), strange(["Cat", "Dog"]))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
      const many = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`P${index}`, pet(`p${index}`)]));
      const names = Object.keys(many);
      expect(classify(tool(names.slice(0, 32), many), tool(names, many))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    it("refuses discriminator constants under a draft-04 dialect", () => {
      const draft04 = (names: string[]) => input(object({ pet: union(names) }, { $schema: "http://json-schema.org/draft-04/schema#", $defs: pets }));
      expect(classify(draft04(["Cat"]), draft04(["Cat", "Dog"]))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    it("keeps a union unclassified when the discriminator property changes", () => {
      const renamed = input(object({ pet: { ...union(["Cat", "Dog"]), discriminator: { propertyName: "kind" } } }, { $defs: pets }));
      expect(classify(tool(["Cat", "Dog"], pets), renamed).impact).toBe("unclassified");
    });
  });

  describe("composition edge cases", () => {
    const prop = (schema: Definition, defs: Definition = {}) => input(object({ a: schema }, Object.keys(defs).length > 0 ? { $defs: defs } : {}));

    it("reports a definition that becomes a reference to itself through a wrapper as unclassified", () => {
      for (const wrapper of ["allOf", "anyOf"]) {
        expect(classify(prop({ $ref: "#/$defs/A" }, { A: { type: "string" } }), prop({ $ref: "#/$defs/A" }, { A: { [wrapper]: [{ $ref: "#/$defs/A" }] } })).impact).toBe("unclassified");
      }
    });

    it("reports an allOf wrapper around a non-schema value as unclassified", () => {
      expect(classify(prop({ allOf: [null] }), prop({ type: "string" }))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    it("stops at the wrapper limit for deeply nested wrappers without exhausting the stack", () => {
      const nest = (levels: number, leaf: Definition): Definition => {
        let schema = leaf;
        for (let level = 0; level < levels; level += 1) schema = { allOf: [schema] };
        return schema;
      };
      // node:util isDeepStrictEqual recurses per level, so this case compares serialized JSON instead.
      const before = prop(nest(2_000, { type: "number" }));
      const after = prop(nest(2_000, { type: "integer" }));
      expect(classifyChangedTool(before, after, ["inputSchema"], (left, right) => JSON.stringify(left) === JSON.stringify(right)))
        .toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
      expect(classify(prop(nest(8, { type: "number" })), prop(nest(8, { type: "integer" })))).toEqual({ impact: "breaking", reasons: ["input-property-type-narrowed"] });
    });

    it("allows 16 wrappers along a path and reports a 17th as unclassified", () => {
      const nest = (levels: number, leaf: Definition): Definition => {
        let schema = leaf;
        for (let level = 0; level < levels; level += 1) schema = { allOf: [schema] };
        return schema;
      };
      expect(classify(prop(nest(16, { type: "number" })), prop(nest(16, { type: "integer" })))).toEqual({ impact: "breaking", reasons: ["input-property-type-narrowed"] });
      expect(classify(prop(nest(17, { type: "number" })), prop(nest(17, { type: "integer" })))).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    describe("a model reference made optional or required", () => {
      const model = (properties: Definition) => ({ Model: object(properties) });
      const bare = { $ref: "#/$defs/Model" };
      const optional = { anyOf: [{ $ref: "#/$defs/Model" }, { type: "null" }], default: null };
      const wrapped = { allOf: [{ $ref: "#/$defs/Model" }], description: "Model" };
      const unchanged = model({ x: { type: "string" } });

      it.each([
        ["made optional", prop(bare, unchanged), prop(optional, unchanged)],
        ["made optional from an allOf wrapper", prop(wrapped, unchanged), prop(optional, unchanged)],
        ["made optional while widening the model", prop(bare, model({ x: { type: "integer" } })), prop(optional, model({ x: { type: "number" } }))]
      ])("classifies an input reference %s as compatible", (_label, before, after) => {
        expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
      });

      it("classifies an input reference made required as breaking", () => {
        expect(classify(prop(optional, unchanged), prop(bare, unchanged))).toEqual({ impact: "breaking", reasons: ["input-property-type-narrowed"] });
      });

      it("compares a reference with an inline optional copy of its definition", () => {
        const inlineOptional = { anyOf: [object({ x: { type: "string" } }), { type: "null" }] };
        expect(classify(prop(bare, unchanged), prop(inlineOptional, unchanged))).toEqual({ impact: "compatible", reasons: [] });
        expect(classify(prop({ anyOf: [{ type: "string" }, { type: "null" }] }), prop({ $ref: "#/$defs/S" }, { S: { type: "string" } }))).toEqual({ impact: "breaking", reasons: ["input-property-type-narrowed"] });
      });

      it("classifies an output reference made optional as breaking", () => {
        expect(classify(output(object({ a: bare }, { $defs: unchanged })), output(object({ a: optional }, { $defs: unchanged })))).toEqual({ impact: "breaking", reasons: ["output-property-type-widened"] });
      });
    });

    it("uses root reason codes for root alternatives", () => {
      expect(classify(input({ anyOf: [{ type: "object" }, { type: "null" }] }), input({ type: "object" }))).toEqual({ impact: "breaking", reasons: ["input-type-narrowed"] });
      expect(classify(output({ type: "object" }), output({ anyOf: [{ type: "object" }, { type: "null" }] }))).toEqual({ impact: "breaking", reasons: ["output-type-widened"] });
    });

    it.each([
      ["more than 32 alternatives", prop({ anyOf: Array.from({ length: 33 }, (_, index) => ({ const: index })) }), prop({ anyOf: Array.from({ length: 33 }, (_, index) => ({ const: index + 1 })) })],
      ["two leftovers against one", prop({ anyOf: [{ minLength: 1 }, { maxLength: 9 }] }), prop({ anyOf: [{ minLength: 2 }] })]
    ])("reports %s as unclassified", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });

    it("pairs alternatives inside nested anyOf", () => {
      const nested = (values: string[]) => prop({ anyOf: [{ anyOf: [{ enum: values }, { type: "integer" }] }, { type: "null" }] });
      expect(classify(nested(["a"]), nested(["a", "b"]))).toEqual({ impact: "compatible", reasons: [] });
      expect(classify(nested(["a", "b"]), nested(["a"]))).toEqual({ impact: "breaking", reasons: ["input-property-enum-narrowed"] });
    });
  });

  describe("exclusive bounds, multipleOf, and uniqueItems", () => {
    const prop = (schema: Definition) => input(object({ a: schema }));
    const outputProp = (schema: Definition) => output(object({ a: schema }));

    it.each([
      ["exclusive minimum lowered", prop({ type: "number", exclusiveMinimum: 5 }), prop({ type: "number", exclusiveMinimum: 1 })],
      ["exclusive minimum made inclusive at the same value", prop({ type: "number", exclusiveMinimum: 0 }), prop({ type: "number", minimum: 0 })],
      ["exclusive maximum removed", prop({ type: "number", exclusiveMaximum: 10 }), prop({ type: "number" })],
      ["multipleOf relaxed to a divisor", prop({ type: "integer", multipleOf: 6 }), prop({ type: "integer", multipleOf: 3 })],
      ["draft-04 boolean exclusive minimum turned off", prop({ type: "number", minimum: 0, exclusiveMinimum: true }), prop({ type: "number", minimum: 0, exclusiveMinimum: false })],
      ["unchanged invalid multipleOf beside a widened enum", prop({ type: "number", multipleOf: 0, enum: [1] }), prop({ type: "number", multipleOf: 0, enum: [1, 2] })],
      ["unchanged non-boolean uniqueItems beside a widened enum", prop({ type: "array", uniqueItems: "yes", enum: [[1]] }), prop({ type: "array", uniqueItems: "yes", enum: [[1], [2]] })],
      ["unchanged draft-04 exclusive minimum beside a widened enum", prop({ type: "number", minimum: 0, exclusiveMinimum: true, enum: [1] }), prop({ type: "number", minimum: 0, exclusiveMinimum: true, enum: [1, 2] })],
      ["multipleOf removed", prop({ type: "integer", multipleOf: 2 }), prop({ type: "integer" })],
      ["uniqueItems removed", prop({ type: "array", uniqueItems: true }), prop({ type: "array" })],
      ["output uniqueItems introduced", outputProp({ type: "array" }), outputProp({ type: "array", uniqueItems: true })],
      ["output exclusive maximum tightened", outputProp({ type: "number", maximum: 10 }), outputProp({ type: "number", exclusiveMaximum: 10 })]
    ])("classifies %s as compatible", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
    });

    it.each([
      ["exclusive minimum introduced", prop({ type: "number" }), prop({ type: "number", exclusiveMinimum: 0 }), "input-constraint-tightened"],
      ["minimum made exclusive at the same value", prop({ type: "number", minimum: 0 }), prop({ type: "number", exclusiveMinimum: 0 }), "input-constraint-tightened"],
      ["exclusive maximum lowered", prop({ type: "number", exclusiveMaximum: 10 }), prop({ type: "number", exclusiveMaximum: 5 }), "input-constraint-tightened"],
      ["multipleOf introduced", prop({ type: "integer" }), prop({ type: "integer", multipleOf: 2 }), "input-constraint-tightened"],
      ["multipleOf changed to a non-divisor", prop({ type: "integer", multipleOf: 2 }), prop({ type: "integer", multipleOf: 3 }), "input-constraint-tightened"],
      ["multipleOf changed to a multiple of the old value", prop({ type: "integer", multipleOf: 2 }), prop({ type: "integer", multipleOf: 4 }), "input-constraint-tightened"],
      ["draft-04 boolean exclusive minimum turned on", prop({ type: "number", minimum: 0, exclusiveMinimum: false }), prop({ type: "number", minimum: 0, exclusiveMinimum: true }), "input-constraint-tightened"],
      ["minimum raised beside an unchanged draft-04 exclusive minimum", prop({ type: "number", minimum: 0, exclusiveMinimum: true }), prop({ type: "number", minimum: 5, exclusiveMinimum: true }), "input-constraint-tightened"],
      ["uniqueItems introduced", prop({ type: "array" }), prop({ type: "array", uniqueItems: true }), "input-constraint-tightened"],
      ["output exclusive minimum removed", outputProp({ type: "number", exclusiveMinimum: 0 }), outputProp({ type: "number" }), "output-constraint-loosened"],
      ["output uniqueItems removed", outputProp({ type: "array", uniqueItems: true }), outputProp({ type: "array" }), "output-constraint-loosened"]
    ])("classifies %s as breaking", (_label, before, after, reason) => {
      expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
    });

    it.each([
      ["non-positive multipleOf", prop({ type: "number", multipleOf: 2 }), prop({ type: "number", multipleOf: 0 })],
      ["draft-04 boolean exclusive bound without its inclusive keyword", prop({ type: "number" }), prop({ type: "number", exclusiveMaximum: true })],
      ["fractional multipleOf changed", prop({ type: "number", multipleOf: 0.3 }), prop({ type: "number", multipleOf: 0.1 })],
      ["non-boolean uniqueItems", prop({ type: "array" }), prop({ type: "array", uniqueItems: "yes" })]
    ])("classifies %s as unclassified", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });
  });

  describe("pattern, format, and const", () => {
    const prop = (schema: Definition) => input(object({ a: schema }));
    const outputProp = (schema: Definition) => output(object({ a: schema }));

    it.each([
      ["input pattern removed", prop({ type: "string", pattern: "^x" }), prop({ type: "string" })],
      ["input format removed", prop({ type: "string", format: "email" }), prop({ type: "string" })],
      ["input const removed", prop({ type: "string", const: "x" }), prop({ type: "string" })],
      ["input const widened to an enum", prop({ const: "x" }), prop({ enum: ["x", "y"] })],
      ["input const unchanged beside an enum", prop({ const: "x", enum: ["x", "y"] }), prop({ const: "x", enum: ["x", "y", "z"] })],
      ["output pattern introduced", outputProp({ type: "string" }), outputProp({ type: "string", pattern: "^x" })],
      ["output format introduced", outputProp({ type: "string" }), outputProp({ type: "string", format: "uri" })],
      ["output enum narrowed to a const", outputProp({ enum: ["x", "y"] }), outputProp({ const: "x" })]
    ])("classifies %s as compatible", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
    });

    it.each([
      ["input pattern introduced", prop({ type: "string" }), prop({ type: "string", pattern: "^x" }), "input-constraint-tightened"],
      ["input format introduced", prop({ type: "string" }), prop({ type: "string", format: "date-time" }), "input-constraint-tightened"],
      ["input const introduced", prop({ type: "string" }), prop({ type: "string", const: "x" }), "input-property-enum-narrowed"],
      ["input const changed", prop({ const: "x" }), prop({ const: "y" }), "input-property-enum-narrowed"],
      ["input enum narrowed to a const", prop({ enum: ["x", "y"] }), prop({ const: "x" }), "input-property-enum-narrowed"],
      ["output pattern removed", outputProp({ type: "string", pattern: "^x" }), outputProp({ type: "string" }), "output-constraint-loosened"],
      ["output format removed", outputProp({ type: "string", format: "uri" }), outputProp({ type: "string" }), "output-constraint-loosened"],
      ["output const removed", outputProp({ type: "string", const: "x" }), outputProp({ type: "string" }), "output-property-enum-widened"]
    ])("classifies %s as breaking", (_label, before, after, reason) => {
      expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
    });

    it.each([
      ["input pattern changed", prop({ type: "string", pattern: "^x" }), prop({ type: "string", pattern: "^y" })],
      ["input format changed", prop({ type: "string", format: "email" }), prop({ type: "string", format: "uri" })],
      ["input non-string pattern", prop({ type: "string", pattern: "^x" }), prop({ type: "string", pattern: 1 })]
    ])("classifies %s as unclassified", (_label, before, after) => {
      expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: ["input-schema-unclassified"] });
    });
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
