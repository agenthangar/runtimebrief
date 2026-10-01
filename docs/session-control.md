# Native session control

New RuntimeBrief tasks use the installed native providers directly. `t` and
tmux are not execution dependencies. Old configuration values are accepted
when upgrading, but new tasks always select a native adapter. Existing receipts
are retained privately but omitted from the new task list; they are not replayed or reinterpreted as native sessions.

## Provider connections

| Provider | Execution and continuation |
| --- | --- |
| Claude Code | Detached PTY owner starts the native CLI with a fixed session UUID and Remote Control. Native history confirms prompt acceptance and the exact connection URL. Claude owns setup, trust, tools, and permission prompts. |
| Codex | App Server resolves the repository's native project before creating a durable thread in the isolated worktree. Native notifications drive messages and approvals. Its process closes after each turn to release ownership to native Codex. A RuntimeBrief follow-up verifies and resumes the same thread. |
| Cursor | A persistent local ACP connection uses the existing Cursor login, creates a session, and handles prompts, updates, questions, plans, and permission requests. |

Cursor ACP conversations also feed portfolio evidence and analyst context from
their private native snapshots when no desktop transcript exists. The reader
checks the exact worktree and native session identity, deduplicates matching
desktop history, and verifies the owner before showing an active or waiting
state. A stopped owner cannot leave an actionable approval in the portfolio.

Every task gets a Git worktree under private RuntimeBrief storage, based on
local HEAD. This does not copy uncommitted changes or fetch from the network.
The selected provider runs in that exact worktree. The detached owner survives
HTTP disconnects and daemon restarts. If it exits, RuntimeBrief reports Stopped
or Failed; it does not redispatch an uncertain task.

Native CLI/protocol identities do not by themselves prove desktop sidebar
visibility. Claude continuation uses a verified Remote Control link. Codex is
assigned to its existing repository project, or one stable named project is
created using the repository root. The UUID worktree remains the execution
directory, not the project identity. Cursor continuation is offered within
RuntimeBrief for the live owned session.

Codex owns a task exclusively while a turn or approval is pending. On turn
completion RuntimeBrief closes its App Server process; unsubscribing alone is
insufficient because idle threads can remain loaded. The detached RuntimeBrief
runner remains available without a loaded Codex thread. Follow-ups reconnect,
read and verify the saved thread's identity, project, and exact workspace, then
resume without changing its workspace or replaying the initial prompt. If
native Codex already owns the task, the follow-up fails without creating a new
thread or sending a turn. Close that native task before replying here, or
continue in the native app. An exited RuntimeBrief runner is not restarted
automatically, and active work is never interrupted for an implicit handoff.

## Loading and cache scope

The daemon starts provider checks independently in the background and shares
account health across projects. Health is cached for five minutes, or thirty
seconds when a provider is unavailable. The account endpoint never enumerates
models or reconciles history. Model discovery and task creation reuse that
same account check, including an in-progress check. Each project list returns persisted receipts
immediately and schedules status reconciliation in the background.

On app launch and foreground refresh, iOS starts provider discovery and
prefetches project task lists with at most four concurrent requests. Task cards
are saved in a protected cache scoped to the connected server and token;
demo mode uses its own in-memory state. Switching projects reuses provider
health. Project opt-outs, task history, models, and workspace defaults retain
their own project scope. Model catalogs load when the composer selects a
provider. Cached cards remain visible while network refresh is pending.
Background prefetch reuses task lists fetched within the last minute. A rate
limit response pauses retries for a minute instead of continuing three-second
polling. Agent reads have a bounded 600-request budget per minute; task creation
and replies retain the separate 30-request limit.

## Authenticated endpoints

- `GET /v1/providers`: shared provider health, including independent checking states.
- `GET /v1/projects/:id/providers/:provider`: selected provider catalog and workspace defaults.
- `GET /v1/projects/:id/sessions`: fast receipt snapshot; reconciliation runs asynchronously.
- `POST /v1/projects/:id/sessions`: stable request UUID, task, provider, model, permissions, and optional reasoning/continuation settings.
- `GET /v1/projects/:id/sessions/:launchId/conversation`: owned conversation snapshot and pending requests.
- `POST /v1/projects/:id/sessions/:launchId/reply`: stable response UUID plus one message or one explicit decision.

All continuation writes enforce project scope and the project's launch opt-out.
Native socket ownership is checked using the exact worktree and a private
per-task token. Approval choices are tied to the current native request.
Replies are durably reserved before dispatch; retries with identical request
IDs never repeat a follow-up or decision, including uncertain acknowledgments.
The initial launch receipt is also reserved before dispatch. Polling endpoints
have a separate bounded request budget, so conversation refresh and background
prefetch do not consume the mutation budget. Siri and Shortcuts use the selected
provider catalog endpoint before confirming a native launch.

Claude's setup screen uses bounded terminal input only for the verified owner.
The task list displays human states and continuation actions, without tmux
commands. Codex and Cursor display messages and explicit approval/question
controls in the conversation screen.

## Provider references

- [Claude Remote Control](https://code.claude.com/docs/en/remote-control)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [Cursor ACP](https://cursor.com/docs/cli/acp)

Historical integration details are [archived separately](session-control-legacy.md).
