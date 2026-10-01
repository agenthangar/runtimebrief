export type LaunchState = "starting" | "running" | "needs_input" | "completed" | "failed" | "stopped" | "unknown" | "in_desktop";

export const CLAUDE_MODELS = ["default", "fable", "opus", "sonnet", "haiku"] as const;
export const CLAUDE_PERMISSION_MODES = ["manual", "auto", "acceptEdits", "plan", "bypassPermissions", "dontAsk"] as const;
export const SESSION_PROVIDERS = ["claude", "codex", "cursor"] as const;
export type SessionProvider = typeof SESSION_PROVIDERS[number];
export const NATIVE_PERMISSION_MODES = {
  codex: ["manual", "auto", "plan", "bypassPermissions", "dontAsk"],
  cursor: ["manual", "auto", "plan", "ask", "bypassPermissions"],
} as const;
export function permissionModes(provider: SessionProvider): readonly string[] {
  return provider === "claude" ? CLAUDE_PERMISSION_MODES : NATIVE_PERMISSION_MODES[provider];
}
export const REASONING_EFFORTS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
export const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/\[\],=+-]{0,255}$/;
export interface AgentModel { id: string; label: string; reasoningEfforts?: string[] }
export interface ResolvedSettings { model: string; reasoningEffort: string; defaultModelLabel?: string; defaultReasoningLabel?: string }
export interface ClaudeLaunchOptions {
  provider?: SessionProvider;
  model: string;
  permissionMode: string;
  reasoningEffort?: string;
  remoteControl?: boolean;
}
export const DEFAULT_LAUNCH_OPTIONS: ClaudeLaunchOptions = { model: "default", permissionMode: "manual" };

export interface ClaudeLaunch {
  provider?: SessionProvider;
  id: string;
  projectId: string;
  name: string;
  createdAt: string;
  state: LaunchState;
  message: string;
  nativeId: string | null;
  sessionId: string | null;
  cwd: string;
  openedAt: string | null;
  model?: ClaudeLaunchOptions["model"];
  permissionMode?: ClaudeLaunchOptions["permissionMode"];
  reasoningEffort?: string;
  effectiveModel?: string;
  effectiveReasoningEffort?: string;
  /** Absent on old receipts: the native background launcher owns those forever. */
  backend?: string;
  projectRoot?: string;
  projectName?: string;
  nativeProjectId?: string;
  /** New native tasks use the selected project checkout; old receipts retain their worktree. */
  workspaceKind?: "project" | "worktree";
  tmuxTarget?: string;
  promptHash?: string;
  launchState?: "starting" | "started" | "failed" | "unknown";
  activity?: "working" | "needs_input" | "idle" | "stopped" | "unknown";
  requestedRemoteControl?: boolean;
  remoteControl?: {
    state: "disabled" | "starting" | "ready" | "unavailable" | "unknown";
    url: string | null;
    observedAt: string;
  };
}

/** Provider execution and continuation boundary. */
export interface ClaudeSessionBackend {
  readonly id: string;
  readonly provider?: SessionProvider;
  capability(cwd?: string): Promise<LaunchCapability>;
  resolveSettings?(cwd: string, options: ClaudeLaunchOptions): Promise<ResolvedSettings>;
  create(launch: ClaudeLaunch, prompt: string): Promise<void>;
  get(launch: ClaudeLaunch): Promise<ClaudeLaunch>;
  open(launch: ClaudeLaunch): Promise<void>;
  conversation?(launch: ClaudeLaunch): Promise<ConversationSnapshot>;
  reply?(launch: ClaudeLaunch, body: SessionReply): Promise<{ accepted: boolean; unknown?: boolean }>;
  terminal?(launch: ClaudeLaunch): Promise<TerminalSnapshot>;
  input?(launch: ClaudeLaunch, data: string): Promise<void>;
}

export interface TerminalSnapshot {
  screen: string;
  cols: number;
  rows: number;
  writable: boolean;
  message: string;
}

export interface LaunchCapability {
  available: boolean;
  message: string;
  models?: AgentModel[];
  modelsMessage?: string;
  permissionModes?: readonly string[];
  defaultModelLabel?: string;
  defaultReasoningLabel?: string;
}

export interface NativeClaudeSession {
  id?: string | undefined;
  sessionId?: string | undefined;
  name?: string | undefined;
  cwd: string;
  kind: string;
  state?: string | undefined;
  status?: string | undefined;
  waitingFor?: string | undefined;
}

export interface ClaudeProvider {
  capability(cwd?: string): Promise<LaunchCapability>;
  resolveSettings?(cwd: string, options: ClaudeLaunchOptions): Promise<ResolvedSettings>;
  start(cwd: string, name: string, prompt: string, options?: ClaudeLaunchOptions): Promise<string>;
  sessions(): Promise<NativeClaudeSession[]>;
  desktopHas(sessionID: string): boolean;
  open(launch: ClaudeLaunch): Promise<void>;
}

export class LaunchError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}

export interface SessionReply { requestId: string; text?: string | undefined; approvalId?: string | undefined; optionId?: string | undefined; answers?: Record<string, string[]> | undefined }
export interface ConversationSnapshot {
  state: string; message: string; writable?: boolean;
  messages: { id: string; role: string; text: string }[];
  requests: { id: string; title: string; body: string; options: { id: string; label: string }[]; questions: { id: string; prompt: string; options: { id: string; label: string }[] }[] }[];
}
