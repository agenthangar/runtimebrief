import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Database from "better-sqlite3";
import { bindCodexProject } from "./codexProject.js";
import { TLegacyBackend, promptHash, tSlot, tTarget, type TLegacyOptions } from "./tLegacy.js";
import { hasPinnedT } from "./tDependency.js";
import { parseCodexSessionFile } from "../adapters/codexSessions.js";
import { parseCursorProjectTranscript } from "../adapters/cursorSessions.js";
import { LaunchError, type ClaudeLaunch, type LaunchCapability, type TerminalSnapshot } from "./types.js";

const exec = promisify(execFile);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const bundledCodex = "/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex";
export function resolveAgentBinary(provider: "codex" | "cursor"): string {
  const configured = process.env[provider === "codex" ? "RUNTIMEBRIEF_CODEX_BINARY" : "RUNTIMEBRIEF_CURSOR_BINARY"];
  if (configured) return configured;
  const candidates = provider === "codex"
    ? [configured, bundledCodex, "/opt/homebrew/bin/codex", "/usr/local/bin/codex"]
    : [configured, path.join(os.homedir(), ".local/bin/cursor-agent"), "/opt/homebrew/bin/cursor-agent", "/usr/local/bin/cursor-agent"];
  return candidates.find((value): value is string => !!value && fs.existsSync(value)) ?? (provider === "codex" ? "/opt/homebrew/bin/codex" : path.join(os.homedir(), ".local/bin/cursor-agent"));
}

interface Runner { cwd: string; pane: string; socket: string; token: string }
export class TNativeBackend extends TLegacyBackend {
  override readonly id: string;
  override readonly provider: "codex" | "cursor";
  private readonly historyRoot: string;
  private readonly projectBinder: (launch: ClaudeLaunch) => Promise<string>;
  private readonly bindingAttempts = new Map<string, number>();

  constructor(provider: "codex" | "cursor", options: TLegacyOptions & { historyRoot?: string; projectBinder?: (launch: ClaudeLaunch) => Promise<string> } = {}) {
    super({ ...options, binary: options.binary ?? resolveAgentBinary(provider) });
    this.provider = provider;
    this.id = `t-${provider}`;
    this.projectBinder = options.projectBinder ?? (launch => bindCodexProject(this.binary, launch));
    this.historyRoot = options.historyRoot ?? (provider === "codex" && process.env.CODEX_HOME ? process.env.CODEX_HOME : path.join(os.homedir(), provider === "codex" ? ".codex" : ".cursor"));
  }

  override async capability(cwd?: string): Promise<LaunchCapability> {
    if (!hasPinnedT(this.tHome)) return { available: false, message: "Run runtimebriefd install-t on your Mac to enable agent sessions." };
    try {
      await exec(this.tmux, ["-V"], { timeout: 3000 });
      await exec(this.binary, ["--version"], { timeout: 10000 });
      if (cwd) await exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--verify", "refs/remotes/origin/main"], { timeout: 3000 });
    } catch { return { available: false, message: `Install ${this.provider} and tmux on your Mac, and use a Git project with origin/main.` }; }
    return { available: true, message: `Starts ${this.provider} in a t worktree. Remote terminal control is on by default; the native agent handles sign-in and permissions.` };
  }

  private runner(launch: ClaudeLaunch): Runner {
    const runner = JSON.parse(fs.readFileSync(path.join(this.directory(launch), "runner.json"), "utf8")) as Runner;
    const expected = path.join(this.root, "t-worktrees", path.basename(launch.projectRoot ?? launch.cwd), tSlot(launch.id));
    if (fs.realpathSync(runner.cwd) !== fs.realpathSync(expected) || !/^%\d+$/.test(runner.pane)
      || runner.socket !== `/tmp/rb-terminal-${launch.id}.sock` || !uuid.test(runner.token)) throw Error("Invalid owner");
    return runner;
  }

  private bridge(runner: Runner, data?: string): Promise<{ live: boolean; accepted?: boolean }> {
    return new Promise((resolve, reject) => {
      const connection = net.createConnection(runner.socket);
      let text = "";
      connection.setTimeout(3000, () => connection.destroy(Error("Terminal timeout")));
      connection.once("connect", () => connection.end(JSON.stringify({ token: runner.token, ...(data === undefined ? {} : { data }) }) + "\n"));
      connection.on("data", bytes => { text += bytes; if (text.length > 1000) connection.destroy(Error("Invalid response")); });
      connection.once("error", reject);
      connection.once("end", () => { try { resolve(JSON.parse(text)); } catch { reject(Error("Invalid response")); } });
    });
  }

  private async history(launch: ClaudeLaunch, runner: Runner) {
    if (this.provider === "cursor") {
      const native = JSON.parse(fs.readFileSync(path.join(this.directory(launch), "native.json"), "utf8"));
      if (!uuid.test(native.sessionId) || fs.realpathSync(native.cwd) !== runner.cwd) throw Error("Invalid native identity");
      const encoded = runner.cwd.replace(/[^A-Za-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
      const directory = path.join(this.historyRoot, "projects", encoded, "agent-transcripts");
      let files: string[] = [];
      try { files = fs.readdirSync(directory).filter(file => uuid.test(file.replace(/\.jsonl$/, ""))); } catch { /* before trust/sign-in */ }
      const changed = files.some(file => file.replace(/\.jsonl$/, "") !== native.sessionId);
      const parsed = await parseCursorProjectTranscript(fs.existsSync(path.join(directory, `${native.sessionId}.jsonl`)) ? path.join(directory, `${native.sessionId}.jsonl`) : path.join(directory, native.sessionId, `${native.sessionId}.jsonl`));
      return { id: native.sessionId as string, acknowledged: parsed.userPrompts.some(value => promptHash(value) === launch.promptHash), state: parsed.state, changed };
    }
    // Native read-only index identifies the exact worktree, not a latest-session guess.
    const indexes = fs.readdirSync(this.historyRoot).filter(file => /^state_\d+\.sqlite$/.test(file)).sort((a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]));
    if (!indexes[0]) throw Error("Native history unavailable");
    const db = new Database(path.join(this.historyRoot, indexes[0]), { readonly: true, fileMustExist: true });
    let rows: { id: string; rollout_path: string }[];
    try { rows = db.prepare("SELECT id, rollout_path FROM threads WHERE cwd = ? AND source IN ('cli', 'vscode')").all(runner.cwd) as typeof rows; }
    finally { db.close(); }
    if (rows.length > 1) return { id: launch.sessionId, acknowledged: false, state: "unknown", changed: true };
    if (!rows[0] || !uuid.test(rows[0].id)) return { id: null, acknowledged: false, state: "unknown", changed: false };
    const parsed = await parseCodexSessionFile(rows[0].rollout_path);
    return { id: rows[0].id, acknowledged: parsed.userPrompts.some(value => promptHash(value) === launch.promptHash), state: parsed.state, changed: !!launch.sessionId && launch.sessionId !== rows[0].id };
  }

  override async get(launch: ClaudeLaunch): Promise<ClaudeLaunch> {
    launch.tmuxTarget = tTarget(launch.id);
    const directory = this.directory(launch);
    let live = false, changed = false, acknowledged = launch.launchState === "started", state = "unknown", failed = false;
    try { failed = JSON.parse(fs.readFileSync(path.join(directory, "exit.json"), "utf8")).spawnFailed === true; } catch {}
    try {
      const runner = this.runner(launch);
      launch.cwd = runner.cwd;
      const identity = (await this.tmuxCommand(["display-message", "-p", "-t", `=${launch.tmuxTarget}:`, "#{pane_id}"])).trim();
      live = identity === runner.pane && (await this.bridge(runner)).live;
      const native = await this.history(launch, runner);
      changed = native.changed;
      if (native.id && !changed) launch.nativeId = launch.sessionId = native.id;
      acknowledged ||= native.acknowledged;
      state = native.state;
    } catch { /* Do not guess history or permit writes when owner verification failed. */ live = false; }
    const ready = live && !changed && launch.requestedRemoteControl !== false;
    launch.remoteControl = { state: launch.requestedRemoteControl === false ? "disabled" : ready ? "ready" : "unavailable", url: null, observedAt: new Date().toISOString() };
    launch.launchState = failed ? "failed" : acknowledged ? "started" : live ? "starting" : "unknown";
    launch.activity = !live || changed ? "stopped" : state === "active" ? "working" : state === "completed" ? "idle" : "needs_input";
    launch.state = failed ? "failed" : changed || !live ? "unknown" : state === "completed" ? "completed" : acknowledged ? "running" : "needs_input";
    launch.message = failed ? `The ${this.provider} CLI could not start. Check its installation on your Mac.`
      : changed ? "This terminal changed conversations. Remote input is disabled; the original task will not be replayed."
      : !live ? "The native terminal is unavailable. Check your Mac; the task will not be replayed."
      : !acknowledged ? "The native agent is starting or needs setup. Open the terminal to check sign-in, trust, and permissions."
      : state === "completed" ? "This turn finished. Continue the same live conversation in the terminal."
      : "The native agent accepted the task. Open the terminal for progress or permission prompts.";
    if (this.provider === "codex" && acknowledged && !changed && launch.sessionId && !launch.nativeProjectId
      && Date.now() - (this.bindingAttempts.get(launch.id) ?? 0) > 60_000) {
      this.bindingAttempts.set(launch.id, Date.now());
      try { launch.nativeProjectId = await this.projectBinder(launch); }
      catch { /* Surface unconfirmed grouping until assignment succeeds. */ }
    }
    if (this.provider === "codex" && acknowledged && !changed && launch.sessionId && !launch.nativeProjectId)
      launch.message += " Native project grouping is unconfirmed; check your Codex installation.";
    return launch;
  }

  private async writable(launch: ClaudeLaunch): Promise<Runner> {
    const observed = await this.get(launch);
    if (observed.remoteControl?.state !== "ready") throw new LaunchError(409, "terminal_unavailable", observed.message);
    return this.runner(observed);
  }

  async terminal(launch: ClaudeLaunch): Promise<TerminalSnapshot> {
    const runner = await this.writable(launch);
    const geometry = (await this.tmuxCommand(["display-message", "-p", "-t", runner.pane, "#{pane_width} #{pane_height} #{cursor_x} #{cursor_y}"])).trim().split(" ").map(Number);
    const [cols = 80, rows = 24, x = 0, y = 0] = geometry;
    const screen = await this.tmuxCommand(["capture-pane", "-p", "-e", "-t", runner.pane]);
    return { screen: `\u001b[0m\u001b[2J\u001b[H${screen.replaceAll("\n", "\r\n")}\u001b[${y + 1};${x + 1}H`, cols, rows, writable: true, message: launch.message };
  }

  async input(launch: ClaudeLaunch, data: string): Promise<void> {
    const runner = await this.writable(launch);
    if ((await this.bridge(runner, data)).accepted !== true) throw Error("Native process ended");
  }
}
