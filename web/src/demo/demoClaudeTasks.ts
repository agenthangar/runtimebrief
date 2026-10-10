import {
  AGENT_PROVIDERS,
  CLAUDE_MODELS,
  claudeModelLabel,
  launchAgent,
  makeCapability,
  providerLabel,
  providerModes,
  type AgentCapability,
  type ClaudeLaunch,
  type ClaudeLaunchList,
  type ClaudeModel,
  type ClaudePermissionMode,
  type ConversationMessage,
  type ConversationSnapshot,
  type SessionLaunchRequest,
  type SessionReply,
  type SessionReplyResult,
  type TerminalInput,
  type TerminalInputResult,
  type TerminalSnapshot,
} from "../models/claudeLaunch";
import { RuntimeBriefError } from "../networking/errors";

/** Fictional in-memory interaction. This store never creates a client or opens an app. */
export class DemoClaudeTasks {
  static shared = new DemoClaudeTasks();

  private tasks: ClaudeLaunch[] = [];
  private conversations = new Map<string, ConversationMessage[]>();
  private screens = new Map<string, string>();
  private inputs = new Set<string>();

  /** Tests reset the singleton between runs; the app never calls this. */
  static resetForTesting(): void {
    DemoClaudeTasks.shared = new DemoClaudeTasks();
  }

  list(projectID: string): ClaudeLaunchList {
    return {
      capability: {
        available: true,
        message: "Try a fictional Claude task. Demo mode never sends work to a Mac.",
      },
      launches: this.tasks.filter((task) => task.projectId === projectID),
      providers: AGENT_PROVIDERS.map((provider) => demoCapability(provider)),
    };
  }

  startClaude(
    projectID: string,
    requestID: string,
    model: ClaudeModel,
    permissionMode: ClaudePermissionMode,
    remoteControl = true,
  ): ClaudeLaunch {
    const existing = this.tasks.find((task) => task.id === requestID && task.projectId === projectID);
    if (existing) return existing;
    const launch: ClaudeLaunch = {
      id: requestID,
      projectId: projectID,
      name: "Demo Claude task",
      createdAt: new Date(),
      state: "completed",
      message: "Demo task ready to review. No work was sent to a Mac.",
      nativeId: "demo-task",
      sessionId: null,
      cwd: "/demo/sample-tracker",
      openedAt: null,
      model,
      reasoningEffort: null,
      effectiveReasoningEffort: null,
      permissionMode,
      backend: "native-claude",
      tmuxTarget: null,
      launchState: null,
      activity: null,
      requestedRemoteControl: remoteControl,
      remoteControl: { state: remoteControl ? "ready" : "disabled", url: null },
      provider: null,
    };
    this.tasks.unshift(launch);
    return launch;
  }

  start(projectID: string, request: SessionLaunchRequest): ClaudeLaunch {
    const existing = this.tasks.find((task) => task.id === request.requestId && task.projectId === projectID);
    if (existing) return existing;
    const base = this.startClaude(projectID, request.requestId, "default", "manual", request.remoteControl);
    const launch: ClaudeLaunch = {
      ...base,
      provider: request.provider,
      model: request.model,
      permissionMode: request.permissionMode,
      reasoningEffort: request.reasoningEffort,
      backend: `native-${request.provider}`,
    };
    this.tasks[0] = launch;
    const screen = `Your sample project summary is ready to review. This is a fictional ${providerLabel(
      request.provider,
    )} response; no Mac is connected.`;
    this.screens.set(launch.id, screen);
    this.conversations.set(launch.id, [{ id: "demo-reply", role: "assistant", text: screen }]);
    return launch;
  }

  conversation(projectID: string, launchID: string): ConversationSnapshot {
    const launch = this.tasks.find((task) => task.id === launchID && task.projectId === projectID);
    if (!launch) throw RuntimeBriefError.notFound();
    return {
      state: "completed",
      message: "Fictional conversation. No Mac is connected.",
      writable: launch.requestedRemoteControl !== false,
      messages: this.conversations.get(launchID) ?? [
        { id: "demo-reply", role: "assistant", text: "Your demo task is ready to review." },
      ],
      requests: [],
    };
  }

  reply(projectID: string, launchID: string, reply: SessionReply): SessionReplyResult {
    if (this.conversation(projectID, launchID).writable !== true) throw RuntimeBriefError.notFound();
    const key = launchID + reply.requestId;
    if (!this.inputs.has(key)) {
      this.inputs.add(key);
      const thread = this.conversations.get(launchID) ?? [];
      if (reply.text) thread.push({ id: reply.requestId, role: "user", text: reply.text });
      thread.push({
        id: `reply-${reply.requestId}`,
        role: "assistant",
        text: "Demo received your response. No work was sent to a Mac.",
      });
      this.conversations.set(launchID, thread);
    }
    return { accepted: true, unknown: null };
  }

  terminal(projectID: string, launchID: string): TerminalSnapshot {
    const launch = this.tasks.find((task) => task.id === launchID && task.projectId === projectID);
    if (!launch || launchAgent(launch) === "claude" || launch.requestedRemoteControl === false) {
      throw RuntimeBriefError.notFound();
    }
    return {
      screen: "\u001b[2J\u001b[H" + (this.screens.get(launchID) ?? "Demo terminal"),
      cols: 60,
      rows: 24,
      writable: true,
      message: "Demo only. No keys are sent to a Mac.",
    };
  }

  input(projectID: string, launchID: string, input: TerminalInput): TerminalInputResult {
    this.terminal(projectID, launchID);
    const key = launchID + input.requestId;
    if (!this.inputs.has(key)) {
      this.inputs.add(key);
      const current = this.screens.get(launchID) ?? "";
      this.screens.set(launchID, current + input.data.replace(/\r/g, "\r\n") + "Demo received input.\r\n> ");
    }
    return { state: "sent" };
  }
}

function demoCapability(provider: AgentCapability["id"]): AgentCapability {
  const models =
    provider === "claude"
      ? CLAUDE_MODELS.filter((model) => model !== "default").map((model) => ({
          id: model,
          label: claudeModelLabel(model),
          reasoningEfforts: ["low", "medium", "high"],
        }))
      : [{ id: "demo-model", label: "Demo model", reasoningEfforts: ["low", "medium", "high"] }];
  const permissionModes =
    provider === "claude"
      ? providerModes(provider)
      : provider === "codex"
        ? ["manual", "auto", "plan", "bypassPermissions", "dontAsk"]
        : ["manual", "auto", "plan", "ask", "bypassPermissions"];
  return makeCapability(
    provider,
    true,
    `Try a fictional ${providerLabel(provider)} task. Demo mode never sends work to a Mac.`,
    {
      models,
      permissionModes,
      defaultModelLabel: provider === "claude" ? "opus" : "demo-model",
      defaultReasoningLabel: "medium",
    },
  );
}
