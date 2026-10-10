import { useCallback, useEffect, useMemo, useState } from "react";
import { useAgentSessionsStore, useDemoMode, usePolling } from "../lib/hooks";
import {
  AGENT_PROVIDERS,
  CLAUDE_MODELS,
  CLAUDE_PERMISSION_MODES,
  claudeModelLabel,
  claudePermissionExplanation,
  claudePermissionLabel,
  launchAgent,
  launchSettingsLabel,
  launchStateLabel,
  makeCapability,
  providerLabel,
  providerModes,
  providerPermissionExplanation,
  providerPermissionLabel,
  remoteControlLabel,
  remoteControlNativeURL,
  type AgentCapability,
  type AgentModel,
  type AgentProvider,
  type ClaudeLaunch,
  type ClaudePermissionMode,
} from "../models/claudeLaunch";
import { SessionTaskPrompt } from "../models/sessionTaskPrompt";
import type { ProjectSummary } from "../models/types";
import { AgentSessionsStore } from "../networking/agentSessionsStore";
import { RuntimeBriefDataSourceFactory, RuntimeBriefModeStore, type RuntimeBriefDataSource } from "../networking/dataSource";
import { SessionLaunchDraft, type SessionDraftIdentity } from "../networking/drafts";
import { RuntimeBriefError, describeError } from "../networking/errors";
import { ServerSettingsStore } from "../networking/serverSettings";
import { ErrorBanner, MenuPicker, ProgressView, RelativeTimeText, Toggle } from "./components";
import { Symbol } from "./icons";
import { SessionConversationView } from "./SessionConversationView";
import { SessionTerminalView } from "./SessionTerminalView";
import { Sheet } from "./Sheet";

const DISABLED_MESSAGE = "Starting tasks is disabled for this project.";

/** One launch surface; the conversation and all tool approvals stay in the native agent. */
export function ClaudeLaunchView({ project }: { project: ProjectSummary }) {
  const store = AgentSessionsStore.shared;
  const state = useAgentSessionsStore();
  const isDemo = useDemoMode();
  const list = state.lists[project.id] ?? null;
  const capabilities: AgentCapability[] = useMemo(() => {
    const values = list?.providers;
    if (values && values.some((capability) => capability.message === DISABLED_MESSAGE)) return values;
    return state.providers.length === 0 ? (values ?? []) : state.providers;
  }, [list?.providers, state.providers]);

  const [showingComposer, setShowingComposer] = useState(false);
  const [conversationLaunch, setConversationLaunch] = useState<ClaudeLaunch | null>(null);
  const [terminalLaunch, setTerminalLaunch] = useState<ClaudeLaunch | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [openingID, setOpeningID] = useState<string | null>(null);
  const [openMessage, setOpenMessage] = useState<string | null>(null);

  const source = RuntimeBriefDataSourceFactory.current();

  const refresh = useCallback(async () => {
    await store.refresh(project.id);
    setErrorMessage(store.errors[project.id] ?? null);
  }, [store, project.id]);

  useEffect(() => {
    store.cached(project.id);
    void store.warm();
    void refresh();
  }, [store, project.id, refresh]);

  usePolling(refresh, 3000);

  const open = async (launch: ClaudeLaunch) => {
    setOpeningID(launch.id);
    try {
      await source.openClaude(project.id, launch.id);
      setOpenMessage(
        RuntimeBriefModeStore.isDemoEnabled
          ? "Demo only. No app was opened."
          : "The conversation is in Claude Desktop. Choose its RuntimeBrief task in the sidebar. Check Desktop's permission mode, then send a follow-up to continue any interrupted work.",
      );
      await refresh();
    } catch (error) {
      setErrorMessage(describeError(error));
    } finally {
      setOpeningID(null);
    }
  };

  const disabled = capabilities.some((capability) => capability.message === DISABLED_MESSAGE);
  const checking = capabilities.some((capability) => capability.checking === true);
  const launches = (list?.launches ?? []).slice(0, 5);

  return (
    <div className="card orange stack g12" data-testid="coding-agents-card">
      <div className="row between">
        <span className="label-row centered t-headline" data-testid="coding-agents-section-title">
          <span className="label-icon">
            <Symbol name="terminal" size={20} strokeWidth={1.75} />
          </span>
          <span>Coding agents</span>
        </span>
        <button
          type="button"
          className="icon-button"
          onClick={() => void refresh()}
          aria-label="Refresh agent tasks"
          data-testid="refresh-agent-tasks"
        >
          <Symbol name="arrow.clockwise" size={20} />
        </button>
      </div>
      <span className="t-subheadline c-secondary">Start a task on your Mac and continue its conversation.</span>
      <div>
        <button
          type="button"
          className="btn prominent regular"
          onClick={() => setShowingComposer(true)}
          disabled={disabled}
          data-testid="new-claude-task"
        >
          <Symbol name="plus" size={18} strokeWidth={2.25} />
          New task
        </button>
      </div>
      {checking ? (
        <span className="label-row centered t-caption c-secondary">
          <span className="label-icon">
            <Symbol name="arrow.triangle.2.circlepath" size={13} />
          </span>
          <span>Checking available agents…</span>
        </span>
      ) : null}
      {state.savedProjects.has(project.id) ? (
        <span className="t-caption c-secondary">Showing saved tasks while refreshing.</span>
      ) : null}
      {errorMessage ? <ErrorBanner message={errorMessage} /> : null}
      {openMessage ? <span className="t-caption c-secondary">{openMessage}</span> : null}
      {launches.map((launch) => (
        <LaunchCard
          key={launch.id}
          launch={launch}
          isDemo={isDemo}
          openingID={openingID}
          onContinueDemo={() => setOpenMessage("Demo only. No session was opened.")}
          onOpenConversation={() => setConversationLaunch(launch)}
          onFinishSetup={() => setTerminalLaunch(launch)}
          onOpenDesktop={() => void open(launch)}
        />
      ))}
      {showingComposer ? (
        <ClaudeTaskComposer
          project={project}
          source={source}
          providers={capabilities}
          onDismiss={() => {
            setShowingComposer(false);
            void refresh();
          }}
        />
      ) : null}
      {terminalLaunch ? (
        <SessionTerminalView project={project} launch={terminalLaunch} source={source} onDismiss={() => setTerminalLaunch(null)} />
      ) : null}
      {conversationLaunch ? (
        <SessionConversationView
          project={project}
          launch={conversationLaunch}
          source={source}
          onDismiss={() => setConversationLaunch(null)}
        />
      ) : null}
    </div>
  );
}

function LaunchCard({
  launch,
  isDemo,
  openingID,
  onContinueDemo,
  onOpenConversation,
  onFinishSetup,
  onOpenDesktop,
}: {
  launch: ClaudeLaunch;
  isDemo: boolean;
  openingID: string | null;
  onContinueDemo: () => void;
  onOpenConversation: () => void;
  onFinishSetup: () => void;
  onOpenDesktop: () => void;
}) {
  const agent = launchAgent(launch);
  const remote = launch.remoteControl;
  const nativeURL = remote ? remoteControlNativeURL(remote) : null;
  return (
    <div className="launch-card stack g8" data-testid={`claude-launch-${launch.id}`}>
      <div className="row between">
        <span className="t-subheadline w-semibold">{providerLabel(agent)}</span>
        <span className="t-subheadline w-medium">{launchStateLabel(launch)}</span>
      </div>
      <RelativeTimeText date={launch.createdAt} />
      <span className="t-caption c-secondary">{launch.message}</span>
      <span className="t-caption w-medium">Started with {launchSettingsLabel(launch)}</span>
      {remote ? (
        <>
          <span className="t-caption c-secondary">
            {agent === "claude"
              ? remoteControlLabel(remote)
              : remote.state === "ready"
                ? "Conversation connected"
                : remote.state === "disabled"
                  ? "Continuation off"
                  : "Conversation offline"}
          </span>
          {agent === "claude" && remote.state === "ready" && isDemo ? (
            <button type="button" className="btn plain" onClick={onContinueDemo} data-testid={`remote-control-${launch.id}`}>
              Continue in Claude
            </button>
          ) : remote.state === "ready" && nativeURL ? (
            <a href={nativeURL.toString()} target="_blank" rel="noopener noreferrer" data-testid={`remote-control-${launch.id}`}>
              Continue in Claude
            </a>
          ) : null}
        </>
      ) : null}
      {agent !== "claude" && launch.backend?.startsWith("native-") && launch.nativeId !== null ? (
        <button type="button" className="btn plain" onClick={onOpenConversation} data-testid="open-session-conversation">
          <Symbol name="bubble.left.and.bubble.right" size={16} />
          Open conversation
        </button>
      ) : null}
      {agent === "claude" &&
      launch.backend === "native-claude" &&
      launch.state === "needs_input" &&
      launch.remoteControl?.state !== "ready" &&
      launch.requestedRemoteControl !== false ? (
        <button type="button" className="btn plain" onClick={onFinishSetup} data-testid="finish-claude-setup">
          <Symbol name="checkmark.shield" size={16} />
          Finish Claude setup
        </button>
      ) : null}
      {launch.nativeId !== null && launch.backend === null ? (
        <>
          <span className="t-caption mono c-secondary">Session {launch.nativeId}</span>
          <button
            type="button"
            className="btn plain"
            onClick={onOpenDesktop}
            disabled={openingID !== null}
            data-testid={`take-over-claude-${launch.id}`}
          >
            <Symbol name="macwindow" size={16} />
            {openingID === launch.id ? "Opening…" : launch.openedAt === null ? "Open in Claude Desktop" : "Open Claude Desktop"}
          </button>
        </>
      ) : null}
      {launch.backend === null && launch.openedAt === null && launch.nativeId !== null ? (
        <span className="t-caption2 c-secondary">
          Moves the saved conversation to Desktop and stops any current response. Desktop may apply its own permission mode.
        </span>
      ) : null}
    </div>
  );
}

function capitalize(value: string): string {
  return value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);
}

function ClaudeTaskComposer({
  project,
  source,
  providers,
  onDismiss,
}: {
  project: ProjectSummary;
  source: RuntimeBriefDataSource;
  providers: AgentCapability[];
  onDismiss: () => void;
}) {
  const [loadedCapabilities, setLoadedCapabilities] = useState<Partial<Record<AgentProvider, AgentCapability>>>({});
  const [modelsLoading, setModelsLoading] = useState(false);
  const [provider, setProvider] = useState<AgentProvider>("claude");
  const [nativeModel, setNativeModel] = useState("default");
  const [nativeMode, setNativeMode] = useState("manual");
  const [prompt, setPrompt] = useState("");
  const [sending, setSending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reasoningEffort, setReasoningEffort] = useState("default");
  const [permissionMode, setPermissionMode] = useState<ClaudePermissionMode>("manual");
  const [remoteControl, setRemoteControl] = useState(true);
  const isDemo = useDemoMode();

  const taskPrompt = prompt.trim();
  const isValid = SessionTaskPrompt.isValid(taskPrompt);
  const capability = loadedCapabilities[provider] ?? providers.find((entry) => entry.id === provider) ?? null;
  const selectedModel = nativeModel;
  const modelChoices: AgentModel[] =
    capability?.models ??
    (provider === "claude"
      ? CLAUDE_MODELS.filter((model) => model !== "default").map((model) => ({
          id: model,
          label: claudeModelLabel(model),
          reasoningEfforts: null,
        }))
      : []);
  const reasoningChoices = (() => {
    const id = selectedModel === "default" ? capability?.defaultModelLabel : selectedModel;
    return modelChoices.find((model) => model.id === id)?.reasoningEfforts ?? [];
  })();
  const selectedMode = provider === "claude" ? permissionMode : nativeMode;

  useEffect(() => {
    let cancelled = false;
    const selected = provider;
    setModelsLoading(true);
    void (async () => {
      try {
        const value = await source.agentModels(project.id, selected);
        if (!cancelled) setLoadedCapabilities((current) => ({ ...current, [selected]: value }));
      } catch (error) {
        if (RuntimeBriefError.is(error, "notFound")) {
          setLoadedCapabilities((current) => ({
            ...current,
            [selected]: makeCapability(selected, false, "Update RuntimeBrief on your Mac to use native sessions."),
          }));
        }
        // Otherwise keep the native default usable if catalog discovery fails.
      } finally {
        if (!cancelled) setModelsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [provider, project.id, source]);

  const changeProvider = (value: string) => {
    setProvider(value as AgentProvider);
    setNativeMode("manual");
    setPermissionMode("manual");
    setNativeModel("default");
    setReasoningEffort("default");
  };

  const submit = async () => {
    if (sending || !isValid) return;
    setSending(true);
    setErrorMessage(null);
    const scope = ServerSettingsStore.draftScope(RuntimeBriefModeStore.isDemoEnabled);
    const identity: SessionDraftIdentity = {
      projectID: project.id,
      scope,
      prompt: taskPrompt,
      provider,
      model: selectedModel,
      permissionMode: selectedMode,
      reasoningEffort,
      remoteControl,
    };
    const expectedConnection = AgentSessionsStore.shared.connectionScope();
    try {
      const request = await SessionLaunchDraft.request(identity);
      const receipt = await source.startSession(project.id, request);
      AgentSessionsStore.shared.remember(receipt, expectedConnection);
      if (receipt.state === "failed") {
        await SessionLaunchDraft.clear(identity);
        setErrorMessage(receipt.message);
      } else {
        // Keep uncertain requests stable across reconnects and reloads.
        if (receipt.state !== "unknown") await SessionLaunchDraft.clear(identity);
        onDismiss();
      }
    } catch (error) {
      setErrorMessage(
        `${describeError(error)} Your task may have started. Retrying this task uses the same request ID; you can also close this sheet and refresh agent tasks.`,
      );
    } finally {
      setSending(false);
    }
  };

  const permissionOptions =
    provider === "claude"
      ? CLAUDE_PERMISSION_MODES.map((mode) => ({ value: mode, label: claudePermissionLabel(mode) }))
      : (capability?.permissionModes ?? providerModes(provider)).map((mode) => ({
          value: mode,
          label: providerPermissionLabel(provider, mode),
        }));

  const reasoningDefaultLabel =
    selectedModel === "default" ? capitalize(capability?.defaultReasoningLabel ?? "Native") : "Mac settings";

  return (
    <Sheet
      title="New task"
      onDismiss={onDismiss}
      dismissDisabled={sending}
      testId="task-composer"
      leading={
        <button type="button" className="glass-button" onClick={onDismiss} disabled={sending} data-testid="composer-cancel">
          Cancel
        </button>
      }
      footer={
        <button
          type="button"
          className="btn prominent full"
          onClick={() => void submit()}
          disabled={!isValid || sending || capability?.available !== true}
          data-testid="start-claude-task"
        >
          {sending ? <ProgressView small /> : null}
          {sending ? "Starting…" : `Start in ${providerLabel(provider)}`}
        </button>
      }
    >
      <div className="form" aria-disabled={sending}>
        <section className="form-section">
          <div className="form-group">
            <div className="form-row">
              <span className="label-row centered" style={{ flex: 1 }}>
                <span className="label-icon c-blue">
                  <Symbol name="folder" size={20} strokeWidth={1.75} />
                </span>
                <span>{project.name}</span>
              </span>
            </div>
            <div className="form-row">
              <span className="t-subheadline c-secondary">Runs on your Mac using your {providerLabel(provider)} account.</span>
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-header">Task</div>
          <div className="form-group">
            <div className="form-row column">
              <textarea
                className="form-textarea"
                placeholder="What should the agent work on?"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                disabled={sending}
                rows={3}
                aria-label="Task"
                data-testid="claude-task-prompt"
              />
              {taskPrompt.length > 0 && !isValid ? (
                <span className="form-row-note">{SessionTaskPrompt.validationMessage}</span>
              ) : null}
            </div>
          </div>
        </section>

        <section className="form-section">
          <div className="form-group">
            <MenuPicker
              label="Agent"
              value={provider}
              secondary
              disabled={sending}
              onChange={changeProvider}
              options={AGENT_PROVIDERS.map((entry) => ({ value: entry, label: providerLabel(entry) }))}
              testId="session-provider-picker"
            />
            {capability ? (
              <div className="form-row">
                <span className={`form-row-note ${capability.available ? "" : "orange"}`}>{capability.message}</span>
              </div>
            ) : null}
            <MenuPicker
              label="Model"
              value={nativeModel}
              disabled={sending}
              onChange={(value) => {
                setNativeModel(value);
                setReasoningEffort("default");
              }}
              options={[
                { value: "default", label: `${providerLabel(provider)} default` },
                ...modelChoices.map((model) => ({ value: model.id, label: model.label })),
              ]}
              testId={provider === "claude" ? "claude-model-picker" : "session-model-picker"}
            />
            {selectedModel === "default" && capability?.defaultModelLabel ? (
              <div className="form-row">
                <span className="form-row-note">Default: {capability.defaultModelLabel}</span>
              </div>
            ) : null}
            {capability?.modelsMessage ? (
              <div className="form-row">
                <span className="form-row-note">{capability.modelsMessage}</span>
              </div>
            ) : capability?.models === null && provider !== "claude" ? (
              <div className="form-row">
                <span className="form-row-note">{modelsLoading ? "Loading models…" : "Using your Mac’s default model."}</span>
              </div>
            ) : null}
            {reasoningChoices.length > 0 ? (
              <MenuPicker
                label="Reasoning"
                value={reasoningEffort}
                disabled={sending}
                onChange={setReasoningEffort}
                options={[
                  { value: "default", label: `Default (${reasoningDefaultLabel})` },
                  ...reasoningChoices.map((effort) => ({
                    value: effort,
                    label: effort === "xhigh" ? "Extra High" : capitalize(effort),
                  })),
                ]}
                testId="session-reasoning-picker"
              />
            ) : capability?.models !== null && capability?.models !== undefined ? (
              <>
                <div className="form-row">
                  <span className="form-row-label">Reasoning</span>
                  <span className="c-secondary">Native default</span>
                </div>
                <div className="form-row">
                  <span className="form-row-note">This model doesn’t expose a reasoning setting.</span>
                </div>
              </>
            ) : null}
            {provider === "claude" ? (
              <>
                <MenuPicker
                  label="Permissions"
                  value={permissionMode}
                  disabled={sending}
                  onChange={(value) => setPermissionMode(value as ClaudePermissionMode)}
                  options={permissionOptions}
                  testId="claude-permissions-picker"
                />
                <div className="form-row">
                  <span className={`form-row-note ${permissionMode === "bypassPermissions" ? "orange" : ""}`}>
                    {claudePermissionExplanation(permissionMode)}
                  </span>
                </div>
              </>
            ) : (
              <>
                <MenuPicker
                  label="Permissions"
                  value={nativeMode}
                  disabled={sending}
                  onChange={setNativeMode}
                  options={permissionOptions}
                  testId="session-permissions-picker"
                />
                <div className="form-row">
                  <span className={`form-row-note ${nativeMode === "bypassPermissions" ? "orange" : ""}`}>
                    {providerPermissionExplanation(provider, nativeMode)}
                  </span>
                </div>
              </>
            )}
            <div className="form-row">
              <span className="form-row-label">Remote Control</span>
              <Toggle
                checked={remoteControl}
                onChange={setRemoteControl}
                disabled={sending}
                label="Remote Control"
                testId="claude-remote-control-toggle"
              />
            </div>
            <div className="form-row">
              <span className="form-row-note">
                {provider === "claude"
                  ? "Connect through your Claude account from another device. Availability depends on Claude setup on your Mac."
                  : "Continue this conversation and answer approval requests through your authenticated RuntimeBrief connection."}
              </span>
            </div>
          </div>
          <div className="form-footer">Uses your Mac’s agent installation and account.</div>
        </section>

        {isDemo ? (
          <section className="form-section">
            <div className="form-group">
              <div className="form-row">
                <span className="c-indigo">Demo only. No task will be sent to a Mac.</span>
              </div>
            </div>
          </section>
        ) : null}
        {errorMessage ? (
          <section className="form-section">
            <div className="form-group">
              <div className="form-row">
                <span className="c-red" data-testid="claude-launch-error">
                  {errorMessage}
                </span>
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </Sheet>
  );
}
