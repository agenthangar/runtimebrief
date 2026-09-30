import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { randomUUID } from "node:crypto";
import { tmpdir } from "./helpers.js";
import type { ClaudeLaunch } from "../src/launches/types.js";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
import { bindCodexProject } from "../src/launches/codexProject.js";

const roots: string[] = [];
afterEach(() => { spawn.mockReset(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function setup(projects: { id: string; roots: { path: string }[] }[] = []) {
  const root = fs.realpathSync(tmpdir("native-project")); roots.push(root);
  const receipt: ClaudeLaunch = { id: randomUUID(), projectId: "fixture", projectName: "Real Project", projectRoot: root, name: "Fixture", cwd: root + "/workspace", createdAt: new Date().toISOString(), state: "running", message: "Running", nativeId: randomUUID(), sessionId: randomUUID(), openedAt: null };
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: Writable; kill(): void };
    child.stdout = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, next) {
      const request = JSON.parse(chunk.toString());
      calls.push(request);
      if (request.id) {
        const result = request.method === "project/list" ? { data: projects, nextCursor: null }
          : request.method === "project/create" ? { project: { id: "created-project", roots: [{ path: root }] } }
          : request.method === "thread/metadata/update" ? { thread: { projectId: request.params.projectId, cwd: receipt.cwd } } : {};
        child.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
      }
      next();
    } });
    child.kill = () => { child.emit("exit", 0); };
    return child;
  });
  return { root, receipt, calls, projects };
}

it("assigns the existing real project while preserving the isolated cwd", async () => {
  const f = setup(); f.projects.push({ id: "real-project", roots: [{ path: f.root }] });
  expect(await bindCodexProject("codex", f.receipt)).toBe("real-project");
  expect(f.calls.find(c => c.method === "thread/metadata/update")?.params).toEqual({ threadId: f.receipt.sessionId, projectId: "real-project" });
  expect(f.calls.some(c => c.method === "project/create" || c.method === "thread/start" || c.method === "turn/start")).toBe(false);
});

it("creates one stable repository project identity when none exists", async () => {
  const f = setup();
  await bindCodexProject("codex", f.receipt); await bindCodexProject("codex", f.receipt);
  const creates = f.calls.filter(c => c.method === "project/create");
  expect(creates[0]?.params).toMatchObject({ name: "Real Project", roots: [{ path: f.root }] });
  expect(creates[0]?.params.idempotencyKey).toBe(creates[1]?.params.idempotencyKey);
});

it("does not choose between ambiguous native projects or edit their records", async () => {
  const f = setup(); f.projects.push({ id: "one", roots: [{ path: f.root }] }, { id: "two", roots: [{ path: f.root }] });
  await expect(bindCodexProject("codex", f.receipt)).rejects.toThrow("Ambiguous");
  expect(f.calls.some(c => c.method === "thread/metadata/update" || c.method === "project/update")).toBe(false);
});
