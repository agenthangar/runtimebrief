import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node-pty";
import type { ClaudeLaunchOptions } from "./types.js";

/** Read-only confirmation of Claude's own Desktop catalog, also used by our observer. */
export function desktopHasSession(
  id: string,
  root = path.join(os.homedir(), "Library/Application Support/Claude/claude-code-sessions"),
): boolean {
  if (!/^[a-f0-9-]{36}$/.test(id)) return false;
  try {
    for (const account of fs.readdirSync(root, { withFileTypes: true })) {
      if (!account.isDirectory()) continue;
      const accountDir = path.join(root, account.name);
      for (const bridge of fs.readdirSync(accountDir, { withFileTypes: true })) {
        if (!bridge.isDirectory()) continue;
        const file = path.join(accountDir, bridge.name, `local_${id}.json`);
        try {
          const stat = fs.lstatSync(file);
          if (!stat.isFile() || stat.size > 1_048_576) continue;
          const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
          if (metadata.cliSessionId === id && metadata.sessionId === `local_${id}` && metadata.isArchived !== true) return true;
        } catch { /* A partially-written or absent catalog entry is not confirmation. */ }
      }
    }
  } catch { /* Desktop may not be installed or signed in. */ }
  return false;
}

export type DesktopHandoff = (binary: string, sessionID: string, cwd: string, permissionMode: ClaudeLaunchOptions["permissionMode"]) => Promise<void>;

/** A terminal is required for the native /desktop command. No keystrokes or approvals are synthesized. */
export const handoffToDesktop: DesktopHandoff = (binary, sessionID, cwd, permissionMode) => new Promise((resolve, reject) => {
  // Native resume restores the saved model. Pass the launch mode to the CLI,
  // but Desktop may apply its own permission mode after transfer.
  const child = spawn(binary, ["--resume", sessionID, "--permission-mode", permissionMode, "/desktop"], {
    name: "xterm-256color", cols: 120, rows: 32, cwd,
    env: { ...process.env, NO_COLOR: "1" },
  });
  // Consume terminal output without retaining prompts, transcript text, or credentials.
  const data = child.onData(() => {});
  let settled = false;
  const timeout = setTimeout(() => {
    settled = true;
    child.kill();
    data.dispose();
    reject(new Error("Native Desktop handoff needs attention on the Mac"));
  }, 20_000);
  child.onExit(({ exitCode }) => {
    clearTimeout(timeout);
    data.dispose();
    if (settled) return;
    settled = true;
    if (exitCode === 0) resolve();
    else reject(new Error("Native Desktop handoff failed"));
  });
});
