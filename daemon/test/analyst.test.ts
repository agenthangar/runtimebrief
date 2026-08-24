import { afterEach, beforeEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { AnswerCache } from "../src/analyst/cache.js";
import {
  ANALYST_SYSTEM_PROMPT,
  buildAnalystEvidence,
  buildAnalystPrompt,
  DEFAULT_STATUS_QUESTION,
  digestSession,
} from "../src/analyst/prompts.js";
import {
  type AnalystBackendEvent,
  type AnalystBackendRunner,
} from "../src/analyst/codexCli.js";
import {
  ANALYST_CACHE_BACKEND,
  ANALYST_CACHE_PROMPT_VERSION,
  createAnalystService,
  enforceEvidenceCitations,
  ProjectNotFoundError,
  selectTranscripts,
  type AnalystChunk,
} from "../src/analyst/service.js";
import type { RuntimeAdapter, TranscriptRef } from "../src/types.js";
import type { ParsedSession } from "../src/adapters/claudeCodeSessions.js";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { makeFixtureRepo, testConfig, tmpdir } from "./helpers.js";

function makeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "s1",
    startedAt: new Date("2026-07-09T10:00:00Z"),
    endedAt: new Date("2026-07-09T11:00:00Z"),
    gitBranch: "main",
    model: "claude-sonnet-4-6",
    userPrompts: ["Build the shopping list"],
    finalAssistantText: "Implemented and tested.",
    filesTouched: ["src/shopping.ts"],
    toolUseCount: 4,
    malformedLines: 0,
    state: "completed",
    stateReason: "The agent produced a concluding response.",
    ...overrides,
  };
}

describe("prompt assembly", () => {
  it("system prompt covers Siri delivery and secret files", () => {
    expect(ANALYST_SYSTEM_PROMPT).toContain("project-state analyst");
    expect(ANALYST_SYSTEM_PROMPT).toContain("no markdown");
    expect(ANALYST_SYSTEM_PROMPT).toContain("no more than 60 words");
    expect(ANALYST_SYSTEM_PROMPT).toContain("Done:");
    expect(ANALYST_SYSTEM_PROMPT).toContain("trust git");
    expect(ANALYST_SYSTEM_PROMPT).toContain("Every factual sentence");
    expect(ANALYST_SYSTEM_PROMPT).toContain("evidence IDs");
    expect(ANALYST_SYSTEM_PROMPT).toContain(".env*");
    expect(ANALYST_SYSTEM_PROMPT).toContain("id_rsa*");
    expect(ANALYST_SYSTEM_PROMPT).toContain("*.p8");
  });

  it("includes question, git state and transcript digests", () => {
    const prompt = buildAnalystPrompt(
      "What broke?",
      "Sample Tracker App",
      {
        branch: "feature/x",
        dirty: true,
        dirtyFileCount: 2,
        commits: [
          { hash: "a".repeat(40), author: "Dev", timestamp: "2026-07-09T10:00:00Z", message: "fix parser" },
        ],
        diffstatVsDefault: "3 files changed, 40 insertions(+)",
        defaultBranch: "main",
        todoCount: 2,
        fixmeCount: 1,
        recentlyModifiedFiles: [{ path: "src/a.ts", modifiedAt: "2026-07-09T10:00:00Z" }],
        lastCommitAt: "2026-07-09T10:00:00Z",
      },
      [{ ref: { id: "s1", source: "claude-code" }, session: makeSession() }],
    );
    expect(prompt).toContain('Question: "What broke?"');
    expect(prompt).toContain('Project: "Sample Tracker App"');
    expect(prompt).toContain("Branch: feature/x (default: main)");
    expect(prompt).toContain("dirty (2 files)");
    expect(prompt).toContain("fix parser");
    expect(prompt).toContain("claude-code session s1");
    expect(prompt).toContain("[git-working-tree]");
    expect(prompt).toContain("[session-claude-code-s1]");
    expect(prompt).toContain("Build the shopping list");
    expect(prompt).toContain("Implemented and tested.");
  });

  it("includes Xcode, TestFlight, and App Store evidence for iOS questions", () => {
    const release = {
      xcode: {
        source: "xcodegen" as const,
        projectFile: "project.yml",
        scheme: "Example",
        bundleId: "com.example.app",
        marketingVersion: "1.4.0",
        buildNumber: "42",
      },
      appStoreConnect: {
        status: "available" as const,
        checkedAt: "2026-07-31T10:00:00Z",
        message: null,
        appId: "123",
        latestTestFlightBuild: {
          id: "build-42",
          marketingVersion: "1.4.0",
          buildNumber: "42",
          uploadedAt: "2026-07-30T10:00:00Z",
          expiresAt: null,
          expired: false,
          processingState: "VALID",
          audienceType: "APP_STORE_ELIGIBLE",
        },
        appStoreVersion: {
          id: "store-1.4",
          version: "1.4.0",
          buildNumber: "42",
          state: "WAITING_FOR_REVIEW",
          createdAt: "2026-07-30T12:00:00Z",
        },
      },
    };
    const prompt = buildAnalystPrompt("What is in TestFlight?", "Example", null, [], release);
    expect(prompt).toContain("Latest TestFlight build: 1.4.0 (42) · VALID");
    expect(prompt).toContain("App Store version: 1.4.0 (42) · WAITING_FOR_REVIEW");
    expect(prompt).toContain("[testflight-build-build-42]");
    const evidence = buildAnalystEvidence(null, [], new Date("2026-07-31T10:00:00Z"), release);
    expect(evidence.map((item) => item.kind)).toEqual([
      "xcode-project",
      "testflight-build",
      "app-store-version",
    ]);
  });

  it("stays within the context budget with huge transcripts", () => {
    const huge = makeSession({
      finalAssistantText: "x".repeat(300_000),
      userPrompts: Array.from({ length: 50 }, (_, i) => `prompt ${i} ` + "y".repeat(2000)),
    });
    const digest = digestSession({ ref: { id: "s1", source: "claude-code" }, session: huge });
    expect(digest.length).toBeLessThan(10_000);
    const prompt = buildAnalystPrompt("status?", "P", null, [
      { ref: { id: "s1", source: "claude-code" }, session: huge },
      { ref: { id: "s2", source: "claude-code" }, session: huge },
    ]);
    expect(prompt.length).toBeLessThan(210_000);
  });

  it("tail-truncation keeps the end of the final assistant text", () => {
    const session = makeSession({
      finalAssistantText: "EARLY. " + "z".repeat(10_000) + " THE-CONCLUSION",
    });
    const digest = digestSession({ ref: { id: "s1", source: "claude-code" }, session });
    expect(digest).toContain("THE-CONCLUSION");
    expect(digest).not.toContain("EARLY.");
  });
});

describe("AnswerCache", () => {
  let dir: string;
  let cache: AnswerCache;
  const identity = (overrides: Partial<{
    backend: string;
    model: string;
    promptVersion: string;
    evidenceHash: string;
  }> = {}) => ({
    backend: ANALYST_CACHE_BACKEND,
    model: "gpt-5.6-sol",
    promptVersion: ANALYST_CACHE_PROMPT_VERSION,
    evidenceHash: AnswerCache.evidenceHash("fixture evidence"),
    ...overrides,
  });
  beforeEach(() => {
    dir = tmpdir("cache");
    cache = new AnswerCache(path.join(dir, "cache.db"));
  });
  afterEach(() => {
    cache.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("stores and retrieves within TTL", () => {
    cache.set("p1", "status?", identity(), "All good.", [
      {
        id: "git-working-tree",
        kind: "working-tree",
        label: "Working tree",
        detail: "Clean",
      },
    ]);
    const hit = cache.get("p1", "status?", identity(), 10);
    expect(hit?.answer).toBe("All good.");
    expect(hit?.evidence[0]?.id).toBe("git-working-tree");
  });

  it("normalizes questions for the key", () => {
    cache.set("p1", "  What's   THE Status? ", identity(), "Fine.");
    expect(cache.get("p1", "what's the status?", identity(), 10)?.answer).toBe("Fine.");
  });

  it("misses across projects, backend identities, evidence, and after TTL", () => {
    cache.set("p1", "q", identity(), "a");
    expect(cache.get("p2", "q", identity(), 10)).toBeNull();
    expect(cache.get("p1", "q", identity({ backend: "different-backend" }), 10)).toBeNull();
    expect(cache.get("p1", "q", identity({ model: "different-model" }), 10)).toBeNull();
    expect(cache.get("p1", "q", identity({ promptVersion: "different-prompt" }), 10)).toBeNull();
    expect(cache.get("p1", "q", identity({ evidenceHash: "different-evidence" }), 10)).toBeNull();
    expect(cache.get("p1", "q", identity(), 0)).toBeNull(); // ttl 0 disables caching
  });

  it("hardens a restored data directory and live SQLite WAL/SHM files", () => {
    const dbPath = path.join(dir, "cache.db");
    cache.set("fixture", "status?", identity(), "Ready. [git-working-tree]");
    const databaseFiles = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
    for (const file of databaseFiles) {
      expect(fs.existsSync(file), `${path.basename(file)} should exist while SQLite is open`).toBe(true);
    }
    fs.chmodSync(dir, 0o755);
    for (const file of databaseFiles) {
      fs.chmodSync(file, 0o644);
    }
    const secondConnection = new AnswerCache(dbPath);
    try {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      for (const file of databaseFiles) {
        expect(fs.existsSync(file), `${path.basename(file)} should remain live`).toBe(true);
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
      }
    } finally {
      secondConnection.close();
    }
  });

  it("migrates away the legacy dollar-cost column", () => {
    cache.close();
    const dbPath = path.join(dir, "legacy-cache.db");
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE answers (
        project_id TEXT NOT NULL,
        question_hash TEXT NOT NULL,
        answer TEXT NOT NULL,
        cost_usd REAL NOT NULL,
        evidence_json TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        PRIMARY KEY (project_id, question_hash)
      )
    `);
    legacy.close();

    cache = new AnswerCache(dbPath);
    const inspection = new Database(dbPath, { readonly: true });
    try {
      const columns = inspection.pragma("table_info(answers)") as { name: string }[];
      expect(columns.map((column) => column.name)).not.toContain("cost_usd");
    } finally {
      inspection.close();
    }
  });

  it("rejects symbolic links for the database and its sidecars", () => {
    const isolated = tmpdir("cache-symlink");
    const outside = path.join(isolated, "outside.db");
    const linkedDatabase = path.join(isolated, "linked.db");
    fs.writeFileSync(outside, "outside");
    fs.symlinkSync(outside, linkedDatabase);
    try {
      expect(() => new AnswerCache(linkedDatabase)).toThrow(/not a regular file/);

      const regularDatabase = path.join(isolated, "regular.db");
      const seed = new AnswerCache(regularDatabase);
      seed.close();
      fs.symlinkSync(outside, `${regularDatabase}-wal`);
      expect(() => new AnswerCache(regularDatabase)).toThrow(/sidecar.*not a regular file/i);
    } finally {
      fs.rmSync(isolated, { recursive: true, force: true });
    }
  });
});

describe("analyst service (mocked Codex CLI backend)", () => {
  let dir: string;
  let repo: string;
  let cache: AnswerCache;
  let project: { id: string; name: string; path: string };

  beforeEach(() => {
    dir = tmpdir("svc");
    repo = makeFixtureRepo();
    project = { id: "demo", name: "Demo", path: repo };
    cache = new AnswerCache(path.join(dir, "cache.db"));
  });
  afterEach(() => {
    cache.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(repo, { recursive: true, force: true });
  });

  function service(runner: AnalystBackendRunner, requestTimeoutMs?: number) {
    const config = testConfig({ projects: [project] });
    return createAnalystService(config, [new FilesystemGitAdapter()], {
      runner,
      cache,
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    });
  }

  async function collect(gen: AsyncGenerator<AnalystChunk>) {
    const chunks: AnalystChunk[] = [];
    for await (const c of gen) chunks.push(c);
    return chunks;
  }

  it("validates and enforces evidence before finishing with done metadata", async () => {
    const runner: AnalystBackendRunner = async function* () {
      yield {
        type: "usage",
        costUsd: 0,
        inputTokens: 1_000,
        outputTokens: 100,
        cachedInputTokens: 0,
      } satisfies AnalystBackendEvent;
      yield {
        type: "result",
        costUsd: 0,
        finalText: "The project is on track. [git-working-tree]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const chunks = await collect(service(runner).ask("demo", "How is it going?"));
    const texts = chunks.filter((c) => c.type === "text");
    expect(texts).toEqual([
      { type: "text", text: "The project is on track. [git-working-tree]" },
    ]);
    const done = chunks.at(-1);
    expect(done).toMatchObject({
      type: "done",
      answer: "The project is on track. [git-working-tree]",
      costUsd: 0,
      cached: false,
      truncated: false,
    });
  });

  it("includes modern Cursor JSONL details in the analyst prompt", async () => {
    const transcriptPath = path.join(dir, "fictional-cursor-session.jsonl");
    const touchedFile = "/Users/developer/projects/sample-app/src/offline-sync.ts";
    fs.writeFileSync(
      transcriptPath,
      [
        {
          role: "user",
          message: {
            content: [
              {
                type: "text",
                text: "<user_query>Implement fictional offline sync</user_query>",
              },
            ],
          },
        },
        {
          role: "assistant",
          message: {
            content: [
              {
                type: "tool_use",
                name: "Read",
                input: { path: touchedFile },
              },
              {
                type: "text",
                text: "Fictional offline sync is implemented and verified.",
              },
            ],
          },
        },
        { type: "turn_ended", status: "success" },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const cursorAdapter: RuntimeAdapter = {
      id: "cursor",
      discover: async () => true,
      recentActivity: async () => [],
      transcriptPaths: async () => [
        {
          source: "cursor",
          id: "fictional-cursor-session",
          path: transcriptPath,
          endedAt: new Date("2026-08-20T12:00:00Z"),
        },
      ],
    };
    let capturedPrompt = "";
    const runner: AnalystBackendRunner = async function* (params) {
      capturedPrompt = params.evidencePacket;
      yield {
        type: "result",
        costUsd: 0,
        finalText: "Cursor evidence captured. [session-cursor-fictional-cursor-session]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const config = testConfig({ projects: [project] });
    const svc = createAnalystService(config, [cursorAdapter], { runner, cache });

    await collect(svc.ask("demo", "What did Cursor finish?"));

    expect(capturedPrompt).toContain("cursor session fictional-cursor-session");
    expect(capturedPrompt).toContain("Implement fictional offline sync");
    expect(capturedPrompt).toContain("Fictional offline sync is implemented and verified.");
    expect(capturedPrompt).toContain(touchedFile);
  });

  it("includes metadata-only Claude Desktop sessions without treating titles as prompts", async () => {
    const metadataPath = path.join(dir, "fictional-claude-desktop.json");
    fs.writeFileSync(
      metadataPath,
      JSON.stringify({
        sessionId: "desktop-catalog-id",
        cliSessionId: "fictional-claude-session",
        cwd: project.path,
        originCwd: project.path,
        title: "Review the fictional desktop release",
        model: "claude-fable-5",
        createdAt: Date.parse("2026-08-20T11:00:00Z"),
        lastActivityAt: Date.parse("2026-08-20T12:00:00Z"),
        completedTurns: 1,
      }),
    );
    const claudeAdapter: RuntimeAdapter = {
      id: "claude-code",
      discover: async () => true,
      recentActivity: async () => [],
      transcriptPaths: async () => [
        {
          source: "claude-code",
          id: "fictional-claude-session",
          path: metadataPath,
          endedAt: new Date("2026-08-20T12:00:00Z"),
          summary: "Review the fictional desktop release",
        },
      ],
    };
    let capturedPrompt = "";
    const runner: AnalystBackendRunner = async function* (params) {
      capturedPrompt = params.evidencePacket;
      yield {
        type: "result",
        costUsd: 0,
        finalText:
          "Claude Desktop evidence captured. [session-claude-code-fictional-claude-session]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const config = testConfig({ projects: [project] });
    const svc = createAnalystService(config, [claudeAdapter], { runner, cache });

    await collect(svc.ask("demo", "What did Claude Desktop work on?"));

    expect(capturedPrompt).toContain("claude-code session fictional-claude-session");
    expect(capturedPrompt).toContain("Session title: Review the fictional desktop release");
    expect(capturedPrompt).not.toContain("Recent user requests:");
  });

  it("keeps joined Claude Desktop lifecycle metadata when reparsing its transcript", async () => {
    const transcriptPath = path.join(dir, "joined-claude-session.jsonl");
    fs.writeFileSync(
      transcriptPath,
      [
        {
          type: "user",
          timestamp: "2026-08-20T11:00:00Z",
          sessionId: "joined-claude-session",
          cwd: project.path,
          origin: { kind: "human" },
          message: { role: "user", content: "Check the fictional desktop flow" },
        },
        {
          type: "assistant",
          timestamp: "2026-08-20T11:05:00Z",
          message: {
            role: "assistant",
            model: "claude-test-1",
            content: [{ type: "text", text: "An obsolete success report." }],
          },
        },
      ]
        .map((record) => JSON.stringify(record))
        .join("\n") + "\n",
    );
    const claudeAdapter: RuntimeAdapter = {
      id: "claude-code",
      discover: async () => true,
      recentActivity: async () => [],
      transcriptPaths: async () => [
        {
          source: "claude-code",
          id: "joined-claude-session",
          path: transcriptPath,
          startedAt: new Date("2026-08-20T10:55:00Z"),
          endedAt: new Date("2026-08-20T12:00:00Z"),
          state: "interrupted",
          stateReason: "Claude Desktop recorded an API error.",
          title: "Fictional joined desktop task",
          model: "claude-test-1",
          summary: "Check the fictional desktop flow",
        },
      ],
    };
    let capturedPrompt = "";
    const runner: AnalystBackendRunner = async function* (params) {
      capturedPrompt = params.evidencePacket;
      yield {
        type: "result",
        costUsd: 0,
        finalText: "Joined evidence captured. [session-claude-code-joined-claude-session]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const config = testConfig({ projects: [project] });
    const svc = createAnalystService(config, [claudeAdapter], { runner, cache });

    await collect(svc.ask("demo", "What happened to the desktop task?"));

    expect(capturedPrompt).toContain("2026-08-20T10:55:00.000Z → 2026-08-20T12:00:00.000Z");
    expect(capturedPrompt).toContain("state interrupted");
    expect(capturedPrompt).toContain("Session title: Fictional joined desktop task");
    expect(capturedPrompt).toContain("Check the fictional desktop flow");
    expect(capturedPrompt).not.toContain("An obsolete success report.");
  });

  it("serves the second identical question from cache", async () => {
    let calls = 0;
    const runner: AnalystBackendRunner = async function* () {
      calls++;
      yield {
        type: "result",
        costUsd: 0,
        finalText: "Answer. [git-working-tree]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const svc = service(runner);
    await collect(svc.ask("demo", "q1"));
    const second = await collect(svc.ask("demo", "q1"));
    expect(calls).toBe(1);
    expect(second.at(-1)).toMatchObject({
      type: "done",
      cached: true,
      answer: "Answer. [git-working-tree]",
    });
  });

  it("does not reuse a cached answer after the filtered project evidence changes", async () => {
    let calls = 0;
    const runner: AnalystBackendRunner = async function* () {
      calls += 1;
      yield {
        type: "result",
        costUsd: 0,
        finalText: `Answer ${calls}. [git-working-tree]`,
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const svc = service(runner);
    await collect(svc.ask("demo", "same question"));
    fs.writeFileSync(path.join(repo, "new-work.ts"), "export const changed = true;\n");
    const second = await collect(svc.ask("demo", "same question"));

    expect(calls).toBe(2);
    expect(second.at(-1)).toMatchObject({
      type: "done",
      cached: false,
      answer: "Answer 2. [git-working-tree]",
    });
  });

  it("aborts a provider call at the application deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    const runner: AnalystBackendRunner = async function* (params) {
      observedSignal = params.signal;
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(params.signal.reason ?? new Error("aborted"));
        if (params.signal.aborted) fail();
        else params.signal.addEventListener("abort", fail, { once: true });
      });
    };

    await expect(
      collect(service(runner, 5).ask("demo", "deadline test")),
    ).rejects.toThrow(/timed out/i);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("propagates a caller disconnect signal to the provider", async () => {
    const caller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const runner: AnalystBackendRunner = async function* (params) {
      observedSignal = params.signal;
      await new Promise<never>((_resolve, reject) => {
        const fail = () => reject(new Error("caller aborted"));
        if (params.signal.aborted) fail();
        else params.signal.addEventListener("abort", fail, { once: true });
      });
    };
    const pending = collect(
      service(runner).ask("demo", "disconnect test", caller.signal),
    );
    setTimeout(() => caller.abort(), 5);
    await expect(pending).rejects.toThrow(/caller aborted/i);
    expect(observedSignal?.aborted).toBe(true);
  });

  it("never emits an unsupported raw model assertion", async () => {
    const runner: AnalystBackendRunner = async function* () {
      yield {
        type: "result",
        costUsd: 0,
        finalText: "Uncited private-looking output.",
        isError: false,
      } satisfies AnalystBackendEvent;
    };

    const chunks = await collect(service(runner).ask("demo", "unsupported claim"));
    expect(chunks.filter((chunk) => chunk.type === "text")).toEqual([
      { type: "text", text: "Unknown from available evidence." },
    ]);
    expect(JSON.stringify(chunks)).not.toContain("private-looking");
  });

  it("uses the validated backend result", async () => {
    const runner: AnalystBackendRunner = async function* () {
      yield {
        type: "result",
        costUsd: 0,
        finalText: "Full answer. [git-working-tree]",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const chunks = await collect(service(runner).ask("demo", "q"));
    expect(chunks.at(-1)).toMatchObject({
      type: "done",
      answer: "Full answer. [git-working-tree]",
    });
  });

  it("throws ProjectNotFoundError for unknown projects", async () => {
    const runner: AnalystBackendRunner = async function* () {
      yield {
        type: "result",
        costUsd: 0,
        finalText: "",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    await expect(collect(service(runner).ask("nope", "q"))).rejects.toThrow(ProjectNotFoundError);
  });

  it("exposes the default status question", () => {
    const runner: AnalystBackendRunner = async function* () {
      yield {
        type: "result",
        costUsd: 0,
        finalText: "",
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    expect(service(runner).statusQuestion).toBe(DEFAULT_STATUS_QUESTION);
    expect(DEFAULT_STATUS_QUESTION).toContain("exactly three lines");
  });
});

describe("evidence enforcement", () => {
  const evidence = [
    {
      id: "git-working-tree",
      kind: "working-tree" as const,
      label: "Working tree",
      detail: "Clean on main",
    },
  ];

  it("keeps cited claims and replaces uncited model assertions", () => {
    expect(enforceEvidenceCitations("Clean on main. [git-working-tree]", evidence)).toBe(
      "Clean on main. [git-working-tree]",
    );
    expect(enforceEvidenceCitations("Tests probably pass.", evidence)).toBe(
      "Unknown from available evidence.",
    );
    expect(
      enforceEvidenceCitations(
        "Clean on main. [git-working-tree] Tests probably pass.",
        evidence,
      ),
    ).toBe("Unknown from available evidence.");
    expect(
      enforceEvidenceCitations(
        "Unknown from available evidence, but tests probably pass.",
        evidence,
      ),
    ).toBe("Unknown from available evidence.");
  });

  it("preserves the status labels when a line is unsupported", () => {
    expect(enforceEvidenceCitations("Done: Shipped.\nNow: Unknown from available evidence.", evidence))
      .toBe("Done: Unknown from available evidence.\nNow: Unknown from available evidence.");
  });
});

describe("selectTranscripts", () => {
  const ref = (source: string, id: string, endedAt: string): TranscriptRef => ({
    source,
    id,
    path: `/t/${id}.jsonl`,
    endedAt: new Date(endedAt),
  });

  it("keeps the newest transcripts when all sources fit", () => {
    const refs = [
      ref("claude-code", "c1", "2026-07-10T00:00:00Z"),
      ref("codex", "x1", "2026-07-09T00:00:00Z"),
      ref("claude-code", "c2", "2026-07-08T00:00:00Z"),
    ];
    expect(selectTranscripts(refs, 3).map((r) => r.id)).toEqual(["c1", "x1", "c2"]);
  });

  it("reserves a slot for a source crowded out by a busier one", () => {
    const refs = [
      ref("claude-code", "c1", "2026-07-10T00:00:00Z"),
      ref("claude-code", "c2", "2026-07-09T00:00:00Z"),
      ref("claude-code", "c3", "2026-07-08T00:00:00Z"),
      ref("codex", "x1", "2026-07-01T00:00:00Z"),
    ];
    const ids = selectTranscripts(refs, 3).map((r) => r.id);
    expect(ids).toHaveLength(3);
    expect(ids).toContain("x1");
    expect(ids).toContain("c1"); // newest overall always survives
  });

  it("never exceeds max and tolerates fewer refs than max", () => {
    expect(selectTranscripts([], 5)).toEqual([]);
    const refs = [ref("codex", "x1", "2026-07-01T00:00:00Z")];
    expect(selectTranscripts(refs, 5)).toHaveLength(1);
  });
});
