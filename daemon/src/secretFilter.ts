/**
 * Paths that must never be read or surfaced to the analyst. Transcripts and
 * repos can contain secrets; these patterns are filtered everywhere paths
 * flow toward model context (adapters, working-tree scans, prompt assembly).
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  /^\.env/i, // .env, .env.local, .envrc… (matches the documented .env* policy)
  /credential/i,
  /secret/i,
  /^id_rsa/i,
  /^id_ed25519/i,
  /^id_ecdsa/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.pypirc$/i,
  /\.pem$/i,
  /\.p12$/i,
  /\.p8$/i,
  /\.key$/i,
  /\.pfx$/i,
  /\.jks$/i,
  /\.keystore$/i,
  /\.mobileprovision$/i,
  /\.keychain/i,
];

/** True when any path segment matches a sensitive pattern. */
export function isSensitivePath(relPath: string): boolean {
  // Agent transcripts can contain paths created on a different platform, and
  // POSIX permits a literal backslash in a filename. Treat both separators as
  // boundaries so `config\\.env` cannot bypass a segment-based policy.
  const segments = relPath.split(/[\\/]+/).filter(Boolean);
  return segments.some((segment) =>
    SENSITIVE_PATTERNS.some((pattern) => pattern.test(segment)),
  );
}

/**
 * The deny-list, phrased for the analyst system prompt. Kept next to the
 * regexes so prompt and filter can't drift apart silently.
 */
export const SENSITIVE_GLOBS_FOR_PROMPT =
  ".env*, *credential*, *secret*, id_rsa*, id_ed25519*, id_ecdsa*, " +
  ".npmrc, .netrc, .pypirc, *.pem, *.p12, *.p8, *.key, *.pfx, *.jks, " +
  "*.keystore, *.mobileprovision";
