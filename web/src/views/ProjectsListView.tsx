import { useCallback, useEffect, useRef, useState } from "react";
import { useDemoMode, useOnBecomeActive, usePullToRefresh } from "../lib/hooks";
import { ProjectNavigation } from "../lib/navigation";
import type { ProjectSummary } from "../models/types";
import { AgentSessionsStore } from "../networking/agentSessionsStore";
import { RuntimeBriefModeStore } from "../networking/dataSource";
import { describeError } from "../networking/errors";
import { ProjectsStore } from "../networking/projectsStore";
import { DemoData } from "../demo/demoData";
import { formatRelative } from "../lib/relativeTime";
import {
  BriefStateBadge,
  ClaimLabel,
  DirtyDot,
  ErrorBanner,
  MonoLabel,
  ProgressView,
  RelativeTimeText,
} from "./components";
import { Symbol } from "./icons";
import { NavigationScreen } from "./NavigationBar";
import { SettingsView } from "./SettingsView";

export function ProjectsListView() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showingSavedBrief, setShowingSavedBrief] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const isDemoMode = useDemoMode();
  const loading = useRef(false);

  const refresh = useCallback(async () => {
    void AgentSessionsStore.shared.warm();
    if (loading.current) return;
    loading.current = true;
    setIsLoading(true);
    try {
      // A user refresh always asks the daemon for current deterministic
      // briefs. The store persists them for offline launch.
      const fresh = await ProjectsStore.shared.refresh();
      setProjects(fresh);
      void AgentSessionsStore.shared.prefetch(fresh);
      setErrorMessage(null);
      setShowingSavedBrief(false);
      setLastSavedAt(new Date());
    } catch (error) {
      if (error instanceof Error && error.name === "CancellationError") return;
      const snapshot = ProjectsStore.shared.cachedSnapshot();
      setProjects((current) => (current.length === 0 ? snapshot.projects : current));
      setLastSavedAt(snapshot.fetchedAt);
      setShowingSavedBrief(snapshot.projects.length > 0);
      setErrorMessage(describeError(error));
    } finally {
      loading.current = false;
      setIsLoading(false);
    }
  }, []);

  const loadSavedThenRefresh = useCallback(async () => {
    void AgentSessionsStore.shared.warm();
    const snapshot = ProjectsStore.shared.cachedSnapshot();
    void AgentSessionsStore.shared.prefetch(snapshot.projects);
    setProjects((current) => (current.length === 0 ? snapshot.projects : current));
    if (snapshot.projects.length > 0) setLastSavedAt(snapshot.fetchedAt);
    await refresh();
  }, [refresh]);

  useEffect(() => {
    void loadSavedThenRefresh();
  }, [loadSavedThenRefresh]);

  useOnBecomeActive(() => {
    void refresh();
  });

  const { pulling, refreshing } = usePullToRefresh(refresh);

  const enterDemo = () => {
    ProjectNavigation.popToRoot();
    RuntimeBriefModeStore.setDemoEnabled(true);
    setProjects(DemoData.projects);
    setErrorMessage(null);
    setShowingSavedBrief(false);
    setLastSavedAt(null);
    ProjectsStore.shared.invalidate();
  };

  const exitDemo = () => {
    ProjectNavigation.popToRoot();
    RuntimeBriefModeStore.setDemoEnabled(false);
    setProjects([]);
    setErrorMessage(null);
    setShowingSavedBrief(false);
    setLastSavedAt(null);
    ProjectsStore.shared.invalidate();
    void loadSavedThenRefresh();
  };

  const trailing = isDemoMode ? (
    <button type="button" className="glass-button" onClick={exitDemo} data-testid="exit-demo">
      Exit Demo
    </button>
  ) : (
    <button
      type="button"
      className="glass-button icon"
      onClick={() => setShowSettings(true)}
      aria-label="Settings"
      data-testid="open-settings"
    >
      <Symbol name="gearshape" size={20} strokeWidth={1.75} />
    </button>
  );

  const showEmpty = projects.length === 0 && !isLoading;

  return (
    <NavigationScreen title="RuntimeBrief" displayMode="large" trailing={trailing}>
      <div className={`ptr-indicator ${pulling || refreshing ? "active" : ""}`} aria-hidden={!refreshing}>
        {refreshing || pulling ? <ProgressView small /> : null}
      </div>
      {showEmpty ? (
        <EmptyState
          message={errorMessage ?? "Connect to your Mac in Settings, then add projects with `runtimebriefd add-project`."}
          onExploreDemo={enterDemo}
          onConnect={() => setShowSettings(true)}
        />
      ) : (
        <ul className="list" data-testid="portfolio-brief-list" aria-busy={isLoading}>
          {isDemoMode ? (
            <li className="banner c-indigo" data-testid="demo-data-banner">
              <span className="label-icon" style={{ marginTop: 2 }}>
                <Symbol name="sparkles" size={18} />
              </span>
              <span className="t-callout w-semibold">
                Demo Data — every project, path, commit, and response is fictional.
              </span>
            </li>
          ) : null}
          {showingSavedBrief && lastSavedAt ? (
            <li className="banner c-orange" data-testid="saved-brief-banner">
              <span className="label-icon" style={{ marginTop: 2 }}>
                <Symbol name="externaldrive.badge.exclamationmark" size={18} />
              </span>
              <span className="t-callout">Showing the brief saved {formatRelative(lastSavedAt)}.</span>
            </li>
          ) : null}
          {errorMessage ? (
            <li className="list-row no-separator borderless">
              <ErrorBanner message={errorMessage} />
            </li>
          ) : null}
          {projects.map((project) => (
            <li key={project.id} className="list-row" style={{ padding: 0 }} data-testid={`project-row-${project.id}`}>
              <button
                type="button"
                className="nav-link"
                onClick={() => ProjectNavigation.open(project.id)}
                data-testid={`project-link-${project.id}`}
              >
                <span className="nav-link-body">
                  <ProjectRow project={project} />
                </span>
                <span className="chevron">
                  <Symbol name="chevron.right" size={16} strokeWidth={2.5} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {showSettings ? (
        <SettingsView
          onDismiss={() => {
            setShowSettings(false);
            void refresh();
          }}
        />
      ) : null}
    </NavigationScreen>
  );
}

function EmptyState({
  message,
  onExploreDemo,
  onConnect,
}: {
  message: string;
  onExploreDemo: () => void;
  onConnect: () => void;
}) {
  const parts = message.split(/(`[^`]+`)/g);
  return (
    <div className="unavailable" data-testid="empty-state">
      <div className="unavailable-icon">
        <Symbol name="shippingbox" size={52} strokeWidth={1.5} />
      </div>
      <h2>No Projects</h2>
      <p>
        {parts.map((part, index) =>
          part.startsWith("`") && part.endsWith("`") ? (
            <code key={index}>{part.slice(1, -1)}</code>
          ) : (
            <span key={index}>{part}</span>
          ),
        )}
      </p>
      <div className="actions">
        <button type="button" className="btn prominent" onClick={onExploreDemo} data-testid="explore-demo">
          Explore Demo
        </button>
        <button type="button" className="btn plain" onClick={onConnect} data-testid="connect-your-mac">
          Connect Your Mac
        </button>
      </div>
    </div>
  );
}

function ProjectRow({ project }: { project: ProjectSummary }) {
  const activity = (
    <span className="activity" data-testid={`project-activity-${project.id}`}>
      <span>Last activity</span>
      <RelativeTimeText date={project.lastActivityAt} />
    </span>
  );
  const brief = project.brief;
  const firstClaim = brief?.claims[0];
  return (
    <div className="project-row">
      <div className="project-row-head">
        <span className="t-headline">{project.name}</span>
        {brief ? <BriefStateBadge state={brief.state} /> : null}
      </div>
      {brief ? (
        <>
          <span className="t-subheadline w-semibold" data-testid={`brief-headline-${project.id}`}>
            {brief.headline}
          </span>
          {firstClaim ? <ClaimLabel claim={firstClaim} /> : null}
          <div className="project-row-meta">
            {project.branch ? <MonoLabel text={project.branch} /> : <span />}
            {activity}
          </div>
        </>
      ) : (
        <div className="project-row-meta">
          <span className="row">
            <DirtyDot dirty={project.dirty} />
            {project.branch ? <MonoLabel text={project.branch} /> : null}
          </span>
          {activity}
        </div>
      )}
    </div>
  );
}
