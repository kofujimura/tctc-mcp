import { describe, it, expect } from "vitest";
import { computeTbaAddress } from "../src/identity.js";

describe("computeTbaAddress", () => {
  // Ground truth obtained from the canonical ERC-6551 registry on Sepolia
  // (0x…6551c19…5758) via eth_call to account(...) on 2026-07-06.
  it("matches the on-chain registry computation", () => {
    const tba = computeTbaAddress({
      registry: "0x000000006551c19487814612e58FE06813775758",
      implementation: "0x41C8f39463A868d3A88af00cd0fe7102F30E44eC",
      salt: "0x0",
      chainId: 11155111,
      tokenContract: "0xa52fe39D0de852e88488faa34e723E861D0b09BD",
      tokenId: 7n,
    });
    expect(tba.toLowerCase()).toBe("0x3f9563ef9289abbfc9efc1e06497890dd44bde6f");
  });

  it("is deterministic and sensitive to tokenId", () => {
    const params = {
      registry: "0x000000006551c19487814612e58FE06813775758",
      implementation: "0x41C8f39463A868d3A88af00cd0fe7102F30E44eC",
      salt: "0x0",
      chainId: 11155111,
      tokenContract: "0xa52fe39D0de852e88488faa34e723E861D0b09BD",
    } as const;
    expect(computeTbaAddress({ ...params, tokenId: 1n })).toBe(
      computeTbaAddress({ ...params, tokenId: 1n }),
    );
    expect(computeTbaAddress({ ...params, tokenId: 1n })).not.toBe(
      computeTbaAddress({ ...params, tokenId: 2n }),
    );
  });
});
