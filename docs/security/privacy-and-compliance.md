# Privacy and Compliance

## Privacy Position

Codex Plugin Doctor should default to local execution with no mandatory data upload. Privacy is a product differentiator because the tool inspects package contents that may include proprietary logic, internal paths, and sensitive environment references.

## Data Handling Principles

- process locally by default
- collect only what is necessary
- avoid storing package contents unless explicitly requested
- redact sensitive output whenever reports are persisted or shared

## Local CLI Data Model

The local CLI may temporarily process:

- plugin manifests
- `SKILL.md` and related support files
- MCP config entries
- bounded runtime stdout and stderr

The local CLI should not:

- send package contents to a remote service by default
- persist raw secrets
- retain unbounded runtime logs

## Hosted Service Policy for Future Phases

If a hosted reporting product is introduced later, it should support:

- explicit report upload consent
- encrypted at-rest storage
- scoped workspace access
- report retention controls
- report deletion on request

## Compliance Roadmap

### Near-Term

- publish transparent data handling documentation
- define retention defaults
- redact sensitive fields in all shared reports

### Mid-Term

- role-based access for hosted reports
- audit logs for report access
- customer-visible retention settings

### Long-Term

- SOC 2 readiness program if enterprise demand proves strong
- vendor review packet for security-conscious customers

## Customer Assurance Statements

- validation can run fully locally
- package contents are not uploaded by default
- hosted features, if enabled later, will be opt-in and explicitly documented

