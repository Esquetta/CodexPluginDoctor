import type {
  ManagedSuppressionRecord,
  SuppressionMutationResult
} from "../core/suppression-management.js";

type SuppressionMutationCommand = "suppress.add" | "suppress.remove";

type ValidSuppressionSummary = {
  fingerprint: string;
  reason: string;
  expiresAt: string;
};

type InvalidSuppressionSummary = {
  invalidField: "record" | "fingerprint" | "reason" | "expiresAt";
};

type SuppressionListEntry =
  | ({
      index: number;
      status: "active" | "expired";
    } & ValidSuppressionSummary)
  | ({
      index: number;
      status: "invalid";
    } & InvalidSuppressionSummary);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInvalidField(
  value: unknown
): value is InvalidSuppressionSummary["invalidField"] {
  return (
    value === "record" ||
    value === "fingerprint" ||
    value === "reason" ||
    value === "expiresAt"
  );
}

function isValidSuppressionSummary(
  value: unknown
): value is ValidSuppressionSummary {
  return (
    isObject(value) &&
    !("invalidField" in value) &&
    typeof value.fingerprint === "string" &&
    typeof value.reason === "string" &&
    value.reason.trim().length > 0 &&
    typeof value.expiresAt === "string"
  );
}

function buildListEntry(record: ManagedSuppressionRecord): SuppressionListEntry {
  if (record.status === "invalid" && isInvalidField(record.invalidField)) {
    return {
      index: record.index,
      status: record.status,
      invalidField: record.invalidField
    };
  }

  if (
    (record.status === "active" || record.status === "expired") &&
    isValidSuppressionSummary(record)
  ) {
    return {
      index: record.index,
      status: record.status,
      fingerprint: record.fingerprint,
      reason: record.reason,
      expiresAt: record.expiresAt
    };
  }

  return {
    index: record.index,
    status: "invalid",
    invalidField: "record"
  };
}

function buildMutationSummary(
  value: unknown
): InvalidSuppressionSummary | ValidSuppressionSummary {
  if (isObject(value) && isInvalidField(value.invalidField)) {
    return {
      invalidField: value.invalidField
    };
  }

  if (isValidSuppressionSummary(value)) {
    return {
      fingerprint: value.fingerprint,
      reason: value.reason,
      expiresAt: value.expiresAt
    };
  }

  return { invalidField: "record" };
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
    const entry = buildListEntry(suppression);

    if (entry.status === "invalid") {
      lines.push(`[${entry.index}] INVALID ${entry.invalidField}`);
      continue;
    }

    lines.push(
      `[${entry.index}] ${entry.status.toUpperCase()} ${entry.fingerprint}`
    );
    lines.push(`  Reason: ${entry.reason}`);
    lines.push(`  Expires: ${entry.expiresAt}`);
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
