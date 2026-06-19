# Instance-Specific Finding Evidence Design

## Goal

Add safe, instance-specific structured evidence to every validation, runtime, trust, security, and generic MCP finding that can occur more than once in a package.

This gives deterministic finding fingerprints enough identity to distinguish separate skills, servers, dependencies, scripts, methods, resources, tools, and prompts without relying on human-readable message text.

## Scope

Version `1.26.0` will enrich existing findings. It will not add suppression configuration, baselines, new rule IDs, new severities, or automatic remediation.

Existing JSON schema versions remain `1.0.0` because `Finding.evidence` is already optional and this release only populates it more consistently.

## Evidence Principles

Evidence must be:

- stable across machines and repeated runs
- specific enough to identify one finding instance
- bounded in size
- safe to print in text, Markdown, JSON, SARIF, attestations, and release evidence
- derived from data already inspected by the corresponding rule

Evidence must not contain:

- secret values
- stderr contents
- prompt bodies
- resource contents
- tool result payloads
- encoded command payloads
- unbounded user-controlled output

Paths will use package-relative values where possible. The existing fingerprint canonicalizer remains responsible for cross-platform separator normalization.

## Validation Evidence

Manifest findings will include:

- `manifestPath`
- `field`

Skill findings will include the narrowest applicable values:

- `skillName`
- `skillPath`
- `assetReference`
- `assetPath`
- `field`

MCP configuration findings will include:

- `configPath`
- `serverName`
- `field`

Missing or invalid package entry points will include the expected package-relative path rather than an absolute machine path.

## Runtime Evidence

Every runtime finding will include:

- `serverName`
- `method`

When the finding concerns a selected capability instance, it will also include:

- `toolName`
- `resourceUri`
- `promptName`

Oversized-content warnings will include the measured `contentLength` and the relevant method or selected instance identifier. They will not include the content itself.

Startup findings will use `method: "startup"`. General protocol failures will use the last relevant protocol method or `protocol` where no request method applies.

## Trust Evidence

Lifecycle script findings will include:

- `packageJsonPath`
- `scriptName`

Dependency findings will include:

- `packageJsonPath`
- `dependencyName`
- `dependencySection`
- `versionSpec`

The implementation will preserve dependency section identity rather than flattening all dependency maps before rule evaluation.

## Security Evidence

Existing security evidence remains unchanged where it already provides instance identity.

Security audit-unavailable findings will use safe locator evidence such as the expected manifest or config path. Prompt-injection findings will continue to identify only the package-relative file path and matched rule category; suspicious source text will not be copied into evidence.

## Generic MCP Evidence

Generic MCP findings will include:

- `configPath`
- `serverName`
- `field`

Missing config findings will use the expected `.mcp.json` package-relative path. Path-escape findings may include the configured and resolved paths because the fingerprint canonicalizer already normalizes path evidence.

## Fingerprint Behavior

The fingerprint algorithm introduced in `1.25.0` will not change.

After enrichment:

- the same issue in two different package roots produces the same fingerprint
- two instances of the same rule for different skills, servers, dependencies, scripts, tools, resources, or prompts produce different fingerprints
- editorial changes to message, impact, or suggested-fix text do not change fingerprints
- secret redaction remains unchanged

Some package-wide findings may intentionally retain a single rule-level identity when no narrower instance exists.

## Architecture

Existing finding builders will continue accepting optional evidence. Call sites will supply identity fields where the rule already has that context.

Runtime oversized-content collectors will receive explicit context objects instead of reading global state. Trust dependency iteration will retain section names alongside dependency maps. No new generic abstraction or evidence registry will be introduced.

## Testing

Focused tests will verify:

- manifest, skill, MCP, runtime, trust, security, and generic MCP representative findings contain expected evidence
- two findings with the same rule but different instance locators produce different fingerprints
- equivalent package-relative instances across different roots produce identical fingerprints
- secret values and runtime content are absent from evidence
- evidence values remain bounded
- text, Markdown, JSON, SARIF, attestation, and release evidence continue to serialize findings without contract regressions

The release gate requires:

```text
npm test
npm run build
npm run release-check
git diff --check
```

## Release Plan

Use separate commits for:

1. design and implementation plan
2. validation and generic MCP evidence
3. runtime evidence
4. trust and remaining security evidence
5. `1.26.0` release metadata

Push `main`, wait for GitHub Actions, create `v1.26.0`, publish npm, run release-sync verification, install the published package globally, and smoke-test distinct fingerprints for repeated rule instances.
