import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { configSchema, hashToken, type RuntimeBriefConfig } from "../src/config.js";
import type { ProjectConfig } from "../src/types.js";

/** Create an isolated temp dir, cleaned up by the caller (or left to the OS). */
export function tmpdir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `runtimebrief-${prefix}-`));
}

export const TEST_TOKEN = "test-token-abcdefghijklmnopqrstuvwxyz012345";

export function testConfig(overrides: Partial<RuntimeBriefConfig> = {}): RuntimeBriefConfig {
  return configSchema.parse({
    auth: { token_hash: hashToken(TEST_TOKEN) },
    ...overrides,
  });
}

export function authHeaders(token: string = TEST_TOKEN): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

/** Run git with argv array inside a fixture repo. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Fixture Author",
      GIT_AUTHOR_EMAIL: "fixture@example.com",
      GIT_COMMITTER_NAME: "Fixture Author",
      GIT_COMMITTER_EMAIL: "fixture@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

/** Build a small fixture git repo with a few commits; returns its path. */
export function makeFixtureRepo(opts: { dirty?: boolean } = {}): string {
  const dir = tmpdir("repo");
  git(dir, "init", "-b", "main");
  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture\n");
  fs.writeFileSync(path.join(dir, "app.ts"), "// TODO: implement\nexport const x = 1;\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "initial commit");
  fs.writeFileSync(path.join(dir, "app.ts"), "// TODO: implement\n// FIXME: broken\nexport const x = 2;\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "second commit: tweak app");
  git(dir, "checkout", "-b", "feature/test-branch");
  fs.writeFileSync(path.join(dir, "feature.ts"), "export const f = true;\n");
  git(dir, "add", ".");
  git(dir, "commit", "-m", "add feature module");
  if (opts.dirty) {
    fs.writeFileSync(path.join(dir, "wip.ts"), "// work in progress\n");
  }
  return dir;
}

export function fixtureProject(repoPath: string, id = "fixture"): ProjectConfig {
  return { id, name: `Fixture ${id}`, path: repoPath };
}
