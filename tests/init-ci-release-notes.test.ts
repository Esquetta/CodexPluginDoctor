import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { initToolsDiffWorkflow } from "../src/core/init-ci.js";

const execFileAsync = promisify(execFile);
const bashExecutable = process.platform === "win32" ? "C:\\Program Files\\Git\\bin\\bash.exe" : "bash";
const MARKER = "<!-- codex-plugin-doctor:mcp-surface-changes -->";
const NOTES = "## MCP surface changes\n\n### Compatible\n\n- Added tool `\"search\"`\n";
const TRUNCATED = "\n\n_Truncated; run doctor mcp-snapshot-diff --changelog locally for the full release notes._\n";

function toBashPath(value: string): string {
  return value.replace(/\\/gu, "/");
}

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", ["-c", "user.name=test", "-c", "user.email=test@example.test", ...args], { cwd });
}

/**
 * A repository whose tags v0 (no baseline), v1, v2-rc1, v2, and v3 (baseline removed) follow each other on
 * main, with v1.1 as a backport on top of v1, plus fake gh and npx commands that record their calls, around
 * the three scripts of the generated release jobs.
 */
async function releaseNotesFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-plugin-doctor-release-notes-"));
  roots.push(root);
  const repo = path.join(root, "repo");
  const bin = path.join(root, "bin");
  const temp = path.join(root, "temp");
  await Promise.all([mkdir(path.join(repo, "mcp", "baseline"), { recursive: true }), mkdir(bin), mkdir(temp)]);

  const target = path.join(root, "target");
  await initToolsDiffWorkflow(target, {
    server: "srv", baseline: "mcp/tools.json", sandbox: null, promptsBaseline: null, resourceTemplatesBaseline: null, snapshotBaselineDir: "mcp/baseline"
  });
  const workflow = parse(await readFile(path.join(target, ".github", "workflows", "codex-plugin-doctor-tools.yml"), "utf8")) as {
    jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
  };
  const scripts = {
    find: workflow.jobs["release-notes"].steps.find((step) => step.name === "Find the release before this one")?.run,
    notes: workflow.jobs["release-notes"].steps.find((step) => step.name === "Write the MCP surface changes since that release")?.run,
    publish: workflow.jobs["publish-release-notes"].steps.find((step) => step.run)?.run
  };
  for (const [name, script] of Object.entries(scripts)) await writeFile(path.join(root, `${name}.sh`), script ?? "", "utf8");

  const manifest = path.join(repo, "mcp", "baseline", "mcp-snapshot-manifest.json");
  const commit = async (message: string, tag: string, release: string | null) => {
    if (release === null) await rm(path.join(repo, "mcp"), { recursive: true, force: true });
    else await writeFile(manifest, `{"release":"${release}"}\n`, "utf8");
    await git(repo, "add", "-A");
    await git(repo, "commit", "-qm", message);
    await git(repo, "tag", tag);
  };
  await git(repo, "init", "-q");
  await writeFile(path.join(repo, "README.md"), "server\n", "utf8");
  await git(repo, "add", "README.md");
  await git(repo, "commit", "-qm", "server");
  await git(repo, "tag", "v0");
  await commit("baseline", "v1", "v1");
  await commit("candidate", "v2-rc1", "v2-rc1");
  await commit("release", "v2", "v2");
  await commit("remove the baseline", "v3", null);
  await git(repo, "checkout", "-q", "v1");
  await commit("backport", "v1.1", "v1.1");

  await writeFile(path.join(bin, "gh"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/gh.log"
case "$1 $2" in
  api\\ *) printf '%s\\n' "$FAKE_RELEASES" ;;
  "release view") cat "$FAKE_DIR/body.md" ;;
  "release edit") cp "$4" "$FAKE_DIR/body.md" ;;
  *) exit 9 ;;
esac
`, "utf8");
  // Records the comparison and the manifest it was given as the earlier release's baseline.
  await writeFile(path.join(bin, "npx"), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$FAKE_DIR/npx.log"
cat "$6/mcp-snapshot-manifest.json" >> "$FAKE_DIR/npx.log"
cat "$FAKE_DIR/changelog.md"
exit "\${FAKE_NPX_EXIT:-1}"
`, "utf8");
  await Promise.all([chmod(path.join(bin, "gh"), 0o755), chmod(path.join(bin, "npx"), 0o755)]);
  await writeFile(path.join(temp, "body.md"), "Bug fixes.\n", "utf8");
  await writeFile(path.join(temp, "changelog.md"), NOTES, "utf8");

  const run = async (script: keyof typeof scripts, checkout: string, environment: Record<string, string>) => {
    await git(repo, "checkout", "-q", checkout);
    await writeFile(path.join(temp, "github-output"), "", "utf8");
    const result = await execFileAsync(bashExecutable, ["--noprofile", "--norc", "-eo", "pipefail", toBashPath(path.join(root, `${script}.sh`))], {
      cwd: repo,
      env: {
        ...process.env,
        PATH: `${toBashPath(bin)}:${process.env.PATH ?? ""}`,
        FAKE_DIR: toBashPath(temp),
        RUNNER_TEMP: toBashPath(temp),
        GITHUB_OUTPUT: toBashPath(path.join(temp, "github-output")),
        GH_REPO: "owner/repo",
        BASELINE_DIR: "mcp/baseline",
        DOCTOR: "codex-plugin-doctor@0.0.0",
        NOTES: toBashPath(path.join(temp, "notes.md")),
        ...environment
      }
    });
    return { ...result, output: await readFile(path.join(temp, "github-output"), "utf8") };
  };
  const read = async (name: string) => readFile(path.join(temp, name), "utf8").catch(() => "");
  const write = async (name: string, content: string) => writeFile(path.join(temp, name), content, "utf8");
  return { run, read, write, temp };
}

const RELEASES = ["v3 false", "v2 false", "v2-rc1 true", "v1 false", "v0 false"].join("\n");
// A backport published after newer releases is listed above them.
const WITH_BACKPORT = ["v1.1 false", RELEASES].join("\n");

describe("init-ci release notes jobs", () => {
  it.each([
    ["a stable release skips prereleases", "v2", "false", RELEASES, "v1"],
    ["a release after an earlier backport skips it", "v2", "false", ["v2 false", "v1.1 false", "v2-rc1 true", "v1 false"].join("\n"), "v1"],
    ["a prerelease is compared with the release it was built on", "v2-rc1", "true", RELEASES, "v1"],
    ["a backport is compared with its own line, not with newer releases", "v1.1", "false", WITH_BACKPORT, "v1"],
    ["a release after a stable one", "v3", "false", WITH_BACKPORT, "v2"],
    ["the first release has nothing to compare with", "v0", "false", RELEASES, ""]
  ])("finds the release before it: %s", async (_case, tag, prerelease, releases, previous) => {
    const fixture = await releaseNotesFixture();

    const result = await fixture.run("find", tag, { TAG: tag, PRERELEASE: prerelease, FAKE_RELEASES: releases });
    expect(result.output).toBe(`tag=${previous}\n`);
    if (previous === "") expect(result.stdout).toContain(`No earlier release of ${tag} among the 100 newest releases to compare with.`);
    expect(await fixture.read("gh.log")).toMatch(/^api repos\/owner\/repo\/releases\?per_page=100 --jq .+\n$/u);
  });

  it("fails when the release is not among the listed releases", async () => {
    const fixture = await releaseNotesFixture();

    await expect(fixture.run("find", "v2", { TAG: "v2", PRERELEASE: "false", FAKE_RELEASES: "v1 false" }))
      .rejects.toMatchObject({ code: 1, stderr: "v2 is not among the 100 newest releases.\n" });
  });

  it("writes the release notes from the earlier release's baseline, extracted at its tag", async () => {
    const fixture = await releaseNotesFixture();

    const result = await fixture.run("notes", "v2", { PREVIOUS: "v1" });
    expect(result.output).toBe("written=true\n");
    expect(await fixture.read("mcp-release-notes/notes.md")).toBe(NOTES);
    const npx = await fixture.read("npx.log");
    expect(npx).toContain(`--yes codex-plugin-doctor@0.0.0 doctor mcp-snapshot-diff --before ${toBashPath(fixture.temp)}/mcp-baseline-before/mcp/baseline --after mcp/baseline --changelog`);
    expect(npx).toContain("{\"release\":\"v1\"}");
  });

  it.each([
    ["the earlier release has no baseline", "v1", "v0"],
    ["this release has no baseline", "v3", "v2"]
  ])("writes no release notes when %s", async (_case, checkout, previous) => {
    const fixture = await releaseNotesFixture();

    const result = await fixture.run("notes", checkout, { PREVIOUS: previous });
    expect(result.stdout).toContain(`This release or ${previous} has no snapshot baseline in mcp/baseline.`);
    expect(result.output).toBe("");
    expect(await fixture.read("npx.log")).toBe("");
  });

  it("fails when the comparison writes no release notes", async () => {
    const fixture = await releaseNotesFixture();
    await fixture.write("changelog.md", "");

    await expect(fixture.run("notes", "v2", { PREVIOUS: "v1", FAKE_NPX_EXIT: "2" }))
      .rejects.toMatchObject({ code: 1, stderr: "The comparison wrote no release notes.\n" });
  });

  it("adds the notes below the release's own notes, and a rerun replaces them", async () => {
    const fixture = await releaseNotesFixture();
    await fixture.write("notes.md", NOTES);

    await fixture.run("publish", "v2", { TAG: "v2" });
    const body = await fixture.read("body.md");
    expect(body).toBe(`Bug fixes.\n${MARKER}\n${NOTES}`);
    expect(await fixture.read("gh.log")).toBe(`release view --json body --jq .body -- v2\nrelease edit --notes-file ${toBashPath(fixture.temp)}/release-notes.md -- v2\n`);

    await fixture.run("publish", "v2", { TAG: "v2" });
    expect(await fixture.read("body.md")).toBe(body);
  });

  it("replaces only the section an earlier run added in a body saved with CRLF, keeping a quoted marker", async () => {
    const fixture = await releaseNotesFixture();
    await fixture.write("notes.md", NOTES);
    const quoted = ["Intro", "```", MARKER, "```", "More"];
    await fixture.write("body.md", [...quoted, MARKER, "## MCP surface changes", "", "Old notes.", ""].join("\r\n"));

    await fixture.run("publish", "v2", { TAG: "v2" });
    expect(await fixture.read("body.md")).toBe([...quoted, MARKER, ""].join("\n") + NOTES);

    await fixture.write("body.md", [...quoted, ""].join("\n"));
    await fixture.run("publish", "v2", { TAG: "v2" });
    expect(await fixture.read("body.md")).toBe([...quoted, MARKER, ""].join("\n") + NOTES);
  });

  it("cuts the notes to fit next to the release's own notes, and fails when nothing fits", async () => {
    const fixture = await releaseNotesFixture();
    await fixture.write("notes.md", `## MCP surface changes\n\n${"- Added tool `\"x\"`\n".repeat(4000)}`);

    await fixture.run("publish", "v2", { TAG: "v2" });
    const body = await fixture.read("body.md");
    expect(body.length).toBeLessThan(61_000);
    expect(body.endsWith(TRUNCATED)).toBe(true);

    await fixture.write("body.md", "x".repeat(119_500));
    await expect(fixture.run("publish", "v2", { TAG: "v2" }))
      .rejects.toMatchObject({ code: 1, stderr: "The release notes leave no room for the MCP surface changes.\n" });
    expect((await fixture.read("body.md")).length).toBe(119_500);
  });

  it("refuses a downloaded file that is not release notes", async () => {
    const fixture = await releaseNotesFixture();
    await fixture.write("notes.md", "Visit https://example.test\n");

    await expect(fixture.run("publish", "v2", { TAG: "v2" }))
      .rejects.toMatchObject({ code: 1, stderr: "The downloaded file is not MCP surface release notes.\n" });
    expect(await fixture.read("gh.log")).toBe("");
  });
});
