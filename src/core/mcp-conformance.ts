import type {
  Finding,
  FindingEvidence,
  McpConformanceObservation,
  McpConformanceProfile,
  McpConformanceResult,
  RuntimeCapabilityStatus,
  RuntimeConformanceScorecard,
  TasksListObservation
} from "../domain/types.js";

type JsonObject = Record<string, unknown>;
type TaskToolsCallCapabilityState = "present-valid" | "missing" | "malformed";

const LATEST_PROTOCOL_VERSION = "2025-11-25";
const LEGACY_PROTOCOL_VERSIONS = new Set([
  "2024-11-05",
  "2025-03-26",
  "2025-06-18"
]);
const CANONICAL_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildFinding(
  id: string,
  severity: Finding["severity"],
  message: string,
  impact: string,
  suggestedFix: string,
  evidence?: FindingEvidence
): Finding {
  return {
    id,
    severity,
    message,
    impact,
    suggestedFix,
    ...(evidence ? { evidence } : {})
  };
}

function classifyProtocolVersion(protocolVersion: string): McpConformanceProfile {
  if (LEGACY_PROTOCOL_VERSIONS.has(protocolVersion)) {
    return "legacy";
  }

  if (protocolVersion === LATEST_PROTOCOL_VERSION) {
    return "2025-11-25";
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(protocolVersion) && protocolVersion > LATEST_PROTOCOL_VERSION) {
    return "future-compatible";
  }

  return "legacy";
}

function addTaskCapabilityFailure(findings: Finding[], field: string): void {
  findings.push(
    buildFinding(
      "mcp.conformance.tasks.capability_invalid",
      "fail",
      `The Tasks capability field \`${field}\` must be an object when present.`,
      "Codex cannot safely determine whether the server supports task-aware tool calls.",
      `Return an object for \`${field}\`, or omit the capability until it is implemented.`,
      { field }
    )
  );
}

function getTaskToolsCallCapabilityState(
  capabilities: unknown,
  findings: Finding[]
): TaskToolsCallCapabilityState {
  if (!isPlainObject(capabilities)) {
    addTaskCapabilityFailure(findings, "capabilities");
    return "malformed";
  }

  const tasks = capabilities.tasks;
  if (tasks === undefined) {
    return "missing";
  }

  if (!isPlainObject(tasks)) {
    addTaskCapabilityFailure(findings, "capabilities.tasks");
    return "malformed";
  }

  for (const key of ["list", "cancel"] as const) {
    if (tasks[key] !== undefined && !isPlainObject(tasks[key])) {
      addTaskCapabilityFailure(findings, `capabilities.tasks.${key}`);
    }
  }

  const requests = tasks.requests;
  if (requests === undefined) {
    return "missing";
  }

  if (!isPlainObject(requests)) {
    addTaskCapabilityFailure(findings, "capabilities.tasks.requests");
    return "malformed";
  }

  const tools = requests.tools;
  if (tools === undefined) {
    return "missing";
  }

  if (!isPlainObject(tools)) {
    addTaskCapabilityFailure(findings, "capabilities.tasks.requests.tools");
    return "malformed";
  }

  const call = tools.call;
  if (call === undefined) {
    return "missing";
  }

  if (!isPlainObject(call)) {
    addTaskCapabilityFailure(findings, "capabilities.tasks.requests.tools.call");
    return "malformed";
  }

  return "present-valid";
}

function collectTaskDeclarationFindings(
  observation: McpConformanceObservation,
  taskCallCapabilityState: TaskToolsCallCapabilityState,
  findings: Finding[]
): void {
  for (const tool of observation.tools) {
    let taskSupport: unknown = "forbidden";

    if (tool.execution !== undefined) {
      if (!isPlainObject(tool.execution)) {
        findings.push(
          buildFinding(
            "mcp.conformance.tasks.task_support_invalid",
            "fail",
            `Tool \`${tool.name}\` has a non-object execution declaration.`,
            "Codex cannot safely interpret the tool's task support contract.",
            "Return an object for `execution` with taskSupport set to required, optional, or forbidden.",
            { toolName: tool.name }
          )
        );
        continue;
      }

      taskSupport = tool.execution.taskSupport ?? "forbidden";
    }

    if (
      taskSupport !== "required" &&
      taskSupport !== "optional" &&
      taskSupport !== "forbidden"
    ) {
      findings.push(
        buildFinding(
          "mcp.conformance.tasks.task_support_invalid",
          "fail",
          `Tool \`${tool.name}\` declares an unsupported taskSupport value.`,
          "Codex cannot determine whether task-aware tool calls are required or optional.",
          "Set execution.taskSupport to required, optional, or forbidden.",
          { toolName: tool.name }
        )
      );
      continue;
    }

    if (taskSupport !== "forbidden" && taskCallCapabilityState === "missing") {
      findings.push(
        buildFinding(
          "mcp.conformance.tasks.capability_mismatch",
          "fail",
          `Tool \`${tool.name}\` declares task support without tasks.requests.tools.call capability.`,
          "Codex may attempt task-aware tool calls that the server did not advertise as supported.",
          "Advertise capabilities.tasks.requests.tools.call as an object, or set execution.taskSupport to forbidden.",
          { toolName: tool.name, taskSupport }
        )
      );
    }
  }
}

function isAbsoluteUri(value: string): boolean {
  try {
    return new URL(value).protocol.length > 0;
  } catch {
    return false;
  }
}

function collectSchemaFindings(observation: McpConformanceObservation, findings: Finding[]): void {
  for (const tool of observation.tools) {
    const schemas: Array<["inputSchema" | "outputSchema", unknown]> = [
      ["inputSchema", tool.inputSchema]
    ];

    if (tool.outputSchema !== undefined) {
      schemas.push(["outputSchema", tool.outputSchema]);
    }

    for (const [schemaName, schema] of schemas) {
      if (!isPlainObject(schema)) {
        findings.push(
          buildFinding(
            "mcp.conformance.schema.dialect_invalid",
            "fail",
            `Tool \`${tool.name}\` has a non-object ${schemaName} container.`,
            "Codex cannot interpret a tool schema that is not represented as an object.",
            `Return an object for ${schemaName}.`,
            { toolName: tool.name, schema: schemaName }
          )
        );
        continue;
      }

      const dialect = schema.$schema;
      if (dialect === undefined) {
        continue;
      }

      if (typeof dialect !== "string" || !isAbsoluteUri(dialect)) {
        findings.push(
          buildFinding(
            "mcp.conformance.schema.dialect_invalid",
            "fail",
            `Tool \`${tool.name}\` has an invalid ${schemaName} $schema URI.`,
            "Codex cannot reliably select a schema dialect for this tool.",
            `Omit $schema or provide an absolute URI in ${schemaName}.`,
            { toolName: tool.name, schema: schemaName }
          )
        );
        continue;
      }

      if (dialect !== CANONICAL_SCHEMA_DIALECT && dialect !== `${CANONICAL_SCHEMA_DIALECT}#`) {
        findings.push(
          buildFinding(
            "mcp.conformance.schema.dialect_unsupported",
            "warn",
            `Tool \`${tool.name}\` uses a non-canonical ${schemaName} $schema dialect.`,
            "The schema may be valid, but its dialect is outside the validator's latest compatibility baseline.",
            `Use ${CANONICAL_SCHEMA_DIALECT} or omit $schema.`,
            { toolName: tool.name, schema: schemaName }
          )
        );
      }
    }
  }
}

function collectTasksListFinding(observation: TasksListObservation | undefined, findings: Finding[]): RuntimeCapabilityStatus {
  if (!observation || observation.status === "skipped") {
    return "skipped";
  }

  if (observation.status === "pass") {
    return "pass";
  }

  const timeout = observation.failure === "timeout";
  findings.push(
    buildFinding(
      timeout
        ? "mcp.conformance.tasks_list.timeout"
        : "mcp.conformance.tasks_list.invalid",
      "fail",
      timeout
        ? "The server did not complete tasks/list within the observation window."
        : "The server returned an invalid tasks/list observation.",
      "Codex cannot rely on task discovery when tasks/list cannot complete with a valid response.",
      timeout
        ? "Reduce tasks/list latency and verify pagination completes."
        : "Return a valid tasks/list response with well-formed task items and pagination."
    )
  );
  return "fail";
}

function statusForFindings(findings: Finding[]): RuntimeCapabilityStatus {
  if (findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }

  if (findings.some((finding) => finding.severity === "warn")) {
    return "warn";
  }

  return "pass";
}

function overallStatus(
  scorecard: RuntimeConformanceScorecard,
  findings: Finding[]
): "pass" | "warn" | "fail" {
  const statuses = [
    scorecard.capabilityConsistency,
    scorecard.taskDeclarations,
    scorecard.tasksList,
    scorecard.schemaDialect
  ];

  if (statuses.includes("fail") || findings.some((finding) => finding.severity === "fail")) {
    return "fail";
  }

  if (statuses.includes("warn") || findings.some((finding) => finding.severity === "warn")) {
    return "warn";
  }

  return "pass";
}

export function evaluateMcpConformance(
  observation: McpConformanceObservation
): McpConformanceResult {
  const profile = classifyProtocolVersion(observation.protocolVersion);
  const findings: Finding[] = [];
  const scorecard: RuntimeConformanceScorecard = {
    protocolVersion: observation.protocolVersion,
    profile,
    capabilityConsistency: "skipped",
    taskDeclarations: "skipped",
    tasksList: "skipped",
    schemaDialect: "skipped",
    overall: "pass"
  };

  if (profile === "future-compatible") {
    findings.push(
      buildFinding(
        "mcp.conformance.protocol.unknown_newer",
        "warn",
        `The server advertises newer MCP protocol version \`${observation.protocolVersion}\`.`,
        "The validator applies the 2025-11-25 structural baseline, which may not cover newer protocol requirements.",
        "Confirm the server's newer protocol changes remain compatible with the 2025-11-25 MCP contract.",
        { protocolVersion: observation.protocolVersion }
      )
    );
  }

  if (profile === "legacy") {
    scorecard.overall = overallStatus(scorecard, findings);
    return { findings, scorecard };
  }

  const capabilityFindings: Finding[] = [];
  const taskCallCapabilityState = getTaskToolsCallCapabilityState(
    observation.capabilities,
    capabilityFindings
  );
  findings.push(...capabilityFindings);
  scorecard.capabilityConsistency = statusForFindings(capabilityFindings);

  const declarationFindings: Finding[] = [];
  collectTaskDeclarationFindings(observation, taskCallCapabilityState, declarationFindings);
  findings.push(...declarationFindings);
  scorecard.taskDeclarations = statusForFindings(declarationFindings);

  scorecard.tasksList = collectTasksListFinding(observation.tasksList, findings);

  const schemaFindings: Finding[] = [];
  collectSchemaFindings(observation, schemaFindings);
  findings.push(...schemaFindings);
  scorecard.schemaDialect = statusForFindings(schemaFindings);
  scorecard.overall = overallStatus(scorecard, findings);

  return { findings, scorecard };
}
