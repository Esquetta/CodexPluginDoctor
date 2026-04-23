import { describe, expect, it } from "vitest";

import {
  buildReleaseCandidateNotes,
  extractReleaseSection
} from "../src/release/release-notes.js";

describe("extractReleaseSection", () => {
  it("extracts the matching version section from the changelog", () => {
    const changelog = `
# Changelog

## [0.1.0] - 2026-04-22

Initial release notes.

## [0.0.9] - 2026-04-20

Older release.
`.trim();

    expect(extractReleaseSection(changelog, "0.1.0")).toContain(
      "Initial release notes."
    );
  });
});

describe("buildReleaseCandidateNotes", () => {
  it("builds a release candidate notes document", () => {
    const notes = buildReleaseCandidateNotes({
      version: "0.1.0",
      generatedAt: "2026-04-23T12:00:00Z",
      validationTarget: "examples/codex-doctor-runtime",
      runtimeTarget: "examples/codex-doctor-runtime",
      packageFilename: "codex-plugin-doctor-0.1.0.tgz",
      changelogSection: "## [0.1.0] - 2026-04-22\n\nInitial release notes."
    });

    expect(notes).toContain("# Release Candidate 0.1.0");
    expect(notes).toContain("codex-plugin-doctor-0.1.0.tgz");
    expect(notes).toContain("examples/codex-doctor-runtime");
    expect(notes).toContain("Initial release notes.");
  });
});

