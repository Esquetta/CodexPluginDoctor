const MAX_SSE_FIELD_BYTES = 1_024;

export interface SseObservation {
  complete: boolean;
  eventId: string | null;
  retryMs: number | null;
  malformed: boolean;
}

function isSafeEventId(value: Buffer): boolean {
  return value.length > 0
    && value.length <= MAX_SSE_FIELD_BYTES
    && value.every((byte) => byte >= 0x21 && byte <= 0x7e);
}

function parseRetry(value: Buffer): number | null {
  if (value.length === 0 || value.length > MAX_SSE_FIELD_BYTES) {
    return null;
  }

  for (const byte of value) {
    if (byte < 0x30 || byte > 0x39) {
      return null;
    }
  }

  const retryMs = Number(value.toString("ascii"));
  return Number.isSafeInteger(retryMs) ? retryMs : null;
}

export function observeFirstSseEvent(body: Buffer): SseObservation {
  let eventId: string | null = null;
  let retryMs: number | null = null;
  let malformed = false;
  let lineStart = 0;

  for (let index = 0; index < body.length; index += 1) {
    if (body[index] !== 0x0a) {
      continue;
    }

    const lineEnd = index > lineStart && body[index - 1] === 0x0d ? index - 1 : index;
    const line = body.subarray(lineStart, lineEnd);
    lineStart = index + 1;

    if (line.length === 0) {
      return {
        complete: true,
        eventId: malformed ? null : eventId,
        retryMs: malformed ? null : retryMs,
        malformed
      };
    }
    if (line[0] === 0x3a) {
      continue;
    }

    const separator = line.indexOf(0x3a);
    const field = separator === -1 ? line : line.subarray(0, separator);
    const valueStart = separator === -1 ? line.length : separator + 1;
    const value = line.subarray(valueStart + (line[valueStart] === 0x20 ? 1 : 0));

    if (field.equals(Buffer.from("id"))) {
      if (value.length === 0) {
        eventId = null;
      } else if (isSafeEventId(value)) {
        eventId = value.toString("ascii");
      } else {
        malformed = true;
      }
    } else if (field.equals(Buffer.from("retry"))) {
      const parsedRetryMs = parseRetry(value);
      if (parsedRetryMs !== null) {
        retryMs = parsedRetryMs;
      }
    }
  }

  return { complete: false, eventId: null, retryMs: null, malformed: false };
}
