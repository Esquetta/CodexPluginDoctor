# Personas and Jobs To Be Done

## Primary Personas

### 1. Plugin Author

An individual or small team packaging a Codex plugin with skills and MCP servers.

#### Goals

- confirm the package is valid before release
- avoid embarrassing install failures
- reduce issue churn after launch

#### Pain Points

- uncertain packaging rules
- hidden runtime failure modes
- hard-to-reproduce customer issues

### 2. MCP Vendor Engineer

A developer at a SaaS or developer tools company exposing product capabilities through MCP.

#### Goals

- shorten integration support cycles
- increase install success rate
- provide a trustworthy onboarding path

#### Pain Points

- auth-related failures
- client-specific edge cases
- support tickets caused by broken setup docs or manifests

### 3. Platform Engineer

A team-level owner responsible for standardizing internal AI tooling.

#### Goals

- gate broken packages before rollout
- create repeatable quality checks
- generate audit-friendly release evidence

#### Pain Points

- inconsistent team practices
- no quality gate for plugin releases
- poor visibility into integration safety

## Jobs To Be Done

### Functional Jobs

- When I package a Codex plugin, help me validate it before release so users do not discover the problems first.
- When I change an MCP server, help me detect runtime and schema regressions before merging.
- When a package fails in CI, tell me exactly what is broken and how to fix it.

### Emotional Jobs

- Reduce uncertainty before publishing.
- Avoid public trust damage.
- Feel confident that the package is professionally maintained.

### Social Jobs

- Demonstrate release quality to customers, teammates, and reviewers.
- present a clear quality signal in documentation and pull requests

## Purchase Triggers

- a recent install failure caused a lost demo or support escalation
- the team is starting to share plugins internally
- a vendor is preparing public docs for MCP support
- leadership wants a simple quality gate before distribution

## Buying Objections

- "We can write a few scripts ourselves."
- "Codex may eventually provide this natively."
- "Our package count is still small."

## Objection Handling

- home-grown scripts rarely cover runtime truth, report quality, and CI packaging together
- platform-native features will likely optimize install UX before they optimize external validation
- early standardization is cheaper than retrofitting release quality after adoption grows

