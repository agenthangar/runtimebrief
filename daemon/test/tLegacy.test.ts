import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { TLegacyBackend, nativeRemoteURL, promptHash, tSlot, tTarget } from "../src/launches/tLegacy.js";
import { hasPinnedT, installPinnedT, T_COMMIT, T_ARCHIVE_SHA256 } from "../src/launches/tDependency.js";
import type { ClaudeLaunch } from "../src/launches/types.js";
import { tmpdir } from "./helpers.js";

const cleanups: (() => void)[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const clean of cleanups.splice(0).reverse()) clean(); });
const runner = fileURLToPath(new URL("../scripts/t-claude.mjs", import.meta.url));

function fixture() {
  const root = tmpdir("t-bridge");
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const id = randomUUID();
  const project = path.join(root, "fixture");
  const cwd = path.join(root, "t-worktrees", "fixture", tSlot(id));
  const directory = path.join(root, "t-launches", id);
  fs.mkdirSync(project);
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(directory, { recursive: true });
  const nativeId = randomUUID();
  fs.writeFileSync(path.join(directory, "native.json"), JSON.stringify({ sessionId: nativeId, cwd }));
  const claudeRoot = path.join(root, "claude");
  const transcripts = path.join(claudeRoot, "projects", cwd.replace(/[^A-Za-z0-9]/g, "-"));
  fs.mkdirSync(transcripts, { recursive: true });
  const transcript = path.join(transcripts, `${nativeId}.jsonl`);
  const prompt = "Inspect the fictional export workflow";
  const receipt: ClaudeLaunch = {
    id, projectId: "fixture", name: "Fixture", createdAt: new Date().toISOString(),
    state: "starting", message: "Starting", nativeId: null, sessionId: null, openedAt: null,
    cwd: project, projectRoot: project, backend: "t-legacy", promptHash: promptHash(prompt), requestedRemoteControl: true,
  };
  const backend = new TLegacyBackend({ root, claudeRoot });
  const terminal = vi.spyOn(backend as unknown as { tmuxCommand(args: string[]): Promise<string> }, "tmuxCommand")
    .mockImplementation(async args => args[0] === "show-environment" ? `CLAUDE_RESUME_ID=${nativeId}` : "native session");
  const write = (...records: object[]) => fs.writeFileSync(transcript, records.map(record => JSON.stringify({ sessionId: nativeId, cwd, ...record })).join("\n"));
  const user = { type: "user", message: { role: "user", content: prompt } };
  const done = { type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "Review complete." }] } };
  const bridge = { type: "system", subtype: "bridge_status", content: "/remote-control is active", url: "https://claude.ai/code/session_fixture123", timestamp: new Date().toISOString() };
  return { root, backend, receipt, directory, cwd, nativeId, prompt, terminal, write, user, done, bridge };
}

describe("current t observation", () => {
  it("requires native acknowledgment rather than a preassigned terminal identity", async () => {
    const f = fixture();
    const result = await f.backend.get(f.receipt);
    expect(result).toMatchObject({ launchState: "starting", nativeId: null, remoteControl: { state: "starting", url: null } });
    expect(result.tmuxTarget).toBe(tTarget(f.receipt.id));
  });

  it("keeps Remote Control and accepted task state independent", async () => {
    const f = fixture();
    f.write(f.bridge);
    expect(await f.backend.get(f.receipt)).toMatchObject({ launchState: "starting", remoteControl: { state: "ready", url: f.bridge.url } });
    f.write(f.user, f.done, f.bridge);
    expect(await f.backend.get(f.receipt)).toMatchObject({ launchState: "started", state: "completed", activity: "idle", sessionId: f.nativeId });
  });

  it("does not acknowledge a different prompt, foreign conversation, or subagent", async () => {
    const f = fixture();
    f.write({ ...f.user, message: { role: "user", content: "A different task" } }, { ...f.user, isSidechain: true });
    expect((await f.backend.get(f.receipt)).launchState).toBe("starting");
    f.write({ ...f.user, sessionId: randomUUID() }, f.bridge);
    expect(await f.backend.get(f.receipt)).toMatchObject({ launchState: "starting", remoteControl: { url: null } });
  });

  it("removes a ready link after native failure, disconnect, or terminal exit", async () => {
    const f = fixture();
    f.write(f.user, f.bridge, { ...f.bridge, content: "Remote Control disconnected", url: null });
    expect((await f.backend.get(f.receipt)).remoteControl).toMatchObject({ state: "unavailable", url: null });
    f.write(f.user, f.bridge);
    await f.backend.get(f.receipt);
    f.terminal.mockRejectedValue(new Error("no server"));
    expect(await f.backend.get(f.receipt)).toMatchObject({ launchState: "started", activity: "stopped", remoteControl: { url: null } });
  });

  it("waits for native trust without sending a keystroke or acknowledging the task", async () => {
    const f = fixture();
    f.terminal.mockImplementation(async args => args[0] === "show-environment" ? `CLAUDE_RESUME_ID=${f.nativeId}` : "Yes, I trust this folder");
    expect(await f.backend.get(f.receipt)).toMatchObject({ state: "needs_input", launchState: "starting", activity: "needs_input" });
    expect(f.terminal).toHaveBeenCalledWith(expect.arrayContaining(["capture-pane"]));
    expect(f.terminal).toHaveBeenCalledWith(expect.arrayContaining([`=${tTarget(f.receipt.id)}:`]));
    expect(f.terminal.mock.calls.flat(2)).not.toContain("send-keys");
  });

  it("clears a ready link when Claude exits but its terminal shell stays open", async () => {
    const f = fixture(); f.write(f.user, f.done, f.bridge);
    expect((await f.backend.get(f.receipt)).remoteControl?.state).toBe("ready");
    fs.writeFileSync(path.join(f.directory, "exit.json"), JSON.stringify({ code: 0, spawnFailed: false }));
    expect(await f.backend.get(f.receipt)).toMatchObject({ launchState: "started", activity: "stopped", remoteControl: { state: "unavailable", url: null } });
  });

  it("proves spawn failure but keeps missing output uncertain", async () => {
    const f = fixture();
    f.terminal.mockRejectedValue(new Error("no server"));
    expect((await f.backend.get(f.receipt)).launchState).toBe("unknown");
    fs.writeFileSync(path.join(f.directory, "exit.json"), JSON.stringify({ spawnFailed: true }));
    expect((await f.backend.get(f.receipt)).launchState).toBe("failed");
  });

  it("does not claim a saved conversation or offer a dead attach target without a native session", async () => {
    const f = fixture();
    fs.unlinkSync(path.join(f.directory, "native.json"));
    f.terminal.mockRejectedValue(new Error("no server"));
    const result = await f.backend.get(f.receipt);
    expect(result).toMatchObject({ launchState: "unknown", state: "unknown", activity: "stopped" });
    expect(result).not.toHaveProperty("tmuxTarget");
    expect(result.message).toContain("not available in Claude");
    expect(result.message).not.toContain("saved conversation");
  });

  it("honors local-only requests despite an old Remote Control record", async () => {
    const f = fixture();
    f.receipt.requestedRemoteControl = false;
    f.write(f.user, f.bridge);
    expect((await f.backend.get(f.receipt)).remoteControl).toMatchObject({ state: "disabled", url: null });
  });

  it("does not reuse a link after the terminal changes its native conversation", async () => {
    const f = fixture(); f.write(f.user, f.bridge);
    f.terminal.mockImplementation(async args => args[0] === "show-environment" ? `CLAUDE_RESUME_ID=${randomUUID()}` : "native session");
    const result = await f.backend.get(f.receipt);
    expect(result.remoteControl?.url).toBeNull();
    expect(result.message).toContain("different conversation");
    expect(result.sessionId).toBe(f.nativeId);
  });

  it("refuses to read native history from a different worktree", async () => {
    const f = fixture();
    f.write(f.user, f.bridge);
    fs.writeFileSync(path.join(f.directory, "native.json"), JSON.stringify({ sessionId: f.nativeId, cwd: f.root }));
    expect(await f.backend.get(f.receipt)).toMatchObject({ nativeId: null, launchState: "starting", remoteControl: { url: null } });
  });

  it.each(["http://claude.ai/code/session_fixture", "https://claude.ai.evil.invalid/code/session_fixture", "https://claude.ai/code/session_fixture?token=fixture", "https://example.invalid/code/session_fixture", "javascript:alert(1)"])("rejects non-native links: %s", value => {
    expect(nativeRemoteURL(value)).toBeNull();
  });
});

describe("t native argv bridge", () => {
  it.each([true, false])("delivers hostile task text exactly once with remoteControl=%s", remoteControl => {
    const f = fixture();
    fs.unlinkSync(path.join(f.directory, "native.json"));
    const binary = path.join(f.root, "fake-claude.mjs");
    fs.writeFileSync(binary, `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync('argv.json', JSON.stringify(process.argv.slice(2)));\n`, { mode: 0o700 });
    const prompt = "--unsafe $(touch injected) `touch injected` 'quotes'\n多行 task";
    const payload = { binary, name: "Fixture task", model: "sonnet", permissionMode: "plan", remoteControl, prompt };
    const file = path.join(f.directory, "payload.json");
    fs.writeFileSync(file, JSON.stringify(payload), { mode: 0o600 });
    const command = () => execFileSync(process.execPath, [runner, "--session-id", f.nativeId], { cwd: f.cwd, env: { ...process.env, RB_T_CONFIG: file }, stdio: "pipe" });
    command();
    const args = JSON.parse(fs.readFileSync(path.join(f.cwd, "argv.json"), "utf8"));
    expect(args.at(-1)).toBe(prompt);
    expect(args.slice(-2)).toEqual(["--", prompt]);
    expect(args).toContain("sonnet");
    expect(args).toContain("plan");
    expect(args.includes("--remote-control")).toBe(remoteControl);
    expect(fs.existsSync(path.join(f.cwd, "injected"))).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.statSync(path.join(f.directory, "native.json")).mode & 0o777).toBe(0o600);
    fs.writeFileSync(file, JSON.stringify(payload));
    expect(command).toThrow();
  });
});

describe("pinned dependency", () => {
  it("does not execute/download a different or incomplete install", async () => {
    const f = fixture();
    expect(hasPinnedT(f.root)).toBe(false);
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(installPinnedT(f.root)).rejects.toThrow("incomplete");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an archive checksum mismatch without installing any executable", async () => {
    const f = fixture();
    const target = path.join(f.root, "tools", "pinned");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("untrusted archive")));
    await expect(installPinnedT(target)).rejects.toThrow("checksum");
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(path.dirname(target))).toEqual([]);
  });

  it("reuses the exact install without a network request", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.root, "runtimebrief-install.json"), JSON.stringify({ commit: T_COMMIT, sha256: T_ARCHIVE_SHA256 }));
    fs.writeFileSync(path.join(f.root, "t.plugin.zsh"), "# fixture");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(hasPinnedT(f.root)).toBe(true);
    await installPinnedT(f.root);
    expect(fetch).not.toHaveBeenCalled();
  });
});
