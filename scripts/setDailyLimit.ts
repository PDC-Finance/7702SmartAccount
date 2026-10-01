// Set the per-user daily gas cap on a PlatformPaymaster clone (owner only).
// Applies to Path A ops and mintDocument; deployRegistry is credit-gated instead.
// The paymaster reserves each op's maxCost against the cap at validation time,
// so the cap must cover a few ops' worst-case cost, not their actual cost.
//
// Run:
//   DAILY_LIMIT_ETH=0.01 npx hardhat run scripts/setDailyLimit.ts --network sepolia
//
// Required .env:
//   PRIVATE_KEY                  — paymaster owner (pays gas)
//   PAYMASTER_ADDRESS_<NETWORK>  — PlatformPaymaster clone
//   DAILY_LIMIT_ETH              — cap in the chain's native token (0 = unlimited)

import { createPublicClient, createWalletClient, formatEther, http, parseAbi, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getEnv, getNetworkConfig } from "./lib/network";
dotenv.config();

const paymasterAbi = parseAbi([
  "function owner() view returns (address)",
  "function dailyLimit() view returns (uint256)",
  "function setDailyLimit(uint256 _dailyLimit) external",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (process.env.DAILY_LIMIT_ETH === undefined) throw new Error("DAILY_LIMIT_ETH not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const paymaster = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;
  const limit = parseEther(process.env.DAILY_LIMIT_ETH);

  const signer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: signer, chain, transport });

  const [owner, current] = await Promise.all([
    publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "owner" }),
    publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "dailyLimit" }),
  ]);

  console.log("Network   :", hre.network.name);
  console.log("Paymaster :", paymaster);
  console.log("Current   :", formatEther(current), "(0 = unlimited)");
  console.log("New       :", formatEther(limit));

  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`PRIVATE_KEY is not the paymaster owner. Expected ${owner}, got ${signer.address}`);
  }
  if (current === limit) {
    console.log("\nAlready set — nothing to do.");
    return;
  }

  const hash = await walletClient.writeContract({
    address: paymaster,
    abi: paymasterAbi,
    functionName: "setDailyLimit",
    args: [limit],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  const after = await publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "dailyLimit" });
  console.log("\nsetDailyLimit tx:", hash);
  console.log("Daily limit now :", formatEther(after), "✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
