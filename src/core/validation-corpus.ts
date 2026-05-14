import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildPackageAnalysis,
  type PackageAnalysisOptions
} from "./package-analysis.js";
import { validatePlugin } from "./validate-plugin.js";
import { matrixExitCode } from "../compatibility/compatibility-matrix.js";
import { buildGenericMcpDoctor } from "../mcp/generic-mcp-doctor.js";
import { packageVersion } from "../version.js";

type ValidationStatus = "pass" | "warn" | "fail";

export interface ValidationCorpusCaseDefinition {
  id: string;
  label: string;
  profile: string;
  sourceType: "bundled-example";
  relativePath: string;
  runtimeEnabled: boolean;
  mode?: "codex-plugin" | "generic-mcp";
  expected: {
    validationStatus: ValidationStatus;
    findingIds?: string[];
  };
}

export interface ValidationCorpusCaseResult {
  id: string;
  label: string;
  profile: string;
  sourceType: "bundled-example";
  targetPath: string;
  runtimeEnabled: boolean;
  expected: {
    validationStatus: ValidationStatus;
    findingIds: string[];
  };
  actual: {
    validationStatus: ValidationStatus;
    findingIds: string[];
    securityStatus: ValidationStatus;
    trustStatus: ValidationStatus;
    compatibilityFailedClients: string[];
  };
  expectationMatched: boolean;
}

export interface DoctorValidationCorpusReport {
  schemaVersion: "1.0.0";
  kind: "doctor.validation.corpus";
  generatedAt: string;
  version: string;
  summary: {
    status: "pass" | "fail";
    caseCount: number;
    passedExpectations: number;
    failedExpectations: number;
    runtimeCases: number;
  };
  cases: ValidationCorpusCaseResult[];
}

export interface BuildDoctorValidationCorpusOptions {
  environment?: PackageAnalysisOptions["environment"];
}

const bundledCorpusCases: ValidationCorpusCaseDefinition[] = [
  {
    id: "bundled-runtime-healthy",
    label: "Bundled runtime-complete example",
    profile: "healthy-runtime",
    sourceType: "bundled-example",
    relativePath: "examples/codex-doctor-runtime",
    runtimeEnabled: true,
    expected: {
      validationStatus: "pass"
    }
  },
  {
    id: "bundled-risky-security",
    label: "Bundled risky security example",
    profile: "risky-security",
    sourceType: "bundled-example",
    relativePath: "examples/codex-doctor-risky",
    runtimeEnabled: false,
    expected: {
      validationStatus: "fail",
      findingIds: ["plugin.security.hard_coded_secret"]
    }
  },
  {
    id: "bundled-starter-skill",
    label: "Bundled starter skill-only example",
    profile: "skill-only",
    sourceType: "bundled-example",
    relativePath: "examples/codex-doctor-starter",
    runtimeEnabled: false,
    expected: {
      validationStatus: "pass"
    }
  },
  {
    id: "bundled-generic-mcp",
    label: "Bundled generic MCP package",
    profile: "generic-mcp",
    sourceType: "bundled-example",
    relativePath: "examples/codex-doctor-generic-mcp",
    runtimeEnabled: false,
    mode: "generic-mcp",
    expected: {
      validationStatus: "pass"
    }
  }
];

function resolvePackageRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function includesExpectedFindings(
  actualFindingIds: string[],
  expectedFindingIds: string[]
): boolean {
  return expectedFindingIds.every((findingId) => actualFindingIds.includes(findingId));
}

async function runCorpusCase(
  caseDefinition: ValidationCorpusCaseDefinition,
  options: BuildDoctorValidationCorpusOptions
): Promise<ValidationCorpusCaseResult> {
  const targetPath = path.resolve(resolvePackageRoot(), caseDefinition.relativePath);
  const expectedFindingIds = [...(caseDefinition.expected.findingIds ?? [])].sort();

  if (caseDefinition.mode === "generic-mcp") {
    const report = await buildGenericMcpDoctor(targetPath, options.environment);
    const findingIds = report.findings.map((finding) => finding.id).sort();
    const compatibilityFailedClients = report.compatibility.results
      .filter((result) => result.status === "fail")
      .map((result) => result.client);
    const expectationMatched =
      report.status === caseDefinition.expected.validationStatus &&
      includesExpectedFindings(findingIds, expectedFindingIds);

    return {
      id: caseDefinition.id,
      label: caseDefinition.label,
      profile: caseDefinition.profile,
      sourceType: caseDefinition.sourceType,
      targetPath,
      runtimeEnabled: caseDefinition.runtimeEnabled,
      expected: {
        validationStatus: caseDefinition.expected.validationStatus,
        findingIds: expectedFindingIds
      },
      actual: {
        validationStatus: report.status,
        findingIds,
        securityStatus: report.security.status,
        trustStatus: "pass",
        compatibilityFailedClients
      },
      expectationMatched
    };
  }

  const analysis = await buildPackageAnalysis(targetPath, {
    environment: options.environment,
    runCheck: (pathToCheck) => validatePlugin(pathToCheck, {
      runtime: caseDefinition.runtimeEnabled
    })
  });
  const findingIds = analysis.validation.findings.map((finding) => finding.id).sort();
  const compatibilityFailedClients = analysis.compatibility.results
    .filter((result) => result.status === "fail")
    .map((result) => result.client);
  const expectationMatched =
    analysis.validation.status === caseDefinition.expected.validationStatus &&
    includesExpectedFindings(findingIds, expectedFindingIds);

  return {
    id: caseDefinition.id,
    label: caseDefinition.label,
    profile: caseDefinition.profile,
    sourceType: caseDefinition.sourceType,
    targetPath,
    runtimeEnabled: caseDefinition.runtimeEnabled,
    expected: {
      validationStatus: caseDefinition.expected.validationStatus,
      findingIds: expectedFindingIds
    },
    actual: {
      validationStatus: analysis.validation.status,
      findingIds,
      securityStatus: analysis.security.status,
      trustStatus: analysis.trust.status,
      compatibilityFailedClients: matrixExitCode(analysis.compatibility) === 1
        ? compatibilityFailedClients
        : []
    },
    expectationMatched
  };
}

export async function buildDoctorValidationCorpusReport(
  options: BuildDoctorValidationCorpusOptions = {}
): Promise<DoctorValidationCorpusReport> {
  const cases = await Promise.all(
    bundledCorpusCases.map((caseDefinition) => runCorpusCase(caseDefinition, options))
  );
  const failedExpectations = cases.filter((caseResult) => !caseResult.expectationMatched).length;

  return {
    schemaVersion: "1.0.0",
    kind: "doctor.validation.corpus",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    summary: {
      status: failedExpectations > 0 ? "fail" : "pass",
      caseCount: cases.length,
      passedExpectations: cases.length - failedExpectations,
      failedExpectations,
      runtimeCases: cases.filter((caseResult) => caseResult.runtimeEnabled).length
    },
    cases
  };
}

export function renderDoctorValidationCorpusJson(report: DoctorValidationCorpusReport): string {
  return JSON.stringify(report, null, 2);
}

export function renderDoctorValidationCorpusReport(
  report: DoctorValidationCorpusReport,
  options: { outputPath?: string | null } = {}
): string {
  const lines = [
    "Doctor Validation Corpus",
    "========================",
    `Version: ${report.version}`,
    `Status: ${report.summary.status.toUpperCase()}`,
    `Cases: ${report.summary.caseCount}`,
    `Passed expectations: ${report.summary.passedExpectations}`,
    `Failed expectations: ${report.summary.failedExpectations}`,
    `Runtime cases: ${report.summary.runtimeCases}`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Cases", "-----");

  for (const caseResult of report.cases) {
    lines.push(
      `${caseResult.id}: ${caseResult.expectationMatched ? "PASS" : "FAIL"} ` +
      `(${caseResult.actual.validationStatus.toUpperCase()}, ${caseResult.actual.findingIds.length} findings)`
    );
  }

  return lines.join("\n");
}
