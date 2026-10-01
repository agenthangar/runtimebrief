import fs from "node:fs";
import { execFileSync } from "node:child_process";

interface Workspace { id: string; provider: string; projectRoot: string; cwd: string; workspaceKind?: string }

/** Native sessions use the selected checkout, including its workspace settings. */
export function prepareNativeWorkspace(value: Workspace): string {
  if (value.workspaceKind === "project") {
    if (!["claude", "codex", "cursor"].includes(value.provider) || fs.realpathSync(value.cwd) !== fs.realpathSync(value.projectRoot) || !fs.statSync(value.cwd).isDirectory()) throw Error("Native project workspace mismatch");
  } else {
    if (value.workspaceKind !== undefined && value.workspaceKind !== "worktree") throw Error("Invalid native workspace kind");
    // Existing worktree receipts keep their original execution directory.
    execFileSync("/usr/bin/git", ["-C", value.projectRoot, "worktree", "add", "-b", `runtimebrief/${value.id}`, value.cwd, "HEAD"], { timeout: 30000, stdio: "ignore" });
  }
  return fs.realpathSync(value.cwd);
}
