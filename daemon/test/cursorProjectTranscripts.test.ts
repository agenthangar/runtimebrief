import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CursorSessionsAdapter } from "../src/adapters/cursorSessions.js";
import type { ProjectConfig } from "../src/types.js";
import { tmpdir } from "./helpers.js";

const WORKSPACE_FIXTURE_ROOT = path.join(
  os.tmpdir(),
  "runtimebrief-cursor-workspaces",
  String(process.pid),
);
const PARENT_WORKSPACE = path.join(WORKSPACE_FIXTURE_ROOT, "Projects");
const PROJECT = path.join(PARENT_WORKSPACE, "orbit-notes");
const SIBLING = path.join(PARENT_WORKSPACE, "comet-catalog");
const COLLIDING_WORKSPACE = path.join(PARENT_WORKSPACE, "orbit", "notes");
const UNRELATED_WORKSPACE = path.join(WORKSPACE_FIXTURE_ROOT, "Scratch", "scratch-notes");

const EXACT_ID = "10000000-0000-4000-8000-000000000001";
const PARENT_PROJECT_ID = "10000000-0000-4000-8000-000000000002";
const PARENT_SIBLING_ID = "10000000-0000-4000-8000-000000000003";
const PARENT_UNRELATED_ID = "10000000-0000-4000-8000-000000000004";
const SIBLING_ID = "10000000-0000-4000-8000-000000000005";

type TranscriptRecord = Record<string, unknown>;

function encodedWorkspacePath(workspacePath: string): string {
  return workspacePath.split(path.sep).filter(Boolean).join("-");
}

function userMessage(text: string): TranscriptRecord {
  return {
    role: "user",
    message: { content: [{ type: "text", text }] },
  };
}

function assistantMessage(blocks: unknown[]): TranscriptRecord {
  return { role: "assistant", message: { content: blocks } };
}

function turnEnded(status: "success" | "error"): TranscriptRecord {
  return status === "success"
    ? { type: "turn_ended", status }
    : {
        type: "turn_ended",
        status,
        error: "The fictional operation was stopped.",
      };
}

function writeProjectTranscript(
  root: string,
  workspacePath: string,
  id: string,
  records: TranscriptRecord[],
  mtime: Date,
  trailingRawLine?: string,
): string {
  const dir = path.join(
    root,
    "projects",
    encodedWorkspacePath(workspacePath),
    "agent-transcripts",
    id,
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  const lines = records.map((record) => JSON.stringify(record));
  if (trailingRawLine !== undefined) lines.push(trailingRawLine);
  fs.writeFileSync(file, `${lines.join("\n")}\n`);
  fs.utimesSync(file, mtime, mtime);
  return file;
}

function writeLegacyShell(
  root: string,
  id: string,
  cwd: string,
  updatedAtMs: number,
): void {
  const dir = path.join(root, "chats", "fictional-workspace", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify({
      schemaVersion: 1,
      cwd,
      title: "Legacy fictional duplicate",
      createdAtMs: updatedAtMs - 1_000,
      updatedAtMs,
      hasConversation: true,
    }),
  );
  fs.writeFileSync(
    path.join(dir, "prompt_history.json"),
    JSON.stringify(["Legacy copy of the fictional request"]),
  );
}

function project(pathname: string = PROJECT): ProjectConfig {
  return {
    id: path.basename(pathname),
    name: `Fictional ${path.basename(pathname)}`,
    path: pathname,
  };
}

describe("Cursor project transcript sessions", () => {
  const roots: string[] = [];

  function fixtureRoot(label: string): string {
    const root = tmpdir(label);
    roots.push(root);
    return root;
  }

  beforeEach(() => {
    for (const workspace of [PROJECT, SIBLING, UNRELATED_WORKSPACE]) {
      fs.mkdirSync(workspace, { recursive: true });
    }
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
    fs.rmSync(WORKSPACE_FIXTURE_ROOT, { recursive: true, force: true });
  });

  it("parses an exact-project transcript into a complete session result", async () => {
    const root = fixtureRoot("cursor-project-exact");
    const mtime = new Date("2026-08-20T10:03:00.000Z");
    const file = writeProjectTranscript(
      root,
      PROJECT,
      EXACT_ID,
      [
        userMessage("Add offline search to the fictional notes app"),
        assistantMessage([
          { type: "text", text: "I will inspect the search module." },
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${PROJECT}/src/search.ts` },
          },
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${PROJECT}/.env` },
          },
          {
            type: "tool_use",
            name: "StrReplace",
            input: {
              path: `${PROJECT}/src/search.ts`,
              old_string: "return [];",
              new_string: "return cachedNotes;",
            },
          },
        ]),
        assistantMessage([
          {
            type: "text",
            text: "Offline search is implemented and the fictional checks pass.",
          },
        ]),
        turnEnded("success"),
      ],
      mtime,
    );
    const adapter = new CursorSessionsAdapter(root, null);

    await expect(adapter.discover(project())).resolves.toBe(true);
    const refs = await adapter.transcriptPaths(project(), 10);

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      source: "cursor",
      id: EXACT_ID,
      path: file,
      summary: "Add offline search to the fictional notes app",
      state: "completed",
      toolUseCount: 3,
      conclusion: "Offline search is implemented and the fictional checks pass.",
    });
    expect(refs[0]!.endedAt?.toISOString()).toBe(mtime.toISOString());
    expect(refs[0]!.filesTouched).toContain(`${PROJECT}/src/search.ts`);
    expect(refs[0]!.filesTouched).not.toContain(`${PROJECT}/.env`);
  });

  it("uses explicit turn results and pending tool activity for lifecycle state", async () => {
    const root = fixtureRoot("cursor-project-states");
    const base = Date.parse("2026-08-20T11:00:00.000Z");
    const completedId = "20000000-0000-4000-8000-000000000001";
    const interruptedId = "20000000-0000-4000-8000-000000000002";
    const activeId = "20000000-0000-4000-8000-000000000003";
    const waitingId = "20000000-0000-4000-8000-000000000004";
    writeProjectTranscript(
      root,
      PROJECT,
      completedId,
      [
        userMessage("Complete a fictional successful task"),
        assistantMessage([{ type: "text", text: "The successful task is done." }]),
        turnEnded("success"),
      ],
      new Date(base + 1_000),
    );
    writeProjectTranscript(
      root,
      PROJECT,
      interruptedId,
      [
        userMessage("Run a fictional stopped task"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${PROJECT}/src/stopped.ts` },
          },
        ]),
        turnEnded("error"),
      ],
      new Date(base + 2_000),
    );
    writeProjectTranscript(
      root,
      PROJECT,
      activeId,
      [
        userMessage("Inspect the fictional active task"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${PROJECT}/src/active.ts` },
          },
        ]),
      ],
      new Date(base + 3_000),
    );
    writeProjectTranscript(
      root,
      PROJECT,
      waitingId,
      [
        userMessage("Choose a fictional implementation option"),
        assistantMessage([
          {
            type: "tool_use",
            name: "AskUserQuestion",
            input: { question: "Which fictional option should be used?" },
          },
        ]),
      ],
      new Date(base + 4_000),
    );

    const refs = await new CursorSessionsAdapter(root, null).transcriptPaths(project(), 10);
    const states = Object.fromEntries(refs.map((ref) => [ref.id, ref.state]));
    expect(states).toMatchObject({
      [completedId]: "completed",
      [interruptedId]: "interrupted",
      [activeId]: "active",
      [waitingId]: "waiting",
    });
  });

  it("attributes parent-workspace transcripts only through concrete project paths", async () => {
    const root = fixtureRoot("cursor-project-attribution");
    const base = Date.parse("2026-08-20T12:00:00.000Z");
    writeProjectTranscript(
      root,
      PROJECT,
      EXACT_ID,
      [
        userMessage("Work in the exact fictional project"),
        assistantMessage([{ type: "text", text: "Exact project work is complete." }]),
        turnEnded("success"),
      ],
      new Date(base + 1_000),
    );
    writeProjectTranscript(
      root,
      PARENT_WORKSPACE,
      PARENT_PROJECT_ID,
      [
        userMessage("Inspect the selected fictional module"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${PROJECT}/src/note.ts` },
          },
          { type: "text", text: "The selected module is healthy." },
        ]),
        turnEnded("success"),
      ],
      new Date(base + 5_000),
    );
    writeProjectTranscript(
      root,
      PARENT_WORKSPACE,
      PARENT_SIBLING_ID,
      [
        userMessage("Inspect a different fictional module"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${SIBLING}/src/catalog.ts` },
          },
        ]),
        turnEnded("success"),
      ],
      new Date(base + 4_000),
    );
    writeProjectTranscript(
      root,
      PARENT_WORKSPACE,
      PARENT_UNRELATED_ID,
      [
        userMessage("Discuss orbit-notes without opening any project file"),
        assistantMessage([{ type: "text", text: "No project file was inspected." }]),
        turnEnded("success"),
      ],
      new Date(base + 3_000),
    );
    writeProjectTranscript(
      root,
      SIBLING,
      SIBLING_ID,
      [
        userMessage("Work in the sibling fictional project"),
        assistantMessage([{ type: "text", text: "Sibling work is complete." }]),
        turnEnded("success"),
      ],
      new Date(base + 2_000),
    );
    const adapter = new CursorSessionsAdapter(root, null);

    expect((await adapter.transcriptPaths(project(), 10)).map((ref) => ref.id)).toEqual([
      PARENT_PROJECT_ID,
      EXACT_ID,
    ]);
    expect(
      (await adapter.transcriptPaths(project(SIBLING), 10)).map((ref) => ref.id),
    ).toEqual([PARENT_SIBLING_ID, SIBLING_ID]);
  });

  it("does not exact-match a different workspace whose encoded key collides", async () => {
    const root = fixtureRoot("cursor-project-key-collision");
    const collidingId = "60000000-0000-4000-8000-000000000001";
    fs.mkdirSync(COLLIDING_WORKSPACE, { recursive: true });
    expect(encodedWorkspacePath(COLLIDING_WORKSPACE)).toBe(encodedWorkspacePath(PROJECT));
    writeProjectTranscript(
      root,
      COLLIDING_WORKSPACE,
      collidingId,
      [
        userMessage("Inspect the fictional nested notes workspace"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${COLLIDING_WORKSPACE}/src/nested-note.ts` },
          },
        ]),
        turnEnded("success"),
      ],
      new Date("2026-08-20T12:10:00.000Z"),
    );
    const adapter = new CursorSessionsAdapter(root, null);

    await expect(adapter.transcriptPaths(project(), 10)).resolves.toEqual([]);
    expect(
      (await adapter.transcriptPaths(project(COLLIDING_WORKSPACE), 10)).map(
        (ref) => ref.id,
      ),
    ).toEqual([collidingId]);
  });

  it("leaves pathless and relative-only sessions unassigned when workspace keys collide", async () => {
    const root = fixtureRoot("cursor-project-ambiguous-key");
    const pathlessId = "60000000-0000-4000-8000-000000000004";
    const relativeId = "60000000-0000-4000-8000-000000000005";
    fs.mkdirSync(COLLIDING_WORKSPACE, { recursive: true });
    expect(encodedWorkspacePath(COLLIDING_WORKSPACE)).toBe(encodedWorkspacePath(PROJECT));
    writeProjectTranscript(
      root,
      COLLIDING_WORKSPACE,
      pathlessId,
      [
        userMessage("Discuss a fictional ambiguous workspace"),
        assistantMessage([{ type: "text", text: "No file path identifies the workspace." }]),
        turnEnded("success"),
      ],
      new Date("2026-08-20T12:10:30.000Z"),
    );
    writeProjectTranscript(
      root,
      COLLIDING_WORKSPACE,
      relativeId,
      [
        userMessage("Read a relative fictional workspace file"),
        assistantMessage([
          { type: "tool_use", name: "Read", input: { path: "src/relative-note.ts" } },
        ]),
        turnEnded("success"),
      ],
      new Date("2026-08-20T12:10:31.000Z"),
    );
    const adapter = new CursorSessionsAdapter(root, null);

    await expect(adapter.transcriptPaths(project(), 10)).resolves.toEqual([]);
    await expect(
      adapter.transcriptPaths(project(COLLIDING_WORKSPACE), 10),
    ).resolves.toEqual([]);
  });

  it("attributes a nested Cursor workspace to its configured parent project", async () => {
    const root = fixtureRoot("cursor-project-nested-workspace");
    const nestedWorkspace = path.join(PROJECT, "packages", "editor");
    const nestedId = "60000000-0000-4000-8000-000000000006";
    fs.mkdirSync(nestedWorkspace, { recursive: true });
    writeProjectTranscript(
      root,
      nestedWorkspace,
      nestedId,
      [
        userMessage("Inspect the fictional nested editor"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: path.join(nestedWorkspace, "src", "editor.ts") },
          },
        ]),
        turnEnded("success"),
      ],
      new Date("2026-08-20T12:10:32.000Z"),
    );

    expect(
      (await new CursorSessionsAdapter(root, null).transcriptPaths(project(), 10)).map(
        (ref) => ref.id,
      ),
    ).toEqual([nestedId]);
  });

  it("does not attribute a non-parent workspace merely because it reads a project file", async () => {
    const root = fixtureRoot("cursor-project-unrelated-workspace");
    const unrelatedId = "60000000-0000-4000-8000-000000000002";
    writeProjectTranscript(
      root,
      UNRELATED_WORKSPACE,
      unrelatedId,
      [
        userMessage("Compare a fictional scratch note with another project"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Read",
            input: { path: `${PROJECT}/src/reference-note.ts` },
          },
        ]),
        turnEnded("success"),
      ],
      new Date("2026-08-20T12:11:00.000Z"),
    );
    const adapter = new CursorSessionsAdapter(root, null);

    await expect(adapter.transcriptPaths(project(), 10)).resolves.toEqual([]);
    expect(
      (await adapter.transcriptPaths(project(UNRELATED_WORKSPACE), 10)).map(
        (ref) => ref.id,
      ),
    ).toEqual([unrelatedId]);
  });

  it("recognizes target_directory and paths in live project transcript tools", async () => {
    const root = fixtureRoot("cursor-project-live-path-keys");
    const pathKeysId = "60000000-0000-4000-8000-000000000003";
    const targetDirectory = `${PROJECT}/src/features`;
    const selectedPaths = [
      `${PROJECT}/src/features/first-note.ts`,
      `${PROJECT}/src/features/second-note.ts`,
    ];
    writeProjectTranscript(
      root,
      PARENT_WORKSPACE,
      pathKeysId,
      [
        userMessage("Inspect selected fictional note paths"),
        assistantMessage([
          {
            type: "tool_use",
            name: "Glob",
            input: { target_directory: targetDirectory, glob_pattern: "*.ts" },
          },
          {
            type: "tool_use",
            name: "ReadMany",
            input: { paths: selectedPaths },
          },
        ]),
        turnEnded("success"),
      ],
      new Date("2026-08-20T12:12:00.000Z"),
    );

    const refs = await new CursorSessionsAdapter(root, null).transcriptPaths(project(), 10);
    expect(refs.map((ref) => ref.id)).toEqual([pathKeysId]);
    expect(refs[0]?.filesTouched).toEqual(
      expect.arrayContaining([targetDirectory, ...selectedPaths]),
    );
  });

  it("tolerates malformed and partially appended live transcript lines", async () => {
    const root = fixtureRoot("cursor-project-live");
    const liveId = "30000000-0000-4000-8000-000000000001";
    writeProjectTranscript(
      root,
      PROJECT,
      liveId,
      [
        userMessage("Continue a fictional live investigation"),
        assistantMessage([
          { type: "text", text: "I am checking the fictional source now." },
          {
            type: "tool_use",
            name: "Grep",
            input: { path: `${PROJECT}/src`, pattern: "fictionalMarker" },
          },
        ]),
      ],
      new Date("2026-08-20T13:00:00.000Z"),
      '{"role":"assistant","message":',
    );

    const refs = await new CursorSessionsAdapter(root, null).transcriptPaths(project(), 10);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: liveId,
      summary: "Continue a fictional live investigation",
      conclusion: "I am checking the fictional source now.",
      state: "active",
      toolUseCount: 1,
    });
  });

  it("honors source exclusion and sorts before applying the limit", async () => {
    const root = fixtureRoot("cursor-project-ordering");
    const base = Date.parse("2026-08-20T14:00:00.000Z");
    const oldestId = "40000000-0000-4000-8000-000000000001";
    const middleId = "40000000-0000-4000-8000-000000000002";
    const newestId = "40000000-0000-4000-8000-000000000003";
    for (const [id, offset] of [
      [oldestId, 1_000],
      [middleId, 2_000],
      [newestId, 3_000],
    ] as const) {
      writeProjectTranscript(
        root,
        PROJECT,
        id,
        [
          userMessage(`Run fictional ordered task ${id.slice(-1)}`),
          assistantMessage([{ type: "text", text: "The ordered task is complete." }]),
          turnEnded("success"),
        ],
        new Date(base + offset),
      );
    }
    const adapter = new CursorSessionsAdapter(root, null);

    expect((await adapter.transcriptPaths(project(), 2)).map((ref) => ref.id)).toEqual([
      newestId,
      middleId,
    ]);

    const excluded: ProjectConfig = {
      ...project(),
      transcript_sources: [{ type: "codex" }],
    };
    await expect(adapter.discover(excluded)).resolves.toBe(false);
    await expect(adapter.transcriptPaths(excluded, 10)).resolves.toEqual([]);
  });

  it("deduplicates a project transcript and legacy chat with the same session ID", async () => {
    const root = fixtureRoot("cursor-project-deduplication");
    const duplicateId = "50000000-0000-4000-8000-000000000001";
    const updatedAtMs = Date.parse("2026-08-20T15:00:00.000Z");
    writeProjectTranscript(
      root,
      PROJECT,
      duplicateId,
      [
        userMessage("Use the project transcript copy of a fictional request"),
        assistantMessage([{ type: "text", text: "The fictional request is complete." }]),
        turnEnded("success"),
      ],
      new Date(updatedAtMs),
    );
    writeLegacyShell(root, duplicateId, PROJECT, updatedAtMs - 1_000);

    const refs = await new CursorSessionsAdapter(root, null).transcriptPaths(project(), 10);
    expect(refs.filter((ref) => ref.id === duplicateId)).toHaveLength(1);
  });
});
