import type {
  CompatibilityMatrix,
  CompatibilityStatus
} from "../compatibility/compatibility-matrix.js";

function scoreForStatus(status: CompatibilityStatus): number {
  if (status === "pass") {
    return 100;
  }

  if (status === "warn") {
    return 70;
  }

  return 0;
}

export function renderCompatibilityScorecard(matrix: CompatibilityMatrix): string {
  const lines = [
    "Compatibility Scorecard",
    "=======================",
    `Target: ${matrix.targetPath}`,
    ""
  ];

  for (const result of matrix.results) {
    lines.push(`${result.client}: ${scoreForStatus(result.status)} (${result.status.toUpperCase()})`);
  }

  return lines.join("\n");
}
