import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { compareMcpPromptFiles, type McpPromptDiffReport } from "../src/core/mcp-prompt-diff.js";
import { inspectMcpPromptFile, type McpPromptFileReport } from "../src/core/mcp-prompt-file.js";
import { PROMPT_CHANGE_REASONS } from "../src/core/mcp-prompt-impact.js";
import { buildDoctorOutputContract } from "../src/core/output-contract.js";
import { renderMcpPromptDiffMarkdown } from "../src/reporting/render-mcp-prompt-diff-markdown.js";
import { renderMcpPromptDiffReport } from "../src/reporting/render-mcp-prompt-diff-report.js";
import { renderMcpPromptFileReport } from "../src/reporting/render-mcp-prompt-file-report.js";
import { violations } from "./helpers/json-schema-violations.js";

type Change = McpPromptDiffReport["changes"][number];

function fileReport(overrides: Partial<McpPromptFileReport> = {}): McpPromptFileReport {
  return {
    schemaVersion: 1,
    scope: "prompt-definitions-file",
    status: "pass",
    source: { kind: "file", format: "mcp-prompts-list-response", bytesRead: 120 },
    inspection: { complete: true, promptsChecked: 2, hasNextCursor: false, reason: null },
    coverage: { definitions: "shape-only", discovery: "not-tested", serverCatalog: "not-tested", promptRetrieval: "not-tested", fullConformance: "not-tested" },
    findings: [],
    ...overrides
  };
}

function diffReport(changes: Change[], overrides: Partial<McpPromptDiffReport> = {}): McpPromptDiffReport {
  return {
    schemaVersion: 1,
    scope: "prompt-definitions-diff",
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
      serverCatalog: "not-tested", promptRetrieval: "not-tested", impactClassification: "heuristic"
    },
    changes,
    ...overrides
  };
}

const incomplete = diffReport([], {
  status: "incomplete",
  before: fileReport({ status: "incomplete", inspection: { complete: false, promptsChecked: 1, hasNextCursor: true, reason: "more-pages-present" } }),
  comparison: { complete: false, reason: "input-incomplete", added: null, removed: null, changed: null, unchanged: null, breaking: null, unclassified: null }
});

const changes: Change[] = [
  { kind: "removed", beforePromptIndex: 2, afterPromptIndex: null, fields: [], impact: "breaking", reasons: ["prompt-removed"] },
  {
    kind: "changed", beforePromptIndex: 1, afterPromptIndex: 1, fields: ["arguments", "other"], impact: "breaking",
    reasons: ["prompt-argument-removed", "other-fields-unclassified"]
  },
  { kind: "added", beforePromptIndex: null, afterPromptIndex: 2, fields: [], impact: "compatible", reasons: [] }
];

const named: Change[] = [
  { ...changes[0], name: "old_prompt" },
  {
    ...changes[1], name: "code_review",
    locations: [{ reason: "prompt-argument-removed", argument: "code" }, { reason: "other-fields-unclassified", argument: null }]
  },
  { ...changes[2], name: "new_prompt" }
];

const argumentFinding = {
  id: "plugin.catalog.prompt.argument.name.duplicate", severity: "fail" as const,
  message: "Two arguments of a catalog prompt use the same name.", impact: "Ambiguous.", suggestedFix: "Use a unique name for each prompt argument.",
  location: { page: 1, promptIndex: 1, argumentIndex: 2, relatedArgumentIndex: 1 }
};

describe("offline prompt file report rendering", () => {
  it("renders file-only coverage and one-based finding locations", () => {
    const output = renderMcpPromptFileReport(fileReport({
      status: "fail",
      findings: [
        { ...argumentFinding, location: { page: 1, promptIndex: 2, argumentIndex: 3, relatedArgumentIndex: 1 } },
        { id: "plugin.catalog.prompt.name.duplicate", severity: "warn", message: "Two enumerated prompts use the same name.", impact: "Ambiguous.", suggestedFix: "Rename.", location: { page: 1, promptIndex: 4, relatedPromptIndex: 1 } },
        { id: "plugin.prompts_file.file.unavailable", severity: "fail", message: "The local prompt definition file could not be read.", impact: "None.", suggestedFix: "Provide a readable local regular file." }
      ]
    }));
    const lines = output.split("\n");

    expect(lines.slice(0, 2)).toEqual(["Offline MCP Prompt Definitions", "=============================="]);
    for (const line of [
      "Status: fail", "Scope: prompt-definitions-file", "Source: file (mcp-prompts-list-response)", "Bytes read: 120",
      "Prompts checked: 2", "More pages advertised: false", "Definition coverage: shape-only", "Discovery: not-tested",
      "Server catalog: not-tested", "Prompt retrieval: not-tested", "Full conformance: not-tested",
      "FAIL plugin.catalog.prompt.argument.name.duplicate [prompt 2, argument 3, related argument 1]: Two arguments of a catalog prompt use the same name.",
      "WARN plugin.catalog.prompt.name.duplicate [prompt 4, related prompt 1]: Two enumerated prompts use the same name.",
      "FAIL plugin.prompts_file.file.unavailable: The local prompt definition file could not be read."
    ]) expect(lines).toContain(line);
    expect(output).not.toContain("Reason:");
  });

  it("renders an unknown continuation and the incomplete reason", () => {
    const output = renderMcpPromptFileReport(fileReport({ status: "blocked", inspection: { complete: false, promptsChecked: 0, hasNextCursor: null, reason: "final-symlink" } }));
    expect(output).toContain("More pages advertised: unknown");
    expect(output).toContain("Reason: final-symlink");
  });
});

describe("offline prompt diff text rendering", () => {
  it("renders numeric locators, impacts, and side-labelled findings without names", () => {
    const output = renderMcpPromptDiffReport(diffReport(changes, { before: fileReport({ status: "fail", findings: [argumentFinding] }) }));

    expect(output.split("\n").slice(0, 2)).toEqual(["Offline MCP Prompt Diff", "======================="]);
    for (const text of [
      "Comparison coverage: structural-only", "Definition coverage: shape-only", "Compatibility: not-tested",
      "Server catalog: not-tested", "Prompt retrieval: not-tested", "Impact classification: heuristic",
      "Added: 1", "Removed: 1", "Changed: 1", "Breaking: 2", "Unclassified: 0",
      "Before input: fail; prompts checked: 2; bytes read: 120",
      "Before FAIL plugin.catalog.prompt.argument.name.duplicate [before prompt 1, argument 2, related argument 1]: Two arguments of a catalog prompt use the same name.",
      "REMOVED [before prompt 2]\n  Impact: breaking (prompt-removed)",
      "CHANGED [before prompt 1 -> after prompt 1]: arguments, other\n  Impact: breaking (prompt-argument-removed, other-fields-unclassified)",
      "ADDED [after prompt 2]\n  Impact: compatible"
    ]) expect(output).toContain(text);
    expect(output).not.toContain("At ");
  });

  it("renders quoted names and one line per location when names are shown", () => {
    const output = renderMcpPromptDiffReport(diffReport(named));

    expect(output).toContain("REMOVED \"old_prompt\" [before prompt 2]\n  Impact: breaking (prompt-removed)");
    expect(output).toContain([
      "CHANGED \"code_review\" [before prompt 1 -> after prompt 1]: arguments, other",
      "  Impact: breaking (prompt-argument-removed, other-fields-unclassified)",
      "  At argument \"code\": prompt-argument-removed",
      "  At (prompt): other-fields-unclassified"
    ].join("\n"));
    expect(output).toContain("ADDED \"new_prompt\" [after prompt 2]\n  Impact: compatible");
  });

  it("marks counts as not compared for an incomplete comparison", () => {
    const output = renderMcpPromptDiffReport(incomplete);
    expect(output).toContain("Reason: input-incomplete");
    expect(output).toContain("Added: not compared");
    expect(output).toContain("Before reason: more-pages-present");
  });
});

describe("offline prompt diff Markdown rendering", () => {
  it("renders a numeric table and input findings without names", () => {
    const output = renderMcpPromptDiffMarkdown(diffReport(changes, { before: fileReport({ status: "fail", findings: [argumentFinding] }) }));

    expect(output.startsWith("## MCP Prompt Definition Diff\n")).toBe(true);
    for (const line of [
      "| 1 | 1 | 1 | 0 | 2 | 0 |",
      "| Change | Before prompt | After prompt | Fields | Impact | Reasons |",
      "| removed | 2 | - | - | **breaking** | `prompt-removed` |",
      "| changed | 1 | 1 | `arguments`, `other` | **breaking** | `prompt-argument-removed`, `other-fields-unclassified` |",
      "| added | - | 2 | - | **compatible** | - |",
      "| fail | `plugin.catalog.prompt.argument.name.duplicate` | before prompt 1, argument 2, related argument 1 | Two arguments of a catalog prompt use the same name. |"
    ]) expect(output.split("\n")).toContain(line);
    expect(output).not.toContain("### Locations");
    expect(output).toContain("Prompt numbers are one-based positions in the before and after files; names and descriptions are not reported.");
    expect(output).not.toContain("--show-names");
  });

  it("adds a Prompt column and a Locations table when names are shown", () => {
    const lines = renderMcpPromptDiffMarkdown(diffReport(named)).split("\n");

    for (const line of [
      "| Change | Prompt | Before prompt | After prompt | Fields | Impact | Reasons |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      "| removed | `\"old_prompt\"` | 2 | - | - | **breaking** | `prompt-removed` |",
      "| changed | `\"code_review\"` | 1 | 1 | `arguments`, `other` | **breaking** | `prompt-argument-removed`, `other-fields-unclassified` |",
      "### Locations",
      "| Prompt | Reason | Argument |",
      "| `\"code_review\"` | `prompt-argument-removed` | `\"code\"` |",
      "| `\"code_review\"` | `other-fields-unclassified` | - |"
    ]) expect(lines).toContain(line);
    expect(lines.at(-1)).toContain("Prompt and argument names are shown because --show-names was used");
  });

  it("marks counts as not compared for an incomplete comparison", () => {
    const output = renderMcpPromptDiffMarkdown(incomplete);
    expect(output).toContain("**Reason:** `input-incomplete`");
    expect(output).toContain("| not compared | not compared |");
    expect(output).not.toContain("### Changes");
  });

  it("quotes hostile names so Markdown, mentions, links, and control characters stay inert", () => {
    const name = "a|b`c`` @org/team [x](javascript:y) <b>\u001b[2J\u009b\u202e\u00ad\u2028";
    const argument = "x|y\n  Impact: compatible\u001b]8;;";
    const hostile = diffReport([{
      kind: "changed", name, beforePromptIndex: 1, afterPromptIndex: 1, fields: ["arguments"], impact: "breaking",
      reasons: ["prompt-argument-removed"], locations: [{ reason: "prompt-argument-removed", argument }]
    }]);
    const quotedName = "\"a|b`c`` @org/team [x](javascript:y) <b>\\u001b[2J\\u009b\\u202e\\u00ad\\u2028\"";
    const quotedArgument = "\"x|y\\n  Impact: compatible\\u001b]8;;\"";

    const text = renderMcpPromptDiffReport(hostile);
    const markdown = renderMcpPromptDiffMarkdown(hostile);
    for (const output of [text, markdown]) {
      expect(output).not.toMatch(/[\u001b\u009b\u202e\u00ad\u2028]|\n {0,2}Impact: compatible/u);
    }
    expect(text).toContain(`CHANGED ${quotedName} [before prompt 1 -> after prompt 1]: arguments`);
    expect(text).toContain(`  At argument ${quotedArgument}: prompt-argument-removed`);

    const spannedName = `\`\`\`${quotedName.replaceAll("|", "\\|")}\`\`\``;
    const spannedArgument = `\`${quotedArgument.replaceAll("|", "\\|")}\``;
    expect(markdown).toContain(`| changed | ${spannedName} | 1 | 1 | \`arguments\` | **breaking** | \`prompt-argument-removed\` |`);
    expect(markdown).toContain(`| ${spannedName} | \`prompt-argument-removed\` | ${spannedArgument} |`);
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
      || !path.basename(canonicalDirectory).startsWith("mcp-prompt-render-")) {
      throw new Error("Refusing to remove an unexpected test directory.");
    }
    await rm(canonicalDirectory, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }));
});

describe("prompt definition output contracts", () => {
  const schemas = buildDoctorOutputContract().schemas;
  const fileEntry = schemas.find((schema) => schema.id === "doctor.prompts.file.json");
  const diffEntry = schemas.find((schema) => schema.id === "doctor.prompts.diff.json");

  it("registers a bounded file schema", () => {
    expect(fileEntry).toMatchObject({ command: "codex-plugin-doctor doctor prompts-file <path> --json", outputKind: null });
    expect(fileEntry?.schema).toMatchObject({
      required: ["schemaVersion", "scope", "status", "source", "inspection", "coverage", "findings"],
      properties: {
        schemaVersion: { const: 1 }, scope: { const: "prompt-definitions-file" },
        source: { properties: { format: { const: "mcp-prompts-list-response" }, bytesRead: { maximum: 1048577 } }, additionalProperties: false },
        inspection: { properties: { promptsChecked: { minimum: 0, maximum: 500 } }, additionalProperties: false },
        coverage: { properties: { definitions: { const: "shape-only" }, promptRetrieval: { const: "not-tested" } }, additionalProperties: false },
        findings: { maxItems: 100, items: {
          properties: {
            id: { pattern: "^plugin\\.(catalog|prompts_file)\\." },
            location: {
              required: ["page", "promptIndex"],
              properties: { page: { const: 1 }, promptIndex: { minimum: 1, maximum: 500 }, argumentIndex: { minimum: 1 }, relatedPromptIndex: { minimum: 1, maximum: 500 }, relatedArgumentIndex: { minimum: 1 } },
              additionalProperties: false
            }
          },
          additionalProperties: false
        } }
      }
    });
  });

  it("registers a bounded diff schema that embeds the file schema", () => {
    expect(diffEntry).toMatchObject({ command: "codex-plugin-doctor doctor prompts-diff --before <path> --after <path> --json", outputKind: null });
    expect(diffEntry?.schema).toMatchObject({
      required: ["schemaVersion", "scope", "status", "before", "after", "comparison", "coverage", "changes"],
      properties: {
        scope: { const: "prompt-definitions-diff" },
        before: { required: fileEntry?.schema.required, properties: fileEntry?.schema.properties },
        after: { required: fileEntry?.schema.required, properties: fileEntry?.schema.properties },
        comparison: { properties: { reason: { enum: [null, "input-blocked", "input-incomplete", "invalid-definitions", "ambiguous-names"] } }, additionalProperties: false },
        coverage: { properties: { definitions: { const: "shape-only" }, promptRetrieval: { const: "not-tested" }, impactClassification: { const: "heuristic" } }, additionalProperties: false },
        changes: { maxItems: 1000, items: {
          required: ["kind", "beforePromptIndex", "afterPromptIndex", "fields", "impact", "reasons"],
          properties: {
            beforePromptIndex: { minimum: 1, maximum: 500 },
            afterPromptIndex: { minimum: 1, maximum: 500 },
            fields: { items: { enum: ["arguments", "description", "title", "other"] } },
            reasons: { maxItems: PROMPT_CHANGE_REASONS.length, items: { enum: [...PROMPT_CHANGE_REASONS] } },
            name: { type: "string" },
            locations: { maxItems: 100, items: { required: ["reason", "argument"], properties: { reason: { enum: [...PROMPT_CHANGE_REASONS] }, argument: { type: ["string", "null"] } }, additionalProperties: false } }
          },
          additionalProperties: false
        } }
      }
    });
  });

  it("accepts real reports and rejects undeclared fields", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "mcp-prompt-render-"));
    temporaryDirectories.push(directory);
    const write = async (name: string, prompts: unknown[], extra: Record<string, unknown> = {}) => {
      const filePath = path.join(directory, name);
      await writeFile(filePath, JSON.stringify({ jsonrpc: "2.0", id: 1, result: { resultType: "complete", prompts, ttlMs: 0, cacheScope: "public", ...extra } }));
      return filePath;
    };
    const before = await write("before.json", [{ name: "PROMPT_SECRET", arguments: [{ name: "ARG_SECRET", required: true }] }, { name: "OLD_SECRET" }]);
    const after = await write("after.json", [{ name: "PROMPT_SECRET", icons: [], arguments: [{ name: "NEW_SECRET", required: true }] }]);
    const invalid = await write("invalid.json", [{ name: "p", arguments: [{ name: "a" }, { name: "a" }] }]);
    const paged = await write("paged.json", [], { nextCursor: "next" });

    const fileReports = await Promise.all([before, invalid, paged, path.join(directory, "missing.json"), directory].map((input) => inspectMcpPromptFile(input)));
    expect(fileReports.map((report) => report.status)).toEqual(["pass", "fail", "incomplete", "incomplete", "blocked"]);
    for (const report of fileReports) expect(violations(fileEntry!.schema, report)).toEqual([]);

    const hidden = await compareMcpPromptFiles(before, after);
    const shown = await compareMcpPromptFiles(before, after, { showNames: true });
    const skipped = await compareMcpPromptFiles(invalid, paged);
    expect(shown.changes.some((change) => change.locations !== undefined && change.locations.length > 0)).toBe(true);
    for (const report of [hidden, shown, skipped]) expect(violations(diffEntry!.schema, report)).toEqual([]);

    expect(violations(diffEntry!.schema, { ...hidden, changes: [{ ...hidden.changes[0], extra: true }] })).toEqual(["$.changes[0].extra: additional"]);
    expect(violations(fileEntry!.schema, { ...fileReports[1], findings: [{ ...fileReports[1].findings[0], location: { page: 1, promptIndex: 1, argumentIndex: 0 } }] }))
      .toEqual(["$.findings[0].location.argumentIndex: bounds"]);

    for (const output of [JSON.stringify(hidden), renderMcpPromptDiffReport(hidden), renderMcpPromptDiffMarkdown(hidden)]) {
      expect(output).not.toContain("SECRET");
    }
    expect(renderMcpPromptDiffMarkdown(shown)).toContain("`\"NEW_SECRET\"`");
  });
});
