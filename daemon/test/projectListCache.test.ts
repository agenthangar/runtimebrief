import { describe, expect, it } from "vitest";
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
