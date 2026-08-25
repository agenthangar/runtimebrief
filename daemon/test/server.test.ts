import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { assertBindAllowed, buildServer, resolveBindHost, VERSION } from "../src/server.js";
import { authHeaders, testConfig } from "./helpers.js";

function makeApp(): FastifyInstance {
  return buildServer({
    config: testConfig(),
    adapters: [],
    analyst: { answer: async () => ({}) } as never,
  });
}

describe("auth middleware", () => {
  let app: FastifyInstance;
  afterEach(async () => app?.close());

  it("rejects requests without a token, without detail", async () => {
    app = makeApp();
    const res = await app.inject({ method: "GET", url: "/v1/health" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: "unauthorized" });
  });

  it("rejects wrong tokens and malformed headers", async () => {
    app = makeApp();
    for (const authorization of [
      "Bearer wrong-token",
      "Basic dXNlcjpwYXNz",
      "Bearer ",
      "bearer test-token",
    ]) {
      const res = await app.inject({
        method: "GET",
        url: "/v1/health",
        headers: { authorization },
      });
      expect(res.statusCode, `header: ${authorization}`).toBe(401);
    }
  });

  it("accepts the correct bearer token", async () => {
    app = makeApp();
    const res = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: authHeaders(),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.version).toBe(VERSION);
    expect(typeof body.uptime).toBe("number");
  });
});

describe("rate limiting", () => {
  it("returns a bounded 429 response and retry metadata after 30 requests", async () => {
    const app = makeApp();
    for (let i = 0; i < 30; i++) {
      const allowed = await app.inject({
        method: "GET",
        url: "/v1/health",
        headers: authHeaders(),
      });
      expect(allowed.statusCode).toBe(200);
    }

    const limited = await app.inject({
      method: "GET",
      url: "/v1/health",
      headers: authHeaders(),
    });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toEqual({
      statusCode: 429,
      error: "rate_limited",
      message: "Rate limit exceeded",
    });
    expect(Number(limited.headers["retry-after"])).toBeGreaterThan(0);
    await app.close();
  });

  it("rate-limits unauthenticated requests before token verification", async () => {
    const app = makeApp();
    for (let i = 0; i < 30; i++) {
      const rejected = await app.inject({ method: "GET", url: "/v1/health" });
      expect(rejected.statusCode).toBe(401);
    }

    const limited = await app.inject({ method: "GET", url: "/v1/health" });
    expect(limited.statusCode).toBe(429);
    expect(limited.json()).toMatchObject({ error: "rate_limited" });
    await app.close();
  });
});

describe("bind safety", () => {
  it("refuses alternate wildcard spellings without the override flag", () => {
    for (const host of [
      "0.0.0.0",
      "0",
      "00",
      "0000",
      "0x0",
      "0x00000000",
      "0.0",
      "0.0.0",
      "00.00.00.00",
      "::",
      "::0",
      "[::]",
      "0:0:0:0:0:0:0:0",
      "0000:0000:0000:0000:0000:0000:0000:0000",
      // Node/libuv can normalize these to an all-interface IPv6 bind.
      "::ffff:0.0.0.0",
      "::ffff:0:0",
      "0:0:0:0:0:ffff:0:0",
      "::%0",
      "::%lo0",
    ]) {
      expect(() => assertBindAllowed(host, false), host).toThrow(/Refusing to bind/);
    }
  });

  it("refuses an empty host rather than letting Node select a wildcard", () => {
    expect(() => assertBindAllowed("", false)).toThrow(/must not be empty/);
    expect(() => assertBindAllowed("   ", true)).toThrow(/must not be empty/);
  });

  it("allows loopback and tailscale-style addresses", () => {
    expect(() => assertBindAllowed("127.0.0.1", false)).not.toThrow();
    expect(() => assertBindAllowed("100.101.102.103", false)).not.toThrow();
  });

  it("allows 0.0.0.0 only with the explicit override", () => {
    expect(() => assertBindAllowed("0.0.0.0", true)).not.toThrow();
    expect(() => assertBindAllowed("0x00000000", true)).not.toThrow();
    expect(() => assertBindAllowed("::ffff:0.0.0.0", true)).not.toThrow();
    expect(() => assertBindAllowed("::%lo0", true)).not.toThrow();
  });

  it("validates the resolved address and returns a numeric host", async () => {
    await expect(resolveBindHost("localhost", false)).resolves.toMatch(/^(?:127\.|::1$)/);
    await expect(resolveBindHost("0", false)).rejects.toThrow(/Refusing to bind/);
    await expect(resolveBindHost("::ffff:0.0.0.0", false)).rejects.toThrow(/Refusing to bind/);
    await expect(resolveBindHost("::%lo0", false)).rejects.toThrow(/Refusing to bind/);
    await expect(resolveBindHost("0", true)).resolves.toBe("0.0.0.0");
  });

  it("refuses a hostname if any resolved address is a wildcard", async () => {
    const resolvesToMixedAddresses = async (host: string) => {
      expect(host).toBe("wildcard.example");
      return [{ address: "127.0.0.1" }, { address: "::ffff:0.0.0.0" }];
    };

    await expect(
      resolveBindHost("wildcard.example", false, resolvesToMixedAddresses),
    ).rejects.toThrow(/Refusing to bind/);
  });
});
