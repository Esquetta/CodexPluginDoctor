export type CompletionShell = "bash" | "zsh" | "fish";

const topLevelCommands = [
  "check",
  "audit",
  "mcp",
  "security",
  "compat",
  "suppress",
  "fix",
  "history",
  "watch",
  "doctor",
  "init",
  "init-ci",
  "init-git-hooks",
  "self-test",
  "list",
  "explain",
  "config"
];

function bashCompletion(): string {
  return [
    "_codex_plugin_doctor() {",
    "  local cur prev",
    "  COMPREPLY=()",
    "  cur=\"${COMP_WORDS[COMP_CWORD]}\"",
    "  prev=\"${COMP_WORDS[COMP_CWORD-1]}\"",
    "",
    `  local commands="${topLevelCommands.join(" ")}"`,
    "",
    "  case \"${prev}\" in",
    "    codex-plugin-doctor)",
    "      COMPREPLY=( $(compgen -W \"${commands}\" -- \"${cur}\") )",
    "      return 0",
    "      ;;",
    "  esac",
    "",
    "  case \"${cur}\" in",
    "    --*)",
    "      local flags=\"--json --output --runtime --policy --help\"",
    "      COMPREPLY=( $(compgen -W \"${flags}\" -- \"${cur}\") )",
    "      return 0",
    "      ;;",
    "    *)",
    "      COMPREPLY=( $(compgen -W \"${commands}\" -- \"${cur}\") )",
    "      return 0",
    "      ;;",
    "  esac",
    "}",
    "",
    "complete -F _codex_plugin_doctor codex-plugin-doctor",
    ""
  ].join("\n");
}

function zshCompletion(): string {
  return [
    "#compdef codex-plugin-doctor",
    "",
    "_codex_plugin_doctor() {",
    "  local context state line",
    "  typeset -A opt_args",
    "",
    `  local commands=(${topLevelCommands.join(" ")})`,
    "",
    "  _arguments -C \\",
    "    '1:command:(${commands})' \\",
    "    '*--json[Output as JSON]' \\",
    "    '*--output[Write to file]:file:_files' \\",
    "    '*--runtime[Enable runtime probes]' \\",
    "    '*--policy[Apply policy]:policy:(codex-publish mcp-strict security)'",
    "}",
    "",
    "_codex_plugin_doctor \"$@\"",
    ""
  ].join("\n");
}

function fishCompletion(): string {
  return [
    "complete -c codex-plugin-doctor -f",
    `complete -c codex-plugin-doctor -n "not __fish_seen_subcommand_from ${topLevelCommands.join(" ")}" -a "${topLevelCommands.join(" ")}"`,
    "complete -c codex-plugin-doctor -s h -l help -d 'Show help'",
    "complete -c codex-plugin-doctor -l json -d 'Output as JSON'",
    "complete -c codex-plugin-doctor -l output -d 'Write to file' -r",
    "complete -c codex-plugin-doctor -l runtime -d 'Enable runtime probes'",
    "complete -c codex-plugin-doctor -l policy -d 'Apply policy' -x -a 'codex-publish mcp-strict security'",
    ""
  ].join("\n");
}

export function generateCompletion(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return bashCompletion();
    case "zsh":
      return zshCompletion();
    case "fish":
      return fishCompletion();
  }
}
