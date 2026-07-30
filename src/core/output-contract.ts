import { createHash } from "node:crypto";

import { packageVersion } from "../version.js";
import {
  ruleCatalog,
  type RuleCategory,
  type RuleDefinition,
  type RuleSeverity
} from "../rules/rule-catalog.js";

type JsonSchema = Record<string, unknown>;

export interface OutputContractRule {
  id: string;
  category: RuleCategory;
  defaultSeverity: RuleSeverity;
}

export interface OutputContractSchema {
  id: string;
  command: string;
  schemaVersion: "1.0.0";
  stability: "stable-through-1.0";
  outputKind: string | null;
  schema: JsonSchema;
}

export interface DoctorOutputContract {
  schemaVersion: "1.0.0";
  kind: "doctor.output.contract";
  generatedAt: string;
  version: string;
  contract: {
    frozenSince: "0.18.0";
    stability: "stable-through-1.0";
    compatibility: string;
  };
  ruleCatalog: {
    status: "frozen";
    frozenSince: "0.18.0";
    ruleCount: number;
    digest: string;
    rules: OutputContractRule[];
  };
  schemas: OutputContractSchema[];
}

const runtimeCapabilityStatusSchema = {
  type: "string",
  enum: ["pass", "fail", "warn", "skipped", "unsupported"]
};

const remoteTransportReliabilityStatusSchema = {
  type: "string",
  enum: ["pass", "warn", "fail", "skipped"]
};

const registryPublicationPreflightStatusSchema = {
  type: "string",
  enum: ["pass", "warn", "fail"]
};

const registryPackagePublicationSchema = {
  type: "string",
  enum: ["pass", "fail", "skipped", "unknown"]
};

const registryVersionAvailabilitySchema = {
  type: "string",
  enum: ["available-first-publication", "available-new-version", "already-published", "unknown"]
};

const registryPublisherPlanSchema = {
  type: "object",
  properties: {
    executable: {
      const: false
    },
    steps: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      prefixItems: [
        {
          type: "object",
          properties: {
            order: {
              const: 1
            },
            command: {
              const: "mcp-publisher login github"
            },
            purpose: {
              type: "string"
            }
          },
          required: ["order", "command", "purpose"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            order: {
              const: 2
            },
            command: {
              const: "mcp-publisher publish"
            },
            purpose: {
              type: "string"
            }
          },
          required: ["order", "command", "purpose"],
          additionalProperties: false
        }
      ],
      items: false
    }
  },
  required: ["executable", "steps"],
  additionalProperties: false
};

const runtimeConformanceSchema = {
  type: "object",
  properties: {
    protocolVersion: {
      type: ["string", "null"]
    },
    profile: {
      type: ["string", "null"],
      enum: ["legacy", "2025-11-25", "future-compatible", null]
    },
    capabilityConsistency: runtimeCapabilityStatusSchema,
    taskDeclarations: runtimeCapabilityStatusSchema,
    tasksList: runtimeCapabilityStatusSchema,
    schemaDialect: runtimeCapabilityStatusSchema,
    overall: {
      type: "string",
      enum: ["pass", "warn", "fail", "skipped"]
    }
  },
  required: [
    "protocolVersion",
    "profile",
    "capabilityConsistency",
    "taskDeclarations",
    "tasksList",
    "schemaDialect",
    "overall"
  ],
  additionalProperties: false
};

const remoteTransportReliabilitySchema = {
  type: "object",
  properties: {
    getSse: remoteTransportReliabilityStatusSchema,
    sessionPropagation: remoteTransportReliabilityStatusSchema,
    resumability: remoteTransportReliabilityStatusSchema,
    disconnectSafety: remoteTransportReliabilityStatusSchema,
    sessionRestart: remoteTransportReliabilityStatusSchema,
    termination: remoteTransportReliabilityStatusSchema,
    overall: remoteTransportReliabilityStatusSchema
  },
  required: [
    "getSse",
    "sessionPropagation",
    "resumability",
    "disconnectSafety",
    "sessionRestart",
    "termination",
    "overall"
  ],
  additionalProperties: false
};

const remoteRuntimeScorecardSchema = {
  type: "object",
  properties: {
    transport: runtimeCapabilityStatusSchema,
    networkSafety: runtimeCapabilityStatusSchema,
    initialize: runtimeCapabilityStatusSchema,
    contentType: runtimeCapabilityStatusSchema,
    session: {
      type: "string",
      enum: ["absent", "present-valid", "present-invalid"]
    },
    protocolHeaders: runtimeCapabilityStatusSchema,
    authorization: runtimeCapabilityStatusSchema,
    reliability: remoteTransportReliabilitySchema,
    overall: {
      type: "string",
      enum: ["pass", "warn", "fail", "skipped"]
    }
  },
  required: ["transport", "networkSafety", "initialize", "contentType", "session", "protocolHeaders", "authorization", "overall"],
  additionalProperties: false
};

const runtimeScorecardSchema = {
  type: "object",
  properties: {
    initialize: runtimeCapabilityStatusSchema,
    toolsList: runtimeCapabilityStatusSchema,
    toolsCall: runtimeCapabilityStatusSchema,
    resourcesList: runtimeCapabilityStatusSchema,
    resourceRead: runtimeCapabilityStatusSchema,
    resourceTemplatesList: runtimeCapabilityStatusSchema,
    promptsList: runtimeCapabilityStatusSchema,
    promptGet: runtimeCapabilityStatusSchema,
    conformance: runtimeConformanceSchema,
    remote: remoteRuntimeScorecardSchema
  },
  required: [
    "initialize",
    "toolsList",
    "toolsCall",
    "resourcesList",
    "resourceRead",
    "resourceTemplatesList",
    "promptsList",
    "promptGet"
  ],
  additionalProperties: false
};

const publicSchemaDefinitions: Array<{
  id: string;
  command: string;
  outputKind?: string;
  required?: string[];
  properties?: Record<string, unknown>;
}> = [
  {
    id: "doctor.check.json",
    command: "codex-plugin-doctor check <path> --json",
    required: ["schemaVersion", "generatedAt", "summary", "findings"],
    properties: {
      summary: {
        type: "object",
        properties: {
          runtimeScorecard: runtimeScorecardSchema
        },
        additionalProperties: true
      }
    }
  },
  {
    id: "doctor.installed.check.json",
    command: "codex-plugin-doctor check --installed --json",
    outputKind: "doctor.installed.check",
    required: ["schemaVersion", "kind", "generatedAt", "summary", "plugins"]
  },
  {
    id: "doctor.security.json",
    command: "codex-plugin-doctor security <path> --json",
    required: ["schemaVersion", "generatedAt", "targetPath", "status", "score", "findings"]
  },
  {
    id: "doctor.compatibility.json",
    command: "codex-plugin-doctor compat <path> --json",
    required: ["schemaVersion", "targetPath", "results"]
  },
  {
    id: "doctor.mcp.json",
    command: "codex-plugin-doctor mcp <path> --json",
    outputKind: "doctor.mcp.healthcheck",
    required: ["schemaVersion", "kind", "generatedAt", "targetPath", "status", "serverCount", "findings", "security", "compatibility"],
    properties: {
      runtimeScorecard: {
        ...runtimeScorecardSchema,
        description: "Present only when codex-plugin-doctor mcp <path> --runtime is used."
      }
    }
  },
  {
    id: "doctor.registry.readiness.json",
    command: "codex-plugin-doctor registry check <server.json|directory> --json",
    outputKind: "mcp-registry-readiness",
    required: [
      "schemaVersion",
      "kind",
      "generatedAt",
      "source",
      "target",
      "status",
      "scorecard",
      "installability",
      "findings"
    ],
    properties: {
      source: {
        type: "string",
        enum: ["file", "registry"]
      },
      status: {
        type: "string",
        enum: ["pass", "warn", "fail"]
      },
      scorecard: {
        type: "object",
        required: [
          "metadata",
          "ownership",
          "packageIntegrity",
          "transportReadiness",
          "clientInstallability",
          "overall"
        ],
        additionalProperties: false
      },
      installability: {
        type: "object",
        required: ["codex", "packageTypes", "remoteTransports"],
        additionalProperties: true
      },
      findings: {
        type: "array"
      }
    }
  },
  {
    id: "doctor.registry.preflight.json",
    command: "codex-plugin-doctor registry preflight <server.json|directory> --json",
    outputKind: "mcp-registry-publication-preflight",
    required: [
      "schemaVersion",
      "kind",
      "generatedAt",
      "target",
      "status",
      "localReadiness",
      "packagePublication",
      "registryVersionAvailability",
      "publisherPlan",
      "findings"
    ],
    properties: {
      target: {
        const: "server.json"
      },
      status: registryPublicationPreflightStatusSchema,
      localReadiness: registryPublicationPreflightStatusSchema,
      packagePublication: registryPackagePublicationSchema,
      registryVersionAvailability: registryVersionAvailabilitySchema,
      publisherPlan: registryPublisherPlanSchema,
      findings: {
        type: "array"
      }
    }
  },
  {
    id: "doctor.audit.json",
    command: "codex-plugin-doctor audit --installed --json",
    required: ["schemaVersion", "generatedAt", "summary", "items"]
  },
  {
    id: "doctor.audit.deps.json",
    command: "codex-plugin-doctor audit deps <path> --json",
    required: ["schemaVersion", "targetPath", "status", "totalVulnerabilities", "vulnerabilities", "audit"]
  },
  {
    id: "doctor.fix.plan.json",
    command: "codex-plugin-doctor fix <path> --dry-run --json",
    required: ["schemaVersion", "targetPath", "mode", "actions"]
  },
  {
    id: "doctor.watch.validation.json",
    command: "codex-plugin-doctor watch <path> --json",
    required: ["schemaVersion", "iteration", "timestamp", "targetPath", "status", "findingsCount", "findings"]
  },
  {
    id: "doctor.git.hooks.json",
    command: "codex-plugin-doctor init-git-hooks <path> --json",
    outputKind: "doctor.git.hooks",
    required: ["schemaVersion", "kind", "rootPath", "hookPaths", "preExisting"]
  },
  {
    id: "doctor.suppress.add.json",
    command: "codex-plugin-doctor suppress add <path> --fingerprint <sha256> --reason <text> --expires-at YYYY-MM-DD --json",
    outputKind: "doctor.suppress.add",
    required: ["schemaVersion", "kind", "command", "configPath", "index", "suppression"]
  },
  {
    id: "doctor.suppress.list.json",
    command: "codex-plugin-doctor suppress list <path> --json",
    outputKind: "doctor.suppress.list",
    required: ["schemaVersion", "kind", "command", "configPath", "suppressions"]
  },
  {
    id: "doctor.suppress.remove.json",
    command: "codex-plugin-doctor suppress remove <path> --index <n> --json",
    outputKind: "doctor.suppress.remove",
    required: ["schemaVersion", "kind", "command", "configPath", "index", "suppression"]
  },
  {
    id: "doctor.suppress.prune.json",
    command: "codex-plugin-doctor suppress prune <path> --apply --json",
    outputKind: "doctor.suppress.prune",
    required: ["schemaVersion", "kind", "command", "configPath", "applied", "removedCount", "removed"]
  },
  {
    id: "doctor.history.json",
    command: "codex-plugin-doctor history <history.jsonl> --json",
    required: ["schemaVersion", "entryCount", "latest", "previous", "delta", "regression"]
  },
  {
    id: "doctor.environment.json",
    command: "codex-plugin-doctor doctor --json",
    required: ["schemaVersion", "generatedAt", "version", "platform", "node", "checks"]
  },
  {
    id: "doctor.validation.corpus.json",
    command: "codex-plugin-doctor doctor corpus --json",
    outputKind: "doctor.validation.corpus",
    required: ["schemaVersion", "kind", "generatedAt", "version", "summary", "cases"]
  },
  {
    id: "doctor.validation.corpus.external.json",
    command: "codex-plugin-doctor doctor corpus --manifest <corpus.json> --json",
    outputKind: "doctor.validation.corpus",
    required: ["schemaVersion", "kind", "corpusType", "generatedAt", "version", "summary", "cases"]
  },
  {
    id: "doctor.validation.corpus.metrics.json",
    command: "codex-plugin-doctor doctor corpus metrics --manifest <corpus.json> --json",
    outputKind: "doctor.validation.corpus.metrics",
    required: [
      "schemaVersion",
      "kind",
      "generatedAt",
      "version",
      "corpusDigest",
      "status",
      "exitCode",
      "summary",
      "thresholds",
      "thresholdChecks",
      "targets"
    ]
  },
  {
    id: "doctor.validation.corpus.metrics.diff.json",
    command: "codex-plugin-doctor doctor corpus metrics diff --before <metrics.json> --after <metrics.json> --json",
    outputKind: "doctor.validation.corpus.metrics.diff",
    required: [
      "schemaVersion",
      "kind",
      "generatedAt",
      "version",
      "corpusDigest",
      "status",
      "exitCode",
      "failOnRegression",
      "summary",
      "before",
      "after",
      "targets"
    ]
  },
  {
    id: "doctor.recommendations.json",
    command: "codex-plugin-doctor doctor recommend <path> --json",
    required: ["schemaVersion", "generatedAt", "targetPath", "status", "summary", "actions"]
  },
  {
    id: "doctor.trust.json",
    command: "codex-plugin-doctor doctor trust <path> --json",
    required: ["schemaVersion", "generatedAt", "targetPath", "status", "score", "findings"]
  },
  {
    id: "doctor.performance.json",
    command: "codex-plugin-doctor doctor perf <path> --json",
    outputKind: "doctor.perf",
    required: ["schemaVersion", "kind", "generatedAt", "targetPath", "status", "exitCode", "summary", "stages", "thresholds"]
  },
  {
    id: "doctor.runtime.plan.json",
    command: "codex-plugin-doctor doctor runtime-plan <path> --json",
    outputKind: "doctor.runtime.plan",
    required: ["schemaVersion", "kind", "generatedAt", "version", "targetPath", "status", "exitCode", "runtimeExecution", "execution", "digest", "summary", "servers", "findings"]
  },
  {
    id: "doctor.runtime.policy.json",
    command: "codex-plugin-doctor doctor runtime-policy <path> --json",
    outputKind: "doctor.runtime.policy",
    required: ["schemaVersion", "kind", "generatedAt", "version", "targetPath", "status", "exitCode", "runtimeExecution", "execution", "planDigest", "recommendation", "summary", "servers"]
  },
  {
    id: "doctor.review.bundle.json",
    command: "codex-plugin-doctor doctor review-bundle <path> --json",
    outputKind: "doctor.review.bundle",
    required: ["schemaVersion", "kind", "generatedAt", "version", "targetPath", "outputDirectory", "status", "exitCode", "summary", "files"]
  },
  {
    id: "doctor.review.bundle.verification.json",
    command: "codex-plugin-doctor doctor review-bundle verify <bundle-dir> --target <path> --json",
    outputKind: "doctor.review.bundle.verification",
    required: ["schemaVersion", "kind", "generatedAt", "bundleDirectory", "targetPath", "status", "exitCode", "summary", "checks", "attestation", "releaseEvidence"]
  },
  {
    id: "doctor.review.bundle.diff.json",
    command: "codex-plugin-doctor doctor review-bundle diff --before <dir> --after <dir> --json",
    outputKind: "doctor.review.bundle.diff",
    required: ["schemaVersion", "kind", "generatedAt", "beforeDirectory", "afterDirectory", "status", "exitCode", "summary", "before", "after", "changes"]
  },
  {
    id: "doctor.export.bundle.json",
    command: "codex-plugin-doctor doctor export --bundle <path> --json",
    outputKind: "doctor.export.bundle",
    required: ["schemaVersion", "kind", "generatedAt", "targetPath", "validation", "security", "compatibility", "recommendations", "trust"]
  },
  {
    id: "doctor.attestation.json",
    command: "codex-plugin-doctor doctor attest <path> --json",
    outputKind: "doctor.attestation",
    required: ["schemaVersion", "kind", "generatedAt", "targetPath", "subject", "packageFingerprint", "reportDigest", "summary", "verification", "signature"]
  },
  {
    id: "doctor.attestation.verification.json",
    command: "codex-plugin-doctor doctor attest verify <attestation.json> --target <path> --json",
    outputKind: "doctor.attestation.verification",
    required: ["schemaVersion", "kind", "generatedAt", "artifactPath", "targetPath", "status", "exitCode", "summary", "unsignedFields", "checks"]
  },
  {
    id: "doctor.release.evidence.json",
    command: "codex-plugin-doctor doctor release-evidence <path> --json",
    outputKind: "doctor.release.evidence",
    required: ["schemaVersion", "kind", "generatedAt", "version", "targetPath", "status", "exitCode", "releaseReady", "summary", "package", "git", "releaseGates", "runtimeApproval", "attestation", "attestationVerification", "corpus", "performance", "security", "trust", "evidenceSignature"]
  },
  {
    id: "doctor.release.evidence.verification.json",
    command: "codex-plugin-doctor doctor release-evidence verify <evidence.json> --target <path> --json",
    outputKind: "doctor.release.evidence.verification",
    required: ["schemaVersion", "kind", "generatedAt", "artifactPath", "targetPath", "status", "exitCode", "summary", "checks", "attestation"]
  },
  {
    id: "doctor.release.evidence.asset.json",
    command: "codex-plugin-doctor doctor release-evidence asset <path> --tag <tag> --output <evidence.json> --json",
    outputKind: "doctor.release.evidence.asset",
    required: ["schemaVersion", "kind", "generatedAt", "version", "targetPath", "tag", "artifactPath", "status", "exitCode", "uploaded", "uploadCommand", "releaseEvidence"]
  },
  {
    id: "doctor.npm.json",
    command: "codex-plugin-doctor doctor npm <package> --json",
    outputKind: "doctor.npm",
    required: ["schemaVersion", "kind", "generatedAt", "package", "tarball", "summary", "validation", "security", "trust", "recommendations"]
  },
  {
    id: "doctor.risk.diff.json",
    command: "codex-plugin-doctor doctor diff --before <path> --after <path> --json",
    outputKind: "doctor.risk.diff",
    required: ["schemaVersion", "kind", "generatedAt", "before", "after", "summary", "risk"]
  },
  {
    id: "doctor.inspector.json",
    command: "codex-plugin-doctor doctor inspector <path> --json",
    outputKind: "doctor.inspector",
    required: ["schemaVersion", "kind", "generatedAt", "targetPath", "status"]
  },
  {
    id: "doctor.snapshot.json",
    command: "codex-plugin-doctor doctor snapshot --json",
    required: ["schemaVersion", "generatedAt", "version", "environment", "clients", "installedPlugins", "nextCommands"]
  }
];

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function contractRules(rules: RuleDefinition[]): OutputContractRule[] {
  return rules
    .map((rule) => ({
      id: rule.id,
      category: rule.category,
      defaultSeverity: rule.defaultSeverity
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function buildSchema(
  id: string,
  outputKind: string | null,
  required: string[],
  schemaProperties: Record<string, unknown> = {}
): JsonSchema {
  const properties: Record<string, unknown> = {
    schemaVersion: {
      const: "1.0.0"
    }
  };

  if (outputKind) {
    properties.kind = {
      const: outputKind
    };
  }

  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `https://github.com/Esquetta/CodexPluginDoctor/schemas/${id}`,
    title: id,
    type: "object",
    required: [...new Set(["schemaVersion", ...required])],
    properties: {
      ...properties,
      ...schemaProperties
    },
    additionalProperties: true
  };
}

function buildSchemas(): OutputContractSchema[] {
  return publicSchemaDefinitions.map((definition) => {
    const outputKind = definition.outputKind ?? null;

    return {
      id: definition.id,
      command: definition.command,
      schemaVersion: "1.0.0",
      stability: "stable-through-1.0",
      outputKind,
      schema: buildSchema(
        definition.id,
        outputKind,
        definition.required ?? [],
        definition.properties
      )
    };
  });
}

export function buildDoctorOutputContract(
  generatedAt = new Date().toISOString()
): DoctorOutputContract {
  const rules = contractRules(ruleCatalog);

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.output.contract",
    generatedAt,
    version: packageVersion,
    contract: {
      frozenSince: "0.18.0",
      stability: "stable-through-1.0",
      compatibility: "Public JSON schema surfaces and existing rule IDs/default severities are treated as stable through 1.0.0; breaking changes require a schemaVersion or major version change."
    },
    ruleCatalog: {
      status: "frozen",
      frozenSince: "0.18.0",
      ruleCount: rules.length,
      digest: sha256(stableStringify(rules)),
      rules
    },
    schemas: buildSchemas()
  };
}

export function renderDoctorOutputContractJson(contract: DoctorOutputContract): string {
  return JSON.stringify(contract, null, 2);
}

export function renderDoctorOutputContract(
  contract: DoctorOutputContract,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Output Contract",
    "======================",
    `Version: ${contract.version}`,
    `Contract: ${contract.contract.stability} (since ${contract.contract.frozenSince})`,
    `Rule catalog: ${contract.ruleCatalog.status}`,
    `Rule digest: ${contract.ruleCatalog.digest}`,
    `Rules: ${contract.ruleCatalog.ruleCount}`,
    `Schemas: ${contract.schemas.length}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Schema surfaces", "---------------");

  for (const schema of contract.schemas) {
    lines.push(`- ${schema.id}: ${schema.command}`);
  }

  return lines.join("\n");
}
