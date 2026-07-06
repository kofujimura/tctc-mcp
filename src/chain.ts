import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { Config } from "./config.js";
import { ToolError } from "./errors.js";

export class Chains {
  private viemChains = new Map<string, Chain>();
  private publicClients = new Map<string, PublicClient>();
  private walletClients = new Map<string, WalletClient>();
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

  public(name: string): PublicClient {
    let client = this.publicClients.get(name);
    if (!client) {
      client = createPublicClient({ chain: this.viemChain(name), transport: http() });
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
        transport: http(),
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
