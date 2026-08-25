import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertSupportedCodexCliVersion,
  buildCodexAppServerArgs,
  buildCodexCliEnvironment,
  createCodexCliRunner,
  EXPECTED_CODEX_FEATURES,
  RUNTIMEBRIEF_ANALYST_JSON_SCHEMA,
  type AnalystBackendEvent,
  type AnalystBackendRunner,
  type AnalystRunParams,
  type CodexChildProcess,
} from "../src/analyst/codexCli.js";
import { VERSION } from "../src/version.js";

const PERMISSION_PROFILE = "runtimebrief-analyst-fixture";
const CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/";
const ALLOWED_ENABLED_FEATURES = new Set([
  "resize_all_images",
  "terminal_resize_reflow",
  "tool_search_always_defer_mcp_tools",
  "tui_app_server",
]);
const CRITICAL_FALSE_FEATURES = [
  "apps",
  "auth_elicitation",
  "browser_use",
  "browser_use_external",
  "code_mode_host",
  "computer_use",
  "goals",
  "hooks",
  "image_generation",
  "in_app_browser",
  "memories",
  "multi_agent",
  "network_proxy",
  "plugins",
  "remote_control",
  "remote_plugin",
  "respect_system_proxy",
  "shell_tool",
  "skill_mcp_dependency_install",
  "tool_call_mcp_elicitation",
  "tool_suggest",
  "unified_exec",
  "workspace_dependencies",
] as const;

class FakeCodexChild extends EventEmitter implements CodexChildProcess {
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killSignals: Array<NodeJS.Signals | number> = [];
  onKill: ((signal: NodeJS.Signals | number) => void) | undefined;

  kill(signal: NodeJS.Signals | number = "SIGTERM"): boolean {
    this.killSignals.push(signal);
    this.onKill?.(signal);
    return true;
  }

  close(code = 0, signal: NodeJS.Signals | null = null): void {
    this.emit("close", code, signal);
  }
}

interface ConfigResultFixture {
  config: {
    model_provider: string;
    forced_login_method: string;
    approval_policy: string;
    default_permissions: string;
    openai_base_url: string | null;
    chatgpt_base_url: string | null;
    cli_auth_credentials_store: string;
    model_providers: Record<string, unknown>;
    mcp_servers: Record<string, unknown>;
    notify: null;
    hooks: null;
    model_catalog_json: null;
    experimental_thread_config_endpoint: null;
    oss_provider: null;
    debug: null;
    shell_environment_policy: { inherit: string };
    skills: { include_instructions: boolean };
    analytics: { enabled: boolean };
    feedback: { enabled: boolean };
    history: { persistence: string };
    otel: {
      exporter: string;
      metrics_exporter: string;
      trace_exporter: string;
      log_user_prompt: boolean;
    };
    web_search: string;
    tools: { web_search: null };
    allow_login_shell: boolean;
    check_for_update_on_startup: boolean;
    include_apps_instructions: boolean;
    include_collaboration_mode_instructions: boolean;
    include_environment_context: boolean;
    include_permissions_instructions: boolean;
    sqlite_home: string;
    features: Record<string, boolean>;
    permissions: Record<
      string,
      {
        description: string;
        extends: null;
        filesystem: {
          ":minimal": string;
          ":workspace_roots": Record<string, string>;
          glob_scan_max_depth: null;
        };
        network: Record<string, boolean | null>;
        workspace_roots: null;
      }
    >;
  };
  origins: Record<string, unknown>;
  layers: Array<{
    name: { type: string; file?: string; profile?: null };
    version: string;
    config: Record<string, unknown>;
  }>;
  workspace: string;
}

interface ThreadResultFixture {
  thread: {
    id: string;
    sessionId: string;
    ephemeral: true;
    path: null;
    cwd: string;
    cliVersion: string;
    modelProvider: string;
    turns: unknown[];
  };
  model: string;
  modelProvider: string;
  cwd: string;
  runtimeWorkspaceRoots: string[];
  instructionSources: unknown[];
  approvalPolicy: string;
  approvalsReviewer: string;
  sandbox: { type: string; networkAccess?: boolean };
  activePermissionProfile: { id: string; extends: null };
  multiAgentMode: string;
}

interface FeatureFixture {
  name: string;
  stage:
    | "beta"
    | "underDevelopment"
    | "stable"
    | "deprecated"
    | "removed";
  displayName: string | null;
  description: string | null;
  announcement: string | null;
  enabled: boolean;
  defaultEnabled: boolean;
}

interface FeatureResultFixture {
  data: FeatureFixture[];
  nextCursor: null;
}

interface HooksResultFixture {
  data: Array<{
    cwd: string;
    hooks: unknown[];
    warnings: unknown[];
    errors: unknown[];
  }>;
}

interface McpResultFixture {
  data: unknown[];
  nextCursor: null;
}

interface TokenUsageFixture {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

const createdRoots: string[] = [];

afterEach(() => {
  for (const root of createdRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function testRoot(): string {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "runtimebrief-codex-cli-test-"),
  );
  createdRoots.push(root);
  return fs.realpathSync(root);
}

function params(signal = new AbortController().signal): AnalystRunParams {
  return {
    systemPrompt: "You are the RuntimeBrief project-state analyst.",
    evidencePacket:
      'Question: "Status?"\nProject: "Fictional Tracker"\nClean [git-working-tree]',
    model: "gpt-5.6-sol",
    signal,
  };
}

async function drain(runner: AnalystBackendRunner, runParams = params()) {
  const events: AnalystBackendEvent[] = [];
  for await (const event of runner(runParams)) events.push(event);
  return events;
}

function createTestCodexCliRunner(
  root: string,
  options: Parameters<typeof createCodexCliRunner>[0] = {},
) {
  return createCodexCliRunner({
    tempRoot: root,
    env: { HOME: path.join(root, "missing-home"), PATH: "/usr/bin:/bin" },
    versionVerifier: async () => undefined,
    managedConfigVerifier: async () => undefined,
    permissionProfileFactory: () => PERMISSION_PROFILE,
    ...options,
  });
}

function writeServer(child: FakeCodexChild, message: unknown): void {
  child.stdout.write(`${JSON.stringify(message)}\n`);
}

function sessionFlagOrigin() {
  return { name: { type: "sessionFlags" }, version: "fixture" };
}

function safeConfigResult(
  workspace: string,
  codexHome: string,
): ConfigResultFixture {
  const origins: Record<string, unknown> = {};
  for (const key of [
    "model_provider",
    "openai_base_url",
    "chatgpt_base_url",
    "cli_auth_credentials_store",
    "forced_login_method",
    "approval_policy",
    "default_permissions",
    "shell_environment_policy.inherit",
    "skills.include_instructions",
    "analytics.enabled",
    "feedback.enabled",
    "history.persistence",
    "otel.exporter",
    "otel.metrics_exporter",
    "otel.trace_exporter",
    "otel.log_user_prompt",
    "web_search",
    "tools.web_search",
    "allow_login_shell",
    "check_for_update_on_startup",
    "include_apps_instructions",
    "include_collaboration_mode_instructions",
    "include_environment_context",
    "include_permissions_instructions",
    "sqlite_home",
    `permissions.${PERMISSION_PROFILE}.description`,
    `permissions.${PERMISSION_PROFILE}.filesystem.:minimal`,
    `permissions.${PERMISSION_PROFILE}.filesystem.:workspace_roots..`,
    `permissions.${PERMISSION_PROFILE}.filesystem.:workspace_roots.codex-home`,
    `permissions.${PERMISSION_PROFILE}.filesystem.:workspace_roots.user-home`,
    `permissions.${PERMISSION_PROFILE}.network.enabled`,
    ...CRITICAL_FALSE_FEATURES.map((feature) => `features.${feature}`),
  ]) {
    origins[key] = sessionFlagOrigin();
  }

  return {
    config: {
      model_provider: "openai",
      forced_login_method: "chatgpt",
      approval_policy: "never",
      default_permissions: PERMISSION_PROFILE,
      openai_base_url: CHATGPT_CODEX_BASE_URL,
      chatgpt_base_url: CHATGPT_BASE_URL,
      cli_auth_credentials_store: "file",
      model_providers: {},
      mcp_servers: {},
      notify: null,
      hooks: null,
      model_catalog_json: null,
      experimental_thread_config_endpoint: null,
      oss_provider: null,
      debug: null,
      shell_environment_policy: { inherit: "none" },
      skills: { include_instructions: false },
      analytics: { enabled: false },
      feedback: { enabled: false },
      history: { persistence: "none" },
      otel: {
        exporter: "none",
        metrics_exporter: "none",
        trace_exporter: "none",
        log_user_prompt: false,
      },
      web_search: "disabled",
      tools: { web_search: null },
      allow_login_shell: false,
      check_for_update_on_startup: false,
      include_apps_instructions: false,
      include_collaboration_mode_instructions: false,
      include_environment_context: false,
      include_permissions_instructions: false,
      sqlite_home: workspace,
      features: Object.fromEntries(
        EXPECTED_CODEX_FEATURES.map((name) => [name, false]),
      ),
      permissions: {
        [PERMISSION_PROFILE]: {
          description: "RuntimeBrief evidence only",
          extends: null,
          filesystem: {
            ":minimal": "deny",
            ":workspace_roots": {
              ".": "read",
              "codex-home": "deny",
              "user-home": "deny",
            },
            glob_scan_max_depth: null,
          },
          network: {
            enabled: false,
            proxy_url: null,
            enable_socks5: null,
            socks_url: null,
            enable_socks5_udp: null,
            allow_upstream_proxy: null,
            dangerously_allow_non_loopback_proxy: null,
            dangerously_allow_all_unix_sockets: null,
            mode: null,
            domains: null,
            unix_sockets: null,
            allow_local_binding: null,
            mitm: null,
          },
          workspace_roots: null,
        },
      },
    },
    origins,
    layers: [
      { name: { type: "sessionFlags" }, version: "fixture", config: {} },
      {
        name: {
          type: "user",
          file: path.join(codexHome, "config.toml"),
          profile: null,
        },
        version: "empty",
        config: {},
      },
      {
        name: { type: "system", file: "/etc/codex/config.toml" },
        version: "empty",
        config: {},
      },
    ],
    workspace,
  };
}

function safeThreadResult(workspace: string, model: string): ThreadResultFixture {
  const threadId = "thread-fixture";
  return {
    thread: {
      id: threadId,
      sessionId: threadId,
      ephemeral: true,
      path: null,
      cwd: workspace,
      cliVersion: "0.144.1",
      modelProvider: "openai",
      turns: [],
    },
    model,
    modelProvider: "openai",
    cwd: workspace,
    runtimeWorkspaceRoots: [workspace],
    instructionSources: [],
    approvalPolicy: "never",
    approvalsReviewer: "user",
    sandbox: { type: "readOnly", networkAccess: false },
    activePermissionProfile: { id: PERMISSION_PROFILE, extends: null },
    multiAgentMode: "explicitRequestOnly",
  };
}

function safeFeatureResult(): FeatureResultFixture {
  return {
    data: EXPECTED_CODEX_FEATURES.map((name) => {
      const enabled = ALLOWED_ENABLED_FEATURES.has(name);
      return {
        name,
        stage: enabled ? "removed" : "stable",
        displayName: null,
        description: null,
        announcement: null,
        enabled,
        defaultEnabled: enabled,
      };
    }),
    nextCursor: null,
  };
}

interface ProtocolOptions {
  accountType?: "chatgpt" | "apiKey";
  legacyAuthMethod?: string;
  mutateConfig?: (result: ConfigResultFixture) => void;
  requirements?: unknown;
  mutateThread?: (result: ThreadResultFixture) => void;
  mutateFeatures?: (result: FeatureResultFixture) => void;
  mutateHooks?: (result: HooksResultFixture) => void;
  mutateMcp?: (result: McpResultFixture) => void;
  pauseBeforeMcpAttestation?: (release: () => void) => void;
  toolItemType?: string;
  orphanCompletedItem?: boolean;
  unknownNotification?: string;
  finalText?: string;
  tokenUsages?: TokenUsageFixture[];
  pauseBeforeCompletion?: (release: () => void) => void;
}

function wireSuccessfulProtocol(
  child: FakeCodexChild,
  workspace: string,
  codexHome: string,
  received: Array<Record<string, unknown>>,
  options: ProtocolOptions = {},
): void {
  let inputBuffer = "";
  const model = params().model;
  const threadId = "thread-fixture";
  const turnId = "turn-fixture";
  const userMessageId = "user-message-fixture";
  const reasoningId = "reasoning-fixture";
  const agentMessageId = "agent-message-fixture";

  child.onKill = (signal) =>
    queueMicrotask(() => child.close(null as never, signal as NodeJS.Signals));
  child.stdin.on("data", (chunk: Buffer) => {
    inputBuffer += chunk.toString("utf8");
    for (;;) {
      const newline = inputBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = inputBuffer.slice(0, newline);
      inputBuffer = inputBuffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line) as Record<string, unknown>;
      received.push(message);
      queueMicrotask(() => {
        const id = message.id;
        if (id === 0) {
          writeServer(child, {
            id: 0,
            result: {
              userAgent:
                `runtimebrief/0.144.1 (macos; arm64) (runtimebrief; ${VERSION})`,
              codexHome,
              platformFamily: "unix",
              platformOs: "macos",
            },
          });
        } else if (id === 1) {
          writeServer(child, {
            id: 1,
            result: {
              account:
                options.accountType === "apiKey"
                  ? { type: "apiKey", secret: "must-not-surface" }
                  : {
                      type: "chatgpt",
                      email: "private-fixture@example.invalid",
                      planType: "pro",
                    },
              requiresOpenaiAuth: true,
            },
          });
        } else if (id === 2) {
          writeServer(child, {
            id: 2,
            result: {
              authMethod: options.legacyAuthMethod ?? "chatgpt",
              authToken: null,
              requiresOpenaiAuth: true,
            },
          });
        } else if (id === 3) {
          const result = safeConfigResult(workspace, codexHome);
          options.mutateConfig?.(result);
          writeServer(child, { id: 3, result });
        } else if (id === 4) {
          writeServer(child, {
            id: 4,
            result: { requirements: options.requirements ?? null },
          });
        } else if (id === 5) {
          const result = safeThreadResult(workspace, model);
          options.mutateThread?.(result);
          writeServer(child, { id: 5, result });
          writeServer(child, {
            method: "thread/started",
            params: { thread: { id: threadId } },
          });
        } else if (id === 6) {
          const result = safeFeatureResult();
          options.mutateFeatures?.(result);
          writeServer(child, { id: 6, result });
        } else if (id === 7) {
          const result: HooksResultFixture = {
            data: [{ cwd: workspace, hooks: [], warnings: [], errors: [] }],
          };
          options.mutateHooks?.(result);
          writeServer(child, { id: 7, result });
        } else if (id === 8) {
          const respond = () => {
            const result: McpResultFixture = { data: [], nextCursor: null };
            options.mutateMcp?.(result);
            writeServer(child, { id: 8, result });
          };
          if (options.pauseBeforeMcpAttestation) {
            options.pauseBeforeMcpAttestation(respond);
          } else {
            respond();
          }
        } else if (id === 9) {
          writeServer(child, {
            id: 9,
            result: { turn: { id: turnId, status: "inProgress" } },
          });
          writeServer(child, {
            method: "turn/started",
            params: { threadId, turn: { id: turnId, status: "inProgress" } },
          });
          for (const item of [
            { id: userMessageId, type: "userMessage" },
            { id: reasoningId, type: "reasoning" },
          ]) {
            writeServer(child, {
              method: "item/started",
              params: { threadId, turnId, item },
            });
            writeServer(child, {
              method: "item/completed",
              params: { threadId, turnId, item },
            });
          }
          if (options.orphanCompletedItem) {
            writeServer(child, {
              method: "item/completed",
              params: {
                threadId,
                turnId,
                item: { id: "orphan-fixture", type: "reasoning" },
              },
            });
            return;
          }
          if (options.toolItemType) {
            writeServer(child, {
              method: "item/started",
              params: {
                threadId,
                turnId,
                item: { id: "forbidden-fixture", type: options.toolItemType },
              },
            });
            return;
          }
          if (options.unknownNotification) {
            writeServer(child, {
              method: options.unknownNotification,
              params: { threadId, turnId },
            });
            return;
          }
          writeServer(child, {
            method: "item/started",
            params: {
              threadId,
              turnId,
              item: { id: agentMessageId, type: "agentMessage", text: "" },
            },
          });
          writeServer(child, {
            method: "item/completed",
            params: {
              threadId,
              turnId,
              item: {
                id: agentMessageId,
                type: "agentMessage",
                phase: "final_answer",
                text:
                  options.finalText ??
                  JSON.stringify({ answer: "Done: Clean. [git-working-tree]" }),
              },
            },
          });
          for (const total of
            options.tokenUsages ?? [
              { inputTokens: 100, cachedInputTokens: 10, outputTokens: 5 },
              { inputTokens: 321, cachedInputTokens: 21, outputTokens: 17 },
            ]) {
            writeServer(child, {
              method: "thread/tokenUsage/updated",
              params: { threadId, turnId, tokenUsage: { total } },
            });
          }
          const complete = () =>
            writeServer(child, {
              method: "turn/completed",
              params: {
                threadId,
                turn: { id: turnId, status: "completed", error: null },
              },
            });
          if (options.pauseBeforeCompletion) {
            options.pauseBeforeCompletion(complete);
          } else {
            complete();
          }
        }
      });
    }
  });
  child.stdin.on("finish", () => queueMicrotask(() => child.close(0, null)));
}

describe("Codex CLI same-process analyst boundary", () => {
  it("attests every boundary on one process before sending evidence", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const received: Array<Record<string, unknown>> = [];
    let captured:
      | {
          command: string;
          args: string[];
          cwd: string;
          env: NodeJS.ProcessEnv;
          detached: boolean;
          workspaceMode: number;
          codexHomeMode: number;
          userHomeMode: number;
        }
      | undefined;
    const runner = createTestCodexCliRunner(root, {
      codexPath: "/usr/local/bin/codex-fixture",
      env: {
        HOME: "/Users/fixture",
        PATH: "/usr/local/bin:/usr/bin:/bin",
        CODEX_HOME: "/Users/fixture/.codex",
        LANG: "en_US.UTF-8",
        OPENAI_API_KEY: "must-not-cross-boundary",
        CODEX_API_KEY: "must-not-cross-boundary",
        CODEX_ACCESS_TOKEN: "must-not-cross-boundary",
        ANTHROPIC_API_KEY: "must-not-cross-boundary",
        RUNTIMEBRIEF_TOKEN: "must-not-cross-boundary",
        SSH_AUTH_SOCK: "/private/ssh-agent",
      },
      spawnImpl: (command, args, options) => {
        captured = {
          command,
          args: [...args],
          cwd: options.cwd,
          env: { ...options.env },
          detached: options.detached,
          workspaceMode: fs.statSync(options.cwd).mode & 0o777,
          codexHomeMode: fs.statSync(options.env.CODEX_HOME!).mode & 0o777,
          userHomeMode: fs.statSync(options.env.HOME!).mode & 0o777,
        };
        wireSuccessfulProtocol(
          child,
          options.cwd,
          options.env.CODEX_HOME!,
          received,
        );
        return child;
      },
    });

    const events = await drain(runner);
    expect(captured).toBeDefined();
    const invocation = captured!;
    expect(invocation.command).toBe("/usr/local/bin/codex-fixture");
    expect(invocation.args.slice(0, 3)).toEqual([
      "app-server",
      "--stdio",
      "--strict-config",
    ]);
    expect(invocation.args).toEqual(
      buildCodexAppServerArgs(invocation.cwd, PERMISSION_PROFILE),
    );
    expect(invocation.args).toContain(
      `openai_base_url="${CHATGPT_CODEX_BASE_URL}"`,
    );
    expect(invocation.args).toContain(
      `chatgpt_base_url="${CHATGPT_BASE_URL}"`,
    );
    expect(invocation.args).toContain('cli_auth_credentials_store="file"');
    expect(invocation.args.join(" ")).not.toContain(params().evidencePacket);
    expect(invocation.args.join(" ")).not.toContain(params().systemPrompt);
    expect(invocation.args.join(" ")).not.toContain(params().model);
    expect(invocation.detached).toBe(process.platform !== "win32");
    expect(invocation.workspaceMode).toBe(0o700);
    expect(invocation.codexHomeMode).toBe(0o700);
    expect(invocation.userHomeMode).toBe(0o700);
    expect(invocation.env).toEqual({
      HOME: path.join(invocation.cwd, "user-home"),
      PATH: "/usr/local/bin:/usr/bin:/bin",
      USERPROFILE: path.join(invocation.cwd, "user-home"),
      CODEX_HOME: path.join(invocation.cwd, "codex-home"),
      TMPDIR: path.join(invocation.cwd, "process-tmp"),
      TMP: path.join(invocation.cwd, "process-tmp"),
      TEMP: path.join(invocation.cwd, "process-tmp"),
      LANG: "en_US.UTF-8",
      NO_COLOR: "1",
      TERM: "dumb",
    });

    expect(received.map((message) => message.method)).toEqual([
      "initialize",
      "initialized",
      "account/read",
      "getAuthStatus",
      "config/read",
      "configRequirements/read",
      "thread/start",
      "experimentalFeature/list",
      "hooks/list",
      "mcpServerStatus/list",
      "turn/start",
    ]);
    const turnIndex = received.findIndex((message) => message.id === 9);
    expect(turnIndex).toBe(10);
    expect(received.slice(0, turnIndex).map((message) => message.id)).toEqual([
      0,
      undefined,
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
    ]);
    expect(JSON.stringify(received.slice(0, turnIndex))).not.toContain(
      params().evidencePacket,
    );
    expect(received[0]).toMatchObject({
      method: "initialize",
      params: {
        capabilities: {
          experimentalApi: true,
          optOutNotificationMethods: [
            "item/agentMessage/delta",
            "item/reasoning/summaryTextDelta",
            "item/reasoning/summaryPartAdded",
            "item/reasoning/textDelta",
            "account/rateLimits/updated",
            "thread/status/changed",
            "remoteControl/status/changed",
          ],
        },
      },
    });
    expect(received[1]).toEqual({ method: "initialized" });
    expect(received[2]).toEqual({
      method: "account/read",
      id: 1,
      params: { refreshToken: false },
    });
    expect(received[3]).toEqual({
      method: "getAuthStatus",
      id: 2,
      params: { includeToken: false, refreshToken: false },
    });
    expect(received[6]).toMatchObject({
      method: "thread/start",
      params: { modelProvider: "openai", permissions: PERMISSION_PROFILE },
    });
    expect(received[7]).toMatchObject({
      method: "experimentalFeature/list",
      params: { threadId: "thread-fixture", cursor: null, limit: 1_000 },
    });
    expect(received[8]).toEqual({
      method: "hooks/list",
      id: 7,
      params: { cwds: [invocation.cwd] },
    });
    expect(received[9]).toMatchObject({
      method: "mcpServerStatus/list",
      params: {
        threadId: "thread-fixture",
        cursor: null,
        limit: 1_000,
        detail: "toolsAndAuthOnly",
      },
    });
    const turnRequest = received[turnIndex]!;
    const turnParams = turnRequest.params as {
      input: Array<{ type: string; text: string }>;
    };
    const evidenceEnvelope = JSON.parse(
      turnParams.input[0]!.text.split("\n").at(-1)!,
    ) as unknown;
    expect(evidenceEnvelope).toEqual({
      kind: "runtimebrief_filtered_evidence",
      untrusted: true,
      evidence: params().evidencePacket,
    });
    expect(turnRequest).toMatchObject({
      method: "turn/start",
      params: {
        threadId: "thread-fixture",
        environments: [],
        outputSchema: RUNTIMEBRIEF_ANALYST_JSON_SCHEMA,
      },
    });
    expect(events).toEqual([
      {
        type: "usage",
        costUsd: 0,
        inputTokens: 321,
        outputTokens: 17,
        cachedInputTokens: 21,
      },
      {
        type: "result",
        costUsd: 0,
        finalText: "Done: Clean. [git-working-tree]",
        isError: false,
      },
    ]);
    expect(EXPECTED_CODEX_FEATURES).toHaveLength(92);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("rejects an unreviewed version before host policy, OAuth, or app-server", async () => {
    const root = testRoot();
    const originalCodexHome = path.join(root, "original-codex-home");
    fs.mkdirSync(originalCodexHome, { mode: 0o700 });
    const originalAuthPath = path.join(originalCodexHome, "auth.json");
    fs.writeFileSync(originalAuthPath, "fictional credential", { mode: 0o600 });
    let managedVerified = false;
    let spawned = false;
    const runner = createCodexCliRunner({
      tempRoot: root,
      env: { HOME: "/Users/fixture", CODEX_HOME: originalCodexHome },
      versionVerifier: async ({ env }) => {
        expect(env.CODEX_HOME).not.toBe(originalCodexHome);
        expect(fs.readdirSync(env.CODEX_HOME!)).toEqual([]);
        throw new Error("unsupported fixture version");
      },
      managedConfigVerifier: async () => {
        managedVerified = true;
      },
      permissionProfileFactory: () => PERMISSION_PROFILE,
      spawnImpl: () => {
        spawned = true;
        return new FakeCodexChild();
      },
    });

    await expect(drain(runner)).rejects.toThrow("unsupported fixture version");
    expect(managedVerified).toBe(false);
    expect(spawned).toBe(false);
    expect(fs.readFileSync(originalAuthPath, "utf8")).toBe("fictional credential");
    expect(fs.readdirSync(root)).toEqual(["original-codex-home"]);
  });

  it("runs the host-managed-config verifier before linking OAuth or spawning", async () => {
    const root = testRoot();
    const originalCodexHome = path.join(root, "original-codex-home");
    fs.mkdirSync(originalCodexHome, { mode: 0o700 });
    fs.writeFileSync(path.join(originalCodexHome, "auth.json"), "fixture", {
      mode: 0o600,
    });
    let isolatedCodexHome = "";
    let profileGenerated = false;
    let spawned = false;
    const order: string[] = [];
    const runner = createCodexCliRunner({
      tempRoot: root,
      env: { HOME: "/Users/fixture", CODEX_HOME: originalCodexHome },
      versionVerifier: async ({ env }) => {
        order.push("version");
        isolatedCodexHome = env.CODEX_HOME!;
      },
      managedConfigVerifier: async () => {
        order.push("managed");
        expect(fs.readdirSync(isolatedCodexHome)).toEqual([]);
        throw new Error("managed fixture rejected");
      },
      permissionProfileFactory: () => {
        profileGenerated = true;
        return PERMISSION_PROFILE;
      },
      spawnImpl: () => {
        spawned = true;
        return new FakeCodexChild();
      },
    });

    await expect(drain(runner)).rejects.toThrow("managed fixture rejected");
    expect(order).toEqual(["version", "managed"]);
    expect(profileGenerated).toBe(false);
    expect(spawned).toBe(false);
    expect(fs.readdirSync(root)).toEqual(["original-codex-home"]);
  });

  it("links only the private OAuth file and removes the isolated link", async () => {
    const root = testRoot();
    const originalCodexHome = path.join(root, "original-codex-home");
    fs.mkdirSync(originalCodexHome, { mode: 0o700 });
    const originalAuthPath = path.join(originalCodexHome, "auth.json");
    const fictionalCredential = '{"auth_mode":"chatgpt","fixture":true}\n';
    fs.writeFileSync(originalAuthPath, fictionalCredential, { mode: 0o600 });
    const child = new FakeCodexChild();
    let isolatedAuthPath = "";
    const runner = createTestCodexCliRunner(root, {
      env: { CODEX_HOME: originalCodexHome, PATH: "/usr/bin:/bin" },
      spawnImpl: (_command, _args, options) => {
        isolatedAuthPath = path.join(options.env.CODEX_HOME!, "auth.json");
        expect(fs.lstatSync(isolatedAuthPath).isSymbolicLink()).toBe(true);
        expect(fs.readlinkSync(isolatedAuthPath)).toBe(originalAuthPath);
        expect(fs.readdirSync(options.env.CODEX_HOME!)).toEqual(["auth.json"]);
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, []);
        return child;
      },
    });

    await drain(runner);
    expect(fs.existsSync(isolatedAuthPath)).toBe(false);
    expect(fs.readFileSync(originalAuthPath, "utf8")).toBe(fictionalCredential);
    expect(fs.readdirSync(root)).toEqual(["original-codex-home"]);
  });

  it("serializes requests until the prior child exits and OAuth link cleanup finishes", async () => {
    const root = testRoot();
    const originalCodexHome = path.join(root, "original-codex-home");
    fs.mkdirSync(originalCodexHome, { mode: 0o700 });
    fs.writeFileSync(path.join(originalCodexHome, "auth.json"), "fixture", {
      mode: 0o600,
    });
    let firstWorkspace = "";
    let spawnCount = 0;
    let releaseFirst!: () => void;
    let markFirstPaused!: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      markFirstPaused = resolve;
    });
    const runner = createTestCodexCliRunner(root, {
      env: { CODEX_HOME: originalCodexHome, PATH: "/usr/bin:/bin" },
      spawnImpl: (_command, _args, options) => {
        spawnCount += 1;
        const child = new FakeCodexChild();
        if (spawnCount === 1) {
          firstWorkspace = options.cwd;
          expect(
            fs.lstatSync(path.join(options.env.CODEX_HOME!, "auth.json"))
              .isSymbolicLink(),
          ).toBe(true);
          wireSuccessfulProtocol(
            child,
            options.cwd,
            options.env.CODEX_HOME!,
            [],
            {
              pauseBeforeCompletion: (complete) => {
                releaseFirst = complete;
                markFirstPaused();
              },
            },
          );
        } else {
          expect(fs.existsSync(firstWorkspace)).toBe(false);
          wireSuccessfulProtocol(
            child,
            options.cwd,
            options.env.CODEX_HOME!,
            [],
          );
        }
        return child;
      },
    });

    const first = drain(runner);
    await firstPaused;
    const second = drain(runner);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(spawnCount).toBe(1);
    expect(fs.existsSync(path.join(firstWorkspace, "codex-home", "auth.json"))).toBe(
      true,
    );

    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.any(Array),
      expect.any(Array),
    ]);
    expect(spawnCount).toBe(2);
    expect(fs.existsSync(firstWorkspace)).toBe(false);
    expect(fs.readdirSync(root)).toEqual(["original-codex-home"]);
  });

  it("lets an aborted queued request reject without spawning or deadlocking its successor", async () => {
    const root = testRoot();
    let spawnCount = 0;
    let releaseFirst!: () => void;
    let markFirstPaused!: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      markFirstPaused = resolve;
    });
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        spawnCount += 1;
        const child = new FakeCodexChild();
        wireSuccessfulProtocol(
          child,
          options.cwd,
          options.env.CODEX_HOME!,
          [],
          spawnCount === 1
            ? {
                pauseBeforeCompletion: (complete) => {
                  releaseFirst = complete;
                  markFirstPaused();
                },
              }
            : {},
        );
        return child;
      },
    });

    const first = drain(runner);
    await firstPaused;
    const queuedController = new AbortController();
    const queuedResult = drain(
      runner,
      params(queuedController.signal),
    ).then<Error | null>(() => null, (error: Error) => error);
    const successor = drain(runner);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(spawnCount).toBe(1);

    queuedController.abort(new Error("queued fixture cancelled"));
    await expect(queuedResult).resolves.toMatchObject({
      message: "queued fixture cancelled",
    });
    expect(spawnCount).toBe(1);

    releaseFirst();
    await expect(Promise.all([first, successor])).resolves.toEqual([
      expect.any(Array),
      expect.any(Array),
    ]);
    expect(spawnCount).toBe(2);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("fails closed when the OAuth file is public or a symlink", async () => {
    for (const unsafe of ["public", "symlink"] as const) {
      const root = testRoot();
      const originalCodexHome = path.join(root, `codex-home-${unsafe}`);
      fs.mkdirSync(originalCodexHome, { mode: 0o700 });
      const originalAuthPath = path.join(originalCodexHome, "auth.json");
      if (unsafe === "public") {
        fs.writeFileSync(originalAuthPath, "fictional credential", {
          mode: 0o644,
        });
      } else {
        const outside = path.join(root, "outside-auth.json");
        fs.writeFileSync(outside, "fictional credential", { mode: 0o600 });
        fs.symlinkSync(outside, originalAuthPath);
      }
      let spawned = false;
      const runner = createTestCodexCliRunner(root, {
        env: { CODEX_HOME: originalCodexHome },
        spawnImpl: () => {
          spawned = true;
          return new FakeCodexChild();
        },
      });
      await expect(drain(runner)).rejects.toThrow(/OAuth credential/);
      expect(spawned).toBe(false);
    }
  });

  it.each([
    ["account/read", { accountType: "apiKey" }],
    ["getAuthStatus", { legacyAuthMethod: "apiKey" }],
  ] as const)("rejects direct API auth reported by %s before evidence", async (_stage, protocolOptions) => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const received: Array<Record<string, unknown>> = [];
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(
          child,
          options.cwd,
          options.env.CODEX_HOME!,
          received,
          protocolOptions,
        );
        return child;
      },
    });

    let error: Error | null = null;
    try {
      await drain(runner);
    } catch (cause) {
      error = cause as Error;
    }
    expect(error?.message).toBe(
      "Codex CLI returned an invalid app-server response.",
    );
    expect(error?.message).not.toContain("must-not-surface");
    expect(JSON.stringify(received)).not.toContain(params().evidencePacket);
    expect(received.some((message) => message.id === 9)).toBe(false);
  });

  it("rejects managed config and managed requirements before evidence", async () => {
    for (const boundary of ["config", "requirements"] as const) {
      const root = testRoot();
      const child = new FakeCodexChild();
      const received: Array<Record<string, unknown>> = [];
      const runner = createTestCodexCliRunner(root, {
        spawnImpl: (_command, _args, options) => {
          wireSuccessfulProtocol(
            child,
            options.cwd,
            options.env.CODEX_HOME!,
            received,
            boundary === "config"
              ? {
                  mutateConfig: (result) => {
                    result.layers.push({
                      name: { type: "enterpriseManaged" },
                      version: "managed",
                      config: { forced_login_method: "api" },
                    });
                  },
                }
              : {
                  requirements: {
                    allowedPermissionProfiles: { ":full": true },
                  },
                },
          );
          return child;
        },
      });

      await expect(drain(runner)).rejects.toThrow("invalid app-server response");
      expect(JSON.stringify(received)).not.toContain(params().evidencePacket);
      expect(received.some((message) => message.id === 9)).toBe(false);
    }
  });

  it.each([
    ["provider", (result: ThreadResultFixture) => {
      result.modelProvider = "custom";
    }],
    ["profile", (result: ThreadResultFixture) => {
      result.activePermissionProfile.id = ":full";
    }],
    ["sandbox", (result: ThreadResultFixture) => {
      result.sandbox = { type: "dangerFullAccess" };
    }],
    ["cwd", (result: ThreadResultFixture) => {
      result.cwd = "/private/project";
    }],
  ])("rejects an unsafe effective thread %s before evidence", async (_label, mutateThread) => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const received: Array<Record<string, unknown>> = [];
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(
          child,
          options.cwd,
          options.env.CODEX_HOME!,
          received,
          { mutateThread },
        );
        return child;
      },
    });
    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
    expect(JSON.stringify(received)).not.toContain(params().evidencePacket);
  });

  it.each([
    ["feature inventory", (options: ProtocolOptions) => {
      options.mutateFeatures = (result) => {
        const apps = result.data.find((feature) => feature.name === "apps");
        if (apps) apps.enabled = true;
      };
    }],
    ["hooks", (options: ProtocolOptions) => {
      options.mutateHooks = (result) => {
        result.data[0]!.hooks.push({ command: "fixture" });
      };
    }],
    ["MCP inventory", (options: ProtocolOptions) => {
      options.mutateMcp = (result) => {
        result.data.push({ name: "fixture-server" });
      };
    }],
  ])("rejects unsafe %s before evidence", async (_label, configure) => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const received: Array<Record<string, unknown>> = [];
    const protocolOptions: ProtocolOptions = {};
    configure(protocolOptions);
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(
          child,
          options.cwd,
          options.env.CODEX_HOME!,
          received,
          protocolOptions,
        );
        return child;
      },
    });

    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
    expect(JSON.stringify(received)).not.toContain(params().evidencePacket);
    expect(received.some((message) => message.id === 9)).toBe(false);
  });

  it("does not write evidence while final MCP attestation is pending", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const received: Array<Record<string, unknown>> = [];
    let release!: () => void;
    let markPaused!: () => void;
    const paused = new Promise<void>((resolve) => {
      markPaused = resolve;
    });
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(
          child,
          options.cwd,
          options.env.CODEX_HOME!,
          received,
          {
            pauseBeforeMcpAttestation: (respond) => {
              release = respond;
              markPaused();
            },
          },
        );
        return child;
      },
    });

    const request = drain(runner);
    await paused;
    expect(received.at(-1)).toMatchObject({
      method: "mcpServerStatus/list",
      id: 8,
    });
    expect(received.some((message) => message.id === 9)).toBe(false);
    expect(JSON.stringify(received)).not.toContain(params().evidencePacket);
    release();
    await expect(request).resolves.toHaveLength(2);
    expect(received.some((message) => message.id === 9)).toBe(true);
  });

  it.each([
    "commandExecution",
    "fileChange",
    "mcpToolCall",
    "dynamicToolCall",
    "collabAgentToolCall",
    "webSearch",
    "imageView",
  ])("terminates on the tool-capable item %s", async (toolItemType) => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, [], {
          toolItemType,
        });
        return child;
      },
    });
    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
    expect(child.killSignals).toEqual(["SIGTERM"]);
  });

  it("fails closed on an invalid item lifecycle", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, [], {
          orphanCompletedItem: true,
        });
        return child;
      },
    });
    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
  });

  it("fails closed on an unknown notification", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, [], {
          unknownNotification: "capability/invoked",
        });
        return child;
      },
    });
    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
  });

  it.each([
    ["plain text", "not-json"],
    ["extra field", JSON.stringify({ answer: "Done.", tool: "shell" })],
    ["empty answer", JSON.stringify({ answer: "   " })],
  ])("rejects a final answer with %s", async (_label, finalText) => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, [], {
          finalText,
        });
        return child;
      },
    });
    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
  });

  it("rejects non-monotonic cumulative token usage", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, [], {
          tokenUsages: [
            { inputTokens: 321, cachedInputTokens: 21, outputTokens: 17 },
            { inputTokens: 320, cachedInputTokens: 21, outputTokens: 17 },
          ],
        });
        return child;
      },
    });
    await expect(drain(runner)).rejects.toThrow("invalid app-server response");
  });

  it("does not yield candidate text before the terminal event and process exit", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    let release!: () => void;
    let markPaused!: () => void;
    const paused = new Promise<void>((resolve) => {
      markPaused = resolve;
    });
    const runner = createTestCodexCliRunner(root, {
      spawnImpl: (_command, _args, options) => {
        wireSuccessfulProtocol(child, options.cwd, options.env.CODEX_HOME!, [], {
          pauseBeforeCompletion: (complete) => {
            release = complete;
            markPaused();
          },
        });
        return child;
      },
    });
    const iterator = runner(params());
    let settled = false;
    const first = iterator.next().then((event) => {
      settled = true;
      return event;
    });
    await paused;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(settled).toBe(false);
    release();
    await expect(first).resolves.toMatchObject({
      value: { type: "usage", inputTokens: 321 },
    });
    await iterator.return(undefined);
  });

  it("kills the exact app-server child on abort and removes the workspace", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    child.onKill = (signal) => {
      if (signal === "SIGKILL") child.close(null as never, "SIGKILL");
    };
    let spawned!: () => void;
    const didSpawn = new Promise<void>((resolve) => {
      spawned = resolve;
    });
    const controller = new AbortController();
    const runner = createTestCodexCliRunner(root, {
      killGraceMs: 5,
      spawnImpl: () => {
        spawned();
        return child;
      },
    });
    const request = drain(runner, params(controller.signal));
    await didSpawn;
    controller.abort(new Error("fixture deadline reached"));
    await expect(request).rejects.toThrow("fixture deadline reached");
    expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  it("bounds stdout and terminates without exposing content", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    child.onKill = (signal) =>
      queueMicrotask(() => child.close(null as never, signal as NodeJS.Signals));
    child.stdin.on("data", () =>
      child.stdout.write("sensitive-output".repeat(20)),
    );
    const runner = createTestCodexCliRunner(root, {
      maxStdoutBytes: 8,
      spawnImpl: () => child,
    });
    let error: Error | null = null;
    try {
      await drain(runner);
    } catch (cause) {
      error = cause as Error;
    }
    expect(error?.message).toContain("stdout exceeded its safety limit");
    expect(error?.message).not.toContain("sensitive-output");
  });

  it("rejects and never retains or exposes stderr", async () => {
    const root = testRoot();
    const child = new FakeCodexChild();
    child.onKill = (signal) =>
      queueMicrotask(() => child.close(null as never, signal as NodeJS.Signals));
    child.stdin.on("data", () =>
      child.stderr.write("private account diagnostic"),
    );
    const runner = createTestCodexCliRunner(root, { spawnImpl: () => child });
    let error: Error | null = null;
    try {
      await drain(runner);
    } catch (cause) {
      error = cause as Error;
    }
    expect(error?.message).toBe(
      "Codex CLI emitted unexpected diagnostic output.",
    );
    expect(error?.message).not.toContain("private account diagnostic");
  });
});

describe("Codex CLI version gate", () => {
  it("accepts only the capability-reviewed exact release", () => {
    expect(() =>
      assertSupportedCodexCliVersion("codex-cli 0.144.1\n"),
    ).not.toThrow();
    expect(() =>
      assertSupportedCodexCliVersion("codex-cli 0.145.0\n"),
    ).toThrow(/other versions have not passed/);
    expect(() => assertSupportedCodexCliVersion("unexpected output\n")).toThrow(
      /requires Codex CLI 0\.144\.1/,
    );
  });
});

describe("Codex CLI child environment", () => {
  it("cannot inherit API credentials, RuntimeBrief secrets, proxies, or agent sockets", () => {
    const env = buildCodexCliEnvironment(
      {
        HOME: "/Users/fixture",
        PATH: "/bin",
        OPENAI_API_KEY: "no",
        CODEX_API_KEY: "no",
        CODEX_ACCESS_TOKEN: "no",
        ANTHROPIC_API_KEY: "no",
        RUNTIMEBRIEF_TOKEN: "no",
        RUNTIMEBRIEF_PRIVATE_VALUE: "no",
        HTTP_PROXY: "http://private-proxy",
        HTTPS_PROXY: "http://private-proxy",
        SSH_AUTH_SOCK: "/private/agent",
      },
      "/tmp/isolated-fixture",
      "/tmp/isolated-fixture/codex-home",
      "/tmp/isolated-fixture/user-home",
      "/tmp/isolated-fixture/process-tmp",
    );
    expect(env).not.toHaveProperty("OPENAI_API_KEY");
    expect(env).not.toHaveProperty("CODEX_API_KEY");
    expect(env).not.toHaveProperty("CODEX_ACCESS_TOKEN");
    expect(env).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(env).not.toHaveProperty("HTTP_PROXY");
    expect(env).not.toHaveProperty("HTTPS_PROXY");
    expect(env).not.toHaveProperty("SSH_AUTH_SOCK");
    expect(Object.keys(env).some((key) => key.startsWith("RUNTIMEBRIEF_"))).toBe(
      false,
    );
    expect(env.TMPDIR).toBe("/tmp/isolated-fixture/process-tmp");
  });
});
