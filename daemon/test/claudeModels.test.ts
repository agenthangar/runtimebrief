import { afterEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));
import { discoverClaudeModels } from "../src/launches/claudeModels.js";
afterEach(() => vi.resetAllMocks());
it("discovers all native account models and reasoning levels without starting a turn", async () => {
  const calls: unknown[] = [];
  spawn.mockImplementation(() => {
    const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stdin: Writable; kill(): void };
    child.stdout = new PassThrough();
    child.stdin = new Writable({ write(chunk, _encoding, next) {
      const request = JSON.parse(chunk.toString()); calls.push(request);
      child.stdout.write(JSON.stringify({ type: "control_response", response: { request_id: request.request_id, response: { models: [{ value: "default", displayName: "Default" }, { value: "opus", displayName: "Opus", supportedEffortLevels: ["low", "medium", "high"] }, { value: "available-model", displayName: "Available model" }] } } }) + "\n"); next();
    } }); child.kill = () => child.emit("exit", 0); return child;
  });
  expect(await discoverClaudeModels("fixture", "/fixture")).toEqual([{ id: "opus", label: "Opus", reasoningEfforts: ["low", "medium", "high"] }, { id: "available-model", label: "Available model", reasoningEfforts: [] }]);
  expect(calls).toEqual([{ type: "control_request", request_id: "runtimebrief-models", request: { subtype: "initialize" } }]);
  expect(spawn.mock.calls[0]?.[1]).not.toContain("--model");
});
