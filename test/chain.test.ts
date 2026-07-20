import { describe, expect, it, vi } from "vitest";
import { verifyRpcChainId, Chains } from "../src/chain.js";
import { ToolError, unwrapToolError } from "../src/errors.js";
import type { Config } from "../src/config.js";

const SEPOLIA_HEX = "0xaa36a7"; // 11155111
const MAINNET_HEX = "0x1";

describe("verifyRpcChainId", () => {
  it("accepts an RPC that reports the configured chain id", async () => {
    const request = vi.fn().mockResolvedValue(SEPOLIA_HEX);
    await expect(verifyRpcChainId(request, "sepolia", 11155111)).resolves.toBeUndefined();
    expect(request).toHaveBeenCalledWith({ method: "eth_chainId" });
  });

  it("rejects an RPC that serves a different chain with CHAIN_MISMATCH", async () => {
    const request = vi.fn().mockResolvedValue(MAINNET_HEX);
    const failure = verifyRpcChainId(request, "sepolia", 11155111);
    await expect(failure).rejects.toBeInstanceOf(ToolError);
    await expect(failure).rejects.toMatchObject({ code: "CHAIN_MISMATCH" });
    await expect(failure).rejects.toThrow(/serves chain id 1.*expects 11155111/);
  });

  it("maps network failures and malformed responses to CHAIN_UNAVAILABLE", async () => {
    await expect(
      verifyRpcChainId(vi.fn().mockRejectedValue(new Error("ECONNREFUSED")), "sepolia", 11155111),
    ).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
    await expect(
      verifyRpcChainId(vi.fn().mockResolvedValue({ odd: true }), "sepolia", 11155111),
    ).rejects.toMatchObject({ code: "CHAIN_UNAVAILABLE" });
  });
});

describe("Chains chain-id gate", () => {
  const config = {
    chains: { sepolia: { chainId: 11155111, rpcUrl: "http://127.0.0.1:1/unused" } },
    defaultChain: "sepolia",
    roles: {},
  } as unknown as Config;

  type Requestable = { request: (args: { method: string }) => Promise<unknown> };

  it("gates RPC calls on verification and retries after a network failure", async () => {
    const chains = new Chains(config);
    const client = chains.public("sepolia") as unknown as Requestable;
    // The configured RPC is unreachable: verification must fail closed with
    // CHAIN_UNAVAILABLE, and the failure must be retryable, not poisoned.
    // viem may wrap the transport-level throw, so unwrap before asserting.
    for (let attempt = 0; attempt < 2; attempt++) {
      const rejection = await client.request({ method: "eth_blockNumber" }).then(
        () => undefined,
        (error: unknown) => error,
      );
      expect(rejection).toBeDefined();
      expect(unwrapToolError(rejection)).toMatchObject({ code: "CHAIN_UNAVAILABLE" });
    }
  });

  it("returns the same wrapped client instance on repeated lookups", () => {
    const chains = new Chains(config);
    expect(chains.public("sepolia")).toBe(chains.public("sepolia"));
  });
});

describe("unwrapToolError", () => {
  it("recovers a ToolError buried in a viem-style cause chain", () => {
    const gate = new ToolError("CHAIN_MISMATCH", "refusing to serve");
    const wrapped = new Error("contract call failed", {
      cause: new Error("transport", { cause: gate }),
    });
    expect(unwrapToolError(wrapped)).toBe(gate);
    expect(unwrapToolError(new Error("unrelated"))).toBeUndefined();
    expect(unwrapToolError("not an error")).toBeUndefined();
  });
});
