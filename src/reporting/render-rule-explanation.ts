import type { RuleDefinition } from "../rules/rule-catalog.js";

export function renderRuleExplanation(rule: RuleDefinition): string {
  return [
    `Rule: ${rule.id}`,
    "==============================",
    `Category: ${rule.category}`,
    `Default severity: ${rule.defaultSeverity}`,
    "",
    "Summary",
    "-------",
    rule.summary,
    "",
    "Why it matters",
    "--------------",
    rule.why,
    "",
    "Suggested fix",
    "-------------",
    rule.fix,
    "",
    "Example",
    "-------",
    rule.example,
    "",
    "Full catalog: docs/rules/catalog.md"
  ].join("\n");
}
