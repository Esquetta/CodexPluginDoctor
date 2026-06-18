import { createHash } from "node:crypto";
import path from "node:path";

import type {
  Finding,
  FindingEvidence,
  FindingEvidenceValue
} from "../domain/types.js";

const fingerprintVersion = 1;

function isPathEvidenceKey(key: string): boolean {
  return key.toLowerCase().endsWith("path");
}

function normalizePathEvidence(value: string, rootPath: string): string {
  const windowsPath = /^[a-z]:[\\/]/i.test(value);
  const windowsRoot = /^[a-z]:[\\/]/i.test(rootPath);

  if (windowsPath && windowsRoot) {
    return path.win32.relative(rootPath, value).replaceAll("\\", "/") || ".";
  }

  if (value.startsWith("/") && rootPath.startsWith("/")) {
    return path.posix.relative(rootPath, value) || ".";
  }

  return value.replaceAll("\\", "/");
}

function canonicalizeEvidenceValue(
  key: string,
  value: FindingEvidenceValue,
  rootPath: string
): FindingEvidenceValue {
  return typeof value === "string" && isPathEvidenceKey(key)
    ? normalizePathEvidence(value, rootPath)
    : value;
}

function canonicalizeEvidence(
  evidence: FindingEvidence | undefined,
  rootPath: string
): FindingEvidence {
  return Object.fromEntries(
    Object.entries(evidence ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [
        key,
        canonicalizeEvidenceValue(key, value, rootPath)
      ])
  );
}

export function buildFindingFingerprint(
  finding: Finding,
  rootPath: string
): string {
  const payload = JSON.stringify({
    version: fingerprintVersion,
    ruleId: finding.id,
    evidence: canonicalizeEvidence(finding.evidence, rootPath)
  });

  return createHash("sha256").update(payload).digest("hex");
}

export function withFindingFingerprint(
  finding: Finding,
  rootPath: string
): Finding {
  return {
    ...finding,
    fingerprint: buildFindingFingerprint(finding, rootPath)
  };
}

export function withFindingFingerprints(
  findings: Finding[],
  rootPath: string
): Finding[] {
  return findings.map((finding) => withFindingFingerprint(finding, rootPath));
}

export function formatFindingFingerprintLine(finding: Finding): string | null {
  return finding.fingerprint ?? null;
}
