import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { tmpdir } from "./helpers.js";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
import { NativeCodexSession } from "../src/launches/nativeCodex.js";

const roots: string[] = [];
afterEach(() => { spawn.mockReset(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = fs.realpathSync(tmpdir("codex-owner")); roots.push(root);
  const cwd = path.join(root, "worktree"); fs.mkdirSync(cwd);
  const calls: { child: number; method: string; params: any }[] = [];
  const children: any[] = [];
  const projects = [{ id: "meal-planner", roots: [{ path: root }] }];
  let resumeError = false, mismatch = false, startMismatch = false, acknowledgment: (() => void) | undefined;
  spawn.mockImplementation(() => {
    const child: any = new EventEmitter(); const index = children.length; children.push(child);
    child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = vi.fn(() => { child.emit("exit", 0); return true; });
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        const msg = JSON.parse(chunk.toString()); calls.push({ child: index, ...msg });
        const thread = { id: "saved-thread", cwd: mismatch || (startMismatch && msg.method === "thread/start") ? root : cwd, projectId: "meal-planner" };
        const result = msg.method === "project/list" ? { data: projects, nextCursor: null }
          : msg.method === "project/create" ? { project: { id: "meal-planner", roots: [{ path: root }] } }
          : ["thread/start", "thread/read", "thread/resume"].includes(msg.method) ? { thread } : {};
        const respond = () => child.stdout.write(JSON.stringify({ id: msg.id, ...(resumeError && msg.method === "thread/resume" ? { error: { code: -32000, message: "Owned by another session" } } : { result }) }) + "\n");
        if (msg.id && msg.method === "turn/start" && acknowledgment) acknowledgment = respond;
        else if (msg.id) respond();
        done();
      },
      final(done) { child.emit("exit", 0); done(); },
    });
    return child;
  });
  const event = vi.fn(), failed = vi.fn();
  const session = new NativeCodexSession({ binary: "codex", cwd, projectRoot: root, projectName: "Meal Planner", name: "Fixture task", model: "gpt-6-luna", mode: "manual" }, event, failed);
  const complete = () => children.at(-1).stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "saved-thread", turn: { status: "completed" } } }) + "\n");
  return { root, cwd, calls, children, projects, session, event, failed, complete, conflict: () => { resumeError = true; }, wrongCwd: () => { mismatch = true; }, wrongStartCwd: () => { startMismatch = true; }, deferAcknowledgment: () => { acknowledgment = () => {}; }, acknowledge: () => acknowledgment?.() };
}

it("assigns the real project before creating a thread in its verified workspace", async () => {
  const f = fixture();
  expect(await f.session.start()).toEqual({ sessionId: "saved-thread", projectId: "meal-planner" });
  expect(f.calls.find(c => c.method === "initialize")?.params.capabilities.experimentalApi).toBe(true);
  expect(f.calls.find(c => c.method === "thread/start")?.params).toMatchObject({ projectId: "meal-planner", cwd: f.cwd, model: "gpt-6-luna", approvalPolicy: "on-request" });
  expect(f.calls.findIndex(c => c.method === "project/list")).toBeLessThan(f.calls.findIndex(c => c.method === "thread/start"));
  expect(f.calls.some(c => c.method === "turn/start")).toBe(false);
  await f.session.releaseIdle();
});

it("creates a stable named project rooted in the repository instead of the UUID worktree", async () => {
  const f = fixture(); f.projects.length = 0;
  await f.session.start();
  expect(f.calls.find(c => c.method === "project/create")?.params).toMatchObject({ name: "Meal Planner", roots: [{ path: f.root }] });
  await f.session.releaseIdle();
});

it("closes the owning process after completion so native Codex can acquire the task", async () => {
  const f = fixture(); await f.session.start(); await f.session.turn("First task", "low");
  f.complete(); await f.session.releaseIdle();
  expect(f.children[0].stdin.writableEnded).toBe(true);
  expect(f.failed).not.toHaveBeenCalled();
  expect(f.event).toHaveBeenCalledWith(expect.objectContaining({ method: "turn/completed" }));
  expect(f.calls.filter(c => c.method === "turn/start")).toHaveLength(1);
});

it("resumes the same verified thread for a follow-up without replaying the original prompt", async () => {
  const f = fixture(); await f.session.start(); await f.session.turn("First task", "low"); f.complete(); await f.session.releaseIdle();
  await f.session.turn("Follow-up", "low");
  expect(f.children).toHaveLength(2);
  expect(f.calls.filter(c => c.method === "thread/start")).toHaveLength(1);
  expect(f.calls.find(c => c.method === "thread/resume")?.params).toEqual({ threadId: "saved-thread", excludeTurns: true });
  expect(f.calls.filter(c => c.method === "turn/start").map(c => c.params.input[0].text)).toEqual(["First task", "Follow-up"]);
  f.complete(); await f.session.releaseIdle();
});

it("keeps the owner while work or an approval is pending", async () => {
  const f = fixture(); await f.session.start(); await f.session.turn("Task", "low");
  f.children[0].stdout.write(JSON.stringify({ id: 100, method: "item/commandExecution/requestApproval", params: { threadId: "saved-thread", command: "echo fixture" } }) + "\n");
  await expect(f.session.releaseIdle()).rejects.toThrow("still working");
  await expect(f.session.turn("Competing reply", "low")).rejects.toThrow("busy");
  expect(f.children[0].stdin.writableEnded).toBe(false);
  f.complete(); await f.session.releaseIdle();
});

it("does not start a turn or a new thread when native Codex already owns the saved thread", async () => {
  const f = fixture(); await f.session.start(); await f.session.turn("Task", "low"); f.complete(); await f.session.releaseIdle();
  f.conflict(); await expect(f.session.turn("Follow-up", "low")).rejects.toThrow("Native request failed");
  expect(f.children[1].stdin.writableEnded).toBe(true);
  expect(f.calls.filter(c => c.method === "turn/start")).toHaveLength(1);
  expect(f.calls.filter(c => c.method === "thread/start")).toHaveLength(1);
});

it("rejects a saved conversation whose workspace has changed before acquiring it", async () => {
  const f = fixture(); await f.session.start(); await f.session.turn("Task", "low"); f.complete(); await f.session.releaseIdle();
  f.wrongCwd(); await expect(f.session.turn("Follow-up", "low")).rejects.toThrow("identity mismatch");
  expect(f.calls.some(c => c.method === "thread/resume")).toBe(false);
});

it("rejects startup workspace mismatches before any model turn", async () => {
  const f = fixture(); f.wrongStartCwd(); await expect(f.session.start()).rejects.toThrow("identity mismatch");
  expect(f.calls.some(c => c.method === "turn/start")).toBe(false);
  await f.session.releaseIdle();
});

it("waits for the turn acknowledgment when completion arrives first", async () => {
  const f = fixture(); await f.session.start(); f.deferAcknowledgment();
  const turn = f.session.turn("Task", "low"); f.complete();
  expect(f.children[0].stdin.writableEnded).toBe(false);
  f.acknowledge(); await turn; await f.session.releaseIdle();
  expect(f.children[0].stdin.writableEnded).toBe(true);
});

it("ignores completion notifications for another thread", async () => {
  const f = fixture(); await f.session.start(); await f.session.turn("Task", "low");
  f.children[0].stdout.write(JSON.stringify({ method: "turn/completed", params: { threadId: "other-thread", turn: { status: "completed" } } }) + "\n");
  await expect(f.session.releaseIdle()).rejects.toThrow("still working");
  expect(f.children[0].stdin.writableEnded).toBe(false);
  f.complete(); await f.session.releaseIdle();
});

it("serializes competing follow-ups while the previous connection is closing", async () => {
  const f = fixture(); await f.session.start(); f.deferAcknowledgment();
  const first = f.session.turn("Task", "low"); f.complete();
  const next = f.session.turn("Follow-up", "low"), competing = f.session.turn("Competing", "low");
  const rejected = expect(competing).rejects.toThrow("busy");
  f.acknowledge(); await first;
  // The fake native server acknowledges subsequent turns normally.
  await vi.waitFor(() => expect(f.calls.filter(c => c.method === "turn/start")).toHaveLength(2));
  f.acknowledge(); await next; await rejected;
  expect(f.calls.filter(c => c.method === "thread/start")).toHaveLength(1);
  f.complete(); await f.session.releaseIdle();
});
