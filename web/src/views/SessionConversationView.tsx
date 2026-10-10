import { useCallback, useEffect, useState } from "react";
import { usePolling } from "../lib/hooks";
import { launchAgent, providerLabel, type ClaudeLaunch, type ConversationSnapshot, type SessionReply } from "../models/claudeLaunch";
import type { ProjectSummary } from "../models/types";
import { AgentSessionsStore } from "../networking/agentSessionsStore";
import type { RuntimeBriefDataSource } from "../networking/dataSource";
import { SessionReplyDraft } from "../networking/drafts";
import { describeError } from "../networking/errors";
import { uuidLowercase } from "../lib/hash";
import { Symbol } from "./icons";
import { Sheet } from "./Sheet";

export function SessionConversationView({
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
  const [snapshot, setSnapshot] = useState<ConversationSnapshot | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [retry, setRetry] = useState<SessionReply | null>(null);
  const agentLabel = providerLabel(launchAgent(launch));

  const refresh = useCallback(async () => {
    try {
      const value = await source.conversation(project.id, launch.id);
      setSnapshot(value);
      setRetry((current) => {
        if (current === null) setError(null);
        return current;
      });
    } catch (caught) {
      setError(describeError(caught));
    }
  }, [source, project.id, launch.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  usePolling(refresh, 2000);

  const send = async (proposed: SessionReply) => {
    const scope = AgentSessionsStore.shared.connectionScope();
    const reply = await SessionReplyDraft.request(scope, launch.id, proposed);
    if (sending) return;
    setSending(true);
    setRetry(reply);
    try {
      const result = await source.reply(project.id, launch.id, reply);
      if (result.accepted) {
        await SessionReplyDraft.clear(scope, launch.id, reply);
        setRetry(null);
        setText("");
        setError(null);
        await refresh();
      } else {
        setError("Delivery is unconfirmed. Refresh before sending another response.");
      }
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setSending(false);
    }
  };

  const canSend =
    !sending &&
    retry === null &&
    text.length <= 8000 &&
    text.trim().length > 0 &&
    snapshot?.state !== "running" &&
    (snapshot?.requests.length ?? 0) === 0;

  return (
    <Sheet
      title={agentLabel}
      onDismiss={onDismiss}
      plain
      testId="session-conversation"
      leading={
        <button type="button" className="glass-button" onClick={onDismiss} data-testid="conversation-done">
          Done
        </button>
      }
      footer={
        snapshot?.writable === true ? (
          <div className="composer-bar">
            <textarea
              rows={1}
              placeholder="Follow up"
              value={text}
              onChange={(event) => setText(event.target.value)}
              aria-label="Follow up"
              data-testid="session-conversation-input"
            />
            <button
              type="button"
              className="icon-button"
              aria-label="Send"
              disabled={!canSend}
              onClick={() => void send({ requestId: uuidLowercase(), text })}
              data-testid="session-conversation-send"
            >
              <Symbol name="arrow.up.circle.fill" size={32} fillStroke="var(--bg)" />
            </button>
          </div>
        ) : undefined
      }
    >
      <div className="stack g18" style={{ padding: 16 }}>
        <span className="t-subheadline c-secondary">{snapshot?.message ?? "Loading conversation…"}</span>
        {(snapshot?.messages ?? []).map((message) => (
          <div key={message.id} className={`message stack g5 ${message.role === "user" ? "user" : ""}`}>
            <span className="t-caption w-semibold c-secondary">
              {message.role === "user" ? "You" : message.role === "tool" ? "Activity" : agentLabel}
            </span>
            <span className="selectable prewrap" data-testid={`session-message-${message.role}`}>
              {message.text}
            </span>
          </div>
        ))}
        {(snapshot?.requests ?? []).map((request) => {
          const locked = sending || retry !== null;
          return (
          <div key={request.id} className="request-card stack g10" aria-disabled={locked}>
            <span className="t-headline">{request.title}</span>
            {request.body.length > 0 ? <span className="t-callout selectable prewrap">{request.body}</span> : null}
            {request.options.map((option) => (
              <div key={option.id}>
                <button
                  type="button"
                  className="btn bordered"
                  disabled={locked}
                  onClick={() => void send({ requestId: uuidLowercase(), approvalId: request.id, optionId: option.id })}
                  data-testid={`session-decision-${option.id}`}
                >
                  {option.label}
                </button>
              </div>
            ))}
            {request.questions.map((question) => (
              <div key={question.id} className="stack g6">
                <span className="t-callout w-medium">{question.prompt}</span>
                {question.options.length > 0 ? (
                  <select
                    className="text-field"
                    value={answers[question.id] ?? ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                    disabled={locked}
                    aria-label="Answer"
                    data-testid={`session-question-${question.id}`}
                  >
                    <option value="">Choose…</option>
                    {question.options.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="text-field"
                    type="text"
                    placeholder="Your answer"
                    value={answers[question.id] ?? ""}
                    onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                    disabled={locked}
                    aria-label="Your answer"
                    data-testid={`session-question-${question.id}`}
                  />
                )}
              </div>
            ))}
            {request.questions.length > 0 ? (
              <div>
                <button
                  type="button"
                  className="btn bordered"
                  disabled={locked || request.questions.some((question) => (answers[question.id] ?? "").length === 0)}
                  onClick={() =>
                    void send({
                      requestId: uuidLowercase(),
                      approvalId: request.id,
                      answers: Object.fromEntries(request.questions.map((question) => [question.id, [answers[question.id] ?? ""]])),
                    })
                  }
                  data-testid="session-send-answers"
                >
                  Send answers
                </button>
              </div>
            ) : null}
          </div>
          );
        })}
        {error ? <span className="c-red">{error}</span> : null}
        {retry ? (
          <div className="stack g8">
            <button type="button" className="btn plain" style={{ alignSelf: "flex-start" }} disabled={sending} onClick={() => void send(retry)}>
              Retry same response
            </button>
            <button type="button" className="btn plain" style={{ alignSelf: "flex-start" }} disabled={sending} onClick={() => setRetry(null)}>
              Dismiss retry
            </button>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
