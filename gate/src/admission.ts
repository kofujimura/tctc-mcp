import { createPublicClient, http, defineChain, type Address, type PublicClient } from "viem";
import {
  CoreError,
  TtlCache,
  checkRolesPinned,
  discoverBindings,
  roleHash,
  type DiscoveredBindings,
  type RoleEvidence,
} from "../../core/src/index.js";
import type { GateConfig } from "./config.js";

export const META_NS = "io.github.kofujimura/tctc-gate";

export type DenyCode =
  | "TCTC_TOOL_UNMAPPED"
  | "TCTC_ROLE_DENIED"
  | "TCTC_CHECK_FAILED"
  | "TCTC_NAME_COLLISION"
  | "TCTC_IDENTITY_UNPROVEN";

export interface MissingRole {
  role: string;
  roleHash: `0x${string}`;
  target: Address;
  evidence: RoleEvidence[];
}

export interface AdmissionVerdict {
  allowed: boolean;
  missing: MissingRole[];
  observedAt: string;
  observedBlockNumber?: string;
  cacheHit: boolean;
  cacheExpiresAt?: string;
}

interface CachedRoleVerdict {
  hasRole: boolean;
  evidence: RoleEvidence[];
  observedAt: string;
  observedBlockNumber: string;
}

/** Admission checks with GATE_SPEC §6 semantics: allow cache 0 by default,
 *  deny cache 10 s, bindings 60 s, pinned reads. */
export class AdmissionController {
  readonly client: PublicClient;
  private bindings = new TtlCache<DiscoveredBindings>(60_000);
  private allowCache: TtlCache<CachedRoleVerdict>;
  private denyCache: TtlCache<CachedRoleVerdict>;

  constructor(readonly config: GateConfig, client?: PublicClient) {
    this.client =
      client ??
      createPublicClient({
        chain: defineChain({
          id: config.chain.chainId,
          name: config.chain.key,
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [config.chain.rpcUrl] } },
        }),
        transport: http(config.chain.rpcUrl),
      });
    this.allowCache = new TtlCache(config.cache.allowSeconds * 1000);
    this.denyCache = new TtlCache(config.cache.denySeconds * 1000);
  }

  /** Startup pin: the RPC endpoint is the authorization oracle (§2). */
  async verifyChainId(): Promise<void> {
    const actual = await this.client.getChainId();
    if (actual !== this.config.chain.chainId) {
      throw new Error(
        `RPC ${this.config.chain.rpcUrl} serves chainId ${actual}, config says ${this.config.chain.chainId} — refusing to serve`,
      );
    }
  }

  private async bindingsFor(hash: `0x${string}`): Promise<DiscoveredBindings> {
    const key = `${this.config.target.toLowerCase()}:${hash}`;
    const cached = this.bindings.get(key);
    if (cached) return cached;
    const found = await discoverBindings(this.client, this.config.target as Address, hash);
    this.bindings.set(key, found);
    return found;
  }

  /** Check the configured subject against a set of roles (AND). */
  async check(roles: string[]): Promise<AdmissionVerdict> {
    const subject = this.config.subject.address as Address;
    const wanted = roles.map((name) => ({ name, hash: roleHash(name) }));

    const fromCache = new Map<`0x${string}`, { verdict: CachedRoleVerdict; expiresInMs?: number }>();
    const toCheck: { name: string; hash: `0x${string}` }[] = [];
    for (const w of wanted) {
      const key = `${subject.toLowerCase()}:${w.hash}`;
      const allow = this.allowCache.get(key);
      if (allow) {
        fromCache.set(w.hash, { verdict: allow, expiresInMs: this.allowCache.expiresInMs(key) });
        continue;
      }
      const deny = this.denyCache.get(key);
      if (deny) {
        fromCache.set(w.hash, { verdict: deny, expiresInMs: this.denyCache.expiresInMs(key) });
        continue;
      }
      toCheck.push(w);
    }

    let liveObserved: { observedAt: string; blockNumber: string } | undefined;
    if (toCheck.length > 0) {
      const withBindings = await Promise.all(
        toCheck.map(async (w) => ({ ...w, bindings: await this.bindingsFor(w.hash) })),
      );
      const pinned = await checkRolesPinned(
        this.client,
        this.config.target as Address,
        subject,
        withBindings.map((w) => ({ hash: w.hash, bindings: w.bindings })),
      );
      liveObserved = { observedAt: pinned.observedAt, blockNumber: pinned.blockNumber.toString() };
      for (const v of pinned.verdicts) {
        const entry: CachedRoleVerdict = {
          hasRole: v.hasRole,
          evidence: v.evidence,
          observedAt: pinned.observedAt,
          observedBlockNumber: pinned.blockNumber.toString(),
        };
        const key = `${subject.toLowerCase()}:${v.role}`;
        (v.hasRole ? this.allowCache : this.denyCache).set(key, entry);
        fromCache.set(v.role, { verdict: entry });
      }
    }

    const missing: MissingRole[] = [];
    let cacheHit = toCheck.length < wanted.length;
    let earliestCacheExpiry: number | undefined;
    for (const w of wanted) {
      const got = fromCache.get(w.hash)!;
      if (got.expiresInMs !== undefined) {
        earliestCacheExpiry = Math.min(earliestCacheExpiry ?? Infinity, got.expiresInMs);
      }
      if (!got.verdict.hasRole) {
        missing.push({
          role: w.name,
          roleHash: w.hash,
          target: this.config.target as Address,
          evidence: got.verdict.evidence,
        });
      }
    }

    const observed = liveObserved ?? {
      observedAt: [...fromCache.values()][0]?.verdict.observedAt ?? new Date().toISOString(),
      blockNumber: [...fromCache.values()][0]?.verdict.observedBlockNumber ?? "unknown",
    };
    return {
      allowed: missing.length === 0,
      missing,
      observedAt: observed.observedAt,
      observedBlockNumber: observed.blockNumber,
      cacheHit,
      cacheExpiresAt:
        earliestCacheExpiry !== undefined
          ? new Date(Date.now() + earliestCacheExpiry).toISOString()
          : undefined,
    };
  }

  grantUrl(missing: MissingRole[]): string {
    const u = new URL(this.config.grantUrlBase);
    u.searchParams.set("chain", this.config.chain.key);
    u.searchParams.set("target", this.config.target);
    u.searchParams.set("subject", this.config.subject.address);
    u.searchParams.set("roles", missing.map((m) => m.role).join(","));
    return u.toString();
  }
}

/** MCP tool-result deny (GATE_SPEC §5.3): isError text + namespaced _meta. */
export function denyResult(
  code: DenyCode,
  tool: string,
  config: GateConfig,
  detail: {
    text: string;
    missing?: MissingRole[];
    observedAt?: string;
    observedBlockNumber?: string;
    cacheHit?: boolean;
    cacheExpiresAt?: string;
    grantUrl?: string;
  },
): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    code,
    tool,
    subject: config.subject.address,
    identity: config.subject.mode,
  };
  if (detail.missing) meta.missing = detail.missing;
  if (detail.observedAt) meta.observedAt = detail.observedAt;
  if (detail.observedBlockNumber) meta.observedBlockNumber = detail.observedBlockNumber;
  if (detail.cacheHit !== undefined) meta.cacheHit = detail.cacheHit;
  if (detail.cacheExpiresAt) meta.cacheExpiresAt = detail.cacheExpiresAt;
  if (detail.grantUrl) meta.grantUrl = detail.grantUrl;
  return {
    isError: true,
    content: [{ type: "text", text: detail.text }],
    _meta: { [META_NS]: meta },
  };
}

export function isCoreUnavailable(e: unknown): boolean {
  return e instanceof CoreError;
}
