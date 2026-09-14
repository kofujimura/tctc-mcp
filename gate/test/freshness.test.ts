import { describe, expect, it } from "vitest";
import { createPublicClient, custom, defineChain } from "viem";
import { AdmissionController } from "../src/admission.js";
import { parseGateConfig } from "../src/config.js";

// Regression test for the 4-second revocation lag found while measuring
// propagation for the paper: viem's public client memoizes eth_blockNumber
// for `cacheTime` (4 s by default), so every "live" admission was pinned to
// a block up to 4 s old and a burn was observed only after the cache
// expired. A live check must ask the endpoint for the block number every
// time.
const config = parseGateConfig({
  chain: { key: "sepolia", chainId: 11155111, rpcUrl: "https://example.invalid/rpc" },
  target: "0x873f0bf314A1e0B566015CEf9dA37783A729Fd02",
  subject: { mode: "configured", address: "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" },
  gate: { tools: { echo: ["MINTER_ROLE"] } },
  cache: { allowSeconds: 0, denySeconds: 0 },
  server: { command: "node", args: ["server.mjs"] },
});
const chain = defineChain({
  id: 11155111, name: "sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://example.invalid/rpc"] } },
});

/** A transport whose block number advances on every eth_blockNumber request. */
function countingTransport() {
  let block = 100n;
  const calls: string[] = [];
  const transport = custom({
    async request({ method }: { method: string }) {
      calls.push(method);
      if (method === "eth_blockNumber") return `0x${(block++).toString(16)}`;
      throw new Error(`unexpected ${method}`);
    },
  });
  return { transport, calls };
}

describe("block-number freshness", () => {
  it("the gate's own client is built without viem's default 4 s block cache", () => {
    const controller = new AdmissionController(config);
    expect((controller.client as unknown as { cacheTime: number }).cacheTime).toBe(0);
  });

  it("with cacheTime 0 two consecutive reads both reach the endpoint", async () => {
    const { transport, calls } = countingTransport();
    const client = createPublicClient({ chain, transport, cacheTime: 0 });
    const first = await client.getBlockNumber();
    const second = await client.getBlockNumber();
    expect(calls.filter((m) => m === "eth_blockNumber")).toHaveLength(2);
    expect(second).toBe(first + 1n);
  });

  it("documents the defect: viem's default cache would serve the stale number", async () => {
    const { transport, calls } = countingTransport();
    const client = createPublicClient({ chain, transport }); // default cacheTime = 4000 ms
    const first = await client.getBlockNumber();
    const second = await client.getBlockNumber();
    expect(calls.filter((m) => m === "eth_blockNumber")).toHaveLength(1);
    expect(second).toBe(first);
  });
});
