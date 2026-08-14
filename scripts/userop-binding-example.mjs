// Synthetic ERC-4337 v0.7 UserOp worked example for the erc4337-userop.v1 binding mode.
// Computes: inner mint calldata, outer execute() callData, userOpHash (viem), artifact preimage + hash.
import { encodeFunctionData, parseGwei } from "viem";
import { getUserOperationHash } from "viem/account-abstraction";
import { createHash } from "node:crypto";

// RFC 8785 JCS (same implementation used in the issue #3 audit)
function jcs(v) {
  if (v === null || typeof v === "boolean") return JSON.stringify(v);
  if (typeof v === "number") {
    if (!Number.isInteger(v)) throw new Error("non-integer number");
    return String(v);
  }
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(jcs).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcs(v[k])).join(",") + "}";
}
const sha256hex = (s) => createHash("sha256").update(s, "utf8").digest("hex");

const chainId = 11155111; // Sepolia
const entryPoint = "0x0000000071727De22E5E9d8BAf0edAc6f37da032"; // canonical v0.7
const sender = "0x7303730373037303730373037303730373037303"; // synthetic smart account
const target = "0x127093739bb7aF8Aa05e89806Fa8C98941335119"; // AgentControlTokens (issue #3 redeploy)

// inner call: mint(sender, MINTER_CERT=1, 1) — same action as the issue #3 EOA demo
const innerCalldata = encodeFunctionData({
  abi: [{ type: "function", name: "mint", inputs: [
    { name: "to", type: "address" }, { name: "id", type: "uint256" }, { name: "amount", type: "uint256" } ] }],
  functionName: "mint",
  args: [sender, 1n, 1n],
});
console.log("innerCalldata:", innerCalldata);

// outer callData: SimpleAccount.execute(dest, value, func)
const callData = encodeFunctionData({
  abi: [{ type: "function", name: "execute", inputs: [
    { name: "dest", type: "address" }, { name: "value", type: "uint256" }, { name: "func", type: "bytes" } ] }],
  functionName: "execute",
  args: [target, 0n, innerCalldata],
});
console.log("callData:", callData);

const userOperation = {
  sender,
  nonce: 7n,
  callData,
  callGasLimit: 100000n,
  verificationGasLimit: 150000n,
  preVerificationGas: 50000n,
  maxFeePerGas: parseGwei("2"),
  maxPriorityFeePerGas: parseGwei("1"),
  signature: "0x", // not part of userOpHash (it is what gets signed)
};

const userOpHash = getUserOperationHash({
  chainId,
  entryPointAddress: entryPoint,
  entryPointVersion: "0.7",
  userOperation,
});
console.log("userOpHash:", userOpHash);

const preimageObj = {
  chainId,
  entryPoint: entryPoint.toLowerCase(),
  userOpHash: userOpHash.toLowerCase(),
};
const preimage = jcs(preimageObj);
console.log("preimage JCS:", preimage);
console.log("artifact_hash: sha256:" + sha256hex(preimage));
