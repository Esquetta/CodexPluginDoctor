import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";

import { requestBoundedHttp } from "../src/core/bounded-http-client.js";
import type { RemoteLookup } from "../src/core/remote-network-policy.js";

const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

async function startServer(handler: Parameters<typeof createServer>[0]): Promise<number> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return (server.address() as AddressInfo).port;
}

function localLookup(): RemoteLookup {
  return async () => [{ address: "127.0.0.1", family: 4 }];
}

function options(port: number) {
  return {
    allowLocalNetwork: true,
    lookup: localLookup(),
    url: `http://mcp.test:${port}/mcp`
  };
}

describe("requestBoundedHttp", () => {
  it("returns only safe response headers and sends an allowed request body", async () => {
    const port = await startServer((request, response) => {
      expect(request.method).toBe("POST");
      expect(request.headers["mcp-session-id"]).toBe("session-1");
      expect(request.headers["content-type"]).toBe("application/json");
      let body = "";
      request.setEncoding("utf8");
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        expect(body).toBe('{"ping":true}');
        response.writeHead(200, {
          "content-type": "application/json",
          "mcp-session-id": "session-2",
          "mcp-protocol-version": "2025-11-25",
          "set-cookie": "secret=value",
          "x-internal": "hidden"
        });
        response.end('{"ok":true}');
      });
    });

    const result = await requestBoundedHttp(options(port).url, {
      ...options(port),
      method: "POST",
      body: '{"ping":true}',
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "MCP-Session-Id": "session-1"
      }
    });

    expect(result).toEqual({
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "mcp-session-id": "session-2",
        "mcp-protocol-version": "2025-11-25"
      },
      body: Buffer.from('{"ok":true}')
    });
  });

  it.each(["Authorization", "Proxy-Authorization", "Cookie", "Set-Cookie", "Host", "Connection", "Transfer-Encoding", "Content-Length", "X-Unapproved"])(
    "rejects caller header %s",
    async (header) => {
      await expect(
        requestBoundedHttp("http://mcp.test:1/mcp", {
          allowLocalNetwork: true,
          lookup: localLookup(),
          headers: { [header]: "value" }
        })
      ).rejects.toMatchObject({
        code: "REMOTE_HTTP_HEADER_FORBIDDEN",
        message: `Remote HTTP request header is not allowed: ${header.toLowerCase()}.`
      });
    }
  );

  it.each([
    ["a case-variant duplicate", { Accept: "application/json", accept: "text/plain" }],
    ["an array value", { Accept: ["application/json"] }],
    ["a CRLF value", { Accept: "application/json\r\nX-Injected: yes" }],
    ["a non-string value", { Accept: 1 }]
  ])("rejects %s request header", async (_name, headers) => {
    await expect(
      requestBoundedHttp("http://mcp.test:1/mcp", {
        allowLocalNetwork: true,
        lookup: localLookup(),
        headers: headers as never
      })
    ).rejects.toMatchObject({ code: "REMOTE_HTTP_HEADER_FORBIDDEN" });
  });

  it("canonicalizes allowed request header names", async () => {
    const port = await startServer((request, response) => {
      expect(request.rawHeaders).toContain("accept");
      response.end("ok");
    });

    await expect(requestBoundedHttp(options(port).url, {
      ...options(port),
      headers: { Accept: "application/json" }
    })).resolves.toMatchObject({ body: Buffer.from("ok") });
  });

  it.each([
    ["timeoutMs", 0],
    ["timeoutMs", -1],
    ["timeoutMs", 3_001],
    ["timeoutMs", Infinity],
    ["timeoutMs", Number.NaN],
    ["maxResponseBytes", 0],
    ["maxResponseBytes", -1],
    ["maxResponseBytes", 1_048_577],
    ["maxResponseBytes", Infinity],
    ["maxResponseBytes", Number.NaN]
  ])("rejects invalid %s values", async (name, value) => {
    await expect(requestBoundedHttp("http://mcp.test:1/mcp", {
      allowLocalNetwork: true,
      lookup: localLookup(),
      [name]: value
    })).rejects.toMatchObject({
      code: "REMOTE_HTTP_OPTIONS_INVALID",
      message: "Remote HTTP request options are invalid."
    });
  });

  it("uses the timeout as a wall-clock deadline while DNS is unresolved", async () => {
    const startedAt = Date.now();

    await expect(requestBoundedHttp("http://mcp.test/mcp", {
      lookup: async () => new Promise(() => undefined),
      timeoutMs: 20
    })).rejects.toMatchObject({
      code: "REMOTE_HTTP_TIMEOUT",
      message: "Remote HTTP request timed out."
    });

    expect(Date.now() - startedAt).toBeLessThan(500);
  });

  it("rejects redirects without following them and retains only the safe location", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(302, { location: "https://elsewhere.test/mcp", "set-cookie": "secret=value" });
      response.end();
    });

    await expect(requestBoundedHttp(options(port).url, options(port))).rejects.toMatchObject({
      code: "REMOTE_HTTP_REDIRECT",
      message: "Remote HTTP redirects are not allowed.",
      statusCode: 302,
      headers: { location: "https://elsewhere.test/mcp" }
    });
  });

  it("rejects compressed responses", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200, { "content-encoding": "gzip" });
      response.end("not decompressed");
    });

    await expect(requestBoundedHttp(options(port).url, options(port))).rejects.toMatchObject({
      code: "REMOTE_HTTP_ENCODING_UNSUPPORTED",
      message: "Remote HTTP response content encoding must be identity."
    });
  });

  it("aborts responses that exceed the configured byte limit", async () => {
    const port = await startServer((_request, response) => {
      response.writeHead(200);
      response.end("too-large");
    });

    await expect(requestBoundedHttp(options(port).url, { ...options(port), maxResponseBytes: 4 })).rejects.toMatchObject({
      code: "REMOTE_HTTP_RESPONSE_TOO_LARGE",
      message: "Remote HTTP response exceeded the configured size limit."
    });
  });

  it("times out a non-responsive request", async () => {
    const port = await startServer(() => undefined);

    await expect(requestBoundedHttp(options(port).url, { ...options(port), timeoutMs: 20 })).rejects.toMatchObject({
      code: "REMOTE_HTTP_TIMEOUT",
      message: "Remote HTTP request timed out."
    });
  });

  it("uses the DNS-pinned local target", async () => {
    const port = await startServer((_request, response) => response.end("ok"));

    await expect(requestBoundedHttp(options(port).url, options(port))).resolves.toMatchObject({
      statusCode: 200,
      body: Buffer.from("ok")
    });
  });

  it("never reuses a loopback socket after DNS changes to a public target", async () => {
    let requests = 0;
    const port = await startServer((_request, response) => {
      requests += 1;
      response.end("loopback");
    });
    let lookupCalls = 0;
    const rebindingLookup: RemoteLookup = async () => {
      lookupCalls += 1;
      return [{ address: lookupCalls === 1 ? "127.0.0.1" : "8.8.8.8", family: 4 }];
    };
    const url = `http://mcp.test:${port}/mcp`;

    await expect(requestBoundedHttp(url, {
      allowLocalNetwork: true,
      lookup: rebindingLookup
    })).resolves.toMatchObject({ body: Buffer.from("loopback") });

    await expect(requestBoundedHttp(url, {
      lookup: rebindingLookup,
      timeoutMs: 20,
      body: "must-not-reach-loopback"
    })).rejects.toBeDefined();
    expect(requests).toBe(1);
  });
});
