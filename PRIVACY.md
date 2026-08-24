# Privacy policy

RuntimeBrief is a self-hosted iOS client and macOS daemon. The project does not
operate an account service, hosted relay, advertising system, or analytics
pipeline. This document describes what the software itself processes; the
third-party products and services a user connects have their own policies.

## Data processed locally

For projects explicitly registered by the user, or non-hidden direct child Git
repositories beneath a trusted root, the daemon may process:

- repository paths and Git metadata, including branch, working-tree state,
  commits, authors, messages, timestamps, diff statistics, tracked TODO/FIXME
  counts, and recently modified filenames;
- supported Claude Code, Codex, and Cursor session stores, including session
  identifiers, timestamps, titles, prompts, final assistant reports, model and
  lifecycle metadata, tool-use counts, and paths recorded by those sessions;
- local Xcode project version, build, and bundle metadata; and
- action proposals, their structured parameters, and recorded decisions.

RuntimeBrief reads these sources without modifying them. Local transcript
formats are empirically observed and may change.

The iOS app stores the daemon address and a recent project-summary snapshot in
app preferences. That snapshot can include project identifiers and names,
branches, briefs, attention state, and evidence labels. It stores the daemon
bearer token in the iOS Keychain. Siri and App Shortcuts may receive project
names needed to resolve RuntimeBrief requests under Apple's platform behavior.

## Codex analyst requests

No model request occurs when loading the deterministic portfolio or project
card. When the user explicitly requests analysis on macOS, RuntimeBrief starts
one separately installed, exact Codex CLI 0.144.1 `codex app-server --stdio
--strict-config` process for that request. It uses the ChatGPT OAuth login
created by `codex login`. RuntimeBrief has no direct OpenAI or Anthropic API
integration and no model API-key input or storage path.

RuntimeBrief does not write evidence to the child until that same app-server
process has attested the expected ChatGPT auth status, effective configuration
and config layers, absence of managed requirements, ephemeral thread and
workspace boundary, exact model and provider, read-only/no-network permissions,
reviewed feature states, absent hooks, and empty MCP and dynamic-tool surfaces.
Host-managed Codex files or macOS managed preferences fail closed, as does any
unexpected value or protocol event. RuntimeBrief then sends one filtered
evidence packet over stdin. Depending on available evidence, it can contain the
user's question and project name; Git branch, status, commits, authors,
messages, timestamps, filenames, diff and TODO counts; session identifiers,
sources, states, titles, prompts, final reports, file paths, tool counts, and
timestamps; and iOS bundle, version, build, TestFlight, or App Store status.

The isolated process ignores user configuration and repository rules, disables
unapproved features plus MCP and dynamic tools, turns off local history
persistence, analytics, feedback, and telemetry exporters, and has no access to
registered project files. RuntimeBrief supplies no tool environment, so Codex's
built-in `view_image` is not exposed; the platform-default read set is also
denied, only the empty isolated workspace is readable, and no tool network plus
a strict event parser reject any tool-capable protocol item.
RuntimeBrief requires a complete structured response before returning model
text. The evidence packet is processed by Codex's remote
service even though RuntimeBrief runs locally. All per-request temporary
process state is removed after completion, failure, or cancellation.

Credential-like paths are excluded while evidence is assembled. This is a
path-based filter, not content redaction: prompts, commit messages, filenames,
model reports, and other user-authored text may still contain sensitive data.
Do not enable a project whose selected evidence is not permitted to be sent to
the ChatGPT workspace selected during Codex login.

Codex processing follows that workspace's permissions, role-based access
controls, retention, residency, and other ChatGPT data-handling policies.
RuntimeBrief cannot override those settings. Plan and workspace policies can
vary; review the official OpenAI
[authentication guidance](https://learn.chatgpt.com/docs/auth) and your selected
workspace's current controls before requesting analysis.

## Other external services and clients

If a read-only App Store Connect credential is configured, RuntimeBrief sends
the iOS bundle identifier and signed API requests directly to Apple's App Store
Connect API to retrieve release metadata. Private-key contents are not included
in RuntimeBrief responses or analyst evidence.

When RuntimeBrief is used through an MCP client such as ChatGPT or Codex, that
client may send returned project, Git, agent-session, evidence, and decision
data to its configured model provider. RuntimeBrief does not send MCP results
to an additional RuntimeBrief-operated service. Review the client's and
provider's data controls before connecting a trusted project root. The local
stdio MCP process runs with the user's operating-system permissions; the
client's model-command sandbox is not a filesystem boundary around that trusted
plugin process.

## Local storage and retention

RuntimeBrief data remains until it is manually removed:

- `~/.runtimebrief/config.yaml` contains project configuration and the scrypt
  hash of the daemon bearer token.
- `~/.runtimebrief/cache.db` and SQLite sidecar files contain analyst answers,
  evidence, and response metadata. The configured TTL controls reuse; it does
  not delete old rows.
- `~/.runtimebrief/decisions.db` and sidecars contain proposal descriptions,
  parameters, status, and resolution data. Expiry changes whether a proposal is
  actionable; it does not delete the row.
- `~/.runtimebrief/logs/` contains launchd stdout and stderr.
- Codex CLI owns its saved ChatGPT OAuth login outside the RuntimeBrief data
  directory. When `auth.json` storage is used, RuntimeBrief validates only the
  regular file's ownership, permissions, and link metadata and creates a
  temporary symlink in the isolated Codex home. RuntimeBrief never opens,
  parses, copies, or logs credential contents. The child CLI loads its own
  authentication. RuntimeBrief validates the required OAuth-mode fields from
  `account/read` and `getAuthStatus`, then discards both responses. It does not
  retain or log account metadata, email addresses, or tokens and requests no
  auth token field. The link and isolated homes are removed after every request.

Removing a project from configuration does not purge cached answers or decision
rows. Uninstalling the npm package or daemon does not delete
`~/.runtimebrief`.

To remove local daemon data, stop and unload the service, then delete the
specific RuntimeBrief data and LaunchAgent files. Deletion is
permanent unless the user has a backup. Uninstalling or deleting RuntimeBrief
does not sign out Codex or remove its saved ChatGPT login; manage that login
separately with the Codex CLI.

Removing the iOS app normally removes its app-container preferences, but
Keychain items can survive uninstall. Clear the saved daemon token in the app
before uninstalling when possible, or remove the item through the operating
system or a new installation using the same Keychain access group.

## User choices

Users choose which projects or parent directories the daemon may inspect and
may stop it at any time. Trusting a project root opts in every current and
future non-hidden direct child Git repository under that root. Users also
choose whether to install and sign in to Codex CLI, configure App Store Connect
access, use an iOS client or Tailscale, or connect an MCP client.

## Changes

Material changes to data handling will be documented here before release. Use
the repository's private vulnerability reporting feature for privacy or
security concerns.
