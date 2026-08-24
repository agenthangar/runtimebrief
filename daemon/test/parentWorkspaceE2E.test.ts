import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { CodexSessionsAdapter } from "../src/adapters/codexSessions.js";
import { AnswerCache } from "../src/analyst/cache.js";
import { createAnalystService } from "../src/analyst/service.js";
import type {
  AnalystBackendEvent,
  AnalystBackendRunner,
} from "../src/analyst/codexCli.js";
import { authHeaders, git, testConfig, tmpdir } from "./helpers.js";

/**
 * HTTP-level regression for Codex desktop tasks opened at a parent workspace.
 * This intentionally uses ExampleProject rather than SampleSite so the behavior is
 * proven to be general and not a project-name special case.
 */
describe("parent-workspace Codex session e2e", () => {
  let app: FastifyInstance;
  let base: string;
  let workspace: string;
  let codexRoot: string;
  let cacheDir: string;
  let repo: string;
  let sibling: string;
  let analystPrompts: string[];

  beforeAll(async () => {
    workspace = tmpdir("parent-workspace");
    repo = path.join(workspace, "exampleproject");
    sibling = path.join(workspace, "reference-project");
    fs.mkdirSync(repo);
    fs.mkdirSync(sibling);
    for (const project of [repo, sibling]) {
      git(project, "init", "-b", "main");
      fs.writeFileSync(path.join(project, "README.md"), `# ${path.basename(project)}\n`);
      git(project, "add", ".");
      git(project, "commit", "-m", "initial commit");
    }

    codexRoot = tmpdir("parent-workspace-codex");
    const sessionsDir = path.join(codexRoot, "sessions", "2026", "07", "11");
    fs.mkdirSync(sessionsDir, { recursive: true });
    const rollout = path.join(
      sessionsDir,
      "rollout-2026-07-11T20-00-00-019f-parent-workspace.jsonl",
    );
    const line = (timestamp: string, type: string, payload: unknown) =>
      JSON.stringify({ timestamp, type, payload });
    fs.writeFileSync(
      rollout,
      [
        line("2026-07-11T20:00:00.000Z", "session_meta", {
          id: "019f-parent-workspace",
          cwd: workspace,
          source: "vscode",
        }),
        line("2026-07-11T20:00:01.000Z", "turn_context", {
          cwd: workspace,
          model: "gpt-5.6-sol",
        }),
        line("2026-07-11T20:00:02.000Z", "event_msg", {
          type: "user_message",
          message: "Redesign the ExampleProject homepage with a clearer visual hierarchy",
        }),
        line("2026-07-11T20:01:00.000Z", "event_msg", {
          type: "patch_apply_end",
          changes: { [path.join(repo, "app/page.tsx")]: { update: {} } },
        }),
        line("2026-07-11T20:02:00.000Z", "event_msg", {
          type: "agent_message",
          message: `The homepage redesign is in progress in ${path.join(repo, "app/page.tsx")}.`,
          phase: "commentary",
        }),
      ].join("\n"),
    );

    analystPrompts = [];
    const fakeRunner: AnalystBackendRunner = async function* (params) {
      analystPrompts.push(params.evidencePacket);
      const sawSession =
        params.evidencePacket.includes("Redesign the ExampleProject homepage") &&
        params.evidencePacket.includes("homepage redesign is in progress");
      const answer = sawSession
        ? "Now: The ExampleProject homepage redesign is in progress. [session-codex-019f-parent-workspace]"
        : "Now: Only git history was found. [git-working-tree]";
      yield {
        type: "result",
        costUsd: 0,
        finalText: answer,
        isError: false,
      } satisfies AnalystBackendEvent;
    };
    const config = testConfig({
      projects: [
        { id: "exampleproject", name: "ExampleProject", path: repo },
        { id: "reference-project", name: "Reference Project", path: sibling },
      ],
    });
    const adapters = [new FilesystemGitAdapter(), new CodexSessionsAdapter(codexRoot)];
    cacheDir = tmpdir("parent-workspace-cache");
    const analyst = createAnalystService(config, adapters, {
      runner: fakeRunner,
      cache: new AnswerCache(path.join(cacheDir, "cache.db")),
    });
    app = buildServer({ config, adapters, analyst });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (typeof address === "object" && address) base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await app.close();
    for (const dir of [workspace, codexRoot, cacheDir]) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("discovers, returns, and analyzes the correct parent-workspace session", async () => {
    const cardResponse = await fetch(`${base}/v1/projects/exampleproject`, {
      headers: authHeaders(),
    });
    expect(cardResponse.status).toBe(200);
    const card = await cardResponse.json();
    expect(card.sessions).toHaveLength(1);
    expect(card.sessions[0]).toMatchObject({
      source: "codex",
      summary: "Redesign the ExampleProject homepage with a clearer visual hierarchy",
    });

    const statusResponse = await fetch(`${base}/v1/projects/exampleproject/status`, {
      headers: authHeaders(),
    });
    expect(statusResponse.status).toBe(200);
    const status = await statusResponse.json();
    expect(status.answer).toContain("homepage redesign is in progress");
    expect(analystPrompts).toHaveLength(1);
    expect(analystPrompts[0]).toContain("Redesign the ExampleProject homepage");
    expect(analystPrompts[0]).toContain(path.join(repo, "app/page.tsx"));
  });

  it("does not leak the ExampleProject session into a sibling project", async () => {
    const response = await fetch(`${base}/v1/projects/reference-project`, {
      headers: authHeaders(),
    });
    expect(response.status).toBe(200);
    const card = await response.json();
    expect(card.sessions).toEqual([]);
  });
});
