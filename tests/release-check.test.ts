import { describe, expect, it, vi } from "vitest";

import { assertVersionIsPublishable } from "../scripts/release-check.mjs";

describe("release check registry version gate", () => {
  it("rejects the target version when that exact version is published but latest differs", () => {
    const run = vi.fn((_command: string, args: string[]) =>
      args.includes("codex-plugin-doctor@1.28.0") ? "1.28.0" : "1.27.0"
    );

    expect(() =>
      assertVersionIsPublishable("1.28.0", { run, allowPublished: false })
    ).toThrow("Version 1.28.0 is already published.");
  });

  it("accepts npm E404 for an unpublished exact version", () => {
    const run = vi.fn(() => {
      throw new Error("npm view failed: npm error code E404");
    });

    expect(() =>
      assertVersionIsPublishable("1.28.0", { run, allowPublished: false })
    ).not.toThrow();
  });

  it("propagates registry errors other than an unpublished exact version", () => {
    const run = vi.fn(() => {
      throw new Error("npm view failed: npm error code E401");
    });

    expect(() =>
      assertVersionIsPublishable("1.28.0", { run, allowPublished: false })
    ).toThrow("npm error code E401");
  });

  it("allows an existing exact version when explicitly requested", () => {
    const run = vi.fn(() => "1.28.0");

    expect(() =>
      assertVersionIsPublishable("1.28.0", { run, allowPublished: true })
    ).not.toThrow();
  });
});
