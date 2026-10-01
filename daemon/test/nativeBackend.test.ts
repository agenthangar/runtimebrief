import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { tmpdir } from "./helpers.js";
import type { ClaudeLaunch } from "../src/launches/types.js";

const { spawn, createConnection } = vi.hoisted(() => ({ spawn: vi.fn(), createConnection: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn }));
vi.mock("node:net", () => ({ default: { createConnection } }));
import { NativeSessionBackend } from "../src/launches/native.js";

const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(tmpdir("native-owner")); roots.push(root);
  const receipt: ClaudeLaunch = { id: randomUUID(), projectId: "meal-planner", projectName: "Meal Planner", projectRoot: root, name: "Fixture task", createdAt: new Date().toISOString(), cwd: root, state: "starting", message: "Starting", nativeId: null, sessionId: null, openedAt: null, requestedRemoteControl: true };
  const backend = new NativeSessionBackend("codex", root);
  spawn.mockImplementation(() => { const child: any = new EventEmitter(); child.unref = vi.fn(); process.nextTick(() => child.emit("spawn")); return child; });
  return { root, receipt, backend, directory: path.join(root, "native-launches", receipt.id), cwd: path.join(root, "native-worktrees", receipt.id) };
}

it("passes the actual project name and root to the native owner independently of the worktree UUID", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
  const payload = JSON.parse(fs.readFileSync(path.join(f.directory, "payload.json"), "utf8"));
  expect(payload).toMatchObject({ provider: "codex", projectRoot: f.root, projectName: "Meal Planner", cwd: f.cwd });
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0]?.[1][0]).toMatch(/native-session\.mjs$/);
  expect(fs.statSync(path.join(f.directory, "payload.json")).mode & 0o777).toBe(0o600);
});

it("retains a completed, writable receipt after the Codex connection releases and persists its native project", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task"); fs.mkdirSync(f.cwd);
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.cwd, sessionId: "saved-thread", nativeProjectId: "repository-project", state: "completed", message: "Ready", accepted: true, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  fs.writeFileSync(path.join(f.directory, "owner.json"), JSON.stringify({ token: randomUUID(), socket: `/tmp/rb-native-${f.receipt.id}.sock`, pid: process.pid, cwd: f.cwd }));
  createConnection.mockImplementation(() => {
    const connection: any = new EventEmitter(); connection.setTimeout = vi.fn();
    connection.end = vi.fn(() => { connection.emit("data", JSON.stringify({ live: true })); connection.emit("end"); });
    process.nextTick(() => connection.emit("connect")); return connection;
  });
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "completed", nativeProjectId: "repository-project", sessionId: "saved-thread", activity: "idle", remoteControl: { state: "ready" } });
  expect(await f.backend.conversation(f.receipt)).toMatchObject({ state: "completed", writable: true });
  expect(spawn).toHaveBeenCalledTimes(1); // Reads never start another provider.
});
