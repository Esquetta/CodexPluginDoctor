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
});
