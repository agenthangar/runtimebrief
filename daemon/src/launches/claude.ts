import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import type { ClaudeLaunch, ClaudeProvider, LaunchCapability } from "./types.js";
import { desktopHasSession, handoffToDesktop, type DesktopHandoff } from "./desktop.js";

const exec = promisify(execFile);
export type ClaudeCommand = (file: string, args: string[], cwd?: string) => Promise<string>;

const run: ClaudeCommand = async (file, args, cwd) => {
  const { stdout } = await exec(file, args, {
    ...(cwd ? { cwd } : {}), timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return stdout;
};

const nativeSessionsSchema = z.array(z.object({
  id: z.string().regex(/^[a-f0-9-]{8,36}$/).optional(),
  sessionId: z.uuid().optional(), name: z.string().optional(),
  cwd: z.string().min(1), kind: z.enum(["interactive", "background"]),
  state: z.string().optional(), status: z.string().optional(), waitingFor: z.string().optional(),
}));

export function resolveClaudeBinary(): string {
  const candidates = [
    path.join(os.homedir(), ".local/bin/claude"),
    "/opt/homebrew/bin/claude", "/usr/local/bin/claude",
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map(p => path.join(p, "claude")),
  ];
  for (const candidate of candidates) {
    try { fs.accessSync(candidate, fs.constants.X_OK); return candidate; } catch { /* try next install location */ }
  }
  return "claude";
}

export class NativeClaudeProvider implements ClaudeProvider {
  private readiness: { checkedAt: number; value: Promise<LaunchCapability> } | undefined;
  constructor(
    private readonly binary = resolveClaudeBinary(),
    private readonly command = run,
    private readonly handoff: DesktopHandoff = handoffToDesktop,
    readonly desktopHas = desktopHasSession,
  ) {}

  async capability(): Promise<LaunchCapability> {
    if (this.readiness && Date.now() - this.readiness.checkedAt < 10_000) return this.readiness.value;
    const value = this.checkCapability();
    this.readiness = { checkedAt: Date.now(), value };
    return value;
  }

  private async checkCapability(): Promise<LaunchCapability> {
    if (process.platform !== "darwin") return { available: false, message: "Claude launch is currently available on a Mac." };
    try {
      const help = await this.command(this.binary, ["--help"]);
      if (!help.includes("--bg") || !help.includes("attach <id>")) {
        return { available: false, message: "Update Claude Code on your Mac to a version with background sessions." };
      }
    } catch {
      return { available: false, message: "Install Claude Code on your Mac, then restart RuntimeBrief." };
    }
    try {
      const auth = JSON.parse(await this.command(this.binary, ["auth", "status"])) as { loggedIn?: boolean };
      if (auth.loggedIn === true) return { available: true, message: "Starts a native Claude Code session on your Mac. Claude handles tool permissions." };
    } catch { /* signed-out auth status can exit nonzero */ }
    return { available: false, message: "Sign in to Claude Code on your Mac with claude auth login, then refresh." };
  }

  async start(cwd: string, name: string, prompt: string): Promise<string> {
    // --bg assigns the session ID itself; --session-id is ignored by Claude.
    // argv + -- ensures prompts cannot become shell syntax or CLI flags.
    const output = await this.command(this.binary,
      ["--bg", "--permission-mode", "manual", "--name", name, "--", prompt], cwd);
    const id = /backgrounded\s*·\s*([a-f0-9]{8})\b/.exec(output)?.[1];
    if (!id) throw new Error("Claude did not acknowledge a background session");
    return id;
  }

  async sessions() {
    return nativeSessionsSchema.parse(JSON.parse(await this.command(this.binary, ["agents", "--json", "--all"])));
  }

  async open(launch: ClaudeLaunch): Promise<void> {
    // A previous handoff is permanent, even if Desktop archives or removes its catalog entry.
    if (launch.openedAt || (launch.sessionId && this.desktopHas(launch.sessionId))) {
      await this.command("/usr/bin/open", ["-a", "Claude"]);
      return;
    }
    if (!launch.nativeId || !/^[a-f0-9]{8}$/.test(launch.nativeId)) throw new Error("Invalid native ID");
    const sessions = await this.sessions();
    const native = sessions.find(session => session.kind === "background" && session.id === launch.nativeId);
    if (!native || !launch.sessionId || native.sessionId !== launch.sessionId) throw new Error("Native session identity is no longer confirmed");
    if (sessions.some(session => session.kind === "interactive" && session.sessionId === launch.sessionId)) {
      throw new Error("The session is already owned by another native interface");
    }
    // Native stop saves the conversation; normal --resume honors Claude's writer lock.
    // Never use --bg --resume here, because Claude can fork a still-running session.
    await this.command(this.binary, ["stop", launch.nativeId]);
    await this.handoff(this.binary, launch.sessionId, native.cwd);
    if (!this.desktopHas(launch.sessionId)) throw new Error("Desktop has not confirmed the conversation");
  }
}
