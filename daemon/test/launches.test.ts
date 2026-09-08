import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { CLAUDE_PERMISSION_MODES } from "../src/launches/types.js";
import { buildServer } from "../src/server.js";
import { LaunchStore } from "../src/launches/store.js";
import { LaunchService } from "../src/launches/service.js";
import { NativeClaudeProvider } from "../src/launches/claude.js";
import { desktopHasSession } from "../src/launches/desktop.js";
import type { ClaudeProvider, NativeClaudeSession } from "../src/launches/types.js";
import { authHeaders, testConfig, tmpdir } from "./helpers.js";

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

function setup(enabled = true) {
  const dir = tmpdir("claude-launch");
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = testConfig({ projects: [{ id: "fixture", name: "Fixture", path: dir, allowed_actions: [], ...(enabled ? {} : { claude_launch_enabled: false }) }] });
  let native: NativeClaudeSession[] = [];
  const provider: ClaudeProvider = {
    capability: vi.fn(async () => ({ available: true, message: "Ready" })),
    start: vi.fn(async (cwd, name) => {
      native = [{ id: "1234abcd", sessionId: randomUUID(), cwd, name, kind: "background", state: "working" }];
      return "1234abcd";
    }),
    sessions: vi.fn(async () => native),
    desktopHas: vi.fn(() => false),
    open: vi.fn(async () => {}),
  };
  const store = new LaunchStore(path.join(dir, "launches.db"));
  cleanups.push(() => store.close());
  const service = new LaunchService(config, provider, store);
  return { dir, config, provider, store, service, setNative: (sessions: NativeClaudeSession[]) => { native = sessions; } };
}

describe("native Claude launch lifecycle", () => {
  it("allows registered and newly discovered projects by default, but keeps explicit opt-out", async () => {
    const { service, config, dir, provider } = setup();
    config.project_roots = [dir];
    fs.mkdirSync(path.join(dir, "new-project", ".git"), { recursive: true });
    expect((await service.list("new-project")).capability.available).toBe(true);
    expect((await service.start("new-project", randomUUID(), "Inspect the new fictional project")).nativeId).toBe("1234abcd");
    expect(provider.start).toHaveBeenCalledTimes(1);
    config.projects.push({ id: "new-project", name: "New project", path: path.join(dir, "new-project"), allowed_actions: [], claude_launch_enabled: false });
    expect((await service.list("new-project")).capability.available).toBe(false);
    await expect(service.start("new-project", randomUUID(), "Inspect the new fictional project")).rejects.toMatchObject({ statusCode: 403 });
  });

  it("includes model and permissions in dispatch, receipts, and duplicate detection", async () => {
    const { service, provider } = setup();
    const requestId = randomUUID();
    const options = { model: "sonnet", permissionMode: "bypassPermissions" } as const;
    const first = await service.start("fixture", requestId, "Fix the fictional export test", options);
    expect(first).toMatchObject(options);
    expect(provider.start).toHaveBeenLastCalledWith(first.cwd, first.name, "Fix the fictional export test", options);
    await service.start("fixture", requestId, "Fix the fictional export test", options);
    await expect(service.start("fixture", requestId, "Fix the fictional export test", { ...options, permissionMode: "auto" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.start("fixture", requestId, "Fix the fictional export test", { ...options, model: "fable" })).rejects.toMatchObject({ statusCode: 409 });
    expect(provider.start).toHaveBeenCalledTimes(1);
  });

  it("recognizes a build-15 default request after upgrading without dispatching again", async () => {
    const { service, store, provider, dir } = setup();
    const requestId = randomUUID();
    const prompt = "Inspect the fictional project";
    const fingerprint = createHash("sha256").update(JSON.stringify(["fixture", prompt])).digest("hex");
    store.insert(requestId, fingerprint, { id: randomUUID(), projectId: "fixture", name: "Legacy task", createdAt: new Date().toISOString(), state: "unknown", message: "Check status", nativeId: null, sessionId: null, cwd: dir, openedAt: null });
    expect((await service.start("fixture", requestId, prompt, { model: "default", permissionMode: "manual" })).name).toBe("Legacy task");
    expect(provider.start).not.toHaveBeenCalled();
  });
  it("sends one native task for concurrent duplicate requests and rejects changed payloads", async () => {
    const { service, provider } = setup();
    const id = randomUUID();
    const receipts = await Promise.all(Array.from({ length: 5 }, () => service.start("fixture", id, "Fix the fictional export test")));
    expect(new Set(receipts.map(r => r.id)).size).toBe(1);
    expect(provider.start).toHaveBeenCalledTimes(1);
    expect(receipts[0]).toMatchObject({ nativeId: "1234abcd", state: "running" });
    await expect(service.start("fixture", id, "A different task now")).rejects.toMatchObject({ statusCode: 409 });
    expect(provider.start).toHaveBeenCalledTimes(1);
  });

  it("recovers an uncertain dispatch after daemon restart without resending the prompt", async () => {
    const { dir, service, provider, config, setNative } = setup();
    vi.mocked(provider.start).mockImplementationOnce(async (cwd, name) => {
      setNative([{ id: "1234abcd", sessionId: randomUUID(), cwd, name, kind: "background", state: "blocked", status: "waiting" }]);
      throw new Error("Lost response after dispatch; private prompt must not escape");
    });
    const request = randomUUID();
    const first = await service.start("fixture", request, "PRIVATE-TASK-SENTINEL investigate export");
    expect(first.state).toBe("unknown");
    expect(JSON.stringify(first)).not.toContain("PRIVATE-TASK-SENTINEL");
    const reopened = new LaunchStore(path.join(dir, "launches.db"));
    cleanups.push(() => reopened.close());
    const next = new LaunchService(config, provider, reopened);
    expect((await next.list("fixture")).launches[0]).toMatchObject({ id: first.id, state: "needs_input", nativeId: "1234abcd" });
    await next.start("fixture", request, "PRIVATE-TASK-SENTINEL investigate export");
    expect(provider.start).toHaveBeenCalledTimes(1);
    for (const file of fs.readdirSync(dir).filter(f => f.startsWith("launches.db"))) {
      expect(fs.readFileSync(path.join(dir, file)).includes(Buffer.from("PRIVATE-TASK-SENTINEL"))).toBe(false);
      expect(fs.statSync(path.join(dir, file)).mode & 0o777).toBe(0o600);
    }
  });

  it("never dispatches when the project is disabled, gone, or Claude is signed out", async () => {
    const { service, provider, config } = setup(false);
    await expect(service.start("fixture", randomUUID(), "Fix the export test")).rejects.toMatchObject({ statusCode: 403 });
    await expect(service.start("unknown", randomUUID(), "Fix the export test")).rejects.toMatchObject({ statusCode: 404 });
    config.projects[0]!.claude_launch_enabled = true;
    vi.mocked(provider.capability).mockResolvedValue({ available: false, message: "Sign in to Claude Code." });
    expect(await service.start("fixture", randomUUID(), "Fix the export test")).toMatchObject({ state: "failed", message: "Sign in to Claude Code." });
    expect(provider.start).not.toHaveBeenCalled();
  });

  it("tracks the native working directory, then permanently hands ownership to Desktop", async () => {
    const { service, setNative, dir } = setup();
    const first = await service.start("fixture", randomUUID(), "Fix the export test");
    setNative([{ id: "1234abcd", sessionId: first.sessionId!, cwd: path.join(dir, ".claude/worktrees/task"), kind: "background", state: "done" }]);
    const receipt = (await service.list("fixture")).launches[0]!;
    expect(receipt.state).toBe("completed");
    expect(receipt.cwd).toContain(".claude/worktrees/task");
    expect(receipt.openedAt).toBeNull();
    await service.open("fixture", first.id);
    setNative([]);
    expect((await service.list("fixture")).launches[0]?.state).toBe("in_desktop");
  });

  it("cannot take over another project's launch or take over after local revocation", async () => {
    const { service, config, provider, dir } = setup();
    config.projects.push({ id: "other", name: "Other", path: dir, allowed_actions: ["launch-claude"] });
    const receipt = await service.start("fixture", randomUUID(), "Fix the export test");
    await expect(service.open("other", receipt.id)).rejects.toMatchObject({ statusCode: 404 });
    config.projects[0]!.claude_launch_enabled = false;
    await expect(service.open("fixture", receipt.id)).rejects.toMatchObject({ statusCode: 403 });
    expect(provider.open).not.toHaveBeenCalled();
  });
});

describe("Claude launch API", () => {
  it("authenticates both mutations and rejects unsafe input before spawning", async () => {
    const { config, service, provider } = setup();
    const app = buildServer({ config, adapters: [], analyst: {} as never, launches: service });
    // Store lifetime is managed by the fixture to avoid closing twice.
    service.close = () => {};
    cleanups.push(() => app.close());
    const url = "/v1/projects/fixture/claude-launches";
    expect((await app.inject({ method: "POST", url, payload: { requestId: randomUUID(), prompt: "A task to run" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `${url}/id/open` })).statusCode).toBe(401);
    for (const prompt of ["", "/desktop", "x".repeat(8_001), "bad\u001bcontrol characters"]) {
      expect((await app.inject({ method: "POST", url, headers: authHeaders(), payload: { requestId: randomUUID(), prompt } })).statusCode).toBe(400);
    }
    for (const options of [{ model: "--unsafe" }, { permissionMode: "auto; echo bad" }, { model: "unknown-model" }]) {
      expect((await app.inject({ method: "POST", url, headers: authHeaders(), payload: { requestId: randomUUID(), prompt: "Inspect this project", ...options } })).statusCode).toBe(400);
    }
    expect(provider.start).not.toHaveBeenCalled();
    const accepted = await app.inject({ method: "POST", url, headers: authHeaders(), payload: { requestId: randomUUID(), prompt: "Inspect the fictional export" } });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.json().nativeId).toBe("1234abcd");
  });
});

describe("native command boundary", () => {
  it.each(CLAUDE_PERMISSION_MODES)("passes the chosen %s permissions and model to Claude", async permissionMode => {
    const command = vi.fn(async () => "backgrounded · abcdef12 · task");
    const provider = new NativeClaudeProvider("claude", command);
    await provider.start("/tmp/fixture", "Fixture", "Inspect the fictional project", { model: "haiku", permissionMode });
    expect(command).toHaveBeenCalledExactlyOnceWith("claude", ["--bg", "--permission-mode", permissionMode, "--model", "haiku", "--name", "Fixture", "--", "Inspect the fictional project"], "/tmp/fixture");
  });
  it("passes hostile text as a single prompt argument and uses the acknowledged native ID", async () => {
    const command = vi.fn(async () => "Starting background service…\nbackgrounded · abcdef12 · task\n");
    const provider = new NativeClaudeProvider("/usr/local/bin/claude", command);
    const prompt = "--dangerously-skip-permissions $(touch /tmp/not-a-command) `echo secret`\n'quoted'";
    expect(await provider.start("/tmp/fixture", "Fixture task", prompt)).toBe("abcdef12");
    expect(command).toHaveBeenCalledWith("/usr/local/bin/claude", ["--bg", "--permission-mode", "manual", "--name", "Fixture task", "--", prompt], "/tmp/fixture");
    command.mockResolvedValueOnce("A command ran but no acknowledgement was provided");
    await expect(provider.start("/tmp/fixture", "Fixture task", prompt)).rejects.toThrow();
  });

  it("stops the exact background owner before handing off and never resumes Desktop twice", async () => {
    const { service } = setup();
    const receipt = await service.start("fixture", randomUUID(), "Inspect the fictional export");
    const command = vi.fn(async (_file: string, args: string[]) => args[0] === "agents"
      ? JSON.stringify([{ id: receipt.nativeId, sessionId: receipt.sessionId, cwd: receipt.cwd, kind: "background", state: "done" }]) : "");
    let desktop = false;
    const handoff = vi.fn(async () => { desktop = true; });
    const provider = new NativeClaudeProvider("claude", command, handoff, () => desktop);
    await provider.open(receipt);
    expect(command).toHaveBeenCalledWith("claude", ["stop", receipt.nativeId]);
    expect(handoff).toHaveBeenCalledWith("claude", receipt.sessionId, receipt.cwd, "manual");
    await provider.open(receipt);
    expect(handoff).toHaveBeenCalledTimes(1);
    expect(command).toHaveBeenLastCalledWith("/usr/bin/open", ["-a", "Claude"]);
  });

  it("refuses takeover if another live interface owns the same conversation", async () => {
    const { service } = setup();
    const receipt = await service.start("fixture", randomUUID(), "Inspect the fictional export");
    const command = vi.fn(async () => JSON.stringify([
      { id: receipt.nativeId, sessionId: receipt.sessionId, cwd: receipt.cwd, kind: "background", state: "done" },
      { sessionId: receipt.sessionId, cwd: receipt.cwd, kind: "interactive" },
    ]));
    const handoff = vi.fn(async () => {});
    const provider = new NativeClaudeProvider("claude", command, handoff, () => false);
    await expect(provider.open(receipt)).rejects.toThrow("another native interface");
    expect(handoff).not.toHaveBeenCalled();
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("never resumes a previously handed-off session after its Desktop catalog disappears", async () => {
    const { service } = setup();
    const receipt = await service.start("fixture", randomUUID(), "Inspect the fictional export");
    receipt.openedAt = new Date().toISOString();
    const command = vi.fn(async () => "");
    const handoff = vi.fn(async () => {});
    const provider = new NativeClaudeProvider("claude", command, handoff, () => false);
    await provider.open(receipt);
    expect(command).toHaveBeenCalledExactlyOnceWith("/usr/bin/open", ["-a", "Claude"]);
    expect(handoff).not.toHaveBeenCalled();
  });

  it("requires an exact native Desktop catalog identity and rejects symlinks", () => {
    const { dir } = setup();
    const id = randomUUID();
    const catalog = path.join(dir, "account", "bridge");
    fs.mkdirSync(catalog, { recursive: true });
    const file = path.join(catalog, `local_${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ sessionId: `local_${id}`, cliSessionId: randomUUID() }));
    expect(desktopHasSession(id, dir)).toBe(false);
    fs.writeFileSync(file, JSON.stringify({ sessionId: `local_${id}`, cliSessionId: id }));
    expect(desktopHasSession(id, dir)).toBe(true);
    fs.renameSync(file, `${file}.original`);
    fs.symlinkSync(`${file}.original`, file);
    expect(desktopHasSession(id, dir)).toBe(false);
  });
});
