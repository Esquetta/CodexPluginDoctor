import { describe, expect, it } from "vitest";

import {
  createMcpResourceTemplateCatalogInspector,
  inspectMcpResourceTemplateDefinition,
  parseUriTemplate
} from "../src/core/mcp-resource-template-definition.js";

const at = { page: 1, templateIndex: 2 };
const ids = (value: unknown) => inspectMcpResourceTemplateDefinition(value, at).map((finding) => finding.id);

describe("RFC 6570 URI template parsing", () => {
  it.each([
    ["file:///{path}", "file:///{}", ["path"]],
    ["https://api.example.com/users{/id}{?fields,page}", "https://api.example.com/users{/}{?}", ["id", "fields", "page"]],
    ["db://{+schema}/tables{/table*}{#section:3}", "db://{+}/tables{/}{#}", ["schema", "table", "section"]],
    ["repo://{owner.login}/{%20name}", "repo://{}/{}", ["owner.login", "%20name"]],
    ["dns://host{.domain}", "dns://host{.}", ["domain"]],
    ["static://readme", "static://readme", []]
  ])("parses %s", (template, skeleton, variables) => {
    expect(parseUriTemplate(template)).toEqual({ skeleton, variables });
  });

  it.each([
    "file:///{path", "file:///path}", "file:///{}", "file:///{{path}}", "file:///{pa th}", "file:///{path:0}",
    "file:///{path:10000}", "file:///{path**}", "file:///{path.}", "file:///{a..b}", "file:///{a,}", "file:// /{path}", "file:///{=path}"
  ])("rejects %s", (template) => {
    expect(parseUriTemplate(template)).toBeNull();
  });
});

describe("MCP resource template definition inspection", () => {
  it("accepts a template with optional display and type fields", () => {
    expect(inspectMcpResourceTemplateDefinition({
      uriTemplate: "file:///{path}", name: "project-files", title: "Project Files", description: "Files", mimeType: "text/plain",
      icons: [{ src: "https://example.com/icon.png" }], annotations: { audience: ["user"] }
    }, at)).toEqual([]);
  });

  it("rejects entries without an object, a name, or a valid uriTemplate", () => {
    expect(ids("x")).toEqual(["plugin.catalog.resource_template.invalid_object"]);
    expect(ids({ uriTemplate: "file:///{path}" })).toEqual(["plugin.catalog.resource_template.name.invalid"]);
    expect(ids({ name: "files" })).toEqual(["plugin.catalog.resource_template.uri_template.invalid"]);
    expect(ids({ name: "files", uriTemplate: "file:///{path" })).toEqual(["plugin.catalog.resource_template.uri_template.invalid"]);
  });

  it("rejects non-string title, description, and mimeType with the template location", () => {
    const findings = inspectMcpResourceTemplateDefinition({ name: "files", uriTemplate: "file:///{path}", title: 1, description: [], mimeType: null }, at);
    expect(findings.map((finding) => [finding.id, finding.severity, finding.location])).toEqual([
      ["plugin.catalog.resource_template.title.invalid", "fail", at],
      ["plugin.catalog.resource_template.description.invalid", "fail", at],
      ["plugin.catalog.resource_template.mime_type.invalid", "fail", at]
    ]);
  });
});

describe("MCP resource template catalog inspector", () => {
  it("collects templates across pages and warns about duplicate names with the earlier index", () => {
    const inspector = createMcpResourceTemplateCatalogInspector();
    const template = (name: string) => ({ name, uriTemplate: `file:///${name}/{path}` });
    expect(inspector.inspectPage([template("a"), template("b")], 1, () => false)).toBeNull();
    expect(inspector.inspectPage([template("a")], 2, () => false)).toBeNull();
    expect(inspector.templatesChecked).toBe(3);
    expect(inspector.findings.map((finding) => [finding.id, finding.severity, finding.location])).toEqual([
      ["plugin.catalog.resource_template.name.duplicate", "warn", { page: 2, templateIndex: 3, relatedTemplateIndex: 1 }]
    ]);
  });

  it("stops at 500 templates, 100 findings, or an expired time budget", () => {
    const many = createMcpResourceTemplateCatalogInspector();
    expect(many.inspectPage(Array.from({ length: 501 }, (_, index) => ({ name: `t${index}`, uriTemplate: "x://{y}" })), 1, () => false)).toBe("template-limit");
    expect(many.templatesChecked).toBe(500);

    const noisy = createMcpResourceTemplateCatalogInspector();
    expect(noisy.inspectPage(Array.from({ length: 101 }, () => ({ name: "n" })), 1, () => false)).toBe("finding-limit");
    expect(noisy.findings).toHaveLength(100);

    expect(createMcpResourceTemplateCatalogInspector().inspectPage([{ name: "a", uriTemplate: "x://{y}" }, { name: "b", uriTemplate: "x://{y}" }], 1, () => true)).toBe("total-time-limit");
  });
});
