import type { LaunchCapability } from "./types.js";

/** Account checks are shared across catalogs and launches on this Mac. */
export class NativeProviderHealth {
  private cached: { value: LaunchCapability; at: number } | undefined;
  private pending: Promise<LaunchCapability> | undefined;
  constructor(private readonly read: () => Promise<LaunchCapability>, private readonly now = Date.now) {}
  get(): Promise<LaunchCapability> {
    if (this.cached && this.now() - this.cached.at < (this.cached.value.available ? 300000 : 30000)) {
      return Promise.resolve(this.cached.value);
    }
    if (!this.pending) {
      this.pending = this.read().then(value => {
        this.cached = { value, at: this.now() }; return value;
      }).finally(() => { this.pending = undefined; });
    }
    return this.pending;
  }
}
