import { createPublicClient, http, defineChain, type Address, type PublicClient } from "viem";
import {
  CoreError,
  TtlCache,
  checkRolesPinned,
  discoverBindings,
  roleHash,
  type DiscoveredBindings,
  type RoleEvidence,
} from "../../core/dist/index.js";
import type { GateConfig } from "./config.js";

export const META_NS = "io.github.kofujimura/tctc-gate";

export type DenyCode =
  | "TCTC_TOOL_UNMAPPED"
  | "TCTC_ROLE_DENIED"
  | "TCTC_CHECK_FAILED"
  | "TCTC_NAME_COLLISION"
  | "TCTC_IDENTITY_UNPROVEN";

/** Per-role observation: verdict + the exact state it was derived from.
 *  Cached and live roles in one check carry their own block numbers —
 *  a cached role must never appear to have been observed at a live block. */
export interface RoleObservation {
  role: string;
  roleHash: `0x${string}`;
  held: boolean;
  evidence: RoleEvidence[];
  observedAt: string;
  observedBlockNumber: string;
  cacheHit: boolean;
  cacheExpiresAt?: string;
}

export interface AdmissionVerdict {
  allowed: boolean;
  roles: RoleObservation[];
  missing: RoleObservation[];
  /** Live observation when any live read happened; otherwise the newest cached one. */
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
        `RPC endpoint serves chainId ${actual}, config says ${this.config.chain.chainId} — refusing to serve`,
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

    const observations = new Map<`0x${string}`, RoleObservation>();
    const toCheck: { name: string; hash: `0x${string}` }[] = [];
    for (const w of wanted) {
      const key = `${subject.toLowerCase()}:${w.hash}`;
      const cached = this.allowCache.get(key) ?? this.denyCache.get(key);
      if (cached) {
        const inCache = cached.hasRole ? this.allowCache : this.denyCache;
        const leftMs = inCache.expiresInMs(key);
        observations.set(w.hash, {
          role: w.name,
          roleHash: w.hash,
          held: cached.hasRole,
          evidence: cached.evidence,
          observedAt: cached.observedAt,
          observedBlockNumber: cached.observedBlockNumber,
          cacheHit: true,
          cacheExpiresAt: leftMs !== undefined ? new Date(Date.now() + leftMs).toISOString() : undefined,
        });
        continue;
      }
      toCheck.push(w);
    }

    let live: { observedAt: string; blockNumber: string } | undefined;
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
      live = { observedAt: pinned.observedAt, blockNumber: pinned.blockNumber.toString() };
      for (const v of pinned.verdicts) {
        const name = toCheck.find((w) => w.hash === v.role)!.name;
        const entry: CachedRoleVerdict = {
          hasRole: v.hasRole,
          evidence: v.evidence,
          observedAt: pinned.observedAt,
          observedBlockNumber: pinned.blockNumber.toString(),
        };
        (v.hasRole ? this.allowCache : this.denyCache).set(`${subject.toLowerCase()}:${v.role}`, entry);
        observations.set(v.role, {
          role: name,
          roleHash: v.role,
          held: v.hasRole,
          evidence: v.evidence,
          observedAt: pinned.observedAt,
          observedBlockNumber: pinned.blockNumber.toString(),
          cacheHit: false,
        });
      }
    }

    const ordered = wanted.map((w) => observations.get(w.hash)!);
    const missing = ordered.filter((o) => !o.held);
    const cachedOnes = ordered.filter((o) => o.cacheHit);
    const earliestExpiry = cachedOnes
      .map((o) => o.cacheExpiresAt)
      .filter((x): x is string => x !== undefined)
      .sort()[0];
    const newestCached = [...cachedOnes].sort((a, b) => a.observedAt.localeCompare(b.observedAt)).at(-1);
    return {
      allowed: missing.length === 0,
      roles: ordered,
      missing,
      observedAt: live?.observedAt ?? newestCached?.observedAt ?? new Date().toISOString(),
      observedBlockNumber: live?.blockNumber ?? newestCached?.observedBlockNumber,
      cacheHit: cachedOnes.length > 0,
      cacheExpiresAt: earliestExpiry,
    };
  }

  grantUrl(missing: { role: string }[]): string {
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
    missing?: (RoleObservation & { target: string })[];
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

/**
 * Strip anything that could identify the RPC endpoint (or any URL, which
 * may embed an API key) before a diagnostic leaves the gate process
 * (GATE_SPEC review: raw RPC errors must not reach the agent).
 */
export function maskSecrets(text: string, rpcUrl: string): string {
  return text.split(rpcUrl).join("[rpc]").replace(/https?:\/\/[^\s"')\]]+/g, "[url]");
}
