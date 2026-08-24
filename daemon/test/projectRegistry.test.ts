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
