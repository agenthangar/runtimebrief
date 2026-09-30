import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { projectsForConfig } from "../src/projectRegistry.js";
import { git, testConfig, tmpdir } from "./helpers.js";

const cleanup: string[] = [];

afterEach(() => {
  for (const dir of cleanup.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(): string {
  const root = tmpdir("project-root");
  cleanup.push(root);
  return root;
}

function makeRepo(root: string, name: string): string {
  const repo = path.join(root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(repo, "init", "-b", "main");
  return repo;
}

describe("trusted project roots", () => {
  it("groups numbered linked worktrees under their real repository for every provider", () => {
    const root = makeRoot();
    const repo = makeRepo(root, "real-project");
    fs.writeFileSync(path.join(repo, "README.md"), "Fictional repository\n");
    git(repo, "add", "."); git(repo, "commit", "-m", "Fixture");
    const worktrees = path.join(root, "workspaces"); fs.mkdirSync(worktrees);
    git(repo, "worktree", "add", "-b", "fixture-one", path.join(worktrees, "1"));
    git(repo, "worktree", "add", "-b", "fixture-two", path.join(worktrees, "2"));
    const explicit = { id: "real", name: "Real Project", path: repo };
    const registered = projectsForConfig(testConfig({ projects: [explicit], project_roots: [worktrees, root] }));
    expect(registered.map(p => p.id)).toEqual(["real"]);
    expect(registered[0]?.name).toBe("Real Project");
    const discovered = projectsForConfig(testConfig({ project_roots: [worktrees, root] }));
    expect(discovered.map(p => p.name)).toEqual(["real-project"]);
    expect(fs.realpathSync(discovered[0]!.path)).toBe(fs.realpathSync(repo));
  });

  it("discovers direct child Git repositories, including repos without commits", () => {
    const root = makeRoot();
    const sampleRepo = makeRepo(root, "sample-repo");
    fs.mkdirSync(path.join(root, "plain-folder"));
    makeRepo(path.join(root, "nested"), "too-deep");
    makeRepo(root, ".hidden-repo");

    expect(projectsForConfig(testConfig({ project_roots: [root] }))).toEqual([
      { id: "sample-repo", name: "sample-repo", path: sampleRepo, allowed_actions: [] },
    ]);
  });

  it("picks up repositories created after the daemon config was loaded", () => {
    const root = makeRoot();
    const config = testConfig({ project_roots: [root] });
    expect(projectsForConfig(config)).toEqual([]);

    const newRepo = makeRepo(root, "created-later");
    expect(projectsForConfig(config)).toEqual([
      { id: "created-later", name: "created-later", path: newRepo, allowed_actions: [] },
    ]);
  });

  it("preserves explicit project metadata and suppresses duplicate paths", () => {
    const root = makeRoot();
    const repo = makeRepo(root, "sample-app");
    const config = testConfig({
      project_roots: [root],
      projects: [{ id: "sample", name: "Sample App", path: repo }],
    });

    expect(projectsForConfig(config)).toEqual([
      { id: "sample", name: "Sample App", path: repo, allowed_actions: [] },
    ]);
  });

  it("uses stable suffixes when discovered project ids collide", () => {
    const firstRoot = makeRoot();
    const secondRoot = makeRoot();
    makeRepo(firstRoot, "shared");
    makeRepo(secondRoot, "shared");
    const config = testConfig({ project_roots: [firstRoot, secondRoot] });

    const first = projectsForConfig(config);
    const second = projectsForConfig(config);
    expect(first).toEqual(second);
    expect(first[0]?.id).toBe("shared");
    expect(first[1]?.id).toMatch(/^shared-[a-f0-9]{8}$/);
  });

  it("derives bounded ids from discovered repository names", () => {
    const root = makeRoot();
    makeRepo(root, "---Sample_APP!!");
    makeRepo(root, "___");
    const longName = `${"a".repeat(45)}-tail`;
    makeRepo(root, longName);

    const projects = projectsForConfig(testConfig({ project_roots: [root] }));
    expect(projects.find((project) => project.name === "---Sample_APP!!")?.id)
      .toBe("sample-app");
    expect(projects.find((project) => project.name === "___")?.id).toBe("project");
    expect(projects.find((project) => project.name === longName)?.id)
      .toBe("a".repeat(40));
  });

  it("ignores missing or unreadable roots without failing the registry", () => {
    const configured = {
      id: "known",
      name: "Known",
      path: "/tmp/known",
      allowed_actions: [],
    };
    const config = testConfig({
      project_roots: ["/definitely/missing/runtimebrief-root"],
      projects: [configured],
    });
    expect(projectsForConfig(config)).toEqual([configured]);
  });
});
