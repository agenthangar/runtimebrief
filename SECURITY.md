# Security

## Supported versions

Security fixes are applied to the latest release on the default branch.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Use GitHub's private
vulnerability reporting feature for this repository. Include the affected
component, reproduction steps, impact, and any suggested mitigation.

## Security model

RuntimeBrief is designed for a user-controlled Mac and private network:

- The daemon binds to loopback by default and requires a bearer token for every
  API endpoint. Alternate wildcard spellings and hostnames that resolve to a
  wildcard address are refused unless the explicit override is supplied; a
  hostname is resolved once and the validated numeric address is bound.
- The plaintext token is shown once, stored in the iOS Keychain, and retained
  by the daemon only as a scrypt hash.
- The macOS-only analyst backend invokes exactly Codex CLI 0.144.1 as a fresh
  `codex app-server --stdio --strict-config` process for every request. It uses
  separate temporary workspace, user-home, and Codex-home directories, ignores
  repository rules and user configuration, disables persistence, analytics,
  feedback, telemetry exporters, unapproved features, hooks, MCP, dynamic
  tools, and network-capable permissions, and cannot access registered project
  files. RuntimeBrief supplies no tool environment, so Codex's built-in
  `view_image` is not exposed. Its platform-default read set is also denied,
  only the empty isolated workspace is readable, and any tool-capable item
  terminates the request.
  RuntimeBrief rejects other CLI versions until their capability surface has
  been reviewed.
- Before sending filtered evidence, RuntimeBrief requires the same app-server
  process to attest ChatGPT auth status; effective config, origins, and layers;
  no managed requirements; the exact provider and model; and the ephemeral
  thread, workspace, permission, feature, hook, MCP, and dynamic-tool
  boundaries. Host Codex config files or macOS managed preferences fail closed.
  Any unexpected response, notification, tool-capable item, output, or
  diagnostic also terminates the request.
- Codex CLI owns the ChatGPT OAuth login created by `codex login`. When Codex
  uses `auth.json`, RuntimeBrief validates only the regular file's ownership,
  permissions, and link metadata and creates a per-request symlink inside the
  isolated Codex home. It never opens, parses, copies, or logs credential
  contents; the child CLI loads its own saved login. RuntimeBrief validates and
  discards the required OAuth-mode fields from `account/read` and
  `getAuthStatus`. It does not retain or log account metadata, email addresses,
  or tokens and requests no auth token field. The isolated workspace, homes,
  auth link, and other process state are removed after every request.
- RuntimeBrief never calls the OpenAI or Anthropic API directly, has no model
  API-key input or storage path, and validates complete structured output
  before returning model text.
- The MCP server runs locally over stdio. Its read tools reuse deterministic
  project observations and do not invoke the analyst model. The MCP client may
  still send selected tool results to its configured model provider; review the
  provider's data controls before exposing a trusted project root.
- A local stdio MCP server is trusted user-level code, not a process confined by
  Codex's model-command sandbox. RuntimeBrief confines its own observations to
  configured projects and supported transcript stores, but installing the
  plugin still requires trusting the package and plugin source.
- Action proposals are denied unless their kind is allowlisted for the project.
  Resolving a decision is idempotent, expires with the proposal, and only
  updates RuntimeBrief's local decision database. No action executor exists.
- Repository paths that commonly contain credentials are filtered before
  context is constructed. Filtering reduces risk but is not a substitute for
  reviewing which repositories and transcripts are made available.
- Plain HTTP must be used only over loopback or a trusted local network. For
  iOS access over Tailscale, keep the daemon on loopback and use Tailscale
  Serve for tailnet-only HTTPS. Never use Funnel or expose the daemon directly
  to the public internet or an untrusted network.

The Codex CLI sends selected repository and agent-session context to its remote
service when analysis is requested. Processing follows the permissions and
data-handling policies of the ChatGPT workspace selected at `codex login`.
Review [PRIVACY.md](PRIVACY.md) before enabling a project or connecting an MCP
client.
