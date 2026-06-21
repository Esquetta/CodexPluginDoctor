import type {
  ManagedSuppressionRecord,
  SuppressionMutationResult
} from "../core/suppression-management.js";

type SuppressionMutationCommand = "suppress.add" | "suppress.remove";

type ValidSuppressionSummary = {
  fingerprint?: string;
  reason?: string;
  expiresAt?: string;
};

type InvalidSuppressionSummary = {
  invalidField: string;
};

function buildListEntry(record: ManagedSuppressionRecord) {
  if (record.status === "invalid") {
    return {
      index: record.index,
      status: record.status,
      invalidField: record.invalidField
    };
  }

  return {
    index: record.index,
    status: record.status,
    fingerprint: record.fingerprint,
    reason: record.reason,
    expiresAt: record.expiresAt
  };
}

function isInvalidSuppressionSummary(
  value: unknown
): value is InvalidSuppressionSummary {
  return (
    typeof value === "object" &&
    value !== null &&
    "invalidField" in value &&
    typeof value.invalidField === "string"
  );
}

function buildMutationSummary(
  value: unknown
): InvalidSuppressionSummary | ValidSuppressionSummary {
  if (isInvalidSuppressionSummary(value)) {
    return {
      invalidField: value.invalidField
    };
  }

  const summary = (value ?? {}) as ValidSuppressionSummary;

  return {
    fingerprint: summary.fingerprint,
    reason: summary.reason,
    expiresAt: summary.expiresAt
  };
}

function getActionLabel(command: SuppressionMutationCommand): "Added" | "Removed" {
  return command === "suppress.add" ? "Added" : "Removed";
}

export function renderSuppressionList(
  configPath: string,
  suppressions: ManagedSuppressionRecord[]
): string {
  const lines = [
    `Config: ${configPath}`,
    `Total suppressions: ${suppressions.length}`
  ];

  if (suppressions.length === 0) {
    lines.push("", "No suppressions.");
    return lines.join("\n");
  }

  lines.push("", "Suppressions", "------------");

  for (const suppression of suppressions) {
    if (suppression.status === "invalid") {
      lines.push(`[${suppression.index}] INVALID ${suppression.invalidField}`);
      continue;
    }

    lines.push(
      `[${suppression.index}] ${suppression.status.toUpperCase()} ${suppression.fingerprint}`
    );
    lines.push(`  Reason: ${suppression.reason}`);
    lines.push(`  Expires: ${suppression.expiresAt}`);
  }

  return lines.join("\n");
}

export function renderSuppressionListJson(
  configPath: string,
  suppressions: ManagedSuppressionRecord[]
): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      command: "suppress.list",
      configPath,
      suppressions: suppressions.map(buildListEntry)
    },
    null,
    2
  );
}

export function renderSuppressionMutation(
  command: SuppressionMutationCommand,
  configPath: string,
  result: SuppressionMutationResult
): string {
  const summary = buildMutationSummary(result.suppression);
  const lines = [
    `Action: ${getActionLabel(command)}`,
    `Config: ${configPath}`,
    `Index: ${result.index}`
  ];

  lines.push("");

  if ("invalidField" in summary) {
    lines.push(`Invalid field: ${summary.invalidField}`);
    return lines.join("\n");
  }

  lines.push(`Fingerprint: ${summary.fingerprint}`);
  lines.push(`Reason: ${summary.reason}`);
  lines.push(`Expires: ${summary.expiresAt}`);

  return lines.join("\n");
}

export function renderSuppressionMutationJson(
  command: SuppressionMutationCommand,
  configPath: string,
  result: SuppressionMutationResult
): string {
  return JSON.stringify(
    {
      schemaVersion: "1.0.0",
      command,
      configPath,
      index: result.index,
      suppression: buildMutationSummary(result.suppression)
    },
    null,
    2
  );
}
