import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  ClaudeCodeSessionsAdapter,
  encodeProjectPath,
  isLegacyAnalystSession,
  parseClaudeSessionFile,
} from "../src/adapters/claudeCodeSessions.js";
import type { ProjectConfig } from "../src/types.js";
import { tmpdir } from "./helpers.js";

// Fixture records mirror the real Claude Code 2.1.x JSONL shape, verified
// against a live transcript on this machine (see docs/adapters.md).
const SID = "11111111-2222-3333-4444-555555555555";

function userLine(text: string, ts: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content: text },
    uuid: "u-" + ts,
    timestamp: ts,
    cwd: "/Users/dev/sampletracker",
    sessionId: SID,
    version: "2.1.206",
    gitBranch: "feature/shopping-list",
    ...extra,
  });
}

function assistantLine(
  blocks: unknown[],
  ts: string,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    parentUuid: "u-x",
    isSidechain: false,
    type: "assistant",
    message: {
      model: "claude-sonnet-4-6",
      id: "msg_" + ts,
      type: "message",
      role: "assistant",
      content: blocks,
      stop_reason: null,
      usage: { input_tokens: 10, output_tokens: 20 },
    },
    uuid: "a-" + ts,
    timestamp: ts,
    cwd: "/Users/dev/sampletracker",
    sessionId: SID,
    version: "2.1.206",
    gitBranch: "feature/shopping-list",
    ...extra,
  });
}

function buildFixtureTranscript(): string {
  return [
    JSON.stringify({
      type: "queue-operation",
      operation: "enqueue",
      timestamp: "2026-07-09T10:00:00.000Z",
      sessionId: SID,
      content: "Add a shopping list feature",
    }),
    userLine("Add a shopping list feature to the sample tracker app", "2026-07-09T10:00:01.000Z"),
    JSON.stringify({
      type: "attachment",
      attachment: { type: "diagnostics" },
      uuid: "att-1",
      timestamp: "2026-07-09T10:00:01.500Z",
      sessionId: SID,
    }),
    assistantLine(
      [
        { type: "thinking", thinking: "internal reasoning", signature: "xxx" },
        { type: "text", text: "I'll start by reading the models." },
        { type: "tool_use", id: "t1", name: "Read", input: { file_path: "/Users/dev/sampletracker/src/models.ts" } },
      ],
      "2026-07-09T10:00:05.000Z",
    ),
    // tool_result comes back as a user line with block content — not a prompt.
    JSON.stringify({
      parentUuid: "a-1",
      isSidechain: false,
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "file contents here" }],
      },
      uuid: "u-tr1",
      timestamp: "2026-07-09T10:00:06.000Z",
      sessionId: SID,
    }),
    // Sidechain (subagent) lines must not pollute prompts/final text.
    userLine("You are a subagent. Search for TODOs.", "2026-07-09T10:00:07.000Z", {
      isSidechain: true,
    }),
    assistantLine(
      [{ type: "text", text: "Subagent result: 3 TODOs found." }],
      "2026-07-09T10:00:08.000Z",
      { isSidechain: true },
    ),
    // Synthetic harness turns are not user prompts.
    userLine("<system-reminder>Some injected reminder</system-reminder>", "2026-07-09T10:00:09.000Z"),
    assistantLine(
      [
        { type: "tool_use", id: "t2", name: "Edit", input: { file_path: "/Users/dev/sampletracker/src/shopping.ts", old_string: "a", new_string: "b" } },
        { type: "tool_use", id: "t3", name: "Read", input: { file_path: "/Users/dev/sampletracker/.env" } },
      ],
      "2026-07-09T10:01:00.000Z",
    ),
    "{ this line is corrupted JSON !!!",
    userLine("Now write tests for it", "2026-07-09T10:02:00.000Z"),
    assistantLine(
      [{ type: "text", text: "Done. Shopping list feature implemented with tests; all 12 pass." }],
      "2026-07-09T10:03:00.000Z",
    ),
    JSON.stringify({ type: "last-prompt", lastPrompt: "Now write tests for it", leafUuid: "x", sessionId: SID }),
    '{"type":"user","message":{"role":"user","content":"truncated mid-wri', // partial write
  ].join("\n");
}

describe("encodeProjectPath", () => {
  it("replaces every non-alphanumeric character with '-'", () => {
    // Verified live: /home/user/RuntimeBrief → -home-user-RuntimeBrief
    expect(encodeProjectPath("/home/user/RuntimeBrief")).toBe("-home-user-RuntimeBrief");
    expect(encodeProjectPath("/Users/developer/projects/sample_tracker.dev")).toBe(
      "-Users-developer-projects-sample-tracker-dev",
    );
  });
});

describe("parseClaudeSessionFile", () => {
  let file: string;
  beforeAll(() => {
    const dir = tmpdir("jsonl");
    file = path.join(dir, `${SID}.jsonl`);
    fs.writeFileSync(file, buildFixtureTranscript());
  });
  afterAll(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));

  it("extracts session metadata, prompts, final text, files touched", async () => {
    const session = await parseClaudeSessionFile(file);
    expect(session.sessionId).toBe(SID);
    expect(session.startedAt?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(session.endedAt?.toISOString()).toBe("2026-07-09T10:03:00.000Z");
    expect(session.gitBranch).toBe("feature/shopping-list");
    expect(session.model).toBe("claude-sonnet-4-6");
    expect(session.userPrompts).toEqual([
      "Add a shopping list feature to the sample tracker app",
      "Now write tests for it",
    ]);
    expect(session.finalAssistantText).toBe(
      "Done. Shopping list feature implemented with tests; all 12 pass.",
    );
    expect(session.toolUseCount).toBe(3);
    expect(session.malformedLines).toBe(2); // corrupted + truncated line
    expect(session.state).toBe("completed");
    expect(session.stateReason).toContain("concluding response");
  });

  it("collects files touched but filters sensitive paths", async () => {
    const session = await parseClaudeSessionFile(file);
    expect(session.filesTouched).toContain("/Users/dev/sampletracker/src/models.ts");
    expect(session.filesTouched).toContain("/Users/dev/sampletracker/src/shopping.ts");
    expect(session.filesTouched).not.toContain("/Users/dev/sampletracker/.env");
  });

  it("excludes sidechain content and synthetic turns", async () => {
    const session = await parseClaudeSessionFile(file);
    expect(session.userPrompts.join(" ")).not.toContain("subagent");
    expect(session.finalAssistantText).not.toContain("Subagent result");
    expect(session.userPrompts.join(" ")).not.toContain("system-reminder");
  });

  it("keeps a text-plus-tool assistant turn active", async () => {
    const partial = path.join(path.dirname(file), `${SID}-active.jsonl`);
    fs.writeFileSync(
      partial,
      [
        userLine("Investigate the failure", "2026-07-09T11:00:00.000Z"),
        assistantLine(
          [
            { type: "text", text: "I found the likely cause; checking it now." },
            {
              type: "tool_use",
              id: "active-tool",
              name: "Read",
              input: { file_path: "/Users/dev/sampletracker/src/models.ts" },
            },
          ],
          "2026-07-09T11:01:00.000Z",
        ),
      ].join("\n"),
    );
    const session = await parseClaudeSessionFile(partial);
    expect(session.state).toBe("active");
    expect(session.stateReason).toContain("tool activity");
  });

  it("marks AskUserQuestion as waiting until its tool result arrives", async () => {
    const waiting = path.join(path.dirname(file), `${SID}-waiting.jsonl`);
    const question = assistantLine(
      [
        {
          type: "tool_use",
          id: "question-tool",
          name: "AskUserQuestion",
          input: { questions: [{ question: "Which option?" }] },
        },
      ],
      "2026-07-09T12:01:00.000Z",
    );
    fs.writeFileSync(
      waiting,
      [
        userLine("Choose an approach", "2026-07-09T12:00:00.000Z"),
        question,
      ].join("\n"),
    );
    expect((await parseClaudeSessionFile(waiting)).state).toBe("waiting");

    fs.appendFileSync(
      waiting,
      "\n" +
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: "question-tool",
                content: "Use option A",
              },
            ],
          },
          timestamp: "2026-07-09T12:02:00.000Z",
          sessionId: SID,
        }),
    );
    const answered = await parseClaudeSessionFile(waiting);
    expect(answered.state).toBe("active");
    expect(answered.stateReason).toContain("received");
  });

  it("returns an empty session for a missing file", async () => {
    const session = await parseClaudeSessionFile("/nonexistent/file.jsonl");
    expect(session.userPrompts).toEqual([]);
    expect(session.sessionId).toBeNull();
  });
});

describe("isLegacyAnalystSession", () => {
  it("recognizes the legacy structured analysis prompt without hiding real tasks", () => {
    const base = {
      sessionId: "analysis",
      startedAt: null,
      endedAt: null,
      gitBranch: null,
      model: null,
      finalAssistantText: null,
      filesTouched: [],
      toolUseCount: 0,
      malformedLines: 0,
      state: "unknown" as const,
      stateReason: "No lifecycle event was found.",
    };
    const instruction =
      "You may also inspect the repository directly with the Read, Grep and Glob tools if the summaries above are insufficient.";
    expect(
      isLegacyAnalystSession({
        ...base,
        userPrompts: [
          'Question about the project "Sample Tracker App": What changed?\n\n' +
            "## Git state\n\nBranch: main\n\n" +
            "## Recent agent sessions\n\n(none found)\n\n" +
            instruction,
        ],
      }),
    ).toBe(true);
    expect(
      isLegacyAnalystSession({ ...base, userPrompts: ["Fix the login bug"] }),
    ).toBe(false);
  });
});

describe("ClaudeCodeSessionsAdapter", () => {
  let root: string;
  let projectDir: string;
  let project: ProjectConfig;
  let adapter: ClaudeCodeSessionsAdapter;

  beforeAll(() => {
    root = tmpdir("claude-root");
    projectDir = "/Users/dev/sampletracker";
    const sessionsDir = path.join(root, "projects", encodeProjectPath(projectDir));
    fs.mkdirSync(sessionsDir, { recursive: true });
    fs.writeFileSync(path.join(sessionsDir, `${SID}.jsonl`), buildFixtureTranscript());
    // A newer historical analyst-generated session must be hidden and must not use
    // up the caller's transcript limit.
    const ANALYSIS = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const analysisPrompt =
      'Question about the project "Sample Tracker App": What changed?\n\n' +
      "## Git state\n\nBranch: main\n\n" +
      "## Recent agent sessions\n\n(none found)\n\n" +
      "You may also inspect the repository directly with the Read, Grep and Glob tools if the summaries above are insufficient.";
    const analysisFile = path.join(sessionsDir, `${ANALYSIS}.jsonl`);
    fs.writeFileSync(
      analysisFile,
      userLine(analysisPrompt, "2026-07-10T09:00:00.000Z").replace(SID, ANALYSIS),
    );
    fs.utimesSync(analysisFile, new Date("2026-07-10T09:00:00.000Z"), new Date("2026-07-10T09:00:00.000Z"));
    // A second, older session.
    const OLD = "99999999-8888-7777-6666-555555555555";
    fs.writeFileSync(
      path.join(sessionsDir, `${OLD}.jsonl`),
      [
        userLine("Fix the login bug", "2026-07-01T09:00:00.000Z").replace(SID, OLD),
        assistantLine([{ type: "text", text: "Fixed." }], "2026-07-01T09:05:00.000Z").replace(SID, OLD),
      ].join("\n"),
    );
    const past = new Date("2026-07-01T10:00:00.000Z");
    fs.utimesSync(path.join(sessionsDir, `${OLD}.jsonl`), past, past);
    // Non-transcript sidecar files must be ignored.
    fs.writeFileSync(path.join(sessionsDir, `${SID}.ccr-tip.json`), "{}");
    project = { id: "meal", name: "Sample Tracker App", path: projectDir };
    adapter = new ClaudeCodeSessionsAdapter(root);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("discovers projects with transcripts", async () => {
    expect(await adapter.discover(project)).toBe(true);
    expect(
      await adapter.discover({ id: "x", name: "X", path: "/no/transcripts/here" }),
    ).toBe(false);
  });

  it("respects explicit transcript_sources exclusion", async () => {
    const excluded = { ...project, transcript_sources: [{ type: "other" }] };
    expect(
      await adapter.discover(excluded),
    ).toBe(false);
    expect(await adapter.transcriptPaths(excluded, 10)).toEqual([]);
    expect(
      await adapter.discover({ ...project, transcript_sources: [{ type: "claude-code" }] }),
    ).toBe(true);
  });

  it("lists transcripts newest-first with metadata and summaries", async () => {
    const refs = await adapter.transcriptPaths(project, 10);
    expect(refs).toHaveLength(2);
    expect(refs[0]!.id).toBe(SID);
    expect(refs[0]!.summary).toBe("Now write tests for it");
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
