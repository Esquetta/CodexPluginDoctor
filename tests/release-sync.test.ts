import { describe, expect, it } from "vitest";

import { evaluateReleaseSync } from "../src/release/release-sync.js";

describe("evaluateReleaseSync", () => {
  it("passes when npm, remote tag, GitHub release, and latest release match", () => {
    const report = evaluateReleaseSync({
      version: "0.10.1",
      npmVersion: "0.10.1",
      remoteTagOutput: "abc123\trefs/tags/v0.10.1",
      githubRelease: {
        tagName: "v0.10.1",
        isDraft: false,
        isPrerelease: false
      },
      latestReleaseTag: "v0.10.1"
    });

    expect(report.status).toBe("pass");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "npm.version", status: "pass" }),
        expect.objectContaining({ id: "git.remote_tag", status: "pass" }),
        expect.objectContaining({ id: "github.release", status: "pass" }),
        expect.objectContaining({ id: "github.latest_release", status: "pass" })
      ])
    );
  });

  it("fails when any release surface is stale or missing", () => {
    const report = evaluateReleaseSync({
      version: "0.10.1",
      npmVersion: "0.10.0",
      remoteTagOutput: "",
      githubRelease: {
        tagName: "v0.10.1",
        isDraft: true,
        isPrerelease: false
      },
      latestReleaseTag: "v0.10.0"
    });

    expect(report.status).toBe("fail");
    expect(report.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "npm.version", status: "fail" }),
        expect.objectContaining({ id: "git.remote_tag", status: "fail" }),
        expect.objectContaining({ id: "github.release", status: "fail" }),
        expect.objectContaining({ id: "github.latest_release", status: "fail" })
      ])
    );
  });
});
