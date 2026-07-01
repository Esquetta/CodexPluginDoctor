import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertFreshInstallAudit,
  assertVersionIsPublishable
} from "../scripts/release-check.mjs";

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

describe("release check fresh install audit gate", () => {
  it("installs the packed tarball in a fresh project and audits it", () => {
    const tempDirectory = path.join("tmp", "release-check-temp");
    const run = vi.fn((command: string, args: string[]) => {
      if (command === "npm" && args.includes("pack")) {
        return JSON.stringify([{ filename: "codex-plugin-doctor-1.35.0.tgz" }]);
      }

      if (command === "npx") {
        return "1.35.0";
      }

      return "";
    });

    assertFreshInstallAudit("1.35.0", {
      run,
      tempDirectory
    });

    expect(run).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["pack", "--json", "--pack-destination", tempDirectory],
      { capture: true }
    );
    expect(run).toHaveBeenCalledWith("npm", ["init", "-y"], {
      cwd: tempDirectory
    });
    expect(run).toHaveBeenCalledWith(
      "npm",
      [
        "install",
        "--no-fund",
        "--no-audit",
        path.join(tempDirectory, "codex-plugin-doctor-1.35.0.tgz")
      ],
      { cwd: tempDirectory }
    );
    expect(run).toHaveBeenCalledWith(
      "npx",
      ["--no-install", "codex-plugin-doctor", "--version"],
      { cwd: tempDirectory, capture: true }
    );
    expect(run).toHaveBeenCalledWith("npm", ["audit", "--audit-level=low"], {
      cwd: tempDirectory
    });
  });

  it("rejects a tarball install that resolves the wrong binary version", () => {
    const tempDirectory = path.join("tmp", "release-check-temp");
    const run = vi.fn((command: string, args: string[]) => {
      if (command === "npm" && args.includes("pack")) {
        return JSON.stringify([{ filename: "codex-plugin-doctor-1.35.0.tgz" }]);
      }

      if (command === "npx") {
        return "1.34.1";
      }

      return "";
    });

    expect(() =>
      assertFreshInstallAudit("1.35.0", {
        run,
        tempDirectory
      })
    ).toThrow("Fresh install resolved 1.34.1 instead of 1.35.0.");
  });
});
