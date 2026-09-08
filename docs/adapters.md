# Runtime adapters

Every source of project activity implements `RuntimeAdapter`
(`daemon/src/types.ts`): `discover()` says whether the adapter applies to a
project, `recentActivity()` returns timestamped events, and
`transcriptPaths()` returns references to session transcripts on disk.
Adapters are strictly read-only.

These adapters are unofficial compatibility code based on empirically observed
local formats. The formats can change without notice, and the vendors do not
endorse RuntimeBrief. Users are responsible for ensuring that their access and
use of local transcript data complies with the applicable product terms,
licenses, organizational policies, and law.

## FilesystemGitAdapter (`filesystem-git`)

Applies to any project directory that is a git work tree. Produces:

- current branch, dirty/clean state and dirty file count
- last 20 commits (hash, author, ISO timestamp, subject)
- diffstat vs the default branch (`main`, falling back to `master`)
- open TODO / FIXME counts: lines in *tracked* text files containing the
  marker as a word, via `git grep -I -c -w -F`; sensitive paths are dropped
  from the tally even if tracked
- the 10 most-recently-modified files, from a bounded mtime-only walk
  (max 5000 files; skips `node_modules`-style directories, symlinks,
  dotdirs, and any path matching the sensitive-file deny list)

Git runs via `execFile` with argv arrays — never a shell — and only the
subcommands `log`, `status`, `diff`, `branch`, `rev-parse`, `grep` are
allowlisted. Exec-style flags (`--exec`, `--upload-pack`, and `git grep`'s
`-O`/`--open-files-in-pager`, …) are rejected. Commit fields
are separated with `%x1f`/`%x1e` control characters so hostile commit
messages and file names stay data.

## ClaudeCodeSessionsAdapter (`claude-code`)

The RuntimeBrief analyst does not launch Claude or create Claude sessions. The
adapter only reads local Claude session metadata as project evidence.
Starting a task or handing it to Desktop uses a separate authenticated
[native launch controller](session-control.md), not this adapter.

### Empirical findings (verified 2026-08-22, Claude Desktop + Claude Code 2.1.229)

Claude Desktop Code mode and the standalone Claude Code CLI share the same
canonical JSONL transcripts. Claude Desktop also keeps a local metadata catalog,
while running desktop and CLI processes publish a short-lived registry:

```
# Shared Claude Desktop / Claude Code CLI transcripts
~/.claude/projects/<encoded-project-path>/<session-uuid>.jsonl

# Claude Desktop titles, timing, model and error metadata
~/Library/Application Support/Claude/claude-code-sessions/*/*/local_<id>.json

# Live desktop or CLI process registry (JSON only; sibling keys are never read)
~/.claude/sessions/<session>.json
```

- **Path encoding:** every non-alphanumeric character of the absolute project
  path is replaced with `-`. Verified: `/home/user/RuntimeBrief` →
  `-home-user-RuntimeBrief`. Note this is lossy (`_` and `.` also become `-`).
- **Sidecar files:** directories can contain non-transcript files (e.g.
  `<session>.ccr-tip.json`); only `*.jsonl` files are transcripts.
- **Record shape:** one JSON object per line. Observed `type` values:
  `user`, `assistant`, `attachment`, `queue-operation`, `last-prompt`
  (plus `summary`, `system`, `progress`, `file-history-snapshot` in other
  versions). Only `user`/`assistant` lines carry conversation content.
- `user` lines: `message.content` is either a plain string (a real prompt) or
  an array of blocks — `tool_result` blocks are tool output echoed back, not
  prompts. Harness-injected turns start with `<system-reminder>`,
  `<command-name>`, etc.
- `assistant` lines: `message.content` is an array of `thinking` / `text` /
  `tool_use` blocks; `message.model` and `message.usage` are present.
- Common metadata on conversation lines: `uuid`, `parentUuid`, `timestamp`
  (ISO 8601), `sessionId`, `cwd`, `version`, `gitBranch`, `isSidechain`
  (true for subagent threads).
- **Desktop join:** catalog `cliSessionId` is the stable join key to the shared
  JSONL. Joined records collapse to one session; a catalog-only desktop session
  is still surfaced from its title/timestamps/cwd without inventing transcript
  content. Live registry JSON can surface a just-started session before its
  transcript exists. Private `.key` sidecars are never opened.
- **Project linkage:** canonical `cwd` is authoritative. Nested workspaces match
  their configured parent project. A session launched from a parent workspace
  matches a child project only when a concrete tool path falls inside it. The
  lossy encoded directory name alone is never trusted, so colliding paths fail
  closed instead of leaking a thread to the wrong project.

### What the adapter extracts

Per session: start/end time (min/max line timestamp), git branch, model,
real user prompts, the final assistant text (main thread only — sidechains
excluded), files touched (from `tool_use` inputs `file_path` /
`notebook_path` / `path`, with sensitive paths filtered), tool-use count,
best-effort lifecycle state, and a malformed-line count. A real user request
or tool activity marks the session active, `AskUserQuestion` marks it waiting
for user input, and a concluding assistant response marks it completed.
Desktop task-notification turns are not treated as human prompts, so a resumed
thread is summarized by its latest genuine request. A terminal desktop API-error
record marks the session interrupted and its private error text is not surfaced.
Malformed or truncated lines — normal for live sessions being appended to —
are skipped without failing the parse.

The transcript root defaults to `~/.claude` and can be overridden per
project in `config.yaml`:

```yaml
projects:
  - id: sampletracker
    name: "Sample Tracker App"
    path: /Users/developer/projects/sample-tracker
    transcript_sources:
      - type: claude-code
        root: /custom/claude/home
```

Listing `transcript_sources` at all makes it exhaustive: adapters not listed
are skipped for that project.

## CodexSessionsAdapter (`codex`)

### Empirical findings (verified 2026-08-22, Codex Desktop + CLI 0.144.1)

Rollout layout on disk, inspected live on this machine:

```
~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<session-uuid>.jsonl
```

Codex Desktop and the Codex CLI share this canonical rollout tree. The desktop
Application Support and SQLite catalogs contain metadata/cache rows, not a
second transcript source, so the adapter reads and deduplicates one store.

- **Partitioned by date, not project.** The first line of every rollout is a
  `session_meta` record whose payload carries the session `cwd` — that is the
  only project linkage. The adapter reads just the first line of each file
  (newest mtime first, capped at 1000 files) and matches a project when the
  cwd equals the project path or lies inside it. `~/.codex/session_index.jsonl`
  exists but has no cwd, so it can't be used for discovery.
- **Record shape:** one JSON object per line, `{timestamp, type, payload}`
  with an ISO 8601 top-level timestamp. Observed `type` values:
  `session_meta`, `turn_context` (carries `model`), `world_state`,
  `compacted`, `event_msg`, `response_item`.
- `event_msg` payload types: `user_message` (the real prompt; harness-injected
  turns start with an angle-bracket tag like `<environment_context>`),
  `agent_message` (`phase` is `commentary` for progress notes or
  `final_answer` for the closing report), `task_started`, `task_complete`,
  `token_count`, `patch_apply_end` (its `changes` keys are the absolute paths
  of files the agent wrote), `turn_aborted`, ….
- `response_item` payload types: `message` (developer/system context — not
  prompts), `reasoning` (encrypted — never surfaced), `function_call`,
  `custom_tool_call`, `web_search_call`, `tool_search_call` and their
  `*_output` counterparts.

### What the adapter extracts

The same `ParsedSession` digest as the Claude Code adapter: start/end time
(min/max line timestamp), model (from `turn_context`), real user prompts,
the final agent message (`final_answer` phase, falling back to the last
commentary for aborted sessions), files touched (from `patch_apply_end`
changes, sensitive paths filtered), tool-use count, lifecycle state from
`task_started` / `task_complete` / `turn_aborted` and message phases,
including a distinct waiting state while a `request_user_input` call has no
output. A later user-stop event remains interrupted and is not treated as
waiting. Parent-workspace desktop tasks can be attributed from structured
`function_call.arguments` or `custom_tool_call.input` workdirs; developer
context is excluded from attribution. Git branch is not recorded in rollouts
and stays null.

The root defaults to `~/.codex` and can be overridden per project via a
`transcript_sources` entry of type `codex` (same mechanics as `claude-code`
above).

## CursorSessionsAdapter (`cursor`)

### Empirical findings

RuntimeBrief reads three local, read-only Cursor stores so current desktop and CLI
agent threads plus older CLI chats appear together:

```
# Current Cursor local-agent transcripts
~/.cursor/projects/<encoded-workspace>/agent-transcripts/<session-uuid>/<session-uuid>.jsonl

# Current Cursor desktop thread index and conversation records
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb

# Legacy cursor-agent chat store
~/.cursor/chats/<workspace-hash>/<session-uuid>/
  meta.json             { schemaVersion, cwd, title?, createdAtMs, updatedAtMs, hasConversation }
  store.db              SQLite (better-sqlite3-readable)
  prompt_history.json   the user's prompts, newest first
```

- **Project JSONL:** records are `{role, message}` user/assistant turns with
  text and `tool_use` blocks, followed by an optional `turn_ended` result.
  User prompts may be plain text or wrapped in `<user_query>` tags. Cursor
  encodes the workspace path in the directory name.
- **Desktop SQLite:** `composerHeaders` carries thread timestamps, state,
  title, and workspace URI. `cursorDiskKV` stores `composerData:<id>` plus
  ordered `bubbleId:<composerId>:<bubbleId>` records. RuntimeBrief opens the
  database read-only, tolerates live WAL updates/locks, excludes empty shells
  and subagents, and never reads credential entries from the same database.
- **Legacy store.db:** tables `meta(key, value)` and `blobs(id, data)` are
  content-addressed. `meta` key `'0'` holds hex-encoded JSON with `agentId`,
  `latestRootBlobId`, `name`, `lastUsedModel`. The root blob is a protobuf
  whose repeated field 1 lists the conversation's message-blob hashes
  (32 bytes each) **in chronological order**; other fields (context stats,
  checkpoint hashes, workspace URI) are skipped.
- **Legacy message blobs:** JSON `{role, content}`. `content` is a string or an
  array of `{type: "text"|"redacted-reasoning"|"tool-call", …}` blocks.
  Real user prompts are wrapped in `<user_query>` tags; harness-injected
  turns (`<user_info>`, `<system_reminder>`, `<timestamp>`-only) carry no
  user_query and are skipped. `redacted-reasoning` is encrypted and never
  surfaced. Assistant blocks carry `providerOptions.cursor.modelName`.
- **Project linkage:** exact-workspace sessions match directly. A Cursor
  thread opened at a parent workspace is assigned to a child project only
  when a concrete tool/file record references a path inside that project;
  this prevents the same parent thread from leaking into sibling projects.
  Duplicate IDs present in more than one Cursor store collapse to one thread.

### What the adapter extracts

The same `ParsedSession` digest as the other adapters: start/end time (from
native metadata or transcript file times), model when recorded, real user
prompts, the final assistant text, files observed in tool calls (with
sensitive paths filtered), tool-use count, best-effort
active/waiting/completed/interrupted lifecycle state, and malformed-record
count. Explicit user-input tools are waiting; successful results are
completed; aborted/error results are interrupted. Git branch is not recorded
and stays null.

The root defaults to `~/.cursor` and can be overridden per project via a
`transcript_sources` entry of type `cursor`. With no override, RuntimeBrief also
auto-discovers Cursor's platform-specific desktop database location.

## Stubs (not implemented in v0.1)

- **OpenClawAdapter** (`openclaw`) — interface stub; `discover()` always
  returns false. TODO(v0.2).
