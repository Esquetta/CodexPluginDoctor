type JsonObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrorResponse(message: JsonObject): boolean {
  return isPlainObject(message.error);
}

function getErrorObject(message: JsonObject): JsonObject | null {
  return isErrorResponse(message) ? (message.error as JsonObject) : null;
}

function isSensitiveKey(key: string): boolean {
  return /(token|secret|password|api[_-]?key|private[_-]?key|sig|signature|auth|session)/i.test(
    key
  );
}

function looksLikeToken(value: string): boolean {
  return /(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+\.[A-Za-z0-9._-]+)/.test(
    value
  );
}

function sanitizeUriQuery(value: string): JsonObject | null {
  try {
    const uri = new URL(value);
    const sanitizedQuery = Object.fromEntries(
      Array.from(uri.searchParams.entries()).map(([key, queryValue]) => [
        key,
        isSensitiveKey(key) || looksLikeToken(queryValue)
          ? "[REDACTED]"
          : queryValue
      ])
    );

    if (Object.keys(sanitizedQuery).length === 0) {
      return null;
    }

    return sanitizedQuery;
  } catch {
    return null;
  }
}

export function sanitizeTranscriptValue(
  value: unknown,
  pathSegments: string[] = []
): unknown {
  const currentKey = pathSegments[pathSegments.length - 1];

  if (typeof value === "string") {
    if (currentKey === "uri") {
      const query = sanitizeUriQuery(value);

      if (query) {
        return {
          uri: value.split("?")[0],
          query
        };
      }
    }

    if (
      currentKey === "text" ||
      currentKey === "blob" ||
      currentKey === "data" ||
      currentKey === "diff" ||
      currentKey === "arguments" ||
      isSensitiveKey(currentKey ?? "") ||
      pathSegments.includes("arguments") ||
      looksLikeToken(value)
    ) {
      return "[REDACTED]";
    }

    if (value.length > 80) {
      return "[TRUNCATED]";
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((entry, index) =>
      sanitizeTranscriptValue(entry, [...pathSegments, String(index)])
    );
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        key,
        sanitizeTranscriptValue(entryValue, [...pathSegments, key])
      ])
    );
  }

  return value;
}

export function formatRequestTranscript(
  method: string,
  params: JsonObject | undefined
): string {
  if (!params) {
    return `-> ${method}`;
  }

  return `-> ${method} ${JSON.stringify(sanitizeTranscriptValue(params))}`;
}

export function formatResponseTranscript(
  method: string,
  message: JsonObject
): string {
  const error = getErrorObject(message);

  if (error) {
    const code = typeof error.code === "number" ? error.code : "?";
    const messageText =
      typeof error.message === "string"
        ? sanitizeTranscriptValue(error.message, ["error", "message"])
        : "error";

    return `<- ${method} error ${JSON.stringify({
      code,
      message: messageText
    })}`;
  }

  if (!isPlainObject(message.result)) {
    return `<- ${method} result`;
  }

  const result = message.result;

  switch (method) {
    case "initialize":
      return `<- initialize ${JSON.stringify({
        protocolVersion: result.protocolVersion,
        capabilities: isPlainObject(result.capabilities)
          ? Object.keys(result.capabilities)
          : []
      })}`;
    case "tools/list":
      return `<- tools/list ${JSON.stringify({
        tools: Array.isArray(result.tools) ? result.tools.length : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "tools/call":
      return `<- tools/call ${JSON.stringify({
        content: Array.isArray(result.content) ? result.content.length : 0
      })}`;
    case "resources/list":
      return `<- resources/list ${JSON.stringify({
        resources: Array.isArray(result.resources) ? result.resources.length : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "resources/read":
      return `<- resources/read ${JSON.stringify({
        contents: Array.isArray(result.contents) ? result.contents.length : 0
      })}`;
    case "resources/templates/list":
      return `<- resources/templates/list ${JSON.stringify({
        resourceTemplates: Array.isArray(result.resourceTemplates)
          ? result.resourceTemplates.length
          : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "prompts/list":
      return `<- prompts/list ${JSON.stringify({
        prompts: Array.isArray(result.prompts) ? result.prompts.length : 0,
        nextCursor:
          typeof result.nextCursor === "string" ? "[CURSOR]" : undefined
      })}`;
    case "prompts/get":
      return `<- prompts/get ${JSON.stringify({
        messages: Array.isArray(result.messages) ? result.messages.length : 0
      })}`;
    default:
      return `<- ${method}`;
  }
}
