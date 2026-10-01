import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { authHeaders, testConfig, tmpdir } from "./helpers.js";
import type { ClaudeLaunch, ClaudeProvider } from "../src/launches/types.js";
import { LaunchStore } from "../src/launches/store.js";
import { LaunchService } from "../src/launches/service.js";
import { buildServer } from "../src/server.js";

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
  return { root, receipt, backend, directory: path.join(root, "native-launches", receipt.id), cwd: root, legacyCwd: path.join(root, "native-worktrees", receipt.id) };
}

it("starts new Codex tasks in the selected project folder, not a UUID worktree", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
  const payload = JSON.parse(fs.readFileSync(path.join(f.directory, "payload.json"), "utf8"));
  expect(payload).toMatchObject({ provider: "codex", projectRoot: f.root, projectName: "Meal Planner", cwd: f.root, workspaceKind: "project" });
  expect(f.receipt.workspaceKind).toBe("project");
  expect(fs.existsSync(path.join(f.root, "native-worktrees"))).toBe(false);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0]?.[1][0]).toMatch(/native-session\.mjs$/);
  expect(fs.statSync(path.join(f.directory, "payload.json")).mode & 0o777).toBe(0o600);
});

it("retains a completed, writable receipt after the Codex connection releases and persists its native project", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
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

it("reports Starting while the worker has not yet created the owner socket", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.cwd, sessionId: null, state: "starting", message: "Starting", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "starting", launchState: "starting", activity: "unknown", remoteControl: { state: "starting" } });
  expect(f.receipt.message).not.toContain("stopped");
  expect(createConnection).not.toHaveBeenCalled();
});

it("reports a stopped startup after the grace period instead of waiting forever", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
  f.receipt.createdAt = new Date(Date.now() - 61000).toISOString();
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.cwd, sessionId: null, state: "starting", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "stopped", activity: "stopped", remoteControl: { state: "unavailable" } });
});

it("continues to read old Codex worktree receipts in their original directory", async () => {
  const f = fixture();
  fs.mkdirSync(f.directory, { recursive: true }); fs.mkdirSync(f.legacyCwd, { recursive: true });
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.legacyCwd, sessionId: "old-thread", state: "completed", message: "Ready", accepted: true, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ cwd: f.legacyCwd, sessionId: "old-thread" });
  expect(f.receipt.workspaceKind).toBeUndefined();
  expect(spawn).not.toHaveBeenCalled();
});

it("keeps owner validation tied to the exact selected folder", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
  fs.mkdirSync(f.legacyCwd, { recursive: true });
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.cwd, sessionId: "saved-thread", state: "completed", accepted: true, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  fs.writeFileSync(path.join(f.directory, "owner.json"), JSON.stringify({ token: randomUUID(), socket: `/tmp/rb-native-${f.receipt.id}.sock`, pid: process.pid, cwd: f.legacyCwd }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "stopped", activity: "stopped" });
  expect(createConnection).not.toHaveBeenCalled();
});

it("does not hide an explicit startup failure behind the startup grace period", async () => {
  const f = fixture(); await f.backend.create(f.receipt, "Fictional task");
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.cwd, sessionId: null, state: "failed", message: "Setup failed", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "failed", launchState: "failed", message: "Setup failed" });
});

it("returns Starting on submit and then the completed conversation through the API without a second provider launch", async () => {
  const f = fixture();
  vi.spyOn(f.backend, "capability").mockResolvedValue({ available: true, message: "Ready" });
  vi.spyOn(f.backend, "resolveSettings").mockResolvedValue({ model: "gpt-6-luna", reasoningEffort: "low" });
  const config = testConfig({ projects: [{ id: "meal-planner", name: "Meal Planner", path: f.root, allowed_actions: [] }] });
  const provider: ClaudeProvider = { capability: vi.fn(async () => ({ available: false, message: "Fixture" })), start: vi.fn(), sessions: vi.fn(async () => []), desktopHas: () => false, open: vi.fn() };
  const store = new LaunchStore(path.join(f.root, "launches.db"));
  const service = new LaunchService(config, provider, store, undefined, [f.backend]);
  const app = buildServer({ config, adapters: [], analyst: {} as never, launches: service });
  // The fake worker has saved Starting but hasn't created its socket yet.
  spawn.mockImplementation((_binary, args) => {
    const directory = args[1];
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.root, sessionId: null, state: "starting", message: "Starting", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
    const child: any = new EventEmitter(); child.unref = vi.fn(); process.nextTick(() => child.emit("spawn")); return child;
  });
  try {
    const url = "/v1/projects/meal-planner/sessions", payload = { requestId: randomUUID(), provider: "codex", prompt: "Just reply ok", model: "gpt-6-luna", reasoningEffort: "low", permissionMode: "manual" };
    const submitted = await app.inject({ method: "POST", url, headers: authHeaders(), payload });
    expect(submitted.statusCode).toBe(202);
    const launch = submitted.json();
    expect(launch).toMatchObject({ state: "starting", activity: "unknown", workspaceKind: "project", cwd: f.root });
    const directory = path.join(f.root, "native-launches", launch.id);
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ provider: "codex", cwd: f.root, sessionId: "saved-thread", nativeProjectId: "repository-project", state: "completed", message: "Ready to review", accepted: true, updatedAt: new Date().toISOString(), messages: [{ id: "reply", role: "assistant", text: "ok" }], requests: [] }));
    fs.writeFileSync(path.join(directory, "owner.json"), JSON.stringify({ token: randomUUID(), socket: `/tmp/rb-native-${launch.id}.sock`, pid: process.pid, cwd: f.root }));
    createConnection.mockImplementation(() => {
      const connection: any = new EventEmitter(); connection.setTimeout = vi.fn();
      connection.end = vi.fn(() => { connection.emit("data", JSON.stringify({ live: true })); connection.emit("end"); });
      process.nextTick(() => connection.emit("connect")); return connection;
    });
    await vi.waitFor(async () => {
      const listed = await app.inject({ method: "GET", url, headers: authHeaders() });
      expect(listed.json().launches[0]).toMatchObject({ state: "completed", sessionId: "saved-thread", workspaceKind: "project", cwd: f.root });
    });
    const conversation = await app.inject({ method: "GET", url: `${url}/${launch.id}/conversation`, headers: authHeaders() });
    expect(conversation.statusCode).toBe(200);
    expect(conversation.json()).toMatchObject({ state: "completed", writable: true, messages: [{ text: "ok" }] });
    const retried = await app.inject({ method: "POST", url, headers: authHeaders(), payload });
    expect(retried.json().id).toBe(launch.id);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(provider.start).not.toHaveBeenCalled();
  } finally { await app.close(); vi.restoreAllMocks(); }
});
