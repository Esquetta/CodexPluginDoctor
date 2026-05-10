import type { CompatibilityMatrix } from "../compatibility/compatibility-matrix.js";
import type { InstalledPlugin } from "../core/discover-installed-plugins.js";
import type { CheckResult, JsonReport } from "../domain/types.js";
import { buildJsonReport } from "./render-json-report.js";
import { renderSarifReport } from "./render-sarif-report.js";

export interface InstalledCheckItem {
  plugin: InstalledPlugin;
  result: CheckResult;
  compatibilityMatrix?: CompatibilityMatrix;
}

export interface InstalledCheckJsonReport {
  schemaVersion: "1.0.0";
  kind: "doctor.installed.check";
  generatedAt: string;
  summary: {
    status: "pass" | "warn" | "fail";
    checked: number;
    pass: number;
    warn: number;
    fail: number;
  };
  plugins: Array<{
    plugin: {
      name: string;
      version?: string;
      rootPath: string;
      relativePath: string;
    };
    report: JsonReport;
    compatibilityMatrix?: CompatibilityMatrix;
  }>;
}

function summarizeStatus(items: InstalledCheckItem[]): InstalledCheckJsonReport["summary"] {
  const pass = items.filter((item) => item.result.status === "pass").length;
  const warn = items.filter((item) => item.result.status === "warn").length;
  const fail = items.filter((item) => item.result.status === "fail").length;

  return {
    status: fail > 0 ? "fail" : warn > 0 ? "warn" : "pass",
    checked: items.length,
    pass,
    warn,
    fail
  };
}

export function buildInstalledJsonReport(
  items: InstalledCheckItem[],
  options: { runtimeProbeEnabled: boolean }
): InstalledCheckJsonReport {
  return {
    schemaVersion: "1.0.0",
    kind: "doctor.installed.check",
    generatedAt: new Date().toISOString(),
    summary: summarizeStatus(items),
    plugins: items.map((item) => ({
      plugin: {
        name: item.plugin.name,
        ...(item.plugin.version ? { version: item.plugin.version } : {}),
        rootPath: item.plugin.rootPath,
        relativePath: item.plugin.relativePath
      },
      report: buildJsonReport(item.result, options),
      ...(item.compatibilityMatrix ? { compatibilityMatrix: item.compatibilityMatrix } : {})
    }))
  };
}

export function renderInstalledJsonReport(
  items: InstalledCheckItem[],
  options: { runtimeProbeEnabled: boolean }
): string {
  return JSON.stringify(buildInstalledJsonReport(items, options), null, 2);
}

export function renderInstalledSarifReport(items: InstalledCheckItem[]): string {
  const runs = items.flatMap((item) => {
    const sarif = JSON.parse(renderSarifReport(item.result)) as {
      runs: Array<Record<string, unknown>>;
    };

    return sarif.runs.map((run) => ({
      ...run,
      automationDetails: {
        id: item.plugin.name
      },
      properties: {
        pluginName: item.plugin.name,
        ...(item.plugin.version ? { pluginVersion: item.plugin.version } : {}),
        pluginPath: item.plugin.rootPath
      }
    }));
  });

  return JSON.stringify(
    {
      version: "2.1.0",
      $schema: "https://json.schemastore.org/sarif-2.1.0.json",
      runs
    },
    null,
    2
  );
}
