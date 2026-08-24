import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  CodexSessionsAdapter,
  sessionMatchesProject,
} from "../src/adapters/codexSessions.js";
import { tmpdir } from "./helpers.js";

function line(type: string, payload: unknown, timestamp: string): string {
  return JSON.stringify({ timestamp, type, payload });
}

function sessionMeta(options: {
  id: string;
  cwd: string;
  source: "exec" | "vscode";
  originator: "codex_exec" | "Codex Desktop";
  timestamp: string;
}): string {
  return line(
    "session_meta",
    {
      id: options.id,
      session_id: options.id,
      cwd: options.cwd,
      source: options.source,
      originator: options.originator,
      cli_version: "0.148.0-alpha.15",
      model_provider: "openai",
      timestamp: options.timestamp,
    },
    options.timestamp,
  );
}

function writeRollout(root: string, name: string, records: string[]): string {
  const day = path.join(root, "sessions", "2030", "01", "02");
  fs.mkdirSync(day, { recursive: true });
  const transcriptPath = path.join(day, `rollout-${name}.jsonl`);
  fs.writeFileSync(transcriptPath, records.join("\n"));
  return transcriptPath;
}

describe("Codex desktop and CLI rollout discovery", () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("reads desktop and CLI sessions from the same canonical rollout tree", async () => {
    const root = tmpdir("codex-shared-store");
    roots.push(root);
    const projectPath = path.join(root, "fixture-workspace", "sample-project");
    const desktopId = "11111111-1111-7111-8111-111111111111";
    const cliId = "22222222-2222-7222-8222-222222222222";

    writeRollout(root, `2030-01-02T10-00-00-${desktopId}`, [
      sessionMeta({
        id: desktopId,
        cwd: projectPath,
        source: "vscode",
        originator: "Codex Desktop",
        timestamp: "2030-01-02T10:00:00.000Z",
      }),
      line(
        "event_msg",
        { type: "user_message", message: "Update the sample project" },
        "2030-01-02T10:00:01.000Z",
      ),
      line(
        "event_msg",
        {
          type: "agent_message",
          message: "Desktop task complete.",
          phase: "final_answer",
        },
        "2030-01-02T10:01:00.000Z",
      ),
    ]);
    writeRollout(root, `2030-01-02T11-00-00-${cliId}`, [
      sessionMeta({
        id: cliId,
        cwd: projectPath,
        source: "exec",
        originator: "codex_exec",
        timestamp: "2030-01-02T11:00:00.000Z",
      }),
      line(
        "event_msg",
        { type: "user_message", message: "Test the sample project" },
        "2030-01-02T11:00:01.000Z",
      ),
      line(
        "event_msg",
        {
          type: "agent_message",
          message: "CLI task complete.",
          phase: "final_answer",
        },
        "2030-01-02T11:01:00.000Z",
      ),
    ]);

    const refs = await new CodexSessionsAdapter(root).transcriptPaths(
      { id: "sample-project", name: "Sample Project", path: projectPath },
      10,
    );

    expect(new Set(refs.map((ref) => ref.id))).toEqual(
      new Set([desktopId, cliId]),
    );
  });

  it("attributes a parent-workspace desktop session from a function-call workdir only", async () => {
    const root = tmpdir("codex-function-workdir");
    roots.push(root);
    const workspace = path.join(root, "fixture-workspace");
    const projectPath = path.join(workspace, "sample-project");
    const unrelatedPath = path.join(workspace, "reference-project");
    const id = "33333333-3333-7333-8333-333333333333";
    const transcriptPath = writeRollout(root, `2030-01-02T12-00-00-${id}`, [
      sessionMeta({
        id,
        cwd: workspace,
        source: "vscode",
        originator: "Codex Desktop",
        timestamp: "2030-01-02T12:00:00.000Z",
      }),
      line(
        "response_item",
        {
          type: "message",
          role: "developer",
          content: [
            {
              type: "input_text",
              text: `Background context: ${unrelatedPath}`,
            },
          ],
        },
        "2030-01-02T12:00:01.000Z",
      ),
      line(
        "response_item",
        {
          type: "function_call",
          name: "exec_command",
          call_id: "call_fixture_function",
          arguments: JSON.stringify({ cmd: "npm test", workdir: projectPath }),
        },
        "2030-01-02T12:00:02.000Z",
      ),
      line(
        "event_msg",
        {
          type: "agent_message",
          message: "Checks complete.",
          phase: "final_answer",
        },
        "2030-01-02T12:01:00.000Z",
      ),
    ]);

    const [projectMatch, developerContextMatch] = await Promise.all([
      sessionMatchesProject(transcriptPath, workspace, projectPath),
      sessionMatchesProject(transcriptPath, workspace, unrelatedPath),
    ]);
    expect({ projectMatch, developerContextMatch }).toEqual({
      projectMatch: true,
      developerContextMatch: false,
    });
  });

  it("attributes a parent-workspace desktop session from a custom-tool workdir only", async () => {
    const root = tmpdir("codex-custom-tool-workdir");
    roots.push(root);
    const workspace = path.join(root, "fixture-workspace");
    const projectPath = path.join(workspace, "sample-project");
    const id = "44444444-4444-7444-8444-444444444444";
    const transcriptPath = writeRollout(root, `2030-01-02T13-00-00-${id}`, [
      sessionMeta({
        id,
        cwd: workspace,
        source: "vscode",
        originator: "Codex Desktop",
        timestamp: "2030-01-02T13:00:00.000Z",
      }),
      line(
        "response_item",
        {
          type: "custom_tool_call",
          name: "exec",
          call_id: "call_fixture_custom",
          input: `const result = await tools.exec_command(${JSON.stringify({
            cmd: "npm test",
            workdir: projectPath,
          })});`,
        },
        "2030-01-02T13:00:01.000Z",
      ),
      line(
        "event_msg",
        {
          type: "agent_message",
          message: "Checks complete.",
          phase: "final_answer",
        },
        "2030-01-02T13:01:00.000Z",
      ),
    ]);

    await expect(
      sessionMatchesProject(transcriptPath, workspace, projectPath),
    ).resolves.toBe(true);
  });

  it("does not treat arbitrary nested tool strings as project paths", async () => {
    const root = tmpdir("codex-tool-string-scope");
    roots.push(root);
    const workspace = path.join(root, "fixture-workspace");
    const projectPath = path.join(workspace, "sample-project");
    const id = "55555555-5555-7555-8555-555555555555";
    const transcriptPath = writeRollout(root, `2030-01-02T14-00-00-${id}`, [
      sessionMeta({
        id,
        cwd: workspace,
        source: "vscode",
        originator: "Codex Desktop",
        timestamp: "2030-01-02T14:00:00.000Z",
      }),
      line(
        "response_item",
        {
          type: "function_call",
          name: "exec_command",
          call_id: "call_fixture_nested_text",
          arguments: JSON.stringify({
            cmd: "printf fixture",
            metadata: {
              description: `Documentation example only: ${path.join(projectPath, "README.md")}`,
              prompt: `Do not infer a workspace from ${projectPath}`,
            },
            path: {
              documentation: `Invalid path-object example: ${projectPath}`,
            },
          }),
        },
        "2030-01-02T14:00:01.000Z",
      ),
      line(
        "response_item",
        {
          type: "custom_tool_call",
          name: "exec",
          call_id: "call_fixture_freeform_text",
          input:
            `const documentationExample = ${JSON.stringify(path.join(projectPath, "README.md"))};\n` +
            `const embeddedObjectExample = \`Example only: { path: "${projectPath}" }\`;\n` +
            `const result = await tools.exec_command({ cmd: "printf fixture" });`,
        },
        "2030-01-02T14:00:02.000Z",
      ),
    ]);

    await expect(
      sessionMatchesProject(transcriptPath, workspace, projectPath),
    ).resolves.toBe(false);
  });

  it("recognizes safe nested path keys and paths in scoped command fields", async () => {
    const root = tmpdir("codex-safe-tool-paths");
    roots.push(root);
    const workspace = path.join(root, "fixture-workspace");
    const pathKeyProject = path.join(workspace, "path-key-project");
    const commandProject = path.join(workspace, "command-project");
    const pathKeyId = "66666666-6666-7666-8666-666666666666";
    const commandId = "77777777-7777-7777-8777-777777777777";
    const pathKeyTranscript = writeRollout(
      root,
      `2030-01-02T15-00-00-${pathKeyId}`,
      [
        sessionMeta({
          id: pathKeyId,
          cwd: workspace,
          source: "vscode",
          originator: "Codex Desktop",
          timestamp: "2030-01-02T15:00:00.000Z",
        }),
        line(
          "response_item",
          {
            type: "function_call",
            name: "read_file",
            call_id: "call_fixture_path_key",
            arguments: JSON.stringify({
              options: {
                file_path: path.join(pathKeyProject, "Sources", "Feature.swift"),
              },
            }),
          },
          "2030-01-02T15:00:01.000Z",
        ),
      ],
    );
    const commandTranscript = writeRollout(
      root,
      `2030-01-02T16-00-00-${commandId}`,
      [
        sessionMeta({
          id: commandId,
          cwd: workspace,
          source: "vscode",
          originator: "Codex Desktop",
          timestamp: "2030-01-02T16:00:00.000Z",
        }),
        line(
          "response_item",
          {
            type: "function_call",
            name: "exec_command",
            call_id: "call_fixture_command_path",
            arguments: JSON.stringify({
              cmd: `git -C ${JSON.stringify(commandProject)} status`,
              metadata: {
                description: `Ignore ${pathKeyProject} because it is not in a command/path field`,
              },
            }),
          },
          "2030-01-02T16:00:01.000Z",
        ),
      ],
    );

    await expect(
      Promise.all([
        sessionMatchesProject(pathKeyTranscript, workspace, pathKeyProject),
        sessionMatchesProject(commandTranscript, workspace, commandProject),
        sessionMatchesProject(commandTranscript, workspace, pathKeyProject),
      ]),
    ).resolves.toEqual([true, true, false]);
  });

  it("does not scan command-named fields for non-command tools", async () => {
    const root = tmpdir("codex-non-command-tool");
    roots.push(root);
    const workspace = path.join(root, "fixture-workspace");
    const projectPath = path.join(workspace, "sample-project");
    const id = "88888888-8888-7888-8888-888888888888";
    const transcriptPath = writeRollout(root, `2030-01-02T17-00-00-${id}`, [
      sessionMeta({
        id,
        cwd: workspace,
        source: "vscode",
        originator: "Codex Desktop",
        timestamp: "2030-01-02T17:00:00.000Z",
      }),
      line(
        "response_item",
        {
          type: "function_call",
          name: "search_docs",
          call_id: "call_fixture_non_command",
          arguments: JSON.stringify({
            command: `cat ${path.join(projectPath, "README.md")}`,
          }),
        },
        "2030-01-02T17:00:01.000Z",
      ),
    ]);

    await expect(
      sessionMatchesProject(transcriptPath, workspace, projectPath),
    ).resolves.toBe(false);
  });
});
