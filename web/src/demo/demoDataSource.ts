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
import type { AnalystStreamEvent } from "../networking/client";
import type { RuntimeBriefDataSource } from "../networking/dataSource";
import { RuntimeBriefError } from "../networking/errors";
import { DemoClaudeTasks } from "./demoClaudeTasks";
import { DemoData } from "./demoData";

export class DemoRuntimeBriefDataSource implements RuntimeBriefDataSource {
  async claudeLaunches(projectID: string): Promise<ClaudeLaunchList> {
    DemoData.card(projectID);
    return DemoClaudeTasks.shared.list(projectID);
  }

  async startClaude(projectID: string, request: ClaudeLaunchRequest): Promise<ClaudeLaunch> {
    DemoData.card(projectID);
    return DemoClaudeTasks.shared.startClaude(
      projectID,
      request.requestId,
      request.model,
      request.permissionMode,
      request.remoteControl,
    );
  }

  async agentProviders(): Promise<AgentProviderList> {
    return { providers: DemoClaudeTasks.shared.list("demo").providers ?? [] };
  }

  async agentModels(projectID: string, provider: AgentProvider): Promise<AgentCapability> {
    DemoData.card(projectID);
    const capability = DemoClaudeTasks.shared.list(projectID).providers?.find((entry) => entry.id === provider);
    if (!capability) throw RuntimeBriefError.notFound();
    return capability;
  }

  async conversation(projectID: string, launchID: string): Promise<ConversationSnapshot> {
    return DemoClaudeTasks.shared.conversation(projectID, launchID);
  }

  async reply(projectID: string, launchID: string, reply: SessionReply): Promise<SessionReplyResult> {
    return DemoClaudeTasks.shared.reply(projectID, launchID, reply);
  }

  sessions(projectID: string): Promise<ClaudeLaunchList> {
    return this.claudeLaunches(projectID);
  }

  async startSession(projectID: string, request: SessionLaunchRequest): Promise<ClaudeLaunch> {
    DemoData.card(projectID);
    return DemoClaudeTasks.shared.start(projectID, request);
  }

  async terminal(projectID: string, launchID: string): Promise<TerminalSnapshot> {
    DemoData.card(projectID);
    return DemoClaudeTasks.shared.terminal(projectID, launchID);
  }

  async sendInput(projectID: string, launchID: string, input: TerminalInput): Promise<TerminalInputResult> {
    DemoData.card(projectID);
    return DemoClaudeTasks.shared.input(projectID, launchID, input);
  }

  async openClaude(projectID: string, launchID: string): Promise<ClaudeLaunch> {
    DemoData.card(projectID);
    const launch = DemoClaudeTasks.shared.list(projectID).launches.find((entry) => entry.id === launchID);
    if (!launch) throw RuntimeBriefError.notFound();
    return launch;
  }

  async projects(): Promise<ProjectSummary[]> {
    return DemoData.projects;
  }

  async project(id: string): Promise<ProjectCard> {
    return DemoData.card(id);
  }

  async status(projectID: string): Promise<AnalystAnswer> {
    return DemoData.analystAnswer(projectID);
  }

  async voiceStatus(projectID: string): Promise<VoiceStatus> {
    const answer = DemoData.analystAnswer(projectID);
    return {
      answer: answer.answer,
      analyzedAt: new Date(),
      model: "fictional demo",
      evidence: answer.evidence ?? [],
      refreshing: false,
      unavailable: false,
    };
  }

  async ask(projectID: string, question: string): Promise<AnalystAnswer> {
    return DemoData.analystAnswer(projectID, question);
  }

  streamStatus(projectID: string): AsyncGenerator<AnalystStreamEvent> {
    return demoStream(projectID, null);
  }

  streamAsk(projectID: string, question: string): AsyncGenerator<AnalystStreamEvent> {
    return demoStream(projectID, question);
  }
}

async function* demoStream(projectID: string, question: string | null): AsyncGenerator<AnalystStreamEvent> {
  const answer = DemoData.analystAnswer(projectID, question);
  yield { type: "done", answer };
}
