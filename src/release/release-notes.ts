export function extractReleaseSection(
  changelog: string,
  version: string
): string | null {
  const lines = changelog.split(/\r?\n/);
  const sectionHeader = `## [${version}]`;
  const startIndex = lines.findIndex((line) => line.startsWith(sectionHeader));

  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.length;

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (lines[index].startsWith("## [")) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex, endIndex).join("\n").trim();
}

export function buildReleaseCandidateNotes(input: {
  version: string;
  generatedAt: string;
  validationTarget: string;
  runtimeTarget: string;
  packageFilename: string;
  changelogSection: string | null;
}): string {
  const {
    version,
    generatedAt,
    validationTarget,
    runtimeTarget,
    packageFilename,
    changelogSection
  } = input;

  return [
    `# Release Candidate ${version}`,
    "",
    `Generated at: ${generatedAt}`,
    "",
    "## Package Artifact",
    "",
    `- Tarball: \`${packageFilename}\``,
    "",
    "## Validation Targets",
    "",
    `- Static target: \`${validationTarget}\``,
    `- Runtime target: \`${runtimeTarget}\``,
    "",
    "## Included Release Notes",
    "",
    changelogSection ?? "_No changelog section found for this version._",
    "",
    "## Validation Checklist",
    "",
    "- `npm test`",
    "- `npm run build`",
    "- `npm run prepare-release`",
    "- local validation artifacts generated",
    "- tarball generated for inspection",
    ""
  ].join("\n");
}
