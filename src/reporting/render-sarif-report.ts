import path from "node:path";

import type { CheckResult, Finding } from "../domain/types.js";
import { findRuleDefinition } from "../rules/rule-catalog.js";

function levelForFinding(finding: Finding): "error" | "warning" {
  return finding.severity === "fail" ? "error" : "warning";
}

export function renderSarifReport(result: CheckResult): string {
  const rules = [...new Set(result.findings.map((finding) => finding.id))]
    .map((ruleId) => {
      const catalogEntry = findRuleDefinition(ruleId);

      return {
        id: ruleId,
        name: ruleId,
        shortDescription: {
          text: catalogEntry?.summary ?? ruleId
        },
        help: {
          text: catalogEntry
            ? `${catalogEntry.why}\n\nSuggested fix: ${catalogEntry.fix}`
            : "See the Codex Plugin Doctor report for remediation guidance."
        }
      };
    });

  const sarif = {
    version: "2.1.0",
    $schema: "https://json.schemastore.org/sarif-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: "Codex Plugin Doctor",
            informationUri: "https://github.com/Esquetta/CodexPluginDoctor",
            rules
          }
        },
        results: result.findings.map((finding) => ({
          ruleId: finding.id,
          level: levelForFinding(finding),
          message: {
            text: `${finding.message} Suggested fix: ${finding.suggestedFix}`
          },
          locations: [
            {
              physicalLocation: {
                artifactLocation: {
                  uri: path.basename(result.targetPath)
                }
              }
            }
          ],
          ...(finding.evidence ? { properties: { evidence: finding.evidence } } : {})
        }))
      }
    ]
  };

  return JSON.stringify(sarif, null, 2);
}
