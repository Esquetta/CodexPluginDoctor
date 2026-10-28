# GitHub Action Usage

## Purpose

Use the Codex Plugin Doctor GitHub Action when a plugin repository should fail pull requests before broken packaging, unsafe MCP config, or runtime protocol issues reach users.

The action installs `codex-plugin-doctor` from npm, then runs the same CLI used locally.

## Remote MCP Runtime Probing

Remote MCP checks are off by default. Set `runtime: "true"` and give explicit network consent only for endpoints you trust. Use `allow-local-network: "true"` for loopback endpoints only (`localhost`, `127.0.0.0/8`, or `::1`). Private, link-local, multicast, unspecified, reserved, and NAT64 ranges remain blocked.

```yaml
- uses: ./
  with:
    path: .
    runtime: "true"
    allow-network: "true"
    allow-local-network: "true" # Remove for public endpoints.
    require-remote-reliability: "true" # Fails unless every attempted reliability scorecard passes.
```

The Action transfers these boolean inputs through environment-backed shell variables and a Bash argument array. `require-remote-reliability` is a strict result gate, not network consent: it fails unless every attempted remote reliability scorecard passes. Local-only runs are unaffected. Keep `allow-session-lifecycle: "false"` (the default) unless the workflow explicitly authorizes one bounded, state-changing session `DELETE` after a valid session is issued. Remote probes redact diagnostics and retain no raw remote content; see [Remote MCP Readiness](../architecture/remote-mcp-readiness.md) and [Remote MCP Transport Reliability](../architecture/remote-mcp-transport-reliability.md) for SSRF, OAuth metadata-discovery, SSE, and lifecycle boundaries.

## MCP Registry Readiness

Use local Registry metadata gating when the repository contains a `server.json` intended for publication:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    registry-metadata: ./server.json
    require-registry-readiness: "true"
```

The Action writes `mcp-registry-readiness.json` and exposes `registry-report-path`. This path is checked locally; the Action does not inspect the live Registry and does not grant network access. `require-registry-readiness` requires `registry-metadata` and blocks warnings as well as failures.

## Public Directory Submission Preflight

Use the submission preflight only when a workflow needs its separate offline report:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    submission: "true"
    require-submission-ready: "true"
```

`submission` writes `codex-plugin-doctor-submission.json` and `codex-plugin-doctor-submission.md` under `output-dir`, uploads them with the existing artifact directory, appends the Markdown report after the primary summary, and exposes `submission-json-path` and `submission-summary-path` outputs. It does not require runtime or network access, forwards neither runtime nor network consent, and does not start MCP servers or use portal, domain-verification, or OAuth credentials.

The report's automatic status is separate from manual review: a passing automatic result is still `manual_review_required`, not portal approval. The Action never submits a package or claims acceptance. `require-submission-ready` makes automatic blockers fail the Action status; it requires `submission: "true"`, otherwise the Action records usage status `2` without running a submission command.

### Archive Submission Preflight

Use archive mode for the existing skills-only ZIP that will be uploaded:

```yaml
- uses: ./
  with:
    submission-archive: ./plugin.zip
    require-submission-ready: "true"
```

Archive mode writes `codex-plugin-doctor-submission-archive.json` and `codex-plugin-doctor-submission-archive.md` under `output-dir`, uploads them with the existing artifact directory, appends the Markdown report after the primary summary, and exposes `submission-archive-json-path` and `submission-archive-summary-path` outputs.

It is offline, non-executing, and does not extract archive entries to disk. It forwards no runtime, network, local-network, session-lifecycle, authentication, or portal credentials. It accepts an existing ZIP only; it does not create, rewrite, repair, or upload archives.

Choose exactly one submission mode: directory `submission: "true"` or `submission-archive`. Selecting both modes, or setting `require-submission-ready: "true"` with neither, records usage status `2` and produces no submission reports. The installed-cache guard remains for directory submission mode.

Archive warnings identify MCP configuration, apps, or screenshots that require the MCP-backed portal flow; warnings do not make strict readiness fail. Archive blockers make `--require-ready` fail, but a non-strict report remains advisory. A passing automatic result remains `manual_review_required`, and any portal rule Doctor cannot faithfully implement remains `coverage: unavailable`; the Action never claims portal approval.

## MCP Tool Definition Diff

Compare two saved MCP `tools/list` responses, for example a committed baseline and
a capture made earlier in the job with `doctor tools --save-response`:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    tools-diff-before: mcp/tools-baseline.json
    tools-diff-after: tools-current.json
    tools-diff-fail-on: breaking
```

The Action runs `doctor tools-diff` offline, writes `mcp-tools-diff.json` and
`mcp-tools-diff.md` under `output-dir`, uploads them with the existing artifact
directory, appends the Markdown summary (the `tools-diff --markdown` tables plus
the exit status and fail-on mode; a text block when the installed CLI predates
`--markdown`) to the step summary, and exposes
`tools-diff-json-path` and `tools-diff-summary-path` outputs. The comparison exit
code feeds the Action status. `tools-diff-fail-on` defaults to `any`; `breaking`
fails only on breaking or unclassified changes. Setting only one of
`tools-diff-before` and `tools-diff-after`, or another `tools-diff-fail-on` value,
records usage status `2` without running a comparison. The comparison itself is
offline; use `tools-capture-url` or `tools-capture-server` below to capture the
live tool list in the same step.

See [Offline MCP Tool Diff](offline-tool-diff.md) for impact labels and exit codes.

### Pull request comment

Set `tools-diff-comment: "true"` to post the same Markdown summary as one
pull request comment, updated in place on later runs:

```yaml
permissions:
  contents: read
  pull-requests: write

steps:
  - uses: Esquetta/CodexPluginDoctor@v1.88.0
    with:
      version: "1.88.0"
      path: .
      tools-diff-before: mcp/tools-baseline.json
      tools-diff-after: tools-current.json
      tools-diff-comment: "true"
```

The comment runs in its own step after the comparison, only on `pull_request`
and `pull_request_target` events and only when a comparison ran. It starts with
the marker `<!-- codex-plugin-doctor:tools-diff -->`; a later run edits the most
recent bot comment that starts with that marker and otherwise posts a new one,
so comments written by people are never edited. Because the marker is shared,
use one commenting Action step per pull request: matrix jobs or several steps
overwrite each other's comment. A personal access token posts as a user, so its
comments are not recognized on later runs and each run adds a new one. Summaries
longer than about 60,000 bytes are cut, with a note that the full diff is in
`mcp-tools-diff.md` in the report directory. The summary holds counts, impact
labels, and reason codes; like the reports, it omits tool and property names.
Commenting supports GitHub.com only; on GitHub Enterprise Server the step is
skipped with a message.

The step uses `github-token`, which defaults to the workflow's `github.token` and
needs `pull-requests: write`. The token is set only in the comment step's
environment, not in the step that runs Doctor. That is not a boundary against
package code: with `runtime: "true"` (which `tools-capture-server` requires),
package code runs earlier in the same job and can change what later steps run,
for example by placing a different `gh` on `GITHUB_PATH`. The comment is
therefore skipped with a warning, on every event, whenever this Action invocation
can run package code: with `runtime: "true"`, `profile: publish`, or
`policy: codex-publish` or `mcp-strict`. The runner evaluates that condition
before the step starts, so the token is not given to any step. Package code
started by an earlier step in the same job is not detected. To comment on a
runtime capture, capture in one job, upload the saved tool list as an artifact,
and compare and comment in a second job that downloads it and runs no package
code (`check: "false"`, `tools-diff-before`, `tools-diff-after`,
`tools-diff-comment: "true"`). Grant `pull-requests: write` only to the second
job, set `persist-credentials: false` on `actions/checkout` in the first, and give
the second job a different `artifact-name` (or `upload-artifact: "false"`), because
an artifact name can be uploaded only once per run. When the comment cannot be posted, for example because pull requests from
forks receive a read-only token on `pull_request` or the GitHub CLI is missing on
a self-hosted runner, the step prints a warning and the Action status still comes
from the comparison.

## MCP Server Repositories

Repositories that ship an HTTP MCP server without a Codex plugin package can turn
off the package check and compare the live tool list with a committed baseline:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    check: "false"
    allow-network: "true"
    tools-capture-url: https://mcp.example.com/mcp
    tools-capture-token-env: MCP_TOKEN
    tools-diff-before: mcp/tools-baseline.json
    tools-diff-fail-on: breaking
  env:
    MCP_TOKEN: ${{ secrets.MCP_TOKEN }}
```

`check: "false"` skips the package check and its JSON, Markdown, and SARIF
reports; `summary-path`, `json-path`, and `sarif-path` are then empty and the
manifest records `target.check: false`. Another mode, such as the tool, prompt, or
resource template diff, capture, registry, submission, corpus, contract, or review bundle, must be
configured; otherwise the Action records usage status `2`. Values other than
`true` and `false` also record status `2`.

`tools-capture-url` runs `doctor tools <url> --allow-network --save-response`
and writes `mcp-tools-current.json` under `output-dir`, exposed as the
`tools-capture-path` output. It requires `allow-network: "true"`; loopback
endpoints also require `allow-local-network: "true"`. Without consent, nothing
is requested and the Action records status `2`. When `tools-diff-before` is set
and `tools-diff-after` is empty, the capture becomes the comparison's after input;
an explicit `tools-diff-after` takes precedence. If the capture does not complete,
no response is saved, the comparison is skipped, and the Action records status
`2`. When the capture feeds a comparison, catalog warnings are judged by the
comparison and `tools-diff-fail-on`; a capture run on its own reports them
through its own exit status.

For protected servers, set `tools-capture-token-env` to the name of an environment
variable that holds a bearer token, and set that variable from a secret in the
step's `env`. The Action passes only the variable name to
`doctor tools --bearer-token-env`; the token is sent only over HTTPS or to an
approved loopback endpoint and is never printed or saved. An invalid name, an
unset variable, or `tools-capture-token-env` without `tools-capture-url` records
status `2` without a request. Combining `tools-capture-token-env` with
`runtime: "true"` is rejected with exit `2` before any Doctor command runs,
even when `check` is disabled, and so is combining it with a package check under
`profile: publish` or `policy: codex-publish` or `mcp-strict`, which turn on
runtime probing. Run capture and runtime probing in separate
Action steps, and provide the token variable only to the capture step.
The saved file contains the server's raw tool definitions and is uploaded with the
report artifact unless `upload-artifact` is `"false"`.

### Local stdio servers

To capture a stdio server from the package's MCP configuration, set
`tools-capture-server` to its name instead of `tools-capture-url`:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    check: "false"
    runtime: "true"
    tools-capture-server: my-server
    tools-diff-before: mcp/tools-baseline.json
    tools-diff-fail-on: breaking
```

The Action runs `doctor tools <path> --server <name> --runtime --save-response`
for the package at `path`, which starts the server, reads its tool list, and
stops it without invoking a tool. Starting the server runs package code, so
`runtime: "true"` is required as consent; without it no server is started and
the Action records status `2`. With `check: "true"` the same consent also turns
on runtime probing for the package check. The saved file, the
`tools-capture-path` output, and the comparison work as they do for
`tools-capture-url`. Setting both `tools-capture-server` and
`tools-capture-url`, or combining `tools-capture-server` with
`installed: "true"`, is rejected with exit `2` before any Doctor command runs,
so neither the capture nor the package check's runtime probing starts a server.
`tools-capture-token-env` is for HTTP capture only; with the `runtime: "true"`
that `tools-capture-server` needs, it is rejected with exit `2` before any
Doctor command runs, so the token never reaches package code. The capture needs
CLI `1.70.0` or later in `version`. The server starts natively and inherits the
step's environment, including any variable set in the step's `env`, so give the
step only the values the server needs to start.

Set `tools-capture-sandbox: docker` to start the server through
`doctor tools --sandbox docker` instead: Node.js commands only, no network, a
read-only package mount, and no host environment. List the variables the
container needs in `tools-capture-env`, separated by commas, spaces, or new
lines, and set them in the step's `env`; each is passed by name with `--env`, so
its value never appears in command arguments. `tools-capture-env` requires CLI
`1.72.0` or later in `version`. A sandbox other than `docker`, a sandbox without
`tools-capture-server`, `tools-capture-env` without the Docker sandbox, a name
that is not an environment variable name, or a name listed twice is rejected with
exit `2` before any Doctor command runs. The sandbox applies to the capture only:
with `check: "true"`, the package check's runtime probing still starts servers
natively. The comment guard still treats the capture as package code, because
`runtime: "true"` is set. Set `tools-capture-defer-findings: "true"` when a later
comparison in another job judges the saved list: catalog warnings and failures
found during the capture then do not fail the capture step, while a capture that
saves nothing still records status `2`. The comparison re-checks only the saved
list, not findings that exist only during the live run, such as a server that
did not answer discovery. To capture behind a runtime approval digest,
capture in an earlier step with `doctor tools --require-runtime-approval` and
pass that file as `tools-diff-after`.

`codex-plugin-doctor init-ci . --tools-diff-server <name> [--baseline <path>] [--prompts-baseline <path>] [--resource-templates-baseline <path>] [--snapshot-baseline-dir <dir>] [--sandbox docker]`
writes `.github/workflows/codex-plugin-doctor-tools.yml` with this pattern for
pull requests: a `capture` job that starts the server and uploads its lists,
and a `compare` job that downloads it and writes its reports outside the
checkout, compares it with the committed baseline (`mcp/tools-baseline.json` by default, whose directory
`init-ci` creates), fails on breaking or unclassified changes, and comments. The
capture defers catalog findings to that comparison. The baseline must be a
relative path inside the repository, and values containing `${{` or starting
with `-` are rejected. Only the `compare` job has
`pull-requests: write`, it runs no package code, and both jobs check out with
`persist-credentials: false`. Add install or build steps to the `capture` job
before the Doctor step when the server needs them; the Docker sandbox has no
network. Pull requests from forks
receive a read-only token, so the comment is skipped with a warning there while
the comparison still runs.

### Prompt lists

Every `tools-capture-*` and `tools-diff-*` input has a `prompts-*` counterpart
with the same rules, validation, and exit statuses:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    check: "false"
    runtime: "true"
    tools-capture-server: my-server
    tools-diff-before: mcp/tools-baseline.json
    prompts-capture-server: my-server
    prompts-diff-before: mcp/prompts-baseline.json
    tools-diff-fail-on: breaking
    prompts-diff-fail-on: breaking
```

`prompts-capture-url` and `prompts-capture-server` run `doctor prompts` and
save `mcp-prompts-current.json`, exposed as `prompts-capture-path`;
`prompts-capture-sandbox`, `prompts-capture-env`, `prompts-capture-token-env`,
and `prompts-capture-defer-findings` work like their tool counterparts. With
`prompts-diff-before` and `prompts-diff-after`, or a prompt capture as the after
input, the Action runs `doctor prompts-diff` and writes `mcp-prompts-diff.json`
and `mcp-prompts-diff.md` (outputs `prompts-diff-json-path` and
`prompts-diff-summary-path`), adds the Markdown summary to the step summary,
and feeds the comparison's exit code into the Action status.
`prompts-diff-comment: "true"` posts the summary as its own pull request comment
with the marker `<!-- codex-plugin-doctor:prompts-diff -->`, under the same
conditions and token rules as the tool diff comment. The tool and prompt inputs
are independent, so either can be used without the other, and a server without
prompts makes a prompt capture fail with status `2`. The prompt commands need
CLI `1.77.0` or later in `version`.

`init-ci --tools-diff-server <name> --prompts-baseline <path>` captures the
prompt list in the `capture` job, through [one snapshot](#one-snapshot-for-every-list)
for the same server and sandbox, and adds the prompt comparison and comment to
the `compare` job. The prompt baseline must be a
relative path inside the repository and differ from `--baseline`.

### Resource template lists

Resource templates follow the same pattern with `resource-templates-*` inputs:
`resource-templates-capture-url` or `resource-templates-capture-server` (with
`-sandbox`, `-env`, `-token-env`, and `-defer-findings`) run
`doctor resource-templates` and save `mcp-resource-templates-current.json`, and
`resource-templates-diff-before`, `-after`, `-fail-on`, and `-comment` run
`doctor resource-templates-diff`, write `mcp-resource-templates-diff.json` and
`mcp-resource-templates-diff.md`, and post a separate pull request comment with
the marker `<!-- codex-plugin-doctor:resource-templates-diff -->`. The outputs
are `resource-templates-capture-path`, `resource-templates-diff-json-path`, and
`resource-templates-diff-summary-path`. The comparison never reports URI
templates, which can carry host names and paths, but the saved
`mcp-resource-templates-current.json` holds them and is uploaded with the report
artifact unless `upload-artifact` is `"false"`. These inputs need CLI `1.79.0`
or later in `version`. `init-ci --resource-templates-baseline <path>` adds them
to the generated workflow like `--prompts-baseline`; each baseline must be a
different path.

### One snapshot for every list

`snapshot-server` or `snapshot-url` replaces the three per-list captures with one
[`doctor mcp-snapshot`](mcp-snapshot.md) run, which reads every list from a
stdio server in one session:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    check: "false"
    runtime: "true"
    snapshot-server: my-server
    snapshot-sandbox: docker
    tools-diff-before: mcp/tools-baseline.json
    prompts-diff-before: mcp/prompts-baseline.json
    resource-templates-diff-before: mcp/resource-templates-baseline.json
    tools-diff-fail-on: breaking
    prompts-diff-fail-on: breaking
    resource-templates-diff-fail-on: breaking
```

The snapshot removes earlier `mcp-tools-current.json`,
`mcp-prompts-current.json`, `mcp-resource-templates-current.json`, and
`mcp-snapshot-manifest.json` files from `output-dir`, then saves each complete
list under that name (and, with CLI 1.82.0 or later, the manifest), exposed as
`tools-capture-path`, `prompts-capture-path`, and
`resource-templates-capture-path`. Each saved list becomes the after input of
its comparison when that comparison's `-diff-before` is set and its
`-diff-after` is empty, and each comparison keeps its own fail-on input, report
files, and pull request comment. A comparison whose list was not saved, because
the server does not offer it or it was not read completely, is skipped with
status `2`. Every saved list is uploaded with the report artifact unless
`upload-artifact` is `"false"`, including lists no comparison uses, and
`mcp-resource-templates-current.json` holds URI templates that can carry host
names and paths.

`snapshot-sandbox`, `snapshot-env`, and `snapshot-token-env` work like their
`tools-capture-*` counterparts, with the same consent and validation:
`snapshot-server` needs `runtime: "true"`, `snapshot-url` needs
`allow-network: "true"` (and `allow-local-network: "true"` for loopback
endpoints), and invalid combinations are rejected with exit `2` before any
Doctor command runs. The snapshot inputs cannot be combined with any
`tools-capture-*`, `prompts-capture-*`, or `resource-templates-capture-*` server
or URL. A snapshot that saves no list records status `2`. Otherwise a snapshot
that does not read every offered list completely records status `2`, and its
catalog findings reach the status when a saved list feeds no comparison in the
same step; the [snapshot diff](#snapshot-comparison) re-checks every saved list.
With `snapshot-defer-findings: "true"`, neither fails the step: a
later comparison judges the saved lists, and one whose list was not saved fails
there. The snapshot inputs need CLI `1.81.0` or later in `version`.

With `--prompts-baseline` or `--resource-templates-baseline`, `init-ci` writes
the `capture` job with `snapshot-server` and `snapshot-defer-findings: "true"`
instead of one capture input per list; the `compare` job is unchanged. The
snapshot reads every list the server offers, so the uploaded artifact can hold a
list that no comparison uses, and a list that is not compared and cannot be
read completely does not fail the workflow.

### Snapshot comparison

`snapshot-diff-before-dir` compares a saved snapshot directory, usually a
committed baseline written by `doctor mcp-snapshot --save-dir`, with
[`doctor mcp-snapshot-diff`](mcp-snapshot.md#comparison): one report for every
list, which labels a list the server stopped offering as breaking.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    check: "false"
    runtime: "true"
    snapshot-server: my-server
    snapshot-sandbox: docker
    snapshot-diff-before-dir: mcp/baseline
    snapshot-diff-fail-on: breaking
```

When `snapshot-server` or `snapshot-url` is set and `snapshot-diff-after-dir`
is empty, this step's snapshot in `output-dir` is the after directory, and the
snapshot's catalog findings are left to the comparison, which compares each
saved list and checks a newly offered one on its own. With CLI 1.84.0 or later
the comment also has a server surface row for the protocol versions and
capabilities. When that snapshot saved
no manifest, for example because it lacked consent, the comparison is skipped
with status `2`. Set `snapshot-diff-after-dir` to compare another saved
directory instead, such as a snapshot downloaded from an earlier job; without a
snapshot in the step, both directories are required. `snapshot-diff-fail-on` is `any` or `breaking`, like
`tools-diff-fail-on`. The Action writes `mcp-snapshot-diff.json` and
`mcp-snapshot-diff.md` (outputs `snapshot-diff-json-path` and
`snapshot-diff-summary-path`), adds the summary to the step summary and the
action manifest, and feeds the comparison's exit code into the Action status.
`snapshot-diff-comment: "true"` posts the summary as one pull request comment
with the marker `<!-- codex-plugin-doctor:snapshot-diff -->`, under the same
conditions and token rules as the tool diff comment; it can replace the three
per-list comments, and like them it is skipped when this invocation may run
package code (`runtime: "true"`, `profile: publish`, or the `codex-publish` or
`mcp-strict` policy), so post it from a separate job. The per-list diff inputs still
work and can be combined with the snapshot diff. These inputs need CLI `1.82.0`
or later in `version`; an older CLI does not write a snapshot diff report, which
records status `2`.

`init-ci --tools-diff-server <name> --snapshot-baseline-dir <dir>` writes the
two-job workflow with this comparison: the `capture` job uploads the snapshot,
and the `compare` job runs one snapshot diff against the committed directory and
posts one comment. The directory must be a relative path inside the repository,
and it cannot be combined with `--baseline`, `--prompts-baseline`, or
`--resource-templates-baseline`. Create the baseline with
`codex-plugin-doctor doctor mcp-snapshot . --server <name> --runtime --save-dir <dir>`
and commit the whole directory, including `mcp-snapshot-manifest.json`.

The same workflow also runs on `workflow_dispatch` to update the baseline after
an intended change. Run it by hand from the Actions tab: the `capture` job takes
a new snapshot, the `compare` job is skipped, and an `update-baseline` job
compares the snapshot with the committed directory, makes it the baseline with
[`doctor mcp-snapshot-accept`](mcp-snapshot.md#accepting-a-change), and opens a
pull request from a new `mcp-baseline-update/<run id>-<attempt>` branch with the
comparison's [release notes](mcp-snapshot.md#release-notes) as its description.
They name each added, removed, or changed tool, prompt, and template and each
list the server started or stopped offering, as the pull request's diff of the
baseline files does anyway; they leave out definition findings, which
`doctor mcp-snapshot-diff` lists without `--changelog`. The pull request goes
into the branch the workflow ran on: run it from
the default branch to update the baseline there, or from a feature branch whose
pull request shows the intended change. Nothing is pushed to an existing branch,
and the job runs no package code; only it has `contents: write`, and the token
reaches git only in the step that pushes. GitHub creates the pull request only when the
repository allows GitHub Actions to create pull requests (Settings → Actions →
General → Workflow permissions), and a pull request opened with `github.token`
does not start other workflows, so push a commit to the branch or close and
reopen the pull request to run its checks.

## Recommended Workflow

```yaml
name: Validate Codex plugin

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  doctor:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: Esquetta/CodexPluginDoctor@v1.88.0
        with:
          version: "1.88.0"
          path: .
          runtime: "true"
          policy: codex-publish
          corpus: "true"
          contract: "true"
          upload-artifact: "true"
          artifact-name: codex-plugin-doctor-reports
          output-dir: codex-plugin-doctor-reports
```

By default the action writes:

- `codex-plugin-doctor-summary.md`
- `codex-plugin-doctor-report.json`

The Markdown report is appended to the GitHub Actions step summary, and the output directory is uploaded as a workflow artifact. The action preserves the real validation exit code after report generation, so failed checks still fail the job after artifacts are available.

Set `corpus: "true"` to add `validation-corpus.json` and `contract: "true"` to add `output-contract.json` to the same artifact directory. These reports are useful when a release workflow needs bundled validation evidence and the current public JSON contract without adding separate CLI steps.

Every action run also writes `codex-plugin-doctor-action-manifest.json`. The manifest records the installed CLI version, final action status, report directory, artifact name, target mode, and enabled report paths so follow-up workflow steps can discover generated files without hard-coded path assumptions.

## SARIF Output

Use SARIF when repository security tooling should ingest validation findings.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    sarif: "true"
```

The action writes `codex-plugin-doctor.sarif` into `output-dir`. Uploading it to GitHub Code Scanning should be handled by the consuming workflow after the action runs.

## Artifact And Summary Controls

Use artifact and summary controls when the workflow needs custom retention or wants to disable generated report uploads.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    output-dir: doctor-ci-reports
    artifact-name: codex-plugin-doctor-reports
    upload-artifact: "true"
    step-summary: "true"
    json: "true"
    markdown: "true"
    sarif: "true"
    corpus: "true"
    contract: "true"
```

Set `upload-artifact: "false"` when a consuming workflow wants to upload files itself. Set `step-summary: "false"` when the Markdown report should only be retained as an artifact.

The action also exposes these workflow outputs for follow-up steps:

- `status`
- `report-dir`
- `summary-path`
- `json-path`
- `sarif-path`
- `validation-corpus-path`
- `corpus-metrics-path`
- `corpus-metrics-diff-path`
- `output-contract-path`
- `action-manifest-path`
- `registry-report-path`
- `submission-json-path`
- `submission-summary-path`
- `submission-archive-json-path`
- `submission-archive-summary-path`
- `tools-capture-path`
- `tools-diff-json-path`
- `tools-diff-summary-path`
- `prompts-capture-path`
- `prompts-diff-json-path`
- `prompts-diff-summary-path`
- `resource-templates-capture-path`
- `resource-templates-diff-json-path`
- `resource-templates-diff-summary-path`
- `snapshot-diff-json-path`
- `snapshot-diff-summary-path`
- `review-bundle-path`
- `review-bundle-verification-path`

## Review Bundle Artifacts

Use review bundle artifacts when a pull request or release workflow should preserve signed runtime approval, runtime policy, attestation, and release evidence handoff files.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  env:
    CODEX_PLUGIN_DOCTOR_SIGNING_KEY: ${{ secrets.CODEX_PLUGIN_DOCTOR_SIGNING_KEY }}
  with:
    version: "1.88.0"
    path: .
    review-bundle: "true"
    review-bundle-verify: "true"
    signing-key-env: CODEX_PLUGIN_DOCTOR_SIGNING_KEY
    review-bundle-allow-untagged: "true"
```

The action writes the bundle under `output-dir/review-bundle` by default and includes it in the uploaded artifact directory. `review-bundle-verify: "true"` also writes `review-bundle-verification.json`.

`review-bundle-allow-untagged` defaults to `"true"` because pull request and branch workflows are usually not running on exact release tags. Set it to `"false"` in strict release jobs that should require tagged release evidence.

## Badge Artifacts

The CLI can produce badge output for release notes, README automation, or a static artifact served by the consuming repository.

```yaml
- name: Generate Doctor badge JSON
  run: codex-plugin-doctor check . --badge-json --output doctor-badge.json

- name: Generate Doctor badge Markdown
  run: codex-plugin-doctor check . --badge-markdown --output doctor-badge.md
```

`--badge-json` follows the Shields endpoint schema with `schemaVersion`, `label`, `message`, and `color`. `--badge-markdown` emits a static shields.io Markdown image link.

## Corpus Quality Gates

Use a private corpus metrics manifest to measure reviewed precision, recall, and false-positive share in CI. The action writes only the public-safe metrics report into its artifact directory; snapshots, manifest contents, local paths, and review notes are not copied.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    corpus-metrics-manifest: ../private-corpus/metrics.json
```

This writes `corpus-metrics.json`. To compare the result with a retained report and fail the job on regression:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    corpus-metrics-manifest: ../private-corpus/metrics.json
    corpus-metrics-baseline: .doctor-baselines/corpus-metrics.json
    corpus-metrics-fail-on-regression: "true"
```

The comparison writes `corpus-metrics-diff.json`. Reports must have the same `corpusDigest`; changed corpus composition is rejected as non-comparable rather than reported as a validator regression. `corpus-metrics-fail-on-regression` requires both a manifest and baseline.

## History Artifacts

Use history output when a workflow should preserve validation trend data between runs.

```yaml
- name: Append Doctor history
  run: codex-plugin-doctor check . --history validation-history.jsonl

- name: Summarize Doctor history
  run: codex-plugin-doctor history validation-history.jsonl

- name: Fail on Doctor regression
  run: codex-plugin-doctor history validation-history.jsonl --fail-on-regression
```

The history file is newline-delimited JSON. Store it as an artifact, cache, or repository-managed file depending on the consuming workflow's retention model. Use `codex-plugin-doctor history validation-history.jsonl --json` when another CI step needs machine-readable latest, previous, delta, and regression fields.

The composite action can also append history directly:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    runtime: "true"
    history: validation-history.jsonl
```

## Check Profiles

Use profiles when a consuming workflow needs a named validation policy instead of custom flags.

```yaml
- name: Publish-grade Doctor check
  run: codex-plugin-doctor check . --profile publish --json --output doctor-report.json
```

`ci` keeps the default behavior, `strict` fails on warnings, and `publish` fails on warnings while enabling runtime probing by default.

The composite action can pass profiles directly:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    profile: publish
```

## CI Policy Presets

Use policy presets when a workflow should apply one of the opinionated release gates without adding a local `.codex-doctor.json`.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    path: .
    policy: codex-publish
```

Supported policy values are `codex-publish`, `mcp-strict`, and `security`. The CLI validates unsupported values and fails the workflow with a clear error.

## Installed Plugin Cache Checks

Use installed-cache mode only in environments where Codex plugins are already available on the runner.

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
    installed: "true"
    filter: github
    runtime: "false"
```

## Version Pinning

Pin both the action ref and npm package version for reproducible CI:

```yaml
- uses: Esquetta/CodexPluginDoctor@v1.88.0
  with:
    version: "1.88.0"
```

Use `version: "latest"` only when the consuming repository intentionally wants automatic CLI upgrades.
