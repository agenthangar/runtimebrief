import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CursorSessionsAdapter } from "../src/adapters/cursorSessions.js";
import { nativeCursorRefs, parseNativeCursorSnapshot } from "../src/adapters/nativeCursorSessions.js";
import { fixtureProject, git, makeFixtureRepo, tmpdir } from "./helpers.js";

const cleanup: string[] = [];
afterEach(() => { for (const root of cleanup.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const repo = makeFixtureRepo(), root = tmpdir("native-cursor"); cleanup.push(repo, root);
  const id = "10000000-0000-4000-8000-000000000001", nativeID = "20000000-0000-4000-8000-000000000001";
  const cwd = path.join(root, "native-worktrees", id), file = path.join(root, "native-launches", id, "state.json");
  fs.mkdirSync(path.dirname(cwd), { recursive: true }); git(repo, "worktree", "add", "--detach", cwd);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const value = { provider: "cursor", cwd, sessionId: nativeID, state: "completed", message: "Ready to review.", updatedAt: new Date().toISOString(), messages: [{ role: "user", text: "Review the fictional export" }, { role: "assistant", text: "The fictional export is ready." }] };
  fs.writeFileSync(file, JSON.stringify(value));
  return { repo, root, cwd, file, value, nativeID };
}
describe("native Cursor conversation evidence", () => {
  it("surfaces ACP conversations in project evidence and analyst digests without a desktop transcript", async () => {
    const f = fixture(); const adapter = new CursorSessionsAdapter(path.join(f.root, "empty-cursor"), null, f.root);
    const refs = await adapter.transcriptPaths(fixtureProject(f.repo), 10);
    expect(refs).toHaveLength(1); expect(refs[0]).toMatchObject({ source: "cursor", id: f.nativeID, state: "completed", conclusion: "The fictional export is ready." });
    const parsed = await parseNativeCursorSnapshot(f.file, f.root);
    expect(parsed.userPrompts).toEqual(["Review the fictional export"]); expect(parsed.cwd).toBe(fs.realpathSync(f.cwd));
    expect(await adapter.discover(fixtureProject(f.repo))).toBe(true);
  });
  it("keeps workspaces and explicitly excluded sources separate", async () => {
    const f = fixture(); const other = makeFixtureRepo(); cleanup.push(other);
    expect(await nativeCursorRefs(fixtureProject(other), f.root, 10)).toEqual([]);
    expect(await nativeCursorRefs({ ...fixtureProject(f.repo), transcript_sources: [{ type: "codex" }] }, f.root, 10)).toEqual([]);
    fs.writeFileSync(f.file, JSON.stringify({ ...f.value, cwd: f.repo }));
    expect(await nativeCursorRefs(fixtureProject(f.repo), f.root, 10)).toEqual([]);
  });
  it("does not advertise a pending action or successful conclusion after its owner exits", async () => {
    const f = fixture(); fs.writeFileSync(f.file, JSON.stringify({ ...f.value, state: "needs_input" }));
    const parsed = await parseNativeCursorSnapshot(f.file, f.root);
    expect(parsed.state).toBe("interrupted"); expect(parsed.finalAssistantText).toBeNull();
    expect(parsed.stateReason).toContain("stopped");
  });
  it("surfaces selected-project ACP sessions without a UUID worktree and keeps other projects separate", async () => {
    const f = fixture();
    fs.rmSync(f.cwd, { recursive: true, force: true });
    fs.writeFileSync(f.file, JSON.stringify({ ...f.value, cwd: f.repo, projectRoot: f.repo, workspaceKind: "project" }));
    const parsed = await parseNativeCursorSnapshot(f.file, f.root);
    expect(parsed).toMatchObject({ sessionId: f.nativeID, cwd: fs.realpathSync(f.repo), state: "completed", finalAssistantText: "The fictional export is ready." });
    expect(await nativeCursorRefs(fixtureProject(f.repo), f.root, 10)).toHaveLength(1);
    const other = makeFixtureRepo(); cleanup.push(other);
    expect(await nativeCursorRefs(fixtureProject(other), f.root, 10)).toEqual([]);
    fs.writeFileSync(f.file, JSON.stringify({ ...f.value, cwd: other, projectRoot: f.repo, workspaceKind: "project" }));
    await expect(parseNativeCursorSnapshot(f.file, f.root)).rejects.toThrow("mismatch");
    expect(await nativeCursorRefs(fixtureProject(other), f.root, 10)).toEqual([]);
  });
  it("supports exact project-folder evidence without Git metadata", async () => {
    const f = fixture(), plain = tmpdir("plain-cursor-project"); cleanup.push(plain);
    fs.writeFileSync(f.file, JSON.stringify({ ...f.value, cwd: plain, projectRoot: plain, workspaceKind: "project" }));
    expect(await nativeCursorRefs(fixtureProject(plain), f.root, 10)).toHaveLength(1);
    fs.writeFileSync(f.file, JSON.stringify({ ...f.value, cwd: plain, projectRoot: plain, workspaceKind: "unexpected" }));
    expect(await nativeCursorRefs(fixtureProject(plain), f.root, 10)).toEqual([]);
  });
});
