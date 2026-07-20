/**
 * Reset the demo state before a shoot: burn ALL MinterCert/BurnerCert
 * balances of the demo agent so every take starts from zero.
 * Needs ALCHEMY_API_KEY and TCTC_ADMIN_PRIVATE_KEY.
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const CT = "0x12342A7F0190B3AF3F4b47546D34006EDA54eE0B";
const AGENT = process.env.E2E_SUBJECT ?? "0x31F8FDf2BA077c0f39852b6daAE028a5A7475d03";

const abi = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function burnByIssuer(address account, uint256 id, uint256 amount)",
]);

const transport = http(
  `https://eth-sepolia.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`,
);
const account = privateKeyToAccount(process.env.TCTC_ADMIN_PRIVATE_KEY);
const pub = createPublicClient({ chain: sepolia, transport });
const wallet = createWalletClient({ chain: sepolia, transport, account });

for (const id of [1n, 2n]) {
  const balance = await pub.readContract({
    address: CT, abi, functionName: "balanceOf", args: [AGENT, id],
  });
  if (balance > 0n) {
    console.log(`burning typeId ${id} balance ${balance} of ${AGENT}`);
    const hash = await wallet.writeContract({
      address: CT, abi, functionName: "burnByIssuer", args: [AGENT, id, balance],
    });
    await pub.waitForTransactionReceipt({ hash });
    console.log(`  burned: ${hash}`);
  } else {
    console.log(`typeId ${id}: already 0`);
  }
}
console.log("state reset: agent holds no certs");
