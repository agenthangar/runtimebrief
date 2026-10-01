import fs from "node:fs";
import { execFileSync } from "node:child_process";

interface Workspace { id: string; provider: string; projectRoot: string; cwd: string; workspaceKind?: string }

/** Codex's native sidebar groups CLI tasks by cwd. Use the selected checkout. */
export function prepareNativeWorkspace(value: Workspace): string {
  if (value.workspaceKind === "project") {
    if (value.provider !== "codex" || fs.realpathSync(value.cwd) !== fs.realpathSync(value.projectRoot) || !fs.statSync(value.cwd).isDirectory()) throw Error("Native project workspace mismatch");
  } else {
    // Existing worktree receipts keep their original execution directory.
    execFileSync("/usr/bin/git", ["-C", value.projectRoot, "worktree", "add", "-b", `runtimebrief/${value.id}`, value.cwd, "HEAD"], { timeout: 30000, stdio: "ignore" });
  }
  return fs.realpathSync(value.cwd);
}
