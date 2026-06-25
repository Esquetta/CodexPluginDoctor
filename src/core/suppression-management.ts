import type { RawDoctorConfig } from "./doctor-config-store.js";
import {
  classifySuppressionRecord,
  isValidSuppressionFingerprint,
  type SuppressionRecordField,
  validateSuppressionRecord
} from "./suppression-record.js";

export interface ManagedSuppressionRecord {
  index: number;
  status: "active" | "expired" | "invalid";
  fingerprint?: string;
  reason?: string;
  expiresAt?: string;
  invalidField?: SuppressionRecordField;
}

export interface SuppressionMutationResult {
  config: RawDoctorConfig;
  index: number;
  suppression: unknown;
}

export interface SuppressionPruneResult {
  config: RawDoctorConfig;
  removed: ManagedSuppressionRecord[];
}

export type SuppressionManagementErrorCode =
  | "suppression_non_array"
  | "suppression_invalid_record"
  | "suppression_duplicate_fingerprint"
  | "suppression_invalid_index"
  | "suppression_invalid_fingerprint"
  | "suppression_fingerprint_not_found"
  | "suppression_fingerprint_ambiguous";

type SuppressionManagementErrorDetails = {
  code: SuppressionManagementErrorCode;
  field?: SuppressionRecordField;
  index?: number;
  indexes?: number[];
};

export class SuppressionManagementError extends Error {
  readonly code: SuppressionManagementErrorCode;
  readonly field?: SuppressionRecordField;
  readonly index?: number;
  readonly indexes?: number[];

  constructor(message: string, details: SuppressionManagementErrorDetails) {
    super(message);
    this.name = "SuppressionManagementError";
    this.code = details.code;
    this.field = details.field;
    this.index = details.index;
    this.indexes = details.indexes;
  }
}

function createSuppressionManagementError(
  message: string,
  details: SuppressionManagementErrorDetails
): SuppressionManagementError {
  return new SuppressionManagementError(message, details);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readSuppressions(
  config: RawDoctorConfig
): { suppressions: unknown[]; hasSuppressions: boolean } {
  if (!("suppressions" in config)) {
    return {
      suppressions: [],
      hasSuppressions: false
    };
  }

  const { suppressions } = config;

  if (!Array.isArray(suppressions)) {
    throw createSuppressionManagementError(
      "Doctor config suppressions must be an array when present.",
      {
        code: "suppression_non_array"
      }
    );
  }

  return {
    suppressions,
    hasSuppressions: true
  };
}

function copyConfigWithSuppressions(
  config: RawDoctorConfig,
  suppressions: unknown[]
): RawDoctorConfig {
  return {
    ...config,
    suppressions
  };
}

function buildManagedInvalidSuppression(
  index: number,
  invalidField: SuppressionRecordField
): ManagedSuppressionRecord {
  return {
    index,
    status: "invalid",
    invalidField
  };
}

function buildRemovedSuppressionSummary(suppression: unknown): unknown {
  const classified = classifySuppressionRecord(suppression, new Date(0));

  if (classified.status === "invalid") {
    return {
      invalidField: classified.field
    };
  }

  return {
    fingerprint: classified.fingerprint,
    reason: classified.reason,
    expiresAt: classified.expiresAt
  };
}

function findDuplicateFingerprintIndex(
  suppressions: unknown[],
  fingerprint: string
): number {
  return suppressions.findIndex(
    (suppression) =>
      isPlainObject(suppression) &&
      typeof suppression.fingerprint === "string" &&
      suppression.fingerprint === fingerprint
  );
}

function validateManagedFingerprint(fingerprint: string): string {
  if (!isValidSuppressionFingerprint(fingerprint)) {
    throw createSuppressionManagementError("Suppression fingerprint is invalid.", {
      code: "suppression_invalid_fingerprint"
    });
  }

  return fingerprint;
}

function findFingerprintMatches(
  suppressions: unknown[],
  fingerprint: string
): number[] {
  return suppressions.flatMap((suppression, index) =>
    isPlainObject(suppression) &&
    typeof suppression.fingerprint === "string" &&
    suppression.fingerprint === fingerprint
      ? [index]
      : []
  );
}

export function listSuppressions(
  config: RawDoctorConfig,
  now: Date = new Date()
): ManagedSuppressionRecord[] {
  const { suppressions, hasSuppressions } = readSuppressions(config);

  if (!hasSuppressions) {
    return [];
  }

  return suppressions.map((suppression, index) => {
    const classified = classifySuppressionRecord(suppression, now);

    if (classified.status === "invalid") {
      return buildManagedInvalidSuppression(index, classified.field);
    }

    return {
      index,
      status: classified.status,
      fingerprint: classified.fingerprint,
      reason: classified.reason,
      expiresAt: classified.expiresAt
    };
  });
}

export function addSuppression(
  config: RawDoctorConfig,
  record: unknown
): SuppressionMutationResult {
  const { suppressions } = readSuppressions(config);
  const validation = validateSuppressionRecord(record);

  if (!validation.valid) {
    throw createSuppressionManagementError(
      `Suppression record is invalid: ${validation.field}.`,
      {
        code: "suppression_invalid_record",
        field: validation.field
      }
    );
  }

  const duplicateIndex = findDuplicateFingerprintIndex(
    suppressions,
    validation.fingerprint
  );

  if (duplicateIndex >= 0) {
    throw createSuppressionManagementError(
      `Suppression fingerprint already exists at index ${duplicateIndex}.`,
      {
        code: "suppression_duplicate_fingerprint",
        index: duplicateIndex
      }
    );
  }

  const suppression = {
    fingerprint: validation.fingerprint,
    reason: validation.reason,
    expiresAt: validation.expiresAt
  };
  const nextSuppressions = [...suppressions, suppression];

  return {
    config: copyConfigWithSuppressions(config, nextSuppressions),
    index: suppressions.length,
    suppression
  };
}

export function removeSuppressionByIndex(
  config: RawDoctorConfig,
  index: number
): SuppressionMutationResult {
  const { suppressions } = readSuppressions(config);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= suppressions.length
  ) {
    throw createSuppressionManagementError(
      "Suppression index must be an integer within range.",
      {
        code: "suppression_invalid_index",
        index
      }
    );
  }

  const suppression = suppressions[index];
  const nextSuppressions = [
    ...suppressions.slice(0, index),
    ...suppressions.slice(index + 1)
  ];

  return {
    config: copyConfigWithSuppressions(config, nextSuppressions),
    index,
    suppression: buildRemovedSuppressionSummary(suppression)
  };
}

export function removeSuppressionByFingerprint(
  config: RawDoctorConfig,
  fingerprint: string
): SuppressionMutationResult {
  const { suppressions } = readSuppressions(config);
  const validFingerprint = validateManagedFingerprint(fingerprint);
  const matches = findFingerprintMatches(suppressions, validFingerprint);

  if (matches.length === 0) {
    throw createSuppressionManagementError("Suppression fingerprint not found.", {
      code: "suppression_fingerprint_not_found"
    });
  }

  if (matches.length > 1) {
    throw createSuppressionManagementError(
      `Suppression fingerprint matches multiple suppressions at indexes: ${matches.join(", ")}.`,
      {
        code: "suppression_fingerprint_ambiguous",
        indexes: matches
      }
    );
  }

  return removeSuppressionByIndex(config, matches[0]);
}

export function pruneSuppressions(
  config: RawDoctorConfig,
  now: Date = new Date()
): SuppressionPruneResult {
  const { suppressions } = readSuppressions(config);
  const managedSuppressions = listSuppressions(config, now);
  const removed = managedSuppressions.filter(
    (suppression) => suppression.status !== "active"
  );
  const removedIndexes = new Set(removed.map((suppression) => suppression.index));
  const nextSuppressions = suppressions.filter(
    (_suppression, index) => !removedIndexes.has(index)
  );

  return {
    config: copyConfigWithSuppressions(config, nextSuppressions),
    removed
  };
}
