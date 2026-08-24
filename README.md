# RuntimeBrief

RuntimeBrief turns local repository and coding-agent activity into short,
evidence-backed project updates. A self-hosted daemon on your Mac collects the
facts; the iOS app, Siri, ChatGPT, or Codex can show what changed, what is still
in progress, and what needs your attention.

> *"Hey Siri, what's the state of the sample tracker app?"*
>
> *"The shopping-list work landed this morning and all 12 tests pass. A Codex
> session is still working on export; nothing is waiting for you."*

RuntimeBrief is an early developer release. The daemon, iOS app, and plugin are
currently built from source.

## What you get

- A deterministic, zero-model-cost portfolio brief with evidence for every
  claim.
- Optional on-demand analysis of a single project's locally collected evidence.
- Read-only summaries of Git, Claude Code, Codex, and Cursor activity.
- Local Xcode metadata plus optional read-only App Store Connect status.
- Siri access through the iOS app and local MCP tools for ChatGPT and Codex.
- No RuntimeBrief account, hosted relay, analytics SDK, or action executor.

## How it works

```text
iPhone or MCP client                   Mac
┌────────────────────┐             ┌────────────────────────────┐
│ RuntimeBrief / Siri│ HTTP +     │ runtimebriefd              │
│ ChatGPT / Codex    │ bearer     │ REST + buffered SSE        │
│                     │ token       │ Git/session/iOS adapters   │
│                     │────────────▶│ local evidence filtering   │
└────────────────────┘             │ per-request app-server     │
                                    └────────────────────────────┘
```

RuntimeBrief owns evidence collection. On macOS, each analyst query launches
the separately installed, exact Codex CLI 0.144.1 as a new `codex app-server
--stdio --strict-config` process with private temporary workspace, user-home,
and Codex-home directories. It uses the ChatGPT OAuth login created by `codex
login`; RuntimeBrief has no direct OpenAI or Anthropic API integration and no
model API-key input or storage path.

Before sending any filtered evidence, RuntimeBrief requires that same child
process to attest its ChatGPT auth status, effective configuration and config
layers, absence of managed requirements, ephemeral thread boundary, selected
model and provider, permissions, reviewed feature states, absent hooks, and
empty MCP and dynamic-tool surfaces. RuntimeBrief supplies no tool environment,
so Codex's built-in `view_image` is not exposed. As defense in depth, the analyst
also denies Codex's platform-default read set, permits only its empty isolated
workspace, and rejects any tool-capable protocol item. Host-managed
Codex files, macOS managed preferences, and unexpected events fail closed.
Only then does RuntimeBrief write the evidence packet to the isolated thread.
It validates the complete structured answer and citations before returning
model text, and removes all per-request process state afterward.

Project observation is read-only. The optional decision inbox records an
approve/reject choice in a private local database; RuntimeBrief does not execute
the proposed action.

## Set it up

You need macOS and Node 22 or newer. Optional on-demand analyst answers require
exactly [Codex CLI](https://learn.chatgpt.com/docs/codex/cli) 0.144.1, installed
separately and signed in to ChatGPT with `codex login`. RuntimeBrief rejects
other CLI versions until their capability surface has been reviewed;
deterministic portfolio and MCP read tools work without Codex. An iPhone and a
private network such as Tailscale are optional.

### 1. Install the daemon

```sh
git clone https://github.com/agenthangar/runtimebrief.git
cd runtimebrief/daemon
npm ci
npm run build
npm link

npm install --global @openai/codex@0.144.1
codex --version  # must print: codex-cli 0.144.1
codex login
runtimebriefd init
runtimebriefd add-project-root ~/dev
# Or register one project explicitly:
runtimebriefd add-project ~/work/sample-tracker --name "Sample Tracker App"
runtimebriefd start
```

`codex login` opens the ChatGPT OAuth flow and saves authentication for Codex
CLI. When the login is stored in `~/.codex/auth.json`, RuntimeBrief validates
only the regular file's ownership, permissions, and link metadata, then creates
a per-request symlink inside the isolated Codex home. It never opens, parses,
copies, or logs credential contents. The child CLI loads its own login;
RuntimeBrief validates the required OAuth-mode fields returned by `account/read`
and `getAuthStatus`, then discards both responses. It does not retain or log
account metadata, email addresses, or tokens, and requests no auth token field.
The symlink and isolated homes are removed after the request. `init` prints the
separate daemon bearer token once; save it for the iOS app. Only that token's
scrypt hash is written to `~/.runtimebrief/config.yaml`.

For registered iOS projects, RuntimeBrief reads local Xcode or XcodeGen build
settings. If `~/.config/ios-release/config` exists, it can also use that
read-only App Store Connect credential to show release state. The config and
its `.p8` key must both be mode `0600`; set `IOS_RELEASE_CONFIG` to choose a
different path.

### 2. Connect an iPhone (optional)

The daemon binds to `127.0.0.1` by default. To reach it from an iPhone, install
[Tailscale](https://tailscale.com/) on both devices and bind to the Mac's
Tailscale address:

```yaml
server:
  host: 100.x.y.z
  port: 8484
```

RuntimeBrief rejects wildcard addresses and hostnames that resolve to them
unless `runtimebriefd start --i-know-what-im-doing` is used. Do not expose its
plain-HTTP server to the public internet.

See [ios/README.md](ios/README.md) to generate and build the iOS project. Enter
the server address and daemon token in Settings, then try:

- *"What's the state of **<project>** in RuntimeBrief?"*
- *"Ask RuntimeBrief about **<project>."***
- *"What are my projects up to in RuntimeBrief?"*

### 3. Keep the daemon running (optional)

```sh
runtimebriefd install-service
```

The launchd job is `com.runtimebrief.daemon`; logs stay under
`~/.runtimebrief/logs/`.

### 4. Connect ChatGPT or Codex

The repository includes a local RuntimeBrief plugin and MCP server. Build and
link the daemon first, then install the repository marketplace:

```sh
codex plugin marketplace add /path/to/runtimebrief
codex plugin add runtimebrief@runtimebrief
codex mcp list
```

Start a new ChatGPT desktop or Codex thread after installation. Example asks:

- *"What needs my attention across every agent?"*
- *"Show the evidence for the Sample Tracker App blocker."*
- *"Which RuntimeBrief decisions are waiting for me?"*

The MCP tools are `list_attention`, `get_project_evidence`,
`list_pending_decisions`, and `resolve_decision`. Resolution records the user's
choice but never executes it. Another authenticated local client must
explicitly propose an allowlisted action through REST; no proposal generator or
executor ships in this repository.

## API

All endpoints require `Authorization: Bearer <token>` and are rate-limited to
30 requests per minute.

| Endpoint | Description |
| --- | --- |
| `GET /v1/health` | Daemon version and uptime |
| `GET /v1/projects` | Deterministic portfolio entries and evidence |
| `GET /v1/projects/:id` | Git, agent lifecycle, brief, and iOS release details |
| `GET /v1/projects/:id/status` | On-demand analyst status answer |
| `POST /v1/projects/:id/ask` | Analyst answer for `{ question }` |
| `POST /v1/projects/:id/actions` | Propose an allowlisted decision; never executes it |
| `GET /v1/actions` | Unexpired pending decisions |
| `POST /v1/actions/:id/decision` | Idempotently record approve/reject |

`/status` and `/ask` can return buffered Server-Sent Events (`chunk`, `done`,
`error`) or JSON `{ answer, costUsd, cached, truncated, evidence }`. The
per-request Codex app-server turn is buffered and validated before any answer
is returned to clients; a subscription-backed run reports `costUsd: 0` because
Codex CLI does not expose a per-request dollar charge. `truncated` remains in
the response shape for compatibility and is false for a completed Codex CLI
answer. Unsupported model assertions are
replaced with `Unknown from available evidence` when they do not cite at least
one known evidence ID. This deterministic check validates citation IDs, not
whether a model sentence semantically interprets the cited record correctly.

## Configuration

`~/.runtimebrief/config.yaml` is created with mode `0600`:

```yaml
server:
  host: 127.0.0.1
  port: 8484
auth:
  token_hash: scrypt:…
project_roots:
  - /Users/developer/dev
projects:
  - id: sample-tracker
    name: "Sample Tracker App"
    path: /Users/developer/projects/sample-tracker
    allowed_actions: ["run-tests"]
    # transcript_sources:       # optional and exhaustive when present
    #   - type: codex
    #     root: /custom/codex/home
analyst:
  model: gpt-5.6-sol
  cache_ttl_minutes: 10
  max_transcripts: 5
```

Trusted roots are shallow. RuntimeBrief discovers only non-hidden direct child
directories containing a `.git` directory or file. Explicit `projects` entries
take precedence. A newly created repository under a trusted root appears on the
next refresh.

## Security and privacy

- The daemon defaults to loopback and authenticates every API route with a
  random bearer token stored only as a scrypt hash.
- The analyst is Codex CLI-only: one pinned 0.144.1 `codex app-server --stdio
  --strict-config` process per request on macOS. RuntimeBrief sends filtered
  evidence only after same-process auth, config, requirements, thread,
  feature, hook, MCP, dynamic-tool, provider, and permission attestation
  succeeds. Any tool-capable protocol item, managed host configuration,
  unreviewed version, or mismatch fails closed.
- Codex owns the ChatGPT OAuth login. RuntimeBrief never calls the OpenAI or
  Anthropic API directly, accepts no model API key, parses and discards only
  required app-server OAuth status, and does not retain or log account metadata,
  email addresses, or tokens.
  The isolated workspace, homes, auth link, and other process state are removed
  after every request.
- Credential-like paths are excluded while evidence is assembled. This is a
  path filter, not a promise that arbitrary user-authored text contains no
  secrets.
- Git uses argument arrays and a strict subcommand/option allowlist; it never
  invokes a shell.
- App Store Connect access is read-only and its private key is never returned,
  logged, or included in analyst context.
- RuntimeBrief operates no analytics pipeline, account service, or cloud relay.
  Codex processing follows the permissions and data-handling policies of the
  ChatGPT workspace selected at login. Apple, Tailscale, and any MCP client may
  process operational or request data under their own terms.

Read [SECURITY.md](SECURITY.md) for the threat model and [PRIVACY.md](PRIVACY.md)
for exact outbound fields, provider retention, and local deletion behavior.

## Development

```sh
cd daemon
npm test
npm run build
scripts/smoke-analyst.sh   # optional; needs ChatGPT login and a running daemon
```

Automated analyst tests use a fake Codex process and never make a hosted model
request. Adapter behavior and empirically observed local transcript
formats are documented in [docs/adapters.md](docs/adapters.md). Maintainers
publishing from a private development repository should follow the
[one-root-commit checklist](docs/publishing.md).

## Why the name?

RuntimeBrief is an invented compound: it turns activity across coding-agent
runtimes into a concise brief.

## License

RuntimeBrief source in this repository is MIT-licensed. OpenAI, Apple, Claude,
Codex, Cursor, Tailscale, and other third-party products, services, local data
formats, and trademarks remain subject to their own licenses, terms, and
policies. RuntimeBrief is not endorsed by those vendors.
