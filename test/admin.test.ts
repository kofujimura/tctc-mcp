import { describe, it, expect } from "vitest";
import { parseAbi, type AbiFunction } from "viem";
import { buildArgs, pickControlToken } from "../src/admin.js";
import { ToolError } from "../src/errors.js";
import type { RoleConfig } from "../src/config.js";

const SUBJECT = "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03" as const;

function abiFn(sig: string): AbiFunction {
  return parseAbi([`function ${sig}`])[0] as AbiFunction;
}

describe("buildArgs", () => {
  it("maps $subject and $typeId with type coercion", () => {
    const args = buildArgs(
      { function: "mint(address,uint256,uint256)", args: ["$subject", "$typeId", 1] },
      abiFn("mint(address,uint256,uint256)"),
      { subject: SUBJECT, typeId: 2n },
    );
    expect(args).toEqual([SUBJECT, 2n, 1n]);
  });

  it("defaults to a single $subject argument", () => {
    const args = buildArgs(
      { function: "safeMint(address)", args: ["$subject"] },
      abiFn("safeMint(address)"),
      { subject: SUBJECT, typeId: null },
    );
    expect(args).toEqual([SUBJECT]);
  });

  it("rejects $typeId for erc721 control tokens (typeId null)", () => {
    expect(() =>
      buildArgs(
        { function: "burn(address,uint256)", args: ["$subject", "$typeId"] },
        abiFn("burn(address,uint256)"),
        { subject: SUBJECT, typeId: null },
      ),
    ).toThrow(ToolError);
  });

  it("rejects argument count mismatches", () => {
    expect(() =>
      buildArgs(
        { function: "mint(address,uint256,uint256)", args: ["$subject"] },
        abiFn("mint(address,uint256,uint256)"),
        { subject: SUBJECT, typeId: 1n },
      ),
    ).toThrow(/argument/);
  });

  it("rejects non-address values for address parameters", () => {
    expect(() =>
      buildArgs(
        { function: "safeMint(address)", args: ["not-an-address"] },
        abiFn("safeMint(address)"),
        { subject: SUBJECT, typeId: null },
      ),
    ).toThrow(/address/);
  });
});

describe("pickControlToken", () => {
  const token = (addr: string) =>
    ({ chain: "sepolia", standard: "erc1155", address: addr, typeId: 1n }) as RoleConfig["controlTokens"][number];

  it("defaults to the only token", () => {
    const role = { controlTokens: [token("0x" + "11".repeat(20))] } as RoleConfig;
    expect(pickControlToken("R", role).address).toBe("0x" + "11".repeat(20));
  });

  it("requires an index when multiple tokens exist", () => {
    const role = {
      controlTokens: [token("0x" + "11".repeat(20)), token("0x" + "22".repeat(20))],
    } as RoleConfig;
    expect(() => pickControlToken("R", role)).toThrow(/controlTokenIndex/);
    expect(pickControlToken("R", role, 1).address).toBe("0x" + "22".repeat(20));
  });

  it("rejects out-of-range indexes", () => {
    const role = { controlTokens: [token("0x" + "11".repeat(20))] } as RoleConfig;
    expect(() => pickControlToken("R", role, 5)).toThrow(/controlTokens\[5\]/);
  });
});
