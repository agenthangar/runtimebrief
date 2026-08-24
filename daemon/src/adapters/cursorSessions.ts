import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { isSensitivePath } from "../secretFilter.js";
import type { ParsedSession } from "./claudeCodeSessions.js";
import { cwdMatchesProject } from "./codexSessions.js";
import type {
  ActivityEvent,
  ProjectConfig,
  RuntimeAdapter,
  TranscriptRef,
} from "../types.js";

const DEFAULT_CURSOR_ROOT = path.join(os.homedir(), ".cursor");

function defaultCursorIdeDbPath(): string {
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Cursor",
      "User",
      "globalStorage",
      "state.vscdb",
    );
  }
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  return path.join(
    os.homedir(),
    ".config",
    "Cursor",
    "User",
    "globalStorage",
    "state.vscdb",
  );
}

/**
 * Reads Cursor agent (cursor-agent CLI / Cursor IDE agent) chat sessions.
 *
 * Current Cursor releases persist local-agent JSONL below
 * `<root>/projects/<workspace>/agent-transcripts` and desktop conversation metadata in
 * the platform-specific `globalStorage/state.vscdb`. Older cursor-agent
 * releases used the following content-addressed store, which remains
 * supported for backwards compatibility (see docs/adapters.md):
 *
 *   <root>/chats/<workspace-hash>/<session-uuid>/
 *     meta.json             { cwd, createdAtMs, updatedAtMs, title, hasConversation }
 *     store.db              SQLite: content-addressed message blobs
 *     prompt_history.json   ordered real user prompts
 * where <root> defaults to ~/.cursor. Sessions are matched to a project via
 * the `cwd` field of meta.json.
 *
 * Inside store.db, table `meta` (key '0') holds hex-encoded JSON with
 * `latestRootBlobId` and `lastUsedModel`; that root blob is a protobuf whose
 * repeated field 1 lists 32-byte hashes of the conversation's message blobs
 * in order. Message blobs are JSON {role, content}; real user prompts are
 * wrapped in <user_query> tags, and harness-injected turns (<user_info>,
 * <system_reminder>, …) carry no user_query. A missing or locked store.db
 * (live sessions) degrades to metadata-only, never fails.
 */
export class CursorSessionsAdapter implements RuntimeAdapter {
  readonly id = "cursor";
  private readonly localIndexCache = new Map<
    string,
    { checkedAtMs: number; fingerprint: string; sessions: CursorLocalSessionEntry[] }
  >();
  private readonly localIndexInFlight = new Map<
    string,
    Promise<CursorLocalSessionEntry[]>
  >();
  private readonly workspacePathCache = new Map<
    string,
    { checkedAtMs: number; paths: string[] }
  >();
  private readonly ideIndexCache = new Map<
    string,
    { fingerprint: string; sessions: CursorIdeSessionEntry[] }
  >();
  private readonly ideIndexInFlight = new Map<string, Promise<CursorIdeSessionEntry[]>>();

  constructor(
    private readonly defaultRoot: string = DEFAULT_CURSOR_ROOT,
    private readonly defaultIdeDbPath: string | null =
      defaultRoot === DEFAULT_CURSOR_ROOT ? defaultCursorIdeDbPath() : null,
  ) {}

  private root(project: ProjectConfig): string {
    const override = project.transcript_sources?.find((s) => s.type === "cursor")?.root;
    return override ?? this.defaultRoot;
  }

  private ideDbPath(project: ProjectConfig): string | null {
    const override = project.transcript_sources?.find((s) => s.type === "cursor")?.root;
    if (!override) return this.defaultIdeDbPath;
    if (path.basename(override) === "state.vscdb") return override;
    for (const candidate of [
      path.join(override, "User", "globalStorage", "state.vscdb"),
      path.join(override, "globalStorage", "state.vscdb"),
      path.join(override, "state.vscdb"),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
    return null;
  }

  async discover(project: ProjectConfig): Promise<boolean> {
    // If the project explicitly lists transcript sources, honor that list.
    const sources = project.transcript_sources;
    if (sources && !sources.some((s) => s.type === "cursor")) return false;
    return (await this.transcriptPaths(project, 1)).length > 0;
  }

  async transcriptPaths(project: ProjectConfig, limit: number): Promise<TranscriptRef[]> {
    const sources = project.transcript_sources;
    if (sources && !sources.some((source) => source.type === "cursor")) return [];
    const refs: TranscriptRef[] = [];

    for (const entry of await this.localSessions(this.root(project))) {
      const matches = entry.workspaceKey
        ? cursorProjectTranscriptMatchesProject(
            entry.workspaceKey,
            project.path,
            entry.session,
            this.workspacePaths(entry.workspaceKey, project.path),
          )
        : cursorSessionMatchesProject(entry.workspacePath, project.path, entry.session);
      if (!matches) continue;
      refs.push(cursorTranscriptRef(entry.session, entry.path, entry.title));
    }

    const ideDbPath = this.ideDbPath(project);
    if (ideDbPath) {
      for (const entry of await this.ideSessions(ideDbPath)) {
        if (!cursorSessionMatchesProject(entry.workspacePath, project.path, entry.session)) {
          continue;
        }
        refs.push(cursorTranscriptRef(entry.session, entry.path, entry.title));
      }
    }

    return deduplicateCursorRefs(refs)
      .sort((a, b) => transcriptTime(b) - transcriptTime(a))
      .slice(0, limit);
  }

  private localSessions(root: string): Promise<CursorLocalSessionEntry[]> {
    const cached = this.localIndexCache.get(root);
    if (cached && Date.now() - cached.checkedAtMs < LOCAL_INDEX_RECHECK_MS) {
      return Promise.resolve(cached.sessions);
    }
    const existing = this.localIndexInFlight.get(root);
    if (existing) return existing;

    const scan = Promise.resolve().then(async () => {
      const files = scanCursorLocalSources(root);
      const current = this.localIndexCache.get(root);
      if (current?.fingerprint === files.fingerprint) {
        current.checkedAtMs = Date.now();
        return current.sessions;
      }

      const sessions: CursorLocalSessionEntry[] = [];
      for (const legacy of files.legacy) {
        if (legacy.meta.hasConversation === false) continue;
        sessions.push({
          workspacePath: legacy.meta.cwd,
          workspaceKey: null,
          session: await parseCursorSessionDir(legacy.dir),
          path: legacy.dir,
          title: legacy.meta.title,
        });
      }
      for (const transcript of files.projects) {
        sessions.push({
          workspacePath: null,
          workspaceKey: transcript.workspaceKey,
          session: await parseCursorProjectTranscript(transcript.path),
          path: transcript.path,
          title: null,
        });
      }
      this.localIndexCache.set(root, {
        checkedAtMs: Date.now(),
        fingerprint: files.fingerprint,
        sessions,
      });
      return sessions;
    });
    const shared = scan.finally(() => {
      if (this.localIndexInFlight.get(root) === shared) {
        this.localIndexInFlight.delete(root);
      }
    });
    this.localIndexInFlight.set(root, shared);
    return shared;
  }

  private workspacePaths(workspaceKey: string, projectPath: string): string[] {
    const filesystemRoot = path.parse(path.resolve(projectPath)).root;
    const cacheKey = `${filesystemRoot}\u0000${workspaceKey}`;
    const cached = this.workspacePathCache.get(cacheKey);
    if (cached && Date.now() - cached.checkedAtMs < LOCAL_INDEX_RECHECK_MS) {
      return cached.paths;
    }
    const paths = existingCursorWorkspacePaths(workspaceKey, filesystemRoot);
    this.workspacePathCache.set(cacheKey, { checkedAtMs: Date.now(), paths });
    return paths;
  }

  async recentActivity(project: ProjectConfig, since: Date): Promise<ActivityEvent[]> {
    const refs = await this.transcriptPaths(project, 20);
    return refs
      .filter((r) => (r.endedAt ?? r.startedAt ?? new Date(0)) >= since)
      .map((r) => ({
        source: this.id,
        kind: "session",
        timestamp: r.endedAt ?? r.startedAt ?? new Date(0),
        summary: r.summary ?? `Cursor session ${r.id}`,
        detail: { sessionId: r.id, path: r.path },
      }));
  }

  private ideSessions(dbPath: string): Promise<CursorIdeSessionEntry[]> {
    const fingerprint = cursorDatabaseFingerprint(dbPath);
    if (!fingerprint) return Promise.resolve([]);
    const cached = this.ideIndexCache.get(dbPath);
    if (cached?.fingerprint === fingerprint) return Promise.resolve(cached.sessions);

    const inFlightKey = `${dbPath}\u0000${fingerprint}`;
    const existing = this.ideIndexInFlight.get(inFlightKey);
    if (existing) return existing;
    const scan = Promise.resolve().then(() => listCursorIdeSessions(dbPath));
    const shared = scan
      .then((sessions) => {
        if (sessions === null) return [];
        this.ideIndexCache.set(dbPath, { fingerprint, sessions });
        return sessions;
      })
      .finally(() => {
        if (this.ideIndexInFlight.get(inFlightKey) === shared) {
          this.ideIndexInFlight.delete(inFlightKey);
        }
      });
    this.ideIndexInFlight.set(inFlightKey, shared);
    return shared;
  }
}

const LOCAL_INDEX_RECHECK_MS = 1_000;

interface CursorLocalSessionEntry {
  workspacePath: string | null;
  workspaceKey: string | null;
  session: ParsedSession;
  path: string;
  title: string | null;
}

interface CursorLocalSourceScan {
  fingerprint: string;
  legacy: SessionDirEntry[];
  projects: CursorProjectTranscriptFile[];
}

function scanCursorLocalSources(root: string): CursorLocalSourceScan {
  const legacy = listSessionDirs(path.join(root, "chats"));
  const projects = listProjectTranscriptFiles(path.join(root, "projects"));
  const fingerprint = [
    ...legacy.map((entry) =>
      [
        "legacy",
        path.relative(root, entry.dir),
        entry.meta.updatedAtMs ?? 0,
        fileStatFingerprint(path.join(entry.dir, "meta.json")),
        fileStatFingerprint(path.join(entry.dir, "store.db")),
        fileStatFingerprint(path.join(entry.dir, "store.db-wal")),
        fileStatFingerprint(path.join(entry.dir, "prompt_history.json")),
      ].join(":"),
    ),
    ...projects.map((entry) =>
      [
        "project",
        path.relative(root, entry.path),
        entry.mtimeMs,
        entry.size,
      ].join(":"),
    ),
  ].join("\n");
  return { fingerprint, legacy, projects };
}

function fileStatFingerprint(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.mtimeMs}:${stat.size}`;
  } catch {
    return "missing";
  }
}

interface CursorIdeSessionEntry {
  workspacePath: string | null;
  session: ParsedSession;
  path: string;
  title: string | null;
}

function cursorTranscriptRef(
  session: ParsedSession,
  transcriptPath: string,
  fallbackTitle: string | null,
): TranscriptRef {
  const ref: TranscriptRef = {
    source: "cursor",
    id: session.sessionId ?? path.basename(transcriptPath, ".jsonl"),
    path: transcriptPath,
    state: session.state,
    stateReason: session.stateReason,
    filesTouched: session.filesTouched,
    toolUseCount: session.toolUseCount,
  };
  if (session.startedAt) ref.startedAt = session.startedAt;
  if (session.endedAt) ref.endedAt = session.endedAt;
  const firstPrompt = session.userPrompts[0];
  if (firstPrompt) ref.summary = truncate(firstPrompt, 140);
  else if (fallbackTitle) ref.summary = truncate(fallbackTitle, 140);
  if (session.gitBranch) ref.gitBranch = session.gitBranch;
  if (session.model) ref.model = session.model;
  if (session.finalAssistantText) {
    ref.conclusion = truncate(session.finalAssistantText, 280);
  }
  return ref;
}

function transcriptTime(ref: TranscriptRef): number {
  return (ref.endedAt ?? ref.startedAt)?.getTime() ?? 0;
}

function deduplicateCursorRefs(refs: TranscriptRef[]): TranscriptRef[] {
  const unique: TranscriptRef[] = [];
  for (const ref of [...refs].sort((a, b) => transcriptTime(b) - transcriptTime(a))) {
    const format = cursorRefFormat(ref.path);
    const existing = unique.find(
      (candidate) =>
        candidate.id === ref.id && cursorRefFormat(candidate.path) !== format,
    );
    if (!existing) {
      unique.push({ ...ref });
      continue;
    }
    if (!existing.summary && ref.summary) existing.summary = ref.summary;
    if (!existing.model && ref.model) existing.model = ref.model;
    if (!existing.gitBranch && ref.gitBranch) existing.gitBranch = ref.gitBranch;
    if (!existing.conclusion && ref.conclusion) existing.conclusion = ref.conclusion;
    existing.filesTouched = [
      ...new Set([...(existing.filesTouched ?? []), ...(ref.filesTouched ?? [])]),
    ];
    existing.toolUseCount = Math.max(existing.toolUseCount ?? 0, ref.toolUseCount ?? 0);
  }
  return unique;
}

function cursorRefFormat(transcriptPath: string): "legacy" | "project-jsonl" | "ide" {
  if (transcriptPath.startsWith(CURSOR_IDE_PATH_PREFIX)) return "ide";
  if (transcriptPath.endsWith(".jsonl") && transcriptPath.includes("agent-transcripts")) {
    return "project-jsonl";
  }
  return "legacy";
}

function resolvedObservedPath(candidate: string, workspacePath: string): string | null {
  const value = filePathFromValue(candidate);
  if (!value) return null;
  return path.resolve(path.isAbsolute(value) ? value : path.join(workspacePath, value));
}

function cursorSessionMatchesProject(
  workspacePath: string | null,
  projectPath: string,
  session: ParsedSession,
): boolean {
  if (cwdMatchesProject(workspacePath, projectPath)) return true;
  if (!workspacePath || !cwdMatchesProject(projectPath, workspacePath)) return false;
  return session.filesTouched.some((candidate) => {
    const resolved = resolvedObservedPath(candidate, workspacePath);
    return resolved ? cwdMatchesProject(resolved, projectPath) : false;
  });
}

interface CursorProjectTranscriptFile {
  path: string;
  workspaceKey: string;
  mtimeMs: number;
  size: number;
}

function listProjectTranscriptFiles(projectsDir: string): CursorProjectTranscriptFile[] {
  const transcripts: CursorProjectTranscriptFile[] = [];
  let workspaceDirs: fs.Dirent[];
  try {
    workspaceDirs = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const workspaceDir of workspaceDirs) {
    if (!workspaceDir.isDirectory()) continue;
    const transcriptRoot = path.join(projectsDir, workspaceDir.name, "agent-transcripts");
    let sessionDirs: fs.Dirent[];
    try {
      sessionDirs = fs.readdirSync(transcriptRoot, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;
      const sessionPath = path.join(transcriptRoot, sessionDir.name);
      let files: fs.Dirent[];
      try {
        files = fs.readdirSync(sessionPath, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
        const filePath = path.join(sessionPath, file.name);
        try {
          const stat = fs.statSync(filePath);
          transcripts.push({
            path: filePath,
            workspaceKey: workspaceDir.name,
            mtimeMs: stat.mtimeMs,
            size: stat.size,
          });
        } catch {
          // Deleted while scanning.
        }
      }
    }
  }
  return transcripts
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, MAX_SCAN_SESSIONS);
}

function cursorWorkspaceKey(workspacePath: string): string {
  return path.resolve(workspacePath).replace(/^[/\\]+/, "").replace(/[/\\]/g, "-");
}

function cursorProjectTranscriptMatchesProject(
  workspaceKey: string,
  projectPath: string,
  session: ParsedSession,
  existingWorkspacePaths: string[],
): boolean {
  const resolvedProject = path.resolve(projectPath);
  const absoluteObservedPaths = session.filesTouched.flatMap((candidate) => {
    const value = filePathFromValue(candidate);
    return value && path.isAbsolute(value) ? [path.resolve(value)] : [];
  });

  let workspacePath: string | null = null;
  if (existingWorkspacePaths.length === 1) {
    workspacePath = existingWorkspacePaths[0]!;
  } else if (existingWorkspacePaths.length > 1) {
    // Cursor replaces path separators with hyphens, so two real workspaces can
    // share one storage key. Only concrete absolute tool evidence can safely
    // choose between those candidates; pathless or relative-only records stay
    // unassigned rather than leaking onto both project cards.
    const evidenced = existingWorkspacePaths.filter((candidate) =>
      absoluteObservedPaths.some((observed) => cwdMatchesProject(observed, candidate)),
    );
    if (evidenced.length === 1) workspacePath = evidenced[0]!;
  } else if (
    workspaceKey === cursorWorkspaceKey(resolvedProject) &&
    absoluteObservedPaths.some((observed) => cwdMatchesProject(observed, resolvedProject))
  ) {
    // The workspace may have been deleted since Cursor wrote the transcript.
    // An exact encoded key plus absolute in-project evidence remains safe.
    workspacePath = resolvedProject;
  }
  if (!workspacePath) return false;
  return cursorSessionMatchesProject(workspacePath, resolvedProject, session);
}

function existingCursorWorkspacePaths(
  workspaceKey: string,
  filesystemRoot: string,
  limit = 3,
): string[] {
  const root = path.resolve(filesystemRoot);
  const rootKey = cursorWorkspaceKey(root);
  let encodedTail = workspaceKey;
  if (rootKey) {
    if (workspaceKey === rootKey) return [root];
    if (!workspaceKey.startsWith(`${rootKey}-`)) return [];
    encodedTail = workspaceKey.slice(rootKey.length + 1);
  }
  if (!encodedTail) return [root];

  const tokens = encodedTail.split("-");
  const matches: string[] = [];
  const visit = (directory: string, tokenIndex: number): void => {
    if (matches.length >= limit) return;
    let entries: fs.Dirent[];
    try {
      entries = fs
        .readdirSync(directory, { withFileTypes: true })
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch {
      return;
    }
    for (const entry of entries) {
      if (matches.length >= limit) return;
      const parts = entry.name.split("-");
      if (
        tokenIndex + parts.length > tokens.length ||
        parts.some((part, offset) => part !== tokens[tokenIndex + offset])
      ) {
        continue;
      }
      const child = path.join(directory, entry.name);
      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = fs.statSync(child).isDirectory();
        } catch {
          isDirectory = false;
        }
      }
      if (!isDirectory) continue;
      const nextIndex = tokenIndex + parts.length;
      if (nextIndex === tokens.length) matches.push(child);
      else visit(child, nextIndex);
    }
  };
  visit(root, 0);
  return matches;
}

/** Parse Cursor 3.x local-agent JSONL under
 * ~/.cursor/projects/<workspace>/agent-transcripts/<id>/<id>.jsonl. */
export async function parseCursorProjectTranscript(filePath: string): Promise<ParsedSession> {
  const session = emptyCursorSession(path.basename(filePath, ".jsonl"));
  try {
    const stat = fs.statSync(filePath);
    const startedMs =
      Number.isFinite(stat.birthtimeMs) && stat.birthtimeMs > 0
        ? Math.min(stat.birthtimeMs, stat.mtimeMs)
        : stat.mtimeMs;
    session.startedAt = new Date(startedMs);
    session.endedAt = new Date(stat.mtimeMs);
  } catch {
    return session;
  }

  const filesTouched = new Set<string>();
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return session;
  }
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of lines) {
      if (!raw.trim()) continue;
      let record: Record<string, unknown>;
      try {
        record = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        session.malformedLines++;
        continue;
      }
      const role = stringValue(record.role);
      const message = objectValue(record.message);
      const content = message?.content;
      if (role === "user") {
        const prompt = extractUserQuery(contentText(content));
        if (prompt) {
          session.userPrompts.push(prompt);
          session.state = "active";
          session.stateReason = "The latest observed lifecycle event is a user request.";
        }
      } else if (role === "assistant") {
        const parsed = extractAssistantContent(content);
        if (parsed.text) session.finalAssistantText = parsed.text;
        if (parsed.awaitsUserInput) {
          session.state = "waiting";
          session.stateReason = "Cursor requested user input.";
        } else if (parsed.toolUses > 0) {
          session.state = "active";
          session.stateReason = "The latest observed lifecycle event is tool activity.";
        } else if (parsed.text) {
          session.state = "completed";
          session.stateReason = "The agent produced a concluding response.";
        }
        if (parsed.model && !session.model) session.model = parsed.model;
        session.toolUseCount += parsed.toolUses;
        for (const file of parsed.files) {
          if (!isSensitivePath(file)) filesTouched.add(file);
        }
      } else if (stringValue(record.type) === "turn_ended") {
        const status = stringValue(record.status)?.toLowerCase();
        if (status === "success" || status === "completed") {
          session.state = "completed";
          session.stateReason = "Cursor recorded a successful turn.";
        } else if (status === "error" || status === "aborted" || status === "cancelled") {
          session.state = "interrupted";
          session.stateReason = "Cursor recorded a stopped or failed turn.";
        }
      }
    }
  } catch {
    // Live files can be rotated or truncated while being read.
  } finally {
    lines.close();
    stream.destroy();
  }
  session.filesTouched = [...filesTouched];
  return session;
}

function cursorDatabaseFingerprint(dbPath: string): string | null {
  try {
    const main = fs.statSync(dbPath);
    let wal = "none";
    try {
      const stat = fs.statSync(`${dbPath}-wal`);
      wal = `${stat.mtimeMs}:${stat.size}`;
    } catch {
      // A closed database may not have a WAL file.
    }
    return `${main.mtimeMs}:${main.size}:${wal}`;
  } catch {
    return null;
  }
}

const CURSOR_IDE_PATH_PREFIX = "cursor-ide:";

function cursorIdeTranscriptPath(dbPath: string, composerId: string): string {
  return `${CURSOR_IDE_PATH_PREFIX}${Buffer.from(dbPath).toString("base64url")}:${composerId}`;
}

function decodeCursorIdeTranscriptPath(
  transcriptPath: string,
): { dbPath: string; composerId: string } | null {
  if (!transcriptPath.startsWith(CURSOR_IDE_PATH_PREFIX)) return null;
  const separator = transcriptPath.indexOf(":", CURSOR_IDE_PATH_PREFIX.length);
  if (separator < 0) return null;
  try {
    return {
      dbPath: Buffer.from(
        transcriptPath.slice(CURSOR_IDE_PATH_PREFIX.length, separator),
        "base64url",
      ).toString("utf8"),
      composerId: transcriptPath.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

interface CursorIdeHeaderRow {
  composerId: string;
  workspaceId: string | null;
  createdAt: number | null;
  lastUpdatedAt: number | null;
  isArchived: number | null;
  isSubagent: number | null;
  recency: number | null;
  value: unknown;
}

function listCursorIdeSessions(dbPath: string): CursorIdeSessionEntry[] | null {
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 50 });
  } catch {
    return null;
  }
  try {
    if (!hasCursorIdeTables(db)) return [];
    const workspacePaths = readCursorWorkspacePaths(dbPath);
    const rows = db
      .prepare(
        `SELECT composerId, workspaceId, createdAt, lastUpdatedAt,
                isArchived, isSubagent, recency, value
           FROM composerHeaders
          WHERE COALESCE(isSubagent, 0) = 0
          ORDER BY COALESCE(recency, lastUpdatedAt, createdAt, 0) DESC
          LIMIT ?`,
      )
      .all(MAX_SCAN_SESSIONS) as CursorIdeHeaderRow[];
    return rows.flatMap((row) => {
      const entry = readCursorIdeSession(db, dbPath, row, workspacePaths);
      if (!entry) return [];
      const hasContent =
        entry.session.userPrompts.length > 0 ||
        entry.session.finalAssistantText !== null ||
        entry.session.toolUseCount > 0;
      return hasContent ? [entry] : [];
    });
  } catch {
    return null;
  } finally {
    db.close();
  }
}

/** Parse one modern Cursor IDE composer from global state.vscdb. */
export async function parseCursorIdeSession(
  dbPath: string,
  composerId: string,
): Promise<ParsedSession> {
  const empty = emptyCursorSession(composerId);
  let db: Database.Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true, timeout: 50 });
  } catch {
    return empty;
  }
  try {
    if (!hasCursorIdeTables(db)) return empty;
    const row = db
      .prepare(
        `SELECT composerId, workspaceId, createdAt, lastUpdatedAt,
                isArchived, isSubagent, recency, value
           FROM composerHeaders WHERE composerId = ?`,
      )
      .get(composerId) as CursorIdeHeaderRow | undefined;
    if (!row) return empty;
    return (
      readCursorIdeSession(db, dbPath, row, readCursorWorkspacePaths(dbPath))?.session ?? empty
    );
  } catch {
    return empty;
  } finally {
    db.close();
  }
}

function hasCursorIdeTables(db: Database.Database): boolean {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name IN ('composerHeaders', 'cursorDiskKV')`,
    )
    .all() as { name: string }[];
  return new Set(rows.map((row) => row.name)).size === 2;
}

function readCursorIdeSession(
  db: Database.Database,
  dbPath: string,
  row: CursorIdeHeaderRow,
  workspacePaths: Map<string, string>,
): CursorIdeSessionEntry | null {
  const header = jsonObject(row.value);
  const dataRow = db.prepare("SELECT value FROM cursorDiskKV WHERE key = ?").get(
    `composerData:${row.composerId}`,
  ) as { value: unknown } | undefined;
  const data = jsonObject(dataRow?.value);
  if (!header && !data) return null;

  const session = emptyCursorSession(row.composerId);
  const filesTouched = new Set<string>();
  const createdAtMs =
    row.createdAt ?? numberValue(header?.createdAt) ?? numberValue(data?.createdAt);
  const updatedAtMs =
    row.lastUpdatedAt ??
    numberValue(header?.lastUpdatedAt) ??
    numberValue(data?.lastUpdatedAt) ??
    row.recency;
  if (createdAtMs !== null) session.startedAt = validDate(createdAtMs);
  if (updatedAtMs !== null) session.endedAt = validDate(updatedAtMs);
  session.model =
    stringValue(objectValue(data?.modelConfig)?.modelName) ??
    stringValue(data?.modelName) ??
    null;

  collectCursorIdeFiles(data, filesTouched);
  const bubbleRows = db
    .prepare("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?")
    .all(`bubbleId:${row.composerId}:%`) as { key: string; value: unknown }[];
  const bubbles = new Map<string, Record<string, unknown>>();
  for (const bubbleRow of bubbleRows) {
    const bubble = jsonObject(bubbleRow.value);
    if (!bubble) {
      session.malformedLines++;
      continue;
    }
    const id = bubbleRow.key.slice(`bubbleId:${row.composerId}:`.length);
    bubbles.set(id, bubble);
  }
  const ordered = orderedCursorIdeBubbles(data, bubbles);
  for (const bubble of ordered) {
    const bubbleDate = validDate(stringValue(bubble.createdAt));
    if (bubbleDate) {
      if (!session.startedAt || bubbleDate < session.startedAt) session.startedAt = bubbleDate;
      if (!session.endedAt || bubbleDate > session.endedAt) session.endedAt = bubbleDate;
    }
    const type = bubble.type;
    if (type === 1 || type === "user") {
      const prompt = extractUserQuery(
        stringValue(bubble.text) ?? stringValue(bubble.richText) ?? "",
      );
      if (prompt) {
        session.userPrompts.push(prompt);
        session.state = "active";
        session.stateReason = "The latest observed lifecycle event is a user request.";
      }
      continue;
    }
    if (type !== 2 && type !== "assistant") continue;
    const text = stringValue(bubble.text)?.trim() || null;
    if (text) session.finalAssistantText = text;
    const tool = objectValue(bubble.toolFormerData);
    if (tool) {
      session.toolUseCount++;
      const toolName = stringValue(tool.name);
      const toolStatus = stringValue(tool.status)?.toLowerCase() ?? "";
      const awaitsInput =
        isUserInputTool(toolName) &&
        !["completed", "success", "cancelled", "canceled", "error"].includes(toolStatus);
      if (awaitsInput) {
        session.state = "waiting";
        session.stateReason = "Cursor requested user input.";
      } else {
        session.state = "active";
        session.stateReason = "The latest observed lifecycle event is tool activity.";
      }
      for (const value of [tool.rawArgs, tool.params]) {
        const parsed = jsonValue(value);
        collectPathValues(parsed, filesTouched);
      }
    } else if (text) {
      session.state = "completed";
      session.stateReason = "The agent produced a concluding response.";
    }
  }

  const status = stringValue(data?.status)?.toLowerCase();
  const blocking = header?.hasBlockingPendingActions === true;
  if (blocking) {
    session.state = "waiting";
    session.stateReason = "Cursor is waiting on a blocking user action.";
  } else if (["aborted", "cancelled", "canceled", "error", "stopped"].includes(status ?? "")) {
    session.state = "interrupted";
    session.stateReason = "Cursor recorded a stopped or failed turn.";
  } else if (
    session.state !== "waiting" &&
    ["generating", "running", "streaming", "pending"].includes(status ?? "")
  ) {
    session.state = "active";
    session.stateReason = "Cursor is generating or running tools.";
  } else if (
    session.state !== "waiting" &&
    ["completed", "success", "done"].includes(status ?? "")
  ) {
    session.state = "completed";
    session.stateReason = "Cursor recorded a completed thread.";
  }

  session.filesTouched = [...filesTouched].filter((file) => !isSensitivePath(file));
  const workspacePath =
    cursorWorkspacePath(header) ??
    cursorWorkspacePath(data) ??
    (row.workspaceId ? workspacePaths.get(row.workspaceId) ?? null : null);
  return {
    workspacePath,
    session,
    path: cursorIdeTranscriptPath(dbPath, row.composerId),
    title: stringValue(header?.name) ?? stringValue(data?.name),
  };
}

function orderedCursorIdeBubbles(
  data: Record<string, unknown> | null,
  bubbles: Map<string, Record<string, unknown>>,
): Record<string, unknown>[] {
  const headers = arrayValue(data?.fullConversationHeadersOnly);
  const ordered: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  for (const item of headers) {
    const id = stringValue(objectValue(item)?.bubbleId);
    if (!id) continue;
    const bubble = bubbles.get(id);
    if (bubble) {
      ordered.push(bubble);
      seen.add(id);
    }
  }
  const remainder = [...bubbles.entries()]
    .filter(([id]) => !seen.has(id))
    .map(([, bubble]) => bubble)
    .sort((a, b) => dateTime(a.createdAt) - dateTime(b.createdAt));
  return [...ordered, ...remainder];
}

function collectCursorIdeFiles(
  data: Record<string, unknown> | null,
  files: Set<string>,
): void {
  const originalFileStates = objectValue(data?.originalFileStates);
  if (originalFileStates) {
    for (const key of Object.keys(originalFileStates)) addFilePath(files, key);
  }
  for (const item of arrayValue(data?.newlyCreatedFiles)) {
    const uri = objectValue(objectValue(item)?.uri);
    addFilePath(files, stringValue(uri?.fsPath) ?? stringValue(uri?.external));
  }
}

function collectPathValues(value: unknown, files: Set<string>, parentKey = ""): void {
  if (typeof value === "string") {
    const normalizedKey = parentKey.toLowerCase().replace(/[^a-z]/g, "");
    if (
      [
        "filepath",
        "targetfile",
        "path",
        "notebookpath",
        "uri",
        "targetdirectory",
        "relativeworkspacepath",
        "cwd",
        "paths",
      ].includes(normalizedKey)
    ) {
      addFilePath(files, value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathValues(item, files, parentKey);
    return;
  }
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    collectPathValues(child, files, key);
  }
}

function addFilePath(files: Set<string>, candidate: string | null): void {
  const file = candidate ? filePathFromValue(candidate) : null;
  if (file && !isSensitivePath(file)) files.add(file);
}

function filePathFromValue(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("file://")) {
    try {
      return decodeURIComponent(new URL(trimmed).pathname);
    } catch {
      return null;
    }
  }
  if (trimmed.startsWith("/")) return path.normalize(trimmed);
  return trimmed.includes("://") ? null : trimmed;
}

function cursorWorkspacePath(value: Record<string, unknown> | null): string | null {
  const identifier = objectValue(value?.workspaceIdentifier);
  const uri = objectValue(identifier?.uri);
  return filePathFromValue(stringValue(uri?.fsPath) ?? stringValue(uri?.external) ?? "");
}

function readCursorWorkspacePaths(dbPath: string): Map<string, string> {
  const result = new Map<string, string>();
  const workspaceStorage = path.join(path.dirname(path.dirname(dbPath)), "workspaceStorage");
  let dirs: fs.Dirent[];
  try {
    dirs = fs.readdirSync(workspaceStorage, { withFileTypes: true });
  } catch {
    return result;
  }
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    try {
      const config = JSON.parse(
        fs.readFileSync(path.join(workspaceStorage, dir.name, "workspace.json"), "utf8"),
      ) as Record<string, unknown>;
      const value = stringValue(config.folder) ?? stringValue(config.workspace);
      const workspacePath = value ? filePathFromValue(value) : null;
      if (workspacePath) result.set(dir.name, workspacePath);
    } catch {
      // Missing or changing workspace metadata is ignored.
    }
  }
  return result;
}

function emptyCursorSession(sessionId: string | null): ParsedSession {
  return {
    sessionId,
    startedAt: null,
    endedAt: null,
    gitBranch: null,
    model: null,
    userPrompts: [],
    finalAssistantText: null,
    filesTouched: [],
    toolUseCount: 0,
    malformedLines: 0,
    state: "unknown",
    stateReason: "No lifecycle event was found.",
  };
}

function jsonValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) value = value.toString("utf8");
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  return objectValue(jsonValue(value));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function validDate(value: number | string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateTime(value: unknown): number {
  return validDate(typeof value === "string" || typeof value === "number" ? value : null)?.getTime() ?? 0;
}

/** Cap on session dirs examined per scan, newest first. */
const MAX_SCAN_SESSIONS = 1000;

interface SessionMeta {
  cwd: string | null;
  title: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  hasConversation: boolean | null;
}

interface SessionDirEntry {
  dir: string;
  meta: SessionMeta;
}

/** All <chats>/<hash>/<uuid> session dirs with a readable meta.json,
 * newest updatedAtMs first. */
function listSessionDirs(chatsDir: string): SessionDirEntry[] {
  const sessions: SessionDirEntry[] = [];
  let hashDirs: fs.Dirent[];
  try {
    hashDirs = fs.readdirSync(chatsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const hashDir of hashDirs) {
    if (!hashDir.isDirectory()) continue;
    const hashPath = path.join(chatsDir, hashDir.name);
    let sessionDirs: fs.Dirent[];
    try {
      sessionDirs = fs.readdirSync(hashPath, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const sessionDir of sessionDirs) {
      if (!sessionDir.isDirectory()) continue;
      const dir = path.join(hashPath, sessionDir.name);
      const meta = readMetaJson(path.join(dir, "meta.json"));
      if (meta) sessions.push({ dir, meta });
    }
  }
  sessions.sort((a, b) => (b.meta.updatedAtMs ?? 0) - (a.meta.updatedAtMs ?? 0));
  return sessions.slice(0, MAX_SCAN_SESSIONS);
}

function readMetaJson(metaPath: string): SessionMeta | null {
  try {
    const raw = JSON.parse(fs.readFileSync(metaPath, "utf8")) as Record<string, unknown>;
    return {
      cwd: typeof raw.cwd === "string" ? raw.cwd : null,
      title: typeof raw.title === "string" ? raw.title : null,
      createdAtMs: typeof raw.createdAtMs === "number" ? raw.createdAtMs : null,
      updatedAtMs: typeof raw.updatedAtMs === "number" ? raw.updatedAtMs : null,
      hasConversation: typeof raw.hasConversation === "boolean" ? raw.hasConversation : null,
    };
  } catch {
    return null;
  }
}

export async function parseCursorSessionDir(sessionDir: string): Promise<ParsedSession> {
  const ide = decodeCursorIdeTranscriptPath(sessionDir);
  if (ide) return parseCursorIdeSession(ide.dbPath, ide.composerId);
  const session = emptyCursorSession(path.basename(sessionDir));
  const meta = readMetaJson(path.join(sessionDir, "meta.json"));
  if (meta?.createdAtMs) session.startedAt = new Date(meta.createdAtMs);
  if (meta?.updatedAtMs) session.endedAt = new Date(meta.updatedAtMs);

  const filesTouched = new Set<string>();
  try {
    const db = new Database(path.join(sessionDir, "store.db"), {
      readonly: true,
      fileMustExist: true,
    });
    try {
      readConversation(db, session, filesTouched);
    } finally {
      db.close();
    }
  } catch {
    // No store.db (empty session) or locked mid-write — metadata-only.
  }

  if (session.userPrompts.length === 0) {
    session.userPrompts = readPromptHistory(sessionDir);
  }
  session.filesTouched = [...filesTouched];
  return session;
}

function readConversation(
  db: Database.Database,
  session: ParsedSession,
  filesTouched: Set<string>,
): void {
  const metaRow = db.prepare("SELECT value FROM meta WHERE key = '0'").get() as
    | { value: string }
    | undefined;
  if (!metaRow) return;
  let rootBlobId: string | null = null;
  try {
    const storeMeta = JSON.parse(Buffer.from(metaRow.value, "hex").toString("utf8")) as {
      agentId?: string;
      latestRootBlobId?: string;
      lastUsedModel?: string;
    };
    if (typeof storeMeta.agentId === "string") session.sessionId = storeMeta.agentId;
    if (typeof storeMeta.lastUsedModel === "string") session.model = storeMeta.lastUsedModel;
    rootBlobId = storeMeta.latestRootBlobId ?? null;
  } catch {
    return;
  }
  if (!rootBlobId) return;

  const getBlob = db.prepare("SELECT data FROM blobs WHERE id = ?");
  const root = getBlob.get(rootBlobId) as { data: Buffer } | undefined;
  if (!root) return;

  for (const blobId of messageBlobIds(root.data)) {
    const row = getBlob.get(blobId) as { data: Buffer } | undefined;
    if (!row) continue;
    let message: { role?: string; content?: unknown };
    try {
      message = JSON.parse(row.data.toString("utf8")) as typeof message;
    } catch {
      session.malformedLines++;
      continue;
    }
    if (message.role === "user") {
      const text = extractUserQuery(contentText(message.content));
      if (text) {
        session.userPrompts.push(text);
        session.state = "active";
        session.stateReason = "The latest observed lifecycle event is a user request.";
      }
    } else if (message.role === "assistant") {
      const { text, toolUses, files, model, awaitsUserInput } =
        extractAssistantContent(message.content);
      if (text) session.finalAssistantText = text;
      if (awaitsUserInput) {
        session.state = "waiting";
        session.stateReason = "Cursor requested user input.";
      } else if (toolUses > 0) {
        session.state = "active";
        session.stateReason = "The latest observed lifecycle event is tool activity.";
      } else if (text) {
        session.state = "completed";
        session.stateReason = "The agent produced a concluding response.";
      }
      if (model && !session.model) session.model = model;
      session.toolUseCount += toolUses;
      for (const f of files) {
        if (!isSensitivePath(f)) filesTouched.add(f);
      }
    }
    // system / tool messages are context or tool output — skipped.
  }
}

/**
 * The root blob is a protobuf; its repeated field 1 holds the conversation's
 * message blob hashes (32 bytes each) in order. Minimal tolerant scan: walk
 * tags, collect field-1 length-32 chunks, skip everything else.
 */
export function messageBlobIds(root: Buffer): string[] {
  const ids: string[] = [];
  let pos = 0;
  const readVarint = (): number | null => {
    let value = 0;
    let shift = 0;
    while (pos < root.length) {
      const byte = root[pos++]!;
      value += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return value;
      shift += 7;
      if (shift > 49) return null; // overlong — corrupted
    }
    return null;
  };
  while (pos < root.length) {
    const tag = readVarint();
    if (tag === null) break;
    const wire = tag & 7;
    if (wire === 2) {
      const len = readVarint();
      if (len === null || pos + len > root.length) break;
      if (tag >> 3 === 1 && len === 32) {
        ids.push(root.subarray(pos, pos + 32).toString("hex"));
      }
      pos += len;
    } else if (wire === 0) {
      if (readVarint() === null) break;
    } else if (wire === 1) {
      pos += 8;
    } else if (wire === 5) {
      pos += 4;
    } else {
      break; // group wires unused here — corrupted input
    }
  }
  return ids;
}

/** Flatten a message's content (string or block array) to its text parts. */
function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter(
      (b): b is { type: string; text: string } =>
        !!b &&
        typeof b === "object" &&
        (b as { type?: string }).type === "text" &&
        typeof (b as { text?: unknown }).text === "string",
    )
    .map((b) => b.text)
    .join("\n");
}

/**
 * Real prompts arrive wrapped in <user_query> tags; harness-injected turns
 * (<user_info>, <system_reminder>, <timestamp>, …) have none and are skipped
 * unless the whole text is tag-free (defensive, for other cursor versions).
 */
export function extractUserQuery(text: string): string | null {
  const matches = [...text.matchAll(/<user_query>([\s\S]*?)<\/user_query>/g)];
  if (matches.length > 0) {
    const joined = matches
      .map((m) => m[1]!.trim())
      .filter((t) => t.length > 0)
      .join("\n");
    return joined.length > 0 ? joined : null;
  }
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.startsWith("<")) return null;
  return trimmed;
}

function extractAssistantContent(content: unknown): {
  text: string | null;
  toolUses: number;
  files: string[];
  model: string | null;
  awaitsUserInput: boolean;
} {
  if (!Array.isArray(content)) {
    return {
      text: null,
      toolUses: 0,
      files: [],
      model: null,
      awaitsUserInput: false,
    };
  }
  const texts: string[] = [];
  const files = new Set<string>();
  let toolUses = 0;
  let model: string | null = null;
  let awaitsUserInput = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as {
      type?: string;
      text?: unknown;
      args?: unknown;
      input?: unknown;
      toolName?: unknown;
      name?: unknown;
      providerOptions?: { cursor?: { modelName?: unknown } };
    };
    const blockModel = b.providerOptions?.cursor?.modelName;
    if (typeof blockModel === "string" && !model) model = blockModel;
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      texts.push(b.text.trim());
    } else if (b.type === "tool-call" || b.type === "tool_use") {
      toolUses++;
      const toolName =
        typeof b.toolName === "string"
          ? b.toolName
          : typeof b.name === "string"
            ? b.name
            : null;
      if (isUserInputTool(toolName)) {
        awaitsUserInput = true;
      }
      collectPathValues(b.args ?? b.input ?? {}, files);
    }
    // redacted-reasoning blocks are encrypted internal reasoning — never surfaced.
  }
  return {
    text: texts.length > 0 ? texts.join("\n") : null,
    toolUses,
    files: [...files],
    model,
    awaitsUserInput,
  };
}

function isUserInputTool(toolName: string | null): boolean {
  if (!toolName) return false;
  const normalized = toolName.toLowerCase().replace(/[^a-z0-9]/g, "");
  return [
    "askuserquestion",
    "requestuserinput",
    "askquestion",
    "requestinput",
  ].includes(normalized);
}

/** Fallback when store.db is unreadable: the prompt list on disk. It is
 * stored newest-first (verified live), so reverse to chronological order. */
function readPromptHistory(sessionDir: string): string[] {
  try {
    const raw = JSON.parse(
      fs.readFileSync(path.join(sessionDir, "prompt_history.json"), "utf8"),
    ) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
      .reverse();
  } catch {
    return [];
  }
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}
