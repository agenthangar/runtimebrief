import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { configDir } from "../config.js";
import { ensurePrivateDirectory } from "../privateData.js";
import { parseClaudeSessionFile } from "../adapters/claudeCodeSessions.js";
import { NativeClaudeProvider, resolveClaudeBinary } from "./claude.js";
import { hasPinnedT, tDependencyRoot } from "./tDependency.js";
import { LaunchError, type ClaudeLaunch, type ClaudeSessionBackend, type LaunchCapability } from "./types.js";

const exec = promisify(execFile);
const scripts = fileURLToPath(new URL("../../scripts/", import.meta.url));
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const sleep = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));
import { promptHash, nativeRemoteURL } from "./identity.js";
export { promptHash, nativeRemoteURL } from "./identity.js";
export const tSlot = (id: string) => {
  if (!uuid.test(id)) throw new Error("Invalid launch identity");
  return BigInt(`0x${id.replaceAll("-", "")}`).toString();
};
export const tTarget = (id: string) => `dev-runtimebrief-${tSlot(id)}`;

export interface TLegacyOptions {
  root?: string;
  tHome?: string;
  claudeRoot?: string;
  tmux?: string;
  binary?: string;
  /** Test isolation only; normal sessions share the user's tmux server. */
  socket?: string;
}

/** Unchanged t creates the worktree and terminal; RuntimeBrief supplies missing machine guarantees. */
export class TLegacyBackend implements ClaudeSessionBackend {
  readonly id: string = "t-legacy";
  protected readonly root: string;
  protected readonly tHome: string;
  private readonly claudeRoot: string;
  protected readonly tmux: string;
  protected readonly binary: string;
  protected readonly socket: string | undefined;
  private readonly native: NativeClaudeProvider;

  constructor(options: TLegacyOptions = {}) {
    this.root = options.root ?? configDir();
    this.tHome = options.tHome ?? tDependencyRoot(this.root);
    this.claudeRoot = options.claudeRoot ?? path.join(os.homedir(), ".claude");
    this.tmux = options.tmux ?? ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find(file => fs.existsSync(file)) ?? "/opt/homebrew/bin/tmux";
    this.binary = options.binary ?? resolveClaudeBinary();
    this.socket = options.socket;
    this.native = new NativeClaudeProvider(this.binary);
  }

  readonly provider = "claude" as "claude" | "codex" | "cursor";

  async capability(cwd?: string): Promise<LaunchCapability> {
    if (!hasPinnedT(this.tHome)) return { available: false, message: "Run runtimebriefd install-t on your Mac, then refresh to enable t sessions." };
    try {
      await exec(this.tmux, ["-V"], { timeout: 5_000 });
      const { stdout } = await exec(this.binary, ["--help"], { timeout: 10_000, maxBuffer: 128_000 });
      if (!stdout.includes("--remote-control")) return { available: false, message: "Update Claude Code on your Mac to enable Remote Control sessions." };
      if (cwd) {
        await exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--verify", "refs/remotes/origin/main"], { timeout: 5_000 });
        // t currently fetches/branches from origin/main. Never silently use the shared checkout.
      }
    } catch { return { available: false, message: "t needs tmux, Claude Code, and a Git project with origin/main on your Mac." }; }
    const auth = await this.native.capability(cwd);
    return auth.available ? { ...auth, message: "Starts Claude in an isolated t worktree on your Mac. Remote Control is requested by default; Claude handles permissions and setup." } : auth;
  }
  resolveSettings(cwd: string, options: import("./types.js").ClaudeLaunchOptions) { return this.native.resolveSettings(cwd, options); }

  protected directory(launch: ClaudeLaunch): string {
    tSlot(launch.id);
    return path.join(this.root, "t-launches", launch.id);
  }

  protected async tmuxCommand(args: string[]): Promise<string> {
    const { stdout } = await exec(this.tmux, [...(this.socket ? ["-L", this.socket] : []), ...args], { timeout: 3_000, maxBuffer: 256_000 });
    return stdout;
  }

  async create(launch: ClaudeLaunch, prompt: string): Promise<void> {
    const directory = this.directory(launch);
    ensurePrivateDirectory(path.dirname(directory));
    // A second daemon/process cannot run t twice for the same durable receipt.
    fs.mkdirSync(directory, { mode: 0o700 });
    ensurePrivateDirectory(path.join(directory, "bin"));
    const wrapper = path.join(directory, "bin", this.provider);
    // The runner is a script invoked with literal argv, including paths with spaces.
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    fs.writeFileSync(wrapper, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(path.join(scripts, this.provider === "claude" ? "t-claude.mjs" : "t-agent.mjs"))} "$@"\n`, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, "payload.json"), JSON.stringify({
      provider: this.provider, token: randomUUID(),
      nativeDirectories: Object.fromEntries(["XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_STATE_HOME", "CODEX_HOME"].map(key => [key, process.env[key] ?? null])),
      binary: this.binary, name: launch.name, prompt,
      model: launch.effectiveModel ?? launch.model ?? "default", permissionMode: launch.permissionMode ?? "manual",
      reasoningEffort: launch.effectiveReasoningEffort ?? launch.reasoningEffort ?? "default",
      remoteControl: launch.requestedRemoteControl !== false,
    }), { flag: "wx", mode: 0o600 });
    // t's logging stays native, but the file is private even on an existing tmux server.
    const logDirectory = path.join(os.homedir(), ".tmux-logs");
    fs.mkdirSync(logDirectory, { recursive: true, mode: 0o700 });
    const logfile = path.join(logDirectory, `${tTarget(launch.id)}.log`);
    const log = fs.openSync(logfile, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    fs.closeSync(log);
    const tmuxCommand = this.socket ? path.join(directory, "bin", "tmux-test") : this.tmux;
    if (this.socket) fs.writeFileSync(tmuxCommand, `#!/bin/sh\nexec ${quote(this.tmux)} -L ${quote(this.socket)} "$@"\n`, { mode: 0o700 });
    await exec("/bin/zsh", ["-f", path.join(scripts, "t-launch.zsh")], {
      timeout: 20_000, maxBuffer: 128_000,
      env: { ...process.env,
        RB_T_PROVIDER: this.provider, RB_T_DIR: directory, RB_T_HOME: this.tHome, RB_T_TMUX: tmuxCommand,
        RB_T_PATH: `${path.dirname(process.execPath)}:${path.dirname(this.binary)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin`,
        RB_T_PROJECT: launch.projectRoot ?? launch.cwd, RB_T_REPO: "runtimebrief", RB_T_SLOT: tSlot(launch.id),
        RB_T_WORKTREES: path.join(this.root, "t-worktrees"),
        SHELL_SESSIONS_DISABLE: "1",
      },
    });
    // t's attach shim can return before tmux has started the private Claude runner.
    // Give that runner a short window to publish its native identity before the first status read.
    const deadline = Date.now() + 3_000;
    while (Date.now() < deadline) {
      if (fs.existsSync(path.join(directory, "native.json")) || fs.existsSync(path.join(directory, "exit.json"))) return;
      await sleep(100);
    }
  }

  async get(launch: ClaudeLaunch): Promise<ClaudeLaunch> {
    const directory = this.directory(launch);
    const target = tTarget(launch.id);
    const remote = { state: launch.requestedRemoteControl === false ? "disabled" : "unknown", url: null, observedAt: new Date().toISOString() } as NonNullable<ClaudeLaunch["remoteControl"]>;
    launch.remoteControl = remote;
    let native: { sessionId: string; cwd: string } | null = null;
    let spawnFailed = false;
    let exited = false;
    try {
      const value = JSON.parse(fs.readFileSync(path.join(directory, "native.json"), "utf8"));
      const expected = path.join(this.root, "t-worktrees", path.basename(launch.projectRoot ?? launch.cwd), tSlot(launch.id));
      if (uuid.test(value.sessionId) && fs.realpathSync(value.cwd) === fs.realpathSync(expected)) native = value;
    } catch { /* Dispatch may not have reached the private runner. */ }
    try {
      const exit = JSON.parse(fs.readFileSync(path.join(directory, "exit.json"), "utf8"));
      spawnFailed = exit.spawnFailed === true;
      exited = typeof exit.code === "number" || exit.code === null || spawnFailed;
    } catch { /* Still running or uncertain. */ }
    let pane = "";
    try { pane = await this.tmuxCommand(["capture-pane", "-p", "-S", "-80", "-t", `=${target}:`]); } catch { /* No terminal is not proof of no dispatch. */ }
    // A shell can remain in t's pane after Claude exits. It cannot keep a link ready.
    let live = pane.length > 0 && !exited;
    let ownerChanged = false;
    if (live && native) {
      try {
        const identity = await this.tmuxCommand(["show-environment", "-t", `=${target}`, "CLAUDE_RESUME_ID"]);
        ownerChanged = identity.trim() !== `CLAUDE_RESUME_ID=${native.sessionId}`;
        live = !ownerChanged;
      } catch { live = false; }
    }
    if (live) launch.tmuxTarget = target;
    else delete launch.tmuxTarget;
    let acknowledged = launch.launchState === "started";
    let state = "unknown";
    if (native) {
      launch.cwd = native.cwd;
      const file = path.join(this.claudeRoot, "projects", native.cwd.replace(/[^A-Za-z0-9]/g, "-"), `${native.sessionId}.jsonl`);
      // Native history is read-only. In particular, a tmux stamp alone is not acknowledgment.
      const parsed = await parseClaudeSessionFile(file);
      if (parsed.sessionId === native.sessionId) {
        launch.sessionId = native.sessionId;
        launch.nativeId = native.sessionId;
        acknowledged ||= parsed.userPrompts.some(value => promptHash(value) === launch.promptHash);
        state = parsed.state;
        const bridge = parsed.remoteControlStatus;
        if (bridge && remote.state !== "disabled") {
          const url = nativeRemoteURL(bridge.url);
          // The latest native bridge status wins, including a later disconnect/failure.
          remote.state = live && url && bridge.content.includes("/remote-control is active") ? "ready" : "unavailable";
          remote.url = remote.state === "ready" ? url : null;
          remote.observedAt = bridge.timestamp ?? remote.observedAt;
        }
      }
    }
    const needsSetup = /trust this folder|Enable Remote Control|sign in|log in/i.test(pane);
    launch.launchState = acknowledged ? "started" : spawnFailed ? "failed" : live ? "starting" : "unknown";
    launch.activity = !live ? "stopped" : needsSetup || state === "waiting" ? "needs_input" : state === "active" ? "working" : state === "completed" ? "idle" : "unknown";
    launch.state = spawnFailed ? "failed" : needsSetup || state === "waiting" ? "needs_input" : !live ? acknowledged ? "stopped" : "unknown" : state === "completed" ? "completed" : acknowledged ? "running" : "starting";
    launch.message = spawnFailed ? "Claude could not start. Check its installation on your Mac."
      : ownerChanged ? "This terminal now contains a different conversation. Check your Mac; the original task will not be replayed."
      : needsSetup ? "Claude needs workspace trust or setup on your Mac. Attach to this t session to continue."
      : !live && !native ? "Claude has not confirmed a native session, so this task is not available in Claude. Check your Mac before retrying; RuntimeBrief will not replay it automatically."
      : !live && acknowledged ? "Claude accepted the task, but its t session ended. The saved conversation is on your Mac; this task will not be replayed automatically."
      : !live ? "Claude session setup ended before the task was confirmed. Check Claude on your Mac; RuntimeBrief will not replay it automatically."
      : !acknowledged ? "The t session is starting. Claude has not yet acknowledged the task."
      : state === "completed" ? "Claude finished this turn. Review it in Remote Control or attach to its terminal."
      : state === "waiting" ? "Claude needs your attention. Continue in its native session."
      : "Claude accepted the task and is working in its t session.";
    if (remote.state === "unknown" && live && !acknowledged && launch.requestedRemoteControl !== false) remote.state = "starting";
    return launch;
  }

  async open(): Promise<void> {
    throw new LaunchError(409, "use_native_session", "Continue this t session using its Remote Control link or terminal. Desktop handoff remains available for older background launches.");
  }
}
