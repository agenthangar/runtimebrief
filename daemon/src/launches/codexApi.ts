import { spawn } from "node:child_process";
import readline from "node:readline";

export async function withCodexApi<T>(binary: string, action: (request: <R>(method: string, params: unknown) => Promise<R>) => Promise<T>): Promise<T> {
  const child = spawn(binary, ["app-server", "--stdio"], { stdio: ["pipe", "pipe", "ignore"] });
  const lines = readline.createInterface({ input: child.stdout });
  let sequence = 0;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const fail = () => { for (const value of pending.values()) value.reject(Error("Native Codex API unavailable")); pending.clear(); };
  child.on("error", fail); child.on("exit", fail); child.stdin.on("error", fail);
  lines.on("line", line => {
    try {
      const response = JSON.parse(line);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      if (response.error) request.reject(Error("Native Codex API unavailable"));
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
    return await action(request);
  } finally {
    clearTimeout(timeout); lines.close(); child.stdin.destroy(); child.kill();
  }
}
