import Fastify, { type FastifyInstance } from "fastify";
import { lookup } from "node:dns/promises";
import type { RuntimeBriefConfig } from "./config.js";
import type { RuntimeAdapter } from "./types.js";
import { makeAuthHook } from "./auth.js";
import { makeRateLimitHook } from "./rateLimit.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerAnalystRoutes } from "./routes/analyst.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import type { AnalystService } from "./analyst/service.js";
import type { IosReleaseProvider } from "./iosRelease.js";
import type { DecisionStore } from "./decisions/store.js";

export const VERSION = "0.1.0";

export interface ServerDeps {
  config: RuntimeBriefConfig;
  adapters: RuntimeAdapter[];
  analyst: AnalystService;
  iosReleases?: IosReleaseProvider;
  decisions?: DecisionStore;
}

/**
 * Build (but don't listen) the Fastify app. Separated from `start` so
 * integration tests can boot it on a random port with mocked deps.
 */
export function buildServer(deps: ServerDeps): FastifyInstance {
  const app = Fastify({ logger: false, trustProxy: false });

  // Every endpoint requires auth; rate limit runs first so unauthenticated
  // hammering can't burn scrypt CPU.
  app.addHook("onRequest", makeRateLimitHook(30));
  app.addHook("onRequest", makeAuthHook(deps.config.auth.token_hash));

  registerHealthRoutes(app, VERSION);
  registerProjectRoutes(app, deps);
  registerAnalystRoutes(app, deps);
  registerDecisionRoutes(app, deps);

  if (deps.decisions) {
    app.addHook("onClose", async () => {
      deps.decisions?.close();
    });
  }

  return app;
}

/**
 * Guard against accidental exposure: an all-interfaces bind requires the
 * explicit --i-know-what-im-doing flag. Remote access uses Tailscale Serve in
 * front of the default loopback bind.
 */
export function assertBindAllowed(host: string, override: boolean): void {
  const canonicalHost = canonicalizeHostLiteral(host);
  if (canonicalHost.length === 0) {
    throw new Error("Refusing to bind: server.host must not be empty.");
  }
  if (isWildcardHost(canonicalHost) && !override) {
    throw new Error(
      `Refusing to bind to ${host}: this exposes the daemon on every interface. ` +
        `Bind to 127.0.0.1 and use Tailscale Serve for remote access, ` +
        `or pass --i-know-what-im-doing.`,
    );
  }
}

/**
 * Node and the OS treat IPv4-mapped zero and scoped IPv6 zero as wildcard
 * binds too. URL canonicalization alone does not collapse either spelling.
 */
function isWildcardHost(canonicalHost: string): boolean {
  const scopeIndex = canonicalHost.indexOf("%");
  const withoutScope = canonicalHost.includes(":") && scopeIndex >= 0
    ? canonicalHost.slice(0, scopeIndex)
    : canonicalHost;
  const canonicalAddress = canonicalizeHostLiteral(withoutScope);
  return canonicalAddress === "0.0.0.0" ||
    canonicalAddress === "::" ||
    canonicalAddress === "::ffff:0:0";
}

/**
 * WHATWG URL parsing canonicalizes the non-standard numeric IPv4 forms that
 * Node accepts (`0`, `0000`, `0x00000000`) and compressed IPv6 spellings.
 */
function canonicalizeHostLiteral(host: string): string {
  const trimmed = host.trim();
  if (trimmed.length === 0) return "";
  const unbracketed = trimmed.startsWith("[") && trimmed.endsWith("]")
    ? trimmed.slice(1, -1)
    : trimmed;
  try {
    const authority = unbracketed.includes(":") ? `[${unbracketed}]` : unbracketed;
    const parsed = new URL(`http://${authority}/`).hostname;
    return parsed.startsWith("[") && parsed.endsWith("]")
      ? parsed.slice(1, -1).toLowerCase()
      : parsed.toLowerCase();
  } catch {
    return unbracketed.toLowerCase();
  }
}

type BindHostLookup = (
  host: string,
) => Promise<readonly { address: string }[]>;

const lookupBindHost: BindHostLookup = (host) =>
  lookup(host, { all: true, verbatim: true });

/**
 * Resolve once, validate the exact addresses, then bind the selected numeric
 * address. This prevents a hostname that resolves to a wildcard address from
 * bypassing the literal guard and avoids a second DNS lookup at listen time.
 */
export async function resolveBindHost(
  host: string,
  override: boolean,
  resolveAll: BindHostLookup = lookupBindHost,
): Promise<string> {
  assertBindAllowed(host, override);
  const lookupHost = canonicalizeHostLiteral(host);
  const addresses = await resolveAll(lookupHost);
  if (addresses.length === 0) {
    throw new Error(`Unable to resolve server host ${host}.`);
  }
  for (const address of addresses) {
    assertBindAllowed(address.address, override);
  }
  return addresses[0]!.address;
}

export async function startServer(deps: ServerDeps, opts: { allowAllInterfaces?: boolean } = {}) {
  const { host: configuredHost, port } = deps.config.server;
  const host = await resolveBindHost(configuredHost, opts.allowAllInterfaces ?? false);
  const app = buildServer(deps);
  await app.listen({ host, port });
  return app;
}
