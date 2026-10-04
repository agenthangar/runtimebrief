import { useCallback, useEffect, useRef, useState } from "react";
import { useDemoMode } from "../lib/hooks";
import { ProjectNavigation } from "../lib/navigation";
import { EvidencePresentation } from "../models/evidencePresentation";
import type {
  AnalystAnswer,
  EvidenceRef,
  GitSummary,
  IOSReleaseSummary,
  ProjectCard,
  ProjectSummary,
  SessionInfo,
} from "../models/types";
import { RuntimeBriefDataSourceFactory } from "../networking/dataSource";
import { describeError } from "../networking/errors";
import { ClaudeLaunchView } from "./ClaudeLaunchView";
import {
  BriefStateBadge,
  ClaimLabel,
  CollapsibleProjectSection,
  ErrorBanner,
  MonoLabel,
  ProgressView,
  RelativeTimeText,
  SessionStateBadge,
} from "./components";
import { Symbol, type SymbolName } from "./icons";
import { NavigationScreen } from "./NavigationBar";

interface QAEntry {
  id: string;
  question: string;
  answer: string;
  done: boolean;
  evidence: EvidenceRef[];
  cached: boolean;
}

export function ProjectDetailView({ project }: { project: ProjectSummary }) {
  const isDemo = useDemoMode();
  const [card, setCard] = useState<ProjectCard | null>(null);
  const [statusText, setStatusText] = useState("");
  const [statusAnswer, setStatusAnswer] = useState<AnalystAnswer | null>(null);
  const [requestingStatus, setRequestingStatus] = useState(false);
  const [statusUpdatedAt, setStatusUpdatedAt] = useState<Date | null>(null);
  const [statusRefreshing, setStatusRefreshing] = useState(false);
  const [statusUnavailable, setStatusUnavailable] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [thread, setThread] = useState<QAEntry[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [briefExpanded, setBriefExpanded] = useState(false);
  const [releaseExpanded, setReleaseExpanded] = useState(false);
  const [analystExpanded, setAnalystExpanded] = useState(true);
  const [askExpanded, setAskExpanded] = useState(false);
  const [sessionsExpanded, setSessionsExpanded] = useState(false);
  const [commitsExpanded, setCommitsExpanded] = useState(false);
  const requesting = useRef(false);
  const questionField = useRef<HTMLInputElement>(null);

  const loadCard = useCallback(async () => {
    try {
      setCard(await RuntimeBriefDataSourceFactory.current().project(project.id));
    } catch (error) {
      setErrorMessage(describeError(error));
    }
  }, [project.id]);

  const loadCachedStatus = useCallback(async () => {
    if (requesting.current) return;
    requesting.current = true;
    setRequestingStatus(true);
    setStatusError(null);
    try {
      const status = await RuntimeBriefDataSourceFactory.current(6).voiceStatus(project.id);
      setStatusRefreshing(status.refreshing);
      setStatusUnavailable(status.unavailable);
      if (status.answer && status.answer.length > 0) {
        setStatusText(status.answer);
        setStatusAnswer({ answer: status.answer, costUsd: 0, cached: true, truncated: false, evidence: status.evidence });
        setStatusUpdatedAt(status.analyzedAt);
      }
    } catch (error) {
      setStatusError(describeError(error));
      setStatusUnavailable(true);
      setStatusRefreshing(false);
    } finally {
      requesting.current = false;
      setRequestingStatus(false);
    }
  }, [project.id]);

  useEffect(() => {
    void Promise.all([loadCard(), loadCachedStatus()]);
  }, [loadCard, loadCachedStatus]);

  // While a background refresh is in progress and the section is open, poll every 5s.
  useEffect(() => {
    if (!(analystExpanded && statusRefreshing)) return;
    let cancelled = false;
    const timer = setInterval(() => {
      if (!cancelled) void loadCachedStatus();
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [analystExpanded, statusRefreshing, loadCachedStatus]);

  const toggleAnalyst = () => {
    setAnalystExpanded((expanded) => {
      if (!expanded) void loadCachedStatus();
      return !expanded;
    });
  };

  const submit = () => {
    const q = question.trim();
    if (q.length === 0 || asking) return;
    setQuestion("");
    setAsking(true);
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setThread((entries) => [...entries, { id, question: q, answer: "", done: false, evidence: [], cached: false }]);
    const update = (patch: Partial<QAEntry> | ((entry: QAEntry) => Partial<QAEntry>)) =>
      setThread((entries) =>
        entries.map((entry) =>
          entry.id === id ? { ...entry, ...(typeof patch === "function" ? patch(entry) : patch) } : entry,
        ),
      );
    void (async () => {
      try {
        for await (const event of RuntimeBriefDataSourceFactory.current().streamAsk(project.id, q)) {
          switch (event.type) {
            case "chunk":
              update((entry) => ({ answer: entry.answer + event.text }));
              break;
            case "done":
              update({
                answer: event.answer.answer,
                done: true,
                evidence: event.answer.evidence ?? [],
                cached: event.answer.cached,
              });
              break;
            case "failure":
              update({ answer: "The analyst hit an error.", done: true });
              break;
          }
        }
      } catch (error) {
        update({ answer: describeError(error), done: true });
      } finally {
        setAsking(false);
      }
    })();
  };

  const brief = card?.brief ?? project.brief;
  const git = card?.git ?? null;
  const release = card?.iosRelease ?? null;
  const sessions = card?.sessions ?? [];

  return (
    <NavigationScreen
      title={project.name}
      displayMode="inline"
      leading={
        <button
          type="button"
          className="glass-button icon"
          onClick={() => ProjectNavigation.back()}
          aria-label="Back"
          data-testid="back-button"
        >
          <Symbol name="chevron.left" size={22} strokeWidth={2.25} />
        </button>
      }
    >
      <div className="detail-stack" style={{ paddingTop: 8 }}>
        {isDemo ? (
          <div className="label-row c-indigo" data-testid="demo-detail-banner">
            <span className="label-icon" style={{ marginTop: 2 }}>
              <Symbol name="sparkles" size={18} />
            </span>
            <span className="t-callout w-semibold">Demo Data — this screen contains fictional information only.</span>
          </div>
        ) : null}

        {/* Analyst update */}
        <div className="card blue">
          <CollapsibleProjectSection
            isExpanded={analystExpanded}
            onToggle={toggleAnalyst}
            accessibilityLabel="Analyst update"
            testId="analyst-section-toggle"
            header={<span className="t-headline">Analyst update</span>}
          >
            <div className="stack g10">
              {statusText.length === 0 && !requestingStatus ? (
                <span className="t-subheadline c-secondary" data-testid="analyst-update-status">
                  {statusUnavailable
                    ? "Analysis is unavailable right now."
                    : "Preparing your project analysis in the background…"}
                </span>
              ) : requestingStatus && statusText.length === 0 ? (
                <ProgressView label="Loading latest analysis…" />
              ) : (
                <>
                  <p
                    className="t-subheadline selectable prewrap"
                    style={{ margin: 0, lineHeight: "24px" }}
                    data-testid="analyst-update-text"
                  >
                    {EvidencePresentation.text(statusText, statusAnswer?.evidence ?? [])}
                  </p>
                  {statusAnswer ? (
                    <>
                      <AnalystMetadata answer={statusAnswer} isDemo={isDemo} />
                      {statusUpdatedAt ? (
                        <span className="row t-caption c-secondary" style={{ gap: 8 }}>
                          <span>Analyzed</span>
                          <RelativeTimeText date={statusUpdatedAt} />
                        </span>
                      ) : null}
                    </>
                  ) : requestingStatus ? (
                    <ProgressView small />
                  ) : null}
                </>
              )}
              {statusRefreshing ? (
                <span className="label-row centered t-caption c-secondary">
                  <span className="label-icon">
                    <Symbol name="arrow.triangle.2.circlepath" size={13} />
                  </span>
                  <span>Refreshing in the background…</span>
                </span>
              ) : null}
              {statusError ? <span className="t-caption c-orange">{statusError}</span> : null}
              <button
                type="button"
                className="btn plain"
                onClick={() => void loadCachedStatus()}
                disabled={requestingStatus}
                data-testid="check-analyst-update"
              >
                Check for updates
              </button>
            </div>
          </CollapsibleProjectSection>
        </div>

        {/* Evidence-backed brief */}
        {brief ? (
          <div className="card quaternary">
            <CollapsibleProjectSection
              isExpanded={briefExpanded}
              onToggle={() => setBriefExpanded((value) => !value)}
              accessibilityLabel={`Project brief: ${brief.headline}`}
              testId="brief-section-toggle"
              header={
                <div className="stack g12">
                  <div className="row between">
                    <BriefStateBadge state={brief.state} />
                    <RelativeTimeText date={brief.updatedAt} />
                  </div>
                  <span className="t-title3 w-semibold">{brief.headline}</span>
                </div>
              }
            >
              <div className="stack g14">
                {brief.claims.map((claim) => (
                  <div key={claim.id} className="stack g8" style={{ paddingTop: 2 }}>
                    <ClaimLabel claim={claim} />
                  </div>
                ))}
              </div>
            </CollapsibleProjectSection>
          </div>
        ) : null}

        {errorMessage ? <ErrorBanner message={errorMessage} /> : null}

        {/* Ask thread */}
        <CollapsibleProjectSection
          isExpanded={askExpanded}
          onToggle={() => setAskExpanded((value) => !value)}
          accessibilityLabel="Ask about this project"
          testId="ask-section-toggle"
          header={<span className="t-headline">Ask about this project</span>}
        >
          <div className="stack g12">
            <form
              className="row"
              onSubmit={(event) => {
                event.preventDefault();
                submit();
              }}
            >
              <input
                ref={questionField}
                className="text-field"
                type="text"
                placeholder="e.g. did the tests pass?"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                aria-label="Ask about this project"
                data-testid="demo-question-field"
              />
              <button
                type="submit"
                className="icon-button"
                disabled={question.trim().length === 0 || asking}
                aria-label="Ask"
                data-testid="submit-project-question"
              >
                <Symbol name="arrow.up.circle.fill" size={28} fillStroke="var(--bg)" />
              </button>
            </form>
            {[...thread].reverse().map((entry) => (
              <div key={entry.id} className="qa-entry stack g6">
                <span className="t-subheadline w-semibold">{entry.question}</span>
                <p
                  className="t-subheadline selectable prewrap"
                  style={{ margin: 0, lineHeight: "23px" }}
                  data-testid="project-answer"
                >
                  {entry.answer.length === 0 ? "…" : EvidencePresentation.text(entry.answer, entry.evidence)}
                </p>
                {entry.done ? (
                  <span className="row g10 t-caption c-secondary">
                    {entry.cached ? (
                      isDemo ? (
                        <LabelText icon="sparkles" text="Demo response" />
                      ) : (
                        <LabelText icon="clock.arrow.circlepath" text="Cached" />
                      )
                    ) : (
                      <LabelText icon="terminal" text="Codex CLI" />
                    )}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </CollapsibleProjectSection>

        {/* Recent agent sessions */}
        {sessions.length > 0 ? (
          <CollapsibleProjectSection
            isExpanded={sessionsExpanded}
            onToggle={() => setSessionsExpanded((value) => !value)}
            accessibilityLabel="Recent agent sessions"
            testId="sessions-section-toggle"
            header={<span className="t-headline">Recent agent sessions</span>}
          >
            <div className="stack g8">
              {sessions.map((session) => (
                <SessionRow key={`${session.source}-${session.id}`} session={session} />
              ))}
            </div>
          </CollapsibleProjectSection>
        ) : null}

        <ClaudeLaunchView project={project} />

        {/* Recent commits */}
        {git ? (
          <CollapsibleProjectSection
            isExpanded={commitsExpanded}
            onToggle={() => setCommitsExpanded((value) => !value)}
            accessibilityLabel="Recent commits"
            testId="commits-section-toggle"
            header={<span className="t-headline">Recent commits</span>}
          >
            <CommitsList git={git} />
          </CollapsibleProjectSection>
        ) : null}

        {/* iOS release */}
        {release ? (
          <div className="card indigo">
            <CollapsibleProjectSection
              isExpanded={releaseExpanded}
              onToggle={() => setReleaseExpanded((value) => !value)}
              accessibilityLabel="iOS release"
              testId="ios-release-section-toggle"
              header={
                <div className="row between">
                  <span className="label-row centered t-headline">
                    <span className="label-icon">
                      <Symbol name="iphone" size={18} />
                    </span>
                    <span>iOS release</span>
                  </span>
                  {release.appStoreConnect.checkedAt ? <RelativeTimeText date={release.appStoreConnect.checkedAt} /> : null}
                </div>
              }
            >
              <ReleaseDetails release={release} />
            </CollapsibleProjectSection>
          </div>
        ) : null}
      </div>
    </NavigationScreen>
  );
}

function LabelText({ icon, text }: { icon: SymbolName; text: string }) {
  return (
    <span className="label-row centered">
      <span className="label-icon">
        <Symbol name={icon} size={13} />
      </span>
      <span>{text}</span>
    </span>
  );
}

function AnalystMetadata({ answer, isDemo }: { answer: AnalystAnswer; isDemo: boolean }) {
  return (
    <span className="row g10 t-caption c-secondary">
      {answer.cached ? (
        isDemo ? (
          <LabelText icon="sparkles" text="Demo response" />
        ) : (
          <LabelText icon="clock.arrow.circlepath" text="Cached" />
        )
      ) : (
        <LabelText icon="terminal" text="Codex CLI" />
      )}
      {answer.truncated ? <LabelText icon="scissors" text="Response truncated" /> : null}
    </span>
  );
}

function SessionRow({ session }: { session: SessionInfo }) {
  const files = session.filesTouched ?? [];
  const toolCount = session.toolUseCount ?? 0;
  const facts = [
    files.length === 0 ? null : `${files.length} file${files.length === 1 ? "" : "s"} touched`,
    toolCount === 0 ? null : `${toolCount} tool call${toolCount === 1 ? "" : "s"}`,
  ].filter((value): value is string => value !== null);
  return (
    <>
      <div className="stack g6" style={{ padding: "6px 0" }}>
        <div className="row">
          <MonoLabel text={session.source} testId={`session-source-${session.source}`} />
          <SessionStateBadge state={session.state ?? "unknown"} />
          <span className="spacer" />
          <RelativeTimeText date={session.endedAt ?? session.startedAt} />
        </div>
        {session.summary ? <span className="t-subheadline clamp-3">{session.summary}</span> : null}
        <div className="row">
          {session.gitBranch ? <MonoLabel text={session.gitBranch} /> : null}
          {session.model ? <span className="t-caption c-secondary">{session.model}</span> : null}
        </div>
        {facts.length > 0 ? <span className="t-caption c-secondary">{facts.join(" · ")}</span> : null}
        {session.conclusion && session.conclusion.length > 0 ? (
          <span className="t-caption c-secondary clamp-3">{session.conclusion}</span>
        ) : null}
        {session.stateReason ? <span className="t-caption2 c-tertiary">{session.stateReason}</span> : null}
      </div>
      <div className="divider" style={{ margin: 0 }} />
    </>
  );
}

function CommitsList({ git }: { git: GitSummary }) {
  return (
    <div className="stack g8">
      {git.commits.slice(0, 8).map((commit) => (
        <div key={commit.hash} className="stack g2" style={{ padding: "4px 0" }}>
          <span className="t-subheadline clamp-2">{commit.message}</span>
          <div className="row between">
            <span className="t-caption c-secondary">{commit.author}</span>
            <RelativeTimeText date={commit.timestamp} />
          </div>
        </div>
      ))}
    </div>
  );
}

function versionBuild(version: string | null, build: string | null): string {
  if (version && build) return `${version} (${build})`;
  if (version) return version;
  if (build) return `Build ${build}`;
  return "Unknown";
}

function readableState(value: string): string {
  return value
    .split("_")
    .map((part) => {
      const lower = part.toLowerCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

function readableAudience(value: string | null): string | null {
  if (!value) return null;
  switch (value) {
    case "INTERNAL_ONLY":
      return "Internal only";
    case "APP_STORE_ELIGIBLE":
      return "App Store eligible";
    default:
      return readableState(value);
  }
}

function ReleaseRow({
  title,
  icon,
  value,
  detail,
  testId,
}: {
  title: string;
  icon: SymbolName;
  value: string;
  detail: string;
  testId: string;
}) {
  return (
    <div className="release-row">
      <span className="release-icon">
        <Symbol name={icon} size={18} />
      </span>
      <div className="stack g2">
        <span className="t-caption w-semibold c-secondary">{title}</span>
        <span className="t-body w-semibold" data-testid={testId}>
          {value}
        </span>
        <span className="t-caption c-secondary">{detail}</span>
      </div>
    </div>
  );
}

function ReleaseDetails({ release }: { release: IOSReleaseSummary }) {
  const build = release.appStoreConnect.latestTestFlightBuild;
  const store = release.appStoreConnect.appStoreVersion;
  return (
    <div className="stack g14">
      <ReleaseRow
        title="Xcode"
        icon="hammer"
        value={versionBuild(release.xcode.marketingVersion, release.xcode.buildNumber)}
        detail={`${release.xcode.bundleId} · ${release.xcode.scheme}`}
        testId="xcode-build-summary"
      />
      {build ? (
        <ReleaseRow
          title="TestFlight"
          icon="paperplane.fill"
          value={versionBuild(build.marketingVersion, build.buildNumber)}
          detail={[readableState(build.processingState), readableAudience(build.audienceType), build.expired ? "Expired" : null]
            .filter((part): part is string => part !== null)
            .join(" · ")}
          testId="testflight-build-summary"
        />
      ) : null}
      {store ? (
        <ReleaseRow
          title="App Store"
          icon="storefront"
          value={versionBuild(store.version, store.buildNumber)}
          detail={readableState(store.state)}
          testId="app-store-build-summary"
        />
      ) : null}
      {release.appStoreConnect.message ? (
        <span className="label-row t-caption c-secondary" data-testid="app-store-connect-message">
          <span className="label-icon">
            <Symbol name="info.circle" size={13} />
          </span>
          <span>{release.appStoreConnect.message}</span>
        </span>
      ) : !build && !store ? (
        <span className="t-caption c-secondary">No TestFlight or App Store builds were found.</span>
      ) : null}
    </div>
  );
}
