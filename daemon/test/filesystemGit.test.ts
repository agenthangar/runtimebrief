import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { runGit, GitError, gitReadOnlyEnvironment } from "../src/git.js";
import { isSensitivePath } from "../src/secretFilter.js";
import { fixtureProject, git, makeFixtureRepo, tmpdir } from "./helpers.js";

describe("runGit safety", () => {
  it("disables index refreshes, lazy fetches, and credential prompts", () => {
    expect(
      gitReadOnlyEnvironment({
        GIT_OPTIONAL_LOCKS: "1",
        GIT_NO_LAZY_FETCH: "0",
        GIT_TERMINAL_PROMPT: "1",
      }),
    ).toMatchObject({
      GIT_OPTIONAL_LOCKS: "0",
      GIT_NO_LAZY_FETCH: "1",
      GIT_TERMINAL_PROMPT: "0",
    });
  });

  it("rejects non-allowlisted subcommands", async () => {
    await expect(runGit("/tmp", ["push"])).rejects.toThrow(GitError);
    await expect(runGit("/tmp", ["checkout", "main"])).rejects.toThrow(/not allowlisted/);
    await expect(runGit("/tmp", ["stash", "pop"])).rejects.toThrow(/not allowlisted/);
    await expect(runGit("/tmp", [])).rejects.toThrow(/not allowlisted/);
  });

  it("rejects exec-style argument smuggling", async () => {
    await expect(runGit("/tmp", ["log", "--exec=/bin/sh"])).rejects.toThrow(/not allowed/);
    // git grep's pager flag would execute an arbitrary command.
    await expect(runGit("/tmp", ["grep", "-O/bin/sh", "x"])).rejects.toThrow(/not allowed/);
    await expect(runGit("/tmp", ["grep", "--open-files-in-pager=/bin/sh", "x"])).rejects.toThrow(
      /not allowed/,
    );
  });

  it("treats hostile file names as data, not shell", async () => {
    const repo = makeFixtureRepo();
    const hostile = "$(touch runtimebrief-pwned); rm -rf .";
    fs.writeFileSync(path.join(repo, hostile), "x");
    git(repo, "add", ".");
    git(repo, "commit", "-m", `add \`dangerous\` $(file) "quotes"`);
    const out = await runGit(repo, ["log", "-n1", "--pretty=%s"]);
    expect(out).toContain("$(file)");
    expect(fs.existsSync(path.join(repo, "runtimebrief-pwned"))).toBe(false);
    fs.rmSync(repo, { recursive: true, force: true });
  });
});

describe("FilesystemGitAdapter", () => {
  let repo: string;
  let dirtyRepo: string;
  const adapter = new FilesystemGitAdapter();

  beforeAll(() => {
    repo = makeFixtureRepo();
    dirtyRepo = makeFixtureRepo({ dirty: true });
  });
  afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dirtyRepo, { recursive: true, force: true });
  });

  it("discovers git repos and rejects plain directories", async () => {
    expect(await adapter.discover(fixtureProject(repo))).toBe(true);
    const plain = tmpdir("plain");
    expect(await adapter.discover(fixtureProject(plain))).toBe(false);
    fs.rmSync(plain, { recursive: true, force: true });
  });

  it("summarizes branch, cleanliness, commits, diffstat, TODOs", async () => {
    const summary = await adapter.summary(fixtureProject(repo));
    expect(summary.branch).toBe("feature/test-branch");
    expect(summary.dirty).toBe(false);
    expect(summary.commits.length).toBe(3);
    expect(summary.commits[0]).toMatchObject({
      author: "Fixture Author",
      message: "add feature module",
    });
    expect(summary.commits[0]!.hash).toMatch(/^[0-9a-f]{40}$/);
    expect(Date.parse(summary.commits[0]!.timestamp)).not.toBeNaN();
    expect(summary.defaultBranch).toBe("main");
    expect(summary.diffstatVsDefault).toMatch(/1 file changed/);
    expect(summary.todoCount).toBe(1);
    expect(summary.fixmeCount).toBe(1);
    expect(summary.recentlyModifiedFiles.length).toBeGreaterThan(0);
    expect(summary.lastCommitAt).toBe(summary.commits[0]!.timestamp);
  });

  it("flags dirty working trees", async () => {
    const summary = await adapter.summary(fixtureProject(dirtyRepo));
    expect(summary.dirty).toBe(true);
    expect(summary.dirtyFileCount).toBe(1);
  });

  it("summarizes a newly initialized repository before its first commit", async () => {
    const fresh = tmpdir("fresh-repo");
    git(fresh, "init", "-b", "main");
    fs.writeFileSync(path.join(fresh, "README.md"), "# Fresh\n");
    const summary = await adapter.summary(fixtureProject(fresh));
    expect(summary).toMatchObject({
      branch: "main",
      dirty: true,
      dirtyFileCount: 1,
      commits: [],
      lastCommitAt: null,
    });
    fs.rmSync(fresh, { recursive: true, force: true });
  });

  it("reports commits as recent activity, filtered by since", async () => {
    const events = await adapter.recentActivity(
      fixtureProject(repo),
      new Date(Date.now() - 60 * 60 * 1000),
    );
    expect(events.length).toBe(3);
    expect(events[0]).toMatchObject({ source: "filesystem-git", kind: "commit" });
    const none = await adapter.recentActivity(
      fixtureProject(repo),
      new Date(Date.now() + 60 * 60 * 1000),
    );
    expect(none.length).toBe(0);
  });

  it("returns no transcripts", async () => {
    expect(await adapter.transcriptPaths(fixtureProject(repo), 5)).toEqual([]);
  });

  it("skips sensitive files even when tracked", async () => {
    // git grep only sees tracked files, so commit the sensitive ones to prove
    // the isSensitivePath filter (not mere untracked-ness) excludes them.
    fs.writeFileSync(path.join(dirtyRepo, ".env"), "TODO SECRET=x\nTODO more\n");
    fs.writeFileSync(path.join(dirtyRepo, "aws-credentials.md"), "TODO leak\n");
    git(dirtyRepo, "add", "-f", ".env", "aws-credentials.md");
    git(dirtyRepo, "commit", "-m", "track sensitive fixtures");
    const summary = await adapter.summary(fixtureProject(dirtyRepo));
    // Only the TODO line from app.ts, none from .env/credentials.
    expect(summary.todoCount).toBe(1);
    expect(summary.fixmeCount).toBe(1);
    expect(summary.recentlyModifiedFiles.map((f) => f.path)).not.toContain(".env");
  });

  it("counts TODO/FIXME lines in tracked files only", async () => {
    // Untracked files are invisible to git grep — wip.ts stays uncounted.
    fs.writeFileSync(path.join(dirtyRepo, "untracked-notes.md"), "TODO not tracked\n");
    const summary = await adapter.summary(fixtureProject(dirtyRepo));
    expect(summary.todoCount).toBe(1);
  });
});

describe("isSensitivePath", () => {
  it("matches the required deny patterns", () => {
    for (const p of [
      ".env", ".env.local", ".envrc", "config/.env.production",
      "config\\.env",
      "aws-credentials.json", "creds/credentials",
      "secrets.yaml", "app/client_secret.json",
      "id_rsa", ".ssh/id_rsa.pub", "keys/id_ed25519",
      "keys/id_ecdsa", ".npmrc", "config/.netrc", "release.p8",
      "certs/server.pem", "certs/server.key", "signing/app.mobileprovision",
    ]) {
      expect(isSensitivePath(p), p).toBe(true);
    }
  });

  it("passes ordinary files", () => {
    for (const p of ["src/index.ts", "README.md", "environment.ts", "docs/env-setup.md"]) {
      expect(isSensitivePath(p), p).toBe(false);
    }
  });
});
