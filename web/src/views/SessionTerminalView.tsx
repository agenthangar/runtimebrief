import { useCallback, useEffect, useRef, useState } from "react";
import { usePolling } from "../lib/hooks";
import { uuidLowercase } from "../lib/hash";
import { launchAgent, providerLabel, type ClaudeLaunch, type TerminalInput, type TerminalSnapshot } from "../models/claudeLaunch";
import type { ProjectSummary } from "../models/types";
import { RuntimeBriefModeStore, type RuntimeBriefDataSource } from "../networking/dataSource";
import { describeError } from "../networking/errors";
import { ProgressView } from "./components";
import { Sheet } from "./Sheet";
import { TerminalScreen } from "./TerminalScreen";

const KEYS: Array<[string, string]> = [
  ["↑", "\u001b[A"],
  ["↓", "\u001b[B"],
  ["Tab", "\t"],
  ["Esc", "\u001b"],
  ["Ctrl-C", "\u0003"],
  ["Enter", "\r"],
];

/** A view of the agent's native terminal; the agent owns all permission prompts. */
export function SessionTerminalView({
  project,
  launch,
  source,
  onDismiss,
}: {
  project: ProjectSummary;
  launch: ClaudeLaunch;
  source: RuntimeBriefDataSource;
  onDismiss: () => void;
}) {
  const [snapshot, setSnapshot] = useState<TerminalSnapshot | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<TerminalInput | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pendingRef = useRef<TerminalInput | null>(null);
  pendingRef.current = pending;
  const agentLabel = providerLabel(launchAgent(launch));

  const refresh = useCallback(async () => {
    try {
      const value = await source.terminal(project.id, launch.id);
      setSnapshot(value);
      if (pendingRef.current === null) setMessage(null);
    } catch (error) {
      // A stale screen cannot authorize more input after a disconnect.
      const description = describeError(error);
      setSnapshot((old) => (old ? { ...old, writable: false, message: description } : old));
      setMessage(description);
    }
  }, [source, project.id, launch.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePolling(async () => {
    if (document.visibilityState === "visible") await refresh();
  }, 5000);

  const retry = useCallback(
    async (input: TerminalInput) => {
      setSending(true);
      try {
        const result = await source.sendInput(project.id, launch.id, input);
        if (result.state === "sent") {
          setPending(null);
          setMessage(null);
        } else {
          setMessage("Input delivery is uncertain. Review the terminal; checking this input will never send its keys again.");
        }
      } catch (error) {
        setMessage(`${describeError(error)} Check input to recover its acknowledgment without repeating keys.`);
      } finally {
        setSending(false);
      }
      await refresh();
    },
    [source, project.id, launch.id, refresh],
  );

  const send = async (data: string, clearsDraft = false) => {
    if (sending || pending !== null || snapshot?.writable !== true) return;
    const input: TerminalInput = { requestId: uuidLowercase(), data };
    setPending(input);
    if (clearsDraft) setDraft("");
    await retry(input);
  };

  const controlsDisabled = sending || pending !== null || snapshot?.writable !== true;
  const utf8Length = new TextEncoder().encode(draft).length;

  return (
    <Sheet
      title={`${agentLabel} terminal`}
      onDismiss={onDismiss}
      plain
      testId="session-terminal"
      leading={
        <button type="button" className="glass-button" onClick={onDismiss} data-testid="terminal-done">
          Done
        </button>
      }
    >
      <div className="stack g8" style={{ padding: "0 12px 12px", height: "100%" }}>
        <span className="t-caption c-secondary" style={{ textAlign: "center" }}>
          {RuntimeBriefModeStore.isDemoEnabled
            ? "Demo terminal · no Mac connected"
            : `Live CLI on your Mac · ${agentLabel} handles permissions`}
        </span>
        {snapshot ? (
          <TerminalScreen snapshot={snapshot} />
        ) : (
          <div className="unavailable" style={{ minHeight: 200 }}>
            <ProgressView label="Connecting to the terminal…" />
          </div>
        )}
        {message ? (
          <span className="t-caption c-orange" data-testid="session-terminal-message">
            {message}
          </span>
        ) : null}
        <div className="key-row">
          {KEYS.map(([label, data]) => (
            <button key={label} type="button" className="btn bordered" disabled={controlsDisabled} onClick={() => void send(data)}>
              {label}
            </button>
          ))}
        </div>
        <div className="composer-bar">
          <textarea
            rows={1}
            placeholder="Type in the native terminal"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Type in the native terminal"
            data-testid="session-terminal-input"
          />
          <button
            type="button"
            className="btn plain"
            disabled={draft.length === 0 || utf8Length > 8000 || controlsDisabled}
            onClick={() => void send(draft.replace(/\n/g, "\r") + "\r", true)}
            data-testid="session-terminal-send"
          >
            Send
          </button>
        </div>
        {pending !== null ? (
          <div className="row g12 t-caption">
            <button type="button" className="btn plain caption" disabled={sending} onClick={() => void retry(pending)}>
              Check input
            </button>
            <button
              type="button"
              className="btn plain caption"
              onClick={() => {
                setPending(null);
                setMessage("Check the terminal before sending the same input again.");
              }}
            >
              Keep reviewing
            </button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
