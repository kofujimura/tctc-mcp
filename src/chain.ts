import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type PublicClient,
  type Transport,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { ToolError } from "./errors.js";

type RequestFn = (args: { method: string; params?: unknown }, options?: unknown) => Promise<unknown>;

/**
 * Verify that the RPC actually serves the configured chain (the RPC is the
 * authorization oracle — a wrong endpoint would silently authorize from
 * another chain's state). Returns the memoizable verdict:
 * a mismatch is deterministic and permanent; network failures throw and are
 * retried on the next call (fail-closed per call).
 */
export async function verifyRpcChainId(
  request: RequestFn,
  name: string,
  expectedId: number,
): Promise<void> {
  let reported: unknown;
  try {
    reported = await request({ method: "eth_chainId" });
  } catch (error) {
    throw new ToolError(
      "CHAIN_UNAVAILABLE",
      `could not verify the chain id of chain "${name}": ${(error as Error).message}`,
    );
  }
  const actual = typeof reported === "string" ? Number.parseInt(reported, 16) : NaN;
  if (!Number.isSafeInteger(actual)) {
    throw new ToolError(
      "CHAIN_UNAVAILABLE",
      `RPC for chain "${name}" returned an invalid eth_chainId response`,
    );
  }
  if (actual !== expectedId) {
    throw new ToolError(
      "CHAIN_MISMATCH",
      `RPC for chain "${name}" serves chain id ${actual}, but the config expects ${expectedId} — refusing to serve`,
    );
  }
}

export class Chains {
  private viemChains = new Map<string, Chain>();
  private publicClients = new Map<string, PublicClient>();
  private walletClients = new Map<string, WalletClient>();
  private chainVerifications = new Map<string, Promise<void>>();
  readonly adminAccount?: Account;

  constructor(
    private readonly config: Config,
    adminPrivateKey?: `0x${string}`,
  ) {
    if (adminPrivateKey) {
      this.adminAccount = privateKeyToAccount(adminPrivateKey);
    }
  }

  private viemChain(name: string): Chain {
    let chain = this.viemChains.get(name);
    if (!chain) {
      const cfg = this.config.chains[name];
      if (!cfg) {
        throw new ToolError("CHAIN_UNAVAILABLE", `chain "${name}" is not configured`);
      }
      chain = defineChain({
        id: cfg.chainId,
        name,
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: [cfg.rpcUrl] } },
      });
      this.viemChains.set(name, chain);
    }
    return chain;
  }

  chainId(name: string): number {
    return this.viemChain(name).id;
  }

  /**
   * An http transport whose first use verifies eth_chainId against the config
   * (memoized per chain; a mismatch stays fatal, a network failure is retried
   * on the next call). The transport is the one funnel every viem action goes
   * through, so call sites need no changes.
   */
  private gatedTransport(name: string): Transport {
    const expectedId = this.viemChain(name).id;
    const base = http();
    const gated: Transport = (params) => {
      const transport = base(params);
      const original = transport.request.bind(transport) as RequestFn;
      const request = (async (args: { method: string; params?: unknown }, options?: unknown) => {
        let verification = this.chainVerifications.get(name);
        if (!verification) {
          verification = verifyRpcChainId(original, name, expectedId);
          this.chainVerifications.set(name, verification);
        }
        try {
          await verification;
        } catch (error) {
          if (!(error instanceof ToolError && error.code === "CHAIN_MISMATCH")) {
            this.chainVerifications.delete(name);
          }
          throw error;
        }
        return original(args, options);
      }) as typeof transport.request;
      return { ...transport, request };
    };
    return gated;
  }

  public(name: string): PublicClient {
    let client = this.publicClients.get(name);
    if (!client) {
      client = createPublicClient({
        chain: this.viemChain(name),
        transport: this.gatedTransport(name),
      });
      this.publicClients.set(name, client);
    }
    return client;
  }

  wallet(name: string): WalletClient {
    if (!this.adminAccount) {
      throw new ToolError(
        "NOT_ADMIN_MODE",
        "server is running in read-only mode (TCTC_ADMIN_PRIVATE_KEY is not set)",
      );
    }
    let client = this.walletClients.get(name);
    if (!client) {
      client = createWalletClient({
        chain: this.viemChain(name),
        transport: this.gatedTransport(name),
        account: this.adminAccount,
      });
      this.walletClients.set(name, client);
    }
    return client;
  }
}

export function assertAddress(value: string, label: string): Address {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw new ToolError("INVALID_INPUT", `${label} is not a valid address: ${value}`);
  }
  return value as Address;
}
