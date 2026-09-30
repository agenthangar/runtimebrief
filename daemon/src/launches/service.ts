import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import type { RuntimeBriefConfig } from "../config.js";
import { projectsForConfig } from "../projectRegistry.js";
import { LaunchStore } from "./store.js";
import { DEFAULT_LAUNCH_OPTIONS, LaunchError, type ClaudeLaunchOptions, type ClaudeLaunch, type ClaudeProvider, type NativeClaudeSession, type ClaudeSessionBackend } from "./types.js";
import { promptHash } from "./tLegacy.js";

export const CLAUDE_LAUNCH_ACTION = "launch-claude";

export class LaunchService {
  private readonly pending = new Map<string, Promise<ClaudeLaunch>>();
  private readonly opening = new Map<string, Promise<ClaudeLaunch>>();
  private readonly backends: Map<string, ClaudeSessionBackend>;

  constructor(
    private readonly config: RuntimeBriefConfig,
    private readonly provider: ClaudeProvider,
    private readonly store: LaunchStore,
    private readonly backend?: ClaudeSessionBackend,
    previousBackends: ClaudeSessionBackend[] = [],
  ) {
    this.backends = new Map(previousBackends.map(value => [value.id, value]));
    if (backend) this.backends.set(backend.id, backend);
  }

  private project(id: string, requireWrite: boolean) {
    const project = projectsForConfig(this.config).find(p => p.id === id);
    if (!project) throw new LaunchError(404, "not_found", "This project is no longer registered on your Mac.");
    if (requireWrite && project.claude_launch_enabled === false) {
      throw new LaunchError(403, "launch_disabled", "Claude launches were disabled for this project on your Mac.");
    }
    return project;
  }

  async list(projectId: string) {
    this.project(projectId, false);
    let capability;
    try {
      this.project(projectId, true);
      capability = this.backend ? await this.backend.capability(this.project(projectId, true).path) : await this.provider.capability();
    } catch (error) {
      if (!(error instanceof LaunchError)) throw error;
      capability = { available: false, message: error.message };
    }
    const receipts = this.store.list(projectId);
    let native: NativeClaudeSession[] | null = null;
    if (receipts.some(receipt => !receipt.backend)) {
      try { native = await this.provider.sessions(); } catch { /* preserve old receipts */ }
    }
    const launches = await Promise.all(receipts.map(receipt => receipt.backend ? this.observeBackend(receipt) : this.reconcile(receipt, native)));
    return { capability, launches };
  }

  async start(projectId: string, requestId: string, prompt: string, options: ClaudeLaunchOptions = DEFAULT_LAUNCH_OPTIONS): Promise<ClaudeLaunch> {
    const project = this.project(projectId, true);
    // Preserve request identity for retries from older clients using the defaults.
    const identity: unknown[] = [projectId, prompt];
    if (options.model !== "default" || options.permissionMode !== "manual") identity.push(options.model, options.permissionMode);
    if (options.remoteControl === false) identity.push("remoteControl", false);
    const fingerprint = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const previous = this.store.byRequest(requestId, fingerprint);
    if (previous) return this.pending.get(requestId) ?? previous;
    if (!this.backend && options.remoteControl === true) {
      throw new LaunchError(409, "unsupported", "The legacy background launcher does not support Remote Control. Select local-only or install the t launcher.");
    }
    // The synchronous reservation prevents two in-flight requests from dispatching twice.
    let cwd: string;
    try {
      cwd = fs.realpathSync(project.path);
      if (!fs.statSync(cwd).isDirectory()) throw new Error("not directory");
    } catch {
      throw new LaunchError(409, "project_unavailable", "The project folder is no longer available on your Mac.");
    }
    if (this.backend) {
      const capability = await this.backend.capability(cwd);
      if (!capability.available) throw new LaunchError(409, "requires_setup", capability.message);
      // Capability checks yield. Another request may have reserved while we checked.
      const reserved = this.store.byRequest(requestId, fingerprint);
      if (reserved) return this.pending.get(requestId) ?? reserved;
    }
    const id = randomUUID();
    const receipt: ClaudeLaunch = {
      id, projectId, name: `RuntimeBrief ${project.name} ${id}`,
      createdAt: new Date().toISOString(), cwd, nativeId: null, sessionId: null, openedAt: null,
      state: "starting", message: "Checking Claude Code on your Mac…",
      model: options.model, permissionMode: options.permissionMode,
      ...(this.backend ? {
        backend: this.backend.id, projectRoot: cwd, promptHash: promptHash(prompt),
        launchState: "starting" as const, activity: "unknown" as const,
        requestedRemoteControl: options.remoteControl !== false,
      } : {}),
    };
    const reserved = this.store.insert(requestId, fingerprint, receipt);
    if (reserved.id !== id) return this.pending.get(requestId) ?? reserved;
    const task = this.dispatch(receipt, prompt);
    this.pending.set(requestId, task);
    try { return await task; } finally { this.pending.delete(requestId); }
  }

  private async dispatch(receipt: ClaudeLaunch, prompt: string): Promise<ClaudeLaunch> {
    if (receipt.backend) {
      try {
        await this.backend!.create(receipt, prompt);
        return await this.observeBackend(receipt);
      } catch {
        receipt.state = "unknown";
        receipt.launchState = "unknown";
        receipt.message = "The t launch result is uncertain. Refresh this receipt before starting another task.";
        this.store.save(receipt);
        return receipt;
      }
    }
    const capability = await this.provider.capability().catch(() => ({ available: false, message: "Claude Code is unavailable on your Mac." }));
    if (!capability.available) {
      receipt.state = "failed";
      receipt.message = capability.message;
      this.store.save(receipt);
      return receipt;
    }
    // Never persist the prompt or include subprocess output in API errors/logs.
    try {
      receipt.nativeId = await this.provider.start(receipt.cwd, receipt.name, prompt, {
        model: receipt.model ?? "default", permissionMode: receipt.permissionMode ?? "manual",
      });
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

  private async observeBackend(receipt: ClaudeLaunch): Promise<ClaudeLaunch> {
    const backend = this.backends.get(receipt.backend!);
    if (!backend) {
      receipt.state = "unknown";
      receipt.message = "This session belongs to a backend that is currently unavailable. Its task will not be replayed.";
      if (receipt.remoteControl) receipt.remoteControl = { state: "unknown", url: null, observedAt: new Date().toISOString() };
    } else {
      try { receipt = await backend.get(receipt); }
      catch {
        receipt.state = "unknown";
        receipt.message = "Current t status is unavailable. Check its native session on your Mac.";
        if (receipt.remoteControl) receipt.remoteControl = { state: "unknown", url: null, observedAt: new Date().toISOString() };
      }
    }
    this.store.save(receipt);
    return receipt;
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
    if (receipt.backend) {
      const backend = this.backends.get(receipt.backend);
      if (!backend) throw new LaunchError(409, "backend_unavailable", "The original session backend is unavailable. The task will not be replayed.");
      await backend.open(receipt);
      return receipt;
    }
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
