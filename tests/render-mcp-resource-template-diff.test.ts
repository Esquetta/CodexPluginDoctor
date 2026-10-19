import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareMcpResourceTemplateFiles, type McpResourceTemplateDiffReport } from "../src/core/mcp-resource-template-diff.js";
import { inspectMcpResourceTemplateFile, type McpResourceTemplateFileReport } from "../src/core/mcp-resource-template-file.js";
import { RESOURCE_TEMPLATE_CHANGE_REASONS } from "../src/core/mcp-resource-template-impact.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";
import { renderMcpResourceTemplateDiffMarkdown } from "../src/reporting/render-mcp-resource-template-diff-markdown.js";
import { renderMcpResourceTemplateDiffReport } from "../src/reporting/render-mcp-resource-template-diff-report.js";
import { renderMcpResourceTemplateFileReport } from "../src/reporting/render-mcp-resource-template-file-report.js";
import { violations } from "./helpers/json-schema-violations.js";

type Change = McpResourceTemplateDiffReport["changes"][number];

function fileReport(overrides: Partial<McpResourceTemplateFileReport> = {}): McpResourceTemplateFileReport {
  return {
    schemaVersion: 1,
    scope: "resource-template-definitions-file",
    status: "pass",
    source: { kind: "file", format: "mcp-resource-templates-list-response", bytesRead: 120 },
    inspection: { complete: true, templatesChecked: 2, hasNextCursor: false, reason: null },
    coverage: { definitions: "shape-only", discovery: "not-tested", serverCatalog: "not-tested", resourceRead: "not-tested", fullConformance: "not-tested" },
    findings: [],
    ...overrides
  };
}

function diffReport(changes: Change[], overrides: Partial<McpResourceTemplateDiffReport> = {}): McpResourceTemplateDiffReport {
  return {
    schemaVersion: 1,
    scope: "resource-template-definitions-diff",
    status: changes.length === 0 ? "pass" : "warn",
    before: fileReport(),
    after: fileReport(),
    comparison: {
      complete: true, reason: null,
      added: changes.filter((change) => change.kind === "added").length,
      removed: changes.filter((change) => change.kind === "removed").length,
      changed: changes.filter((change) => change.kind === "changed").length,
      unchanged: 0,
      breaking: changes.filter((change) => change.impact === "breaking").length,
      unclassified: changes.filter((change) => change.impact === "unclassified").length
    },
    coverage: {
      comparison: "structural-only", definitions: "shape-only", compatibility: "not-tested",
      serverCatalog: "not-tested", resourceRead: "not-tested", impactClassification: "heuristic"
    },
    changes,
    ...overrides
  };
}

const incomplete = diffReport([], {
  status: "incomplete",
  before: fileReport({ status: "incomplete", inspection: { complete: false, templatesChecked: 1, hasNextCursor: true, reason: "more-pages-present" } }),
  comparison: { complete: false, reason: "input-incomplete", added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null }
});

const changes: Change[] = [
  { kind: "removed", beforeTemplateIndex: 2, afterTemplateIndex: null, fields: [], impact: "breaking", reasons: ["resource-template-removed"] },
  {
    kind: "changed", beforeTemplateIndex: 1, afterTemplateIndex: 1, fields: ["uriTemplate", "other"], impact: "breaking",
    reasons: ["resource-template-variable-removed", "other-fields-unclassified"]
  },
  { kind: "added", beforeTemplateIndex: null, afterTemplateIndex: 2, fields: [], impact: "compatible", reasons: [] }
];

const named: Change[] = [
  { ...changes[0], name: "old_files" },
  {
    ...changes[1], name: "project_files",
    locations: [{ reason: "resource-template-variable-removed", variable: "path" }, { reason: "other-fields-unclassified", variable: null }]
  },
  { ...changes[2], name: "new_files" }
];

const uriFinding = {
  id: "plugin.catalog.resource_template.uri_template.invalid", severity: "fail" as const,
  message: "A catalog resource template uriTemplate must be an RFC 6570 URI template string.", impact: "Unusable.",
  suggestedFix: "Provide uriTemplate as an RFC 6570 URI template, such as file:///{path}.",
  location: { page: 1, templateIndex: 1 }
};

describe("offline resource template file report rendering", () => {
  it("renders file-only coverage and one-based finding locations", () => {
    const output = renderMcpResourceTemplateFileReport(fileReport({
      status: "fail",
      findings: [
        { ...uriFinding, location: { page: 1, templateIndex: 2 } },
        {
          id: "plugin.catalog.resource_template.name.duplicate", severity: "warn", message: "Two enumerated resource templates use the same name.",
          impact: "Ambiguous.", suggestedFix: "Rename.", location: { page: 1, templateIndex: 4, relatedTemplateIndex: 1 }
        },
        {
          id: "plugin.resource_templates_file.file.unavailable", severity: "fail", message: "The local resource template definition file could not be read.",
          impact: "None.", suggestedFix: "Provide a readable local regular file."
        }
      ]
    }));
    const lines = output.split("\n");

    expect(lines.slice(0, 2)).toEqual(["Offline MCP Resource Template Definitions", "=".repeat("Offline MCP Resource Template Definitions".length)]);
    for (const line of [
      "Status: fail", "Scope: resource-template-definitions-file", "Source: file (mcp-resource-templates-list-response)", "Bytes read: 120",
      "Templates checked: 2", "More pages advertised: false", "Definition coverage: shape-only", "Discovery: not-tested",
      "Server catalog: not-tested", "Resource read: not-tested", "Full conformance: not-tested",
      "FAIL plugin.catalog.resource_template.uri_template.invalid [template 2]: A catalog resource template uriTemplate must be an RFC 6570 URI template string.",
      "WARN plugin.catalog.resource_template.name.duplicate [template 4, related template 1]: Two enumerated resource templates use the same name.",
      "FAIL plugin.resource_templates_file.file.unavailable: The local resource template definition file could not be read."
    ]) expect(lines).toContain(line);
    expect(output).not.toContain("Reason:");
  });

  it("renders an unknown continuation and the incomplete reason", () => {
    const output = renderMcpResourceTemplateFileReport(fileReport({ status: "blocked", inspection: { complete: false, templatesChecked: 0, hasNextCursor: null, reason: "final-symlink" } }));
    expect(output).toContain("More pages advertised: unknown");
    expect(output).toContain("Reason: final-symlink");
  });
});

describe("offline resource template diff text rendering", () => {
  it("renders numeric locators, impacts, and side-labelled findings without names", () => {
    const output = renderMcpResourceTemplateDiffReport(diffReport(changes, { before: fileReport({ status: "fail", findings: [uriFinding] }) }));

    expect(output.split("\n").slice(0, 2)).toEqual(["Offline MCP Resource Template Diff", "=".repeat("Offline MCP Resource Template Diff".length)]);
    for (const text of [
      "Comparison coverage: structural-only", "Definition coverage: shape-only", "Compatibility: not-tested",
      "Server catalog: not-tested", "Resource read: not-tested", "Impact classification: heuristic",
      "Added: 1", "Removed: 1", "Changed: 1", "Breaking: 2", "Unclassified: 0",
      "Before input: fail; templates checked: 2; bytes read: 120",
      "Before FAIL plugin.catalog.resource_template.uri_template.invalid [before template 1]: A catalog resource template uriTemplate must be an RFC 6570 URI template string.",
      "REMOVED [before template 2]\n  Impact: breaking (resource-template-removed)",
      "CHANGED [before template 1 -> after template 1]: uriTemplate, other\n  Impact: breaking (resource-template-variable-removed, other-fields-unclassified)",
      "ADDED [after template 2]\n  Impact: compatible"
    ]) expect(output).toContain(text);
    expect(output).not.toContain("At ");
  });

  it("renders quoted names and one line per location when names are shown", () => {
    const output = renderMcpResourceTemplateDiffReport(diffReport(named));

    expect(output).toContain("REMOVED \"old_files\" [before template 2]\n  Impact: breaking (resource-template-removed)");
    expect(output).toContain([
      "CHANGED \"project_files\" [before template 1 -> after template 1]: uriTemplate, other",
      "  Impact: breaking (resource-template-variable-removed, other-fields-unclassified)",
      "  At variable \"path\": resource-template-variable-removed",
      "  At (template): other-fields-unclassified"
    ].join("\n"));
    expect(output).toContain("ADDED \"new_files\" [after template 2]\n  Impact: compatible");
  });

  it("marks counts as not compared for an incomplete comparison", () => {
    const output = renderMcpResourceTemplateDiffReport(incomplete);
    expect(output).toContain("Reason: input-incomplete");
    expect(output).toContain("Added: not compared");
    expect(output).toContain("Before reason: more-pages-present");
  });
});

describe("offline resource template diff Markdown rendering", () => {
  it("renders a numeric table and input findings without names", () => {
    const output = renderMcpResourceTemplateDiffMarkdown(diffReport(changes, { before: fileReport({ status: "fail", findings: [uriFinding] }) }));

    expect(output.startsWith("## MCP Resource Template Definition Diff\n")).toBe(true);
    for (const line of [
      "| 1 | 1 | 1 | 0 | 2 | 0 |",
      "| Change | Before template | After template | Fields | Impact | Reasons |",
      "| removed | 2 | - | - | **breaking** | `resource-template-removed` |",
      "| changed | 1 | 1 | `uriTemplate`, `other` | **breaking** | `resource-template-variable-removed`, `other-fields-unclassified` |",
      "| added | - | 2 | - | **compatible** | - |",
      "| fail | `plugin.catalog.resource_template.uri_template.invalid` | before template 1 | A catalog resource template uriTemplate must be an RFC 6570 URI template string. |"
    ]) expect(output.split("\n")).toContain(line);
    expect(output).not.toContain("### Locations");
    expect(output).toContain("Template numbers are one-based positions in the before and after files; names, URI templates, and descriptions are not reported.");
    expect(output).not.toContain("--show-names");
  });

  it("adds a Template column and a Locations table when names are shown", () => {
    const lines = renderMcpResourceTemplateDiffMarkdown(diffReport(named)).split("\n");

    for (const line of [
      "| Change | Template | Before template | After template | Fields | Impact | Reasons |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| removed | `\"old_files\"` | 2 | - | - | **breaking** | `resource-template-removed` |",
      "| changed | `\"project_files\"` | 1 | 1 | `uriTemplate`, `other` | **breaking** | `resource-template-variable-removed`, `other-fields-unclassified` |",
      "### Locations",
      "| Template | Reason | Variable |",
      "| `\"project_files\"` | `resource-template-variable-removed` | `\"path\"` |",
      "| `\"project_files\"` | `other-fields-unclassified` | - |"
    ]) expect(lines).toContain(line);
    expect(lines.at(-1)).toContain("Template and variable names are shown because --show-names was used; URI templates, descriptions, and other values are not reported.");
  });

  it("marks counts as not compared for an incomplete comparison", () => {
    const output = renderMcpResourceTemplateDiffMarkdown(incomplete);
    expect(output).toContain("**Reason:** `input-incomplete`");
    expect(output).toContain("| not compared | not compared |");
    expect(output).not.toContain("### Changes");
  });

  it("quotes hostile names and variables so Markdown, mentions, links, and control characters stay inert", () => {
    const name = "a|b`c`` @org/team [x](javascript:y) <b>\u001b[2J\u009b\u202e\u00ad\u2028";
    const variable = "x|y\n  Impact: compatible\u001b]8;;";
    const hostile = diffReport([{
      kind: "changed", name, beforeTemplateIndex: 1, afterTemplateIndex: 1, fields: ["uriTemplate"], impact: "breaking",
      reasons: ["resource-template-variable-removed"], locations: [{ reason: "resource-template-variable-removed", variable }]
    }]);
    const quotedName = "\"a|b`c`` @org/team [x](javascript:y) <b>\\u001b[2J\\u009b\\u202e\\u00ad\\u2028\"";
    const quotedVariable = "\"x|y\\n  Impact: compatible\\u001b]8;;\"";

    const text = renderMcpResourceTemplateDiffReport(hostile);
    const markdown = renderMcpResourceTemplateDiffMarkdown(hostile);
    for (const output of [text, markdown]) {
      expect(output).not.toMatch(/[\u001b\u009b\u202e\u00ad\u2028]|\n {0,2}Impact: compatible/u);
    }
    expect(text).toContain(`CHANGED ${quotedName} [before template 1 -> after template 1]: uriTemplate`);
    expect(text).toContain(`  At variable ${quotedVariable}: resource-template-variable-removed`);

    const spannedName = `\`\`\`${quotedName.replaceAll("|", "\\|")}\`\`\``;
    const spannedVariable = `\`${quotedVariable.replaceAll("|", "\\|")}\``;
    expect(markdown).toContain(`| changed | ${spannedName} | 1 | 1 | \`uriTemplate\` | **breaking** | \`resource-template-variable-removed\` |`);
    expect(markdown).toContain(`| ${spannedName} | \`resource-template-variable-removed\` | ${spannedVariable} |`);
    // Outside code spans, no table cell holds an unescaped pipe from server text.
    for (const line of markdown.split("\n").filter((row) => row.includes("@org"))) {
      expect(line.split(/(?<!\\)\|/u).length).toBe(line.startsWith("| changed") ? 9 : 5);
    }
  });
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map(async (directory) => {
    const [canonicalDirectory, canonicalTemporaryRoot] = await Promise.all([
      realpath(directory).catch(() => null),
      realpath(os.tmpdir()).catch(() => null)
    ]);
    if (canonicalDirectory === null
      || canonicalTemporaryRoot === null
      || path.dirname(canonicalDirectory) !== canonicalTemporaryRoot
      || !path.basename(canonicalDirectory).startsWith("mcp-resource-template-render-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("resource template definition output contracts", () => {
  const schemas = buildDoctorOutputContract().schemas;
  const fileEntry = schemas.find((schema) => schema.id === "doctor.resource-templates.file.json");
  const diffEntry = schemas.find((schema) => schema.id === "doctor.resource-templates.diff.json");

  it("registers a bounded file schema", () => {
    expect(fileEntry).toMatchObject({ command: "codex-plugin-doctor doctor resource-templates-file <path> --json", outputKind: null });
    expect(fileEntry?.schema).toMatchObject({
      required: ["schemaVersion", "scope", "status", "source", "inspection", "coverage", "findings"],
      properties: {
        schemaVersion: { const: 1 }, scope: { const: "resource-template-definitions-file" },
        source: { properties: { format: { const: "mcp-resource-templates-list-response" }, bytesRead: { maximum: 1048577 } }, additionalProperties: false },
        inspection: { properties: { templatesChecked: { minimum: 0, maximum: 500 } }, additionalProperties: false },
        coverage: { properties: { definitions: { const: "shape-only" }, resourceRead: { const: "not-tested" } }, additionalProperties: false },
        findings: { maxItems: 100, items: {
          properties: {
            id: { pattern: "^plugin\\.(catalog|resource_templates_file)\\." },
            location: {
              required: ["page", "templateIndex"],
              properties: { page: { const: 1 }, templateIndex: { minimum: 1, maximum: 500 }, relatedTemplateIndex: { minimum: 1, maximum: 500 } },
              additionalProperties: false
            }
          },
          additionalProperties: false
        } }
      }
    });
  });

  it("registers a bounded diff schema that embeds the file schema", () => {
    expect(diffEntry).toMatchObject({ command: "codex-plugin-doctor doctor resource-templates-diff --before <path> --after <path> --json", outputKind: null });
    expect(diffEntry?.schema).toMatchObject({
      required: ["schemaVersion", "scope", "status", "before", "after", "comparison", "coverage", "changes"],
      properties: {
        scope: { const: "resource-template-definitions-diff" },
        before: { required: fileEntry?.schema.required, properties: fileEntry?.schema.properties },
        after: { required: fileEntry?.schema.required, properties: fileEntry?.schema.properties },
        comparison: { properties: { reason: { enum: [null, "input-blocked", "input-incomplete", "invalid-definitions", "ambiguous-names"] } }, additionalProperties: false },
        coverage: { properties: { definitions: { const: "shape-only" }, resourceRead: { const: "not-tested" }, impactClassification: { const: "heuristic" } }, additionalProperties: false },
        changes: { maxItems: 1000, items: {
          required: ["kind", "beforeTemplateIndex", "afterTemplateIndex", "fields", "impact", "reasons"],
          properties: {
            beforeTemplateIndex: { minimum: 1, maximum: 500 },
            afterTemplateIndex: { minimum: 1, maximum: 500 },
            fields: { maxItems: 5, items: { enum: ["uriTemplate", "mimeType", "description", "title", "other"] } },
            reasons: { maxItems: RESOURCE_TEMPLATE_CHANGE_REASONS.length, items: { enum: [...RESOURCE_TEMPLATE_CHANGE_REASONS] } },
            name: { type: "string" },
            locations: {
              maxItems: 100,
              items: { required: ["reason", "variable"], properties: { reason: { enum: [...RESOURCE_TEMPLATE_CHANGE_REASONS] }, variable: { type: ["string", "null"] } }, additionalProperties: false }
            }
          },
          additionalProperties: false
        } }
      }
    });
  });

  it("accepts real reports, rejects undeclared fields, and keeps default output free of names, templates, and variables", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-resource-template-render-"));
    temporaryDirectories.push(directory);
    const write = async (name: string, resourceTemplates: unknown[], extra: Record<string, unknown> = {}) => {
      const filePath = path.join(directory, name);
      await writeFile(filePath, JSON.stringify({ jsonrpc: "2.0", id: 3, result: { resultType: "complete", resourceTemplates, ttlMs: 300000, cacheScope: "public", ...extra } }));
      return filePath;
    };
    const before = await write("before.json", [
      { uriTemplate: "https://HOST_SECRET.example/{OWNER_SECRET}/{REPO_SECRET}", name: "TEMPLATE_SECRET", description: "DESCRIPTION_SECRET" },
      { uriTemplate: "file:///{PATH_SECRET}", name: "OLD_SECRET" }
    ]);
    const after = await write("after.json", [
      { uriTemplate: "https://HOST_SECRET.example/{OWNER_SECRET}/{NEW_SECRET}", name: "TEMPLATE_SECRET", mimeType: "text/MIME_SECRET", icons: [] }
    ]);
    const invalid = await write("invalid.json", [{ uriTemplate: "file:///{UNCLOSED_SECRET", name: "t" }]);
    const duplicate = await write("duplicate.json", [
      { uriTemplate: "file:///{PATH_SECRET}", name: "DUPLICATE_SECRET" },
      { uriTemplate: "file:///other/{PATH_SECRET}", name: "DUPLICATE_SECRET" }
    ]);
    const paged = await write("paged.json", [], { nextCursor: "next" });

    const fileReports = await Promise.all([before, invalid, duplicate, paged, path.join(directory, "missing.json"), directory]
      .map((input) => inspectMcpResourceTemplateFile(input)));
    expect(fileReports.map((report) => report.status)).toEqual(["pass", "fail", "warn", "incomplete", "incomplete", "blocked"]);
    for (const report of fileReports) expect(violations(fileEntry!.schema, report)).toEqual([]);

    const hidden = await compareMcpResourceTemplateFiles(before, after);
    const shown = await compareMcpResourceTemplateFiles(before, after, { showNames: true });
    const ambiguous = await compareMcpResourceTemplateFiles(before, duplicate);
    const skipped = await compareMcpResourceTemplateFiles(invalid, paged);
    expect(ambiguous.comparison.reason).toBe("ambiguous-names");
    expect(shown.changes.some((change) => change.locations !== undefined && change.locations.length > 0)).toBe(true);
    for (const report of [hidden, shown, ambiguous, skipped]) expect(violations(diffEntry!.schema, report)).toEqual([]);

    expect(violations(diffEntry!.schema, { ...hidden, changes: [{ ...hidden.changes[0], extra: true }] })).toEqual(["$.changes[0].extra: additional"]);
    expect(violations(fileEntry!.schema, { ...fileReports[2], findings: [{ ...fileReports[2].findings[0], location: { page: 1, templateIndex: 0 } }] }))
      .toEqual(["$.findings[0].location.templateIndex: bounds"]);
    expect(violations(fileEntry!.schema, { ...fileReports[1], findings: [{ ...fileReports[1].findings[0], id: "plugin.prompts_file.file.unavailable" }] }))
      .toEqual(["$.findings[0].id: pattern"]);

    for (const report of [hidden, ambiguous, skipped]) {
      for (const output of [JSON.stringify(report), renderMcpResourceTemplateDiffReport(report), renderMcpResourceTemplateDiffMarkdown(report)]) {
        expect(output).not.toContain("SECRET");
      }
    }
    for (const report of fileReports) expect(renderMcpResourceTemplateFileReport(report)).not.toContain("SECRET");

    // Names and variables appear only with --show-names; URI templates, hosts, MIME types, and descriptions never do.
    const shownOutputs = [JSON.stringify(shown), renderMcpResourceTemplateDiffReport(shown), renderMcpResourceTemplateDiffMarkdown(shown)];
    expect(renderMcpResourceTemplateDiffMarkdown(shown)).toContain("`\"NEW_SECRET\"`");
    expect(renderMcpResourceTemplateDiffReport(shown)).toContain("At variable \"REPO_SECRET\": resource-template-variable-removed");
    for (const output of shownOutputs) {
      expect(output).not.toMatch(/HOST_SECRET|MIME_SECRET|DESCRIPTION_SECRET|https:\/\/|file:\/\/\/|\{OWNER_SECRET\}/u);
    }
  });
});
