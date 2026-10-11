import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = process.argv[2];

if (!version) {
  console.error("Usage: node scripts/extract-release-notes.mjs <version>");
  process.exit(2);
}

const { extractReleaseSection } = await import("../dist/release/release-notes.js");
const section = extractReleaseSection(readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"), version);

if (section === null) {
  console.error(`CHANGELOG.md has no section for ${version}.`);
  process.exit(1);
}

// The release title already names the version, so the "## [x.y.z] - date" heading is dropped.
process.stdout.write(`${section.split("\n").slice(1).join("\n").trim()}\n`);
