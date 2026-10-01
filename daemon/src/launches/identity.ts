import { createHash } from "node:crypto";

export const promptHash = (value: string) => createHash("sha256").update(value).digest("hex");

/** Accept only a provider-confirmed Claude session link. */
export function nativeRemoteURL(value: unknown): string | null {
  return typeof value === "string" && /^https:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+$/.test(value) ? value : null;
}
