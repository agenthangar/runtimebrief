# Proposal: a small machine interface for t

**Draft · Updated 2026-09-24 · Not implemented**

RuntimeBrief starts a task through `t`, reads its status, and opens the native
agent when the user needs to act. `t` owns the process, tmux, worktree, and durable
session record. The agent owns conversation, tools, and approvals. Human `t`
commands and the machine interface use the same lifecycle code and store.

Start with Claude on the local Mac. Advertise other providers only after their
adapters work. Remote Control is requested by default; local-only is an explicit
opt-out. [Current Claude launching](../session-control.md) remains in place until
this integration is verified. Existing launches keep their original owner.

## Four methods, one record

```sh
t api call --stdin < request.json
```

One process reads one JSON request through EOF and writes one JSON response plus
a newline. It needs no terminal and never sources personal `.zshrc`, attaches to
tmux, or prints progress on stdout. Diagnostics on stderr are redacted. Limit
input to 256 KiB and output to 8 MiB; enforce a 30-second call deadline. The agent
inside tmux outlives the API process and the RuntimeBrief daemon.

| Method | Params | Result |
| --- | --- | --- |
| `providers.list` | None | Implemented providers, current availability, supported launch settings |
| `sessions.create` | Caller-chosen ID, project, provider, workspace, prompt, optional settings and Remote Control preference | Session record, including launch outcome |
| `sessions.get` | Project and ID | Refreshed session record, including native link and terminal target |
| `sessions.list` | Project | All managed session records for that project, newest first |

Lists never silently truncate: return `output_limit` if the response would exceed
the byte limit. Pagination can be added when actual usage requires it. Read calls
may reconcile stored records, but never create a process, send a prompt, enable
Remote Control, or take ownership of another session.

```json
{
  "version": 1,
  "method": "sessions.create",
  "params": {
    "id": "11111111-1111-4111-8111-111111111111",
    "provider": "claude",
    "projectRoot": "/workspaces/sample-app",
    "workspace": "worktree",
    "prompt": "Review the sample export workflow."
  }
}
```

`remoteControl` defaults to `true`; pass `false` for local-only. Optional
`settings` contains only `model` and `permissionMode`, using values advertised by
`providers.list`. Omitted values inherit native defaults; the UI labels them
"Agent default". Unsupported explicit overrides fail before dispatch.
Provider availability is a current probe, not a guarantee: recheck at launch.

`workspace` is required: `worktree` creates a fresh worktree from the repository's
locally known default branch; `existing` uses the current checkout, including its
uncommitted changes. Reject an unresolved default branch instead of guessing or
fetching. Return the actual directory, branch and base commit. Custom refs and
branch naming are deferred. Worktrees are never automatically deleted.

Success responses have `version`, `method`, `ok: true`, and `result`. Errors have
`version`, `ok: false`, and `error: { code, message }`. Exit 0 means a valid success
response, including a session reporting a failed launch; exit 1 means a structured
error. The client checks both the response method and its result schema. Version
1 also frames malformed-request and unsupported-version errors. An unsupported
version is rejected before side effects. OS/bootstrap failures can have no JSON;
missing or invalid output after create is an uncertain outcome, never permission
to start again with a new ID.

## One durable identity

The caller creates and saves a UUID before calling `sessions.create`. That `id`
is both the session record ID and the idempotency key. The native conversation
ID and tmux target remain separate. There is no operation ID or operation API:
a failed launch is still a useful session record.

`t` atomically reserves the ID and normalized input fingerprint in its private
store before workspace creation or agent dispatch. Omitted `remoteControl` and
explicit `true` are equivalent; omitted `settings` and `{}` are equivalent. The
schema's defaults are annotations, so the implementation must normalize them.
Resolve inherited settings and workspace defaults once per reservation.

Matching retries return the original record. Changed inputs return
`request_conflict`. A duplicate call, including one after a crash, never takes
over dispatch or replays the prompt. A single initiating call holds the dispatch
lock and performs bounded launch work. Once accepted, failures are recorded on
the session; error envelopes represent rejection before durable acceptance.
If a crash leaves dispatch ambiguous, reconcile native evidence and otherwise
report `unknown`. Retain IDs/fingerprints even if bulky session details are pruned.

After losing a response, call `sessions.get` with the saved ID or repeat the
original create request with the same ID. A `not_found` result is not a reason to
change the ID: the original call might still be in flight. A new ID means a new
task and needs fresh user intent.

## Three independent facts

Every session carries these fields:

| Field | Values | Meaning |
| --- | --- | --- |
| `launchState` | `starting`, `started`, `failed`, `unknown` | Whether the initial prompt was accepted |
| `activity` | `busy`, `idle`, `waiting_input`, `waiting_approval`, `exited`, `unknown` | What the agent is doing now |
| `remoteControl.state` | `connecting`, `ready`, `requires_setup`, `unavailable`, `disabled`, `unknown` | Whether native remote access is usable |

`started` requires native acknowledgment of the initial prompt, a verified native
conversation ID, and the actual workspace. A tmux process existing or bytes being
written is insufficient. `failed` means definitively not accepted; ambiguity is
`unknown`. Started is historical and stays started when the agent exits. Idle or
exited does not mean the user's task is complete; RuntimeBrief verifies outcomes
from project evidence.

Activity is independent: a startup trust dialog can report `waiting_input`
before the prompt is acknowledged or a native conversation ID is known. Any
known activity needs a verified workspace and observation timestamp.

`observedAt` is the last successful activity observation, not the last poll. A
failed refresh sets activity to unknown and preserves that timestamp. Remote
status has its own `checkedAt`. `requestedSettings` describes launch choices,
not the agent's current model or permissions after changes in its native UI.
The session's message explains failures or unknown state without raw tool output.

## Native handoff, enabled by default

For Claude, explicitly request the documented interactive
[`claude --remote-control`](https://code.claude.com/docs/en/remote-control) path
inside tmux when existing vendor setup and consent permit it. The official
interface supports local and remote interaction with the same conversation;
our adapter still needs end-to-end verification. Enabling it does not change
global provider settings or existing sessions.

Only `ready` includes a URL. `t` verifies the HTTPS provider host, exact native
conversation mapping, and current availability before returning it. All other
states return a null URL and an explanation when action is needed. Refresh
`sessions.get` before opening; if verification fails, clear the URL. A generic
provider homepage cannot establish readiness. A separate nullable `terminal`
field identifies the currently verified local tmux target, without executable
shell strings. Local attachment joins the existing owner.

Missing consent/login returns `requires_setup`; complete setup in the native
interface. If a session already exists, use its terminal target and native Remote
Control command, then refresh. Never relaunch the task to repair remote access.
There is no `continuation.prepare` API in v1. Remote failure does not invalidate
an acknowledged local launch. Local-only must override provider auto-connect for
the new session, or fail before dispatch if this cannot be enforced. Later user
changes in the native interface are reflected as observed state.
The default requests remote access where supported; it does not promise readiness.
Adapters that require moving execution to another host are outside v1.

## Integration boundary

RuntimeBrief authenticates clients and passes an authorized, canonical absolute
project root. `t` binds every record to that root; get/list and duplicate-create
lookups return `not_found` for a record belonging to another project. Validate actual
workspace ownership using Git metadata, since a worktree can be outside the root.
`t` remains a local executable with the OS user's permissions.

Pin the `t` artifact by release, immutable commit and checksum, and call its
absolute path. Bundle the necessary helpers; current `t open` depends on an
interactive shell and is not yet this machine API. Keep a single wire version;
there is no separate bootstrap handshake or minor-version negotiation in v1.
Stored-state versions remain an internal concern, with incompatible state rejected
before writing and explicit backed-up migration for future upgrades. Updates
must preserve running sessions.

Use argument arrays and stdin for task text. Temporary prompt data stays private
and is deleted when no longer needed; never log prompts, credentials, or native
session URLs. Keep launch receipts in `t`; RuntimeBrief may cache them but must
not maintain a second dispatch/retry authority. Legacy launches continue through
the existing RuntimeBrief launcher without migration or competing ownership.

## Scope and acceptance

RuntimeBrief owns cross-project attention, evidence, and the route to the next
action. Native agents own chat, execution, review, and approvals. Queueing prompts,
steering, phone terminals, session transfer, adoption, and a second supervisor are
outside v1. Avoid building APIs for capabilities that have not been demonstrated.

Before implementation ships, prove no-TTY launches in both workspace modes,
concurrent retries and crashes, scope enforcement, explicit settings, Remote
Control default/opt-out, stale connection handling, and attachment to the same
conversation. Verify real native prompt acknowledgment and a follow-up through
Claude's native surface. Keep existing human `t` commands working. Test the iOS
flow on a Revyl cloud device and separately on a physical phone reaching the Mac.

[contract.schema.json](contract.schema.json) defines the payloads;
[examples.json](examples.json) and [validate.cjs](validate.cjs) check them with
`node docs/session-manager/validate.cjs`. These checks cannot prove dispatch,
filesystem ownership, defaults/idempotency normalization, or native connectivity.
The example.com URLs are deliberately fictional and must fail a real provider
host check. This simplification replaces an unimplemented draft, not a shipped API.
