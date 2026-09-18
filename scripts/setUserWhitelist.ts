// Grant (or update) deployment credits on a PlatformPaymaster clone.
// Only the paymaster owner can call this. Max 3 credits per user.
// Each deployRegistry consumes 1 credit.
//
// Run:
//   npx hardhat run scripts/setUserWhitelist.ts --network sepolia
//   npx hardhat run scripts/setUserWhitelist.ts --network amoy
//   npx hardhat run scripts/setUserWhitelist.ts --network xrplEvmTestnet
//
// Required .env:
//   PRIVATE_KEY                    — paymaster owner (pays gas)
//   PAYMASTER_ADDRESS_<NETWORK>    — PlatformPaymaster clone
//
// Optional .env:
//   WHITELIST_ADDRESS  — EOA to credit (default: OWNER_PRIVATE_KEY address, else PRIVATE_KEY)
//   WHITELIST_CREDITS  — credits to set, 0–3 (default: 3)

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

const paymasterAbi = parseAbi([
  "function owner() view returns (address)",
  "function userWhitelist(address user) view returns (uint256)",
  "function setUserWhitelist(address user, uint256 credits) external",
]);

function parseCredits(raw: string | undefined): bigint {
  const credits = BigInt(raw ?? "3");
  if (credits < 0n || credits > 3n) {
    throw new Error(`WHITELIST_CREDITS must be 0–3, got ${raw}`);
  }
  return credits;
}

function resolveUser(): `0x${string}` {
  if (process.env.WHITELIST_ADDRESS) {
    return getAddress(process.env.WHITELIST_ADDRESS);
  }
  const key = process.env.OWNER_PRIVATE_KEY ?? process.env.PRIVATE_KEY;
  if (!key) throw new Error("WHITELIST_ADDRESS or OWNER_PRIVATE_KEY / PRIVATE_KEY must be set");
  return privateKeyToAccount(key as `0x${string}`).address;
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const paymasterAddress = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;
  const user = resolveUser();
  const credits = parseCredits(process.env.WHITELIST_CREDITS);

  const ownerAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: ownerAccount, chain, transport });

  const [onchainOwner, currentCredits] = await Promise.all([
    publicClient.readContract({
      address: paymasterAddress,
      abi: paymasterAbi,
      functionName: "owner",
    }),
    publicClient.readContract({
      address: paymasterAddress,
      abi: paymasterAbi,
      functionName: "userWhitelist",
      args: [user],
    }),
  ]);

  console.log("Network           :", hre.network.name);
  console.log("Paymaster         :", paymasterAddress);
  console.log("Paymaster owner   :", onchainOwner);
  console.log("Signer            :", ownerAccount.address);
  console.log("User              :", user);
  console.log("Credits now       :", currentCredits.toString());
  console.log("Credits to set    :", credits.toString());
  console.log("");

  if (onchainOwner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY is not the paymaster owner. Expected ${onchainOwner}, got ${ownerAccount.address}`,
    );
  }

  if (currentCredits === credits) {
    console.log("Already set — nothing to do.");
    return;
  }

  const txHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "setUserWhitelist",
    args: [user, credits],
  });
  console.log("setUserWhitelist tx:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });

  const after = await publicClient.readContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "userWhitelist",
    args: [user],
  });

  console.log("\n─────────────────────────────────────────────");
  console.log("User whitelist updated ✓");
  console.log("  User    :", user);
  console.log("  Credits :", after.toString());
  console.log("─────────────────────────────────────────────");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
