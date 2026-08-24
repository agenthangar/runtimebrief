import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import {
  CursorSessionsAdapter,
  parseCursorIdeSession,
} from "../src/adapters/cursorSessions.js";
import { PortfolioService } from "../src/portfolio.js";
import type {
  ProjectConfig,
  RuntimeAdapter,
  SessionState,
  TranscriptRef,
} from "../src/types.js";
import { tmpdir } from "./helpers.js";

const PROJECT = "/Users/developer/projects/sample-app";
const SIBLING = "/Users/developer/projects/sibling-app";
const WORKSPACE = "/Users/developer/projects";

interface CursorIdeFixture {
  id: string;
  workspacePath: string;
  createdAtMs: number;
  updatedAtMs: number;
  status: string;
  hasBlockingPendingActions?: boolean;
  prompt?: string;
  conclusion?: string;
  touchedFiles?: string[];
  model?: string;
}

function fileUri(filePath: string): string {
  return `file://${filePath}`;
}

/**
 * Minimal privacy-safe fixture for Cursor IDE 3.x's global state.vscdb.
 *
 * Cursor keeps one JSON header per thread in composerHeaders, a composerData
 * record in cursorDiskKV, and one cursorDiskKV record for each conversation
 * bubble. The values below use generic fictional paths and text only.
 */
function createIdeDatabase(dbPath: string, sessions: CursorIdeFixture[]): void {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE composerHeaders (
      composerId TEXT PRIMARY KEY,
      workspaceId TEXT,
      createdAt INTEGER,
      lastUpdatedAt INTEGER,
      isArchived INTEGER,
      isSubagent INTEGER,
      recency INTEGER,
      checkpointAt INTEGER,
      value TEXT
    );
    CREATE TABLE cursorDiskKV (
      key TEXT UNIQUE ON CONFLICT REPLACE,
      value BLOB
    );
  `);

  const insertHeader = db.prepare(`
    INSERT INTO composerHeaders (
      composerId, workspaceId, createdAt, lastUpdatedAt, isArchived,
      isSubagent, recency, checkpointAt, value
    ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?)
  `);
  const insertValue = db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)");

  for (const fixture of sessions) {
    const prompt = fixture.prompt ?? `Work on fictional thread ${fixture.id}`;
    const conclusion = fixture.conclusion ?? `Finished fictional thread ${fixture.id}`;
    const userBubbleId = `${fixture.id}-user`;
    const assistantBubbleId = `${fixture.id}-assistant`;
    const workspaceId = `workspace-${path.basename(fixture.workspacePath)}`;
    const header = {
      type: "head",
      composerId: fixture.id,
      name: `Fictional Cursor thread ${fixture.id}`,
      createdAt: fixture.createdAtMs,
      lastUpdatedAt: fixture.updatedAtMs,
      hasBlockingPendingActions: fixture.hasBlockingPendingActions ?? false,
      hasPendingPlan: false,
      isDraft: false,
      isWorktree: false,
      workspaceIdentifier: {
        id: workspaceId,
        uri: {
          $mid: 1,
          fsPath: fixture.workspacePath,
          external: fileUri(fixture.workspacePath),
          path: fixture.workspacePath,
          scheme: "file",
        },
      },
    };
    insertHeader.run(
      fixture.id,
      workspaceId,
      fixture.createdAtMs,
      fixture.updatedAtMs,
      fixture.updatedAtMs,
      fixture.updatedAtMs,
      JSON.stringify(header),
    );

    const body = {
      _v: 4,
      composerId: fixture.id,
      fullConversationHeadersOnly: [
        {
          bubbleId: userBubbleId,
          type: 1,
          createdAt: new Date(fixture.createdAtMs).toISOString(),
          grouping: { isRenderable: true, hasText: true },
        },
        {
          bubbleId: assistantBubbleId,
          type: 2,
          createdAt: new Date(fixture.updatedAtMs).toISOString(),
          grouping: { isRenderable: true, hasText: true },
        },
      ],
      conversationMap: {},
      status: fixture.status,
      originalFileStates: Object.fromEntries(
        (fixture.touchedFiles ?? []).map((file) => [
          fileUri(file),
          {
            firstEditBubbleId: assistantBubbleId,
            isNewlyCreated: false,
            contentKey: `composer.content.${fixture.id}`,
          },
        ]),
      ),
      newlyCreatedFiles: [],
      createdAt: fixture.createdAtMs,
      lastUpdatedAt: fixture.updatedAtMs,
      modelConfig: { modelName: fixture.model ?? "cursor-fictional-1" },
    };
    insertValue.run(`composerData:${fixture.id}`, JSON.stringify(body));
    insertValue.run(
      `bubbleId:${fixture.id}:${userBubbleId}`,
      JSON.stringify({
        _v: 3,
        type: 1,
        bubbleId: userBubbleId,
        createdAt: new Date(fixture.createdAtMs).toISOString(),
        richText: prompt,
        text: prompt,
      }),
    );
    insertValue.run(
      `bubbleId:${fixture.id}:${assistantBubbleId}`,
      JSON.stringify({
        _v: 3,
        type: 2,
        bubbleId: assistantBubbleId,
        createdAt: new Date(fixture.updatedAtMs).toISOString(),
        text: conclusion,
        modelInfo: { modelName: fixture.model ?? "cursor-fictional-1" },
      }),
    );
  }
  db.close();
}

function writeIdeToolBubble(
  dbPath: string,
  sessionId: string,
  rawArgs: Record<string, unknown>,
  createdAtMs: number,
): void {
  const db = new Database(dbPath);
  const bubbleId = `${sessionId}-tool`;
  db.prepare("INSERT INTO cursorDiskKV (key, value) VALUES (?, ?)").run(
    `bubbleId:${sessionId}:${bubbleId}`,
    JSON.stringify({
      _v: 3,
      type: 2,
      bubbleId,
      createdAt: new Date(createdAtMs).toISOString(),
      toolFormerData: {
        name: "ReadMany",
        status: "completed",
        rawArgs: JSON.stringify(rawArgs),
      },
    }),
  );
  db.close();
}

function writeLegacySession(
  legacyRoot: string,
  id: string,
  cwd: string,
  updatedAtMs: number,
  prompt: string,
): void {
  const dir = path.join(legacyRoot, "chats", "fictional-workspace", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      schemaVersion: 1,
      cwd,
      title: `Legacy fictional thread ${id}`,
      createdAtMs: updatedAtMs - 1_000,
      updatedAtMs,
      hasConversation: true,
    }),
  );
  fs.writeFileSync(path.join(dir, "prompt_history.json"), JSON.stringify([prompt]));
}

describe("Cursor IDE sessions", () => {
  const roots: string[] = [];

  function fixtureRoot(label: string): string {
    const root = tmpdir(label);
    roots.push(root);
    return root;
  }

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses modern Cursor state, prompts, conclusions, model, and touched files", async () => {
    const root = fixtureRoot("cursor-ide-states");
    const dbPath = path.join(root, "state.vscdb");
    const base = Date.parse("2026-08-20T10:00:00.000Z");
    createIdeDatabase(dbPath, [
      {
        id: "completed-thread",
        workspacePath: PROJECT,
        createdAtMs: base,
        updatedAtMs: base + 1_000,
        status: "completed",
        prompt: "Implement the fictional completed feature",
        conclusion: "The fictional completed feature is ready.",
        touchedFiles: [`${PROJECT}/src/completed.ts`],
        model: "cursor-fictional-completed",
      },
      {
        id: "interrupted-thread",
        workspacePath: PROJECT,
        createdAtMs: base + 2_000,
        updatedAtMs: base + 3_000,
        status: "aborted",
      },
      {
        id: "active-thread",
        workspacePath: PROJECT,
        createdAtMs: base + 4_000,
        updatedAtMs: base + 5_000,
        status: "generating",
      },
      {
        id: "waiting-thread",
        workspacePath: PROJECT,
        createdAtMs: base + 6_000,
        updatedAtMs: base + 7_000,
        status: "generating",
        hasBlockingPendingActions: true,
      },
    ]);

    const expectedStates: Record<string, SessionState> = {
      "completed-thread": "completed",
      "interrupted-thread": "interrupted",
      "active-thread": "active",
      "waiting-thread": "waiting",
    };
    for (const [id, expected] of Object.entries(expectedStates)) {
      const session = await parseCursorIdeSession(dbPath, id);
      expect(session.state, id).toBe(expected);
    }

    const completed = await parseCursorIdeSession(dbPath, "completed-thread");
    expect(completed.startedAt?.toISOString()).toBe("2026-08-20T10:00:00.000Z");
    expect(completed.endedAt?.toISOString()).toBe("2026-08-20T10:00:01.000Z");
    expect(completed.userPrompts).toEqual(["Implement the fictional completed feature"]);
    expect(completed.finalAssistantText).toBe("The fictional completed feature is ready.");
    expect(completed.model).toBe("cursor-fictional-completed");
    expect(completed.filesTouched).toEqual([`${PROJECT}/src/completed.ts`]);
  });

  it("groups exact-project and parent-workspace threads without leaking to siblings", async () => {
    const root = fixtureRoot("cursor-ide-grouping");
    const legacyRoot = path.join(root, "legacy");
    const dbPath = path.join(root, "state.vscdb");
    const base = Date.parse("2026-08-20T11:00:00.000Z");
    createIdeDatabase(dbPath, [
      {
        id: "exact-project",
        workspacePath: PROJECT,
        createdAtMs: base,
        updatedAtMs: base + 1_000,
        status: "completed",
      },
      {
        id: "parent-touched-project",
        workspacePath: WORKSPACE,
        createdAtMs: base + 2_000,
        updatedAtMs: base + 3_000,
        status: "completed",
        touchedFiles: [`${PROJECT}/src/feature.ts`],
      },
      {
        id: "parent-without-project-evidence",
        workspacePath: WORKSPACE,
        createdAtMs: base + 4_000,
        updatedAtMs: base + 5_000,
        status: "completed",
      },
      {
        id: "sibling-project",
        workspacePath: SIBLING,
        createdAtMs: base + 6_000,
        updatedAtMs: base + 7_000,
        status: "completed",
        touchedFiles: [`${SIBLING}/src/sibling.ts`],
      },
    ]);
    const adapter = new CursorSessionsAdapter(legacyRoot, dbPath);
    const project: ProjectConfig = { id: "sample", name: "Sample App", path: PROJECT };
    const sibling: ProjectConfig = { id: "sibling", name: "Sibling App", path: SIBLING };

    await expect(adapter.discover(project)).resolves.toBe(true);
    await expect(adapter.discover(sibling)).resolves.toBe(true);
    expect((await adapter.transcriptPaths(project, 10)).map((ref) => ref.id)).toEqual([
      "parent-touched-project",
      "exact-project",
    ]);
    expect((await adapter.transcriptPaths(sibling, 10)).map((ref) => ref.id)).toEqual([
      "sibling-project",
    ]);
  });

  it("recognizes targetDirectory, relativeWorkspacePath, and cwd in IDE tool arguments", async () => {
    const root = fixtureRoot("cursor-ide-path-keys");
    const legacyRoot = path.join(root, "legacy");
    const dbPath = path.join(root, "state.vscdb");
    const base = Date.parse("2026-08-20T11:30:00.000Z");
    const sessionId = "ide-path-key-thread";
    const targetDirectory = `${PROJECT}/src/features`;
    const relativeWorkspacePath = "sample-app/src/relative-note.ts";
    createIdeDatabase(dbPath, [
      {
        id: sessionId,
        workspacePath: WORKSPACE,
        createdAtMs: base,
        updatedAtMs: base + 1_000,
        status: "completed",
      },
    ]);
    writeIdeToolBubble(
      dbPath,
      sessionId,
      {
        targetDirectory,
        relativeWorkspacePath,
        cwd: PROJECT,
      },
      base + 2_000,
    );

    const parsed = await parseCursorIdeSession(dbPath, sessionId);
    expect(parsed.filesTouched).toEqual(
      expect.arrayContaining([targetDirectory, relativeWorkspacePath, PROJECT]),
    );

    const adapter = new CursorSessionsAdapter(legacyRoot, dbPath);
    const target: ProjectConfig = { id: "sample", name: "Sample App", path: PROJECT };
    expect((await adapter.transcriptPaths(target, 10)).map((ref) => ref.id)).toEqual([
      sessionId,
    ]);
  });

  it("sorts and limits the combined CLI and IDE stream while deduplicating session IDs", async () => {
    const root = fixtureRoot("cursor-ide-coexistence");
    const legacyRoot = path.join(root, "legacy");
    const dbPath = path.join(root, "state.vscdb");
    const base = Date.parse("2026-08-20T12:00:00.000Z");
    createIdeDatabase(dbPath, [
      {
        id: "ide-newest",
        workspacePath: PROJECT,
        createdAtMs: base + 6_000,
        updatedAtMs: base + 7_000,
        status: "completed",
      },
      {
        id: "shared-session",
        workspacePath: PROJECT,
        createdAtMs: base + 4_000,
        updatedAtMs: base + 5_000,
        status: "completed",
        prompt: "IDE copy of the shared fictional thread",
      },
      {
        id: "ide-older",
        workspacePath: PROJECT,
        createdAtMs: base + 2_000,
        updatedAtMs: base + 3_000,
        status: "completed",
      },
    ]);
    writeLegacySession(
      legacyRoot,
      "shared-session",
      PROJECT,
      base + 1_500,
      "Legacy copy that should be deduplicated",
    );
    writeLegacySession(
      legacyRoot,
      "legacy-oldest",
      PROJECT,
      base + 1_000,
      "A distinct legacy-only thread",
    );
    const adapter = new CursorSessionsAdapter(legacyRoot, dbPath);

    const limited = await adapter.transcriptPaths(
      { id: "sample", name: "Sample App", path: PROJECT },
      3,
    );
    expect(limited.map((ref) => ref.id)).toEqual([
      "ide-newest",
      "shared-session",
      "ide-older",
    ]);

    const all = await adapter.transcriptPaths(
      { id: "sample", name: "Sample App", path: PROJECT },
      10,
    );
    expect(all.map((ref) => ref.id)).toEqual([
      "ide-newest",
      "shared-session",
      "ide-older",
      "legacy-oldest",
    ]);
    expect(all.find((ref) => ref.id === "shared-session")?.summary).toBe(
      "IDE copy of the shared fictional thread",
    );
  });

  it(
    "degrades gracefully when the IDE database is missing, malformed, or locked",
    async () => {
      const root = fixtureRoot("cursor-ide-unavailable");
      const legacyRoot = path.join(root, "legacy");
      const project: ProjectConfig = { id: "sample", name: "Sample App", path: PROJECT };

      const missing = new CursorSessionsAdapter(legacyRoot, path.join(root, "missing.vscdb"));
      await expect(missing.discover(project)).resolves.toBe(false);
      await expect(missing.transcriptPaths(project, 10)).resolves.toEqual([]);

      const malformedPath = path.join(root, "malformed.vscdb");
      fs.writeFileSync(malformedPath, "not a sqlite database");
      const malformed = new CursorSessionsAdapter(legacyRoot, malformedPath);
      await expect(malformed.discover(project)).resolves.toBe(false);
      await expect(malformed.transcriptPaths(project, 10)).resolves.toEqual([]);

      const lockedPath = path.join(root, "locked.vscdb");
      createIdeDatabase(lockedPath, [
        {
          id: "locked-thread",
          workspacePath: PROJECT,
          createdAtMs: Date.parse("2026-08-20T13:00:00.000Z"),
          updatedAtMs: Date.parse("2026-08-20T13:01:00.000Z"),
          status: "completed",
        },
      ]);
      const locker = new Database(lockedPath);
      locker.pragma("journal_mode = DELETE");
      locker.exec("BEGIN EXCLUSIVE");
      try {
        const locked = new CursorSessionsAdapter(legacyRoot, lockedPath);
        await expect(locked.transcriptPaths(project, 10)).resolves.toEqual([]);
      } finally {
        locker.exec("ROLLBACK");
        locker.close();
      }
    },
    10_000,
  );

  it(
    "retries the same adapter after a locked IDE database is unlocked without a write",
    async () => {
      const root = fixtureRoot("cursor-ide-lock-retry");
      const legacyRoot = path.join(root, "legacy");
      const dbPath = path.join(root, "state.vscdb");
      const sessionId = "retry-after-lock-thread";
      createIdeDatabase(dbPath, [
        {
          id: sessionId,
          workspacePath: PROJECT,
          createdAtMs: Date.parse("2026-08-20T13:10:00.000Z"),
          updatedAtMs: Date.parse("2026-08-20T13:11:00.000Z"),
          status: "completed",
        },
      ]);
      const adapter = new CursorSessionsAdapter(legacyRoot, dbPath);
      const target: ProjectConfig = { id: "sample", name: "Sample App", path: PROJECT };
      const locker = new Database(dbPath);
      locker.pragma("journal_mode = DELETE");
      locker.exec("BEGIN EXCLUSIVE");
      const lockedStat = fs.statSync(dbPath);
      try {
        await expect(adapter.transcriptPaths(target, 10)).resolves.toEqual([]);
      } finally {
        locker.exec("ROLLBACK");
        locker.close();
      }

      const unlockedStat = fs.statSync(dbPath);
      expect(unlockedStat.mtimeMs).toBe(lockedStat.mtimeMs);
      expect(unlockedStat.size).toBe(lockedStat.size);
      expect((await adapter.transcriptPaths(target, 10)).map((ref) => ref.id)).toEqual([
        sessionId,
      ]);
    },
    10_000,
  );

  it("honors an explicit transcript_sources list that excludes Cursor", async () => {
    const root = fixtureRoot("cursor-ide-excluded");
    const dbPath = path.join(root, "state.vscdb");
    createIdeDatabase(dbPath, [
      {
        id: "excluded-cursor-thread",
        workspacePath: PROJECT,
        createdAtMs: Date.parse("2026-08-20T14:00:00.000Z"),
        updatedAtMs: Date.parse("2026-08-20T14:01:00.000Z"),
        status: "completed",
      },
    ]);
    const adapter = new CursorSessionsAdapter(path.join(root, "legacy"), dbPath);
    const excluded: ProjectConfig = {
      id: "sample",
      name: "Sample App",
      path: PROJECT,
      transcript_sources: [{ type: "claude-code" }],
    };

    await expect(adapter.discover(excluded)).resolves.toBe(false);
    await expect(adapter.transcriptPaths(excluded, 10)).resolves.toEqual([]);
  });

  it("places Cursor, Codex, and Claude Code threads in one project card", async () => {
    const root = fixtureRoot("cursor-ide-portfolio");
    const dbPath = path.join(root, "state.vscdb");
    const base = Date.parse("2026-08-20T15:00:00.000Z");
    createIdeDatabase(dbPath, [
      {
        id: "cursor-thread",
        workspacePath: PROJECT,
        createdAtMs: base,
        updatedAtMs: base + 1_000,
        status: "completed",
      },
    ]);
    const project: ProjectConfig = { id: "sample", name: "Sample App", path: PROJECT };
    const runtime = (id: string, ref: TranscriptRef): RuntimeAdapter => ({
      id,
      discover: async () => true,
      recentActivity: async () => [],
      transcriptPaths: async () => [ref],
    });
    const portfolio = new PortfolioService(
      () => [project],
      [
        new CursorSessionsAdapter(path.join(root, "legacy"), dbPath),
        runtime("codex", {
          source: "codex",
          id: "codex-thread",
          path: "/private/fictional-codex.jsonl",
          endedAt: new Date(base + 3_000),
          state: "completed",
        }),
        runtime("claude-code", {
          source: "claude-code",
          id: "claude-thread",
          path: "/private/fictional-claude.jsonl",
          endedAt: new Date(base + 2_000),
          state: "completed",
        }),
      ],
      () => new Date(base + 4_000),
    );

    const card = await portfolio.getProject("sample");
    expect(card?.sessions.map((session) => session.source)).toEqual([
      "codex",
      "claude-code",
      "cursor",
    ]);
  });
});
