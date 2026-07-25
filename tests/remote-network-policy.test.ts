import { describe, expect, it } from "vitest";

import {
  RemoteNetworkPolicyError,
  resolveRemoteTarget,
  type RemoteLookup
} from "../src/core/remote-network-policy.js";

function lookupFor(addresses: Array<{ address: string; family: 4 | 6 }>): RemoteLookup {
  return async () => addresses;
}

describe("resolveRemoteTarget", () => {
  it("uses an all-address lookup and selects the first approved public IPv4 address", async () => {
    let lookupOptions: { all?: boolean; verbatim?: boolean } | undefined;
    const target = await resolveRemoteTarget(new URL("https://mcp.example/mcp"), {
      lookup: async (_hostname, options) => {
        lookupOptions = options;
        return [
          { address: "8.8.8.8", family: 4 },
          { address: "1.1.1.1", family: 4 }
        ];
      }
    });

    expect(lookupOptions).toMatchObject({ all: true, verbatim: true });
    expect(target).toEqual({
      hostname: "mcp.example",
      address: "8.8.8.8",
      family: 4,
      local: false
    });
  });

  it("accepts public IPv6", async () => {
    await expect(
      resolveRemoteTarget(new URL("https://mcp.example/mcp"), {
        lookup: lookupFor([{ address: "2606:4700:4700::1111", family: 6 }])
      })
    ).resolves.toMatchObject({ address: "2606:4700:4700::1111", family: 6, local: false });
  });

  it("allows loopback only with explicit opt-in", async () => {
    const options = { lookup: lookupFor([{ address: "127.0.0.1", family: 4 }]) };

    await expect(resolveRemoteTarget(new URL("http://mcp.test/mcp"), options)).rejects.toMatchObject({
      code: "REMOTE_TARGET_FORBIDDEN",
      message: "Remote target resolved to a forbidden address."
    });
    await expect(
      resolveRemoteTarget(new URL("http://mcp.test/mcp"), { ...options, allowLocalNetwork: true })
    ).resolves.toMatchObject({ address: "127.0.0.1", family: 4, local: true });
  });

  it.each([
    ["RFC1918", "10.0.0.1", 4],
    ["link-local", "169.254.10.1", 4],
    ["unspecified", "0.0.0.0", 4],
    ["multicast", "239.1.2.3", 4],
    ["reserved IPv4", "240.0.0.1", 4],
    ["documentation IPv4", "198.51.100.10", 4],
    ["metadata", "169.254.169.254", 4],
    ["IPv6 unique local", "fc00::1", 6],
    ["IPv6 link-local", "fe80::1", 6],
    ["IPv6 multicast", "ff02::1", 6],
    ["IPv6 unspecified", "::", 6],
    ["IPv6 documentation", "2001:db8::1", 6],
    ["mapped private IPv4", "::ffff:10.0.0.1", 6]
  ])("rejects %s destinations", async (_name, address, family) => {
    await expect(
      resolveRemoteTarget(new URL("https://mcp.example/mcp"), {
        lookup: lookupFor([{ address, family: family as 4 | 6 }])
      })
    ).rejects.toBeInstanceOf(RemoteNetworkPolicyError);
  });

  it("rejects a hostname when any DNS answer is forbidden", async () => {
    await expect(
      resolveRemoteTarget(new URL("https://mcp.example/mcp"), {
        lookup: lookupFor([
          { address: "8.8.8.8", family: 4 },
          { address: "192.168.1.1", family: 4 }
        ])
      })
    ).rejects.toMatchObject({ code: "REMOTE_TARGET_FORBIDDEN" });
  });

  it("fails closed when DNS returns no answers", async () => {
    await expect(
      resolveRemoteTarget(new URL("https://mcp.example/mcp"), { lookup: lookupFor([]) })
    ).rejects.toMatchObject({
      code: "REMOTE_TARGET_EMPTY",
      message: "Remote target DNS resolution returned no addresses."
    });
  });

  it("returns a deterministic error when DNS lookup fails", async () => {
    await expect(
      resolveRemoteTarget(new URL("https://mcp.example/mcp"), {
        lookup: async () => { throw new Error("resolver-specific failure"); }
      })
    ).rejects.toMatchObject({
      code: "REMOTE_TARGET_LOOKUP_FAILED",
      message: "Remote target DNS resolution failed."
    });
  });
});
