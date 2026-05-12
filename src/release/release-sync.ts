export interface GitHubReleaseSyncState {
  tagName: string;
  isDraft: boolean;
  isPrerelease: boolean;
}

export interface ReleaseSyncEvaluationInput {
  version: string;
  npmVersion: string;
  npmDistTag?: string;
  remoteTagOutput: string;
  githubRelease: GitHubReleaseSyncState | null;
  latestReleaseTag: string;
  expectPrerelease?: boolean;
  requireLatestRelease?: boolean;
}

export interface ReleaseSyncCheck {
  id: string;
  status: "pass" | "fail";
  message: string;
}

export interface ReleaseSyncReport {
  version: string;
  status: "pass" | "fail";
  checks: ReleaseSyncCheck[];
}

function buildCheck(id: string, status: "pass" | "fail", message: string): ReleaseSyncCheck {
  return {
    id,
    status,
    message
  };
}

export function evaluateReleaseSync(
  input: ReleaseSyncEvaluationInput
): ReleaseSyncReport {
  const expectedTag = `v${input.version}`;
  const npmDistTag = input.npmDistTag ?? "latest";
  const expectPrerelease = input.expectPrerelease ?? false;
  const requireLatestRelease = input.requireLatestRelease ?? !expectPrerelease;
  const checks: ReleaseSyncCheck[] = [];

  checks.push(
    input.npmVersion === input.version
      ? buildCheck("npm.version", "pass", `npm ${npmDistTag} is ${input.version}.`)
      : buildCheck(
          "npm.version",
          "fail",
          `npm ${npmDistTag} is ${input.npmVersion || "missing"}, expected ${input.version}.`
        )
  );

  checks.push(
    input.remoteTagOutput.includes(`refs/tags/${expectedTag}`)
      ? buildCheck("git.remote_tag", "pass", `Remote tag ${expectedTag} exists.`)
      : buildCheck("git.remote_tag", "fail", `Remote tag ${expectedTag} is missing.`)
  );

  const releaseMatches =
    input.githubRelease?.tagName === expectedTag &&
    !input.githubRelease.isDraft &&
    input.githubRelease.isPrerelease === expectPrerelease;

  checks.push(
    releaseMatches
      ? buildCheck(
          "github.release",
          "pass",
          expectPrerelease
            ? `GitHub prerelease ${expectedTag} is published.`
            : `GitHub release ${expectedTag} is published.`
        )
      : buildCheck(
          "github.release",
          "fail",
          input.githubRelease
            ? `GitHub release state is tag=${input.githubRelease.tagName}, draft=${input.githubRelease.isDraft}, prerelease=${input.githubRelease.isPrerelease}; expected ${expectPrerelease ? "published prerelease" : "published release"} ${expectedTag}.`
            : `GitHub release ${expectedTag} is missing.`
        )
  );

  checks.push(
    !requireLatestRelease
      ? buildCheck(
          "github.latest_release",
          "pass",
          `GitHub latest release does not need to be ${expectedTag} for this prerelease verification.`
        )
      : input.latestReleaseTag === expectedTag
      ? buildCheck("github.latest_release", "pass", `GitHub latest release is ${expectedTag}.`)
      : buildCheck(
          "github.latest_release",
          "fail",
          `GitHub latest release is ${input.latestReleaseTag || "missing"}, expected ${expectedTag}.`
        )
  );

  return {
    version: input.version,
    status: checks.some((check) => check.status === "fail") ? "fail" : "pass",
    checks
  };
}

export function renderReleaseSyncReport(report: ReleaseSyncReport): string {
  const lines = [
    "Release Sync Verification",
    "=========================",
    `Version: ${report.version}`,
    `Status: ${report.status.toUpperCase()}`
  ];

  for (const check of report.checks) {
    lines.push("", `${check.status === "pass" ? "ok" : "x"} ${check.id}`);
    lines.push(`  ${check.message}`);
  }

  return lines.join("\n");
}
