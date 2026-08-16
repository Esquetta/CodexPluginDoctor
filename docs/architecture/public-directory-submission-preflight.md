# Public Directory Submission Preflight

## Purpose

Codex Plugin Doctor will provide an offline preflight for packages intended for the OpenAI public directory. The preflight helps authors find deterministic packaging and listing problems before they enter the submission portal.

The command does not submit a package and does not claim that OpenAI will accept it. Portal review, developer verification, policy review, OAuth review, and other checks that require external state remain explicit manual work.

The ruleset is based on the OpenAI plugin packaging, app review, and submission error documentation available on 2026-08-15:

- <https://developers.openai.com/plugins/build/plugins>
- <https://developers.openai.com/plugins/deploy/app-review>
- <https://developers.openai.com/plugins/deploy/submission-errors>

## Command Surface

```bash
codex-plugin-doctor doctor submission <path>
codex-plugin-doctor doctor submission <path> --json
codex-plugin-doctor doctor submission <path> --markdown
codex-plugin-doctor doctor submission <path> --require-ready
```

The command is additive. Existing `check`, runtime, audit, registry, and release behavior remains unchanged.

`doctor submission` is always static and non-executing:

- no network requests
- no MCP server startup
- no child-process execution
- no portal API access
- no domain verification
- no OAuth credential handling

The command classifies the package deterministically from its declarations. A package that declares an MCP server or app connection is `mcp-backed`; every other package is `skills-only`.

The two reported targets are:

- `skills-only`: the package contains only public-directory-compatible skills and metadata.
- `mcp-backed`: the package declares an MCP server or an app connection.

## Result Model

The machine-readable contract is `doctor.submission.json` with schema version `1.0.0`.

```json
{
  "schemaVersion": "1.0.0",
  "rulesetVersion": "openai-directory-2026-08-15",
  "targetType": "skills-only",
  "status": "pass",
  "readiness": "manual_review_required",
  "summary": {
    "passed": 12,
    "warnings": 0,
    "blockers": 0,
    "manualChecks": 3
  },
  "checks": [],
  "findings": [],
  "manualChecklist": []
}
```

`status` reports only deterministic automatic checks:

- `pass`: no automatic blocker was found.
- `fail`: at least one automatic blocker was found.

`readiness` prevents an offline result from being confused with submission approval:

- `blocked`: an automatic blocker exists.
- `manual_review_required`: automatic checks passed, but portal or reviewer checks remain.

The command never emits an automatic `ready` or `accepted` state.

### Exit Codes

- `0`: automatic checks passed, including when manual review remains.
- `1`: automatic blockers exist and `--require-ready` was supplied.
- `2`: command usage is invalid.

Without `--require-ready`, a completed preflight returns `0` even when automatic blockers are reported. This permits advisory adoption. Output still reports `status: "fail"` and `readiness: "blocked"`.

## Automatic Rules

New stable finding identifiers use the `plugin.submission.*` namespace. Existing validation rule identifiers do not change. Portal error codes, when known, are stored separately as `portalCode` and never replace the Doctor identifier.

### Listing And Identity

The preflight validates:

- package name and semantic version
- display name at most 30 characters
- short description at most 30 characters
- long description at most 4,000 characters
- developer name at most 80 characters
- supported category value
- no more than 20 capability entries
- each capability at most 120 characters and one line
- no more than 3 unique starter prompts
- each starter prompt at most 128 characters and one line
- no starter prompt containing an `@mention`
- no control or invisible characters in listing text

For `mcp-backed` targets, the following fields are required:

- website URL
- support URL
- privacy policy URL
- terms of service URL

Each URL must:

- use HTTPS
- contain no embedded credentials
- be at most 1,024 characters

Unknown listing fields produce a warning when they can be ignored safely. Malformed expected fields produce deterministic findings instead of exceptions.

### Assets And Component Integrity

The preflight requires `logo` and `composerIcon` assets. Each asset must:

- resolve to a regular file contained within the package root after canonical path resolution
- use PNG, JPEG, WebP, or SVG content
- be no larger than 5 MiB
- be square
- have dimensions from 48 through 4,096 pixels
- match its declared file extension
- decode safely within fixed resource limits

Raster metadata and SVG dimensions are parsed without executing external tools. SVG handling uses safe XML parsing and rejects external entities or remote references needed for validation.

When `.app.json` is referenced, the preflight validates the documented shared-package connection-mapping shape. A structurally valid app manifest is not treated as proof of public-directory eligibility.

A `skills-only` target that declares screenshot components receives a submission blocker. A package that declares MCP or app components is classified as `mcp-backed` instead.

### Skill Metadata

For each skill, `skills/*/agents/openai.yaml` is optional. When present, it is parsed as data with a bounded safe YAML schema. The preflight validates supported fields including:

- `interface.display_name`
- `interface.short_description`
- `interface.icons`
- `interface.brand_color`
- `interface.default_prompt`
- `policy.products`
- `policy.allow_implicit_invocation`
- `dependencies.tools`

The validator also checks:

- all referenced icon paths remain within the package root
- skill identities are unique
- combined `plugin:skill` identities remain within the documented length limit
- malformed or mixed-shape metadata fails deterministically

YAML aliases, custom tags, executable types, and unbounded structures are rejected. Metadata content is never executed.

## Manual Review Checklist

The report separates portal-only or judgment-based work from automatic checks. Depending on target type, the manual checklist includes:

- developer or business identity verification
- required attestations
- skill safety review
- MCP demonstration video
- exactly 5 positive and 3 negative MCP tests
- release notes
- production domain verification
- current tool security scan
- tool annotation accuracy and justification
- OAuth reviewer credentials

Manual items have a state such as `required` or `not_applicable`; they never receive an automatic `passed` state merely because local files exist.

## Privacy And Evidence

Findings expose only the minimum evidence needed to locate a problem:

- field names
- counts and limits
- package-relative paths
- normalized check identifiers

Reports must not include full prompts, descriptions, credentials, file contents, absolute package roots, or decoded asset data. Text, JSON, Markdown, GitHub Action artifacts, and future report consumers share the same redacted result model.

## Ruleset Governance

The initial embedded ruleset is `openai-directory-2026-08-15`.

Each ruleset records:

- a stable version identifier
- source URLs
- the date the sources were reviewed
- deterministic automatic constraints
- the manual checklist definitions

The command does not fetch rule updates at runtime. A ruleset update is a reviewed source change with tests and changelog coverage. This keeps identical package inputs reproducible in local development and CI.

## Architecture

The implementation will use four focused core modules:

- `submission-ruleset.ts`: immutable rules and manual-check definitions
- `submission-preflight.ts`: package classification and result orchestration
- `submission-assets.ts`: bounded asset inspection
- `submission-skill-metadata.ts`: safe `agents/openai.yaml` parsing and validation

Text, JSON, and Markdown renderers consume the same domain result. Public TypeScript exports and output contracts are additive.

Small pure-JavaScript dependencies may be introduced only when necessary for safe YAML, raster metadata, or SVG parsing. Native modules, heavy dependency trees, postinstall requirements, and install-time code execution are not acceptable for this feature.

## GitHub Action

Submission preflight is opt-in:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.59.0
  with:
    submission: "true"
    require-submission-ready: "true"
```

`submission` runs the offline preflight and publishes its reports with the existing Action artifacts. `require-submission-ready` applies the strict automatic-blocker exit gate. Existing Action defaults remain unchanged.

## Verification Contract

Implementation is complete only when tests cover:

- valid and invalid `skills-only` and `mcp-backed` fixtures
- listing limits, duplicate prompts, and Unicode edge cases
- `.app.json` shape and duplicate connection identities
- safe YAML shapes and path traversal in `agents/openai.yaml`
- asset magic bytes, extension mismatch, dimensions, square ratio, and size limit
- URL requirements
- manual checks never becoming automatic passes
- text, JSON, Markdown, exit-code, and output-contract behavior
- absence of network and child-process activity
- package-relative evidence on Windows and POSIX-style inputs
- opt-in GitHub Action behavior with unchanged defaults

Release verification includes targeted tests, the full test suite, TypeScript build, corpus checks, dependency audit, package-content inspection, source security self-scan, and the existing release check.

## Out Of Scope

- portal authentication or submission
- domain verification actions
- OAuth flow testing or credential storage
- MCP execution or live tool calls
- runtime verification of tool annotations
- judging demonstration or test quality
- predicting or claiming OpenAI directory acceptance
