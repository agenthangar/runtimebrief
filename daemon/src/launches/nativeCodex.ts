import fs from "node:fs";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import readline from "node:readline";
import { findCodexProject } from "./codexProject.js";

interface Options { binary: string; cwd: string; projectRoot: string; projectName?: string; name: string; model: string; mode: string }
interface Thread { id: string; cwd: string; projectId?: string | null }
interface Connection {
  child: ChildProcessWithoutNullStreams; lines: readline.Interface; expectedClose: boolean;
  pending: Map<number, { resolve(value: any): void; reject(error: Error): void; timer: NodeJS.Timeout }>;
  exited: Promise<void>;
}

/** Only owns Codex during a turn. Closing the process releases the native lease. */
export class NativeCodexSession {
  sessionId: string | undefined;
  projectId: string | undefined;
  private connection: Connection | undefined;
  private closing: Promise<void> | undefined;
  private startingTurn: Promise<unknown> | undefined;
  private active = false;
  private sequence = 0;
  constructor(private readonly options: Options, private readonly onEvent: (message: any) => void, private readonly onFailure: () => void) {}

  private request = <T>(method: string, params: unknown): Promise<T> => new Promise((resolve, reject) => {
    const connection = this.connection;
    if (!connection || connection.expectedClose) { reject(Error("Codex is disconnected")); return; }
    const id = ++this.sequence;
    const timer = setTimeout(() => { connection.pending.delete(id); reject(Error("Native request timed out")); }, 30000);
    connection.pending.set(id, { resolve, reject, timer });
    this.send({ jsonrpc: "2.0", id, method, params });
  });
  send(message: unknown) {
    if (!this.connection || this.connection.expectedClose) throw Error("Codex is disconnected");
    this.connection.child.stdin.write(JSON.stringify(message) + "\n");
  }
  private async connect() {
    if (this.closing) await this.closing;
    if (this.connection) return;
    const child = spawn(this.options.binary, ["app-server", "--stdio"], { cwd: this.options.cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, NO_COLOR: "1" } });
    const lines = readline.createInterface({ input: child.stdout });
    const connection: Connection = { child, lines, expectedClose: false, pending: new Map(), exited: Promise.resolve() };
    this.connection = connection;
    connection.exited = new Promise(resolve => {
      let handled = false;
      const ended = () => {
        if (handled) return; handled = true;
        for (const waiter of connection.pending.values()) { clearTimeout(waiter.timer); waiter.reject(Error("Native process ended")); }
        connection.pending.clear(); lines.close();
        if (this.connection === connection) this.connection = undefined;
        resolve();
        if (!connection.expectedClose) this.onFailure();
      };
      child.once("exit", ended); child.once("error", ended);
    });
    child.stdin.on("error", () => { if (!connection.expectedClose) child.kill(); });
    child.stderr.on("data", () => {}); // Never expose provider diagnostics or credentials.
    lines.on("line", line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (!message.method && message.id !== undefined) {
        const waiter = connection.pending.get(message.id); if (!waiter) return;
        clearTimeout(waiter.timer); connection.pending.delete(message.id);
        if (message.error) waiter.reject(Error("Native request failed")); else waiter.resolve(message.result);
        return;
      }
      if (message.params?.threadId && this.sessionId && message.params.threadId !== this.sessionId) return;
      if (message.method === "turn/started") this.active = true;
      if (message.method === "turn/completed") this.active = false;
      this.onEvent(message);
      if (message.method === "turn/completed") void this.releaseIdle().catch(() => this.onFailure());
    });
    await this.request("initialize", { clientInfo: { name: "runtimebrief", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    this.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  }
  private verify(thread: Thread) {
    if (!thread.id || (this.sessionId && thread.id !== this.sessionId) || fs.realpathSync(thread.cwd) !== fs.realpathSync(this.options.cwd) || thread.projectId !== this.projectId) throw Error("Native identity mismatch");
  }
  async start() {
    await this.connect();
    this.projectId = await findCodexProject(this.request, this.options.projectRoot, this.options.projectName);
    const policies: Record<string, string> = { manual: "on-request", auto: "on-request", plan: "on-request", bypassPermissions: "never", dontAsk: "never" };
    const { thread } = await this.request<{ thread: Thread }>("thread/start", {
      cwd: this.options.cwd, projectId: this.projectId, ephemeral: false,
      approvalPolicy: policies[this.options.mode] ?? "on-request",
      ...(this.options.mode === "auto" ? { approvalsReviewer: "auto_review" } : {}),
      sandbox: this.options.mode === "bypassPermissions" ? "danger-full-access" : this.options.mode === "plan" ? "read-only" : "workspace-write",
      ...(this.options.model !== "default" ? { model: this.options.model } : {}),
    });
    this.verify(thread); this.sessionId = thread.id;
    await this.request("thread/name/set", { threadId: this.sessionId, name: this.options.name });
    return { sessionId: this.sessionId, projectId: this.projectId };
  }
  async turn(text: string, effort: string) {
    if (this.active) throw Error("Codex is busy");
    if (this.closing) await this.closing;
    if (this.active) throw Error("Codex is busy");
    if (!this.sessionId) throw Error("Codex has no saved conversation");
    this.active = true; // Reserve before reconnecting; concurrent calls cannot acquire twice.
    try {
      if (!this.connection) {
        await this.connect();
        // Read and verify without acquiring a lease or changing the saved workspace.
        const stored = await this.request<{ thread: Thread }>("thread/read", { threadId: this.sessionId, includeTurns: false });
        this.verify(stored.thread);
        const resumed = await this.request<{ thread: Thread }>("thread/resume", { threadId: this.sessionId, excludeTurns: true });
        this.verify(resumed.thread);
      }
      this.startingTurn = this.request("turn/start", { threadId: this.sessionId, input: [{ type: "text", text, text_elements: [] }], ...(effort !== "default" ? { effort } : {}) });
      await this.startingTurn;
    } catch (error) {
      this.active = false;
      await this.releaseIdle();
      throw error;
    } finally { this.startingTurn = undefined; }
  }
  releaseIdle(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.active) return Promise.reject(Error("Codex is still working or waiting for approval"));
    const connection = this.connection;
    if (!connection) return Promise.resolve();
    this.closing = (async () => {
      // Completion can arrive before the turn/start acknowledgment.
      await this.startingTurn?.catch(() => {});
      connection.expectedClose = true;
      connection.child.stdin.end();
      const terminate = setTimeout(() => connection.child.kill(), 1500);
      const kill = setTimeout(() => connection.child.kill("SIGKILL"), 3000);
      try { await connection.exited; } finally { clearTimeout(terminate); clearTimeout(kill); }
    })().finally(() => { this.closing = undefined; });
    return this.closing;
  }
  stop() { if (this.connection) { this.connection.expectedClose = true; this.connection.child.kill(); } }
}
