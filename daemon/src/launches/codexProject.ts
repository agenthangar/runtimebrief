import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import readline from "node:readline";
import type { ClaudeLaunch } from "./types.js";

interface NativeProject { id: string; roots: { path: string }[] }
interface ProjectList { data: NativeProject[]; nextCursor: string | null }
const canonical = (value: string) => { try { return fs.realpathSync(value); } catch { return path.resolve(value); } };

/** Use native metadata APIs; never edit Codex's database or change a thread's cwd. */
export async function bindCodexProject(binary: string, launch: ClaudeLaunch): Promise<string> {
  const root = canonical(launch.projectRoot ?? launch.cwd);
  const child = spawn(binary, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = readline.createInterface({ input: child.stdout });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = () => { for (const value of pending.values()) value.reject(Error("Native project metadata unavailable")); pending.clear(); };
  child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
  lines.on("line", line => {
    try {
      const response = JSON.parse(line);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(Error("Native project metadata unavailable"));
      else request.resolve(response.result);
    } catch { /* Ignore unrelated notifications and malformed native output. */ }
  });
  const request = <T>(method: string, params: unknown): Promise<T> => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve: value => resolve(value as T), reject });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const timeout = setTimeout(() => { fail(); child.kill(); }, 8000);
  try {
    await request("initialize", { clientInfo: { name: "runtimebrief", version: "1.0.0" }, capabilities: { experimentalApi: true } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "initialized", params: {} }) + "\n");
    let project: NativeProject | undefined, cursor: string | null = null;
    do {
      const page: ProjectList = await request("project/list", { limit: 100, cursor });
      const matches = page.data.filter(value => value.roots.some(value => canonical(value.path) === root));
      if (matches.length > 1 || (project && matches.some(value => value.id !== project!.id))) throw Error("Ambiguous native project");
      project ??= matches[0];
      cursor = page.nextCursor;
    } while (cursor);
    if (!project) {
      const hash = createHash("sha256").update(`runtimebrief-project:${root}`).digest("hex");
      const idempotencyKey = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      const result = await request<{ project: NativeProject }>("project/create", { idempotencyKey, name: launch.projectName ?? path.basename(root), roots: [{ path: root }] });
      project = result.project;
    }
    const result = await request<{ thread: { projectId?: string | null; cwd: string } }>("thread/metadata/update", { threadId: launch.sessionId, projectId: project.id });
    if (result.thread.projectId !== project.id || canonical(result.thread.cwd) !== canonical(launch.cwd)) throw Error("Native assignment was not confirmed");
    return project.id;
  } finally {
    clearTimeout(timeout); lines.close(); child.stdin.destroy(); child.kill();
  }
}
