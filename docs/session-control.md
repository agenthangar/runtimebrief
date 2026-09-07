# Native session launch and takeover

Status: Claude Code launch and native Desktop takeover implemented, 2026-09-07.
Codex, Cursor, and control of pre-existing Desktop sessions remain research.

## Implemented Claude flow

Each project requires an explicit local `launch-claude` grant. The authenticated
iOS client submits a task and a stable request UUID. The daemon reserves a
private SQLite receipt before launching `claude --bg --permission-mode manual
--name <receipt-name> -- <prompt>`. It records the native short ID from Claude's
acknowledgment and the conversation UUID from `claude agents --json --all`.
Claude ignores a supplied `--session-id` in background mode, so RuntimeBrief
never invents that identity. Prompts are not retained in the receipt database.

Claude owns execution and may create its own worktree. RuntimeBrief follows the
native working directory and shows running, needs-attention, completed, stopped,
failed, or uncertain status. A lost HTTP response, daemon restart, or repeated
request ID does not replay the prompt. Uncertain dispatch is reconciled by the
unique native task name before any manual retry with a new request ID.

**Open in Claude Desktop** stops the exact background owner and uses normal
`claude --resume <conversation-uuid> --permission-mode manual /desktop` in a
terminal. This honors native writer locks and avoids background resume's
possible fork behavior. Claude's own Desktop catalog is read only to verify the
same conversation ID. Once handed off, RuntimeBrief only opens Desktop; it
never resumes the saved CLI conversation again, including after archiving.
The user selects the task in Desktop and sends a follow-up to continue work
interrupted by the handoff. Tool approvals remain in Claude.

Verified with Claude Code 2.1.263: actual initial prompt and response; iOS launch
through a local daemon followed by exact-session Desktop takeover; a follow-up
retaining prior conversation context; and a Write tool approval in Desktop
creating the expected fictional file in Claude's worktree. Signed-out behavior,
duplicate requests, reconnect recovery, uncertain dispatch, permission
revocation, writer ownership, and read-only catalog validation have automated
coverage. A paired physical iPhone reaching the Mac requires separate testing.

Claude Code and Desktop must be installed and signed in, and workspace trust
must be completed on the Mac. Native CLI or catalog changes can make capability
or handoff unavailable. The UI reports this without reconstructing history,
silently replaying a task, or bypassing an approval.

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

Use per-project control grants and explicitly authorized clients. Preserve the
existing observation behavior for clients without those grants. Native runtime
permissions determine what the agent can edit, execute, or access. Bind any
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
