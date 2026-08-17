export const submissionRuleset = Object.freeze({
  version: "openai-directory-2026-08-15",
  reviewedAt: "2026-08-15",
  sources: Object.freeze([
    "https://developers.openai.com/plugins/build/plugins",
    "https://developers.openai.com/plugins/deploy/app-review",
    "https://developers.openai.com/plugins/deploy/submission-errors"
  ]),
  limits: Object.freeze({
    packageName: 64,
    version: 64,
    displayName: 30,
    shortDescription: 30,
    longDescription: 4000,
    developerName: 80,
    capabilities: 20,
    capability: 120,
    starterPrompts: 3,
    starterPrompt: 128,
    url: 1024
  }),
  categories: Object.freeze([
    "Productivity", "Creativity", "Developer Tools", "Business & Operations",
    "Data & Analytics", "Communication", "Education & Research", "Security",
    "Finance", "Healthcare", "Travel", "Entertainment", "Other"
  ])
});

export const submissionManualChecks = Object.freeze([
  Object.freeze({ id: "developer-business-identity", label: "Developer and business identity", mcpOnly: false }),
  Object.freeze({ id: "attestations", label: "Required attestations", mcpOnly: false }),
  Object.freeze({ id: "skill-safety-scan", label: "Skill safety scan", mcpOnly: false }),
  Object.freeze({ id: "demo-video", label: "Demo video", mcpOnly: true }),
  Object.freeze({ id: "tool-tests", label: "Exactly 5 positive and 3 negative tool tests", mcpOnly: true }),
  Object.freeze({ id: "release-notes", label: "Release notes", mcpOnly: true }),
  Object.freeze({ id: "production-domain-verification", label: "Production domain verification and current tool scan", mcpOnly: true }),
  Object.freeze({ id: "tool-annotations", label: "Tool annotations and justifications", mcpOnly: true }),
  Object.freeze({ id: "oauth-reviewer-credentials", label: "OAuth reviewer credentials", mcpOnly: true })
]);
