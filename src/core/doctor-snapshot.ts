import type { CliTerminalContext } from "../run-cli.js";
import {
  buildClientDoctorReport,
  buildEnvironmentDoctorReport,
  type ClientDoctorResult,
  type EnvironmentDoctorReport
} from "./environment-doctor.js";
import {
  discoverInstalledPlugins,
  type InstalledPlugin
} from "./discover-installed-plugins.js";
import { packageVersion } from "../version.js";

export interface DoctorSnapshot {
  schemaVersion: "1.0.0";
  generatedAt: string;
  version: string;
  environment: EnvironmentDoctorReport;
  clients: ClientDoctorResult[];
  installedPlugins: {
    count: number;
    plugins: InstalledPlugin[];
  };
  recommendations: string[];
}

export async function buildDoctorSnapshot(
  terminalContext: CliTerminalContext
): Promise<DoctorSnapshot> {
  const [environment, clients, installedPlugins] = await Promise.all([
    buildEnvironmentDoctorReport(terminalContext),
    buildClientDoctorReport(terminalContext),
    discoverInstalledPlugins({ env: terminalContext.env })
  ]);

  return {
    schemaVersion: "1.0.0",
    generatedAt: new Date().toISOString(),
    version: packageVersion,
    environment,
    clients,
    installedPlugins: {
      count: installedPlugins.length,
      plugins: installedPlugins
    },
    recommendations: [
      "codex-plugin-doctor self-test",
      "codex-plugin-doctor list --installed",
      "codex-plugin-doctor check --installed --all-summary",
      "codex-plugin-doctor compat . --all --scorecard"
    ]
  };
}

export function renderDoctorSnapshotJson(snapshot: DoctorSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

export function renderDoctorSnapshot(
  snapshot: DoctorSnapshot,
  options: { outputPath?: string | null } = {}
): string {
  const passClients = snapshot.clients.filter((client) => client.status === "pass").length;
  const warnClients = snapshot.clients.filter((client) => client.status === "warn").length;
  const lines = [
    "Codex Plugin Doctor Snapshot",
    "============================",
    `Generated: ${snapshot.generatedAt}`,
    `Version: ${snapshot.version}`,
    `Platform: ${snapshot.environment.platform}`,
    `Node: ${snapshot.environment.node}`,
    `Codex home: ${snapshot.environment.codexHome.status.toUpperCase()}${snapshot.environment.codexHome.path ? ` (${snapshot.environment.codexHome.path})` : ""}`,
    `Codex plugin cache: ${snapshot.environment.codexPluginCache.status.toUpperCase()}${snapshot.environment.codexPluginCache.path ? ` (${snapshot.environment.codexPluginCache.path})` : ""}`,
    `Installed plugins: ${snapshot.installedPlugins.count}`,
    `Clients: ${passClients} pass, ${warnClients} warn`
  ];

  if (options.outputPath) {
    lines.push(`Output: ${options.outputPath}`);
  }

  lines.push("", "Clients", "-------");

  for (const client of snapshot.clients) {
    lines.push(`${client.client}: ${client.status.toUpperCase()} - ${client.summary}`);
  }

  lines.push("", "Installed Plugins", "-----------------");

  if (snapshot.installedPlugins.plugins.length === 0) {
    lines.push("No installed Codex plugins found.");
  } else {
    for (const plugin of snapshot.installedPlugins.plugins) {
      const version = plugin.version ? `@${plugin.version}` : "";
      lines.push(`- ${plugin.name}${version} (${plugin.relativePath})`);
    }
  }

  lines.push("", "Recommended Next Commands", "-------------------------");
  lines.push(...snapshot.recommendations);

  return lines.join("\n");
}
