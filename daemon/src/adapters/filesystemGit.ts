import fs from "node:fs";
import path from "node:path";
import { GitError, runGit } from "../git.js";
import { isSensitivePath } from "../secretFilter.js";
import type {
  ActivityEvent,
  ProjectConfig,
  RuntimeAdapter,
  TranscriptRef,
} from "../types.js";

export interface CommitInfo {
  hash: string;
  author: string;
  timestamp: string; // ISO 8601
  message: string;
}

export interface GitSummary {
  branch: string;
  dirty: boolean;
  dirtyFileCount: number;
  commits: CommitInfo[];
  /** `git diff --stat <default>...HEAD` tail line, or null when on/no default branch. */
  diffstatVsDefault: string | null;
  defaultBranch: string | null;
  /** Lines in tracked files containing TODO / FIXME as a word (`git grep -c -w`). */
  todoCount: number;
  fixmeCount: number;
  recentlyModifiedFiles: { path: string; modifiedAt: string }[];
  lastCommitAt: string | null;
}

const COMMIT_LIMIT = 20;
// Filesystem scan caps so a huge repo can't stall a request.
const SCAN_MAX_FILES = 5000;
const SCAN_SKIP_DIRS = new Set([
  ".git", "node_modules", "dist", "build", ".next", "vendor", "Pods",
  "DerivedData", ".venv", "venv", "__pycache__", "target", ".cache",
]);

/** Applies to any project directory that is a git work tree. */
export class FilesystemGitAdapter implements RuntimeAdapter {
  readonly id = "filesystem-git";

  async discover(project: ProjectConfig): Promise<boolean> {
    try {
      const out = await runGit(project.path, ["rev-parse", "--is-inside-work-tree"]);
      return out.trim() === "true";
    } catch {
      return false;
    }
  }

  async recentActivity(project: ProjectConfig, since: Date): Promise<ActivityEvent[]> {
    const commits = await this.commitsSince(project.path, since);
    return commits.map((c) => ({
      source: this.id,
      kind: "commit",
      timestamp: new Date(c.timestamp),
      summary: `${c.message} (${c.author})`,
      detail: { hash: c.hash },
    }));
  }

  /** Git produces no transcripts. */
  async transcriptPaths(_project: ProjectConfig, _limit: number): Promise<TranscriptRef[]> {
    return [];
  }

  async summary(project: ProjectConfig): Promise<GitSummary> {
    const repo = project.path;
    const [branch, status, commits] = await Promise.all([
      this.currentBranch(repo),
      runGit(repo, ["status", "--porcelain"]),
      this.recentCommits(repo, COMMIT_LIMIT),
    ]);
    const dirtyFiles = status.split("\n").filter((l) => l.trim().length > 0);
    const defaultBranch = await this.defaultBranch(repo);
    let diffstatVsDefault: string | null = null;
    if (defaultBranch && branch !== defaultBranch) {
      try {
        const stat = await runGit(repo, ["diff", "--stat", `${defaultBranch}...HEAD`]);
        const lines = stat.trim().split("\n");
        diffstatVsDefault = lines.length > 0 ? lines[lines.length - 1]!.trim() : null;
        if (diffstatVsDefault === "") diffstatVsDefault = null;
      } catch {
        diffstatVsDefault = null; // e.g. no merge base
      }
    }
    const [todoCount, fixmeCount] = await Promise.all([
      this.markerCount(repo, "TODO"),
      this.markerCount(repo, "FIXME"),
    ]);
    return {
      branch,
      dirty: dirtyFiles.length > 0,
      dirtyFileCount: dirtyFiles.length,
      commits,
      diffstatVsDefault,
      defaultBranch,
      todoCount,
      fixmeCount,
      recentlyModifiedFiles: recentlyModifiedFiles(repo),
      lastCommitAt: commits[0]?.timestamp ?? null,
    };
  }

  /**
   * Lines in tracked text files containing the marker as a whole word,
   * via `git grep` (fixed string, no binaries). Sensitive paths are dropped
   * from the tally even if someone tracked them.
   */
  private async markerCount(repo: string, marker: "TODO" | "FIXME"): Promise<number> {
    let out: string;
    try {
      out = await runGit(repo, ["grep", "-I", "-c", "-w", "-F", "-e", marker, "--", "."]);
    } catch (err) {
      // git grep exits 1 when there are no matches at all.
      if (err instanceof GitError) return 0;
      throw err;
    }
    let total = 0;
    for (const line of out.split("\n")) {
      // "<path>:<count>" — paths can contain ":", the count never does.
      const sep = line.lastIndexOf(":");
      if (sep <= 0) continue;
      const file = line.slice(0, sep);
      const count = Number.parseInt(line.slice(sep + 1), 10);
      if (!Number.isFinite(count) || isSensitivePath(file)) continue;
      total += count;
    }
    return total;
  }

  private async currentBranch(repo: string): Promise<string> {
    const out = await runGit(repo, ["branch", "--show-current"]);
    return out.trim() || "HEAD"; // Empty when detached.
  }

  private async defaultBranch(repo: string): Promise<string | null> {
    for (const candidate of ["main", "master"]) {
      try {
        await runGit(repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${candidate}`]);
        return candidate;
      } catch {
        // try next
      }
    }
    return null;
  }

  private async recentCommits(repo: string, limit: number): Promise<CommitInfo[]> {
    // %x1f/%x1e: unit/record separators — safe against any commit message text.
    let out: string;
    try {
      out = await runGit(repo, [
        "log",
        `-n${limit}`,
        "--pretty=format:%H%x1f%an%x1f%aI%x1f%s%x1e",
      ]);
    } catch (err) {
      if (err instanceof GitError) return []; // fresh repo with no commits
      throw err;
    }
    return parseCommitRecords(out);
  }

  private async commitsSince(repo: string, since: Date): Promise<CommitInfo[]> {
    let out: string;
    try {
      out = await runGit(repo, [
        "log",
        `--since=${since.toISOString()}`,
        "--pretty=format:%H%x1f%an%x1f%aI%x1f%s%x1e",
      ]);
    } catch (err) {
      if (err instanceof GitError) return [];
      throw err;
    }
    return parseCommitRecords(out);
  }
}

function parseCommitRecords(out: string): CommitInfo[] {
  return out
    .split("\x1e")
    .map((record) => record.replace(/^\n/, ""))
    .filter((record) => record.includes("\x1f"))
    .map((record) => {
      const [hash, author, timestamp, message] = record.split("\x1f");
      return {
        hash: hash ?? "",
        author: author ?? "",
        timestamp: timestamp ?? "",
        message: message ?? "",
      };
    });
}

/**
 * Bounded mtime-only walk of the working tree for the most-recently-modified
 * files. No file contents are read (TODO/FIXME counting goes through
 * `git grep`); sensitive paths are still excluded from the listing.
 */
function recentlyModifiedFiles(root: string): { path: string; modifiedAt: string }[] {
  let visited = 0;
  const mtimes: { path: string; mtimeMs: number }[] = [];

  const walk = (dir: string) => {
    if (visited >= SCAN_MAX_FILES) return;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (visited >= SCAN_MAX_FILES) return;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SCAN_SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      visited++;
      const rel = path.relative(root, full);
      if (isSensitivePath(rel)) continue;
      try {
        mtimes.push({ path: rel, mtimeMs: fs.statSync(full).mtimeMs });
      } catch {
        // vanished mid-walk — skip
      }
    }
  };
  walk(root);

  return mtimes
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 10)
    .map((f) => ({ path: f.path, modifiedAt: new Date(f.mtimeMs).toISOString() }));
}
