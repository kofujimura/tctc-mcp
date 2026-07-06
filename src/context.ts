import type { Config } from "./config.js";
import type { Chains } from "./chain.js";

interface CacheEntry {
  value: bigint;
  at: number;
}

/** Tiny in-memory TTL cache for balance reads (spec §4). */
export class BalanceCache {
  private entries = new Map<string, CacheEntry>();

  constructor(readonly ttlMs: number) {}

  get(key: string): bigint | undefined {
    if (this.ttlMs <= 0) return undefined;
    const e = this.entries.get(key);
    if (!e) return undefined;
    if (Date.now() - e.at > this.ttlMs) {
      this.entries.delete(key);
      return undefined;
    }
    return e.value;
  }

  set(key: string, value: bigint): void {
    if (this.ttlMs <= 0) return;
    this.entries.set(key, { value, at: Date.now() });
  }
}

export interface Context {
  config: Config;
  chains: Chains;
  cache: BalanceCache;
  adminMode: boolean;
}
