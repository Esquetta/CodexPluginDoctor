import { describe, expect, it } from "vitest";

import {
  buildFindingFingerprint,
  withFindingFingerprint,
  withFindingFingerprints
} from "../src/reporting/finding-fingerprint.js";
import type { Finding } from "../src/domain/types.js";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "plugin.security.path_traversal_risk",
    severity: "fail",
    message: "A configured path escapes the package root.",
    impact: "The package can read files outside its reviewed boundary.",
    suggestedFix: "Keep the path inside the package root.",
    ...overrides
  };
}

describe("finding fingerprints", () => {
  it("is stable when evidence keys use a different insertion order", () => {
    const left = finding({
      evidence: {
        serverName: "danger",
        configuredPath: "../outside/config.json",
        resolvedPath: "C:\\repo\\outside\\config.json"
      }
    });
    const right = finding({
      evidence: {
        resolvedPath: "C:\\repo\\outside\\config.json",
        configuredPath: "../outside/config.json",
        serverName: "danger"
      }
    });

    expect(buildFindingFingerprint(left, "C:\\repo\\plugin")).toBe(
      buildFindingFingerprint(right, "C:\\repo\\plugin")
    );
  });

  it("normalizes package roots and path separators", () => {
    const windowsFinding = finding({
      evidence: {
        configPath: "C:\\Users\\alice\\plugin\\.mcp.json",
        resolvedPath: "C:\\Users\\alice\\plugin\\config\\server.json"
      }
    });
    const posixFinding = finding({
      evidence: {
        configPath: "/home/bob/plugin/.mcp.json",
        resolvedPath: "/home/bob/plugin/config/server.json"
      }
    });

    expect(buildFindingFingerprint(windowsFinding, "C:\\Users\\alice\\plugin")).toBe(
      buildFindingFingerprint(posixFinding, "/home/bob/plugin")
    );
  });

  it("changes when the rule ID or identity-bearing evidence changes", () => {
    const original = finding({ evidence: { serverName: "alpha" } });
    const otherRule = finding({
      id: "plugin.security.cwd_outside_root",
      evidence: { serverName: "alpha" }
    });
    const otherServer = finding({ evidence: { serverName: "beta" } });

    expect(buildFindingFingerprint(original, "C:\\repo\\plugin")).not.toBe(
      buildFindingFingerprint(otherRule, "C:\\repo\\plugin")
    );
    expect(buildFindingFingerprint(original, "C:\\repo\\plugin")).not.toBe(
      buildFindingFingerprint(otherServer, "C:\\repo\\plugin")
    );
  });

  it("ignores editorial finding text and supports rule-only findings", () => {
    const original = finding();
    const edited = finding({
      severity: "warn",
      message: "Edited message.",
      impact: "Edited impact.",
      suggestedFix: "Edited fix."
    });

    expect(buildFindingFingerprint(original, "C:\\repo\\plugin")).toBe(
      buildFindingFingerprint(edited, "D:\\different\\plugin")
    );
    expect(buildFindingFingerprint(original, "C:\\repo\\plugin")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns enriched copies without mutating input findings", () => {
    const original = finding({
      evidence: {
        envKey: "OPENAI_API_KEY",
        envValue: "[REDACTED]"
      }
    });

    const enriched = withFindingFingerprint(original, "C:\\repo\\plugin");
    const enrichedList = withFindingFingerprints([original], "C:\\repo\\plugin");

    expect(original.fingerprint).toBeUndefined();
    expect(enriched).not.toBe(original);
    expect(enriched.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(enriched.evidence?.envValue).toBe("[REDACTED]");
    expect(enrichedList).toEqual([enriched]);
  });
});
