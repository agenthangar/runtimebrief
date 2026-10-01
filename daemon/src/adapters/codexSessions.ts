import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { isSensitivePath } from "../secretFilter.js";
import { sharesGitRepository } from "./gitWorkspace.js";
import type { ParsedSession } from "./claudeCodeSessions.js";
import type {
  ActivityEvent,
  ProjectConfig,
  RuntimeAdapter,
  TranscriptRef,
} from "../types.js";

/**
 * Reads Codex CLI session rollouts.
 *
 * Layout verified empirically (Codex CLI 0.144.x, see docs/adapters.md):
 *   <root>/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl
 * where <root> defaults to ~/.codex. Unlike Claude Code, rollouts are
 * partitioned by date rather than by project; each file's first line is a
 * `session_meta` record whose payload carries the session `cwd`, which is
 * how rollouts are matched to a project.
 *
 * Each line is `{timestamp, type, payload}`. Observed `type` values:
 * "session_meta", "turn_context", "world_state", "compacted", "event_msg"
 * (payload.type: user_message, agent_message, task_started, task_complete,
 * token_count, patch_apply_end, …) and "response_item" (payload.type:
 * message, reasoning, function_call, custom_tool_call, web_search_call, …).
 * Malformed or truncated lines (live sessions get appended to mid-write)
 * are skipped silently.
 */
export class CodexSessionsAdapter implements RuntimeAdapter {
  readonly id = "codex";
  private readonly rolloutIndexInFlight = new Map<
    string,
    Promise<IndexedRolloutFile[]>
  >();
  private readonly parsedSessions = new Map<string, {
    size: number;
    mtimeMs: number;
    dev: number;
    ino: number;
    session: ParsedSession;
  }>();
  private readonly parsedSessionsInFlight = new Map<string, Promise<ParsedSession>>();

  constructor(private readonly defaultRoot: string = path.join(os.homedir(), ".codex")) {}

  private root(project: ProjectConfig): string {
    const override = project.transcript_sources?.find((s) => s.type === "codex")?.root;
    return override ?? this.defaultRoot;
  }

  private sessionsDir(project: ProjectConfig): string {
    return path.join(this.root(project), "sessions");
  }

  private rolloutIndex(sessionsDir: string): Promise<IndexedRolloutFile[]> {
    const existing = this.rolloutIndexInFlight.get(sessionsDir);
    if (existing) return existing;
    const scan = Promise.resolve().then(async () => {
      const indexed: IndexedRolloutFile[] = [];
      for (const file of listRolloutFiles(sessionsDir)) {
        indexed.push({ ...file, meta: await readSessionMeta(file.path) });
      }
      return indexed;
    });
    const shared = scan.finally(() => {
      if (this.rolloutIndexInFlight.get(sessionsDir) === shared) {
        this.rolloutIndexInFlight.delete(sessionsDir);
      }
    });
    this.rolloutIndexInFlight.set(sessionsDir, shared);
    return shared;
  }

  /** Completed rollouts can be hundreds of megabytes. Parse each unchanged
   * file once per daemon lifetime, while still re-reading live/appended files. */
  private parsedSession(filePath: string): Promise<ParsedSession> {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return parseCodexSessionFile(filePath);
    }
    const cached = this.parsedSessions.get(filePath);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs &&
        cached.dev === stat.dev && cached.ino === stat.ino) {
      // Refresh insertion order for bounded least-recently-used eviction.
      this.parsedSessions.delete(filePath);
      this.parsedSessions.set(filePath, cached);
      return Promise.resolve(cached.session);
    }
    const existing = this.parsedSessionsInFlight.get(filePath);
    if (existing) return existing;
    const scan = parseCodexSessionFile(filePath).then((session) => {
      try {
        const after = fs.statSync(filePath);
        if (after.size === stat.size && after.mtimeMs === stat.mtimeMs &&
            after.dev === stat.dev && after.ino === stat.ino) {
          this.parsedSessions.delete(filePath);
          this.parsedSessions.set(filePath, { size: stat.size, mtimeMs: stat.mtimeMs,
            dev: stat.dev, ino: stat.ino, session });
          if (this.parsedSessions.size > 256) {
            this.parsedSessions.delete(this.parsedSessions.keys().next().value!);
          }
        }
      } catch {
        this.parsedSessions.delete(filePath);
      }
      return session;
    });
    const shared = scan.finally(() => {
      if (this.parsedSessionsInFlight.get(filePath) === shared) {
        this.parsedSessionsInFlight.delete(filePath);
      }
    });
    this.parsedSessionsInFlight.set(filePath, shared);
    return shared;
  }

  async discover(project: ProjectConfig): Promise<boolean> {
    // If the project explicitly lists transcript sources, honor that list.
    const sources = project.transcript_sources;
    if (sources && !sources.some((s) => s.type === "codex")) return false;
    for (const file of await this.rolloutIndex(this.sessionsDir(project))) {
      const meta = file.meta;
      if (meta && (await sessionMatchesProject(file.path, meta.cwd, project.path))) return true;
    }
    return false;
  }

  async transcriptPaths(project: ProjectConfig, limit: number): Promise<TranscriptRef[]> {
    const sources = project.transcript_sources;
    if (sources && !sources.some((source) => source.type === "codex")) return [];
    const refs: TranscriptRef[] = [];
    for (const file of await this.rolloutIndex(this.sessionsDir(project))) {
      if (refs.length >= limit) break;
      const meta = file.meta;
      if (!meta || !(await sessionMatchesProject(file.path, meta.cwd, project.path))) continue;
      const session = await this.parsedSession(file.path);
      const ref: TranscriptRef = {
        source: this.id,
        id: session.sessionId ?? path.basename(file.path, ".jsonl"),
        path: file.path,
      };
      if (session.startedAt) ref.startedAt = session.startedAt;
      if (session.endedAt) ref.endedAt = session.endedAt;
      const firstPrompt = session.userPrompts[0];
      if (firstPrompt) ref.summary = truncate(firstPrompt, 140);
      ref.state = session.state;
      ref.stateReason = session.stateReason;
      if (session.gitBranch) ref.gitBranch = session.gitBranch;
      if (session.model) ref.model = session.model;
      ref.filesTouched = session.filesTouched;
      ref.toolUseCount = session.toolUseCount;
      if (session.finalAssistantText) ref.conclusion = truncate(session.finalAssistantText, 280);
      refs.push(ref);
    }
    return refs;
  }

  async recentActivity(project: ProjectConfig, since: Date): Promise<ActivityEvent[]> {
    const refs = await this.transcriptPaths(project, 20);
    return refs
      .filter((r) => (r.endedAt ?? r.startedAt ?? new Date(0)) >= since)
      .map((r) => ({
        source: this.id,
        kind: "session",
        timestamp: r.endedAt ?? r.startedAt ?? new Date(0),
        summary: r.summary ?? `Codex session ${r.id}`,
        detail: { sessionId: r.id, path: r.path },
      }));
  }
}

/** Cap on rollout files examined per scan, newest first. */
const MAX_SCAN_FILES = 1000;

interface IndexedRolloutFile {
  path: string;
  mtimeMs: number;
  meta: SessionMeta | null;
}

/** All rollout-*.jsonl under the date-partitioned tree, newest mtime first. */
function listRolloutFiles(sessionsDir: string): { path: string; mtimeMs: number }[] {
  const files: { path: string; mtimeMs: number }[] = [];
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && depth < 3) {
        walk(full, depth + 1); // YYYY/MM/DD
      } else if (
        entry.isFile() &&
        entry.name.startsWith("rollout-") &&
        entry.name.endsWith(".jsonl")
      ) {
        try {
          files.push({ path: full, mtimeMs: fs.statSync(full).mtimeMs });
        } catch {
          // deleted mid-scan
        }
      }
    }
  };
  walk(sessionsDir, 0);
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return files.slice(0, MAX_SCAN_FILES);
}

/** Does a session's cwd belong to the project (equal to or inside its path)? */
export function cwdMatchesProject(cwd: string | null, projectPath: string): boolean {
  if (!cwd) return false;
  const rel = path.relative(path.resolve(projectPath), path.resolve(cwd));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Codex desktop sessions can be launched from a workspace that contains many
 * repositories, so session_meta.cwd may be the parent of the actual project.
 * Prefer the task's concrete working directories over incidental file reads.
 * Without a focused directory, use only references in the current user turn.
 */
export async function sessionMatchesProject(
  filePath: string,
  sessionCwd: string | null,
  projectPath: string,
): Promise<boolean> {
  if (cwdMatchesProject(sessionCwd, projectPath)) return true;
  if (sharesGitRepository(sessionCwd, projectPath)) return true;
  if (!sessionCwd || !cwdMatchesProject(projectPath, sessionCwd)) return false;
  const resolvedProject = path.resolve(projectPath);
  return (await referencedPaths(filePath, sessionCwd)).some((candidate) =>
    cwdMatchesProject(candidate, resolvedProject),
  );
}

interface ReferencedPathsCacheEntry {
  mtimeMs: number;
  size: number;
  workspace: string;
  paths: string[];
}

const referencedPathsCache = new Map<string, ReferencedPathsCacheEntry>();
const referencedPathsInFlight = new Map<string, Promise<string[]>>();

/**
 * Extract paths only from user/agent activity. Developer context can mention
 * unrelated repositories (for example in memory or instructions) and must not
 * cause a session to be attributed to those projects.
 */
async function referencedPaths(filePath: string, workspace: string): Promise<string[]> {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return [];
  }
  const resolvedWorkspace = path.resolve(workspace);
  const cached = referencedPathsCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === stat.mtimeMs &&
    cached.size === stat.size &&
    cached.workspace === resolvedWorkspace
  ) {
    return cached.paths;
  }

  const inFlightKey = `${filePath}\u0000${stat.mtimeMs}\u0000${stat.size}\u0000${resolvedWorkspace}`;
  const existing = referencedPathsInFlight.get(inFlightKey);
  if (existing) return existing;
  const scan = scanReferencedPaths(filePath, resolvedWorkspace, stat);
  const shared = scan.finally(() => {
    if (referencedPathsInFlight.get(inFlightKey) === shared) {
      referencedPathsInFlight.delete(inFlightKey);
    }
  });
  referencedPathsInFlight.set(inFlightKey, shared);
  return shared;
}

async function scanReferencedPaths(
  filePath: string,
  resolvedWorkspace: string,
  stat: fs.Stats,
): Promise<string[]> {
  const prefix = resolvedWorkspace.endsWith(path.sep)
    ? resolvedWorkspace
    : resolvedWorkspace + path.sep;
  const found = new Set<string>();
  const turnWorkspaces = new Set<string>();
  let focusedWorkspaces: string[] = [];
  const focus = (candidates: Set<string>) => {
    for (const candidate of candidates) {
      if (candidate !== resolvedWorkspace && cwdMatchesProject(candidate, resolvedWorkspace)) {
        turnWorkspaces.add(candidate);
      }
    }
    // Keep established ownership through follow-up questions without tools.
    // The first scoped operation in a new turn replaces the previous owner.
    if (turnWorkspaces.size) focusedWorkspaces = [...turnWorkspaces];
  };
  let stream: fs.ReadStream;
  try {
    stream = fs.createReadStream(filePath, { encoding: "utf8" });
  } catch {
    return [];
  }
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const raw of rl) {
      let record: RolloutLine;
      try {
        record = JSON.parse(raw) as RolloutLine;
      } catch {
        continue;
      }
      const payload = (record.payload ?? {}) as Record<string, unknown>;
      let kind = stringOrNull(payload.type);
      if (record.type === "event_msg") {
        const item = kind === "item_completed" && payload.item && typeof payload.item === "object"
          ? payload.item as Record<string, unknown>
          : null;
        if (item?.type === "UserMessage") kind = "user_message";
        else if (item?.type === "AgentMessage") kind = "agent_message";
        const message = item ? completedMessageText(item) : stringOrNull(payload.message);
        if (kind === "user_message" || kind === "agent_message") {
          // A later unrelated task must not revive projects from earlier turns.
          if (kind === "user_message" && normalizeUserText(message)) {
            found.clear();
            turnWorkspaces.clear();
          }
          addPathsFromText(found, kind === "user_message" ? normalizeUserText(message) : message, prefix);
        } else if (kind === "patch_apply_end") {
          const changes = payload.changes;
          if (changes && typeof changes === "object") {
            for (const changedPath of Object.keys(changes as Record<string, unknown>)) {
              addPathsFromText(found, changedPath, prefix);
            }
          }
        }
      } else if (
        record.type === "response_item" &&
        (kind === "function_call" || kind === "custom_tool_call")
      ) {
        // Desktop and CLI rollouts share this shape. Structured tool arguments
        // frequently carry the only concrete workdir/file evidence when a
        // desktop task was launched from a parent workspace.
        const toolName = stringOrNull(payload.name);
        addPathsFromToolValue(
          found,
          payload.arguments,
          prefix,
          resolvedWorkspace,
          toolName,
        );
        addPathsFromToolValue(found, payload.input, prefix, resolvedWorkspace, toolName);
        const workspaces = new Set<string>();
        for (const value of [payload.arguments, payload.input]) {
          addPathsFromToolValue(workspaces, value, prefix, resolvedWorkspace, toolName, true);
        }
        focus(workspaces);
      } else if (record.type === "turn_context") {
        const cwd = stringOrNull(payload.cwd);
        if (cwd) focus(new Set([path.resolve(cwd)]));
      }
    }
  } catch {
    return [];
  } finally {
    rl.close();
    stream.destroy();
  }

  const paths = focusedWorkspaces.length ? focusedWorkspaces : [...found];
  referencedPathsCache.set(filePath, {
    mtimeMs: stat.mtimeMs,
    size: stat.size,
    workspace: resolvedWorkspace,
    paths,
  });
  return paths;
}

function addPathsFromText(found: Set<string>, text: string | null, prefix: string): void {
  if (!text) return;
  const pattern = new RegExp(`${escapeRegExp(prefix)}[^\\s\"'\\x60\\\\<>]+`, "g");
  for (const match of text.matchAll(pattern)) {
    const cleaned = match[0].replace(/[),.;:\]]+$/, "");
    found.add(path.resolve(cleaned));
  }
}

const PATH_ARGUMENT_KEYS = new Set([
  "additionaldirectories",
  "cwd",
  "dir",
  "directories",
  "directory",
  "destinationfile",
  "file",
  "filepath",
  "files",
  "notebookpath",
  "path",
  "paths",
  "projectpath",
  "repopath",
  "root",
  "rootpath",
  "roots",
  "sourcefile",
  "targetfile",
  "workdir",
  "workingdirectory",
]);

const COMMAND_ARGUMENT_KEYS = new Set(["cmd", "code", "command", "script"]);
const WORKSPACE_ARGUMENT_KEYS = new Set([
  "cwd", "workdir", "workingdirectory", "projectpath", "repopath", "rootpath",
]);

const COMMAND_TOOL_NAMES = new Set([
  "bash",
  "exec",
  "execcommand",
  "javascript",
  "js",
  "node",
  "powershell",
  "pwsh",
  "python",
  "runcommand",
  "sh",
  "shell",
  "shellcommand",
  "terminal",
  "zsh",
]);

/**
 * Structured tool payloads can contain prompts, documentation, connector
 * metadata, and tool output alongside real path arguments. Only explicit
 * path-bearing keys count as project evidence. Command/code strings are
 * considered only for known execution tools.
 */
function addPathsFromToolValue(
  found: Set<string>,
  value: unknown,
  prefix: string,
  workspace: string,
  toolName: string | null,
  workspaceOnly = false,
): void {
  if (value === undefined || value === null) return;
  let structured: unknown = value;
  if (typeof value === "string") {
    try {
      structured = JSON.parse(value) as unknown;
    } catch {
      addPathsFromToolSource(found, value, prefix, workspace, toolName, workspaceOnly);
      return;
    }
  }
  addPathsFromStructuredToolValue(
    found,
    structured,
    prefix,
    workspace,
    isCommandTool(toolName),
    workspaceOnly,
  );
}

function addPathsFromStructuredToolValue(
  found: Set<string>,
  value: unknown,
  prefix: string,
  workspace: string,
  allowCommands: boolean,
  workspaceOnly = false,
): void {
  if (Array.isArray(value)) {
    for (const child of value) {
      if (child && typeof child === "object") {
        addPathsFromStructuredToolValue(found, child, prefix, workspace, allowCommands, workspaceOnly);
      }
    }
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = normalizeToolToken(key);
    if ((workspaceOnly ? WORKSPACE_ARGUMENT_KEYS : PATH_ARGUMENT_KEYS).has(normalizedKey)) {
      addPathArgumentValues(found, child, prefix, workspace);
    } else if (allowCommands && COMMAND_ARGUMENT_KEYS.has(normalizedKey)) {
      addCommandArgumentValues(found, child, prefix, workspace, workspaceOnly);
    } else if (child && typeof child === "object") {
      addPathsFromStructuredToolValue(found, child, prefix, workspace, allowCommands, workspaceOnly);
    }
  }
}

function addPathArgumentValues(
  found: Set<string>,
  value: unknown,
  prefix: string,
  workspace: string,
): void {
  forEachDirectString(value, (candidate) => {
    addPathsFromText(found, candidate, prefix);
    addExactPathArgument(found, candidate, workspace);
  });
}

function addCommandArgumentValues(
  found: Set<string>,
  value: unknown,
  prefix: string,
  workspace: string,
  workspaceOnly = false,
): void {
  forEachDirectString(value, (command) =>
    addPathsFromCommandText(found, command, prefix, workspace, workspaceOnly),
  );
}

function forEachDirectString(value: unknown, visit: (value: string) => void): void {
  if (typeof value === "string") {
    visit(value);
  } else if (Array.isArray(value)) {
    for (const child of value) {
      if (typeof child === "string") visit(child);
    }
  }
}

function addExactPathArgument(
  found: Set<string>,
  rawValue: string,
  workspace: string,
): void {
  let value = rawValue.trim();
  if (!value || value.includes("\0") || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return;
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith("`") && value.endsWith("`")))
  ) {
    value = value.slice(1, -1);
  }
  if (!value || value.startsWith("-")) return;

  let candidate: string;
  if (value === "~" || value.startsWith(`~${path.sep}`)) {
    candidate = path.resolve(os.homedir(), value.slice(2));
  } else if (path.isAbsolute(value)) {
    candidate = path.resolve(value);
  } else {
    // A value under an explicit path/workdir key is safe to resolve relative
    // to the session workspace. Bare identifiers in free-form source are not
    // passed here.
    candidate = path.resolve(workspace, value);
  }
  if (cwdMatchesProject(candidate, workspace)) found.add(candidate);
}

function addPathsFromCommandText(
  found: Set<string>,
  command: string,
  prefix: string,
  workspace: string,
  workspaceOnly = false,
): void {
  if (!workspaceOnly) addPathsFromText(found, command, prefix);

  // Relative paths only become evidence in explicit working-directory command
  // forms. General command arguments remain text and cannot attribute a child
  // project on their own.
  const scopedTarget =
    /(?:^|[;&|]\s*|\s)(?:cd|pushd|git\s+-C|make\s+-C|(?:npm|pnpm|yarn)\s+--(?:cwd|prefix))\s+(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g;
  for (const match of command.matchAll(scopedTarget)) {
    const target = match[1] ?? match[2] ?? match[3];
    if (target) addExactPathArgument(found, target, workspace);
  }
}

/**
 * `custom_tool_call` input is often JavaScript source rather than JSON. Read
 * only literal values assigned to approved path/command keys; never scan the
 * entire program, where comments, prompts, and embedded output can mention
 * unrelated projects.
 */
function addPathsFromToolSource(
  found: Set<string>,
  source: string,
  prefix: string,
  workspace: string,
  toolName: string | null,
  workspaceOnly = false,
): void {
  const allowCommands = isCommandTool(toolName);
  forEachToolSourceProperty(source, (rawKey, start) => {
    const key = normalizeToolToken(rawKey);
    const literal = readToolSourceValue(source, start);
    if (!literal) return;
    if ((workspaceOnly ? WORKSPACE_ARGUMENT_KEYS : PATH_ARGUMENT_KEYS).has(key)) {
      if (literal.quoted) {
        addPathsFromText(found, literal.text, prefix);
        addExactPathArgument(found, literal.text, workspace);
      } else {
        const value = parseToolSourceCollection(literal.text);
        if (value !== null) addPathArgumentValues(found, value, prefix, workspace);
      }
    } else if (allowCommands && COMMAND_ARGUMENT_KEYS.has(key)) {
      if (literal.quoted) {
        addPathsFromCommandText(found, literal.text, prefix, workspace, workspaceOnly);
      } else {
        const value = parseToolSourceCollection(literal.text);
        if (value !== null) addCommandArgumentValues(found, value, prefix, workspace, workspaceOnly);
      }
    }
  });
}

/** Visit object-literal properties while skipping strings and comments. */
function forEachToolSourceProperty(
  source: string,
  visit: (key: string, valueStart: number) => void,
): void {
  let index = 0;
  while (index < source.length) {
    const current = source[index]!;
    if (current === '"' || current === "'" || current === "`") {
      index = quotedToolSourceEnd(source, index);
      continue;
    }
    if (current === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
      continue;
    }
    if (current === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
      continue;
    }
    if (current !== "{" && current !== ",") {
      index++;
      continue;
    }

    let cursor = skipToolSourceTrivia(source, index + 1);
    let key: string | null = null;
    if (source[cursor] === '"' || source[cursor] === "'") {
      const end = quotedToolSourceEnd(source, cursor);
      if (end <= source.length && source[end - 1] === source[cursor]) {
        key = source.slice(cursor + 1, end - 1);
        cursor = end;
      }
    } else {
      const match = /^[A-Za-z_$][\w$-]*/.exec(source.slice(cursor));
      if (match) {
        key = match[0];
        cursor += match[0].length;
      }
    }
    if (!key) {
      index++;
      continue;
    }
    cursor = skipToolSourceTrivia(source, cursor);
    if (source[cursor] === ":") {
      visit(key, skipToolSourceTrivia(source, cursor + 1));
    }
    index++;
  }
}

function skipToolSourceTrivia(source: string, start: number): number {
  let index = start;
  while (index < source.length) {
    if (/\s/.test(source[index]!)) {
      index++;
    } else if (source[index] === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      index = newline < 0 ? source.length : newline + 1;
    } else if (source[index] === "/" && source[index + 1] === "*") {
      const close = source.indexOf("*/", index + 2);
      index = close < 0 ? source.length : close + 2;
    } else {
      break;
    }
  }
  return index;
}

function quotedToolSourceEnd(source: string, start: number): number {
  const quote = source[start];
  let escaped = false;
  for (let index = start + 1; index < source.length; index++) {
    const current = source[index]!;
    if (escaped) {
      escaped = false;
    } else if (current === "\\") {
      escaped = true;
    } else if (current === quote) {
      return index + 1;
    }
  }
  return source.length;
}

function parseToolSourceCollection(value: string): unknown | null {
  if (!value.startsWith("[") && !value.startsWith("{")) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function readToolSourceValue(
  source: string,
  start: number,
): { text: string; quoted: boolean } | null {
  if (start >= source.length) return null;
  const first = source[start]!;
  if (first === '"' || first === "'" || first === "`") {
    let escaped = false;
    for (let index = start + 1; index < source.length; index++) {
      const current = source[index]!;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === first) {
        return { text: source.slice(start + 1, index), quoted: true };
      }
    }
    return null;
  }

  if (first === "[" || first === "{") {
    const closing = first === "[" ? "]" : "}";
    let depth = 0;
    let quote: string | null = null;
    let escaped = false;
    for (let index = start; index < source.length; index++) {
      const current = source[index]!;
      if (quote) {
        if (escaped) escaped = false;
        else if (current === "\\") escaped = true;
        else if (current === quote) quote = null;
        continue;
      }
      if (current === '"' || current === "'" || current === "`") quote = current;
      else if (current === first) depth++;
      else if (current === closing && --depth === 0) {
        return { text: source.slice(start, index + 1), quoted: false };
      }
    }
    return null;
  }

  const end = source.slice(start).search(/[,}\n]/);
  return {
    text: source.slice(start, end < 0 ? source.length : start + end).trim(),
    quoted: false,
  };
}

function isCommandTool(toolName: string | null): boolean {
  if (!toolName) return false;
  const leaf = toolName.split(/[.:/]/).at(-1) ?? toolName;
  return COMMAND_TOOL_NAMES.has(normalizeToolToken(leaf));
}

function normalizeToolToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface SessionMeta {
  sessionId: string | null;
  cwd: string | null;
}

/** First line is a session_meta record; read only that (it can be large —
 * it embeds the model's base instructions — so allow a generous cap). */
async function readSessionMeta(filePath: string): Promise<SessionMeta | null> {
  let fd: number;
  try {
    fd = fs.openSync(filePath, "r");
  } catch {
    return null;
  }
  try {
    const buf = Buffer.alloc(256 * 1024);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString("utf8", 0, bytes);
    const nl = text.indexOf("\n");
    if (nl < 0 && bytes === buf.length) return null; // first line larger than cap
    const first = (nl >= 0 ? text.slice(0, nl) : text).trim();
    if (!first) return null;
    const record = JSON.parse(first) as RolloutLine;
    if (record?.type !== "session_meta") return null;
    const payload = (record.payload ?? {}) as Record<string, unknown>;
    return {
      sessionId: stringOrNull(payload.id) ?? stringOrNull(payload.session_id),
      cwd: stringOrNull(payload.cwd),
    };
  } catch {
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

interface RolloutLine {
  timestamp?: string;
  type?: string;
  payload?: unknown;
}

export async function parseCodexSessionFile(filePath: string): Promise<ParsedSession> {
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
  };
  const filesTouched = new Set<string>();
  const pendingInputCalls = new Set<string>();
  let lastAgentMessage: string | null = null;

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
      let record: RolloutLine;
      try {
        record = JSON.parse(line) as RolloutLine;
      } catch {
        session.malformedLines++;
        continue;
      }
      if (typeof record !== "object" || record === null) {
        session.malformedLines++;
        continue;
      }

      if (record.timestamp) {
        const t = new Date(record.timestamp);
        if (!Number.isNaN(t.getTime())) {
          if (!session.startedAt || t < session.startedAt) session.startedAt = t;
          if (!session.endedAt || t > session.endedAt) session.endedAt = t;
        }
      }

      const payload = (record.payload ?? {}) as Record<string, unknown>;
      if (record.type === "session_meta") {
        if (!session.sessionId) {
          session.sessionId = stringOrNull(payload.id) ?? stringOrNull(payload.session_id);
        }
      } else if (record.type === "turn_context") {
        if (!session.model) session.model = stringOrNull(payload.model);
      } else if (record.type === "event_msg") {
        let kind = stringOrNull(payload.type);
        // Shared app-server releases emit completed message items instead of
        // the older user_message / agent_message events. Read their native
        // content, leaving response_item context and reasoning private.
        const item = kind === "item_completed" && payload.item && typeof payload.item === "object"
          ? payload.item as Record<string, unknown>
          : null;
        if (item?.type === "UserMessage") kind = "user_message";
        else if (item?.type === "AgentMessage") kind = "agent_message";
        const message = item ? completedMessageText(item) : stringOrNull(payload.message);
        if (kind === "user_message") {
          const text = normalizeUserText(message);
          if (text) {
            session.userPrompts.push(text);
            session.state = "active";
            session.stateReason = "The latest observed lifecycle event is a user request.";
          }
        } else if (kind === "agent_message") {
          const text = message?.trim();
          if (text) {
            lastAgentMessage = text;
          }
          const phase = stringOrNull(item?.phase ?? payload.phase);
          if (phase === "final_answer") {
            session.state = "completed";
            session.stateReason = "Codex recorded a final answer.";
          } else if (phase === "commentary") {
            session.state = "active";
            session.stateReason = "Codex recorded in-progress commentary.";
          }
        } else if (kind === "task_started") {
          session.state = "active";
          session.stateReason = "Codex recorded task_started.";
        } else if (kind === "task_complete") {
          session.state = "completed";
          session.stateReason = "Codex recorded task_complete.";
        } else if (kind === "turn_aborted") {
          session.state = "interrupted";
          session.stateReason = "Codex recorded a stopped turn.";
        } else if (kind === "patch_apply_end") {
          const changes = payload.changes;
          if (changes && typeof changes === "object") {
            for (const f of Object.keys(changes as Record<string, unknown>)) {
              if (!isSensitivePath(f)) filesTouched.add(f);
            }
          }
        }
      } else if (record.type === "response_item") {
        const kind = stringOrNull(payload.type);
        if (
          kind === "function_call" ||
          kind === "custom_tool_call" ||
          kind === "web_search_call" ||
          kind === "tool_search_call"
        ) {
          session.toolUseCount++;
          const toolName = stringOrNull(payload.name);
          const callId = stringOrNull(payload.call_id);
          if (toolName === "request_user_input") {
            if (callId) pendingInputCalls.add(callId);
            session.state = "waiting";
            session.stateReason = "Codex requested user input.";
          } else {
            session.state = "active";
            session.stateReason = "The latest observed lifecycle event is tool activity.";
          }
        } else if (
          kind === "function_call_output" ||
          kind === "custom_tool_call_output"
        ) {
          const callId = stringOrNull(payload.call_id);
          if (callId && pendingInputCalls.delete(callId)) {
            const output = stringOrNull(payload.output);
            if (output && /aborted by user/i.test(output)) {
              session.state = "interrupted";
              session.stateReason = "The user stopped the Codex turn.";
            } else {
              session.state = "active";
              session.stateReason = "Codex received the requested user input.";
            }
          }
        }
        // Messages also duplicate the native events above. Context and
        // encrypted reasoning are never surfaced as user activity.
      }
      // world_state, compacted, … are metadata — skipped.
    }
  } catch {
    // Truncated file mid-read (live session) — keep what we parsed so far.
  } finally {
    rl.close();
    stream.destroy();
  }

  // The latest commentary can describe work performed after an earlier final
  // answer when the user continues in the same Codex task. Prefer recency so
  // an active redesign is not hidden behind a completed older turn.
  session.finalAssistantText = lastAgentMessage;
  session.filesTouched = [...filesTouched];
  return session;
}

function completedMessageText(item: Record<string, unknown>): string | null {
  if (!Array.isArray(item.content)) return null;
  const text = item.content.flatMap((block: unknown) => {
    if (!block || typeof block !== "object") return [];
    const content = block as Record<string, unknown>;
    return (content.type === "text" || content.type === "Text") && typeof content.text === "string"
      ? [content.text]
      : [];
  }).join("\n");
  return text || null;
}

/** Strip Codex UI context wrappers while retaining the user's actual request. */
function normalizeUserText(value: string | null): string | null {
  if (!value) return null;
  let text = value.trim();
  const requestMarker = "## My request for Codex:";
  const markerIndex = text.lastIndexOf(requestMarker);
  if (markerIndex >= 0) {
    text = text.slice(markerIndex + requestMarker.length).trim();
  }
  // Harness-injected turns that contain no explicit request are not prompts.
  if (/^<[a-z_ -]+(?:\s[^>]*)?>/i.test(text)) return null;
  return text.length > 0 ? text : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function truncate(text: string, max: number): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}
