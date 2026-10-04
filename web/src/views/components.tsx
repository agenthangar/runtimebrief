import { useEffect, useId, useState, type ReactNode } from "react";
import { formatRelative } from "../lib/relativeTime";
import { EvidencePresentation } from "../models/evidencePresentation";
import type { AgentSessionState, BriefClaim, ProjectBriefState } from "../models/types";
import { Symbol, type SymbolName } from "./icons";

/** Monospaced accent for branch names, commit hashes, and other repo facts. */
export function MonoLabel({ text, testId }: { text: string; testId?: string }) {
  return (
    <span className="mono t-caption c-secondary" data-testid={testId}>
      {text}
    </span>
  );
}

export function DirtyDot({ dirty }: { dirty: boolean | null }) {
  const color = dirty === true ? "orange" : dirty === false ? "green" : "gray";
  const label = dirty === true ? "uncommitted changes" : dirty === false ? "clean" : "unknown";
  return <span className={`dot ${color}`} role="img" aria-label={label} />;
}

/** Re-render every 30s so relative times stay current like SwiftUI's live text. */
function useTick(intervalMs = 30_000): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return tick;
}

export function RelativeTimeText({ date, className }: { date: Date | null; className?: string }) {
  useTick();
  if (date) {
    return (
      <time className={`t-caption c-secondary ${className ?? ""}`} dateTime={date.toISOString()}>
        {formatRelative(date)}
      </time>
    );
  }
  return <span className={`t-caption c-tertiary ${className ?? ""}`}>no recent activity</span>;
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="error-banner" role="alert" data-testid="error-banner">
      <span className="label-icon">
        <Symbol name="exclamationmark.triangle" size={18} />
      </span>
      <span>{message}</span>
    </div>
  );
}

const BRIEF_STATE: Record<ProjectBriefState, { label: string; icon: SymbolName; color: string }> = {
  active: { label: "Active", icon: "bolt.fill", color: "blue" },
  attention: { label: "Attention", icon: "exclamationmark.triangle.fill", color: "orange" },
  recent: { label: "Ready", icon: "checkmark.circle.fill", color: "green" },
  quiet: { label: "Quiet", icon: "moon.fill", color: "gray" },
  unavailable: { label: "Unavailable", icon: "questionmark.circle.fill", color: "red" },
};

export function briefStateLabel(state: ProjectBriefState): string {
  return BRIEF_STATE[state].label;
}

export function BriefStateBadge({ state }: { state: ProjectBriefState }) {
  const entry = BRIEF_STATE[state];
  return (
    <span className={`badge ${entry.color}`} aria-label={entry.label} data-testid="brief-state-badge">
      <Symbol name={entry.icon} size={14} fillStroke="var(--bg)" />
      {entry.label}
    </span>
  );
}

const CLAIM_ICON: Record<BriefClaim["category"], SymbolName> = {
  attention: "exclamationmark.circle",
  progress: "arrow.trianglehead.2.clockwise",
  completed: "checkmark.circle",
  context: "info.circle",
};

export function ClaimLabel({ claim }: { claim: BriefClaim }) {
  return (
    <div className="label-row t-subheadline" data-testid="project-brief-claim">
      <span className="label-icon">
        <Symbol name={CLAIM_ICON[claim.category]} size={18} strokeWidth={1.75} />
      </span>
      <span>{EvidencePresentation.text(claim.text, claim.evidence)}</span>
    </div>
  );
}

const SESSION_STATE: Record<AgentSessionState, { label: string; icon: SymbolName; color: string }> = {
  active: { label: "Active", icon: "bolt.fill", color: "c-blue" },
  waiting: { label: "Waiting", icon: "person.crop.circle.badge.questionmark", color: "c-orange" },
  completed: { label: "Completed", icon: "checkmark.circle.fill", color: "c-green" },
  interrupted: { label: "Stopped", icon: "stop.circle.fill", color: "c-secondary" },
  unknown: { label: "Unknown", icon: "questionmark.circle", color: "c-secondary" },
};

export function SessionStateBadge({ state }: { state: AgentSessionState }) {
  const entry = SESSION_STATE[state];
  return (
    <span className={`session-badge ${entry.color}`}>
      <Symbol name={entry.icon} size={12} fillStroke="var(--bg)" />
      {entry.label}
    </span>
  );
}

export function ProgressView({ small, label }: { small?: boolean; label?: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className={`spinner ${small ? "small" : ""}`} aria-hidden="true" />
      {label ? <span className="c-secondary">{label}</span> : <span className="sr-only">Loading</span>}
    </span>
  );
}

export interface CollapsibleSectionProps {
  isExpanded: boolean;
  onToggle: () => void;
  accessibilityLabel: string;
  testId: string;
  header: ReactNode;
  children: ReactNode;
}

/** Header-and-chevron disclosure used for every project detail section. */
export function CollapsibleProjectSection({
  isExpanded,
  onToggle,
  accessibilityLabel,
  testId,
  header,
  children,
}: CollapsibleSectionProps) {
  const contentId = useId();
  return (
    <div className="collapsible">
      <button
        type="button"
        className="collapsible-header"
        onClick={onToggle}
        aria-label={accessibilityLabel}
        aria-expanded={isExpanded}
        aria-controls={contentId}
        data-testid={testId}
        data-value={isExpanded ? "Expanded" : "Collapsed"}
        title={isExpanded ? "Collapses this section" : "Expands this section"}
      >
        <span className="collapsible-title" role="heading" aria-level={2}>
          {header}
        </span>
        <span className="chevron">
          <Symbol name={isExpanded ? "chevron.down" : "chevron.right"} size={16} strokeWidth={2.5} />
        </span>
      </button>
      {isExpanded ? (
        <div className="collapsible-content" id={contentId}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  disabled,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  label: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`toggle ${checked ? "on" : ""}`}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-testid={testId}
    />
  );
}

export interface PickerOption {
  value: string;
  label: string;
}

/** Menu-style picker: label on the left, blue value + up/down chevrons on the right. */
export function MenuPicker({
  label,
  value,
  options,
  onChange,
  secondary,
  disabled,
  testId,
}: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  secondary?: boolean;
  disabled?: boolean;
  testId?: string;
}) {
  const current = options.find((option) => option.value === value)?.label ?? value;
  return (
    <div className="form-row">
      <span className="form-row-label">{label}</span>
      <span className={`picker ${secondary ? "secondary" : ""}`}>
        <span className="picker-value">{current}</span>
        <span className="picker-chevrons">
          <Symbol name="chevron.up.chevron.down" size={14} strokeWidth={2.25} />
        </span>
        <select
          aria-label={label}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
          data-testid={testId}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}

/** Renders `backtick` spans as inline code, like SwiftUI's Markdown-aware Text. */
export function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith("`") && part.endsWith("`") ? (
          <code key={index}>{part.slice(1, -1)}</code>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}
