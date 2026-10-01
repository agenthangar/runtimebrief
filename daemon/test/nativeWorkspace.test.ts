import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { git, makeFixtureRepo, tmpdir } from "./helpers.js";
import { prepareNativeWorkspace } from "../src/launches/nativeWorkspace.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

it.each(["claude", "codex", "cursor"])("uses the selected %s project folder without changing its branch, files, or Git worktrees", provider => {
  const projectRoot = fs.realpathSync(makeFixtureRepo({ dirty: true })); roots.push(projectRoot);
  const branch = git(projectRoot, "branch", "--show-current"), status = git(projectRoot, "status", "--porcelain"), worktrees = git(projectRoot, "worktree", "list", "--porcelain");
  expect(prepareNativeWorkspace({ id: randomUUID(), provider, projectRoot, cwd: projectRoot, workspaceKind: "project" })).toBe(projectRoot);
  expect(git(projectRoot, "branch", "--show-current")).toBe(branch);
  expect(git(projectRoot, "status", "--porcelain")).toBe(status);
  expect(git(projectRoot, "worktree", "list", "--porcelain")).toBe(worktrees);
  expect(fs.readFileSync(path.join(projectRoot, "wip.ts"), "utf8")).toBe("// work in progress\n");
});

it.each(["claude", "codex", "cursor"])("supports a native %s project without an initial Git commit", provider => {
  const projectRoot = fs.realpathSync(tmpdir("native-project")); roots.push(projectRoot);
  expect(prepareNativeWorkspace({ id: randomUUID(), provider, projectRoot, cwd: projectRoot, workspaceKind: "project" })).toBe(projectRoot);
});

it.each(["claude", "codex", "cursor"])("rejects a different execution folder for a selected %s project", provider => {
  const projectRoot = fs.realpathSync(tmpdir("native-project")); roots.push(projectRoot);
  const cwd = path.join(projectRoot, "other"); fs.mkdirSync(cwd);
  expect(() => prepareNativeWorkspace({ id: randomUUID(), provider, projectRoot, cwd, workspaceKind: "project" })).toThrow("mismatch");
});

it.each(["claude", "cursor", "codex"])("preserves %s worktree launch setup for existing payloads", provider => {
  const projectRoot = fs.realpathSync(makeFixtureRepo({ dirty: true })); roots.push(projectRoot);
  const parent = fs.realpathSync(tmpdir("native-workspace")); roots.push(parent);
  const id = randomUUID(), cwd = path.join(parent, id);
  expect(prepareNativeWorkspace({ id, provider, projectRoot, cwd })).toBe(cwd);
  expect(git(cwd, "branch", "--show-current").trim()).toBe(`runtimebrief/${id}`);
  expect(git(cwd, "rev-parse", "HEAD")).toBe(git(projectRoot, "rev-parse", "HEAD"));
  expect(fs.existsSync(path.join(cwd, "wip.ts"))).toBe(false);
});

it("rejects unknown providers and workspace kinds", () => {
  const projectRoot = fs.realpathSync(tmpdir("native-project")); roots.push(projectRoot);
  expect(() => prepareNativeWorkspace({ id: randomUUID(), provider: "other", projectRoot, cwd: projectRoot, workspaceKind: "project" })).toThrow("mismatch");
  expect(() => prepareNativeWorkspace({ id: randomUUID(), provider: "cursor", projectRoot, cwd: projectRoot, workspaceKind: "other" })).toThrow("Invalid native workspace kind");
});
