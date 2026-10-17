import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";

import {
  classifyAddedPrompt,
  classifyChangedPrompt,
  classifyRemovedPrompt,
  PROMPT_CHANGE_REASONS
} from "../src/core/mcp-prompt-impact.js";

type Definition = Record<string, unknown>;

const FIELDS = ["arguments", "description", "title", "other"] as const;

function changedFields(before: Definition, after: Definition): string[] {
  return FIELDS.filter((field) => field === "other"
    ? !isDeepStrictEqual(rest(before), rest(after))
    : !isDeepStrictEqual(before[field], after[field]));
}

function rest(definition: Definition): Definition {
  return Object.fromEntries(Object.entries(definition).filter(([key]) => key !== "name" && !(FIELDS as readonly string[]).includes(key)));
}

function classify(before: Definition, after: Definition) {
  return classifyChangedPrompt(before, after, changedFields(before, after), isDeepStrictEqual);
}

function locate(before: Definition, after: Definition) {
  return classifyChangedPrompt(before, after, changedFields(before, after), isDeepStrictEqual, { locate: true });
}

const prompt = (...args: Definition[]): Definition => ({ name: "prompt", arguments: args });
const arg = (name: string, extra: Definition = {}): Definition => ({ name, ...extra });

describe("prompt change impact classification", () => {
  it("treats removals as breaking and additions as compatible", () => {
    expect(classifyRemovedPrompt()).toEqual({ impact: "breaking", reasons: ["prompt-removed"] });
    expect(classifyAddedPrompt()).toEqual({ impact: "compatible", reasons: [] });
  });

  it.each([
    ["title only", { name: "prompt", title: "a" }, { name: "prompt", title: "b" }],
    ["description only", { name: "prompt", description: "a" }, { name: "prompt", description: "b" }],
    ["argument title and description", prompt(arg("code", { title: "a", description: "a" })), prompt(arg("code", { title: "b", description: "b" }))],
    ["argument order", prompt(arg("a"), arg("b", { required: true })), prompt(arg("b", { required: true }), arg("a"))],
    ["optional argument added", prompt(arg("a")), prompt(arg("a"), arg("b"))],
    ["argument added as explicitly optional", prompt(), prompt(arg("b", { required: false }))],
    ["requirement relaxed", prompt(arg("a", { required: true })), prompt(arg("a", { required: false }))],
    ["requirement dropped", prompt(arg("a", { required: true })), prompt(arg("a"))],
    ["optional spelled differently", prompt(arg("a", { required: false })), prompt(arg("a"))],
    ["missing arguments became an empty list", { name: "prompt" }, prompt()],
    ["empty list became missing arguments", prompt(), { name: "prompt" }]
  ])("classifies a %s change as compatible", (_name, before, after) => {
    expect(classify(before, after)).toEqual({ impact: "compatible", reasons: [] });
  });

  it.each([
    ["an argument removed", prompt(arg("a"), arg("b")), prompt(arg("a")), "prompt-argument-removed"],
    ["every argument removed", prompt(arg("a")), { name: "prompt" }, "prompt-argument-removed"],
    ["a required argument added", prompt(arg("a")), prompt(arg("a"), arg("b", { required: true })), "prompt-required-argument-added"],
    ["a required argument added to a prompt without arguments", { name: "prompt" }, prompt(arg("b", { required: true })), "prompt-required-argument-added"],
    ["an optional argument now required", prompt(arg("a")), prompt(arg("a", { required: true })), "prompt-argument-now-required"],
    ["an explicitly optional argument now required", prompt(arg("a", { required: false })), prompt(arg("a", { required: true })), "prompt-argument-now-required"]
  ])("classifies %s as breaking", (_name, before, after, reason) => {
    expect(classify(before, after)).toEqual({ impact: "breaking", reasons: [reason] });
  });

  it.each([
    ["argument metadata", prompt(arg("a", { _meta: { v: 1 } })), prompt(arg("a", { _meta: { v: 2 } })), "prompt-argument-fields-unclassified"],
    ["an argument field added", prompt(arg("a")), prompt(arg("a", { enum: ["x"] })), "prompt-argument-fields-unclassified"],
    ["prompt icons", { name: "prompt", icons: [{ src: "a.svg" }] }, { name: "prompt", icons: [{ src: "b.svg" }] }, "other-fields-unclassified"],
    ["prompt metadata", { name: "prompt", _meta: { v: 1 } }, { name: "prompt" }, "other-fields-unclassified"]
  ])("classifies a %s change as unclassified", (_name, before, after, reason) => {
    expect(classify(before, after)).toEqual({ impact: "unclassified", reasons: [reason] });
  });

  it("orders deduplicated reasons by the published reason order and lets breaking reasons win", () => {
    const before = { name: "prompt", icons: [], arguments: [arg("gone"), arg("also_gone"), arg("tightened"), arg("meta", { _meta: 1 })] };
    const after = { name: "prompt", icons: [{ src: "x" }], arguments: [arg("meta", { _meta: 2 }), arg("tightened", { required: true }), arg("new", { required: true })] };
    expect(classify(before, after)).toEqual({
      impact: "breaking",
      reasons: [
        "prompt-argument-removed",
        "prompt-required-argument-added",
        "prompt-argument-now-required",
        "prompt-argument-fields-unclassified",
        "other-fields-unclassified"
      ]
    });
    expect(classify({ name: "prompt", icons: [], arguments: [arg("a", { x: 1 })] }, { name: "prompt", icons: [1], arguments: [arg("a", { x: 2 })] }))
      .toEqual({ impact: "unclassified", reasons: ["prompt-argument-fields-unclassified", "other-fields-unclassified"] });
  });

  it("covers every published reason", () => {
    const seen = new Set<string>(classifyRemovedPrompt().reasons);
    const before = { name: "prompt", icons: [], arguments: [arg("gone"), arg("tightened"), arg("meta", { _meta: 1 })] };
    const after = { name: "prompt", icons: [1], arguments: [arg("meta", { _meta: 2 }), arg("tightened", { required: true }), arg("new", { required: true })] };
    for (const reason of classify(before, after).reasons) seen.add(reason);
    expect([...seen].sort()).toEqual([...PROMPT_CHANGE_REASONS].sort());
  });

  it("treats arguments that cannot be matched by name as unclassified", () => {
    expect(classify(prompt(arg("a")), { name: "prompt", arguments: {} })).toEqual({ impact: "unclassified", reasons: ["prompt-argument-fields-unclassified"] });
    expect(locate(prompt(arg("a"), arg("a")), prompt(arg("a"))).locations).toEqual([{ reason: "prompt-argument-fields-unclassified", argument: null }]);
  });

  it("classifies only the fields it is told changed", () => {
    expect(classifyChangedPrompt(prompt(arg("a")), prompt(), ["description"], isDeepStrictEqual)).toEqual({ impact: "compatible", reasons: [] });
  });

  describe("reason locations", () => {
    it("omits locations unless they are requested", () => {
      expect(classify(prompt(arg("a")), prompt())).not.toHaveProperty("locations");
      expect(locate({ name: "prompt", title: "a" }, { name: "prompt", title: "b" })).toEqual({ impact: "compatible", reasons: [], locations: [] });
    });

    it("names the argument of each reason in comparison order and locates prompt fields at the prompt", () => {
      const before = { name: "prompt", _meta: 1, arguments: [arg("z_gone"), arg("tightened"), arg("meta", { _meta: 1 })] };
      const after = { name: "prompt", _meta: 2, arguments: [arg("added", { required: true }), arg("meta", { _meta: 2 }), arg("tightened", { required: true }), arg("optional")] };
      expect(locate(before, after)).toEqual({
        impact: "breaking",
        reasons: ["prompt-argument-removed", "prompt-required-argument-added", "prompt-argument-now-required", "prompt-argument-fields-unclassified", "other-fields-unclassified"],
        locations: [
          { reason: "prompt-argument-removed", argument: "z_gone" },
          { reason: "prompt-argument-now-required", argument: "tightened" },
          { reason: "prompt-argument-fields-unclassified", argument: "meta" },
          { reason: "prompt-required-argument-added", argument: "added" },
          { reason: "other-fields-unclassified", argument: null }
        ]
      });
    });

    it("keeps prototype-like argument names as plain names", () => {
      expect(locate(prompt(arg("__proto__"), arg("constructor")), prompt()).locations).toEqual([
        { reason: "prompt-argument-removed", argument: "__proto__" },
        { reason: "prompt-argument-removed", argument: "constructor" }
      ]);
    });

    it("lists at most 100 locations per prompt and still reports every reason", () => {
      const removed = Array.from({ length: 150 }, (_, index) => arg(`gone_${index}`));
      const classification = locate({ name: "prompt", icons: [], arguments: removed }, { name: "prompt", icons: [1], arguments: [] });
      expect(classification.reasons).toEqual(["prompt-argument-removed", "other-fields-unclassified"]);
      expect(classification.locations).toHaveLength(100);
      expect(classification.locations?.[99]).toEqual({ reason: "prompt-argument-removed", argument: "gone_99" });
    });
  });
});
