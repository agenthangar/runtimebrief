import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { LaunchService } from "../src/launches/service.js";
import { LaunchStore } from "../src/launches/store.js";
import { buildServer } from "../src/server.js";
import type { ClaudeProvider, ClaudeSessionBackend } from "../src/launches/types.js";
import { authHeaders, testConfig, tmpdir } from "./helpers.js";

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
function setup() {
  const root = tmpdir("native-launch");
  cleanup.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = testConfig({ projects: [{ id: "fixture", name: "Fixture", path: root, allowed_actions: [] }] });
  const provider: ClaudeProvider = { capability: async () => ({ available: true, message: "Ready" }), start: vi.fn(), sessions: async () => [], desktopHas: () => false, open: vi.fn() };
  const store = new LaunchStore(path.join(root, "receipts.db"));
  const backends: ClaudeSessionBackend[] = (["codex", "cursor"] as const).map(provider => ({
    id: `t-${provider}`, provider, capability: async () => ({ available: true, message: "Ready" }),
    create: vi.fn(async () => {}), get: vi.fn(async receipt => ({ ...receipt, state: "running", remoteControl: { state: receipt.requestedRemoteControl === false ? "disabled" : "ready", url: null, observedAt: new Date().toISOString() } })),
    open: vi.fn(), terminal: vi.fn(async () => ({ screen: "Fictional", cols: 80, rows: 24, writable: true, message: "Ready" })), input: vi.fn(async () => {}),
  }));
  const service = new LaunchService(config, provider, store, undefined, backends);
  const app = buildServer({ config, adapters: [], analyst: {} as never, launches: service });
  cleanup.push(() => app.close());
  return { config, app, service, backends, store, root };
}
const task = (provider: string, extra = {}) => ({ provider, requestId: randomUUID(), prompt: "Inspect the fictional workflow", ...extra });
const sessions = "/v1/projects/fixture/sessions";

describe("native provider sessions and remote terminal", () => {
  it.each(["codex", "cursor"])("defaults remote control on and dispatches %s once across retries", async provider => {
    const f = setup(); const body = task(provider);
    const first = await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: body });
    expect(first.statusCode).toBe(202);
    const receipt = first.json();
    expect(receipt).toMatchObject({ provider, backend: `t-${provider}`, requestedRemoteControl: true });
    const retry = await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: { ...body, remoteControl: true } });
    expect(retry.json().id).toBe(receipt.id);
    expect(f.backends.find(b => b.provider === provider)!.create).toHaveBeenCalledTimes(1);
    const conflict = await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: { ...body, provider: provider === "codex" ? "cursor" : "codex" } });
    expect(conflict.statusCode).toBe(409);
  });

  it.each(["codex", "cursor"])("preserves explicit model and bypass choices for %s without replaying", async provider => {
    const f = setup(); const body = task(provider, { model: "example-model", permissionMode: "bypassPermissions" });
    const first = await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: body });
    expect(first.statusCode).toBe(202);
    expect(first.json()).toMatchObject({ model: "example-model", permissionMode: "bypassPermissions", requestedRemoteControl: true });
    expect((await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: body })).json().id).toBe(first.json().id);
    for (const changed of [{ model: "other-model" }, { permissionMode: "manual" }]) expect((await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: { ...body, ...changed } })).statusCode).toBe(409);
    expect(f.backends.find(b => b.provider === provider)!.create).toHaveBeenCalledTimes(1);
  });

  it("protects input with auth, project scope, opt-out, and native permission modes", async () => {
    const f = setup();
    const receipt = (await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: task("cursor", { remoteControl: false }) })).json();
    const input = { requestId: randomUUID(), data: "\r" };
    expect((await f.app.inject({ method: "POST", url: `${sessions}/${receipt.id}/input`, payload: input })).statusCode).toBe(401);
    expect((await f.app.inject({ method: "POST", url: `${sessions}/${receipt.id}/input`, headers: authHeaders(), payload: input })).statusCode).toBe(409);
    expect((await f.app.inject({ method: "GET", url: `/v1/projects/other/sessions/${receipt.id}/terminal`, headers: authHeaders() })).statusCode).toBe(404);
    for (const provider of ["codex", "cursor"]) expect((await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: task(provider, { permissionMode: "acceptEdits" }) })).statusCode).toBe(400);
    f.config.projects[0]!.claude_launch_enabled = false;
    expect((await f.app.inject({ method: "POST", url: sessions, headers: authHeaders(), payload: task("codex") })).statusCode).toBe(403);
    expect(f.backends[1]!.input).not.toHaveBeenCalled();
  });

  it("never repeats input after concurrent retries or an uncertain acknowledgment", async () => {
    const f = setup(); const receipt = await f.service.start("fixture", randomUUID(), "Inspect the fictional workflow", { provider: "codex", model: "default", permissionMode: "manual" });
    const input = f.backends[0]!.input as ReturnType<typeof vi.fn>;
    input.mockRejectedValueOnce(Error("Ack lost"));
    const requestId = randomUUID();
    const replies = await Promise.all([f.service.input("fixture", receipt.id, requestId, "\r"), f.service.input("fixture", receipt.id, requestId, "\r")]);
    expect(replies.every(r => r.state === "unknown")).toBe(true);
    expect(input).toHaveBeenCalledTimes(1);
    const reopened = new LaunchStore(path.join(f.root, "receipts.db"));
    expect(reopened.inputStatus(receipt.id, requestId, (await import("../src/launches/tLegacy.js")).promptHash("\r"))).toBe("unknown"); reopened.close();
    expect((await f.service.input("fixture", receipt.id, requestId, "\r")).state).toBe("unknown");
    await expect(f.service.input("fixture", receipt.id, requestId, "yes\r")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns uncached terminal snapshots and advertises all provider capabilities", async () => {
    const f = setup(); const receipt = await f.service.start("fixture", randomUUID(), "Inspect the fictional workflow", { provider: "cursor", model: "default", permissionMode: "manual" });
    const reply = await f.app.inject({ url: `${sessions}/${receipt.id}/terminal`, headers: authHeaders() });
    expect(reply.headers["cache-control"]).toBe("no-store");
    expect(reply.json().writable).toBe(true);
    const list = await f.app.inject({ url: sessions, headers: authHeaders() });
    expect(list.json().providers.map((p: { id: string }) => p.id)).toEqual(["claude", "codex", "cursor"]);
  });

  it("recovers a saved input acknowledgment after the native terminal stops", async () => {
    const f = setup(); const receipt = await f.service.start("fixture", randomUUID(), "Inspect the fictional workflow", { provider: "codex", model: "default", permissionMode: "manual" });
    const requestId = randomUUID();
    expect((await f.service.input("fixture", receipt.id, requestId, "\r")).state).toBe("sent");
    (f.backends[0]!.get as ReturnType<typeof vi.fn>).mockImplementation(async value => ({ ...value, remoteControl: { state: "unavailable", url: null, observedAt: new Date().toISOString() } }));
    expect((await f.service.input("fixture", receipt.id, requestId, "\r")).state).toBe("sent");
    await expect(f.service.input("fixture", receipt.id, randomUUID(), "\r")).rejects.toMatchObject({ code: "terminal_unavailable" });
    expect(f.backends[0]!.input).toHaveBeenCalledTimes(1);
  });

  it("serializes different input requests without reserving or sending the competing request", async () => {
    const f = setup(); const receipt = await f.service.start("fixture", randomUUID(), "Inspect the fictional workflow", { provider: "codex", model: "default", permissionMode: "manual" });
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    (f.backends[0]!.input as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => { entered(); await new Promise<void>(resolve => { release = resolve; }); });
    const first = f.service.input("fixture", receipt.id, randomUUID(), "first\r");
    await started;
    await expect(f.service.input("fixture", receipt.id, randomUUID(), "second\r")).rejects.toMatchObject({ statusCode: 409, code: "terminal_busy" });
    release(); expect((await first).state).toBe("sent");
    expect(f.backends[0]!.input).toHaveBeenCalledTimes(1);
  });
});
