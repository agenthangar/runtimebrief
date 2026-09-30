# Native session launch and takeover

Status: current-t compatibility backend and Remote Control UI implemented.
Older background launches retain their verified native Desktop handoff.
Claude, Codex, and Cursor support phone launch and continuation. Claude uses
native Remote Control; Codex and Cursor use their live native terminals.
Controlling pre-existing Desktop-owned conversations remains separate research.

## Default Claude flow through current t

All integration changes live in RuntimeBrief. `runtimebriefd install-t` downloads
the unchanged `agenthangar/t` commit `1643729085f647edc715353919e6b05baa61fce5`
into RuntimeBrief's private tools directory and verifies its archive checksum.
`install-service` installs that dependency automatically. Existing dotfiles and
the user's `t` executable are unchanged. The default config is
`claude_session_backend: t`; `native` retains the legacy background launcher.

On the phone, select **New task**, choose an agent, model, and permission mode,
and start the task. **Remote Control** is on by default, with a local-only toggle.
The daemon reserves a private SQLite receipt before bounded dispatch through
the pinned public `t open` command. `t` creates its worktree and tmux session.
A small RuntimeBrief bridge substitutes a clean shell and supplies the initial
task as one native Claude argv argument. It suppresses terminal attachment;
it never pastes a task into a terminal or answers trust/permission dialogs.
No personal `.zshrc` is sourced.

The current `t` requires a Git repository with `origin/main` and starts its new
worktree there, fetching origin as part of its existing behavior. Shared-checkout
launches are not offered by this adapter. A unique numeric slot derived from the
receipt UUID avoids branch/session collisions. Worktrees live under
RuntimeBrief's private directory, outside the human worktree sweep. The actual
workspace is recorded; local uncommitted edits are not copied into it.
The evidence adapter associates external worktree transcripts with their
owning Git repository, so these sessions appear in the project's brief too.

Project identity is separate from the working directory. Automatic discovery
collapses linked worktrees under their owning repository, preserving explicit
project names and IDs. A numeric t slot is a workspace, not a new RuntimeBrief
project. All three providers' evidence follows this rule.

The receipt independently records `backend`, `launchState`, `activity`, and
`remoteControl`. A tmux identity is not task acknowledgment: Claude's exact
native transcript must contain the submitted task. A Remote Control link is
shown only when that conversation reports an active native connection and its
terminal still has the same native identity. Disconnections and missing owners
remove the link. The preference is echoed as `requestedRemoteControl`.
The native URL is never constructed from a guessed session identifier.

Use **Open Remote Control** to continue in Claude's web/mobile surface, or copy
the exact `tmux attach -t ...` command to a terminal on your Mac. Your installed
`t ls -a` can also list these sessions; older `t` versions may not attach by a
conversation UUID or resolve their title. Claude sign-in, workspace trust,
Remote Control eligibility, and trusted-device verification remain native setup
steps. Remote Control failure does not send the task again.

Requests that fail read-only setup checks are not reserved. Once reserved, lost
responses, duplicate submissions, and daemon restarts never dispatch again.
The private temporary task file is removed when the native runner consumes it;
receipts retain a hash for acknowledgment, not task text. Native Claude history
and t's private terminal log remain their normal local records.

`ClaudeSessionBackend` is the replacement seam. A future implementation of
[the t API proposal](session-manager/README.md) can replace the new-session
backend while retaining the legacy backend for its existing receipts. Upgrades
never adopt, migrate, or relaunch a conversation implicitly. This compatibility
backend does not implement or claim conformance to the proposed `t api` wire
schema; RuntimeBrief owns the durable receipts during this interim phase.

Implementation verification used a fictional Git fixture, the pinned unchanged
`t`, and real Claude Code on a Mac. Concurrent authenticated API requests created
one receipt; the task wrote the exact expected file, acknowledged the initial
prompt, and reported a native Remote Control connection. Reopening the receipt
store returned the same task without dispatching again. A separate explicit
local-only task completed without registering a remote bridge. Automated tests
cover hostile prompt argv, changed owners, exit/disconnection, backend upgrades,
and retries. Simulator tests and a fresh Revyl cloud build verify the demo
composer, default-on toggle, receipt, and demo continuation button. Browser
continuation requires Claude's trusted-device verification; a physical-phone
launch and browser follow-up were not established by these checks.

## Codex and Cursor through current t

All source changes stay in RuntimeBrief. The pinned `t` source and dotfiles remain
unchanged. Codex uses t's existing agent seam. Cursor uses a process-local shim
in the private launch shell to extend its closed provider set; it still uses t's
worktree and tmux lifecycle. The ordinary human `t open --cursor` and legacy
`t cursor ls/resume` commands are not changed. Attach to the receipt's tmux target
to continue the same live CLI from your Mac.

The phone offers Claude Code, Codex, and Cursor. Remote Control is **on by
default** for each, with an explicit local-only opt-out. Claude keeps its native
Remote Control link. For Codex and Cursor, **Open terminal** uses the existing
authenticated, project-scoped RuntimeBrief connection. It shows native output,
sends a follow-up, and exposes Enter, arrow keys, Tab, Escape, and Ctrl-C for
native trust, sign-in, approval prompts, and interruption. No provider cloud
worker or public app-server transport is enabled. This does not claim automatic
visibility in ChatGPT's or Cursor's mobile interfaces.

The native CLIs own models, execution, history, and approvals. Codex Manual uses
its workspace-write sandbox with on-request approval; Plan uses its read-only
sandbox. Model menus load each native account's catalog from the Mac (Codex
`model/list`, Cursor `--list-models`). Default inherits the Mac configuration
without overriding it. Catalogs refresh every five minutes; discovery failures
retain Default and explain how to recover.

| Permission | Codex | Cursor |
|---|---|---|
| Manual (default) | `--sandbox workspace-write --ask-for-approval on-request` | Native approval prompts |
| Auto | `--approve-for-me` | `--auto-review` |
| Plan | `--sandbox read-only --ask-for-approval on-request` | `--mode plan` |
| Ask | Unavailable | `--mode ask` |
| Bypass (explicit selection) | `--dangerously-bypass-approvals-and-sandbox` | `--force --sandbox disabled`; explicit denials still apply |
| Pre-approved Only | `--sandbox workspace-write --ask-for-approval never` | Unavailable |

RuntimeBrief never adds workspace trust or MCP approval flags. Unsupported
settings fail before a launch is reserved. Older daemons still show their
supported permissions and Default; update the Mac daemon for the model catalog
and additional permission choices.

A private PTY runner keeps the native CLI alive after daemon or phone disconnects.
Remote keys enter that PTY directly and can never reach t's launcher shell.
Cursor creates an empty chat using its native `create-chat`, then starts that ID
once. Codex's native read-only history index binds the exact unique worktree to
its conversation, including the bundled CLI's `vscode` source. Initial-task
acknowledgment still requires its native transcript to contain the prompt hash.
A changed pane, competing conversation, missing ownership evidence, exited CLI,
project opt-out, or local-only receipt disables remote input. No resume/replay
is used to recover a stopped CLI.

Every terminal input has its own UUID. The daemon durably reserves a hash before
sending keys. A lost acknowledgment stays uncertain; retrying the same UUID
checks status without sending the keys again. Terminal content and input text
are not stored in the receipt database or response cache. Native history and
private tmux logs remain local. Polling occurs only while the phone is active,
and failed refreshes disable writes to a stale screen.

RuntimeBrief prefers the Codex CLI bundled with the desktop app when available,
then Homebrew/local installations. `RUNTIMEBRIEF_CODEX_BINARY` and
`RUNTIMEBRIEF_CURSOR_BINARY` select explicit executables. This avoids treating an
older standalone CLI as equivalent to a newer bundled CLI with different model
support. Install and sign in to each native CLI on your Mac; trust and account
setup prompts remain visible in the native terminal.

For Codex versions supporting native project metadata, RuntimeBrief finds the
project whose root is the original repository, or creates it idempotently,
then assigns the launched conversation through `thread/metadata/update`.
The thread keeps its actual worktree cwd. This uses a short-lived local
`app-server --stdio` helper; it neither starts another conversation nor changes
the desktop app's transport or Remote Control settings. An unavailable or
ambiguous native project API leaves grouping unconfirmed in the receipt.
Claude and Cursor still control how their own native interfaces group external
worktrees; RuntimeBrief does not rewrite their project databases.

Native integration checks use fictional Git fixtures. Both providers completed
an initial task and recalled its reply in the same live conversation through
the authenticated bridge. These local checks are distinct from the simulator
and Revyl UI checks and do not establish physical-iPhone networking.

## Legacy background flow

Registered projects, including automatic discoveries, allow Claude launches by
default. `claude_launch_enabled: false` is an explicit per-project opt-out. The
authenticated iOS client submits a task, model, permission mode, and stable
request UUID. The daemon reserves a private SQLite receipt before launching
`claude --bg --permission-mode <mode> [--model <alias>] --name <receipt-name>
-- <prompt>`. The model defaults to Claude's configured model and permissions
default to Manual; Bypass must be selected explicitly. The daemon records the
native short ID from Claude's acknowledgment and the conversation UUID from
`claude agents --json --all`.
Claude ignores a supplied `--session-id` in background mode, so RuntimeBrief
never invents that identity. Prompts are not retained in the receipt database.

Claude owns execution and may create its own worktree. RuntimeBrief follows the
native working directory and shows running, needs-attention, completed, stopped,
failed, or uncertain status. A lost HTTP response, daemon restart, or repeated
request ID does not replay the prompt. Model and permission choices participate
in request identity; changing them cannot silently reuse an existing task.
Default settings preserve retry compatibility with build 15. Uncertain dispatch
is reconciled by the unique native task name before any manual retry with a
new request ID.

**Open in Claude Desktop** stops the exact background owner and uses normal
`claude --resume <conversation-uuid> --permission-mode <launch-mode> /desktop` in a
terminal. This honors native writer locks and avoids background resume's
possible fork behavior. Claude's own Desktop catalog is read only to verify the
same conversation ID. Once handed off, RuntimeBrief only opens Desktop; it
never resumes the saved CLI conversation again, including after archiving.
The user selects the task in Desktop and sends a follow-up to continue work
interrupted by the handoff. Native resume restores the saved model. Verified
with Claude Code 2.1.263 and the installed Desktop app: initial Auto and Bypass
tasks perform the requested writes, but Desktop handoff can reset Bypass to
Desktop's own permission mode. The receipt labels settings as the original
launch choices, and the UI asks the user to check Desktop's mode before a
follow-up. Tool approvals and mode changes remain in Claude.

Verified with Claude Code 2.1.263: actual initial prompt and response; iOS launch
through a local daemon followed by exact-session Desktop takeover; a follow-up
retaining prior conversation context; and a Write tool approval in Desktop
creating the expected fictional file in Claude's worktree. Signed-out behavior,
duplicate requests, reconnect recovery, uncertain dispatch, project
opt-out, writer ownership, and read-only catalog validation have automated
coverage. A paired physical iPhone was confirmed to show the enabled task
button after the backend update. Full physical-phone task creation and
takeover were not part of that confirmation; those flows were verified using
the simulator, a local daemon, and native Claude Desktop. Cloud-device checks
exercise the fictional demo composer and receipt without contacting a Mac.

Claude Code and Desktop must be installed and signed in, and workspace trust
must be completed on the Mac. Native CLI or catalog changes can make capability
or handoff unavailable. The UI reports this without reconstructing history,
silently replaying a task, or bypassing an approval.

## Upgrade from build 15

Update the daemon and restart its service first. Configured and discovered
projects now allow launches even when `allowed_actions` has no `launch-claude`
entry. That older grant is no longer required. To retain an intentional
restriction, set `claude_launch_enabled: false` on the explicit project entry,
or run `runtimebriefd disable-claude <project-id>` with the updated daemon.
Run `runtimebriefd install-service` to apply a config change.

An existing build-15 iOS app can use the new default access after refreshing
the Claude section. Build 16 is required for the model and permission menus.
Old request bodies and receipts remain readable: omitted choices mean the
configured Claude model and Manual permissions. Default request fingerprints
remain compatible so an uncertain old request is not dispatched again after
an upgrade.

## Claude launch API

Every route uses the existing daemon bearer authentication and registered
project scope. `GET /v1/projects/:id/claude-launches` returns
`{ capability: { available, message }, launches: [...] }`. Use the capability
message to explain installation, sign-in, or explicit project opt-out issues.

Send `POST /v1/projects/:id/claude-launches` with JSON such as:

```json
{
  "requestId": "11111111-1111-4111-8111-111111111111",
  "prompt": "Review the fictional export workflow and describe the next step.",
  "model": "fable",
  "permissionMode": "auto",
  "remoteControl": true
}
```

Generate a fresh UUID for each new task; the UUID above is only an example.
Prompts are trimmed and must contain 10–8,000 characters. Slash commands,
unsupported control characters, unknown fields, and unsupported option values
are rejected with HTTP 400.
Omitted `remoteControl` means true for the t backend; false explicitly disables
the connection for that launch without changing provider-global settings.
The explicit legacy `native` backend rejects a new request for Remote Control;
old requests without that field and existing receipts remain compatible.

| iOS model label | `model` value | Behavior |
| --- | --- | --- |
| Claude default | `default` (or omitted) | Uses the Mac's configured Claude model; no model override is passed. |
| Fable | `fable` | Uses Claude's Fable alias. |
| Opus | `opus` | Uses Claude's Opus alias. |
| Sonnet | `sonnet` | Uses Claude's Sonnet alias. |
| Haiku | `haiku` | Uses Claude's Haiku alias. |

| iOS permission label | `permissionMode` value | Behavior |
| --- | --- | --- |
| Manual | `manual` (or omitted) | Asks in Claude when an action needs permission. |
| Auto | `auto` | Claude checks actions automatically; availability depends on the model and account. |
| Accept Edits | `acceptEdits` | Allows file edits and asks for other actions that need permission. |
| Plan | `plan` | Explores and plans before changes. |
| Bypass | `bypassPermissions` | Skips tool permission prompts; select only for trusted work. |
| Pre-approved Only | `dontAsk` | Denies actions that would require approval. |

HTTP 202 returns a durable receipt, not a guarantee of completed execution.
The receipt includes `id`, `projectId`, `name`, `createdAt`, `state`, `message`,
`nativeId`, `sessionId`, `cwd`, `openedAt`, and the original `model` and
`permissionMode` choices. Native IDs can be null until acknowledged. States
include `starting`, `running`, `needs_input`, `completed`, `stopped`, `failed`,
`unknown`, and `in_desktop`.
New t receipts additionally include `backend: "t-legacy"`, `projectRoot`,
`tmuxTarget`, `launchState`, `activity`, `requestedRemoteControl`, and
`remoteControl: { state, url, observedAt }`. A ready connection is independent
of task acknowledgment or turn completion. The list remains the existing
latest-20 product API; it is not the proposed exhaustive `t api` list.

Retry the same task/settings with the same `requestId`. Reusing an ID with a
different prompt, project, model, or permission mode returns HTTP 409
`request_conflict`. A disabled project returns HTTP 403 `launch_disabled`;
an unregistered project returns HTTP 404. Refresh uncertain receipts before
deciding to create a new request.
Changing the Remote Control preference also conflicts. Setup failures from the
t backend return HTTP 409 `requires_setup` before reservation.

`POST /v1/projects/:id/claude-launches/:launchId/open` transfers a confirmed
conversation to Desktop and returns the updated receipt. It does not accept a
new prompt or new launch choices. `model` and `permissionMode` always describe
the launch, not Desktop's current settings. Once handed off, later requests
only open Desktop and never resume or replay the old CLI conversation.
This endpoint applies to legacy background receipts. A t receipt returns
`use_native_session`; its native Remote Control link and terminal are the
continuation surfaces.

## First milestone

RuntimeBrief is a launch, attention, and handoff layer for Codex, Cursor, and
Claude Code. A user starts their agent from a RuntimeBrief project and takes
over the same conversation in the corresponding app. Native session takeover
is a requirement for a supported integration, not a later enhancement.

The vendor runtime owns the conversation, agent loop, tools, permissions, and
working environment. RuntimeBrief owns launch intent, delivery receipts,
cross-project evidence summaries, and a verified way back to the native app.
A CLI/SDK run that only shares files with the desktop app does not satisfy
session takeover.

The broader product flow for future vendor integrations is:

1. Open a project and select **New session**.
2. Choose **Codex**, **Cursor**, or **Claude Code** and enter a prompt. Use
   the native project's defaults where the integration supports them. Surface
   relevant differences in model, permissions, worktree, or execution location.
3. Dispatch through a vendor-specific integration. Distinguish a prefilled
   composer awaiting confirmation from an acknowledged, executing session.
4. Show a compact status card and evidence summary linked to the native session.
   Disconnecting the phone must not cancel the agent's work.
5. Select **Open in Codex**, **Open in Cursor**, or **Open in Claude** to take
   over the same conversation. From the phone, this may request opening the
   session on the connected Mac or use a verified vendor mobile/web link.

The initial UI is a task composer and status card. Rich chat, editing, detailed
diff review, and configuration remain in the vendor apps. RuntimeBrief can show
that input or approval is required and link to the correct native surface.
Forwarding approvals or follow-ups can be added as separately verified adapter
capabilities after launch and takeover work reliably.

Continuation of sessions that already exist in desktop apps is a separate
milestone. New sessions should record enough identity and ownership information
to support follow-ups without rediscovering their execution process.

## Architecture

The native launch service sits beside the read-only observation adapters and the
isolated analyst. Each vendor adapter implements capability discovery, launch,
observation, and opening or handing off the native session. Expose these through
the authenticated Mac daemon; future MCP controls use the same service.

Prefer a supported app API or extension bridge, then a documented CLI-to-app
handoff. Deep links that only prefill are a separate prepare/open capability.
Desktop accessibility automation is an experimental fallback with an explicit
usable-desktop dependency. Do not depend on private transcript/database writes,
undocumented authenticated endpoints, or a reconstructed conversation.

The session record needs project ID, runtime, native conversation ID, working
directory, execution owner/connection, effective permission profile, operation
ID, launch outcome, observed runtime state, and verified desktop handoff target. Distinguish a
runtime conversation ID from a process ID and from an app-specific sidebar ID.

Use registered project scope and authenticated clients, with an explicit
per-project opt-out for Claude launches. Disabling launches preserves project
observation. All paired clients share this scope. Native runtime permissions
determine what the agent can edit, execute, or access. Bind any
approval to its exact runtime request and session; the current decision inbox
only records a choice and does not deliver it to an executing agent.

Persist an operation before dispatch and reconcile its native session/run ID.
A repeated request must return the existing operation. If a crash leaves
dispatch uncertain, report that state and reconcile before retrying; a database
idempotency key alone cannot guarantee exactly-once delivery to an external
runtime. Reconnecting to an event stream must not start another run.

## Integration findings

### Codex

The current analyst already uses App Server, but uses isolated temporary homes,
an ephemeral thread, and an evidence-only permission profile. A coding session
must use a native-compatible integration instead of the analyst's isolation
configuration. Reusing App Server transport code alone is insufficient.

The official App Server protocol supports thread creation, persisted-thread
resume, new turns, active-turn steering, interruption, events, and approvals.
Its documented APIs do not by themselves establish that a separately started
server controls a thread already running in the desktop app.

The installed CLI also exposes `codex app-server proxy --sock <path>` for a
running daemon's control socket. A read-only daemon version check found no
socket at the default location on the inspected Mac. This is a candidate to
test, not a verified connection to the desktop-owned runtime. Do not start,
replace, or reconfigure the user's desktop runtime as part of discovery.

Codex Remote documents starting and continuing computer-hosted tasks through
the first-party mobile app. That documents a user workflow, not a public
third-party API that RuntimeBrief can assume it can call.

Sources: [App Server](https://learn.chatgpt.com/docs/app-server),
[Remote](https://learn.chatgpt.com/docs/remote), and installed Codex CLI 0.144.1
help for `app-server`, `proxy`, and `daemon`.

### Claude Desktop / Claude Code

Claude documents `claude://code/new` with a prefilled prompt and folder. The
folder requires confirmation in Desktop and the prompt is prefilled. This is
an **Open in Claude** handoff, not evidence that unattended work started.

Claude's Desktop documentation describes separate CLI and Desktop session
histories and a `/desktop` handoff from CLI to Desktop. This handoff is used by
the implementation above. Applying SDK resume to sessions that already exist
in Desktop still needs separate compatibility and ownership testing. Native
Remote Control's availability does not establish a supported RuntimeBrief
message-injection API.

Sources: [Desktop deep links](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link),
[Desktop and CLI](https://code.claude.com/docs/en/desktop),
[Native background sessions](https://code.claude.com/docs/en/agent-view),
[Remote Control](https://code.claude.com/docs/en/remote-control),
[SDK sessions](https://code.claude.com/docs/en/agent-sdk/sessions).

### Cursor

Cursor prompt deep links prefill chat and explicitly require user confirmation
before execution. The TypeScript SDK supports creating and resuming agents;
local conversation state persists across process restarts.

Cursor explicitly documents that SDK-created cloud agent runs appear in its
Agents Window and web app, where the user can inspect progress or take over.
This is a documented candidate for launch plus native takeover, still requiring
an integration test. Cloud execution is a distinct user-selected mode: it does
not include the local checkout's uncommitted state. The evidence reviewed does
not establish equivalent desktop visibility for an ordinary local SDK run.

Sources: [Deep links](https://cursor.com/docs/reference/deeplinks),
[TypeScript SDK](https://cursor.com/docs/sdk/typescript),
[SDK Bridge](https://cursor.com/docs/sdk/bridge),
[SDK launch and native takeover](https://cursor.com/blog/typescript-sdk).

## Integration acceptance before building the full launcher

Prove one narrow launch-and-takeover path per vendor using a fictional task:

1. Submit a prompt and obtain the native conversation/run identifier.
2. Observe acknowledgment and a small resulting file change.
3. Open that exact conversation in the vendor app. Verify the original prompt,
   response, working directory, branch/worktree, and changes.
4. Submit a follow-up in the vendor app and verify its response retains context.
5. Confirm RuntimeBrief observes the same session after takeover and cannot
   accidentally create a duplicate or run a competing writer.

Report preparation, execution, and takeover as separate outcomes. An API method
existing in documentation or a composer opening successfully is not a completed
launch-and-takeover proof. Select the first implementation based on a successful
proof and the user's local-versus-cloud preference, rather than SDK convenience.

## Continuing existing desktop sessions

Evaluate these options in order:

| Option | Acceptance requirement |
| --- | --- |
| Connect to the owning runtime | Verify native identity, live ownership, accepted input, response, and synchronization in the desktop UI. |
| Supported native handoff | Open the exact session in the vendor's desktop/mobile interface and describe where the user continues. |
| Resume an idle session through SDK/CLI | Verify complete history, actual working directory, required tools, and desktop handback. Confirm no other process is executing it. |
| Start new with context | Clearly create a new conversation seeded with a user-reviewed brief, relevant decisions, and evidence references. Preserve a link to the original. |
| Desktop UI automation | Experimental fallback requiring the app to be available and the desktop usable. Verify the target and acknowledgment for every send; report ambiguity without resending. |

Transcript-derived activity is useful for display but is not a lock or proof of
runtime ownership. Never continue an active desktop conversation by launching a
second writer against its transcript. Expose actions according to verified
capabilities rather than giving every observed session a generic Continue button.

## Validation before release

Use a fictional disposable project to verify a real new prompt and resulting
file change under the selected permission profile. Confirm its native identity
and desktop visibility through Computer Use. Exercise phone disconnect/reconnect,
duplicate submission, Stop, runtime failure, and an approval round trip.

Then validate the iOS flow on a Revyl cloud device using the repository's
instructions. Provider-device testing and a physical iPhone reaching the user's
Mac are separate coverage claims. Existing desktop continuation requires its
own tests; new-session success does not establish continuation support.
