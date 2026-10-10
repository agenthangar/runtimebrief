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
/** Misheard names ("slip park" for SlipSpark) span at most this many words. */
const MAX_FUZZY_WINDOW = 3;

/** Edits tolerated in a misheard name: none below six letters, one up to
 * nine, two from ten. The first letter must match. */
export function allowedMishearing(length: number): number {
  return length >= 10 ? 2 : length >= 6 ? 1 : 0;
}

/** Optimal string alignment distance, or `max + 1` once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let previous2: number[] = [];
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let rowMinimum = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, previous2[j - 2]! + 1);
      }
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > max) return max + 1;
    previous2 = previous;
    previous = current;
  }
  return Math.min(previous[b.length]!, max + 1);
}

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
  /** 0 for an exact or plural match; edits for a misheard one. */
  distance: number;
}

/**
 * Returns the IDs of projects named in `question`, in the order they are first
 * mentioned. A spoken name may be split ("slip spark"), joined ("slipspark"),
 * pluralized ("slip sparks"), or slightly misheard ("slip park"). Exact
 * matches win over misheard ones, and a longer name over a shorter one it
 * contains, so "trail map web" does not also select "trail map".
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
      // Dictation often pluralizes a name: "slip sparks" for SlipSpark.
      const singular = window.length > MIN_COMPACT_LENGTH && window.endsWith("s") ? window.slice(0, -1) : null;
      let exact = false;
      for (const candidate of candidates) {
        if (candidate.compact === window || candidate.compact === singular) {
          matches.push({ id: candidate.id, start, end: start + size, length: candidate.compact.length, distance: 0 });
          exact = true;
        }
      }
      if (exact || size > MAX_FUZZY_WINDOW) continue;
      // A misheard name counts only when exactly one project is closest.
      let best = Infinity;
      let closest = new Set<string>();
      let closestLength = 0;
      for (const candidate of candidates) {
        const allowed = allowedMishearing(candidate.compact.length);
        if (allowed === 0 || candidate.compact[0] !== window[0]) continue;
        const distance = editDistance(window, candidate.compact, allowed);
        if (distance > allowed || distance > best) continue;
        if (distance < best) {
          best = distance;
          closest = new Set();
        }
        closest.add(candidate.id);
        closestLength = candidate.compact.length;
      }
      if (closest.size === 1) {
        matches.push({ id: [...closest][0]!, start, end: start + size, length: closestLength, distance: best });
      }
    }
  }
  matches.sort((a, b) => a.distance - b.distance || b.length - a.length || a.start - b.start);
  const accepted: Match[] = [];
  for (const match of matches) {
    if (accepted.some((other) => match.start < other.end && other.start < match.end)) continue;
    accepted.push(match);
  }
  accepted.sort((a, b) => a.start - b.start);
  return [...new Set(accepted.map((match) => match.id))];
}
