import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { configDir } from "../config.js";
import { ensurePrivateDirectory } from "../privateData.js";
import { resolveClaudeBinary } from "./claude.js";
import { resolveAgentBinary } from "./binaries.js";
import { NativeModelCatalog, discoverNativeModels } from "./nativeModels.js";
import { discoverClaudeModels } from "./claudeModels.js";
import { resolveClaudeSettings, resolveCodexSettings, resolveCursorSettings } from "./nativeSettings.js";
import { parseClaudeSessionFile } from "../adapters/claudeCodeSessions.js";
import { nativeRemoteURL, promptHash } from "./identity.js";
import { NativeProviderHealth } from "./providerHealth.js";
import { withCodexApi } from "./codexApi.js";
import { LaunchError, permissionModes, type ClaudeSessionBackend, type ClaudeLaunch, type LaunchCapability, type ClaudeLaunchOptions, type ConversationSnapshot, type SessionReply } from "./types.js";

const exec = promisify(execFile);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const runnerScript = fileURLToPath(new URL("../../scripts/native-session.mjs", import.meta.url));
interface State extends ConversationSnapshot { cwd: string; provider: string; sessionId: string | null; nativeProjectId?: string; accepted: boolean; updatedAt: string }

/** Direct provider adapter; a detached owner outlives daemon/UI connections. */
export class NativeSessionBackend implements ClaudeSessionBackend {
  readonly id: string;
  private readonly binary: string;
  private readonly root: string;
  private readonly catalogs = new Map<string, NativeModelCatalog>();
  private readonly health = new NativeProviderHealth(() => this.checkHealth());
  constructor(readonly provider: "claude" | "codex" | "cursor", root = configDir()) {
    this.root = path.resolve(root);
    this.id = `native-${provider}`;
    this.binary = provider === "claude" ? resolveClaudeBinary() : resolveAgentBinary(provider);
  }
  private modes() { return permissionModes(this.provider); }
  private async checkHealth(): Promise<LaunchCapability> {
    try {
      if (this.provider === "claude") {
        const [{ stdout }, { stdout: help }] = await Promise.all([exec(this.binary, ["auth", "status"], { timeout: 10000 }), exec(this.binary, ["--help"], { timeout: 10000 })]);
        if (!help.includes("--remote-control")) throw Error();
        if (JSON.parse(stdout).loggedIn !== true) throw Error();
      } else if (this.provider === "codex") {
        const [, { stdout: help }] = await Promise.all([exec(this.binary, ["login", "status"], { timeout: 10000 }), exec(this.binary, ["--help"], { timeout: 10000 })]);
        if (!help.includes("app-server")) throw Error();
        try { await withCodexApi(this.binary, request => request("project/list", { limit: 1 })); }
        catch { return { available: false, message: "Update Codex on your Mac to enable native project assignment." }; }
      } else {
        const [{ stdout }, { stdout: help }] = await Promise.all([exec(this.binary, ["status"], { timeout: 10000, env: { ...process.env, NO_COLOR: "1" } }), exec(this.binary, ["acp", "--help"], { timeout: 10000 })]);
        if (!help.includes("Agent Client Protocol")) throw Error();
        if (/not logged in|not authenticated|logged out/i.test(stdout)) throw Error();
      }
    } catch { return { available: false, message: `Install and sign in to ${this.provider === "claude" ? "Claude Code" : this.provider} on your Mac.` }; }
    return { available: true, message: `Ready to start ${this.provider === "claude" ? "Claude Code" : this.provider} on your Mac.`, permissionModes: this.modes() };
  }
  async capability(cwd?: string): Promise<LaunchCapability> {
    const health = await this.health.get();
    if (!health.available) return health;
    // Account health is shared; catalogs/defaults are loaded only for the selected workspace.
    if (!cwd) return health;
    try { await exec("/usr/bin/git", ["-C", cwd, "rev-parse", "--verify", "HEAD"], { timeout: 2000 }); }
    catch { return { available: false, message: "This project needs a Git repository with an initial commit before starting an isolated task." }; }
    const key = this.provider === "claude" ? cwd : "global";
    if (!this.catalogs.has(key)) this.catalogs.set(key, new NativeModelCatalog(() => this.provider === "claude" ? discoverClaudeModels(this.binary, cwd) : discoverNativeModels(this.provider, this.binary)));
    const catalog = await this.catalogs.get(key)!.get();
    const defaults = await this.settings(cwd, { model: "default", permissionMode: "manual" }, catalog.models ?? []);
    return { ...health, ...catalog, ...(defaults.defaultModelLabel ? { defaultModelLabel: defaults.defaultModelLabel } : {}), ...(defaults.defaultReasoningLabel ? { defaultReasoningLabel: defaults.defaultReasoningLabel } : {}) };
  }
  private settings(cwd: string, options: ClaudeLaunchOptions, models: import("./types.js").AgentModel[]) {
    return this.provider === "claude" ? Promise.resolve(resolveClaudeSettings(cwd, options)) : this.provider === "codex" ? resolveCodexSettings(this.binary, cwd, options, models) : Promise.resolve(resolveCursorSettings(options, models));
  }
  async resolveSettings(cwd: string, options: ClaudeLaunchOptions) {
    return this.settings(cwd, options, [...this.catalogs.values()][0] ? (await [...this.catalogs.values()][0]!.get()).models ?? [] : []);
  }
  private directory(launch: ClaudeLaunch) {
    if (!uuid.test(launch.id)) throw Error("Invalid identity");
    return path.join(this.root, "native-launches", launch.id);
  }
  private workspace(launch: ClaudeLaunch) { return path.join(this.root, "native-worktrees", launch.id); }
  async create(launch: ClaudeLaunch, prompt: string): Promise<void> {
    const directory = this.directory(launch);
    ensurePrivateDirectory(path.dirname(directory)); ensurePrivateDirectory(path.dirname(this.workspace(launch)));
    fs.mkdirSync(directory, { mode: 0o700 });
    fs.writeFileSync(path.join(directory, "payload.json"), JSON.stringify({ id: launch.id, token: randomUUID(), provider: this.provider, binary: this.binary, projectRoot: launch.projectRoot ?? launch.cwd, projectName: launch.projectName, cwd: this.workspace(launch), name: launch.name, prompt, model: launch.effectiveModel ?? launch.model ?? "default", mode: launch.permissionMode ?? "manual", effort: launch.effectiveReasoningEffort ?? launch.reasoningEffort ?? "default", remoteControl: launch.requestedRemoteControl !== false }), { flag: "wx", mode: 0o600 });
    const child = spawn(process.execPath, [runnerScript, directory], { detached: true, stdio: "ignore" });
    await new Promise<void>((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject); }); child.unref();
  }
  private owner(launch: ClaudeLaunch): { token: string; socket: string; pid: number; cwd: string } {
    const owner = JSON.parse(fs.readFileSync(path.join(this.directory(launch), "owner.json"), "utf8"));
    if (!uuid.test(owner.token) || owner.socket !== `/tmp/rb-native-${launch.id}.sock` || fs.realpathSync(owner.cwd) !== fs.realpathSync(this.workspace(launch)) || !Number.isInteger(owner.pid) || owner.pid < 2) throw Error("Owner mismatch");
    process.kill(owner.pid, 0); return owner;
  }
  private bridge(launch: ClaudeLaunch, body: Record<string, unknown>) {
    const owner = this.owner(launch);
    return new Promise<any>((resolve, reject) => {
      const connection = net.createConnection(owner.socket); let output = "";
      connection.setTimeout(body.op === "reply" ? 35000 : 1500, () => connection.destroy(Error("Owner unavailable")));
      connection.once("connect", () => connection.end(JSON.stringify({ ...body, token: owner.token }) + "\n"));
      connection.on("data", data => { output += data; if (output.length > 300000) connection.destroy(Error("Oversized response")); });
      connection.once("error", reject); connection.once("end", () => { try { const response = JSON.parse(output); if (response.error) reject(new LaunchError(409, "not_ready", "The agent is busy or this request is no longer pending. Refresh the conversation.")); else resolve(response); } catch { reject(Error("Invalid owner response")); } });
    });
  }
  private read(launch: ClaudeLaunch): State {
    const value = JSON.parse(fs.readFileSync(path.join(this.directory(launch), "state.json"), "utf8"));
    const canonical = (value: string) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };
    if (value.provider !== this.provider || canonical(value.cwd) !== canonical(this.workspace(launch))) throw Error("Workspace mismatch");
    return value;
  }
  async get(launch: ClaudeLaunch): Promise<ClaudeLaunch> {
    delete launch.tmuxTarget;
    let state: State;
    try { state = this.read(launch); } catch {
      launch.state = Date.now() - Date.parse(launch.createdAt) < 60000 ? "starting" : "unknown";
      launch.message = launch.state === "starting" ? "Starting the native agent…" : "The agent has not confirmed startup. Check your Mac before retrying."; return launch;
    }
    let live = false; try { live = (await this.bridge(launch, { op: "status" })).live === true; } catch {}
    launch.cwd = state.cwd; launch.sessionId = launch.nativeId = state.sessionId;
    if (state.nativeProjectId) launch.nativeProjectId = state.nativeProjectId;
    launch.state = state.state as ClaudeLaunch["state"]; launch.message = state.message;
    launch.launchState = state.accepted ? "started" : state.state === "failed" ? "failed" : "starting";
    launch.activity = live ? state.state === "needs_input" ? "needs_input" : state.state === "running" ? "working" : state.state === "completed" ? "idle" : "unknown" : "stopped";
    launch.remoteControl = { state: launch.requestedRemoteControl === false ? "disabled" : live && this.provider !== "claude" && !!state.sessionId ? "ready" : "starting", url: null, observedAt: state.updatedAt };
    if (!live) launch.remoteControl.state = launch.requestedRemoteControl === false ? "disabled" : "unavailable";
    if (!live && state.state !== "failed") { launch.state = "stopped"; launch.message = state.sessionId ? "The agent stopped. Its conversation is saved on your Mac." : "The agent stopped before confirming a conversation. Check its setup on your Mac."; }
    if (this.provider === "claude" && state.sessionId) {
      const file = path.join(os.homedir(), ".claude/projects", state.cwd.replace(/[^A-Za-z0-9]/g, "-"), `${state.sessionId}.jsonl`);
      const parsed = await parseClaudeSessionFile(file);
      launch.nativeId = parsed.sessionId === state.sessionId ? state.sessionId : null;
      const acknowledged = parsed.sessionId === state.sessionId && parsed.userPrompts.some(value => promptHash(value) === launch.promptHash);
      if (acknowledged) {
        launch.launchState = "started";
        if (!live && state.state !== "failed") launch.message = "Claude stopped. Its conversation is saved on your Mac.";
      }
      let screen = ""; try { screen = fs.readFileSync(path.join(this.directory(launch), "screen.txt"), "utf8"); } catch {}
      if (live) {
        const normalized = screen.slice(-16000).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "").replace(/\s/g, "").toLowerCase();
        const bridgeReady = parsed.remoteControlStatus?.content.includes("/remote-control is active") === true;
        const needsSetup = (!acknowledged && /trustthisfolder|accessingworkspace|quicksafetycheck|signin|login/.test(normalized)) || (!bridgeReady && /enableremotecontrol/.test(normalized));
        launch.state = needsSetup || parsed.state === "waiting" ? "needs_input" : parsed.state === "completed" ? "completed" : acknowledged ? "running" : "starting";
        launch.activity = launch.state === "needs_input" ? "needs_input" : launch.state === "completed" ? "idle" : acknowledged ? "working" : "unknown";
        launch.message = needsSetup ? (launch.requestedRemoteControl === false ? "Finish Claude setup on your Mac." : "Finish Claude setup on your Mac or here.") : launch.state === "completed" ? "Ready to review in Claude." : acknowledged ? "Claude is working on your Mac." : "Waiting for Claude to accept the task.";
      }
      const url = nativeRemoteURL(parsed.remoteControlStatus?.url);
      if (live && url && parsed.remoteControlStatus?.content.includes("/remote-control is active") && launch.requestedRemoteControl !== false) { launch.remoteControl.state = "ready"; launch.remoteControl.url = url; }
      else if (live && parsed.remoteControlStatus && launch.requestedRemoteControl !== false) launch.remoteControl.state = "unavailable";
    }
    return launch;
  }
  async conversation(launch: ClaudeLaunch): Promise<ConversationSnapshot> {
    const observed = await this.get(launch); const state = this.read(launch);
    return { state: observed.state, message: observed.message, messages: state.messages, requests: observed.activity === "stopped" ? [] : state.requests, writable: launch.requestedRemoteControl !== false && observed.activity !== "stopped" && this.provider !== "claude" };
  }
  async reply(launch: ClaudeLaunch, body: SessionReply) { return this.bridge(launch, { op: "reply", ...body }); }
  async terminal(launch: ClaudeLaunch) { return this.bridge(launch, { op: "screen" }); }
  async input(launch: ClaudeLaunch, data: string) {
    if (this.provider !== "claude") throw new LaunchError(409, "unsupported", "Continue through the conversation.");
    await this.bridge(launch, { op: "keys", data });
  }
  async open(): Promise<void> { throw new LaunchError(409, "use_native_session", "Continue using the confirmed Claude link or the conversation in RuntimeBrief."); }
}
