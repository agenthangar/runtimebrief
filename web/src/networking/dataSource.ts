import type {
  AgentCapability,
  AgentProvider,
  AgentProviderList,
  ClaudeLaunch,
  ClaudeLaunchList,
  ClaudeLaunchRequest,
  ConversationSnapshot,
  SessionLaunchRequest,
  SessionReply,
  SessionReplyResult,
  TerminalInput,
  TerminalInputResult,
  TerminalSnapshot,
} from "../models/claudeLaunch";
import type { AnalystAnswer, ProjectCard, ProjectSummary, VoiceStatus } from "../models/types";
import { defaults as defaultStore } from "../lib/storage";
import { RuntimeBriefClient, type AnalystStreamEvent } from "./client";
import { DemoRuntimeBriefDataSource } from "../demo/demoDataSource";

/**
 * The app reads through this boundary so the offline demo cannot fall
 * through to live settings, stored credentials, caches, or networking.
 */
export interface RuntimeBriefDataSource {
  projects(): Promise<ProjectSummary[]>;
  project(id: string): Promise<ProjectCard>;
  status(projectID: string): Promise<AnalystAnswer>;
  voiceStatus(projectID: string): Promise<VoiceStatus>;
  ask(projectID: string, question: string): Promise<AnalystAnswer>;
  claudeLaunches(projectID: string): Promise<ClaudeLaunchList>;
  startClaude(projectID: string, request: ClaudeLaunchRequest): Promise<ClaudeLaunch>;
  agentProviders(): Promise<AgentProviderList>;
  agentModels(projectID: string, provider: AgentProvider): Promise<AgentCapability>;
  conversation(projectID: string, launchID: string): Promise<ConversationSnapshot>;
  reply(projectID: string, launchID: string, reply: SessionReply): Promise<SessionReplyResult>;
  sessions(projectID: string): Promise<ClaudeLaunchList>;
  startSession(projectID: string, request: SessionLaunchRequest): Promise<ClaudeLaunch>;
  terminal(projectID: string, launchID: string): Promise<TerminalSnapshot>;
  sendInput(projectID: string, launchID: string, input: TerminalInput): Promise<TerminalInputResult>;
  openClaude(projectID: string, launchID: string): Promise<ClaudeLaunch>;
  streamStatus(projectID: string): AsyncGenerator<AnalystStreamEvent>;
  streamAsk(projectID: string, question: string): AsyncGenerator<AnalystStreamEvent>;
}

export class LiveRuntimeBriefDataSource implements RuntimeBriefDataSource {
  private readonly client: RuntimeBriefClient;

  constructor(clientOrTimeout: RuntimeBriefClient | number = 20) {
    this.client =
      clientOrTimeout instanceof RuntimeBriefClient ? clientOrTimeout : new RuntimeBriefClient({ timeout: clientOrTimeout });
  }

  projects() {
    return this.client.projects();
  }
  project(id: string) {
    return this.client.project(id);
  }
  status(projectID: string) {
    return this.client.status(projectID);
  }
  voiceStatus(projectID: string) {
    return this.client.voiceStatus(projectID);
  }
  ask(projectID: string, question: string) {
    return this.client.ask(projectID, question);
  }
  claudeLaunches(projectID: string) {
    return this.client.claudeLaunches(projectID);
  }
  startClaude(projectID: string, request: ClaudeLaunchRequest) {
    return this.client.startClaude(projectID, request);
  }
  agentProviders() {
    return this.client.agentProviders();
  }
  agentModels(projectID: string, provider: AgentProvider) {
    return this.client.agentModels(projectID, provider);
  }
  conversation(projectID: string, launchID: string) {
    return this.client.conversation(projectID, launchID);
  }
  reply(projectID: string, launchID: string, reply: SessionReply) {
    return this.client.reply(projectID, launchID, reply);
  }
  sessions(projectID: string) {
    return this.client.sessions(projectID);
  }
  startSession(projectID: string, request: SessionLaunchRequest) {
    return this.client.startSession(projectID, request);
  }
  terminal(projectID: string, launchID: string) {
    return this.client.terminal(projectID, launchID);
  }
  sendInput(projectID: string, launchID: string, input: TerminalInput) {
    return this.client.sendInput(projectID, launchID, input);
  }
  openClaude(projectID: string, launchID: string) {
    return this.client.openClaude(projectID, launchID);
  }
  streamStatus(projectID: string) {
    return this.client.streamStatus(projectID);
  }
  streamAsk(projectID: string, question: string) {
    return this.client.streamAsk(projectID, question);
  }
}

const DEMO_KEY = "runtimebrief.demo.enabled.v1";
const modeListeners = new Set<() => void>();

export const RuntimeBriefModeStore = {
  get isDemoEnabled(): boolean {
    return defaultStore.get(DEMO_KEY) === "true";
  },
  setDemoEnabled(enabled: boolean): void {
    if (enabled) defaultStore.set(DEMO_KEY, "true");
    else defaultStore.remove(DEMO_KEY);
    for (const listener of modeListeners) listener();
  },
  subscribe(listener: () => void): () => void {
    modeListeners.add(listener);
    return () => modeListeners.delete(listener);
  },
};

export const RuntimeBriefDataSourceFactory = {
  current(timeout = 20): RuntimeBriefDataSource {
    return RuntimeBriefDataSourceFactory.make(RuntimeBriefModeStore.isDemoEnabled, timeout);
  },

  /** Passing the mode explicitly keeps the privacy boundary directly testable. */
  make(isDemo: boolean, timeout = 20): RuntimeBriefDataSource {
    if (isDemo) return new DemoRuntimeBriefDataSource();
    return new LiveRuntimeBriefDataSource(timeout);
  },
};
