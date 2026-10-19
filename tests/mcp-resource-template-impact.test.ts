import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import {
  classifyAddedResourceTemplate,
  classifyChangedResourceTemplate,
  classifyRemovedResourceTemplate,
  MAX_RESOURCE_TEMPLATE_CHANGE_LOCATIONS,
  RESOURCE_TEMPLATE_CHANGE_REASONS
} from "../src/core/mcp-resource-template-impact.js";

type Definition = Record<string, unknown>;

const FIELDS = ["uriTemplate", "mimeType", "description", "title", "other"] as const;

function changedFields(before: Definition, after: Definition): string[] {
  return FIELDS.filter((field) => field === "other"
    ? !isDeepStrictEqual(rest(before), rest(after))
    : !isDeepStrictEqual(before[field], after[field]));
}

function rest(definition: Definition): Definition {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "name" && !(FIELDS as readonly string[]).includes(key)));
}

function classify(before: Definition, after: Definition) {
  return classifyChangedResourceTemplate(before, after, changedFields(before, after), isDeepStrictEqual);
}

function locate(before: Definition, after: Definition) {
  return classifyChangedResourceTemplate(before, after, changedFields(before, after), isDeepStrictEqual, { locate: true });
}

const template = (uriTemplate: string, extra: Definition = {}): Definition => ({ name: "files", uriTemplate, ...extra });

describe("resource template change impact classification", () => {
  it("treats removals as breaking and additions as compatible", () => {
    expect(classifyRemovedResourceTemplate()).toEqual({ impact: "breaking", reasons: ["resource-template-removed"] });
    expect(classifyAddedResourceTemplate()).toEqual({ impact: "compatible", reasons: [] });
  });

  it.each([
    ["title only", template("file:///{path}", { title: "a" }), template("file:///{path}", { title: "b" })],
    ["description only", template("file:///{path}", { description: "a" }), template("file:///{path}")],
    ["title and description", template("file:///{path}"), template("file:///{path}", { title: "b", description: "b" })]
  ])("classifies a %s change as compatible", (_name, before, after) => {
    expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
  });

  it.each([
    ["a variable removed from an expression", "x://{a,b}", "x://{a}", ["resource-template-variable-removed"]],
    ["a variable added to an expression", "x://{?a}", "x://{?a,b}", ["resource-template-variable-added"]],
    ["a renamed variable", "file:///{path}", "file:///{name}", ["resource-template-variable-removed", "resource-template-variable-added"]],
    ["a literal change", "file:///{path}", "file:///files/{path}", ["resource-template-uri-changed"]],
    ["an operator change", "file:///{path}", "file:///{+path}", ["resource-template-uri-changed"]],
    ["an expression split", "x://{?a,b}", "x://{?a}{&b}", ["resource-template-uri-changed"]],
    ["a variable order change across expressions", "x://{a}/{b}", "x://{b}/{a}", ["resource-template-uri-changed"]],
    ["a variable order change within an expression", "x://{?a,b}", "x://{?b,a}", ["resource-template-uri-changed"]],
    ["an explode modifier added", "x://{/path}", "x://{/path*}", ["resource-template-uri-changed"]],
    ["a prefix modifier changed", "x://{a:3}", "x://{a:4}", ["resource-template-uri-changed"]],
    ["a repeated variable dropped", "x://{a}/{a}", "x://{a}", ["resource-template-uri-changed"]],
    ["a variable removed with its expression", "x://{a}/{b}", "x://{a}", ["resource-template-uri-changed", "resource-template-variable-removed"]],
    ["a variable added with a new expression", "x://{a}", "x://{a}{?b}", ["resource-template-uri-changed", "resource-template-variable-added"]]
  ])("classifies %s as breaking", (_name, before, after, reasons) => {
    expect(classify(template(before), template(after))).toEqual({ impact: "breaking", reasons });
  });

  it("treats a URI template that cannot be parsed as a URI change", () => {
    expect(classify(template("x://{a}"), template("x://{a"))).toEqual({ impact: "breaking", reasons: ["resource-template-uri-changed"] });
    expect(classify(template("x://{a}"), { name: "files" })).toEqual({ impact: "breaking", reasons: ["resource-template-uri-changed"] });
    expect(locate({ name: "files", uriTemplate: 7 }, template("x://{a}")).locations).toEqual([{ reason: "resource-template-uri-changed", variable: null }]);
  });

  it.each([
    ["mimeType added", template("x://{a}"), template("x://{a}", { mimeType: "text/plain" }), "resource-template-mime-type-changed"],
    ["mimeType removed", template("x://{a}", { mimeType: "text/plain" }), template("x://{a}"), "resource-template-mime-type-changed"],
    ["mimeType changed", template("x://{a}", { mimeType: "text/plain" }), template("x://{a}", { mimeType: "application/json" }), "resource-template-mime-type-changed"],
    ["icons", template("x://{a}", { icons: [{ src: "a.svg" }] }), template("x://{a}", { icons: [{ src: "b.svg" }] }), "other-fields-unclassified"],
    ["annotations", template("x://{a}", { annotations: { priority: 0.1 } }), template("x://{a}", { annotations: { priority: 0.9 } }), "other-fields-unclassified"],
    ["metadata", template("x://{a}", { _meta: { v: 1 } }), template("x://{a}"), "other-fields-unclassified"],
    ["an unknown field", template("x://{a}"), template("x://{a}", { extension: null }), "other-fields-unclassified"]
  ])("classifies a %s change as unclassified", (_name, before, after, reason) => {
    expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: [reason] });
  });

  it("orders deduplicated reasons by the published reason order and lets breaking reasons win", () => {
    expect(classify(
      template("x://{a}/{b}{?c}", { icons: [], mimeType: "text/plain", title: "a" }),
      template("x://{d}/{e}", { icons: [1], mimeType: "text/html", title: "b" })
    )).toEqual({
      impact: "breaking",
      reasons: [
        "resource-template-uri-changed",
        "resource-template-variable-removed",
        "resource-template-variable-added",
        "resource-template-mime-type-changed",
        "other-fields-unclassified"
      ]
    });
    expect(classify(template("x://{a}", { _meta: 1, description: "a" }), template("x://{a}", { _meta: 2, mimeType: "text/plain", description: "b" })))
      .toEqual({ impact: "unclassified", reasons: ["resource-template-mime-type-changed", "other-fields-unclassified"] });
  });

  it("covers every published reason", () => {
    const seen = new Set<string>(classifyRemovedResourceTemplate().reasons);
    for (const reason of classify(template("x://{a}{?b}", { icons: [] }), template("x://{a}/{c}", { icons: [1], mimeType: "text/plain" })).reasons) seen.add(reason);
    expect([...seen].sort()).toEqual([...RESOURCE_TEMPLATE_CHANGE_REASONS].sort());
  });

  it("classifies only the fields it is told changed", () => {
    expect(classifyChangedResourceTemplate(template("x://{a}"), template("y://{b}", { mimeType: "text/plain" }), ["description"], isDeepStrictEqual))
      .toEqual({ impact: "compatible", reasons: [] });
  });

  describe("reason locations", () => {
    it("omits locations unless they are requested", () => {
      expect(classify(template("x://{a}"), template("x://{b}"))).not.toHaveProperty("locations");
      expect(locate(template("x://{a}", { title: "a" }), template("x://{a}", { title: "b" }))).toEqual({ impact: "compatible", reasons: [], locations: [] });
    });

    it("names removed then added variables in template order and locates template fields at the template", () => {
      expect(locate(
        template("x://{z_gone}/{keep}/{a_gone}", { _meta: 1 }),
        template("x://{keep}{?y_new,b_new}", { _meta: 2, mimeType: "text/plain" })
      )).toEqual({
        impact: "breaking",
        reasons: [
          "resource-template-uri-changed",
          "resource-template-variable-removed",
          "resource-template-variable-added",
          "resource-template-mime-type-changed",
          "other-fields-unclassified"
        ],
        locations: [
          { reason: "resource-template-variable-removed", variable: "z_gone" },
          { reason: "resource-template-variable-removed", variable: "a_gone" },
          { reason: "resource-template-variable-added", variable: "y_new" },
          { reason: "resource-template-variable-added", variable: "b_new" },
          { reason: "resource-template-uri-changed", variable: null },
          { reason: "resource-template-mime-type-changed", variable: null },
          { reason: "other-fields-unclassified", variable: null }
        ]
      });
    });

    it("lists a repeated variable once and keeps prototype-like names as plain names", () => {
      expect(locate(template("x://{__proto__}/{constructor}/{__proto__}"), template("x://static")).locations).toEqual([
        { reason: "resource-template-variable-removed", variable: "__proto__" },
        { reason: "resource-template-variable-removed", variable: "constructor" },
        { reason: "resource-template-uri-changed", variable: null }
      ]);
    });

    it("lists at most 100 locations per template and still reports every reason", () => {
      const variables = Array.from({ length: 150 }, (_, index) => `v${index}`);
      const classification = locate(template(`x://{${variables.join(",")}}`, { icons: [] }), template("x://static", { icons: [1] }));
      expect(classification.reasons).toEqual(["resource-template-uri-changed", "resource-template-variable-removed", "other-fields-unclassified"]);
      expect(classification.locations).toHaveLength(MAX_RESOURCE_TEMPLATE_CHANGE_LOCATIONS);
      expect(classification.locations?.[99]).toEqual({ reason: "resource-template-variable-removed", variable: "v99" });
    });
  });
});
