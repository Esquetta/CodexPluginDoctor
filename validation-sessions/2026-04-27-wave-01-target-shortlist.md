# Wave 01 Target Shortlist

## Goal

Select the first external-like validation targets after bootstrap wave 00.

These targets are chosen from local plugin and skill inventories outside the `CodexPluginDoctor` repository itself.

## Recommended Wave 01 Targets

### 1. GitHub Curated Plugin Cache

- Path: `<codex-home>\plugins\cache\openai-curated\github\b066e4a0`
- Target type: plugin cache package
- Recommended pass type: static first, then optional runtime if the MCP config is available and safe to run

Why this is strong:

- real `.codex-plugin/plugin.json` package
- multiple skills with different workflow patterns
- already produces a realistic warn-only result profile instead of a trivial pass/fail
- good candidate for tuning description heuristics

Observed current output:

- status: `warn`
- dominant finding class: `plugin.heuristic.skill_description.too_long`

### 2. Cloudflare Curated Plugin Cache

- Path: `<codex-home>\plugins\cache\openai-curated\cloudflare\b066e4a0`
- Target type: plugin cache package with MCP surface
- Recommended pass type: static first, then optional runtime if local MCP dependencies are safe to execute

Why this is strong:

- real `.codex-plugin/plugin.json`
- includes `.mcp.json`
- diverse skill set around deployment, API access, and platform operations
- good candidate for testing complexity and future runtime realism

Observed current output:

- status: `warn`
- dominant finding class: `plugin.heuristic.skill_description.too_long`

### 3. Figma Curated Plugin Cache

- Path: `<codex-home>\plugins\cache\openai-curated\figma\b066e4a0`
- Target type: plugin cache package
- Recommended pass type: static first

Why this is strong:

- real `.codex-plugin/plugin.json`
- broader skill surface than GitHub
- good stress case for long-form skill metadata and multi-skill package ergonomics

Observed current output:

- status: `warn`
- dominant finding class: `plugin.heuristic.skill_description.too_long`

## Secondary Candidates

These are useful but lower priority for wave 01 because they are not immediately full plugin roots:

### ChatGPT Apps Skill Pack

- Path: `<codex-home>\skills\chatgpt-apps`
- Type: skill-only package
- Value: strong docs-heavy, reference-heavy skill
- Limitation: not a direct `.codex-plugin` root without wrapping

### ASP.NET Core Skill Pack

- Path: `<codex-home>\skills\aspnet-core`
- Type: skill-only package
- Value: stable long-form reference skill
- Limitation: not a direct `.codex-plugin` root without wrapping

## Recommended Order

1. GitHub plugin cache
2. Cloudflare plugin cache
3. Figma plugin cache

## Why This Order

- GitHub is likely the easiest first “real” package because its warnings are already understandable and bounded.
- Cloudflare adds more platform and MCP complexity.
- Figma is the most likely to pressure-test description heuristics because of the denser skill surface.

## Suggested Wave 01 Outcome

The main question for wave 01 should be:

`Are the current description-length heuristics too noisy on real curated plugin packages?`

If all three packages mostly fail on the same description warning family, that is a strong signal that the heuristic threshold should be revisited before wider release.

