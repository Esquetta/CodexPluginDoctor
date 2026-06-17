import type { Finding, FindingEvidence } from "../domain/types.js";

export function formatFindingEvidence(evidence: FindingEvidence): string {
  return Object.entries(evidence)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(", ");
}

export function formatFindingEvidenceLine(finding: Finding): string | null {
  return finding.evidence ? formatFindingEvidence(finding.evidence) : null;
}
