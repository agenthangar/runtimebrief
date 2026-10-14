import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectListCache } from "../src/routes/projects.js";

describe("ProjectListCache", () => {
  it("coalesces a cold scan and serves a recent result during refresh", async () => {
    let now = 0;
    let calls = 0;
    const pending: Array<(value: string[]) => void> = [];
    const cache = new ProjectListCache(
      () => new Promise<string[]>((resolve) => { calls++; pending.push(resolve); }),
      () => now,
      5_000,
      60_000,
    );

    const first = cache.get();
    const concurrent = cache.get();
    await Promise.resolve();
    expect(calls).toBe(1);
    pending.shift()!(["first"]);
    expect(await first).toEqual(["first"]);
    expect(await concurrent).toEqual(["first"]);

    now = 6_000;
    expect(await cache.get()).toEqual(["first"]);
    expect(await cache.get()).toEqual(["first"]);
    await Promise.resolve();
    expect(calls).toBe(2);
    pending.shift()!(["new"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await cache.get()).toEqual(["new"]);
  });

  afterEach(() => { vi.useRealTimers(); });

  it("answers at once with an hours-old scan while a slow rescan runs", async () => {
    let now = 0;
    let calls = 0;
    const pending: Array<(value: string[]) => void> = [];
    const cache = new ProjectListCache(
      () => new Promise<string[]>((resolve) => { calls++; pending.push(resolve); }),
      () => now,
    );
    const first = cache.get();
    await Promise.resolve();
    pending.shift()!(["first"]);
    expect(await first).toEqual(["first"]);

    // Idle for five hours: the next client must not wait for a 20-second scan.
    now = 5 * 60 * 60_000;
    expect(await cache.get()).toEqual(["first"]);
    expect(calls).toBe(2);
    pending.shift()!(["second"]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(await cache.get()).toEqual(["second"]);

    // Beyond six hours a result is no longer used without a new scan.
    now += 6 * 60 * 60_000 + 1;
    const blocked = cache.get();
    await Promise.resolve();
    expect(calls).toBe(3);
    pending.shift()!(["third"]);
    expect(await blocked).toEqual(["third"]);
  });

  it("keeps the scan warm in the background until closed", async () => {
    vi.useFakeTimers();
    let calls = 0;
    const cache = new ProjectListCache(async () => { calls++; return [String(calls)]; });
    cache.keepWarm(60_000);
    cache.keepWarm(60_000);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(calls).toBe(3);
    cache.close();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(calls).toBe(3);
  });

  it("does not use an expired result if the scan fails", async () => {
    let now = 0;
    let fail = false;
    const cache = new ProjectListCache(async () => {
      if (fail) throw new Error("scan failed");
      return ["first"];
    }, () => now, 5_000, 60_000);
    expect(await cache.get()).toEqual(["first"]);
    now = 60_000;
    fail = true;
    await expect(cache.get()).rejects.toThrow("scan failed");
  });
});
