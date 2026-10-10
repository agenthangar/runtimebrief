import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { DemoClaudeTasks } from "../src/demo/demoClaudeTasks";
import type { ClaudeLaunch, ConversationSnapshot } from "../src/models/claudeLaunch";
import type { ProjectSummary } from "../src/models/types";
import { RuntimeBriefModeStore, type RuntimeBriefDataSource } from "../src/networking/dataSource";
import { AgentSessionsStore } from "../src/networking/agentSessionsStore";
import { ProjectsStore } from "../src/networking/projectsStore";
import { ServerSettingsStore } from "../src/networking/serverSettings";
import { SessionConversationView } from "../src/views/SessionConversationView";
import { SettingsView } from "../src/views/SettingsView";

function resetSingletons(): void {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.location.hash = "";
  RuntimeBriefModeStore.setDemoEnabled(false);
  ServerSettingsStore.reset();
  ProjectsStore.resetForTesting();
  AgentSessionsStore.resetForTesting();
  DemoClaudeTasks.resetForTesting();
}

function stubFetch(stubs: Record<string, { status?: number; body?: string; throws?: Error }>): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, "http://127.0.0.1").pathname;
    const key = Object.keys(stubs).find((suffix) => path.endsWith(suffix));
    if (!key) return new Response("not found", { status: 404 });
    const stub = stubs[key]!;
    if (stub.throws) throw stub.throws;
    return new Response(stub.body ?? "", { status: stub.status ?? 200, headers: { "content-type": "application/json" } });
  });
}

async function enterDemo(): Promise<void> {
  const explore = await screen.findByTestId("explore-demo");
  await userEvent.click(explore);
  await screen.findByTestId("demo-data-banner");
  await screen.findByTestId("portfolio-brief-list");
}

async function openSampleTracker(): Promise<void> {
  await userEvent.click(await screen.findByTestId("project-link-demo-sample-tracker"));
  await screen.findByTestId("demo-detail-banner");
}

function following(first: HTMLElement, second: HTMLElement): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

beforeEach(() => {
  resetSingletons();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetSingletons();
});

describe("first-launch demo", () => {
  it("walks the offline portfolio, stripped analysis, ask thread, and exit", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(await screen.findByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByTestId("explore-demo")).toBeInTheDocument();
    expect(screen.getByTestId("connect-your-mac")).toBeInTheDocument();
    expect(screen.getByTestId("open-settings")).toBeInTheDocument();

    await enterDemo();
    expect(screen.queryByTestId("open-settings")).not.toBeInTheDocument();
    expect(screen.getByTestId("exit-demo")).toBeInTheDocument();
    expect(screen.getByTestId("project-link-demo-sample-tracker")).toHaveTextContent("Sample Tracker");
    expect(screen.getByTestId("project-link-demo-catalog-builder")).toHaveTextContent("Catalog Builder");
    expect(screen.getByTestId("project-link-demo-weather-widget")).toHaveTextContent("Weather Widget");
    expect(screen.getByTestId("project-activity-demo-sample-tracker")).toHaveTextContent("Last activity");
    expect(screen.getByTestId("project-activity-demo-sample-tracker")).toHaveTextContent("35 minutes ago");

    await openSampleTracker();
    const analyst = await screen.findByTestId("analyst-update-text");
    expect(analyst).toHaveTextContent("ready for review");
    expect(analyst.textContent).not.toContain("[demo-evidence-");
    expect(screen.queryByText("Commit a1b2c3d")).not.toBeInTheDocument();
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.queryByTestId("evidence-source")).not.toBeInTheDocument();
    expect(screen.queryByTestId("generate-analyst-update")).not.toBeInTheDocument();
    expect(screen.getByText("Demo response")).toBeInTheDocument();

    const analystToggle = screen.getByTestId("analyst-section-toggle");
    const briefToggle = screen.getByTestId("brief-section-toggle");
    const askToggle = screen.getByTestId("ask-section-toggle");
    const sessionsToggle = screen.getByTestId("sessions-section-toggle");
    const newTask = screen.getByTestId("new-claude-task");
    const commitsToggle = screen.getByTestId("commits-section-toggle");
    const releaseToggle = screen.getByTestId("ios-release-section-toggle");
    expect(analystToggle).toHaveAttribute("data-value", "Expanded");
    for (const toggle of [briefToggle, askToggle, sessionsToggle, commitsToggle, releaseToggle]) {
      expect(toggle).toHaveAttribute("data-value", "Collapsed");
    }
    expect(following(analystToggle, briefToggle)).toBe(true);
    expect(following(briefToggle, askToggle)).toBe(true);
    expect(following(askToggle, sessionsToggle)).toBe(true);
    expect(following(sessionsToggle, newTask)).toBe(true);
    expect(following(newTask, commitsToggle)).toBe(true);
    expect(following(commitsToggle, releaseToggle)).toBe(true);

    await user.click(briefToggle);
    expect(briefToggle).toHaveAttribute("data-value", "Expanded");
    expect(screen.getAllByTestId("project-brief-claim").length).toBeGreaterThan(0);
    await user.click(briefToggle);
    expect(briefToggle).toHaveAttribute("data-value", "Collapsed");

    await user.click(askToggle);
    const question = await screen.findByTestId("demo-question-field");
    await user.type(question, "Did the fictional checks pass?");
    await user.click(screen.getByTestId("submit-project-question"));
    const answer = await screen.findByTestId("project-answer");
    await waitFor(() => expect(answer).toHaveTextContent("fictional demo response"));
    expect(answer.textContent).not.toContain("[demo-evidence-");
    expect(screen.queryByText("Evidence")).not.toBeInTheDocument();
    expect(screen.getAllByText("Demo response").length).toBeGreaterThan(0);

    await user.click(screen.getByTestId("back-button"));
    await user.click(await screen.findByTestId("exit-demo"));
    expect(await screen.findByTestId("explore-demo")).toBeInTheDocument();
    expect(screen.queryByTestId("demo-data-banner")).not.toBeInTheDocument();
  });

  it("keeps Explore Demo visible while a live refresh is in flight", async () => {
    ServerSettingsStore.save("http://127.0.0.1:8484", "test-token");
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    render(<App />);
    expect(await screen.findByTestId("explore-demo")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-brief-list")).not.toBeInTheDocument();
  });

  it("keeps Explore Demo visible after Exit Demo while refresh is in flight", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDemo();
    ServerSettingsStore.save("http://127.0.0.1:8484", "test-token");
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    await user.click(screen.getByTestId("exit-demo"));
    expect(await screen.findByTestId("explore-demo")).toBeInTheDocument();
    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.queryByTestId("portfolio-brief-list")).not.toBeInTheDocument();
  });
});

describe("task composer and conversation", () => {
  it("validates the prompt, keeps Claude after a Codex detour, and shows a demo receipt", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDemo();
    await openSampleTracker();

    await user.click(await screen.findByTestId("new-claude-task"));
    const composer = await screen.findByTestId("task-composer");
    const start = within(composer).getByTestId("start-claude-task");
    expect(start).toBeDisabled();
    expect(within(composer).getByTestId("claude-remote-control-toggle")).toHaveAttribute("aria-checked", "true");
    expect(composer).toHaveTextContent("Demo only. No task will be sent to a Mac.");

    const prompt = within(composer).getByTestId("claude-task-prompt");
    await user.type(prompt, "/status");
    expect(composer).toHaveTextContent("Describe a task of up to 8,000 characters");
    expect(start).toBeDisabled();
    await user.clear(prompt);

    await user.selectOptions(within(composer).getByTestId("session-provider-picker"), "codex");
    expect(await within(composer).findByTestId("session-model-picker")).toBeInTheDocument();
    expect(start).toHaveTextContent("Start in Codex");
    await user.selectOptions(within(composer).getByTestId("session-provider-picker"), "claude");
    expect(await within(composer).findByTestId("claude-model-picker")).toBeInTheDocument();
    expect(start).toHaveTextContent("Start in Claude Code");

    await user.selectOptions(within(composer).getByTestId("claude-model-picker"), "sonnet");
    await user.selectOptions(within(composer).getByTestId("claude-permissions-picker"), "bypassPermissions");
    await user.type(prompt, "Review the fictional export validation");
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);

    await waitFor(() => expect(screen.queryByTestId("task-composer")).not.toBeInTheDocument());
    expect(await screen.findByText("Demo task ready to review. No work was sent to a Mac.")).toBeInTheDocument();
    expect(screen.getByText("Started with Sonnet · Bypass")).toBeInTheDocument();
    expect(screen.getByText("Remote Control connected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue in Claude" }));
    expect(await screen.findByText("Demo only. No session was opened.")).toBeInTheDocument();
  });

  it("opens a Codex conversation and delivers a fictional follow-up", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDemo();
    await openSampleTracker();

    await user.click(await screen.findByTestId("new-claude-task"));
    const composer = await screen.findByTestId("task-composer");
    await user.selectOptions(within(composer).getByTestId("session-provider-picker"), "codex");
    await user.type(within(composer).getByTestId("claude-task-prompt"), "x");
    const start = within(composer).getByTestId("start-claude-task");
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);

    await user.click(await screen.findByTestId("open-session-conversation"));
    const conversation = await screen.findByTestId("session-conversation");
    expect(conversation).toHaveTextContent("Fictional conversation");
    const input = within(conversation).getByTestId("session-conversation-input");
    await user.type(input, "FOLLOW-UP-UI");
    await user.click(within(conversation).getByTestId("session-conversation-send"));
    await waitFor(() => expect(conversation).toHaveTextContent("Demo received your response"));
    expect(conversation).toHaveTextContent("FOLLOW-UP-UI");
  });

  it("accepts a short Claude prompt and shows Ready to review", async () => {
    const user = userEvent.setup();
    render(<App />);
    await enterDemo();
    await openSampleTracker();
    await user.click(await screen.findByTestId("new-claude-task"));
    const composer = await screen.findByTestId("task-composer");
    await user.type(within(composer).getByTestId("claude-task-prompt"), "ok");
    const start = within(composer).getByTestId("start-claude-task");
    await waitFor(() => expect(start).toBeEnabled());
    await user.click(start);
    expect(await screen.findByText("Ready to review")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue in Claude" })).toBeInTheDocument();
  });

  it("freezes approval questions while a retry is pending", async () => {
    const user = userEvent.setup();
    const snapshot: ConversationSnapshot = {
      state: "waiting",
      message: "Needs a reply",
      writable: true,
      messages: [],
      requests: [
        {
          id: "req-1",
          title: "Which file?",
          body: "Pick a path.",
          options: [],
          questions: [
            { id: "q1", prompt: "File", options: [{ id: "a", label: "A" }, { id: "b", label: "B" }] },
            { id: "q2", prompt: "Note", options: [] },
          ],
        },
      ],
    };
    const source = {
      conversation: async () => snapshot,
      reply: async () => {
        throw new Error("Delivery failed");
      },
    } as unknown as RuntimeBriefDataSource;
    const project: ProjectSummary = {
      id: "p",
      name: "P",
      lastActivityAt: null,
      branch: "main",
      dirty: false,
      brief: null,
    };
    const launch: ClaudeLaunch = {
      id: "launch-1",
      projectId: "p",
      name: "Task",
      createdAt: new Date(),
      state: "needs_input",
      message: "Question waiting",
      nativeId: "native",
      sessionId: null,
      cwd: "/tmp",
      openedAt: null,
      model: "default",
      reasoningEffort: null,
      effectiveReasoningEffort: null,
      permissionMode: "manual",
      backend: "native-codex",
      tmuxTarget: null,
      launchState: null,
      activity: null,
      requestedRemoteControl: true,
      remoteControl: { state: "ready", url: null },
      provider: "codex",
    };
    render(<SessionConversationView project={project} launch={launch} source={source} onDismiss={() => undefined} />);
    const select = await screen.findByTestId("session-question-q1");
    const input = screen.getByTestId("session-question-q2");
    await user.selectOptions(select, "a");
    await user.type(input, "note");
    await user.click(screen.getByTestId("session-send-answers"));
    expect(await screen.findByText("Delivery failed")).toBeInTheDocument();
    expect(screen.getByText("Retry same response")).toBeInTheDocument();
    expect(select).toBeDisabled();
    expect(input).toBeDisabled();
    expect(screen.getByTestId("session-send-answers")).toBeDisabled();
  });
});

describe("SettingsView", () => {
  it("tests a usable connection and keeps Siri discovery off this platform", async () => {
    const user = userEvent.setup();
    stubFetch({
      "/v1/health": { body: JSON.stringify({ version: "1.0.2", uptime: 12 }) },
      "/v1/projects": {
        body: JSON.stringify([
          { id: "meal", name: "Sample Tracker App", lastActivityAt: null, branch: "main", dirty: false },
        ]),
      },
    });
    const onDismiss = vi.fn();
    render(<SettingsView onDismiss={onDismiss} />);

    expect(screen.queryByText("Make Projects Discoverable")).not.toBeInTheDocument();
    expect(screen.queryByTestId("siri-discovery-toggle")).not.toBeInTheDocument();
    expect(screen.getByText(/local storage/i)).toBeInTheDocument();

    await user.clear(screen.getByTestId("settings-server"));
    await user.type(screen.getByTestId("settings-server"), "http://127.0.0.1:8484");
    await user.type(screen.getByTestId("settings-token"), "test-token");
    await user.click(screen.getByTestId("test-connection"));
    expect(await screen.findByTestId("test-result")).toHaveTextContent("Connected — 1 projects loaded");
  });

  it("reports project-refresh and unauthorized failures without saving", async () => {
    const user = userEvent.setup();
    stubFetch({
      "/v1/health": { body: JSON.stringify({ version: "1.0.2", uptime: 1 }) },
      "/v1/projects": { status: 500, body: "{}" },
    });
    const onDismiss = vi.fn();
    render(<SettingsView onDismiss={onDismiss} />);
    await user.clear(screen.getByTestId("settings-server"));
    await user.type(screen.getByTestId("settings-server"), "https://mac.example.ts.net");
    await user.type(screen.getByTestId("settings-token"), "bad");
    await user.click(screen.getByTestId("test-connection"));
    expect(await screen.findByTestId("test-result")).toHaveTextContent("project data couldn't load");
    expect(onDismiss).not.toHaveBeenCalled();

    stubFetch({
      "/v1/health": { status: 401, body: "{}" },
    });
    await user.click(screen.getByTestId("test-connection"));
    expect(await screen.findByTestId("test-result")).toHaveTextContent("The daemon rejected the token");
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe("live portfolio", () => {
  it("shows a dirty-dot when a live project has no brief", async () => {
    ServerSettingsStore.save("http://127.0.0.1:8484", "test-token");
    stubFetch({
      "/v1/projects": {
        body: JSON.stringify([{ id: "ghost", name: "Ghost", lastActivityAt: null, branch: "main", dirty: true }]),
      },
      "/v1/providers": { body: JSON.stringify({ providers: [] }) },
    });
    render(<App />);
    expect(await screen.findByTestId("project-link-ghost")).toHaveTextContent("Ghost");
    expect(screen.getByRole("img", { name: "uncommitted changes" })).toBeInTheDocument();
    expect(screen.queryByTestId("brief-headline-ghost")).not.toBeInTheDocument();
    expect(screen.getByTestId("project-activity-ghost")).toHaveTextContent("no recent activity");
  });

  it("keeps a saved brief after a network failure", async () => {
    ServerSettingsStore.save("http://127.0.0.1:8484", "test-token");
    stubFetch({
      "/v1/projects": {
        body: JSON.stringify([
          {
            id: "meal",
            name: "Sample Tracker App",
            lastActivityAt: "2026-07-09T10:00:00.000Z",
            branch: "main",
            dirty: false,
            brief: {
              state: "recent",
              headline: "Recent work is ready to review",
              headlineEvidence: [],
              updatedAt: "2026-07-09T10:00:00.000Z",
              activeSessionCount: 0,
              claims: [],
            },
          },
        ]),
      },
      "/v1/providers": { body: JSON.stringify({ providers: [] }) },
    });
    const first = render(<App />);
    expect(await screen.findByTestId("brief-headline-meal")).toHaveTextContent("Recent work is ready to review");
    first.unmount();

    stubFetch({
      "/v1/projects": { throws: new TypeError("Failed to fetch") },
    });
    render(<App />);
    expect(await screen.findByTestId("saved-brief-banner")).toHaveTextContent("Showing the brief saved");
    expect(screen.getByTestId("brief-headline-meal")).toHaveTextContent("Recent work is ready to review");
    expect(screen.getByTestId("error-banner")).toHaveTextContent("Couldn't reach your Mac");
  });

  it("stays empty on a first-run 401 so a previous connection is not revealed", async () => {
    ServerSettingsStore.save("http://127.0.0.1:8484", "wrong-token");
    stubFetch({
      "/v1/projects": { status: 401, body: "{}" },
      "/v1/providers": { status: 401, body: "{}" },
    });
    render(<App />);
    expect(await screen.findByTestId("empty-state")).toHaveTextContent("The daemon rejected the token");
    expect(screen.queryByTestId("portfolio-brief-list")).not.toBeInTheDocument();
    expect(screen.queryByTestId("saved-brief-banner")).not.toBeInTheDocument();
  });
});
