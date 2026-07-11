import type { Config } from "./config.js";
import type { Chains } from "./chain.js";
import type { DiscoveredBindings } from "./discovery.js";

interface CacheEntry<T> {
  value: T;
  at: number;
}

/** Tiny in-memory TTL cache (spec §4). */
export class TtlCache<T> {
  private entries = new Map<string, CacheEntry<T>>();

  constructor(readonly ttlMs: number) {}

  get(key: string): T | undefined {
    if (this.ttlMs <= 0) return undefined;
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: T): void {
    if (this.ttlMs <= 0) return;
    this.entries.set(key, { value, at: Date.now() });
  }
}

/** Balance read cache. */
export class BalanceCache extends TtlCache<bigint> {}

export interface Context {
  config: Config;
  chains: Chains;
  cache: BalanceCache;
  /** IERC7303 discovery results (role → control-token bindings). */
  discovery: TtlCache<DiscoveredBindings>;
  adminMode: boolean;
}
