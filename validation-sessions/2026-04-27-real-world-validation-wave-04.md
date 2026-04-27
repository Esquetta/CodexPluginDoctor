# Real-World Validation Session

## Session Info

- Date: 2026-04-27
- Validator version: 0.1.0-rc.1
- Operator: Codex
- Notes visibility: internal only
- Session label: wave 04 media and visual metadata review

## Purpose

Wave 04 resolves the remaining HyperFrames warnings from wave 03 by comparing them against similar media, animation, and visual-design marketplace packages.

The immediate question is:

`Are GSAP, HyperFrames, and Canva descriptions verbose noise, or concrete media workflow metadata that should pass?`

## Targets

| Label | Type | Runtime Enabled | Notes |
| --- | --- | --- | --- |
| hyperframes-marketplace | marketplace snapshot | no | Main warning target with GSAP and video-production descriptions. |
| canva-marketplace | marketplace snapshot | no | Visual-design workflow comparison target. |
| remotion-marketplace | marketplace snapshot | no | Clean video-generation baseline. |
| biorender-marketplace | marketplace snapshot | no | Clean visual/scientific design baseline. |

## Paths

| Label | Path |
| --- | --- |
| hyperframes-marketplace | `<codex-home>\.tmp\plugins\plugins\hyperframes` |
| canva-marketplace | `<codex-home>\.tmp\plugins\plugins\canva` |
| remotion-marketplace | `<codex-home>\.tmp\plugins\plugins\remotion` |
| biorender-marketplace | `<codex-home>\.tmp\plugins\plugins\biorender` |

## Commands Run

```bash
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\hyperframes" --json
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\canva" --json
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\remotion" --json
node dist/cli.js check "<codex-home>\.tmp\plugins\plugins\biorender" --json
```

## Initial Output Summary

| Target | Status | Exit Code | Dominant Signal |
| --- | --- | --- | --- |
| hyperframes-marketplace | warn | 0 | 2 `skill_description.too_long` warnings |
| canva-marketplace | warn | 0 | 3 `skill_description.too_long` warnings |
| remotion-marketplace | pass | 0 | No findings |
| biorender-marketplace | pass | 0 | No findings |

## Manual Classification

| Target | Skill | Classification | Notes |
| --- | --- | --- | --- |
| hyperframes-marketplace | `gsap` | `false_positive` | Concrete animation reference with named GSAP APIs, timeline concepts, performance terms, and HyperFrames composition scope. |
| hyperframes-marketplace | `hyperframes` | `false_positive` | Long, but concrete video-production workflow covering captions, audio, transitions, CLI commands, and HTML composition boundaries. |
| canva-marketplace | `canva-branded-presentation` | `false_positive` | Concrete visual design workflow with brand kit, slides, deck, and Canva surfaces. |
| canva-marketplace | `canva-resize-for-all-social-media` | `false_positive` | Concrete resize/export workflow across named social platforms. |
| canva-marketplace | `canva-translate-design` | `false_positive` | Concrete translation/localization workflow with source design and layout-preservation boundaries. |

Classification values:

- `true_positive`
- `false_positive`
- `unclear`
- `missing_expected_finding`

## Regression Coverage

Three fixture cases were added:

| Fixture | Expected Result | Purpose |
| --- | --- | --- |
| `heuristic-acceptable-animation-reference-description` | pass | Proves concrete animation reference descriptions are accepted. |
| `heuristic-acceptable-video-workflow-description` | pass | Proves long but concrete video-production workflow descriptions are accepted. |
| `heuristic-acceptable-visual-design-description` | pass | Proves concrete visual design workflow descriptions are accepted. |

## Tuning Applied

The skill-description heuristic now accounts for media and visual workflow terms such as:

- GSAP, easing, timelines, transforms, playback
- video, composition, captions, voiceovers, audio-reactive visuals, transitions
- Canva, presentations, slide deck, brand kit, social media, export-ready formats

The relaxation still requires enough concrete signals and runs after high-vagueness checks, so broad vague descriptions remain warnable.

## Final Output Summary

| Target | Status | Exit Code | Findings |
| --- | --- | --- | --- |
| hyperframes-marketplace | pass | 0 | 0 |
| canva-marketplace | pass | 0 | 0 |
| remotion-marketplace | pass | 0 | 0 |
| biorender-marketplace | pass | 0 | 0 |

## Interpretation

Wave 04 confirms that the remaining HyperFrames warnings were false positives caused by missing media and visual-domain signals. The updated heuristic is better aligned with marketplace skill metadata that is concrete but not centered on MCP/API terminology.

## Follow-Up Tasks

- [x] compare HyperFrames with adjacent media and visual marketplace packages
- [x] classify HyperFrames and Canva warnings manually
- [x] add regression fixtures for media and visual descriptions
- [x] tune the heuristic for concrete media/visual signals
- [x] re-run selected marketplace targets after tuning
- [ ] run a future wave against Netlify/Vercel platform packages before tuning platform-hosting warning clusters
