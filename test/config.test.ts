import { describe, it, expect } from "vitest";
import { parseConfig } from "../src/config.js";
import { ConfigError } from "../src/errors.js";

const CT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B";

function baseConfig(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    chains: { sepolia: { chainId: 11155111, rpcUrl: "https://rpc.example" } },
    defaultChain: "sepolia",
    roles: {
      MINTER_ROLE: {
        controlTokens: [
          { chain: "sepolia", standard: "erc1155", address: CT, typeId: 1 },
        ],
      },
    },
    ...overrides,
  });
}

describe("parseConfig", () => {
  it("parses a minimal valid config", () => {
    const cfg = parseConfig(baseConfig(), {});
    expect(cfg.roles.MINTER_ROLE.controlTokens[0].typeId).toBe(1n);
    expect(cfg.defaultChain).toBe("sepolia");
  });

  it("substitutes ${ENV_VAR} and errors when unset", () => {
    const json = baseConfig({
      chains: { sepolia: { chainId: 11155111, rpcUrl: "https://x/${MY_KEY}" } },
    });
    const cfg = parseConfig(json, { MY_KEY: "abc123" });
    expect(cfg.chains.sepolia.rpcUrl).toBe("https://x/abc123");
    expect(() => parseConfig(json, {})).toThrow(/MY_KEY/);
  });

  it("rejects private keys anywhere in the config", () => {
    const key = "0x" + "ab".repeat(32);
    const json = baseConfig({ self: { address: CT }, leaked: key });
    expect(() => parseConfig(json, {})).toThrow(/private key/);
  });

  it("rejects a private key arriving via env substitution", () => {
    const json = baseConfig({
      chains: { sepolia: { chainId: 11155111, rpcUrl: "${SNEAKY}" } },
    });
    expect(() => parseConfig(json, { SNEAKY: "0x" + "cd".repeat(32) })).toThrow(
      ConfigError,
    );
  });

  it("allows a 32-byte erc6551 salt (not a private key)", () => {
    const salt = "0x" + "00".repeat(31) + "01";
    const json = baseConfig({
      identity: {
        chain: "sepolia",
        identityRegistry: CT,
        erc6551: { registry: CT, accountImplementation: CT, salt },
      },
    });
    expect(parseConfig(json, {}).identity?.erc6551.salt).toBe(salt);
  });

  it("requires typeId for erc1155 and forbids it for erc721", () => {
    const noTypeId = baseConfig({
      roles: {
        R: { controlTokens: [{ chain: "sepolia", standard: "erc1155", address: CT }] },
      },
    });
    expect(() => parseConfig(noTypeId, {})).toThrow(/requires typeId/);

    const badErc721 = baseConfig({
      roles: {
        R: {
          controlTokens: [
            { chain: "sepolia", standard: "erc721", address: CT, typeId: 1 },
          ],
        },
      },
    });
    expect(() => parseConfig(badErc721, {})).toThrow(/must not have typeId/);
  });

  it("rejects references to unknown chains", () => {
    const badChain = baseConfig({ defaultChain: "mainnet" });
    expect(() => parseConfig(badChain, {})).toThrow(/defaultChain/);

    const badTokenChain = baseConfig({
      roles: {
        R: {
          controlTokens: [
            { chain: "polygon", standard: "erc1155", address: CT, typeId: 1 },
          ],
        },
      },
    });
    expect(() => parseConfig(badTokenChain, {})).toThrow(/polygon/);
  });

  it("requires identity when self.agentId is used", () => {
    expect(() => parseConfig(baseConfig({ self: { agentId: 1 } }), {})).toThrow(
      /identity/,
    );
  });

  it("accepts the shipped Sepolia example config", async () => {
    const { readFileSync } = await import("node:fs");
    const raw = readFileSync(new URL("../examples/config.sepolia.json", import.meta.url), "utf8");
    const cfg = parseConfig(raw, { ALCHEMY_API_KEY: "test" });
    expect(Object.keys(cfg.roles)).toContain("MINTER_ROLE");
    expect(cfg.roles.MINTER_ROLE.admin?.revoke?.function).toBe(
      "burnByIssuer(address,uint256,uint256)",
    );
  });
});
