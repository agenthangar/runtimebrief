# runtimebriefd

`runtimebriefd` is the local macOS daemon for [RuntimeBrief](../README.md). It provides the
authenticated REST, buffered SSE, and MCP interfaces used by the RuntimeBrief
iOS app and Codex plugin.

The daemon reads explicitly configured local project evidence. Optional
on-demand analysis is macOS-only and starts the separately installed, exact
Codex CLI 0.144.1 as a new `codex app-server --stdio --strict-config` process
for each request. It uses the ChatGPT OAuth login created by `codex login`;
RuntimeBrief never calls the OpenAI or Anthropic API directly and has no model
API-key input or storage path.

Before it sends filtered evidence, RuntimeBrief requires that same process to
attest auth status, effective config and layers, absence of managed
requirements, the ephemeral thread boundary, provider and model, permissions,
reviewed feature states, absent hooks, and empty MCP and dynamic-tool surfaces.
No tool environment is supplied, so Codex's built-in `view_image` is not
exposed. The permission profile also denies platform-default paths and confines
reads to the empty isolated workspace;
any tool-capable item, managed host configuration, or unexpected value fails
closed. The isolated process
cannot access registered project files, and all of its temporary workspace,
home, auth-link, and process state is removed after the request. See the
repository's setup guide, security model, and privacy policy before trusting a
project root.

```sh
npm install
npm run build
npm link
npm install --global @openai/codex@0.144.1
codex --version  # must print: codex-cli 0.144.1
codex login
runtimebriefd init
runtimebriefd install-service
```

`install-service` is the normal macOS setup: it starts RuntimeBrief as a
non-blocking per-user launchd service and keeps it running after the terminal
closes. For foreground development, unload that job first, run
`runtimebriefd start`, and press **Ctrl-C** when finished. Re-run
`runtimebriefd install-service` to restore the background service.

When Codex stores its login in `auth.json`, RuntimeBrief validates only the
regular file's ownership, permissions, and link metadata and creates a
per-request symlink inside the isolated Codex home. It never opens, parses,
copies, or logs credential contents. The Codex CLI loads the login itself.
RuntimeBrief checks and discards `account/read` and token-free `getAuthStatus`
responses and does not retain or log account metadata, email addresses, or
tokens. Requests follow the policies of the
ChatGPT workspace selected during sign-in.

## Native Claude tasks

Claude tasks use a separate execution path from the isolated analyst. Install
Claude Code and Claude Desktop on the Mac, sign in to both, and complete any
workspace-trust setup there. Native background sessions are required; the
integration was verified with Claude Code 2.1.263.

Registered projects, including new repositories discovered under trusted
roots, allow launches by default. Every authenticated client paired with the
daemon token shares this scope. No `enable-claude` step is needed for a new
project. To disable or restore a specific project:

```sh
runtimebriefd disable-claude <project-id>
# To restore it later:
runtimebriefd enable-claude <project-id>
# Apply either change to the running service:
runtimebriefd install-service
```

Run the disable and restore commands as alternatives, not both at once.
These commands write the optional `claude_launch_enabled` project setting.
Only `false` disables launches and Desktop handoff; observation and existing
Claude sessions remain available. The decision inbox's `allowed_actions`
setting does not control Claude launches.

The authenticated launch API accepts a task, stable request UUID, optional
model alias, and optional permission mode. Defaults are the Mac's configured
Claude model and Manual permissions. The iOS composer offers Fable, Opus,
Sonnet, Haiku, Auto, Bypass, and the other supported choices. Claude controls
model availability, tools, account policy, and workspace trust.

Delivery receipts record launch settings and native identity without storing
the prompt. Desktop takeover transfers the saved conversation; Desktop can
apply its own permission mode afterward. See the
[request contract and handoff limits](../docs/session-control.md#claude-launch-api).

## Brief freshness

Briefs sort sessions by their recorded activity time and select the newest
evidence for the headline. Current changes and completed work appear before
stopped-session context. Stopped and stale-active notices expire after
24 hours; earlier sessions and their evidence remain accessible in history.
Unresolved requests for user input are not expired by that rule and continue
to appear as attention items.

MIT licensed. Third-party services and data formats remain subject to their own
terms and policies.
