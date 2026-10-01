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
import { promptHash } from "../src/launches/identity.js";

const { spawn, createConnection, parseClaudeSessionFile } = vi.hoisted(() => ({ spawn: vi.fn(), createConnection: vi.fn(), parseClaudeSessionFile: vi.fn() }));
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), spawn }));
vi.mock("node:net", () => ({ default: { createConnection } }));
vi.mock("../src/adapters/claudeCodeSessions.js", async importOriginal => ({ ...await importOriginal<typeof import("../src/adapters/claudeCodeSessions.js")>(), parseClaudeSessionFile }));
import { NativeSessionBackend } from "../src/launches/native.js";

const roots: string[] = [];
afterEach(() => { vi.clearAllMocks(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture(provider: "claude" | "codex" | "cursor" = "codex") {
  const root = fs.realpathSync(tmpdir("native-owner")); roots.push(root);
  const receipt: ClaudeLaunch = { id: randomUUID(), projectId: "meal-planner", projectName: "Meal Planner", projectRoot: root, name: "Fixture task", createdAt: new Date().toISOString(), cwd: root, state: "starting", message: "Starting", nativeId: null, sessionId: null, openedAt: null, requestedRemoteControl: true };
  const backend = new NativeSessionBackend(provider, root);
  parseClaudeSessionFile.mockResolvedValue({ sessionId: null, cwd: null, state: "unknown", userPrompts: [] });
  spawn.mockImplementation(() => { const child: any = new EventEmitter(); child.unref = vi.fn(); process.nextTick(() => child.emit("spawn")); return child; });
  return { root, receipt, backend, directory: path.join(root, "native-launches", receipt.id), cwd: root, legacyCwd: path.join(root, "native-worktrees", receipt.id) };
}
function saved(f: ReturnType<typeof fixture>, state: string, accepted = true) {
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider: f.backend.provider, cwd: f.cwd, sessionId: "saved-thread", state, accepted, message: "Ready to review", updatedAt: new Date().toISOString(), messages: [], requests: [] }));
}
function live(f: ReturnType<typeof fixture>) {
  fs.writeFileSync(path.join(f.directory, "owner.json"), JSON.stringify({ token: randomUUID(), socket: `/tmp/rb-native-${f.receipt.id}.sock`, pid: process.pid, cwd: f.cwd }));
  createConnection.mockImplementation(() => {
    const connection: any = new EventEmitter(); connection.setTimeout = vi.fn();
    connection.end = vi.fn(() => { connection.emit("data", JSON.stringify({ live: true })); connection.emit("end"); });
    process.nextTick(() => connection.emit("connect")); return connection;
  });
}

it.each(["claude", "codex", "cursor"] as const)("starts new %s tasks in the selected project folder, not a UUID worktree", async provider => {
  const f = fixture(provider); const originalMode = fs.statSync(f.root).mode; await f.backend.create(f.receipt, "Fictional task");
  const payload = JSON.parse(fs.readFileSync(path.join(f.directory, "payload.json"), "utf8"));
  expect(payload).toMatchObject({ provider, projectRoot: f.root, projectName: "Meal Planner", cwd: f.root, workspaceKind: "project" });
  expect(f.receipt.workspaceKind).toBe("project");
  expect(fs.existsSync(path.join(f.root, "native-worktrees"))).toBe(false);
  expect(spawn).toHaveBeenCalledTimes(1);
  expect(spawn.mock.calls[0]?.[1][0]).toMatch(/native-session\.mjs$/);
  expect(fs.statSync(path.join(f.directory, "payload.json")).mode & 0o777).toBe(0o600);
  expect(fs.statSync(f.root).mode).toBe(originalMode);
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

it.each(["claude", "codex", "cursor"] as const)("reports Starting for %s while the worker has not yet created the owner socket", async provider => {
  const f = fixture(provider); await f.backend.create(f.receipt, "Fictional task");
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider, cwd: f.cwd, sessionId: null, state: "starting", message: "Starting", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "starting", launchState: "starting", activity: "unknown", remoteControl: { state: "starting" } });
  expect(f.receipt.message).not.toContain("stopped");
  expect(createConnection).not.toHaveBeenCalled();
});

it.each(["claude", "codex", "cursor"] as const)("reports a stopped %s startup after the grace period instead of waiting forever", async provider => {
  const f = fixture(provider); await f.backend.create(f.receipt, "Fictional task");
  f.receipt.createdAt = new Date(Date.now() - 61000).toISOString();
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider, cwd: f.cwd, sessionId: null, state: "starting", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "stopped", activity: "stopped", remoteControl: { state: "unavailable" } });
});

it.each(["claude", "codex", "cursor"] as const)("continues to read old %s worktree receipts in their original directory", async provider => {
  const f = fixture(provider);
  fs.mkdirSync(f.directory, { recursive: true }); fs.mkdirSync(f.legacyCwd, { recursive: true });
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider, cwd: f.legacyCwd, sessionId: "old-thread", state: "completed", message: "Ready", accepted: true, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ cwd: f.legacyCwd, sessionId: "old-thread" });
  expect(f.receipt.workspaceKind).toBeUndefined();
  expect(spawn).not.toHaveBeenCalled();
});

it.each(["claude", "codex", "cursor"] as const)("keeps %s owner validation tied to the exact selected folder", async provider => {
  const f = fixture(provider); await f.backend.create(f.receipt, "Fictional task");
  fs.mkdirSync(f.legacyCwd, { recursive: true });
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider, cwd: f.cwd, sessionId: "saved-thread", state: "running", accepted: true, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  fs.writeFileSync(path.join(f.directory, "owner.json"), JSON.stringify({ token: randomUUID(), socket: `/tmp/rb-native-${f.receipt.id}.sock`, pid: process.pid, cwd: f.legacyCwd }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "stopped", activity: "stopped" });
  expect(createConnection).not.toHaveBeenCalled();
});

it.each(["claude", "codex", "cursor"] as const)("does not hide an explicit %s startup failure behind the startup grace period", async provider => {
  const f = fixture(provider); await f.backend.create(f.receipt, "Fictional task");
  fs.writeFileSync(path.join(f.directory, "state.json"), JSON.stringify({ provider, cwd: f.cwd, sessionId: null, state: "failed", message: "Setup failed", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "failed", launchState: "failed", message: "Setup failed" });
});

it.each(["claude", "codex", "cursor"] as const)("keeps a confirmed completed %s turn ready to review when its connection is offline", async provider => {
  const f = fixture(provider); await f.backend.create(f.receipt, "Fictional task"); saved(f, "completed");
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "completed", activity: "idle", remoteControl: { state: "unavailable" } });
  expect(await f.backend.conversation(f.receipt)).toMatchObject({ state: "completed", writable: false, requests: [] });
  expect(spawn).toHaveBeenCalledTimes(1);
});

it.each([["running", "working"], ["needs_input", "needs_input"], ["completed", "idle"]])("observes Cursor %s through its exact live owner", async (state, activity) => {
  const f = fixture("cursor"); await f.backend.create(f.receipt, "Fictional task"); saved(f, state); live(f);
  expect(await f.backend.get(f.receipt)).toMatchObject({ state, activity, launchState: "started", remoteControl: { state: "ready" } });
  expect(spawn).toHaveBeenCalledTimes(1);
});

it.each([["active", "running"], ["waiting", "needs_input"], ["completed", "completed"], ["interrupted", "failed"]])("confirms Claude %s from the matching native project transcript", async (nativeState, state) => {
  const f = fixture("claude"); f.receipt.promptHash = promptHash("Fictional task");
  await f.backend.create(f.receipt, "Fictional task"); saved(f, "starting", false); live(f);
  parseClaudeSessionFile.mockResolvedValue({ sessionId: "saved-thread", cwd: f.cwd, state: nativeState, userPrompts: ["Fictional task"], remoteControlStatus: { content: "/remote-control is active", url: "https://claude.ai/code/session_fixture" } });
  expect(await f.backend.get(f.receipt)).toMatchObject({ state, launchState: "started", nativeId: "saved-thread", remoteControl: { state: "ready" } });
  expect(spawn).toHaveBeenCalledTimes(1);
});

it("keeps Claude's completed native turn ready to review after a clean process exit", async () => {
  const f = fixture("claude"); f.receipt.promptHash = promptHash("Fictional task");
  await f.backend.create(f.receipt, "Fictional task"); saved(f, "stopped", false);
  parseClaudeSessionFile.mockResolvedValue({ sessionId: "saved-thread", cwd: f.cwd, state: "completed", userPrompts: ["Fictional task"] });
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "completed", launchState: "started", activity: "idle", remoteControl: { state: "unavailable" } });
  saved(f, "failed", false);
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "failed" });
});

it("does not accept a Claude transcript or remote link from another workspace", async () => {
  const f = fixture("claude"); f.receipt.promptHash = promptHash("Fictional task");
  await f.backend.create(f.receipt, "Fictional task"); saved(f, "starting", false); live(f);
  fs.mkdirSync(f.legacyCwd, { recursive: true });
  parseClaudeSessionFile.mockResolvedValue({ sessionId: "saved-thread", cwd: f.legacyCwd, state: "completed", userPrompts: ["Fictional task"], remoteControlStatus: { content: "/remote-control is active", url: "https://claude.ai/code/session_fixture" } });
  expect(await f.backend.get(f.receipt)).toMatchObject({ state: "starting", launchState: "starting", nativeId: null, remoteControl: { state: "starting", url: null } });
});

it.each(["claude", "codex", "cursor"] as const)("returns Starting on %s submit and then the completed conversation through the API without a second provider launch", async agent => {
  const f = fixture(agent);
  vi.spyOn(f.backend, "capability").mockResolvedValue({ available: true, message: "Ready" });
  vi.spyOn(f.backend, "resolveSettings").mockResolvedValue({ model: "gpt-6-luna", reasoningEffort: "low" });
  const config = testConfig({ projects: [{ id: "meal-planner", name: "Meal Planner", path: f.root, allowed_actions: [] }] });
  const provider: ClaudeProvider = { capability: vi.fn(async () => ({ available: false, message: "Fixture" })), start: vi.fn(), sessions: vi.fn(async () => []), desktopHas: () => false, open: vi.fn() };
  const store = new LaunchStore(path.join(f.root, "launches.db"));
  const service = new LaunchService(config, provider, store, agent === "claude" ? f.backend : undefined, [f.backend]);
  const app = buildServer({ config, adapters: [], analyst: {} as never, launches: service });
  // The fake worker has saved Starting but hasn't created its socket yet.
  spawn.mockImplementation((_binary, args) => {
    const directory = args[1];
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ provider: agent, cwd: f.root, sessionId: null, state: "starting", message: "Starting", accepted: false, updatedAt: new Date().toISOString(), messages: [], requests: [] }));
    const child: any = new EventEmitter(); child.unref = vi.fn(); process.nextTick(() => child.emit("spawn")); return child;
  });
  try {
    const url = "/v1/projects/meal-planner/sessions", payload = { requestId: randomUUID(), provider: agent, prompt: "Just reply ok", model: "default", reasoningEffort: "low", permissionMode: "manual" };
    const submitted = await app.inject({ method: "POST", url, headers: authHeaders(), payload });
    expect(submitted.statusCode).toBe(202);
    const launch = submitted.json();
    expect(launch).toMatchObject({ state: "starting", activity: "unknown", workspaceKind: "project", cwd: f.root });
    const directory = path.join(f.root, "native-launches", launch.id);
    fs.writeFileSync(path.join(directory, "state.json"), JSON.stringify({ provider: agent, cwd: f.root, sessionId: "saved-thread", nativeProjectId: "repository-project", state: "completed", message: "Ready to review", accepted: true, updatedAt: new Date().toISOString(), messages: [{ id: "reply", role: "assistant", text: "ok" }], requests: [] }));
    if (agent === "claude") parseClaudeSessionFile.mockResolvedValue({ sessionId: "saved-thread", cwd: f.root, state: "completed", userPrompts: [payload.prompt] });
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
    expect(conversation.json()).toMatchObject({ state: "completed", writable: agent !== "claude", messages: [{ text: "ok" }] });
    const retried = await app.inject({ method: "POST", url, headers: authHeaders(), payload });
    expect(retried.json().id).toBe(launch.id);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(provider.start).not.toHaveBeenCalled();
  } finally { await app.close(); vi.restoreAllMocks(); }
});
