import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import net from "node:net";
import Database from "better-sqlite3";
import { TNativeBackend } from "../src/launches/tNative.js";
import { tSlot, promptHash } from "../src/launches/tLegacy.js";
import type { ClaudeLaunch } from "../src/launches/types.js";
import { tmpdir } from "./helpers.js";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture(provider: "codex" | "cursor") {
  const root = fs.realpathSync(tmpdir("native-owner")); cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = randomUUID(), nativeId = randomUUID(), token = randomUUID(), prompt = "Inspect the fictional export";
  const cwd = path.join(root, "t-worktrees", "fixture", tSlot(id)), directory = path.join(root, "t-launches", id), historyRoot = path.join(root, "history");
  for (const d of [cwd, directory, historyRoot]) fs.mkdirSync(d, { recursive: true });
  const socket = `/tmp/rb-terminal-${id}.sock`;
  fs.writeFileSync(path.join(directory, "runner.json"), JSON.stringify({ cwd, pane: "%100", token, socket }));
  const received: string[] = [];
  let live = true;
  const server = net.createServer(connection => {
    let buffer = "";
    connection.on("data", data => {
      buffer += data;
      if (!buffer.endsWith("\n")) return;
      const request = JSON.parse(buffer);
      if (request.token !== token) return connection.destroy();
      if (request.data) received.push(request.data);
      connection.end(JSON.stringify({ live, accepted: request.data !== undefined }) + "\n");
    });
  });
  await new Promise<void>(resolve => server.listen(socket, resolve));
  cleanup.push(() => new Promise<void>(resolve => server.close(() => { try { fs.unlinkSync(socket); } catch {} resolve(); })));
  const receipt: ClaudeLaunch = { id, provider, projectId: "fixture", name: "Fixture", createdAt: new Date().toISOString(), state: "starting", message: "Starting", nativeId: null, sessionId: null, openedAt: null, cwd, projectRoot: path.join(root, "fixture"), backend: `t-${provider}`, promptHash: promptHash(prompt), requestedRemoteControl: true };
  const backend = new TNativeBackend(provider, { root, historyRoot, projectBinder: async () => "fixture-project" });
  const tmux = vi.spyOn(backend as unknown as { tmuxCommand(args: string[]): Promise<string> }, "tmuxCommand").mockImplementation(async args => args.at(-1) === "#{pane_id}" ? "%100" : args[0] === "capture-pane" ? "Native output\n" : "80 24 1 2");
  let addConversation: () => void;
  if (provider === "codex") {
    const file = path.join(historyRoot, "rollout.jsonl");
    fs.writeFileSync(file, [{ type: "session_meta", payload: { id: nativeId, cwd } }, { type: "event_msg", payload: { type: "user_message", message: prompt } }, { type: "event_msg", payload: { type: "task_complete" } }].map(x => JSON.stringify(x)).join("\n"));
    const db = new Database(path.join(historyRoot, "state_5.sqlite"));
    db.exec("CREATE TABLE threads (id TEXT, rollout_path TEXT, cwd TEXT, source TEXT)");
    db.prepare("INSERT INTO threads VALUES (?, ?, ?, 'vscode')").run(nativeId, file, cwd); db.close();
    addConversation = () => { const db = new Database(path.join(historyRoot, "state_5.sqlite")); db.prepare("INSERT INTO threads VALUES (?, ?, ?, 'cli')").run(randomUUID(), file, cwd); db.close(); };
  } else {
    fs.writeFileSync(path.join(directory, "native.json"), JSON.stringify({ sessionId: nativeId, cwd }));
    const encoded = cwd.replace(/[^A-Za-z0-9]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    const transcripts = path.join(historyRoot, "projects", encoded, "agent-transcripts");
    fs.mkdirSync(path.join(transcripts, nativeId), { recursive: true });
    fs.writeFileSync(path.join(transcripts, nativeId, `${nativeId}.jsonl`), JSON.stringify({ role: "user", message: { content: [{ type: "text", text: prompt }] } }) + "\n");
    addConversation = () => { fs.mkdirSync(path.join(transcripts, randomUUID())); };
  }
  return { root, directory, backend, receipt, received, nativeId, addConversation, tmux, stop: () => { live = false; } };
}

it.each(["codex", "cursor"] as const)("binds %s terminal control to the exact native owner and worktree", async provider => {
  const f = await fixture(provider);
  const observed = await f.backend.get(f.receipt);
  expect(observed).toMatchObject({ sessionId: f.nativeId, launchState: "started", remoteControl: { state: "ready", url: null } });
  expect((await f.backend.terminal(observed)).screen).toContain("Native output");
  await f.backend.input(observed, "yes\r"); expect(f.received).toEqual(["yes\r"]);
  f.addConversation();
  expect((await f.backend.get(observed)).remoteControl?.state).toBe("unavailable");
  await expect(f.backend.input(observed, "yes\r")).rejects.toMatchObject({ statusCode: 409 });
  expect(f.received).toHaveLength(1);
});

it.each(["codex", "cursor"] as const)("rejects stopped or replaced %s panes and preserves local-only receipts", async provider => {
  const f = await fixture(provider);
  f.receipt.requestedRemoteControl = false;
  await expect(f.backend.input(f.receipt, "\r")).rejects.toMatchObject({ statusCode: 409 });
  f.receipt.requestedRemoteControl = true;
  f.tmux.mockResolvedValue("%999");
  expect((await f.backend.get(f.receipt)).remoteControl?.state).toBe("unavailable");
  f.tmux.mockResolvedValue("%100"); f.stop();
  await expect(f.backend.terminal(f.receipt)).rejects.toMatchObject({ statusCode: 409 });
  expect(f.received).toHaveLength(0);
});
