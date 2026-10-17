import { describe, expect, it } from "vitest";

import { createMcpPromptCatalogInspector, inspectMcpPromptDefinition } from "../src/core/mcp-prompt-definition.js";

const at = { page: 1, promptIndex: 3 };
const ids = (value: unknown) => inspectMcpPromptDefinition(value, at).map((finding) => finding.id);

describe("MCP prompt definition inspection", () => {
  it("accepts a prompt with a title, description, and well-formed arguments", () => {
    expect(inspectMcpPromptDefinition({
      name: "code_review",
      title: "Request Code Review",
      description: "Asks for a review",
      arguments: [{ name: "code", description: "The code", required: true }, { name: "style", title: "Style" }],
      icons: [{ src: "https://example.com/icon.svg" }]
    }, at)).toEqual([]);
  });

  it("rejects entries that are not objects or have no usable name", () => {
    expect(ids([])).toEqual(["plugin.catalog.prompt.invalid_object"]);
    expect(ids({})).toEqual(["plugin.catalog.prompt.name.invalid"]);
    expect(ids({ name: "" })).toEqual(["plugin.catalog.prompt.name.invalid"]);
    expect(ids({ name: 1 })).toEqual(["plugin.catalog.prompt.name.invalid"]);
  });

  it("rejects non-string titles and descriptions", () => {
    expect(ids({ name: "p", title: 1, description: null })).toEqual(["plugin.catalog.prompt.title.invalid", "plugin.catalog.prompt.description.invalid"]);
  });

  it("locates argument problems by one-based argument index", () => {
    const findings = inspectMcpPromptDefinition({
      name: "p",
      arguments: ["x", { name: "" }, { name: "a", required: "yes", title: 2, description: false }, { name: "a" }]
    }, at);
    expect(findings.map((finding) => [finding.id, finding.severity, finding.location])).toEqual([
      ["plugin.catalog.prompt.argument.invalid_object", "fail", { page: 1, promptIndex: 3, argumentIndex: 1 }],
      ["plugin.catalog.prompt.argument.name.invalid", "fail", { page: 1, promptIndex: 3, argumentIndex: 2 }],
      ["plugin.catalog.prompt.argument.required.invalid", "fail", { page: 1, promptIndex: 3, argumentIndex: 3 }],
      ["plugin.catalog.prompt.argument.title.invalid", "fail", { page: 1, promptIndex: 3, argumentIndex: 3 }],
      ["plugin.catalog.prompt.argument.description.invalid", "fail", { page: 1, promptIndex: 3, argumentIndex: 3 }],
      ["plugin.catalog.prompt.argument.name.duplicate", "fail", { page: 1, promptIndex: 3, argumentIndex: 4, relatedArgumentIndex: 3 }]
    ]);
  });

  it("rejects arguments that are not an array", () => {
    expect(ids({ name: "p", arguments: {} })).toEqual(["plugin.catalog.prompt.arguments.invalid"]);
  });
});

describe("MCP prompt catalog inspector", () => {
  it("collects prompts across pages and warns about duplicate names with the earlier index", () => {
    const inspector = createMcpPromptCatalogInspector();
    expect(inspector.inspectPage([{ name: "a" }, { name: "b" }], 1, () => false)).toBeNull();
    expect(inspector.inspectPage([{ name: "a" }], 2, () => false)).toBeNull();
    expect(inspector.promptsChecked).toBe(3);
    expect(inspector.prompts).toEqual([{ name: "a" }, { name: "b" }, { name: "a" }]);
    expect(inspector.findings.map((finding) => [finding.id, finding.severity, finding.location])).toEqual([
      ["plugin.catalog.prompt.name.duplicate", "warn", { page: 2, promptIndex: 3, relatedPromptIndex: 1 }]
    ]);
  });

  it("stops at 500 prompts, 100 findings, or an expired time budget", () => {
    const many = createMcpPromptCatalogInspector();
    expect(many.inspectPage(Array.from({ length: 501 }, (_, index) => ({ name: `p${index}` })), 1, () => false)).toBe("prompt-limit");
    expect(many.promptsChecked).toBe(500);

    const noisy = createMcpPromptCatalogInspector();
    expect(noisy.inspectPage(Array.from({ length: 101 }, () => ({})), 1, () => false)).toBe("finding-limit");
    expect(noisy.findings).toHaveLength(100);

    expect(createMcpPromptCatalogInspector().inspectPage([{ name: "a" }, { name: "b" }], 1, () => true)).toBe("total-time-limit");
  });
});
