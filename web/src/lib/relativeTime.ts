/**
 * Approximates SwiftUI's `.relative(presentation: .named)` formatting:
 * "now", "35 minutes ago", "yesterday", "6 days ago", "last week", "in 2 hours".
 */
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

let formatter: Intl.RelativeTimeFormat | null = null;

function rtf(): Intl.RelativeTimeFormat {
  formatter ??= new Intl.RelativeTimeFormat("en", { numeric: "auto", style: "long" });
  return formatter;
}

export function formatRelative(date: Date, now: Date = new Date()): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  const magnitude = Math.abs(seconds);
  if (magnitude < 60) return rtf().format(0, "second");
  for (const [unit, size] of UNITS) {
    if (magnitude >= size) {
      const value = Math.trunc(seconds / size);
      return rtf().format(value, unit);
    }
  }
  return rtf().format(0, "second");
}
