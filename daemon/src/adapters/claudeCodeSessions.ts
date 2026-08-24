import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { execFileSync } from "node:child_process";
import { isSensitivePath } from "../secretFilter.js";
import type {
  ActivityEvent,
  ProjectConfig,
  RuntimeAdapter,
  SessionState,
  TranscriptRef,
} from "../types.js";

/**
 * Reads Claude Desktop Code-mode and Claude Code CLI sessions.
 *
 * Layout verified empirically (Claude Code 2.1.x, see docs/adapters.md):
 *   <root>/projects/<encoded-project-path>/<session-uuid>.jsonl
 * where <root> defaults to ~/.claude and the encoded path replaces every
 * non-alphanumeric character of the absolute project path with "-"
 * (e.g. /home/user/RuntimeBrief → -home-user-RuntimeBrief).
 *
 * Desktop and CLI share this transcript tree. Claude Desktop catalog metadata
 * and the live ~/.claude/sessions registry are joined by cli/session id.
 *
 * Each line is a JSON record. Observed `type` values: "user", "assistant",
 * "attachment", "queue-operation", "last-prompt", "summary", "system",
 * "progress", "file-history-snapshot". Only user/assistant lines carry
 * conversation content; everything else is skipped. Malformed or truncated
 * lines (live sessions get appended to mid-write) are skipped silently.
 */
const DEFAULT_CLAUDE_ROOT = path.join(os.homedir(), ".claude");
const DEFAULT_CLAUDE_DESKTOP_ROOT = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "Claude",
);
const INDEX_CACHE_TTL_MS = 250;

export interface ClaudeCodeSessionsOptions {
  claudeRoot?: string;
  /** Claude's Application Support directory, or null to disable desktop metadata. */
  desktopRoot?: string | null;
}

interface StorageFile {
  path: string;
  mtimeMs: number;
  size: number;
  workspaceKey?: string;
}

interface ClaudeStorageInventory {
  fingerprint: string;
  transcripts: StorageFile[];
  desktopMetadata: StorageFile[];
  liveSessions: StorageFile[];
}

interface ClaudeDesktopMetadata {
  sessionId: string | null;
  cliSessionId: string | null;
  cwd: string | null;
  originCwd: string | null;
  title: string | null;
  model: string | null;
  createdAt: Date | null;
  lastActivityAt: Date | null;
  completedTurns: number;
  errorAt: Date | null;
  hasError: boolean;
  isArchived: boolean;
}

interface ClaudeLiveSession {
  sessionId: string | null;
  cwd: string | null;
  name: string | null;
  startedAt: Date | null;
  pid: number | null;
  entrypoint: string | null;
  procStart: string | null;
}

interface IndexedClaudeSession {
  id: string;
  path: string;
  workspaceKey: string | null;
  mtimeMs: number;
  parsed: ParsedSession | null;
  desktop: ClaudeDesktopMetadata | null;
  live: ClaudeLiveSession | null;
}

export class ClaudeCodeSessionsAdapter implements RuntimeAdapter {
  readonly id = "claude-code";
  private readonly defaultRoot: string;
  private readonly defaultDesktopRoot: string | null;
  private readonly indexCache = new Map<
    string,
    {
      checkedAtMs: number;
      fingerprint: string;
      sessions: IndexedClaudeSession[];
    }
  >();
  private readonly indexInFlight = new Map<
    string,
    Promise<IndexedClaudeSession[]>
  >();

  constructor(rootOrOptions: string | ClaudeCodeSessionsOptions = {}) {
    if (typeof rootOrOptions === "string") {
      this.defaultRoot = rootOrOptions;
      // A custom transcript root is normally a fixture or an explicit isolated
      // store. Never make that silently read the developer's live desktop data.
      this.defaultDesktopRoot = null;
    } else {
      this.defaultRoot = rootOrOptions.claudeRoot ?? DEFAULT_CLAUDE_ROOT;
      this.defaultDesktopRoot =
        rootOrOptions.desktopRoot === undefined
          ? DEFAULT_CLAUDE_DESKTOP_ROOT
          : rootOrOptions.desktopRoot;
    }
  }

  private roots(project: ProjectConfig): {
    claudeRoot: string;
    desktopRoot: string | null;
  } {
    const override = project.transcript_sources?.find(
      (source) => source.type === "claude-code",
    )?.root;
    return override
      ? { claudeRoot: override, desktopRoot: null }
      : { claudeRoot: this.defaultRoot, desktopRoot: this.defaultDesktopRoot };
  }

  private sessionIndex(
    project: ProjectConfig,
  ): Promise<IndexedClaudeSession[]> {
    const roots = this.roots(project);
    const key = `${roots.claudeRoot}\u0000${roots.desktopRoot ?? ""}`;
    const now = Date.now();
    const cached = this.indexCache.get(key);
    if (cached && now - cached.checkedAtMs < INDEX_CACHE_TTL_MS) {
      return Promise.resolve(cached.sessions);
    }
    const existing = this.indexInFlight.get(key);
    if (existing) return existing;

    const inventory = inventoryClaudeStorage(
      roots.claudeRoot,
      roots.desktopRoot,
    );
    if (cached?.fingerprint === inventory.fingerprint) {
      cached.checkedAtMs = now;
      return Promise.resolve(cached.sessions);
    }
    const scan = buildClaudeSessionIndex(inventory).then((sessions) => {
      this.indexCache.set(key, {
        checkedAtMs: Date.now(),
        fingerprint: inventory.fingerprint,
        sessions,
      });
      return sessions;
    });
    const shared = scan.finally(() => {
      if (this.indexInFlight.get(key) === shared)
        this.indexInFlight.delete(key);
    });
    this.indexInFlight.set(key, shared);
    return shared;
  }

  async discover(project: ProjectConfig): Promise<boolean> {
    const sources = project.transcript_sources;
    if (sources && !sources.some((source) => source.type === "claude-code"))
      return false;
    return (await this.transcriptPaths(project, 1)).length > 0;
  }

  async transcriptPaths(
    project: ProjectConfig,
    limit: number,
  ): Promise<TranscriptRef[]> {
    const sources = project.transcript_sources;
    if (sources && !sources.some((source) => source.type === "claude-code"))
      return [];
    const refs: TranscriptRef[] = [];
    for (const entry of await this.sessionIndex(project)) {
      const session = combinedClaudeSession(entry);
      if (!claudeSessionMatchesProject(session, project.path)) continue;
      // Earlier analyst versions persisted their own read-only analysis runs
      // into the project's Claude history. Hide those historical runs too, so
      // only real project work is surfaced after an upgrade.
      if (isLegacyAnalystSession(session)) continue;
      const ref: TranscriptRef = {
        source: this.id,
        id: entry.id,
        path: entry.path,
        state: session.state,
        stateReason: session.stateReason,
        filesTouched: session.filesTouched,
        toolUseCount: session.toolUseCount,
      };
      if (session.startedAt) ref.startedAt = session.startedAt;
      if (session.endedAt) ref.endedAt = session.endedAt;
      const latestPrompt = session.userPrompts.at(-1);
      const summary = latestPrompt ?? session.title;
      if (summary) ref.summary = truncate(summary, 140);
      if (session.title) ref.title = session.title;
      if (session.gitBranch) ref.gitBranch = session.gitBranch;
      if (session.model) ref.model = session.model;
      if (session.finalAssistantText)
        ref.conclusion = truncate(session.finalAssistantText, 280);
      refs.push(ref);
    }
    refs.sort(
      (a, b) =>
        ((b.endedAt ?? b.startedAt)?.getTime() ?? 0) -
        ((a.endedAt ?? a.startedAt)?.getTime() ?? 0),
    );
    return refs.slice(0, limit);
  }

  async recentActivity(
    project: ProjectConfig,
    since: Date,
  ): Promise<ActivityEvent[]> {
    const refs = await this.transcriptPaths(project, 20);
    return refs
      .filter((r) => (r.endedAt ?? r.startedAt ?? new Date(0)) >= since)
      .map((r) => ({
        source: this.id,
        kind: "session",
        timestamp: r.endedAt ?? r.startedAt ?? new Date(0),
        summary: r.summary ?? `Claude Code session ${r.id}`,
        detail: { sessionId: r.id, path: r.path },
      }));
  }
}

function statStorageFile(
  filePath: string,
  workspaceKey?: string,
): StorageFile | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const file: StorageFile = {
      path: filePath,
      mtimeMs: stat.mtimeMs,
      size: stat.size,
    };
    if (workspaceKey) file.workspaceKey = workspaceKey;
    return file;
  } catch {
    return null;
  }
}

function inventoryClaudeStorage(
  claudeRoot: string,
  desktopRoot: string | null,
): ClaudeStorageInventory {
  const transcripts: StorageFile[] = [];
  const projectsRoot = path.join(claudeRoot, "projects");
  try {
    for (const workspace of fs.readdirSync(projectsRoot, {
      withFileTypes: true,
    })) {
      if (!workspace.isDirectory()) continue;
      const workspaceDir = path.join(projectsRoot, workspace.name);
      let files: fs.Dirent[];
      try {
        files = fs.readdirSync(workspaceDir, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
        const item = statStorageFile(
          path.join(workspaceDir, file.name),
          workspace.name,
        );
        if (item) transcripts.push(item);
      }
    }
  } catch {
    // Missing Claude Code transcript root is a valid empty store.
  }

  const desktopMetadata: StorageFile[] = [];
  if (desktopRoot) {
    const catalogRoot = path.join(desktopRoot, "claude-code-sessions");
    try {
      for (const account of fs.readdirSync(catalogRoot, {
        withFileTypes: true,
      })) {
        if (!account.isDirectory()) continue;
        const accountDir = path.join(catalogRoot, account.name);
        for (const bridge of fs.readdirSync(accountDir, {
          withFileTypes: true,
        })) {
          if (!bridge.isDirectory()) continue;
          const bridgeDir = path.join(accountDir, bridge.name);
          for (const file of fs.readdirSync(bridgeDir, {
            withFileTypes: true,
          })) {
            if (
              !file.isFile() ||
              !file.name.startsWith("local_") ||
              !file.name.endsWith(".json")
            ) {
              continue;
            }
            const item = statStorageFile(path.join(bridgeDir, file.name));
            if (item) desktopMetadata.push(item);
          }
        }
      }
    } catch {
      // Claude Desktop is optional.
    }
  }

  const liveSessions: StorageFile[] = [];
  const liveRoot = path.join(claudeRoot, "sessions");
  try {
    for (const file of fs.readdirSync(liveRoot, { withFileTypes: true })) {
      // The sibling .key contains a private transport key and must never be read.
      if (!file.isFile() || !file.name.endsWith(".json")) continue;
      const item = statStorageFile(path.join(liveRoot, file.name));
      if (item) liveSessions.push(item);
    }
  } catch {
    // Live registry exists only while Claude Code sessions are running.
  }

  const all = [...transcripts, ...desktopMetadata, ...liveSessions].sort(
    (a, b) => a.path.localeCompare(b.path),
  );
  return {
    transcripts,
    desktopMetadata,
    liveSessions,
    fingerprint: all
      .map((file) => `${file.path}\u0000${file.mtimeMs}\u0000${file.size}`)
      .join("\u0001"),
  };
}

async function buildClaudeSessionIndex(
  inventory: ClaudeStorageInventory,
): Promise<IndexedClaudeSession[]> {
  const byId = new Map<string, IndexedClaudeSession>();
  for (const file of inventory.transcripts) {
    const parsed = await parseClaudeSessionFile(file.path);
    const id = parsed.sessionId ?? path.basename(file.path, ".jsonl");
    const existing = byId.get(id);
    if (!existing || file.mtimeMs >= existing.mtimeMs) {
      byId.set(id, {
        id,
        path: file.path,
        workspaceKey: file.workspaceKey ?? null,
        mtimeMs: file.mtimeMs,
        parsed,
        desktop: existing?.desktop ?? null,
        live: existing?.live ?? null,
      });
    }
  }

  const desktopById = new Map<
    string,
    { file: StorageFile; metadata: ClaudeDesktopMetadata }
  >();
  for (const file of inventory.desktopMetadata) {
    const desktop = readClaudeDesktopMetadata(file.path);
    if (!desktop) continue;
    const id = desktop.cliSessionId ?? desktop.sessionId;
    if (!id) continue;
    const selected = desktopById.get(id);
    const candidateTime = desktop.lastActivityAt?.getTime() ?? file.mtimeMs;
    const selectedTime = selected
      ? (selected.metadata.lastActivityAt?.getTime() ?? selected.file.mtimeMs)
      : Number.NEGATIVE_INFINITY;
    if (
      !selected ||
      candidateTime > selectedTime ||
      (candidateTime === selectedTime &&
        file.path.localeCompare(selected.file.path) > 0)
    ) {
      desktopById.set(id, { file, metadata: desktop });
    }
  }

  for (const [id, selected] of desktopById) {
    const { file, metadata: desktop } = selected;
    // Archiving a desktop catalog row must not resurrect a metadata-only thread.
    // A canonical CLI transcript remains independently discoverable.
    if (desktop.isArchived) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, {
        id,
        path: file.path,
        workspaceKey: null,
        mtimeMs: file.mtimeMs,
        parsed: null,
        desktop,
        live: null,
      });
    } else {
      existing.desktop = desktop;
      existing.mtimeMs = Math.max(existing.mtimeMs, file.mtimeMs);
      // Metadata-only duplicates must retain the path of the selected record so
      // the analyst reparses the same metadata that produced the ref.
      if (!existing.parsed) existing.path = file.path;
    }
  }

  for (const file of inventory.liveSessions) {
    const live = readClaudeLiveSession(file.path);
    if (!live?.sessionId || !liveSessionIsCurrent(live)) continue;
    const existing = byId.get(live.sessionId);
    if (!existing) {
      byId.set(live.sessionId, {
        id: live.sessionId,
        path: file.path,
        workspaceKey: null,
        mtimeMs: file.mtimeMs,
        parsed: null,
        desktop: null,
        live,
      });
    } else {
      existing.live = live;
      existing.mtimeMs = Math.max(existing.mtimeMs, file.mtimeMs);
      // A live registry is the authoritative backing ref until a canonical
      // transcript exists. This keeps metadata-only analyst reparsing coherent.
      if (!existing.parsed) existing.path = file.path;
    }
  }

  return [...byId.values()].sort(
    (a, b) => combinedSessionTimestamp(b) - combinedSessionTimestamp(a),
  );
}

function readJsonObject(filePath: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function dateValue(value: unknown): Date | null {
  const raw =
    typeof value === "number" || typeof value === "string" ? value : null;
  if (raw === null) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function readClaudeDesktopMetadata(
  filePath: string,
): ClaudeDesktopMetadata | null {
  const value = readJsonObject(filePath);
  if (!value) return null;
  return {
    sessionId: stringValue(value.sessionId),
    cliSessionId: stringValue(value.cliSessionId),
    cwd: stringValue(value.cwd),
    originCwd: stringValue(value.originCwd),
    title: stringValue(value.title),
    model: stringValue(value.model),
    createdAt: dateValue(value.createdAt),
    lastActivityAt: dateValue(value.lastActivityAt),
    completedTurns: numberValue(value.completedTurns) ?? 0,
    errorAt: dateValue(value.errorAt),
    hasError: stringValue(value.error) !== null,
    isArchived: value.isArchived === true,
  };
}

function isClaudeLiveRegistryObject(value: Record<string, unknown>): boolean {
  return "messagingSocketPath" in value && "pid" in value;
}

function readClaudeLiveSession(filePath: string): ClaudeLiveSession | null {
  const value = readJsonObject(filePath);
  if (!value) return null;
  const socketPath = stringValue(value.messagingSocketPath);
  let socketExists = false;
  if (socketPath) {
    try {
      socketExists = fs.statSync(socketPath).isSocket();
    } catch {
      socketExists = false;
    }
  }
  if (!socketExists) return null;
  return {
    sessionId: stringValue(value.sessionId),
    cwd: stringValue(value.cwd),
    name: stringValue(value.name),
    startedAt: dateValue(value.startedAt),
    pid: numberValue(value.pid),
    entrypoint: stringValue(value.entrypoint),
    procStart: stringValue(value.procStart),
  };
}

interface RunningProcessIdentity {
  executable: string;
  startedAt: string;
}

function runningProcessIdentity(pid: number): RunningProcessIdentity | null {
  try {
    const executable = execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "comm="],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    const startedAt = execFileSync(
      "/bin/ps",
      ["-p", String(pid), "-o", "lstart="],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    ).trim();
    return executable && startedAt ? { executable, startedAt } : null;
  } catch {
    return null;
  }
}

function isClaudeExecutable(executable: string): boolean {
  const name = path.basename(executable).toLowerCase();
  return name === "claude" || name === "claude-code";
}

function processStartMatches(recorded: string, observed: string): boolean {
  const normalizedRecorded = recorded.replace(/\s+/g, " ").trim();
  const normalizedObserved = observed.replace(/\s+/g, " ").trim();
  if (normalizedRecorded === normalizedObserved) return true;

  const observedAt = Date.parse(observed);
  if (!Number.isFinite(observedAt)) return false;
  const recordedCandidates = [Date.parse(recorded)];
  // Claude Desktop currently records a UTC clock string without an explicit
  // zone, while `ps lstart` renders local time. Accept either interpretation.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(recorded.trim())) {
    recordedCandidates.push(Date.parse(`${recorded} UTC`));
  }
  return recordedCandidates.some(
    (candidate) =>
      Number.isFinite(candidate) && Math.abs(candidate - observedAt) <= 2_000,
  );
}

function liveSessionIsCurrent(live: ClaudeLiveSession): boolean {
  if (!live.pid || live.pid <= 0 || !live.procStart) return false;
  const processIdentity = runningProcessIdentity(live.pid);
  return (
    !!processIdentity &&
    isClaudeExecutable(processIdentity.executable) &&
    processStartMatches(live.procStart, processIdentity.startedAt)
  );
}

function emptyParsedSession(): ParsedSession {
  return {
    sessionId: null,
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
    cwd: null,
    workspacePaths: [],
    title: null,
  };
}

function minDate(...values: Array<Date | null | undefined>): Date | null {
  const dates = values.filter((value): value is Date => value instanceof Date);
  return dates.length > 0
    ? new Date(Math.min(...dates.map((date) => date.getTime())))
    : null;
}

function maxDate(...values: Array<Date | null | undefined>): Date | null {
  const dates = values.filter((value): value is Date => value instanceof Date);
  return dates.length > 0
    ? new Date(Math.max(...dates.map((date) => date.getTime())))
    : null;
}

function pathsAreRelated(left: string, right: string): boolean {
  return pathIsWithin(left, right) || pathIsWithin(right, left);
}

function metadataWorkspacePaths(
  desktop: ClaudeDesktopMetadata | null,
  live: ClaudeLiveSession | null,
): string[] {
  return [desktop?.cwd, desktop?.originCwd, live?.cwd].filter(
    (value): value is string => !!value,
  );
}

function combinedClaudeSession(entry: IndexedClaudeSession): ParsedSession {
  const session: ParsedSession = entry.parsed
    ? {
        ...entry.parsed,
        userPrompts: [...entry.parsed.userPrompts],
        filesTouched: [...entry.parsed.filesTouched],
        workspacePaths: [...(entry.parsed.workspacePaths ?? [])],
      }
    : emptyParsedSession();
  let desktop = entry.desktop;
  let live = entry.live;
  const canonicalCwd = entry.parsed?.cwd ?? null;
  if (canonicalCwd) {
    // A same-id catalog/registry row may be stale or corrupt. Never let an
    // unrelated supplemental cwd broaden a canonical transcript into a sibling
    // project or override its lifecycle metadata.
    if (
      desktop &&
      [desktop.cwd, desktop.originCwd]
        .filter((value): value is string => !!value)
        .some((value) => !pathsAreRelated(value, canonicalCwd))
    ) {
      desktop = null;
    }
    if (live?.cwd && !pathsAreRelated(live.cwd, canonicalCwd)) live = null;
  } else {
    const anchor = live?.cwd ?? desktop?.cwd ?? desktop?.originCwd ?? null;
    if (
      anchor &&
      desktop &&
      [desktop.cwd, desktop.originCwd]
        .filter((value): value is string => !!value)
        .some((value) => !pathsAreRelated(value, anchor))
    ) {
      desktop = null;
    }
    if (anchor && live?.cwd && !pathsAreRelated(live.cwd, anchor)) live = null;
  }
  session.sessionId = session.sessionId ?? entry.id;
  session.startedAt = minDate(
    session.startedAt,
    desktop?.createdAt,
    live?.startedAt,
  );
  session.endedAt = maxDate(session.endedAt, desktop?.lastActivityAt);
  session.cwd =
    canonicalCwd ?? live?.cwd ?? desktop?.cwd ?? desktop?.originCwd ?? null;
  const workspaceAnchor = session.cwd;
  session.workspacePaths = [
    ...new Set(
      [
        ...(entry.parsed?.workspacePaths ?? []),
        session.cwd,
        ...metadataWorkspacePaths(desktop, live),
      ].filter(
        (value): value is string =>
          !!value &&
          (!workspaceAnchor || pathsAreRelated(value, workspaceAnchor)),
      ),
    ),
  ];
  session.title = session.title ?? desktop?.title ?? live?.name ?? null;
  session.model = session.model ?? desktop?.model ?? null;

  const parsedEnd = entry.parsed?.endedAt?.getTime() ?? 0;
  const errorAt =
    desktop?.errorAt?.getTime() ?? desktop?.lastActivityAt?.getTime() ?? 0;
  if (desktop?.hasError && errorAt >= parsedEnd) {
    session.state = "interrupted";
    session.stateReason = "Claude Desktop recorded an API error.";
    session.finalAssistantText = null;
  } else if (!entry.parsed && live) {
    session.state = "active";
    session.stateReason = "Claude Code has a live local session.";
  }
  return session;
}

function combinedSessionTimestamp(entry: IndexedClaudeSession): number {
  const session = combinedClaudeSession(entry);
  return (session.endedAt ?? session.startedAt)?.getTime() ?? entry.mtimeMs;
}

function pathIsWithin(candidate: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function claudeSessionMatchesProject(
  session: ParsedSession,
  projectPath: string,
): boolean {
  const workspaces =
    session.workspacePaths ?? (session.cwd ? [session.cwd] : []);
  if (workspaces.some((workspace) => pathIsWithin(workspace, projectPath)))
    return true;
  for (const workspace of workspaces) {
    if (!pathIsWithin(projectPath, workspace)) continue;
    if (
      session.filesTouched.some((file) => {
        const resolved = path.isAbsolute(file)
          ? path.resolve(file)
          : path.resolve(workspace, file);
        return pathIsWithin(resolved, projectPath);
      })
    ) {
      return true;
    }
  }
  return false;
}

/** Parse either a canonical JSONL or a metadata-only Claude desktop ref. */
export async function parseClaudeSessionRef(
  filePath: string,
): Promise<ParsedSession> {
  if (filePath.endsWith(".jsonl")) return parseClaudeSessionFile(filePath);
  const value = readJsonObject(filePath);
  if (!value) return emptyParsedSession();
  if (isClaudeLiveRegistryObject(value)) {
    const live = readClaudeLiveSession(filePath);
    if (!live?.sessionId || !liveSessionIsCurrent(live))
      return emptyParsedSession();
    return combinedClaudeSession({
      id: live.sessionId,
      path: filePath,
      workspaceKey: null,
      mtimeMs: 0,
      parsed: null,
      desktop: null,
      live,
    });
  }
  const desktop = readClaudeDesktopMetadata(filePath);
  if (!desktop?.isArchived && (desktop?.cliSessionId || desktop?.sessionId)) {
    return combinedClaudeSession({
      id: desktop.cliSessionId ?? desktop.sessionId!,
      path: filePath,
      workspaceKey: null,
      mtimeMs: 0,
      parsed: null,
      desktop,
      live: null,
    });
  }
  return emptyParsedSession();
}

/** Recognize the structured prompt emitted by buildAnalystPrompt(). */
export function isLegacyAnalystSession(session: ParsedSession): boolean {
  const prompt = session.userPrompts[0];
  if (!prompt) return false;
  return (
    prompt.startsWith('Question about the project "') &&
    prompt.includes("\n\n## Git state\n\n") &&
    prompt.includes("\n\n## Recent agent sessions") &&
    prompt.endsWith(
      "You may also inspect the repository directly with the Read, Grep and Glob tools if the summaries above are insufficient.",
    )
  );
}

/** Absolute path → Claude Code project directory name. */
export function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/[^a-zA-Z0-9]/g, "-");
}

export interface ParsedSession {
  sessionId: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  gitBranch: string | null;
  model: string | null;
  userPrompts: string[];
  /** Last assistant text output in the main thread (what the agent concluded). */
  finalAssistantText: string | null;
  filesTouched: string[];
  toolUseCount: number;
  malformedLines: number;
  state: SessionState;
  stateReason: string;
  /** Canonical workspace recorded by Claude Code, when available. */
  cwd?: string | null;
  /** Additional desktop/registry workspace candidates used for attribution. */
  workspacePaths?: string[];
  /** Claude Desktop's local title, used only as a summary fallback. */
  title?: string | null;
}

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  gitBranch?: string;
  isSidechain?: boolean;
  cwd?: string;
  aiTitle?: string;
  customTitle?: string;
  isApiErrorMessage?: boolean;
  error?: unknown;
  origin?: { kind?: string };
  message?: {
    role?: string;
    model?: string;
    content?: unknown;
  };
}

export async function parseClaudeSessionFile(
  filePath: string,
): Promise<ParsedSession> {
  const session: ParsedSession = {
    sessionId: null,
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
    cwd: null,
    workspacePaths: [],
    title: null,
  };
  const filesTouched = new Set<string>();

  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return session;
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (line.length === 0) continue;
      let record: TranscriptLine;
      try {
        record = JSON.parse(line) as TranscriptLine;
      } catch {
        session.malformedLines++;
        continue;
      }
      if (typeof record !== "object" || record === null) {
        session.malformedLines++;
        continue;
      }

      if (record.sessionId && !session.sessionId)
        session.sessionId = record.sessionId;
      if (record.gitBranch) session.gitBranch = record.gitBranch;
      if (record.cwd && !session.cwd) session.cwd = record.cwd;
      if (record.cwd && !session.workspacePaths?.includes(record.cwd)) {
        session.workspacePaths?.push(record.cwd);
      }
      if (record.type === "custom-title" && record.customTitle?.trim()) {
        session.title = record.customTitle.trim();
      } else if (
        record.type === "ai-title" &&
        record.aiTitle?.trim() &&
        !session.title
      ) {
        session.title = record.aiTitle.trim();
      }
      if (record.timestamp) {
        const t = new Date(record.timestamp);
        if (!Number.isNaN(t.getTime())) {
          if (!session.startedAt || t < session.startedAt)
            session.startedAt = t;
          if (!session.endedAt || t > session.endedAt) session.endedAt = t;
        }
      }

      // Sidechains are subagent threads; their prompts aren't the user's.
      // TODO: surface sidechain summaries separately if they prove useful.
      if (record.isSidechain === true) continue;

      if (record.type === "user" && record.message?.role === "user") {
        const text =
          record.origin?.kind && record.origin.kind !== "human"
            ? null
            : extractUserText(record.message.content);
        if (text) {
          session.userPrompts.push(text);
          session.state = "active";
          session.stateReason =
            "The latest observed lifecycle event is a user request.";
        } else if (
          session.state === "waiting" &&
          containsToolResult(record.message.content)
        ) {
          session.state = "active";
          session.stateReason =
            "Claude Code received the requested user input.";
        }
      } else if (
        record.type === "assistant" &&
        record.message?.role === "assistant"
      ) {
        if (record.message.model && !session.model)
          session.model = record.message.model;
        if (record.isApiErrorMessage === true || record.error) {
          session.state = "interrupted";
          session.stateReason = "Claude Code recorded an API error.";
          session.finalAssistantText = null;
          continue;
        }
        const { text, toolUses, files, awaitsUserInput } =
          extractAssistantContent(record.message.content);
        if (text) session.finalAssistantText = text;
        if (awaitsUserInput) {
          session.state = "waiting";
          session.stateReason = "Claude Code requested user input.";
        } else if (toolUses > 0) {
          session.state = "active";
          session.stateReason =
            "The latest observed lifecycle event is tool activity.";
        } else if (text) {
          session.state = "completed";
          session.stateReason = "The agent produced a concluding response.";
        }
        session.toolUseCount += toolUses;
        for (const f of files) {
          if (!isSensitivePath(f)) filesTouched.add(f);
        }
      }
      // All other types (attachment, queue-operation, last-prompt, summary,
      // system, progress, file-history-snapshot, …) are metadata — skipped.
    }
  } catch {
    // Truncated file mid-read (live session) — keep what we parsed so far.
  } finally {
    rl.close();
    stream.destroy();
  }

  session.filesTouched = [...filesTouched];
  return session;
}

/** User content is either a plain string or an array of content blocks. */
function extractUserText(content: unknown): string | null {
  if (typeof content === "string") {
    return isSyntheticUserText(content) ? null : content.trim() || null;
  }
  if (!Array.isArray(content)) return null;
  const texts: string[] = [];
  for (const block of content) {
    if (
      block &&
      typeof block === "object" &&
      (block as { type?: string }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      const text = (block as { text: string }).text;
      if (!isSyntheticUserText(text)) texts.push(text);
    }
    // tool_result blocks are tool output echoed back — not a user prompt.
  }
  const joined = texts.join("\n").trim();
  return joined.length > 0 ? joined : null;
}

/** Harness-injected user turns that aren't real prompts. */
function isSyntheticUserText(text: string): boolean {
  const t = text.trim();
  return (
    t.length === 0 ||
    t.startsWith("<system-reminder>") ||
    t.startsWith("<command-name>") ||
    t.startsWith("<local-command-stdout>") ||
    t.startsWith("<local-command-caveat>") ||
    t.startsWith("<task-notification>") ||
    t.startsWith("<teammate-message>") ||
    t.startsWith("Caveat: the messages below were generated")
  );
}

function containsToolResult(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some(
      (block) =>
        !!block &&
        typeof block === "object" &&
        (block as { type?: string }).type === "tool_result",
    )
  );
}

function extractAssistantContent(content: unknown): {
  text: string | null;
  toolUses: number;
  files: string[];
  awaitsUserInput: boolean;
} {
  if (!Array.isArray(content)) {
    return { text: null, toolUses: 0, files: [], awaitsUserInput: false };
  }
  const texts: string[] = [];
  const files: string[] = [];
  let toolUses = 0;
  let awaitsUserInput = false;
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as {
      type?: string;
      text?: unknown;
      name?: unknown;
      input?: unknown;
    };
    if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
      texts.push(b.text.trim());
    } else if (b.type === "tool_use") {
      toolUses++;
      if (b.name === "AskUserQuestion") awaitsUserInput = true;
      const input = (b.input ?? {}) as Record<string, unknown>;
      for (const key of ["file_path", "notebook_path", "path"]) {
        const value = input[key];
        if (typeof value === "string" && value.length > 0) files.push(value);
      }
    }
    // thinking blocks are internal reasoning — never surfaced.
  }
  return {
    text: texts.length > 0 ? texts.join("\n") : null,
    toolUses,
    files,
    awaitsUserInput,
  };
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}
