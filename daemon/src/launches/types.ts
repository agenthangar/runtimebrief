export type LaunchState = "starting" | "running" | "needs_input" | "completed" | "failed" | "stopped" | "unknown" | "in_desktop";

export const CLAUDE_MODELS = ["default", "fable", "opus", "sonnet", "haiku"] as const;
export const CLAUDE_PERMISSION_MODES = ["manual", "auto", "acceptEdits", "plan", "bypassPermissions", "dontAsk"] as const;
export interface ClaudeLaunchOptions {
  model: typeof CLAUDE_MODELS[number];
  permissionMode: typeof CLAUDE_PERMISSION_MODES[number];
  remoteControl?: boolean;
}
export const DEFAULT_LAUNCH_OPTIONS: ClaudeLaunchOptions = { model: "default", permissionMode: "manual" };

export interface ClaudeLaunch {
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
  /** Absent on old receipts: the native background launcher owns those forever. */
  backend?: string;
  projectRoot?: string;
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

/** RuntimeBrief's internal seam. A future t API backend replaces this implementation. */
export interface ClaudeSessionBackend {
  readonly id: string;
  capability(cwd?: string): Promise<LaunchCapability>;
  create(launch: ClaudeLaunch, prompt: string): Promise<void>;
  get(launch: ClaudeLaunch): Promise<ClaudeLaunch>;
  open(launch: ClaudeLaunch): Promise<void>;
}

export interface LaunchCapability {
  available: boolean;
  message: string;
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
  capability(): Promise<LaunchCapability>;
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
