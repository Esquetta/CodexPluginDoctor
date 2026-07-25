export interface RemoteUrlInspection {
  parsedUrl: URL | null;
  sanitizedUrl: string | null;
  isLoopbackHost: boolean;
  issues: Array<
    | "invalid"
    | "unsupported_scheme"
    | "credentials"
    | "query"
    | "fragment"
    | "ip_literal"
    | "insecure_non_loopback"
  >;
}

function isIpLiteral(hostname: string): boolean {
  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    /^\[[0-9a-f:.]+\]$/i.test(hostname)
  );
}

export function inspectRemoteMcpUrl(rawUrl: string): RemoteUrlInspection {
  let parsedUrl: URL;

  try {
    parsedUrl = new URL(rawUrl);
  } catch {
    return {
      parsedUrl: null,
      sanitizedUrl: null,
      isLoopbackHost: false,
      issues: ["invalid"]
    };
  }

  const issues: RemoteUrlInspection["issues"] = [];
  const isSupportedScheme = parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:";
  const isAbsoluteHttpUrl = /^https?:\/\//i.test(rawUrl);
  const isLoopbackHost = parsedUrl.hostname.toLowerCase() === "localhost";

  if (!isSupportedScheme) {
    issues.push("unsupported_scheme");
  } else if (!isAbsoluteHttpUrl || !parsedUrl.hostname) {
    issues.push("invalid");
  }

  if (parsedUrl.username || parsedUrl.password) {
    issues.push("credentials");
  }

  if (parsedUrl.search || rawUrl.includes("?")) {
    issues.push("query");
  }

  if (parsedUrl.hash || rawUrl.includes("#")) {
    issues.push("fragment");
  }

  if (isIpLiteral(parsedUrl.hostname)) {
    issues.push("ip_literal");
  }

  if (parsedUrl.protocol === "http:" && !isLoopbackHost) {
    issues.push("insecure_non_loopback");
  }

  return {
    parsedUrl,
    sanitizedUrl: `${parsedUrl.origin}${parsedUrl.pathname}`,
    isLoopbackHost,
    issues
  };
}
