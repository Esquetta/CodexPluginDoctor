export type SuppressionRecordField =
  | "record"
  | "fingerprint"
  | "reason"
  | "expiresAt";

export interface ValidSuppressionRecord {
  valid: true;
  fingerprint: string;
  reason: string;
  expiresAt: string;
}

export interface InvalidSuppressionRecord {
  valid: false;
  field: SuppressionRecordField;
}

type ActiveSuppressionRecord = ValidSuppressionRecord & {
  status: "active";
};

type ExpiredSuppressionRecord = ValidSuppressionRecord & {
  status: "expired";
};

type InvalidClassifiedSuppressionRecord = InvalidSuppressionRecord & {
  status: "invalid";
};

export type ClassifiedSuppressionRecord =
  | ActiveSuppressionRecord
  | ExpiredSuppressionRecord
  | InvalidClassifiedSuppressionRecord;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRealDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateSuppressionRecord(
  value: unknown
): ValidSuppressionRecord | InvalidSuppressionRecord {
  if (!isPlainObject(value)) {
    return { valid: false, field: "record" };
  }

  if (
    typeof value.fingerprint !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.fingerprint)
  ) {
    return { valid: false, field: "fingerprint" };
  }

  if (typeof value.reason !== "string" || value.reason.trim().length === 0) {
    return { valid: false, field: "reason" };
  }

  if (typeof value.expiresAt !== "string" || !isRealDate(value.expiresAt)) {
    return { valid: false, field: "expiresAt" };
  }

  return {
    valid: true,
    fingerprint: value.fingerprint,
    reason: value.reason.trim(),
    expiresAt: value.expiresAt
  };
}

export function isSuppressionExpired(expiresAt: string, now: Date): boolean {
  const expirationBoundary = Date.parse(`${expiresAt}T00:00:00.000Z`) + 86_400_000;
  return now.getTime() >= expirationBoundary;
}

export function classifySuppressionRecord(
  value: unknown,
  now: Date
): ClassifiedSuppressionRecord {
  const validation = validateSuppressionRecord(value);

  if (!validation.valid) {
    return {
      status: "invalid",
      ...validation
    };
  }

  if (isSuppressionExpired(validation.expiresAt, now)) {
    return {
      status: "expired",
      ...validation
    };
  }

  return {
    status: "active",
    ...validation
  };
}
