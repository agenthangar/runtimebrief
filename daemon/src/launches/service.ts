import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import type { RuntimeBriefConfig } from "../config.js";
import { projectsForConfig } from "../projectRegistry.js";
import { LaunchStore } from "./store.js";
import { LaunchError, type ClaudeLaunch, type ClaudeProvider, type NativeClaudeSession } from "./types.js";

export const CLAUDE_LAUNCH_ACTION = "launch-claude";

export class LaunchService {
  private readonly pending = new Map<string, Promise<ClaudeLaunch>>();
  private readonly opening = new Map<string, Promise<ClaudeLaunch>>();

  constructor(
    private readonly config: RuntimeBriefConfig,
    private readonly provider: ClaudeProvider,
    private readonly store: LaunchStore,
  ) {}

  private project(id: string, requireWrite: boolean) {
    const project = projectsForConfig(this.config).find(p => p.id === id);
    if (!project) throw new LaunchError(404, "not_found", "This project is no longer registered on your Mac.");
    // Only explicit entries grant writes. Auto-discovery never grants execution.
    if (requireWrite && !this.config.projects.some(p => p.id === id && p.allowed_actions?.includes(CLAUDE_LAUNCH_ACTION))) {
      throw new LaunchError(403, "launch_disabled", "Enable Claude launches for this project on your Mac first.");
    }
    return project;
  }

  async list(projectId: string) {
    this.project(projectId, false);
    let capability;
    try {
      this.project(projectId, true);
      capability = await this.provider.capability();
    } catch (error) {
      if (!(error instanceof LaunchError)) throw error;
      capability = { available: false, message: error.message };
    }
    let native: NativeClaudeSession[] | null = null;
    try { native = await this.provider.sessions(); } catch { /* preserve receipts when Claude is unavailable */ }
    const launches = this.store.list(projectId).map(receipt => this.reconcile(receipt, native));
    return { capability, launches };
  }

  async start(projectId: string, requestId: string, prompt: string): Promise<ClaudeLaunch> {
    const project = this.project(projectId, true);
    const fingerprint = createHash("sha256").update(JSON.stringify([projectId, prompt])).digest("hex");
    const previous = this.store.byRequest(requestId, fingerprint);
    if (previous) return this.pending.get(requestId) ?? previous;
    // The synchronous reservation prevents two in-flight requests from dispatching twice.
    let cwd: string;
    try {
      cwd = fs.realpathSync(project.path);
      if (!fs.statSync(cwd).isDirectory()) throw new Error("not directory");
    } catch {
      throw new LaunchError(409, "project_unavailable", "The project folder is no longer available on your Mac.");
    }
    const id = randomUUID();
    const receipt: ClaudeLaunch = {
      id, projectId, name: `RuntimeBrief ${project.name} ${id}`,
      createdAt: new Date().toISOString(), cwd, nativeId: null, sessionId: null, openedAt: null,
      state: "starting", message: "Checking Claude Code on your Mac…",
    };
    this.store.insert(requestId, fingerprint, receipt);
    const task = this.dispatch(receipt, prompt);
    this.pending.set(requestId, task);
    try { return await task; } finally { this.pending.delete(requestId); }
  }

  private async dispatch(receipt: ClaudeLaunch, prompt: string): Promise<ClaudeLaunch> {
    const capability = await this.provider.capability().catch(() => ({ available: false, message: "Claude Code is unavailable on your Mac." }));
    if (!capability.available) {
      receipt.state = "failed";
      receipt.message = capability.message;
      this.store.save(receipt);
      return receipt;
    }
    // Never persist the prompt or include subprocess output in API errors/logs.
    try {
      receipt.nativeId = await this.provider.start(receipt.cwd, receipt.name, prompt);
      receipt.message = "Claude accepted the task. Waiting for session status…";
      this.store.save(receipt);
      return this.reconcile(receipt, await this.provider.sessions());
    } catch {
      receipt.state = "unknown";
      receipt.message = "The launch result is uncertain. Refresh to check Claude before starting another task.";
      this.store.save(receipt);
      return receipt;
    }
  }

  private reconcile(receipt: ClaudeLaunch, native: NativeClaudeSession[] | null): ClaudeLaunch {
    if (receipt.sessionId && this.provider.desktopHas(receipt.sessionId)) {
      receipt.state = "in_desktop";
      receipt.message = "Continue this conversation in Claude Desktop on your Mac.";
      receipt.openedAt ??= new Date().toISOString();
      this.store.save(receipt);
      return receipt;
    }
    // Once handed off, never resume or redispatch a Desktop-owned conversation.
    if (receipt.openedAt) return receipt;
    if (receipt.state === "failed" && !receipt.nativeId) return receipt;
    const match = native?.find(s => (!receipt.sessionId || receipt.sessionId === s.sessionId) && s.kind === "background" && (
      receipt.nativeId ? s.id === receipt.nativeId : s.name === receipt.name
    ));
    if (match?.id && /^[a-f0-9]{8}$/.test(match.id)) {
      receipt.nativeId = match.id;
      receipt.sessionId = match.sessionId ?? receipt.sessionId;
      receipt.cwd = match.cwd;
      const state = match.status === "waiting" || match.state === "blocked" ? "needs_input"
        : match.state === "working" ? "running"
        : match.state === "done" ? "completed"
        : match.state === "failed" ? "failed"
        : match.state === "stopped" ? "stopped" : "unknown";
      receipt.state = state;
      receipt.message = {
        needs_input: "Claude needs your attention. Continue on your Mac.",
        running: "Claude is working on your Mac.",
        completed: "Claude finished this turn. Continue on your Mac to review it.",
        failed: "Claude reported an error. Open the session on your Mac for details.",
        stopped: "The Claude session is stopped. Its conversation is saved on your Mac.",
        unknown: "Claude has not reported a current state. Refresh or check your Mac.",
      }[state];
      this.store.save(receipt);
    } else if (receipt.state !== "starting" || Date.now() - Date.parse(receipt.createdAt) > 60_000) {
      receipt.state = "unknown";
      receipt.message = "Current Claude status is unavailable. Check your Mac before starting another task.";
      this.store.save(receipt);
    }
    return receipt;
  }

  async open(projectId: string, id: string): Promise<ClaudeLaunch> {
    this.project(projectId, true);
    const receipt = this.store.get(id, projectId);
    if (!receipt) throw new LaunchError(404, "not_found", "This launch could not be found.");
    if (!receipt.nativeId) throw new LaunchError(409, "not_ready", "Claude has not confirmed a session yet. Refresh before taking over.");
    if (this.opening.has(id)) return this.opening.get(id)!;
    const task = this.provider.open(receipt).then(() => {
      receipt.openedAt = new Date().toISOString();
      receipt.state = "in_desktop";
      receipt.message = "Continue this conversation in Claude Desktop on your Mac.";
      this.store.save(receipt);
      return receipt;
    }).catch(() => {
      throw new LaunchError(503, "open_failed", "Desktop handoff needs attention on your Mac. Check Claude sign-in and workspace trust, then refresh. The saved conversation is preserved.");
    });
    this.opening.set(id, task);
    try { return await task; } finally { this.opening.delete(id); }
  }

  close(): void { this.store.close(); }
}
