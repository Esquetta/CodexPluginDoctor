import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import type {
  CheckOptions,
  CheckResult,
  DiscoveredPackage,
  Finding,
  FindingEvidence
} from "../domain/types.js";
import { withFindingFingerprints } from "../reporting/finding-fingerprint.js";
import { discoverPackage } from "./discover-package.js";
import { probeRuntime } from "./runtime-probe.js";

function buildFailure(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  evidence?: FindingEvidence
): Finding {
  return {
    id,
    severity: "fail",
    message,
    impact,
    suggestedFix,
    ...(evidence ? { evidence } : {})
  };
}

function buildWarning(
  id: string,
  message: string,
  impact: string,
  suggestedFix: string,
  evidence?: FindingEvidence
): Finding {
  return {
    id,
    severity: "warn",
    message,
    impact,
    suggestedFix,
    ...(evidence ? { evidence } : {})
  };
}

async function directoryExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    const details = await stat(targetPath);
    return details.isFile();
  } catch {
    return false;
  }
}

async function readPackageName(rootPath: string): Promise<string | null> {
  const packageJsonPath = path.join(rootPath, "package.json");

  try {
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as {
      name?: unknown;
    };

    return typeof packageJson.name === "string" ? packageJson.name : null;
  } catch {
    return null;
  }
}

async function buildMissingManifestFailure(rootPath: string): Promise<Finding> {
  const packageName = await readPackageName(rootPath);

  if (packageName === "codex-plugin-doctor") {
    return buildFailure(
      "plugin.manifest.missing",
      "This looks like the Codex Plugin Doctor source repo, not a Codex plugin package.",
      "Codex Plugin Doctor validates plugin package roots that contain `.codex-plugin/plugin.json`; the tool source repo intentionally does not expose that manifest.",
      "For a local self-test, run `codex-plugin-doctor check examples/codex-doctor-runtime --runtime --no-animations`. To check your own plugin, pass that plugin package root instead."
    );
  }

  if (packageName) {
    return buildFailure(
      "plugin.manifest.missing",
      "This directory has a `package.json`, but it does not look like a Codex plugin package.",
      "Codex cannot treat a normal project directory as a plugin package without the required `.codex-plugin/plugin.json` entry point.",
      "Run from a Codex plugin package root, or pass the path to a directory that contains `.codex-plugin/plugin.json`."
    );
  }

  return buildFailure(
    "plugin.manifest.missing",
    "This directory does not look like a Codex plugin package.",
    "Codex cannot treat this directory as a plugin package without the required `.codex-plugin/plugin.json` manifest entry point.",
    "Create `.codex-plugin/plugin.json` with at least `name`, `version`, and `description`, or pass the path to an existing Codex plugin package."
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPathWithinRoot(rootPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(rootPath, candidatePath);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
  );
}

function relativePackagePath(rootPath: string, targetPath: string): string {
  return path.relative(rootPath, targetPath).replace(/\\/g, "/") || ".";
}

function isSensitiveKey(key: string): boolean {
  return /(token|secret|password|api[_-]?key|private[_-]?key)/i.test(key);
}

function looksLikeLiteralSecret(value: string): boolean {
  const trimmed = value.trim();

  if (trimmed.length < 12) {
    return false;
  }

  if (/^\$\{?[A-Z0-9_]+\}?$/i.test(trimmed)) {
    return false;
  }

  return true;
}

function parseSkillFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);

  if (!match) {
    return null;
  }

  const lines = match[1].split(/\r?\n/);
  const entries: [string, string][] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }

    const separatorIndex = line.indexOf(":");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();

    if (!key || !rawValue) {
      continue;
    }

    const blockScalarMatch = rawValue.match(/^([|>])[+-]?$/);

    if (blockScalarMatch) {
      const blockLines: string[] = [];
      let blockIndex = index + 1;

      for (; blockIndex < lines.length; blockIndex += 1) {
        const blockLine = lines[blockIndex];

        if (blockLine.trim() !== "" && !/^\s/.test(blockLine)) {
          break;
        }

        blockLines.push(blockLine.replace(/^\s{2}/, ""));
      }

      const value =
        blockScalarMatch[1] === ">"
          ? blockLines.join("\n").replace(/\n[ \t]*\n/g, "\n\n").replace(/\n/g, " ").trim()
          : blockLines.join("\n").trim();

      if (value) {
        entries.push([key, value]);
      }

      index = blockIndex - 1;
      continue;
    }

    const value = rawValue.replace(/^"([\s\S]*)"$/, "$1").replace(/^'([\s\S]*)'$/, "$1");

    if (value) {
      entries.push([key, value]);
    }
  }

  return Object.fromEntries(entries);
}

function countMatches(input: string, pattern: RegExp): number {
  const matches = input.match(pattern);

  return matches ? matches.length : 0;
}

function extractSupportAssetReferences(content: string): string[] {
  const references = [...content.matchAll(/`((?:scripts|templates|assets|examples)\/[^`]+)`/g)]
    .map((match) => match[1].trim())
    .filter((reference) => reference.length > 0);

  return [...new Set(references)];
}

function isDescriptionLikelyVerbose(
  description: string,
  mode: "plugin" | "skill"
): boolean {
  const trimmed = description.trim();
  const length = trimmed.length;

  const technicalSignals =
    countMatches(trimmed, /`[^`]+`/g) +
    countMatches(
      trimmed,
      /\b(MCP|SDK|CLI|API|JSON|schema|resource|resources|prompt|prompts|tool|tools|repo|repository|command|commands|connector|metadata|workflow|validation|inputs|outputs|GitHub|GraphQL|PR|review|Cloudflare|Workers|Wrangler|D1|R2|Vectorize|Queues|Workflows|Tunnel|Spectrum|WAF|DDoS|Terraform|Pulumi|Figma|FigJam|design system|component|components|variants|auto-layout|token|tokens|library|libraries|screen|screens|React|WebSocket)\b/gi
    );
  const productSignals = countMatches(
    trimmed,
    /\b(frontend|dashboard|dashboards|website|websites|hero|UI|browser|testing|Stripe|Checkout|PaymentIntents|Connect|billing|subscriptions|payment|payments|marketplace|marketplaces|Jira|Confluence|bug|bugs|issue|issues|ticket|tickets|backlog|Epic|Epics|status|report|reports|project|tasks|meeting|notes|action items|assignees|knowledge|documentation|deployment|authentication|infrastructure|architecture|duplicates|Postgres|database|databases|bills|costs|transfer|egress|query|queries|overfetching|SELECT|optimization|application|GSAP|animation|animations|animate|easing|stagger|timeline|timelines|playback|transforms|will-change|quickTo|video|videos|composition|compositions|title cards|overlays|captions|subtitles|voiceovers|audio|audio-reactive|visuals|scene|scenes|transitions|HTML|text-to-speech|music|highlighting|crossfades|wipes|shader|media|render|preview|transcribe|Canva|presentation|presentations|slide|slides|deck|brief|outline|design|designs|brand|brand kit|social media|Facebook|Instagram|LinkedIn|export-ready|formats|localized|translated|layout)\b/gi
  );
  const structuredSignals =
    countMatches(trimmed, /\(\d+\)/g) +
    countMatches(trimmed, /\b(Use when|When an agent needs to|Triggers:)\b/gi);
  const concreteSignals =
    technicalSignals + productSignals + structuredSignals;
  const vagueSignals = countMatches(
    trimmed,
    /\b(general|generally|many different|many|broad|various|different situations|possibilities|ideas|concepts|directions)\b/gi
  );

  if (mode === "plugin") {
    return length > 240;
  }

  if (length <= 240) {
    return false;
  }

  if (vagueSignals >= 4) {
    return true;
  }

  if (vagueSignals >= 2 && concreteSignals < 8) {
    return true;
  }

  if (concreteSignals >= 8 && vagueSignals <= 2 && length <= 650) {
    return false;
  }

  if (concreteSignals >= 12 && vagueSignals <= 2 && length <= 780) {
    return false;
  }

  if (technicalSignals >= 8 && vagueSignals <= 1 && length <= 760) {
    return false;
  }

  if (length >= 700) {
    return true;
  }

  if (technicalSignals >= 3 && vagueSignals === 0 && length <= 600) {
    return false;
  }

  if (technicalSignals >= 8 && vagueSignals <= 1 && length <= 420) {
    return false;
  }

  if (concreteSignals >= 4 && vagueSignals <= 1 && length <= 520) {
    return false;
  }

  if (technicalSignals >= 2 && vagueSignals === 0 && length <= 480) {
    return false;
  }

  return true;
}

function validateRequiredManifestFields(
  discoveredPackage: DiscoveredPackage
): Finding[] {
  const findings: Finding[] = [];
  const { manifest } = discoveredPackage;

  if (!manifest.name) {
    findings.push(
      buildFailure(
        "plugin.manifest.name.missing",
        "The plugin manifest is missing a `name` field.",
        "Codex cannot identify the plugin reliably without a stable package name.",
        "Add a kebab-case `name` field to `.codex-plugin/plugin.json`."
      )
    );
  }

  if (!manifest.version) {
    findings.push(
      buildFailure(
        "plugin.manifest.version.missing",
        "The plugin manifest is missing a `version` field.",
        "Release and compatibility workflows cannot reason about the package version.",
        "Add a semantic `version` field to `.codex-plugin/plugin.json`."
      )
    );
  }

  if (!manifest.description) {
    findings.push(
      buildFailure(
        "plugin.manifest.description.missing",
        "The plugin manifest is missing a `description` field.",
        "The package will be harder to understand and present in Codex surfaces.",
        "Add a concise `description` field to `.codex-plugin/plugin.json`."
      )
    );
  }

  if (
    manifest.description &&
    isDescriptionLikelyVerbose(manifest.description, "plugin")
  ) {
    findings.push(
      buildWarning(
        "plugin.heuristic.description.too_long",
        "The plugin manifest description is likely too verbose.",
        "Overly long metadata increases context cost and can dilute plugin discovery quality.",
        "Shorten the manifest description to a precise one- or two-sentence summary."
      )
    );
  }

  return findings;
}

async function validateSkillsDirectory(
  discoveredPackage: DiscoveredPackage
): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;

  if (!manifest.skills) {
    return [];
  }

  const skillsPath = path.resolve(rootPath, manifest.skills);

  if (!isPathWithinRoot(rootPath, skillsPath)) {
    return [
      buildFailure(
        "plugin.security.path_traversal",
        "The plugin manifest points the skills path outside the package root.",
        "Paths that escape the package root make the package harder to audit and can expose unintended files during packaging or validation.",
        "Keep the `skills` path inside the plugin root.",
        {
          manifestPath: relativePackagePath(rootPath, discoveredPackage.manifestPath),
          field: "skills",
          configuredPath: manifest.skills,
          resolvedPath: skillsPath
        }
      )
    ];
  }

  const exists = await directoryExists(skillsPath);

  if (exists) {
    return [];
  }

  return [
    buildFailure(
      "plugin.skills.path.missing",
      "The plugin manifest points to a missing skills directory.",
      "Codex will not be able to load the packaged skills as expected.",
      `Create the skills directory at \`${skillsPath}\` or update the manifest path.`
    )
  ];
}

async function validateSkillDefinitions(
  discoveredPackage: DiscoveredPackage
): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;

  if (!manifest.skills) {
    return [];
  }

  const skillsPath = path.resolve(rootPath, manifest.skills);

  if (!isPathWithinRoot(rootPath, skillsPath)) {
    return [];
  }

  const skillsDirectoryExists = await directoryExists(skillsPath);

  if (!skillsDirectoryExists) {
    return [];
  }

  const entries = await readdir(skillsPath, { withFileTypes: true });
  const skillDirectories = entries.filter((entry) => entry.isDirectory());
  const findings: Finding[] = [];

  for (const skillDirectory of skillDirectories) {
    const skillRoot = path.join(skillsPath, skillDirectory.name);
    const skillFilePath = path.join(skillRoot, "SKILL.md");
    const skillFileExists = await fileExists(skillFilePath);

    if (!skillFileExists) {
      findings.push(
        buildFailure(
          "plugin.skill.skill_md.missing",
          `The skill \`${skillDirectory.name}\` is missing \`SKILL.md\`.`,
          "Codex cannot load a skill directory that does not contain the required SKILL.md entrypoint.",
          `Add \`SKILL.md\` to \`${skillRoot}\` with at least \`name\` and \`description\` frontmatter.`
        )
      );
      continue;
    }

    const skillContent = await readFile(skillFilePath, "utf8");
    const frontmatter = parseSkillFrontmatter(skillContent);

    if (!frontmatter?.name) {
      findings.push(
        buildFailure(
          "plugin.skill.name.missing",
          `The skill \`${skillDirectory.name}\` is missing a \`name\` field in frontmatter.`,
          "Codex cannot expose skill metadata correctly without a stable skill name.",
          `Add a \`name\` field to the frontmatter in \`${skillFilePath}\`.`
        )
      );
    }

    if (!frontmatter?.description) {
      findings.push(
        buildFailure(
          "plugin.skill.description.missing",
          `The skill \`${skillDirectory.name}\` is missing a \`description\` field in frontmatter.`,
          "Codex uses skill descriptions for discovery and implicit matching, so missing descriptions reduce skill usability.",
          `Add a scoped \`description\` field to the frontmatter in \`${skillFilePath}\`.`
        )
      );
    }

    if (
      frontmatter?.description &&
      isDescriptionLikelyVerbose(frontmatter.description, "skill")
    ) {
      findings.push(
        buildWarning(
          "plugin.heuristic.skill_description.too_long",
          `The skill \`${skillDirectory.name}\` description is likely too verbose.`,
          "Overly long skill descriptions increase context cost and reduce the precision of skill matching.",
          `Shorten the \`description\` field in \`${skillFilePath}\` to a tightly scoped summary.`
        )
      );
    }

    for (const supportReference of extractSupportAssetReferences(skillContent)) {
      const supportPath = path.resolve(skillRoot, supportReference);
      const supportFileExists = await fileExists(supportPath);
      const supportDirectoryExists = await directoryExists(supportPath);

      if (!supportFileExists && !supportDirectoryExists) {
        findings.push(
          buildWarning(
            "plugin.skill.asset_reference.missing",
            `The skill \`${skillDirectory.name}\` references missing support asset \`${supportReference}\`.`,
            "Skills that point to missing scripts, templates, assets, or examples are harder to execute and can fail when an agent follows the instructions.",
            `Create \`${supportPath}\` or update the reference in \`${skillFilePath}\`.`
          )
        );
      }
    }
  }

  return findings;
}

async function validateMcpConfig(
  discoveredPackage: DiscoveredPackage
): Promise<Finding[]> {
  const { manifest, rootPath } = discoveredPackage;

  if (!manifest.mcpServers) {
    return [];
  }

  const mcpConfigPath = path.resolve(rootPath, manifest.mcpServers);

  if (!isPathWithinRoot(rootPath, mcpConfigPath)) {
    return [
      buildFailure(
        "plugin.security.path_traversal",
        "The plugin manifest points the MCP config path outside the package root.",
        "Paths that escape the package root make the package harder to audit and can expose unintended files during packaging or validation.",
        "Keep the `mcpServers` path inside the plugin root.",
        {
          manifestPath: relativePackagePath(rootPath, discoveredPackage.manifestPath),
          field: "mcpServers",
          configuredPath: manifest.mcpServers,
          resolvedPath: mcpConfigPath
        }
      )
    ];
  }

  const mcpConfigExists = await fileExists(mcpConfigPath);

  if (!mcpConfigExists) {
    return [
      buildFailure(
        "plugin.mcp.path.missing",
        "The plugin manifest points to a missing `.mcp.json` file.",
        "Codex cannot load bundled MCP server definitions if the referenced config file does not exist.",
        `Create \`${mcpConfigPath}\` or update the manifest \`mcpServers\` path.`
      )
    ];
  }

  let parsedConfig: unknown;

  try {
    parsedConfig = JSON.parse(await readFile(mcpConfigPath, "utf8"));
  } catch {
    return [
      buildFailure(
        "plugin.mcp.invalid_json",
        "The referenced `.mcp.json` file is not valid JSON.",
        "Codex will not be able to parse bundled MCP server configuration.",
        `Fix the JSON syntax in \`${mcpConfigPath}\`.`
      )
    ];
  }

  if (!isPlainObject(parsedConfig)) {
    return [
      buildFailure(
        "plugin.mcp.invalid_shape",
        "The referenced `.mcp.json` file must contain a JSON object.",
        "Codex expects bundled MCP configuration to be object-shaped so server entries can be resolved reliably.",
        `Wrap the MCP configuration in a top-level object inside \`${mcpConfigPath}\`.`
      )
    ];
  }

  const servers = parsedConfig.mcpServers;

  if (!isPlainObject(servers) || Object.keys(servers).length === 0) {
    return [
      buildFailure(
        "plugin.mcp.invalid_shape",
        "The referenced `.mcp.json` file must contain a non-empty `mcpServers` object.",
        "Without a valid `mcpServers` object, Codex cannot discover the bundled MCP server definitions.",
        `Define bundled servers under \`mcpServers\` in \`${mcpConfigPath}\`.`
      )
    ];
  }

  const findings: Finding[] = [];

  for (const [serverName, serverConfig] of Object.entries(servers)) {
    if (!isPlainObject(serverConfig)) {
      findings.push(
        buildFailure(
          "plugin.mcp.server.invalid",
          `The MCP server \`${serverName}\` must be configured as an object.`,
          "Codex cannot interpret a server entry unless it is represented as an object with server options.",
          `Change the \`${serverName}\` entry in \`${mcpConfigPath}\` to an object.`
        )
      );
      continue;
    }

    const command = serverConfig.command;
    const url = serverConfig.url;
    const env = serverConfig.env;

    if (typeof command !== "string" && typeof url !== "string") {
      findings.push(
        buildFailure(
          "plugin.mcp.server.transport.missing",
          `The MCP server \`${serverName}\` must define either \`command\` or \`url\`.`,
          "Codex needs a process command for STDIO servers or a URL for streamable HTTP servers.",
          `Add either \`command\` or \`url\` to the \`${serverName}\` entry in \`${mcpConfigPath}\`.`
        )
      );
    }

    if (isPlainObject(env)) {
      for (const [envKey, envValue] of Object.entries(env)) {
        if (
          isSensitiveKey(envKey) &&
          typeof envValue === "string" &&
          looksLikeLiteralSecret(envValue)
        ) {
          findings.push(
            buildFailure(
              "plugin.security.hard_coded_secret",
              `The MCP server \`${serverName}\` contains a hard-coded secret-like env value for \`${envKey}\`.`,
              "Hard-coded credentials inside plugin bundles increase leakage risk and make secure rotation difficult.",
              `Replace the literal value for \`${envKey}\` with an environment reference or injected secret outside the package.`,
              {
                serverName,
                configPath: relativePackagePath(rootPath, mcpConfigPath),
                envKey,
                envValue: "[REDACTED]"
              }
            )
          );
        }
      }
    }
  }

  return findings;
}

export async function validatePlugin(
  targetPath: string,
  options: CheckOptions = {}
): Promise<CheckResult> {
  const discoveredPackage = await discoverPackage(targetPath);

  if (!discoveredPackage) {
    const rootPath = path.resolve(targetPath);

    return {
      targetPath: rootPath,
      status: "fail",
      exitCode: 1,
      findings: withFindingFingerprints(
        [await buildMissingManifestFailure(rootPath)],
        rootPath
      )
    };
  }

  const runtimeResult = options.runtime
    ? await probeRuntime(discoveredPackage, {
        transcript: options.runtimeTranscript
      })
    : null;

  const findings = [
    ...validateRequiredManifestFields(discoveredPackage),
    ...(await validateSkillsDirectory(discoveredPackage)),
    ...(await validateSkillDefinitions(discoveredPackage)),
    ...(await validateMcpConfig(discoveredPackage)),
    ...(runtimeResult ? runtimeResult.findings : [])
  ];

  const fingerprintedFindings = withFindingFingerprints(
    findings,
    discoveredPackage.rootPath
  );
  const hasFailures = fingerprintedFindings.some(
    (finding) => finding.severity === "fail"
  );
  const hasWarnings = fingerprintedFindings.some(
    (finding) => finding.severity === "warn"
  );

  if (!hasFailures && !hasWarnings) {
    return {
      targetPath: discoveredPackage.rootPath,
      status: "pass",
      exitCode: 0,
      findings: [],
      ...(runtimeResult ? { runtimeScorecard: runtimeResult.scorecard } : {})
    };
  }

  return {
    targetPath: discoveredPackage.rootPath,
    status: hasFailures ? "fail" : "warn",
    exitCode: hasFailures ? 1 : 0,
    findings: fingerprintedFindings,
    ...(runtimeResult ? { runtimeScorecard: runtimeResult.scorecard } : {})
  };
}
