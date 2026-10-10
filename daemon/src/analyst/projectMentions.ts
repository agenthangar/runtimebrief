/**
 * Finds the projects a free-form question names, so a spoken question can be
 * routed to one project's analyst or to the portfolio analyst.
 *
 * The iOS app ports this algorithm for its demo and older-daemon fallback.
 * Both implementations run the shared `fixtures/project-mentions.json` cases.
 */

export interface MentionCandidate {
  id: string;
  name: string;
}

/** Words that people add around a project name without it changing. */
const FILLER_WORDS = new Set(["the", "app", "project"]);
const MAX_WINDOW = 5;
const MIN_COMPACT_LENGTH = 3;

export function mentionTokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 0);
}

/** "The Sample-Tracker App" and "sampletracker" both become "sampletracker". */
export function compactName(text: string): string {
  const tokens = mentionTokens(text);
  const meaningful = tokens.filter((token) => !FILLER_WORDS.has(token));
  return (meaningful.length > 0 ? meaningful : tokens).join("");
}

interface Match {
  id: string;
  start: number;
  end: number;
  length: number;
}

/**
 * Returns the IDs of projects named in `question`, in the order they are first
 * mentioned. A spoken name may be split ("slip spark") or joined
 * ("slipspark"); a longer name wins over a shorter one it contains, so
 * "trail map web" does not also select "trail map".
 */
export function resolveProjectMentions(
  question: string,
  projects: readonly MentionCandidate[],
): string[] {
  const words = mentionTokens(question);
  const candidates = projects.flatMap((project) =>
    [...new Set([compactName(project.name), compactName(project.id)])]
      .filter((compact) => compact.length >= MIN_COMPACT_LENGTH)
      .map((compact) => ({ id: project.id, compact })),
  );
  const matches: Match[] = [];
  for (let start = 0; start < words.length; start++) {
    let window = "";
    for (let size = 1; size <= MAX_WINDOW && start + size <= words.length; size++) {
      window += words[start + size - 1];
      for (const candidate of candidates) {
        if (candidate.compact === window) {
          matches.push({ id: candidate.id, start, end: start + size, length: window.length });
        }
      }
    }
  }
  matches.sort((a, b) => b.length - a.length || a.start - b.start);
  const accepted: Match[] = [];
  for (const match of matches) {
    if (accepted.some((other) => match.start < other.end && other.start < match.end)) continue;
    accepted.push(match);
  }
  accepted.sort((a, b) => a.start - b.start);
  return [...new Set(accepted.map((match) => match.id))];
}
