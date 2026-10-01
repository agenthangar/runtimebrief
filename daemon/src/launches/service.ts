import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import type { RuntimeBriefConfig } from "../config.js";
import { projectsForConfig } from "../projectRegistry.js";
import { LaunchStore } from "./store.js";
import { DEFAULT_LAUNCH_OPTIONS, MODEL_ID, REASONING_EFFORTS, permissionModes, LaunchError, type ClaudeLaunchOptions, type ClaudeLaunch, type ClaudeProvider, type NativeClaudeSession, type ClaudeSessionBackend, type SessionProvider, type LaunchCapability, type SessionReply } from "./types.js";
import { promptHash } from "./identity.js";

export const CLAUDE_LAUNCH_ACTION = "launch-claude";

export class LaunchService {
  private readonly pending = new Map<string, Promise<ClaudeLaunch>>();
  private readonly inputPending = new Set<string>();
  private readonly opening = new Map<string, Promise<ClaudeLaunch>>();
  private readonly observations = new Map<string, Promise<void>>();
  private readonly providerHealth = new Map<SessionProvider, LaunchCapability & { checking?: boolean }>();
  private healthPending: Promise<void> | undefined;
  private healthAt = 0;
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
      throw new LaunchError(403, "launch_disabled", "Session launches were disabled for this project on your Mac.");
    }
    return project;
  }

  private launcher(id: SessionProvider) {
    return id === "claude" ? this.backend ?? this.provider : [...this.backends.values()].find(value => value.provider === id);
  }
  private refreshProviders() {
    if (this.healthPending || (this.healthAt && Date.now() - this.healthAt < ([...this.providerHealth.values()].some(value => !value.available) ? 30000 : 300000))) return;
    this.healthPending = Promise.all((["claude", "codex", "cursor"] as const).map(async id => {
      const previous = this.providerHealth.get(id);
      this.providerHealth.set(id, previous ? { ...previous, checking: true } : { available: false, checking: true, message: "Checking your Mac…" });
      try { this.providerHealth.set(id, { ...(await this.launcher(id)?.capability() ?? { available: false, message: `Install ${id} on your Mac.` }), checking: false }); }
      catch { this.providerHealth.set(id, { available: false, checking: false, message: `Check ${id} setup on your Mac.` }); }
    })).then(() => { this.healthAt = Date.now(); }).finally(() => { this.healthPending = undefined; });
  }
  providers() {
    this.refreshProviders();
    return { providers: (["claude", "codex", "cursor"] as const).map(id => ({ id, ...this.providerHealth.get(id)! })) };
  }
  async models(projectId: string, id: SessionProvider) {
    const project = this.project(projectId, true);
    const launcher = this.launcher(id);
    if (!launcher) throw new LaunchError(409, "unsupported", "Install this agent on your Mac.");
    let cwd: string;
    try { cwd = fs.realpathSync(project.path); } catch { throw new LaunchError(409, "project_unavailable", "The project folder is unavailable on your Mac."); }
    return { id, ...await launcher.capability(cwd) };
  }
  async list(projectId: string) {
    const project = this.project(projectId, false);
    const providers = this.providers().providers.map(value => project.claude_launch_enabled === false ? { ...value, available: false, message: "Starting tasks is disabled for this project." } : value);
    const launches = this.store.list(projectId).filter(receipt => !receipt.backend?.startsWith("t-"));
    if (!this.observations.has(projectId)) {
      const task = (async () => {
        let native: NativeClaudeSession[] | null = null;
        if (launches.some(receipt => !receipt.backend)) { try { native = await this.provider.sessions(); } catch {} }
        await Promise.all(launches.map(receipt => receipt.backend ? this.observeBackend(receipt) : this.reconcile(receipt, native)));
      })().catch(() => {}).finally(() => { this.observations.delete(projectId); });
      this.observations.set(projectId, task);
    }
    return { capability: providers[0]!, providers, launches };
  }

  async start(projectId: string, requestId: string, prompt: string, options: ClaudeLaunchOptions = DEFAULT_LAUNCH_OPTIONS): Promise<ClaudeLaunch> {
    const project = this.project(projectId, true);
    const provider: SessionProvider = options.provider ?? "claude";
    const modes: readonly string[] = permissionModes(provider);
    if (!modes.includes(options.permissionMode) || !MODEL_ID.test(options.model)
      || (options.reasoningEffort !== undefined && !(REASONING_EFFORTS as readonly string[]).includes(options.reasoningEffort))) {
      throw new LaunchError(400, "unsupported_settings", "This agent does not support those launch settings.");
    }
    const backend = provider === "claude" ? this.backend : [...this.backends.values()].find(value => value.provider === provider);
    if (provider !== "claude" && !backend) throw new LaunchError(409, "unsupported", "Update the daemon on your Mac to enable this agent.");
    // Preserve request identity for retries from older clients using the defaults.
    const identity: unknown[] = [projectId, prompt];
    if (provider !== "claude") identity.push("provider", provider);
    if (options.model !== "default" || options.permissionMode !== "manual") identity.push(options.model, options.permissionMode);
    if (options.reasoningEffort && options.reasoningEffort !== "default") identity.push("reasoningEffort", options.reasoningEffort);
    if (options.remoteControl === false) identity.push("remoteControl", false);
    const fingerprint = createHash("sha256").update(JSON.stringify(identity)).digest("hex");
    const previous = this.store.byRequest(requestId, fingerprint);
    if (previous) return this.pending.get(requestId) ?? previous;
    if (!backend && options.remoteControl === true) {
      throw new LaunchError(409, "unsupported", "The legacy background launcher does not support Remote Control. Update RuntimeBrief on your Mac.");
    }
    // The synchronous reservation prevents two in-flight requests from dispatching twice.
    let cwd: string;
    try {
      cwd = fs.realpathSync(project.path);
      if (!fs.statSync(cwd).isDirectory()) throw new Error("not directory");
    } catch {
      throw new LaunchError(409, "project_unavailable", "The project folder is no longer available on your Mac.");
    }
    if (backend) {
      const capability = await backend.capability(cwd);
      if (capability.permissionModes && !capability.permissionModes.includes(options.permissionMode)) throw new LaunchError(400, "unsupported_settings", "This permission mode is unavailable in the native integration.");
      if (!capability.available) throw new LaunchError(409, "requires_setup", capability.message);
      if (options.model !== "default" && capability.models?.length && !capability.models.some(model => model.id === options.model || (provider === "claude" && model.id.replace(/\[1m\]$/, "") === options.model))) throw new LaunchError(400, "unsupported_settings", "This model is not available in the native harness. Refresh the model list.");
      if (options.reasoningEffort && options.reasoningEffort !== "default" && capability.models?.length) {
        const selected = options.model === "default" ? capability.defaultModelLabel : options.model;
        const model = capability.models.find(model => model.id === selected);
        if (model && !model.reasoningEfforts?.includes(options.reasoningEffort)) throw new LaunchError(400, "unsupported_settings", "This model does not support that reasoning level.");
      }
      // Capability checks yield. Another request may have reserved while we checked.
      const reserved = this.store.byRequest(requestId, fingerprint);
      if (reserved) return this.pending.get(requestId) ?? reserved;
    }
    const resolver = backend ?? this.provider;
    const resolved = await resolver.resolveSettings?.(cwd, options);
    const alreadyReserved = this.store.byRequest(requestId, fingerprint);
    if (alreadyReserved) return this.pending.get(requestId) ?? alreadyReserved;
    const id = randomUUID();
    const receipt: ClaudeLaunch = {
      provider, id, projectId, name: `RuntimeBrief ${project.name} ${id.slice(0, 8)}`,
      createdAt: new Date().toISOString(), cwd, nativeId: null, sessionId: null, openedAt: null,
      state: "starting", message: `Checking ${provider} on your Mac…`,
      model: options.model, permissionMode: options.permissionMode,
      ...(options.reasoningEffort && options.reasoningEffort !== "default" ? { reasoningEffort: options.reasoningEffort } : {}),
      ...(resolved ? { effectiveModel: resolved.model, effectiveReasoningEffort: resolved.reasoningEffort } : {}),
      ...(backend ? {
        backend: backend.id, projectRoot: cwd, projectName: project.name, promptHash: promptHash(prompt),
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
        await this.backends.get(receipt.backend)!.create(receipt, prompt);
        return await this.observeBackend(receipt);
      } catch {
        receipt.state = "unknown";
        receipt.launchState = "unknown";
        receipt.message = "The native launch result is uncertain. Refresh this receipt before starting another task.";
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
        model: receipt.effectiveModel ?? receipt.model ?? "default", permissionMode: receipt.permissionMode ?? "manual",
        ...((receipt.effectiveReasoningEffort ?? receipt.reasoningEffort) && (receipt.effectiveReasoningEffort ?? receipt.reasoningEffort) !== "default" ? { reasoningEffort: receipt.effectiveReasoningEffort ?? receipt.reasoningEffort } : {}),
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
        receipt.message = "Current native agent status is unavailable. Check its native session on your Mac.";
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

  private async controlled(projectId: string, id: string) {
    this.project(projectId, true);
    const stored = this.store.get(id, projectId);
    if (!stored) throw new LaunchError(404, "not_found", "This session could not be found.");
    const receipt = await this.observeBackend(stored);
    const backend = this.backends.get(receipt.backend!);
    if (receipt.requestedRemoteControl === false || !backend?.terminal || !backend.input) {
      throw new LaunchError(409, "remote_disabled", "Remote terminal control is unavailable for this session.");
    }
    const setup = receipt.backend === "native-claude" && receipt.state === "needs_input" && receipt.remoteControl?.state !== "ready";
    if (!setup && receipt.remoteControl?.state !== "ready") throw new LaunchError(409, "terminal_unavailable", receipt.message);
    return { receipt, backend };
  }

  async terminal(projectId: string, id: string) {
    const { receipt, backend } = await this.controlled(projectId, id);
    return backend.terminal!(receipt);
  }

  async input(projectId: string, id: string, requestId: string, data: string) {
    this.project(projectId, true);
    if (!this.store.get(id, projectId)) throw new LaunchError(404, "not_found", "This session could not be found.");
    const fingerprint = promptHash(data);
    const previous = this.store.inputStatus(id, requestId, fingerprint);
    if (previous) return { state: previous };
    const { receipt, backend } = await this.controlled(projectId, id);
    const raced = this.store.inputStatus(id, requestId, fingerprint);
    if (raced) return { state: raced };
    // Reserve before sending: a lost acknowledgment never repeats keys or an approval.
    if (this.inputPending.has(id)) throw new LaunchError(409, "terminal_busy", "Another input is being sent. Wait for its acknowledgment before sending more keys.");
    this.store.reserveInput(id, requestId, fingerprint);
    this.inputPending.add(id);
    try {
      await backend.input!(receipt, data);
      this.store.finishInput(id, requestId);
      return { state: "sent" };
    } catch {
      return { state: "unknown" };
    } finally { this.inputPending.delete(id); }
  }

  async conversation(projectId: string, id: string) {
    this.project(projectId, false);
    const receipt = this.store.get(id, projectId);
    if (!receipt) throw new LaunchError(404, "not_found", "This task could not be found.");
    const backend = this.backends.get(receipt.backend!);
    if (!backend?.conversation) throw new LaunchError(409, "unsupported", "Continue this conversation in its native app.");
    return backend.conversation(receipt);
  }
  async reply(projectId: string, id: string, body: SessionReply) {
    this.project(projectId, true);
    const receipt = this.store.get(id, projectId);
    if (!receipt) throw new LaunchError(404, "not_found", "This task could not be found.");
    const backend = this.backends.get(receipt.backend!);
    if (!backend?.reply || receipt.requestedRemoteControl === false) throw new LaunchError(409, "remote_disabled", "Continuation is disabled for this task.");
    return backend.reply(receipt, body);
  }
  close(): void { this.store.close(); }
}
