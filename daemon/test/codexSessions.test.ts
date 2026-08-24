import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  CodexSessionsAdapter,
  cwdMatchesProject,
  parseCodexSessionFile,
  sessionMatchesProject,
} from "../src/adapters/codexSessions.js";
import type { ProjectConfig } from "../src/types.js";
import { tmpdir } from "./helpers.js";

// Fixture records mirror the real Codex CLI 0.144.x rollout shape, verified
// against live rollouts on this machine (see docs/adapters.md).
const SID = "019f5040-030c-7402-b370-257644799b4b";
const CWD = "/Users/dev/sampletracker";

function line(type: string, payload: unknown, ts: string) {
  return JSON.stringify({ timestamp: ts, type, payload });
}

function sessionMeta(ts: string, cwd: string, id: string = SID) {
  return line(
    "session_meta",
    {
      session_id: id,
      id,
      timestamp: ts,
      cwd,
      originator: "codex_exec",
      cli_version: "0.144.1",
      source: "exec",
      model_provider: "openai",
      base_instructions: { text: "You are Codex, an agent based on GPT-5. …" },
    },
    ts,
  );
}

function buildFixtureRollout(): string {
  return [
    sessionMeta("2026-07-09T10:00:00.000Z", CWD),
    line(
      "event_msg",
      { type: "task_started", turn_id: "t-1", model_context_window: 353400 },
      "2026-07-09T10:00:00.100Z",
    ),
    // Developer/system context arrives as response_item messages — not prompts.
    line(
      "response_item",
      {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "<permissions instructions>…</permissions instructions>" }],
      },
      "2026-07-09T10:00:00.200Z",
    ),
    line(
      "turn_context",
      { turn_id: "t-1", cwd: CWD, model: "gpt-5.6-sol", approval_policy: "never" },
      "2026-07-09T10:00:00.300Z",
    ),
    // Harness-injected angle-bracket blocks are not user prompts.
    line(
      "event_msg",
      { type: "user_message", message: "<environment_context>injected</environment_context>" },
      "2026-07-09T10:00:00.400Z",
    ),
    line(
      "event_msg",
      { type: "user_message", message: "Add a shopping list feature to the sample tracker app" },
      "2026-07-09T10:00:01.000Z",
    ),
    line(
      "response_item",
      { type: "reasoning", id: "rs_1", summary: [], encrypted_content: "gAAAA…" },
      "2026-07-09T10:00:02.000Z",
    ),
    line(
      "event_msg",
      { type: "agent_message", message: "Inspecting the models first.", phase: "commentary" },
      "2026-07-09T10:00:03.000Z",
    ),
    line(
      "response_item",
      {
        type: "custom_tool_call",
        id: "ctc_1",
        call_id: "call_1",
        name: "exec",
        input: 'const r = await tools.exec_command({cmd:"ls"})',
      },
      "2026-07-09T10:00:04.000Z",
    ),
    line(
      "response_item",
      { type: "custom_tool_call_output", call_id: "call_1", output: [{ type: "input_text", text: "ok" }] },
      "2026-07-09T10:00:05.000Z",
    ),
    line(
      "response_item",
      { type: "function_call", name: "exec_command", arguments: '{"cmd":"npm test"}' },
      "2026-07-09T10:00:06.000Z",
    ),
    line(
      "event_msg",
      {
        type: "patch_apply_end",
        call_id: "exec-1",
        success: true,
        changes: {
          "/Users/dev/sampletracker/src/shopping.ts": { add: {} },
          "/Users/dev/sampletracker/.env": { add: {} },
        },
      },
      "2026-07-09T10:01:00.000Z",
    ),
    "{ this line is corrupted JSON !!!",
    line(
      "event_msg",
      { type: "user_message", message: "Now write tests for it" },
      "2026-07-09T10:02:00.000Z",
    ),
    line(
      "event_msg",
      {
        type: "user_message",
        message:
          "# Files mentioned by the user:\n\n<in-app-browser-context>ambient state</in-app-browser-context>\n\n" +
          "## My request for Codex:\nMake the redesign feel more complete",
      },
      "2026-07-09T10:02:30.000Z",
    ),
    line(
      "event_msg",
      {
        type: "agent_message",
        message: "Done. Shopping list feature implemented with tests; all 12 pass.",
        phase: "final_answer",
      },
      "2026-07-09T10:03:00.000Z",
    ),
    line("event_msg", { type: "token_count", info: {} }, "2026-07-09T10:03:00.100Z"),
    '{"timestamp":"2026-07-09T10:03:01.000Z","type":"event_msg","payload":{"type":"user_mess', // partial write
  ].join("\n");
}

describe("cwdMatchesProject", () => {
  it("matches the project path itself and subdirectories only", () => {
    expect(cwdMatchesProject("/Users/dev/sampletracker", "/Users/dev/sampletracker")).toBe(true);
    expect(cwdMatchesProject("/Users/dev/sampletracker/sub", "/Users/dev/sampletracker")).toBe(true);
    expect(cwdMatchesProject("/Users/dev/sampletracker2", "/Users/dev/sampletracker")).toBe(false);
    expect(cwdMatchesProject("/Users/dev", "/Users/dev/sampletracker")).toBe(false);
    expect(cwdMatchesProject(null, "/Users/dev/sampletracker")).toBe(false);
  });
});

describe("sessionMatchesProject", () => {
  let dir: string;
  beforeAll(() => {
    dir = tmpdir("codex-workspace-session");
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("matches a parent-workspace session only when it references the project path", async () => {
    const sampleSite = path.join(dir, "sampleSite.jsonl");
    fs.writeFileSync(
      sampleSite,
      [
        sessionMeta("2026-07-11T20:00:00.000Z", "/Users/dev"),
        line(
          "response_item",
          {
            type: "message",
            role: "developer",
            content: [{ type: "input_text", text: "Prior work: /Users/dev/sampletracker" }],
          },
          "2026-07-11T20:00:00.500Z",
        ),
        line(
          "event_msg",
          {
            type: "agent_message",
            message: "Redesigned /Users/dev/sample-site/app/page.tsx and verified the site.",
            phase: "final_answer",
          },
          "2026-07-11T20:05:00.000Z",
        ),
      ].join("\n"),
    );
    await expect(
      sessionMatchesProject(sampleSite, "/Users/dev", "/Users/dev/sample-site"),
    ).resolves.toBe(true);
    await expect(
      sessionMatchesProject(sampleSite, "/Users/dev", "/Users/dev/sampletracker"),
    ).resolves.toBe(false);
  });
});

describe("parseCodexSessionFile", () => {
  let file: string;
  beforeAll(() => {
    const dir = tmpdir("codex-jsonl");
    file = path.join(dir, `rollout-2026-07-09T10-00-00-${SID}.jsonl`);
    fs.writeFileSync(file, buildFixtureRollout());
  });
  afterAll(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  it("extracts session metadata, prompts, final text, files touched", async () => {
    const session = await parseCodexSessionFile(file);
    expect(session.sessionId).toBe(SID);
    expect(session.startedAt?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(session.endedAt?.toISOString()).toBe("2026-07-09T10:03:00.100Z");
    expect(session.model).toBe("gpt-5.6-sol");
    expect(session.userPrompts).toEqual([
      "Add a shopping list feature to the sample tracker app",
      "Now write tests for it",
      "Make the redesign feel more complete",
    ]);
    expect(session.finalAssistantText).toBe(
      "Done. Shopping list feature implemented with tests; all 12 pass.",
    );
    expect(session.toolUseCount).toBe(2);
    expect(session.malformedLines).toBe(2); // corrupted + truncated line
    expect(session.state).toBe("completed");
    expect(session.stateReason).toContain("final answer");
  });

  it("collects files from patches but filters sensitive paths", async () => {
    const session = await parseCodexSessionFile(file);
    expect(session.filesTouched).toContain("/Users/dev/sampletracker/src/shopping.ts");
    expect(session.filesTouched).not.toContain("/Users/dev/sampletracker/.env");
  });

  it("excludes harness-injected turns and developer context", async () => {
    const session = await parseCodexSessionFile(file);
    expect(session.userPrompts.join(" ")).not.toContain("environment_context");
    expect(session.userPrompts.join(" ")).not.toContain("permissions instructions");
  });

  it("falls back to the last commentary when no final_answer exists", async () => {
    const partial = path.join(path.dirname(file), `rollout-partial-${SID}.jsonl`);
    fs.writeFileSync(
      partial,
      [
        sessionMeta("2026-07-09T11:00:00.000Z", CWD),
        line(
          "event_msg",
          { type: "agent_message", message: "Still investigating the crash.", phase: "commentary" },
          "2026-07-09T11:01:00.000Z",
        ),
      ].join("\n"),
    );
    const session = await parseCodexSessionFile(partial);
    expect(session.finalAssistantText).toBe("Still investigating the crash.");
    expect(session.state).toBe("active");
  });

  it("uses newer commentary after an earlier final answer", async () => {
    const continued = path.join(path.dirname(file), `rollout-continued-${SID}.jsonl`);
    fs.writeFileSync(
      continued,
      [
        sessionMeta("2026-07-09T12:00:00.000Z", CWD),
        line(
          "event_msg",
          { type: "agent_message", message: "Initial task done.", phase: "final_answer" },
          "2026-07-09T12:01:00.000Z",
        ),
        line(
          "event_msg",
          { type: "user_message", message: "Now redesign the site" },
          "2026-07-09T12:02:00.000Z",
        ),
        line(
          "event_msg",
          { type: "agent_message", message: "The redesign is in progress.", phase: "commentary" },
          "2026-07-09T12:03:00.000Z",
        ),
      ].join("\n"),
    );
    const session = await parseCodexSessionFile(continued);
    expect(session.finalAssistantText).toBe("The redesign is in progress.");
    expect(session.state).toBe("active");
  });

  it("marks a pending request_user_input call as waiting", async () => {
    const waiting = path.join(path.dirname(file), `rollout-waiting-${SID}.jsonl`);
    fs.writeFileSync(
      waiting,
      [
        sessionMeta("2026-07-09T13:00:00.000Z", CWD),
        line(
          "response_item",
          {
            type: "function_call",
            name: "request_user_input",
            call_id: "call-input",
            arguments: '{"questions":[]}',
          },
          "2026-07-09T13:01:00.000Z",
        ),
      ].join("\n"),
    );
    const session = await parseCodexSessionFile(waiting);
    expect(session.state).toBe("waiting");
    expect(session.stateReason).toContain("requested user input");
  });

  it("keeps a user-stopped input request interrupted rather than waiting", async () => {
    const stopped = path.join(path.dirname(file), `rollout-stopped-${SID}.jsonl`);
    fs.writeFileSync(
      stopped,
      [
        sessionMeta("2026-07-09T14:00:00.000Z", CWD),
        line(
          "response_item",
          {
            type: "function_call",
            name: "request_user_input",
            call_id: "call-input",
            arguments: '{"questions":[]}',
          },
          "2026-07-09T14:01:00.000Z",
        ),
        line(
          "response_item",
          {
            type: "function_call_output",
            call_id: "call-input",
            output: "aborted by user after 12.0s",
          },
          "2026-07-09T14:01:12.000Z",
        ),
        line(
          "event_msg",
          { type: "turn_aborted", reason: "interrupted" },
          "2026-07-09T14:01:12.100Z",
        ),
      ].join("\n"),
    );
    const session = await parseCodexSessionFile(stopped);
    expect(session.state).toBe("interrupted");
    expect(session.stateReason).not.toContain("requested user input");
  });

  it("returns to active after requested input is received", async () => {
    const answered = path.join(path.dirname(file), `rollout-answered-${SID}.jsonl`);
    fs.writeFileSync(
      answered,
      [
        sessionMeta("2026-07-09T15:00:00.000Z", CWD),
        line(
          "response_item",
          {
            type: "function_call",
            name: "request_user_input",
            call_id: "call-input",
            arguments: '{"questions":[]}',
          },
          "2026-07-09T15:01:00.000Z",
        ),
        line(
          "response_item",
          {
            type: "function_call_output",
            call_id: "call-input",
            output: '{"choice":"Continue"}',
          },
          "2026-07-09T15:02:00.000Z",
        ),
      ].join("\n"),
    );
    const session = await parseCodexSessionFile(answered);
    expect(session.state).toBe("active");
    expect(session.stateReason).toContain("received");
  });

  it("returns an empty session for a missing file", async () => {
    const session = await parseCodexSessionFile("/nonexistent/rollout.jsonl");
    expect(session.userPrompts).toEqual([]);
    expect(session.sessionId).toBeNull();
  });
});

describe("CodexSessionsAdapter", () => {
  let root: string;
  let project: ProjectConfig;
  let adapter: CodexSessionsAdapter;
  const OLD = "019d591f-0cbd-7742-914a-40bc152eba21";

  beforeAll(() => {
    root = tmpdir("codex-root");
    const dayDir = path.join(root, "sessions", "2026", "07", "09");
    fs.mkdirSync(dayDir, { recursive: true });
    fs.writeFileSync(
      path.join(dayDir, `rollout-2026-07-09T10-00-00-${SID}.jsonl`),
      buildFixtureRollout(),
    );
    // An older session in another day dir.
    const oldDir = path.join(root, "sessions", "2026", "07", "01");
    fs.mkdirSync(oldDir, { recursive: true });
    const oldFile = path.join(oldDir, `rollout-2026-07-01T09-00-00-${OLD}.jsonl`);
    fs.writeFileSync(
      oldFile,
      [
        sessionMeta("2026-07-01T09:00:00.000Z", CWD, OLD),
        line("event_msg", { type: "user_message", message: "Fix the login bug" }, "2026-07-01T09:00:01.000Z"),
        line(
          "event_msg",
          { type: "agent_message", message: "Fixed.", phase: "final_answer" },
          "2026-07-01T09:05:00.000Z",
        ),
      ].join("\n"),
    );
    const past = new Date("2026-07-01T10:00:00.000Z");
    fs.utimesSync(oldFile, past, past);
    // A rollout for a different project must never match.
    fs.writeFileSync(
      path.join(dayDir, "rollout-2026-07-09T12-00-00-019f0000-0000-7000-8000-000000000000.jsonl"),
      sessionMeta("2026-07-09T12:00:00.000Z", "/Users/dev/other-project", "019f0000-0000-7000-8000-000000000000"),
    );
    project = { id: "meal", name: "Sample Tracker App", path: CWD };
    adapter = new CodexSessionsAdapter(root);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("discovers projects with matching rollouts by session cwd", async () => {
    expect(await adapter.discover(project)).toBe(true);
    expect(
      await adapter.discover({ id: "x", name: "X", path: "/no/rollouts/here" }),
    ).toBe(false);
  });

  it("respects explicit transcript_sources exclusion", async () => {
    const excluded = { ...project, transcript_sources: [{ type: "claude-code" }] };
    expect(
      await adapter.discover(excluded),
    ).toBe(false);
    expect(await adapter.transcriptPaths(excluded, 10)).toEqual([]);
    expect(
      await adapter.discover({ ...project, transcript_sources: [{ type: "codex" }] }),
    ).toBe(true);
  });

  it("lists transcripts newest-first with metadata and summaries", async () => {
    const refs = await adapter.transcriptPaths(project, 10);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.id).toBe(SID);
    expect(refs[0]!.summary).toContain("shopping list");
    expect(refs[0]!.startedAt).toBeInstanceOf(Date);
    const limited = await adapter.transcriptPaths(project, 1);
    expect(limited).toHaveLength(1);
  });

  it("reports sessions as recent activity, filtered by since", async () => {
    const all = await adapter.recentActivity(project, new Date("2026-06-01T00:00:00Z"));
    expect(all).toHaveLength(2);
    const recent = await adapter.recentActivity(project, new Date("2026-07-05T00:00:00Z"));
    expect(recent).toHaveLength(1);
    expect(recent[0]!.kind).toBe("session");
  });
});
