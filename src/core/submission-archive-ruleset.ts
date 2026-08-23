const sources = Object.freeze([
  "https://developers.openai.com/plugins/build/plugins",
  "https://developers.openai.com/plugins/deploy/submission-errors"
] as const);

const portalRules = Object.freeze([
  Object.freeze({ id: "plugin.submission.archive.plugin_name_mismatch", status: "unavailable", reason: "Requires the previously published plugin identity.", source: "submission-errors" }),
  Object.freeze({ id: "plugin.submission.archive.plugin_version_unchanged", status: "unavailable", reason: "Requires the previously published plugin version.", source: "submission-errors" }),
  Object.freeze({ id: "plugin.submission.archive.manifest_normalized", status: "unavailable", reason: "The portal owns exact manifest normalization.", source: "submission-errors" }),
  Object.freeze({ id: "plugin.submission.archive.developer_name_defaulted", status: "unavailable", reason: "Requires the selected verified developer identity.", source: "submission-errors" }),
  Object.freeze({ id: "plugin.submission.archive.path_length", status: "unavailable", reason: "The public reference does not publish a numeric path-length limit.", source: "submission-errors" }),
  Object.freeze({ id: "plugin.submission.archive.normalization_algorithm", status: "unavailable", reason: "The portal does not publish its case and Unicode collision algorithm.", source: "submission-errors" }),
  Object.freeze({ id: "plugin.submission.archive.claude_format_normalized", status: "manual", reason: "The portal owns Claude-format normalization details.", source: "submission-errors" })
] as const);

export const submissionArchiveRuleset = Object.freeze({
  version: "openai-directory-archive-2026-08-23",
  reviewedAt: "2026-08-23",
  sources,
  limits: Object.freeze({
    compressedBytes: 100 * 1000 * 1000,
    entries: 5_000,
    memberBytes: 100 * 1024 * 1024,
    totalBytes: 512 * 1024 * 1024
  }),
  structures: Object.freeze({
    eocdComments: "automatic",
    zip64: "automatic",
    dataDescriptors: "automatic"
  }),
  compression: Object.freeze({
    stored: "automatic",
    deflate: "automatic"
  }),
  collisionAlgorithm: "NFKC + toLowerCase per segment",
  automaticChecks: Object.freeze([
    "plugin.submission.archive.invalid_file",
    "plugin.submission.archive.invalid_zip",
    "plugin.submission.archive.too_large",
    "plugin.submission.archive.entry_count",
    "plugin.submission.archive.member_too_large",
    "plugin.submission.archive.total_too_large",
    "plugin.submission.archive.encrypted",
    "plugin.submission.archive.header_mismatch",
    "plugin.submission.archive.descriptor_invalid",
    "plugin.submission.archive.range_invalid",
    "plugin.submission.archive.crc_mismatch",
    "plugin.submission.archive.path_invalid",
    "plugin.submission.archive.path_duplicate",
    "plugin.submission.archive.path_conflict",
    "plugin.submission.archive.type_unsupported",
    "plugin.submission.archive.normalization_collision",
    "plugin.submission.archive.root_missing",
    "plugin.submission.archive.root_ambiguous",
    "plugin.submission.archive.root_siblings",
    "plugin.submission.archive.manifest_missing",
    "plugin.submission.archive.skill_missing",
    "plugin.submission.archive.mcp_excluded",
    "plugin.submission.archive.app_excluded",
    "plugin.submission.archive.screenshot_excluded"
  ] as const),
  portalRules
});
