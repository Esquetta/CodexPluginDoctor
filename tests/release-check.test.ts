import path from "node:path";
import { readFile } from "node:fs/promises";

import { describe, expect, it, vi } from "vitest";

import {
  assertFreshInstallAudit,
  assertSecuritySelfScan,
  assertUpdateCheckSmoke,
  assertVersionIsPublishable,
  parsePackedTarballFilename
} from "../scripts/release-check.mjs";

describe("release check registry version gate", () => {
  it("keeps package and lockfile roots on the 1.58.0 release version", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      version: string;
    };
    const packageLock = JSON.parse(await readFile("package-lock.json", "utf8")) as {
      version: string;
      packages: { "": { version: string } };
    };

    expect(packageJson.version).toBe("1.58.0");
    expect(packageLock.version).toBe(packageJson.version);
    expect(packageLock.packages[""].version).toBe(packageJson.version);
  });

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
  it("reads npm pack metadata from npm 10 through npm 12", () => {
    const metadata = { filename: "codex-plugin-doctor-1.50.0.tgz" };

    expect(parsePackedTarballFilename(JSON.stringify([metadata]))).toBe(metadata.filename);
    expect(
      parsePackedTarballFilename(JSON.stringify({ "codex-plugin-doctor": metadata }))
    ).toBe(metadata.filename);
    expect(() => parsePackedTarballFilename("null")).toThrow(
      "npm pack did not return tarball metadata."
    );
  });

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

describe("release check update smoke gate", () => {
  it("accepts a clean update-check smoke output", () => {
    const run = vi.fn(() =>
      [
        "Codex Plugin Doctor Update Check",
        "Installed: 1.37.0",
        "Latest: 1.37.0",
        "Status: UP TO DATE"
      ].join("\n")
    );

    assertUpdateCheckSmoke("1.37.0", { run });

    expect(run).toHaveBeenCalledWith(
      "node",
      ["dist/cli.js", "doctor", "--update-check"],
      { capture: true, includeStderr: true }
    );
  });

  it("rejects update-check output with a Node shell warning", () => {
    const run = vi.fn(() => "Status: UP TO DATE\n(node:1) [DEP0190] warning");

    expect(() => assertUpdateCheckSmoke("1.37.0", { run })).toThrow("DEP0190");
  });
});

describe("release check security self-scan gate", () => {
  it("accepts a clean child_process self-scan", async () => {
    await expect(assertSecuritySelfScan({ scan: async () => [] })).resolves.toBeUndefined();
  });

  it("rejects risky child_process findings before publish", async () => {
    await expect(
      assertSecuritySelfScan({
        scan: async () => [
          {
            id: "plugin.security.child_process_shell",
            severity: "fail",
            message: "shell enabled",
            impact: "risk",
            suggestedFix: "remove shell"
          }
        ]
      })
    ).rejects.toThrow("Security self-scan found risky child_process usage");
  });
});
