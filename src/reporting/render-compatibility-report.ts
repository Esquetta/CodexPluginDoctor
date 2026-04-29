import type {
  CompatibilityMatrix,
  CompatibilityStatus
} from "../compatibility/compatibility-matrix.js";

function statusLabel(status: CompatibilityStatus): string {
  return status.toUpperCase();
}

export function renderCompatibilityReport(matrix: CompatibilityMatrix): string {
  const lines = [
    "Compatibility Matrix",
    "====================",
    `Target: ${matrix.targetPath}`,
    ""
  ];

  for (const result of matrix.results) {
    lines.push(`${result.client}: ${statusLabel(result.status)} - ${result.summary}`);

    for (const detail of result.details) {
      lines.push(`  - ${detail}`);
    }
  }

  return lines.join("\n");
}
