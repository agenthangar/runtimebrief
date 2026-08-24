import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  CursorSessionsAdapter,
  extractUserQuery,
  messageBlobIds,
  parseCursorSessionDir,
} from "../src/adapters/cursorSessions.js";
import type { ProjectConfig } from "../src/types.js";
import { tmpdir } from "./helpers.js";

// Fixture layout mirrors the real cursor-agent chat store, verified against
// a live session on this machine (see docs/adapters.md).
const SID = "cb4f0e72-b696-41bc-b1fa-13c244f490e7";
const CWD = "/Users/dev/sampletracker";

function blobId(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** Root blob protobuf: repeated field 1, each a 32-byte message blob hash. */
function buildRootBlob(ids: string[]): Buffer {
  return Buffer.concat(
    ids.map((id) => Buffer.concat([Buffer.from([0x0a, 0x20]), Buffer.from(id, "hex")])),
  );
}

function userMessage(text: string): string {
  return JSON.stringify({
    role: "user",
    content: [{ type: "text", text }],
    providerOptions: { cursor: { requestId: "req-1" } },
  });
}

function assistantMessage(blocks: unknown[]): string {
  return JSON.stringify({ role: "assistant", content: blocks, id: "1" });
}

function writeSession(
  dir: string,
  opts: {
    cwd: string;
    withStore: boolean;
    title?: string;
    createdAtMs: number;
    updatedAtMs: number;
    messages?: string[];
  },
): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      schemaVersion: 1,
      createdAtMs: opts.createdAtMs,
      updatedAtMs: opts.updatedAtMs,
      hasConversation: opts.withStore,
      ...(opts.title ? { title: opts.title } : {}),
      cwd: opts.cwd,
    }),
  );
  // prompt_history.json is stored newest-first (verified live).
  fs.writeFileSync(
    path.join(dir, "prompt_history.json"),
    JSON.stringify(["Now write tests for it", "Add a shopping list feature"]),
  );
  if (!opts.withStore) return;

  const messages = opts.messages ?? [
    JSON.stringify({ role: "system", content: "You are an AI coding assistant." }),
    userMessage("<user_info>\nOS Version: darwin\n</user_info>"),
    userMessage(
      "<timestamp>Friday, Jul 3, 2026, 3:58 PM (UTC-7)</timestamp>\n<user_query>\nAdd a shopping list feature\n</user_query>",
    ),
    assistantMessage([
      { type: "redacted-reasoning", data: "xxx", providerOptions: { cursor: { modelName: "composer-2.5" } } },
      { type: "text", text: "Starting with the models." },
      { type: "tool-call", toolCallId: "t1", toolName: "edit_file", args: { target_file: "/Users/dev/sampletracker/src/shopping.ts" } },
      { type: "tool-call", toolCallId: "t2", toolName: "read_file", args: { path: "/Users/dev/sampletracker/.env" } },
    ]),
    userMessage("<system_reminder>\nWorkspace folders changed.\n</system_reminder>"),
    userMessage("<user_query>\nNow write tests for it\n</user_query>"),
    assistantMessage([
      { type: "text", text: "Done. Shopping list feature implemented with tests; all 12 pass." },
    ]),
  ];
  const ids = messages.map(blobId);
  const rootId = blobId("root");
  const db = new Database(path.join(dir, "store.db"));
  db.exec("CREATE TABLE blobs (id TEXT PRIMARY KEY, data BLOB); CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);");
  const insert = db.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)");
  messages.forEach((m, i) => insert.run(ids[i], Buffer.from(m)));
  // A binary (non-JSON) aux blob referenced by the root must be tolerated.
  const binaryId = blobId("binary");
  insert.run(binaryId, Buffer.from([0x0a, 0x03, 0xff, 0xfe, 0x00]));
  insert.run(rootId, buildRootBlob([...ids, binaryId]));
  db.prepare("INSERT INTO meta (key, value) VALUES ('0', ?)").run(
    Buffer.from(
      JSON.stringify({ agentId: SID, latestRootBlobId: rootId, name: "Shopping list", lastUsedModel: "composer-2.5" }),
    ).toString("hex"),
  );
  db.close();
}

describe("messageBlobIds", () => {
  it("collects ordered field-1 hashes and skips other fields", () => {
    const a = "aa".repeat(32);
    const b = "bb".repeat(32);
    const buf = Buffer.concat([
      buildRootBlob([a]),
      Buffer.from([0x2a, 0x02, 0x08, 0x01]), // field 5, length-delimited — skipped
      Buffer.from([0x10, 0x07]), // field 2, varint — skipped
      buildRootBlob([b]),
    ]);
    expect(messageBlobIds(buf)).toEqual([a, b]);
  });

  it("returns what it parsed before hitting corruption", () => {
    const a = "cc".repeat(32);
    const buf = Buffer.concat([buildRootBlob([a]), Buffer.from([0x0a, 0xff])]);
    expect(messageBlobIds(buf)).toEqual([a]);
    expect(messageBlobIds(Buffer.alloc(0))).toEqual([]);
  });
});

describe("extractUserQuery", () => {
  it("pulls the real prompt out of user_query tags", () => {
    expect(extractUserQuery("<timestamp>Fri</timestamp>\n<user_query>\nfix the bug\n</user_query>")).toBe("fix the bug");
  });
  it("drops harness-injected turns without a user_query", () => {
    expect(extractUserQuery("<user_info>\nOS: darwin\n</user_info>")).toBeNull();
    expect(extractUserQuery("<system_reminder>x</system_reminder>")).toBeNull();
  });
  it("keeps tag-free plain text (other cursor versions)", () => {
    expect(extractUserQuery("just a plain prompt")).toBe("just a plain prompt");
    expect(extractUserQuery("   ")).toBeNull();
  });
});

describe("parseCursorSessionDir", () => {
  let root: string;
  let sessionDir: string;
  beforeAll(() => {
    root = tmpdir("cursor-parse");
    sessionDir = path.join(root, "chats", "hash1", SID);
    writeSession(sessionDir, {
      cwd: CWD,
      withStore: true,
      createdAtMs: Date.parse("2026-07-09T10:00:00Z"),
      updatedAtMs: Date.parse("2026-07-09T10:03:00Z"),
    });
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("extracts session metadata, prompts, final text, files touched", async () => {
    const session = await parseCursorSessionDir(sessionDir);
    expect(session.sessionId).toBe(SID);
    expect(session.startedAt?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(session.endedAt?.toISOString()).toBe("2026-07-09T10:03:00.000Z");
    expect(session.model).toBe("composer-2.5");
    expect(session.userPrompts).toEqual([
      "Add a shopping list feature",
      "Now write tests for it",
    ]);
    expect(session.finalAssistantText).toBe(
      "Done. Shopping list feature implemented with tests; all 12 pass.",
    );
    expect(session.toolUseCount).toBe(2);
    expect(session.malformedLines).toBe(1); // the binary aux blob
    expect(session.state).toBe("completed");
  });

  it("collects files from tool calls but filters sensitive paths", async () => {
    const session = await parseCursorSessionDir(sessionDir);
    expect(session.filesTouched).toContain("/Users/dev/sampletracker/src/shopping.ts");
    expect(session.filesTouched).not.toContain("/Users/dev/sampletracker/.env");
  });

  it("keeps a text-plus-tool assistant turn active", async () => {
    const active = path.join(root, "chats", "hash1", "active-session");
    writeSession(active, {
      cwd: CWD,
      withStore: true,
      createdAtMs: Date.parse("2026-07-09T11:00:00Z"),
      updatedAtMs: Date.parse("2026-07-09T11:01:00Z"),
      messages: [
        userMessage("<user_query>\nInvestigate the failure\n</user_query>"),
        assistantMessage([
          { type: "text", text: "I found the likely cause; checking it now." },
          {
            type: "tool-call",
            toolCallId: "active-tool",
            toolName: "read_file",
            args: { path: "/Users/dev/sampletracker/src/shopping.ts" },
          },
        ]),
      ],
    });
    const session = await parseCursorSessionDir(active);
    expect(session.state).toBe("active");
    expect(session.stateReason).toContain("tool activity");
  });

  it("marks an explicit user-input tool call as waiting", async () => {
    const waiting = path.join(root, "chats", "hash1", "waiting-session");
    writeSession(waiting, {
      cwd: CWD,
      withStore: true,
      createdAtMs: Date.parse("2026-07-09T12:00:00Z"),
      updatedAtMs: Date.parse("2026-07-09T12:01:00Z"),
      messages: [
        userMessage("<user_query>\nChoose an approach\n</user_query>"),
        assistantMessage([
          {
            type: "tool-call",
            toolCallId: "question-tool",
            toolName: "AskUserQuestion",
            args: { questions: [{ question: "Which option?" }] },
          },
        ]),
      ],
    });
    const session = await parseCursorSessionDir(waiting);
    expect(session.state).toBe("waiting");
    expect(session.stateReason).toContain("requested user input");
  });

  it("falls back to prompt_history.json (reversed to chronological) without a store.db", async () => {
    const bare = path.join(root, "chats", "hash1", "bare-session");
    writeSession(bare, {
      cwd: CWD,
      withStore: false,
      createdAtMs: Date.parse("2026-07-08T10:00:00Z"),
      updatedAtMs: Date.parse("2026-07-08T10:01:00Z"),
    });
    const session = await parseCursorSessionDir(bare);
    expect(session.userPrompts).toEqual([
      "Add a shopping list feature",
      "Now write tests for it",
    ]);
    expect(session.finalAssistantText).toBeNull();
    expect(session.state).toBe("unknown");
  });

  it("returns an empty session for a missing dir", async () => {
    const session = await parseCursorSessionDir("/nonexistent/session");
    expect(session.userPrompts).toEqual([]);
    expect(session.startedAt).toBeNull();
  });
});

describe("CursorSessionsAdapter", () => {
  let root: string;
  let project: ProjectConfig;
  let adapter: CursorSessionsAdapter;

  beforeAll(() => {
    root = tmpdir("cursor-root");
    writeSession(path.join(root, "chats", "hash1", SID), {
      cwd: CWD,
      withStore: true,
      createdAtMs: Date.parse("2026-07-09T10:00:00Z"),
      updatedAtMs: Date.parse("2026-07-09T10:03:00Z"),
    });
    writeSession(path.join(root, "chats", "hash1", "older-session"), {
      cwd: CWD,
      withStore: true,
      title: "Older session",
      createdAtMs: Date.parse("2026-07-01T09:00:00Z"),
      updatedAtMs: Date.parse("2026-07-01T09:05:00Z"),
    });
    // Empty shells (hasConversation: false) must be excluded from listings.
    writeSession(path.join(root, "chats", "hash1", "empty-shell"), {
      cwd: CWD,
      withStore: false,
      createdAtMs: Date.parse("2026-07-10T09:00:00Z"),
      updatedAtMs: Date.parse("2026-07-10T09:00:01Z"),
    });
    // A session for a different project must never match.
    writeSession(path.join(root, "chats", "hash2", "other-project"), {
      cwd: "/Users/dev/other-project",
      withStore: false,
      createdAtMs: Date.parse("2026-07-09T12:00:00Z"),
      updatedAtMs: Date.parse("2026-07-09T12:05:00Z"),
    });
    project = { id: "meal", name: "Sample Tracker App", path: CWD };
    adapter = new CursorSessionsAdapter(root);
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("discovers projects with matching sessions by meta.json cwd", async () => {
    expect(await adapter.discover(project)).toBe(true);
    expect(
      await adapter.discover({ id: "x", name: "X", path: "/no/sessions/here" }),
    ).toBe(false);
  });

  it("respects explicit transcript_sources exclusion", async () => {
    const excluded = { ...project, transcript_sources: [{ type: "claude-code" }] };
    expect(
      await adapter.discover(excluded),
    ).toBe(false);
    expect(await adapter.transcriptPaths(excluded, 10)).toEqual([]);
    expect(
      await adapter.discover({ ...project, transcript_sources: [{ type: "cursor" }] }),
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

  it("invalidates the legacy cache when only the SQLite WAL changes", async () => {
    const cacheRoot = tmpdir("cursor-wal-cache");
    const cacheSession = path.join(cacheRoot, "chats", "hash1", "wal-session");
    writeSession(cacheSession, {
      cwd: CWD,
      withStore: true,
      createdAtMs: Date.parse("2026-07-09T13:00:00Z"),
      updatedAtMs: Date.parse("2026-07-09T13:01:00Z"),
    });
    const storePath = path.join(cacheSession, "store.db");
    const writer = new Database(storePath);
    try {
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      const cachedAdapter = new CursorSessionsAdapter(cacheRoot, null);
      const initial = await cachedAdapter.transcriptPaths(project, 10);
      expect(initial[0]?.state).toBe("completed");

      const stableFiles = [
        storePath,
        path.join(cacheSession, "meta.json"),
        path.join(cacheSession, "prompt_history.json"),
      ];
      const before = stableFiles.map((file) => {
        const stat = fs.statSync(file);
        return `${stat.mtimeMs}:${stat.size}`;
      });
      const messages = [
        userMessage("<user_query>\nChoose a fictional cache option\n</user_query>"),
        assistantMessage([
          {
            type: "tool-call",
            toolCallId: "wal-question",
            toolName: "AskUserQuestion",
            args: { questions: [{ question: "Which fictional option?" }] },
          },
        ]),
      ];
      const ids = messages.map(blobId);
      const rootId = blobId("wal-only-root");
      writer.transaction(() => {
        const insert = writer.prepare("INSERT INTO blobs (id, data) VALUES (?, ?)");
        messages.forEach((message, index) => insert.run(ids[index], Buffer.from(message)));
        insert.run(rootId, buildRootBlob(ids));
        writer.prepare("UPDATE meta SET value = ? WHERE key = '0'").run(
          Buffer.from(
            JSON.stringify({
              agentId: SID,
              latestRootBlobId: rootId,
              lastUsedModel: "composer-2.5",
            }),
          ).toString("hex"),
        );
      })();

      expect(fs.existsSync(`${storePath}-wal`)).toBe(true);
      expect(
        stableFiles.map((file) => {
          const stat = fs.statSync(file);
          return `${stat.mtimeMs}:${stat.size}`;
        }),
      ).toEqual(before);
      await new Promise((resolve) => setTimeout(resolve, 1_100));

      const refreshed = await cachedAdapter.transcriptPaths(project, 10);
      expect(refreshed[0]?.state).toBe("waiting");
      expect(refreshed[0]?.stateReason).toContain("requested user input");
    } finally {
      writer.close();
      fs.rmSync(cacheRoot, { recursive: true, force: true });
    }
  });

  it("reports sessions as recent activity, filtered by since", async () => {
    const all = await adapter.recentActivity(project, new Date("2026-06-01T00:00:00Z"));
    expect(all).toHaveLength(2);
    const recent = await adapter.recentActivity(project, new Date("2026-07-05T00:00:00Z"));
    expect(recent).toHaveLength(1);
    expect(recent[0]!.kind).toBe("session");
  });
});
