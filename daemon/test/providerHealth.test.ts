import { describe, expect, it, vi } from "vitest";
import { NativeProviderHealth } from "../src/launches/providerHealth.js";
describe("shared native provider health", () => {
  it("shares the pending account check and reuses success across models and launches", async () => {
    let finish!: (value: { available: boolean; message: string }) => void;
    const read = vi.fn(() => new Promise<{ available: boolean; message: string }>(resolve => { finish = resolve; }));
    const health = new NativeProviderHealth(read);
    const first = health.get(), second = health.get();
    expect(first).toBe(second); finish({ available: true, message: "Ready" });
    await first; await health.get(); expect(read).toHaveBeenCalledTimes(1);
  });
  it("rechecks successful accounts after five minutes and unavailable accounts after thirty seconds", async () => {
    let now = 0; const read = vi.fn().mockResolvedValue({ available: true, message: "Ready" });
    const health = new NativeProviderHealth(read, () => now);
    await health.get(); now = 299999; await health.get(); expect(read).toHaveBeenCalledTimes(1);
    now = 300000; read.mockResolvedValue({ available: false, message: "Check setup" }); await health.get();
    now += 29999; await health.get(); expect(read).toHaveBeenCalledTimes(2);
    now++; await health.get(); expect(read).toHaveBeenCalledTimes(3);
  });
  it("does not retain a thrown check or leave its pending check stuck", async () => {
    const read = vi.fn().mockRejectedValueOnce(Error("Temporary failure")).mockResolvedValue({ available: true, message: "Ready" });
    const health = new NativeProviderHealth(read);
    await expect(health.get()).rejects.toThrow("Temporary failure");
    expect(await health.get()).toMatchObject({ available: true }); expect(read).toHaveBeenCalledTimes(2);
  });
});
