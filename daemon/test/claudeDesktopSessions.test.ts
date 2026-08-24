import { afterEach, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net, { type Server } from "node:net";
import path from "node:path";
import {
  ClaudeCodeSessionsAdapter,
  encodeProjectPath,
  parseClaudeSessionRef,
  parseClaudeSessionFile,
} from "../src/adapters/claudeCodeSessions.js";
import type { ProjectConfig } from "../src/types.js";
import { tmpdir } from "./helpers.js";

const CLI_SESSION_ID = "11111111-2222-4333-8444-555555555555";
const DESKTOP_SESSION_ID = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const BRIDGE_SESSION_ID = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const PRIVATE_ERROR_DETAIL = "PRIVATE_FIXTURE_ERROR_DETAIL_MUST_NOT_SURFACE";

const roots: string[] = [];
const servers: Server[] = [];
const processes: ChildProcess[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    ),
  );
  for (const child of processes.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixtureLayout(): {
  root: string;
  claudeRoot: string;
  desktopRoot: string;
  repo: string;
  project: ProjectConfig;
} {
  const root = tmpdir("claude-desktop");
  roots.push(root);
  const claudeRoot = path.join(root, "dot-claude");
  const desktopRoot = path.join(root, "application-support", "Claude");
  const repo = path.join(root, "workspace", "fixture-app");
  fs.mkdirSync(claudeRoot, { recursive: true });
  fs.mkdirSync(desktopRoot, { recursive: true });
  fs.mkdirSync(repo, { recursive: true });
  return {
    root,
    claudeRoot,
    desktopRoot,
    repo,
    project: { id: "fixture", name: "Fixture App", path: repo },
  };
}

function desktopAdapter(
  claudeRoot: string,
  desktopRoot: string | null,
): ClaudeCodeSessionsAdapter {
  return new ClaudeCodeSessionsAdapter({ claudeRoot, desktopRoot });
}

function writeCatalog(
  desktopRoot: string,
  values: {
    cwd: string;
    cliSessionId?: string;
    title?: string;
    model?: string;
    createdAt: number;
    lastActivityAt: number;
    error?: string;
    errorAt?: number;
    isArchived?: boolean;
    accountId?: string;
    bridgeId?: string;
    desktopSessionId?: string;
  },
): string {
  const accountId = values.accountId ?? "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
  const bridgeId = values.bridgeId ?? "ffffffff-1111-4222-8333-444444444444";
  const desktopSessionId = values.desktopSessionId ?? DESKTOP_SESSION_ID;
  const dir = path.join(
    desktopRoot,
    "claude-code-sessions",
    accountId,
    bridgeId,
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `local_${desktopSessionId}.json`);
  fs.writeFileSync(
    file,
    JSON.stringify({
      sessionId: desktopSessionId,
      cliSessionId: values.cliSessionId ?? CLI_SESSION_ID,
      bridgeSessionIds: [BRIDGE_SESSION_ID],
      cwd: values.cwd,
      originCwd: values.cwd,
      createdAt: values.createdAt,
      lastActivityAt: values.lastActivityAt,
      completedTurns: 2,
      title: values.title ?? "Desktop fixture thread",
      titleSource: "auto",
      model: values.model ?? "claude-fable-5",
      permissionMode: "auto",
      isArchived: values.isArchived ?? false,
      ...(values.error ? { error: values.error } : {}),
      ...(values.errorAt ? { errorAt: values.errorAt } : {}),
      // The reader must whitelist metadata fields rather than serializing this
      // connector-shaped payload into a TranscriptRef.
      remoteMcpServersConfig: [
        {
          name: "fixture-connector",
          tools: [{ name: "fixture_tool", description: PRIVATE_ERROR_DETAIL }],
        },
      ],
    }),
  );
  return file;
}

function writeTranscript(
  claudeRoot: string,
  storageCwd: string,
  sessionId: string,
  records: unknown[],
): string {
  const dir = path.join(claudeRoot, "projects", encodeProjectPath(storageCwd));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(
    file,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
  );
  return file;
}

function humanLine(
  text: string,
  timestamp: string,
  cwd: string,
  sessionId = CLI_SESSION_ID,
) {
  return {
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: { role: "user", content: text },
    origin: { kind: "human" },
    promptSource: "sdk",
    timestamp,
    cwd,
    sessionId,
    entrypoint: "claude-desktop",
    version: "2.1.229",
  };
}

function taskNotificationLine(
  text: string,
  timestamp: string,
  cwd: string,
  sessionId = CLI_SESSION_ID,
) {
  return {
    parentUuid: null,
    isSidechain: false,
    type: "user",
    message: {
      role: "user",
      content: `<task-notification>\n${text}\n</task-notification>`,
    },
    origin: { kind: "task-notification" },
    promptSource: "sdk",
    timestamp,
    cwd,
    sessionId,
    entrypoint: "claude-desktop",
    version: "2.1.229",
  };
}

function assistantLine(
  content: unknown[],
  timestamp: string,
  cwd: string,
  sessionId = CLI_SESSION_ID,
  model?: string,
) {
  return {
    parentUuid: "fixture-parent",
    isSidechain: false,
    type: "assistant",
    message: {
      role: "assistant",
      type: "message",
      content,
      stop_reason: content.some(
        (block) =>
          !!block &&
          typeof block === "object" &&
          (block as { type?: string }).type === "tool_use",
      )
        ? "tool_use"
        : "end_turn",
      ...(model ? { model } : {}),
    },
    timestamp,
    cwd,
    sessionId,
    entrypoint: "claude-desktop",
    version: "2.1.229",
  };
}

function apiErrorLine(
  timestamp: string,
  cwd: string,
  sessionId = CLI_SESSION_ID,
) {
  return {
    parentUuid: "fixture-parent",
    isSidechain: false,
    type: "assistant",
    isApiErrorMessage: true,
    apiErrorStatus: 529,
    error: PRIVATE_ERROR_DETAIL,
    message: {
      role: "assistant",
      type: "message",
      content: [{ type: "text", text: `API Error: ${PRIVATE_ERROR_DETAIL}` }],
      stop_reason: "stop_sequence",
    },
    timestamp,
    cwd,
    sessionId,
    entrypoint: "claude-desktop",
    version: "2.1.229",
  };
}

async function writeLiveRegistry(
  claudeRoot: string,
  cwd: string,
  opts: { sessionId?: string; name?: string; startedAt?: number } = {},
): Promise<{ jsonPath: string; keyPath: string }> {
  const sessionId = opts.sessionId ?? CLI_SESSION_ID;
  const sessionsDir = path.join(claudeRoot, "sessions");
  fs.mkdirSync(sessionsDir, { recursive: true });
  // Darwin limits Unix-domain socket paths to roughly 104 bytes. Keep the
  // fixture socket under a deliberately short temp root even when Vitest's
  // normal temp directory is deeply nested.
  const socketRoot = fs.mkdtempSync("/tmp/runtimebrief-claude-socket-");
  roots.push(socketRoot);
  const socketPath = path.join(socketRoot, "live.sock");
  const server = net.createServer();
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });
  const executablePath = path.join(socketRoot, "claude");
  fs.copyFileSync("/bin/sleep", executablePath);
  fs.chmodSync(executablePath, 0o755);
  const child = spawn(executablePath, ["60"], { stdio: "ignore" });
  processes.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("spawn", resolve);
  });
  if (!child.pid) throw new Error("fixture Claude process did not start");
  const jsonPath = path.join(sessionsDir, `${sessionId}.json`);
  fs.writeFileSync(
    jsonPath,
    JSON.stringify({
      pid: child.pid,
      sessionId,
      cwd,
      startedAt: opts.startedAt ?? Date.parse("2026-07-09T10:00:00Z"),
      procStart: execFileSync(
        "/bin/ps",
        ["-p", String(child.pid), "-o", "lstart="],
        {
          encoding: "utf8",
        },
      ).trim(),
      version: "2.1.229",
      peerProtocol: 1,
      kind: "interactive",
      entrypoint: "claude-desktop",
      messagingSocketPath: socketPath,
      name: opts.name ?? "Live desktop fixture",
      nameSource: "derived",
    }),
  );
  const keyPath = path.join(sessionsDir, `${sessionId}.key`);
  fs.writeFileSync(keyPath, PRIVATE_ERROR_DETAIL);
  return { jsonPath, keyPath };
}

describe("Claude desktop catalog", () => {
  it("returns a metadata-only ref with catalog title fallback", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const createdAt = Date.parse("2026-07-09T10:00:00Z");
    const lastActivityAt = Date.parse("2026-07-09T10:05:00Z");
    const catalogPath = writeCatalog(desktopRoot, {
      cwd: repo,
      createdAt,
      lastActivityAt,
      title: "Investigate fixture playback",
      model: "claude-fable-5",
    });

    const refs = await desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(
      project,
      10,
    );

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      source: "claude-code",
      id: CLI_SESSION_ID,
      path: catalogPath,
      summary: "Investigate fixture playback",
      model: "claude-fable-5",
      state: "unknown",
      toolUseCount: 0,
      filesTouched: [],
    });
    expect(refs[0]!.startedAt?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(refs[0]!.endedAt?.toISOString()).toBe("2026-07-09T10:05:00.000Z");
    expect(JSON.stringify(refs[0])).not.toContain(PRIVATE_ERROR_DETAIL);
  });

  it("joins and deduplicates a catalog record with its shared CLI JSONL", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const transcriptPath = writeTranscript(claudeRoot, repo, CLI_SESSION_ID, [
      humanLine("Start the old fixture task", "2026-07-09T10:01:00.000Z", repo),
      assistantLine(
        [{ type: "text", text: "The initial fixture work is complete." }],
        "2026-07-09T10:02:00.000Z",
        repo,
      ),
      humanLine(
        "Verify the latest fixture behavior",
        "2026-07-09T10:08:00.000Z",
        repo,
      ),
      assistantLine(
        [{ type: "text", text: "The latest fixture behavior is verified." }],
        "2026-07-09T10:09:00.000Z",
        repo,
      ),
    ]);
    writeCatalog(desktopRoot, {
      cwd: repo,
      createdAt: Date.parse("2026-07-09T10:00:00Z"),
      lastActivityAt: Date.parse("2026-07-09T10:10:00Z"),
      title: "Desktop fixture verification",
      model: "claude-fable-5",
    });

    const refs = await desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(
      project,
      10,
    );

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: CLI_SESSION_ID,
      path: transcriptPath,
      summary: "Verify the latest fixture behavior",
      conclusion: "The latest fixture behavior is verified.",
      model: "claude-fable-5",
      state: "completed",
    });
    expect(refs[0]!.startedAt?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
    expect(refs[0]!.endedAt?.toISOString()).toBe("2026-07-09T10:10:00.000Z");
  });

  it("keeps the selected duplicate metadata path aligned with its metadata", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    writeCatalog(desktopRoot, {
      cwd: repo,
      createdAt: Date.parse("2026-07-09T10:00:00Z"),
      lastActivityAt: Date.parse("2026-07-09T10:05:00Z"),
      title: "Older fixture metadata",
      accountId: "00000000-0000-4000-8000-000000000001",
      bridgeId: "00000000-0000-4000-8000-000000000002",
      desktopSessionId: "00000000-0000-4000-8000-000000000003",
    });
    const newerPath = writeCatalog(desktopRoot, {
      cwd: repo,
      createdAt: Date.parse("2026-07-09T10:00:00Z"),
      lastActivityAt: Date.parse("2026-07-09T10:10:00Z"),
      title: "Newer fixture metadata",
      accountId: "00000000-0000-4000-8000-000000000004",
      bridgeId: "00000000-0000-4000-8000-000000000005",
      desktopSessionId: "00000000-0000-4000-8000-000000000006",
    });

    const refs = await desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(
      project,
      10,
    );

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: CLI_SESSION_ID,
      path: newerPath,
      summary: "Newer fixture metadata",
    });
    const reparsed = await parseClaudeSessionRef(refs[0]!.path);
    expect(reparsed.title).toBe("Newer fixture metadata");
  });

  it("does not surface an archived metadata-only desktop thread", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const catalogPath = writeCatalog(desktopRoot, {
      cwd: repo,
      createdAt: Date.parse("2026-07-09T10:00:00Z"),
      lastActivityAt: Date.parse("2026-07-09T10:05:00Z"),
      title: "Archived fixture metadata",
      isArchived: true,
    });

    await expect(
      desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(project, 10),
    ).resolves.toEqual([]);
    const reparsed = await parseClaudeSessionRef(catalogPath);
    expect(reparsed.title).toBeNull();
    expect(reparsed.userPrompts).toEqual([]);
  });
});

describe("Claude desktop lifecycle", () => {
  it("marks a terminal API-error assistant record interrupted without surfacing its text", async () => {
    const { claudeRoot, repo } = fixtureLayout();
    const file = writeTranscript(claudeRoot, repo, CLI_SESSION_ID, [
      humanLine("Run the fixture check", "2026-07-09T10:00:00.000Z", repo),
      apiErrorLine("2026-07-09T10:01:00.000Z", repo),
    ]);

    const parsed = await parseClaudeSessionFile(file);

    expect(parsed.state).toBe("interrupted");
    expect(parsed.stateReason.toLowerCase()).toContain("api error");
    expect(parsed.finalAssistantText).toBeNull();
    expect(JSON.stringify(parsed)).not.toContain(PRIVATE_ERROR_DETAIL);
  });

  it("uses a live desktop registry as a metadata-only session and ignores its key", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const { jsonPath, keyPath } = await writeLiveRegistry(claudeRoot, repo, {
      name: "Live fixture thread",
    });

    const refs = await desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(
      project,
      10,
    );

    expect(fs.existsSync(keyPath)).toBe(true);
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      source: "claude-code",
      id: CLI_SESSION_ID,
      path: jsonPath,
      summary: "Live fixture thread",
      state: "active",
    });
    expect(JSON.stringify(refs[0])).not.toContain(PRIVATE_ERROR_DETAIL);
    expect(refs[0]!.path).not.toBe(keyPath);

    const reparsed = await parseClaudeSessionRef(jsonPath);
    expect(reparsed).toMatchObject({
      sessionId: CLI_SESSION_ID,
      title: "Live fixture thread",
      state: "active",
    });
    expect(reparsed.startedAt?.toISOString()).toBe("2026-07-09T10:00:00.000Z");
  });

  it("rejects live registries with a non-Claude process or stale process start", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const wrongProcessId = "00000000-0000-4000-8000-000000000011";
    const staleStartId = "00000000-0000-4000-8000-000000000012";
    const wrongProcess = await writeLiveRegistry(claudeRoot, repo, {
      sessionId: wrongProcessId,
    });
    const wrongProcessValue = JSON.parse(
      fs.readFileSync(wrongProcess.jsonPath, "utf8"),
    ) as Record<string, unknown>;
    wrongProcessValue.pid = process.pid;
    wrongProcessValue.procStart = execFileSync(
      "/bin/ps",
      ["-p", String(process.pid), "-o", "lstart="],
      { encoding: "utf8" },
    ).trim();
    fs.writeFileSync(wrongProcess.jsonPath, JSON.stringify(wrongProcessValue));

    const staleStart = await writeLiveRegistry(claudeRoot, repo, {
      sessionId: staleStartId,
    });
    const staleStartValue = JSON.parse(
      fs.readFileSync(staleStart.jsonPath, "utf8"),
    ) as Record<string, unknown>;
    staleStartValue.procStart = "Mon Jan  1 00:00:00 2001";
    fs.writeFileSync(staleStart.jsonPath, JSON.stringify(staleStartValue));

    await expect(
      desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(project, 10),
    ).resolves.toEqual([]);
    await expect(
      parseClaudeSessionRef(wrongProcess.jsonPath),
    ).resolves.toMatchObject({
      state: "unknown",
      sessionId: null,
    });
    await expect(
      parseClaudeSessionRef(staleStart.jsonPath),
    ).resolves.toMatchObject({
      state: "unknown",
      sessionId: null,
    });
  });

  it("uses today's genuine human prompt for a resumed desktop thread", async () => {
    const { claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const oldCreatedAt = Date.parse("2026-07-05T09:00:00Z");
    const todayActivityAt = Date.parse("2026-07-09T11:40:00Z");
    writeTranscript(claudeRoot, repo, CLI_SESSION_ID, [
      humanLine("Old fixture request", "2026-07-05T09:00:00.000Z", repo),
      assistantLine(
        [{ type: "text", text: "Old fixture request completed." }],
        "2026-07-05T09:05:00.000Z",
        repo,
        CLI_SESSION_ID,
        "claude-sonnet-4-6",
      ),
      taskNotificationLine(
        "An internal helper completed an old task.",
        "2026-07-05T09:06:00.000Z",
        repo,
      ),
      humanLine(
        "Recheck the fixture release from the phone",
        "2026-07-09T11:19:00.000Z",
        repo,
      ),
      taskNotificationLine(
        `An internal helper returned ${PRIVATE_ERROR_DETAIL}.`,
        "2026-07-09T11:39:59.000Z",
        repo,
      ),
      apiErrorLine("2026-07-09T11:40:00.000Z", repo),
    ]);
    writeCatalog(desktopRoot, {
      cwd: repo,
      createdAt: oldCreatedAt,
      lastActivityAt: todayActivityAt,
      title: "Long-running desktop fixture",
      model: "claude-fable-5",
      error: PRIVATE_ERROR_DETAIL,
      errorAt: todayActivityAt,
    });
    await writeLiveRegistry(claudeRoot, repo, { startedAt: oldCreatedAt });

    const refs = await desktopAdapter(claudeRoot, desktopRoot).transcriptPaths(
      project,
      10,
    );

    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({
      id: CLI_SESSION_ID,
      summary: "Recheck the fixture release from the phone",
      model: "claude-sonnet-4-6",
      state: "interrupted",
    });
    expect(refs[0]!.endedAt?.toISOString()).toBe("2026-07-09T11:40:00.000Z");
    expect(JSON.stringify(refs[0])).not.toContain("internal helper");
    expect(JSON.stringify(refs[0])).not.toContain(PRIVATE_ERROR_DETAIL);
  });
});

describe("Claude project attribution", () => {
  it("accepts exact and nested cwd, but requires concrete project evidence for a parent cwd", async () => {
    const { root, claudeRoot, repo, project } = fixtureLayout();
    const nested = path.join(repo, "packages", "feature");
    const parent = path.dirname(repo);
    const unrelated = path.join(root, "workspace", "unrelated-app");
    fs.mkdirSync(nested, { recursive: true });
    fs.mkdirSync(unrelated, { recursive: true });

    const exactId = "00000000-0000-4000-8000-000000000001";
    const nestedId = "00000000-0000-4000-8000-000000000002";
    const parentWithPathId = "00000000-0000-4000-8000-000000000003";
    const parentWithoutPathId = "00000000-0000-4000-8000-000000000004";
    const unrelatedId = "00000000-0000-4000-8000-000000000005";

    writeTranscript(claudeRoot, repo, exactId, [
      humanLine(
        "Exact fixture task",
        "2026-07-09T10:00:00.000Z",
        repo,
        exactId,
      ),
    ]);
    writeTranscript(claudeRoot, nested, nestedId, [
      humanLine(
        "Nested fixture task",
        "2026-07-09T10:01:00.000Z",
        nested,
        nestedId,
      ),
    ]);
    writeTranscript(claudeRoot, parent, parentWithPathId, [
      humanLine(
        "Parent workspace task",
        "2026-07-09T10:02:00.000Z",
        parent,
        parentWithPathId,
      ),
      assistantLine(
        [
          {
            type: "tool_use",
            name: "Read",
            input: { file_path: path.join(repo, "Sources", "Feature.swift") },
          },
        ],
        "2026-07-09T10:03:00.000Z",
        parent,
        parentWithPathId,
      ),
    ]);
    writeTranscript(claudeRoot, parent, parentWithoutPathId, [
      humanLine(
        "A parent workspace task with no project path",
        "2026-07-09T10:04:00.000Z",
        parent,
        parentWithoutPathId,
      ),
    ]);
    writeTranscript(claudeRoot, unrelated, unrelatedId, [
      humanLine(
        "A text-only mention of Fixture App must not attribute this session",
        "2026-07-09T10:05:00.000Z",
        unrelated,
        unrelatedId,
      ),
    ]);

    const refs = await desktopAdapter(claudeRoot, null).transcriptPaths(
      project,
      20,
    );
    const ids = new Set(refs.map((ref) => ref.id));

    expect(ids).toEqual(new Set([exactId, nestedId, parentWithPathId]));
    expect(ids.has(parentWithoutPathId)).toBe(false);
    expect(ids.has(unrelatedId)).toBe(false);
  });

  it("fails closed when two distinct paths have the same encoded directory name", async () => {
    const { root, claudeRoot } = fixtureLayout();
    const requestedRepo = path.join(root, "workspace", "fixture_app");
    const collidingRepo = path.join(root, "workspace", "fixture-app");
    fs.mkdirSync(requestedRepo, { recursive: true });
    fs.mkdirSync(collidingRepo, { recursive: true });
    expect(encodeProjectPath(requestedRepo)).toBe(
      encodeProjectPath(collidingRepo),
    );

    writeTranscript(claudeRoot, collidingRepo, CLI_SESSION_ID, [
      humanLine(
        "Work only in the colliding fixture",
        "2026-07-09T10:00:00.000Z",
        collidingRepo,
      ),
      assistantLine(
        [
          {
            type: "tool_use",
            name: "Read",
            input: {
              file_path: path.join(collidingRepo, "Sources", "OnlyThere.swift"),
            },
          },
        ],
        "2026-07-09T10:01:00.000Z",
        collidingRepo,
      ),
    ]);

    const refs = await desktopAdapter(claudeRoot, null).transcriptPaths(
      { id: "collision", name: "Requested Fixture", path: requestedRepo },
      10,
    );

    expect(refs).toEqual([]);
  });

  it("keeps canonical transcript cwd authoritative over conflicting catalog metadata", async () => {
    const { root, claudeRoot, desktopRoot, repo, project } = fixtureLayout();
    const unrelated = path.join(root, "workspace", "unrelated-app");
    fs.mkdirSync(unrelated, { recursive: true });
    const transcriptPath = writeTranscript(claudeRoot, repo, CLI_SESSION_ID, [
      humanLine(
        "Work only in the canonical fixture",
        "2026-07-09T10:00:00.000Z",
        repo,
      ),
      assistantLine(
        [{ type: "text", text: "Canonical fixture work completed." }],
        "2026-07-09T10:01:00.000Z",
        repo,
      ),
    ]);
    writeCatalog(desktopRoot, {
      cwd: unrelated,
      createdAt: Date.parse("2026-07-09T10:00:00Z"),
      lastActivityAt: Date.parse("2026-07-09T10:02:00Z"),
      title: "Conflicting catalog metadata",
      error: PRIVATE_ERROR_DETAIL,
      errorAt: Date.parse("2026-07-09T10:02:00Z"),
    });
    const adapter = desktopAdapter(claudeRoot, desktopRoot);

    const canonicalRefs = await adapter.transcriptPaths(project, 10);
    const unrelatedRefs = await adapter.transcriptPaths(
      { id: "unrelated", name: "Unrelated App", path: unrelated },
      10,
    );

    expect(canonicalRefs).toHaveLength(1);
    expect(canonicalRefs[0]).toMatchObject({
      id: CLI_SESSION_ID,
      path: transcriptPath,
      state: "completed",
      conclusion: "Canonical fixture work completed.",
    });
    expect(unrelatedRefs).toEqual([]);
    expect(JSON.stringify(canonicalRefs[0])).not.toContain(
      PRIVATE_ERROR_DETAIL,
    );
    expect(JSON.stringify(canonicalRefs[0])).not.toContain(
      "Conflicting catalog metadata",
    );
  });
});
