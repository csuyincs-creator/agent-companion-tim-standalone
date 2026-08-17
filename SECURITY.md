# Security Policy

## Reporting

Do not open a public issue containing API keys, local paths, model transcripts, or exploit details. Contact the repository maintainer privately and include only the minimum reproduction data needed.

## Supported Scope

Security fixes target the current default branch. The most sensitive boundaries are:

- same-origin checks on state-changing AI endpoints;
- request and event allowlists;
- API key redaction and Windows DPAPI persistence;
- Codex workspace selection and sandbox policy handling;
- static-file allowlists and path-traversal rejection.

Before reporting a suspected secret leak, remove credentials from screenshots, logs, request payloads, and test fixtures.

Do not expose the local gateway directly to an untrusted network. The current gateway only performs basic string validation for Codex working directories. Binding it beyond loopback requires authentication, an explicit workspace allowlist, and trusted-origin handling.
