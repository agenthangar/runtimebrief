export type LaunchState = "starting" | "running" | "needs_input" | "completed" | "failed" | "stopped" | "unknown" | "in_desktop";

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
  start(cwd: string, name: string, prompt: string): Promise<string>;
  sessions(): Promise<NativeClaudeSession[]>;
  desktopHas(sessionID: string): boolean;
  open(launch: ClaudeLaunch): Promise<void>;
}

export class LaunchError extends Error {
  constructor(public readonly statusCode: number, public readonly code: string, message: string) {
    super(message);
  }
}
