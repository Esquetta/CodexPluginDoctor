import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP, SocketAddress } from "node:net";

export interface ResolvedRemoteTarget {
  hostname: string;
  address: string;
  family: 4 | 6;
  local: boolean;
}

export interface RemoteLookup {
  (hostname: string, options: { all: true; verbatim: true }): Promise<Array<{
    address: string;
    family: 4 | 6;
  }>>;
}

export interface ResolveRemoteTargetOptions {
  allowLocalNetwork?: boolean;
  lookup?: RemoteLookup;
}

export class RemoteNetworkPolicyError extends Error {
  constructor(
    readonly code:
      | "REMOTE_TARGET_EMPTY"
      | "REMOTE_TARGET_FORBIDDEN"
      | "REMOTE_TARGET_INVALID_ADDRESS"
      | "REMOTE_TARGET_LOOKUP_FAILED"
      | "REMOTE_TARGET_URL_INVALID",
    message: string
  ) {
    super(message);
    this.name = "RemoteNetworkPolicyError";
  }
}

const blockedAddresses = new BlockList();
const loopbackAddresses = new BlockList();
const mappedIpv4Addresses = new BlockList();
const ipv4CompatibleAddresses = new BlockList();

function addIpv4Subnet(address: string, prefix: number): void {
  blockedAddresses.addSubnet(address, prefix, "ipv4");
  blockedAddresses.addSubnet(`::ffff:${address}`, prefix + 96, "ipv6");
}

function addLoopbackSubnet(address: string, prefix: number): void {
  loopbackAddresses.addSubnet(address, prefix, "ipv4");
  loopbackAddresses.addSubnet(`::ffff:${address}`, prefix + 96, "ipv6");
}

for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const) {
  addIpv4Subnet(address, prefix);
}

addLoopbackSubnet("127.0.0.0", 8);
blockedAddresses.addAddress("100.100.100.200", "ipv4");
blockedAddresses.addAddress("100.100.100.100", "ipv4");

for (const [address, prefix] of [
  ["::", 128],
  ["100::", 64],
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
  ["5f00::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

loopbackAddresses.addAddress("::1", "ipv6");
mappedIpv4Addresses.addSubnet("::ffff:0:0", 96, "ipv6");
ipv4CompatibleAddresses.addSubnet("::", 96, "ipv6");

for (const [address, prefix] of [
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100:0:0:1::", 64]
] as const) {
  blockedAddresses.addSubnet(address, prefix, "ipv6");
}

function normalizeAddress(address: string, family: number): { address: string; family: 4 | 6 } {
  if ((family !== 4 && family !== 6) || isIP(address) !== family) {
    throw new RemoteNetworkPolicyError(
      "REMOTE_TARGET_INVALID_ADDRESS",
      "Remote target DNS resolution returned an invalid address."
    );
  }

  const normalized = new SocketAddress({
    address,
    port: 0,
    family: family === 4 ? "ipv4" : "ipv6"
  });

  return { address: normalized.address, family };
}

function isListed(address: string, family: 4 | 6, list: BlockList): boolean {
  return list.check(address, family === 4 ? "ipv4" : "ipv6");
}

export async function resolveRemoteTarget(
  url: URL,
  options: ResolveRemoteTargetOptions = {}
): Promise<ResolvedRemoteTarget> {
  const hostname = url.hostname.startsWith("[") && url.hostname.endsWith("]")
    ? url.hostname.slice(1, -1)
    : url.hostname;
  if ((url.protocol !== "http:" && url.protocol !== "https:") || !hostname || isIP(hostname) !== 0) {
    throw new RemoteNetworkPolicyError(
      "REMOTE_TARGET_URL_INVALID",
      "Remote target URL must use HTTP or HTTPS with a hostname, not an IP address literal."
    );
  }

  const lookup: RemoteLookup = options.lookup ?? (async (hostname, lookupOptions) => {
    const answers = await dnsLookup(hostname, lookupOptions);
    return answers.map((answer) => ({
      address: answer.address,
      family: answer.family as 4 | 6
    }));
  });
  let answers: Array<{ address: string; family: 4 | 6 }>;
  try {
    answers = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new RemoteNetworkPolicyError(
      "REMOTE_TARGET_LOOKUP_FAILED",
      "Remote target DNS resolution failed."
    );
  }

  if (answers.length === 0) {
    throw new RemoteNetworkPolicyError(
      "REMOTE_TARGET_EMPTY",
      "Remote target DNS resolution returned no addresses."
    );
  }

  const normalizedAnswers = answers.map((answer) => normalizeAddress(answer.address, answer.family));
  for (const answer of normalizedAnswers) {
    const isLoopback = isListed(answer.address, answer.family, loopbackAddresses);
    const isMappedIpv4 = answer.family === 6 && isListed(answer.address, answer.family, mappedIpv4Addresses);
    const isIpv4Compatible = answer.family === 6 && isListed(answer.address, answer.family, ipv4CompatibleAddresses);
    const isForbidden = isListed(answer.address, answer.family, blockedAddresses)
      || isIpv4Compatible
      || (isMappedIpv4 && !isLoopback);
    if ((isForbidden && !isLoopback) || (isLoopback && !options.allowLocalNetwork)) {
      throw new RemoteNetworkPolicyError(
        "REMOTE_TARGET_FORBIDDEN",
        "Remote target resolved to a forbidden address."
      );
    }
  }

  const selected = normalizedAnswers[0];
  return {
    hostname,
    address: selected.address,
    family: selected.family,
    local: isListed(selected.address, selected.family, loopbackAddresses)
  };
}
