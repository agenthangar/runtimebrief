import { afterAll, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FilesystemGitAdapter } from "../src/adapters/filesystemGit.js";
import { DecisionStore } from "../src/decisions/store.js";
import { createRuntimeBriefMcpServer } from "../src/mcp/server.js";
import type { RuntimeAdapter } from "../src/types.js";
import { git, makeFixtureRepo, testConfig, tmpdir } from "./helpers.js";

describe("RuntimeBrief MCP server", () => {
  let repo: string;
  let dir: string;
  let trustedRoot: string;
  let decisions: DecisionStore;
  let client: Client;
  let server: ReturnType<typeof createRuntimeBriefMcpServer>;

  beforeAll(async () => {
    repo = makeFixtureRepo({ dirty: true });
    dir = tmpdir("mcp");
    trustedRoot = tmpdir("mcp-trusted-root");
    const now = () => new Date("2026-07-31T12:00:00.000Z");
    decisions = new DecisionStore(
      path.join(dir, "decisions.db"),
      now,
      () => "decision-1",
    );
    decisions.propose({
      projectId: "fixture",
      kind: "run-tests",
      description: "Re-run release tests",
      params: { suite: "release" },
      expiresAt: new Date("2026-07-31T13:00:00.000Z"),
    });
    const config = testConfig({
      project_roots: [trustedRoot],
      projects: [
        {
          id: "fixture",
          name: "Synthetic Plugin Tracker",
          path: repo,
          allowed_actions: ["run-tests"],
        },
        {
          id: "duplicate-one",
          name: "Shared Display Name",
          path: repo,
        },
        {
          id: "duplicate-two",
          name: "Shared Display Name",
          path: repo,
        },
      ],
    });
    const waitingSessions: RuntimeAdapter = {
      id: "fixture-sessions",
      discover: async (project) => project.id === "fixture",
      recentActivity: async () => [],
      transcriptPaths: async (project) =>
        project.id === "fixture"
          ? [
              {
                source: "codex",
                id: "waiting-session",
                path: "/private/not-returned.jsonl",
                startedAt: new Date("2026-07-31T11:59:00.000Z"),
                state: "waiting",
                summary: "Choose the release target",
              },
            ]
          : [],
    };
    server = createRuntimeBriefMcpServer({
      config,
      adapters: [new FilesystemGitAdapter(), waitingSessions],
      decisions,
      now,
    });
    client = new Client({ name: "runtimebrief-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  });

  afterAll(async () => {
    await client.close();
    await server.close();
    decisions.close();
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(trustedRoot, { recursive: true, force: true });
  });

  it("advertises the intended tools and accurate safety annotations", async () => {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual([
      "list_attention",
      "get_project_evidence",
      "list_pending_decisions",
      "resolve_decision",
    ]);
    expect(tools.tools.find((tool) => tool.name === "list_attention")?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(
      tools.tools.find((tool) => tool.name === "list_pending_decisions")?.annotations,
    ).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
    expect(tools.tools.find((tool) => tool.name === "resolve_decision")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    });
    for (const toolName of [
      "list_attention",
      "get_project_evidence",
      "list_pending_decisions",
    ]) {
      const tool = tools.tools.find((candidate) => candidate.name === toolName);
      const inputSchema = tool?.inputSchema as
        | { properties?: { project_id?: { description?: string } } }
        | undefined;
      expect(inputSchema?.properties?.project_id?.description).toContain(
        "internal project ID or unique exact project display name",
      );
    }
  });

  it("lists project attention and pending decisions together", async () => {
    const result = await client.callTool({
      name: "list_attention",
      arguments: { limit: 10, include_pending_decisions: true },
    });
    expect(result.isError).not.toBe(true);
    const body = result.structuredContent as {
      total: number;
      items: Array<{ kind: string; projectId: string; evidenceIds: string[] }>;
    };
    expect(body.total).toBe(2);
    expect(body.items.map((item) => item.kind)).toEqual([
      "pending-decision",
      "project-attention",
    ]);
    expect(body.items[1]).toMatchObject({
      projectId: "fixture",
      evidenceIds: ["session-codex-waiting-session"],
    });
    expect(JSON.stringify(body.items)).not.toContain("uncommitted file");
  });

  it("returns requested evidence and names unknown evidence", async () => {
    const result = await client.callTool({
      name: "get_project_evidence",
      arguments: {
        project_id: "fixture",
        evidence_ids: ["git-working-tree", "not-real"],
      },
    });
    const body = result.structuredContent as {
      evidence: Array<{ id: string; kind: string }>;
      unknownEvidenceIds: string[];
    };
    expect(body.evidence).toEqual([
      expect.objectContaining({ id: "git-working-tree", kind: "working-tree" }),
    ]);
    expect(body.unknownEvidenceIds).toEqual(["not-real"]);
    expect(JSON.stringify(result.content)).toContain("1 evidence record supports");
  });

  it("accepts a unique exact display name for every project-scoped read tool", async () => {
    const attention = await client.callTool({
      name: "list_attention",
      arguments: {
        project_id: "sYnThEtIc PlUgIn TrAcKeR",
        limit: 10,
        include_pending_decisions: true,
      },
    });
    expect(attention.isError).not.toBe(true);
    const attentionBody = attention.structuredContent as {
      total: number;
      items: Array<{ projectId: string }>;
    };
    expect(attentionBody.total).toBe(2);
    expect(attentionBody.items).toEqual([
      expect.objectContaining({ projectId: "fixture" }),
      expect.objectContaining({ projectId: "fixture" }),
    ]);

    const evidence = await client.callTool({
      name: "get_project_evidence",
      arguments: {
        project_id: "SYNTHETIC PLUGIN TRACKER",
        evidence_ids: ["git-working-tree"],
      },
    });
    expect(evidence.isError).not.toBe(true);
    expect(evidence.structuredContent).toMatchObject({
      projectId: "fixture",
      projectName: "Synthetic Plugin Tracker",
    });

    const pending = await client.callTool({
      name: "list_pending_decisions",
      arguments: { project_id: "Synthetic Plugin Tracker" },
    });
    expect(pending.isError).not.toBe(true);
    expect(pending.structuredContent).toMatchObject({
      total: 1,
      decisions: [expect.objectContaining({ projectId: "fixture" })],
    });
  });

  it("accepts a case-insensitive internal project ID", async () => {
    const result = await client.callTool({
      name: "get_project_evidence",
      arguments: { project_id: "FIXTURE" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({ projectId: "fixture" });
  });

  it("returns a clear error when an exact display name is ambiguous", async () => {
    const result = await client.callTool({
      name: "get_project_evidence",
      arguments: { project_id: "shared display name" },
    });
    expect(result.isError).toBe(true);
    const message = (result.content[0] as { text: string }).text;
    expect(message).toContain(
      'Ambiguous RuntimeBrief project name "shared display name"',
    );
    expect(message).toContain("duplicate-one");
    expect(message).toContain("duplicate-two");
  });

  it("records an idempotent decision without executing the action", async () => {
    const listed = await client.callTool({
      name: "list_pending_decisions",
      arguments: { project_id: "fixture" },
    });
    expect((listed.structuredContent as { total: number }).total).toBe(1);

    const resolved = await client.callTool({
      name: "resolve_decision",
      arguments: {
        decision_id: "decision-1",
        resolution: "approve",
        idempotency_key: "voice-confirmation-1",
      },
    });
    expect(resolved.structuredContent).toMatchObject({
      decision: {
        id: "decision-1",
        status: "approved",
        execution: "not-supported",
      },
    });
    expect(JSON.stringify(resolved.content)).toContain("No action was executed");

    const retried = await client.callTool({
      name: "resolve_decision",
      arguments: {
        decision_id: "decision-1",
        resolution: "approve",
        idempotency_key: "voice-confirmation-1",
      },
    });
    expect(retried.isError).not.toBe(true);

    const pending = await client.callTool({
      name: "list_pending_decisions",
      arguments: {},
    });
    expect((pending.structuredContent as { total: number }).total).toBe(0);
  });

  it("returns a model-readable error for an unknown project", async () => {
    const result = await client.callTool({
      name: "get_project_evidence",
      arguments: { project_id: "unknown" },
    });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain("Unknown RuntimeBrief project");
  });

  it("discovers a new repository under a trusted root without restarting", async () => {
    const discovered = path.join(trustedRoot, "new-fixture");
    fs.mkdirSync(discovered);
    git(discovered, "init", "-b", "main");
    fs.writeFileSync(path.join(discovered, "README.md"), "# New fixture\n");
    git(discovered, "add", ".");
    git(discovered, "commit", "-m", "initial fixture commit");

    const result = await client.callTool({
      name: "get_project_evidence",
      arguments: { project_id: "new-fixture" },
    });
    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toMatchObject({
      projectId: "new-fixture",
      projectName: "new-fixture",
    });
  });
});
