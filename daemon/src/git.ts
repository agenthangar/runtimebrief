import { execFile } from "node:child_process";

/**
 * Safe git execution. Non-negotiables:
 *  - argv arrays only, never shell strings — nothing is interpolated into a shell
 *  - subcommand allowlist: read-only introspection commands only
 *  - `--` separators and sanitized flags where user-derived values appear
 */
const ALLOWED_SUBCOMMANDS = new Set(["log", "status", "diff", "branch", "rev-parse", "grep"]);

export class GitError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export function gitReadOnlyEnvironment(
  base: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return {
    ...base,
    GIT_TERMINAL_PROMPT: "0",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_LAZY_FETCH: "1",
  };
}

export function runGit(repoPath: string, args: string[]): Promise<string> {
  const subcommand = args[0];
  if (!subcommand || !ALLOWED_SUBCOMMANDS.has(subcommand)) {
    return Promise.reject(
      new GitError(`git subcommand not allowlisted: ${subcommand ?? "(none)"}`, null),
    );
  }
  // Belt and braces: no argument may smuggle in a pager/editor/exec override.
  // -O / --open-files-in-pager is `git grep`'s "run this command" flag.
  for (const arg of args) {
    if (/^--(exec|upload-pack|receive-pack|output|open-files-in-pager)/.test(arg) || arg.startsWith("-O")) {
      return Promise.reject(new GitError(`git argument not allowed: ${arg}`, null));
    }
  }
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", repoPath, "--no-pager", ...args],
      {
        timeout: 10_000,
        maxBuffer: 4 * 1024 * 1024,
        env: gitReadOnlyEnvironment(),
      },
      (err, stdout, stderr) => {
        if (err) {
          const code = typeof (err as NodeJS.ErrnoException & { code?: unknown }).code === "number"
            ? ((err as unknown as { code: number }).code)
            : null;
          reject(new GitError(stderr.trim() || err.message, code));
        } else {
          resolve(stdout);
        }
      },
    );
  });
}
