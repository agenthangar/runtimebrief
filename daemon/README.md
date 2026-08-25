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

MIT licensed. Third-party services and data formats remain subject to their own
terms and policies.
