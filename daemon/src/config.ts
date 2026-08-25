import { z } from "zod";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensurePrivateDirectory,
  hardenPrivateFile,
  preparePrivateFileTarget,
} from "./privateData.js";

/**
 * Config lives in ~/.runtimebrief/config.yaml by default.
 * Override the directory with RUNTIMEBRIEF_CONFIG_DIR (used by tests).
 */
export function configDir(): string {
  return process.env.RUNTIMEBRIEF_CONFIG_DIR ?? path.join(os.homedir(), ".runtimebrief");
}

export function configPath(): string {
  return path.join(configDir(), "config.yaml");
}

const transcriptSourceSchema = z.object({
  type: z.string(),
  root: z.string().optional(),
});

const actionKindSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-_]*$/, "action kind must be lower-case with - or _");

const projectSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-_]*$/i, "project id must be alphanumeric with - or _"),
  name: z.string(),
  path: z.string(),
  transcript_sources: z.array(transcriptSourceSchema).optional(),
  allowed_actions: z.array(actionKindSchema).default([]),
});

export const configSchema = z.object({
  server: z
    .object({
      // NEVER default to 0.0.0.0 — loopback unless the user opts in explicitly.
      host: z.string().default("127.0.0.1"),
      port: z.number().int().min(1).max(65535).default(8484),
    })
    .default({ host: "127.0.0.1", port: 8484 }),
  auth: z.object({
    // Only the scrypt hash is stored; the plaintext token is printed once at init.
    token_hash: z.string(),
  }),
  project_roots: z.array(z.string()).default([]),
  projects: z.array(projectSchema).default([]),
  analyst: z
    .object({
      model: z.string().default("gpt-5.6-luna"),
      cache_ttl_minutes: z.number().nonnegative().default(10),
      /** Max recent transcripts fed to the analyst per query. */
      max_transcripts: z.number().int().positive().default(5),
    })
    .default({
      model: "gpt-5.6-luna",
      cache_ttl_minutes: 10,
      max_transcripts: 5,
    }),
});

export type RuntimeBriefConfig = z.infer<typeof configSchema>;

export function loadConfig(): RuntimeBriefConfig {
  const p = configPath();
  if (!fs.existsSync(p)) {
    throw new Error(
      `No config found at ${p}. Run \`runtimebriefd init\` first.`,
    );
  }
  ensurePrivateDirectory(path.dirname(p));
  hardenPrivateFile(p, "RuntimeBrief config");
  const raw = fs.readFileSync(p, "utf8");
  const parsed = configSchema.safeParse(parseYaml(raw) ?? {});
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid config at ${p}:\n${issues}`);
  }
  const config = parsed.data;
  const roots = new Set<string>();
  for (const root of config.project_roots) {
    const normalized = path.resolve(root);
    if (roots.has(normalized)) {
      throw new Error(`Invalid config at ${p}: duplicate project root "${root}"`);
    }
    roots.add(normalized);
  }
  const ids = new Set<string>();
  for (const project of config.projects) {
    if (ids.has(project.id)) {
      throw new Error(`Invalid config at ${p}: duplicate project id "${project.id}"`);
    }
    ids.add(project.id);
  }
  return config;
}

export function saveConfig(config: RuntimeBriefConfig): void {
  const dir = configDir();
  ensurePrivateDirectory(dir);
  const p = configPath();
  preparePrivateFileTarget(p, "RuntimeBrief config");
  fs.writeFileSync(p, stringifyYaml(config), { mode: 0o600 });
  hardenPrivateFile(p, "RuntimeBrief config");
}

// ---------------------------------------------------------------------------
// Token handling. Format: scrypt:<salt-b64>:<hash-b64>
// ---------------------------------------------------------------------------

const SCRYPT_KEYLEN = 32;

export function generateToken(): string {
  // 32 bytes of entropy, base64url so it's copy-paste and header safe.
  return randomBytes(32).toString("base64url");
}

export function hashToken(token: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(token, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("base64")}:${hash.toString("base64")}`;
}

/**
 * Constant-time verification of a presented token against the stored hash.
 * scrypt itself dominates timing; the final compare is timingSafeEqual.
 */
export function verifyToken(presented: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let salt: Buffer, expected: Buffer;
  try {
    salt = Buffer.from(parts[1]!, "base64");
    expected = Buffer.from(parts[2]!, "base64");
  } catch {
    return false;
  }
  if (expected.length !== SCRYPT_KEYLEN) return false;
  const actual = scryptSync(presented, salt, SCRYPT_KEYLEN);
  return timingSafeEqual(actual, expected);
}
