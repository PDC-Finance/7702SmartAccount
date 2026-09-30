/**
 * Retire a PlatformPaymaster clone and recover its funds from the EntryPoint.
 *
 * Two runs, because the stake is time-locked:
 *   1st run — withdraws the whole gas deposit and calls unlockStake()
 *   2nd run — after the unstake delay has passed, withdraws the stake
 * The paymaster stops sponsoring as soon as the stake is unlocked.
 *
 * Run (owner key only; withdrawTo / unlockStake / withdrawStake are onlyOwner):
 *   RETIRE_PAYMASTER=0x... npx hardhat run scripts/retirePaymaster.ts --network amoy
 *
 * Required .env:
 *   PRIVATE_KEY       — paymaster owner (pays gas)
 *   RETIRE_PAYMASTER  — clone to retire
 * Optional .env:
 *   WITHDRAW_TO       — where funds go (default: owner)
 */
import { createPublicClient, createWalletClient, formatEther, getAddress, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig } from "./lib/network";

dotenv.config();

const ENTRY_POINT = (process.env.ENTRY_POINT ?? "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108") as `0x${string}`;

const paymasterAbi = parseAbi([
  "function owner() view returns (address)",
  "function getDeposit() view returns (uint256)",
  "function withdrawTo(address withdrawAddress, uint256 amount)",
  "function unlockStake()",
  "function withdrawStake(address withdrawAddress)",
]);
const entryPointAbi = parseAbi([
  "function getDepositInfo(address account) view returns ((uint256 deposit, bool staked, uint112 stake, uint32 unstakeDelaySec, uint48 withdrawTime))",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");
  if (!process.env.RETIRE_PAYMASTER) throw new Error("RETIRE_PAYMASTER not set");

  const { chain, rpcUrl } = getNetworkConfig(hre.network.name);
  const paymaster = getAddress(process.env.RETIRE_PAYMASTER);
  const signer = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
  const to = getAddress(process.env.WITHDRAW_TO ?? signer.address);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account: signer, chain, transport });

  const owner = await publicClient.readContract({ address: paymaster, abi: paymasterAbi, functionName: "owner" });
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`PRIVATE_KEY is not the paymaster owner. Expected ${owner}, got ${signer.address}`);
  }

  const info = await publicClient.readContract({
    address: ENTRY_POINT, abi: entryPointAbi, functionName: "getDepositInfo", args: [paymaster],
  });
  console.log("Network     :", hre.network.name);
  console.log("Paymaster   :", paymaster);
  console.log("Withdraw to :", to);
  console.log("Deposit     :", formatEther(info.deposit));
  console.log("Stake       :", formatEther(info.stake), info.staked ? "(locked)" : "(unlocked)");
  console.log("");

  const send = async (label: string, functionName: "withdrawTo" | "unlockStake" | "withdrawStake", args: readonly unknown[]) => {
    const hash = await walletClient.writeContract({ address: paymaster, abi: paymasterAbi, functionName, args } as never);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`  ${label}: ${hash} ✓`);
  };

  if (info.deposit > 0n) await send("withdraw deposit", "withdrawTo", [to, info.deposit]);

  if (info.staked) {
    await send("unlock stake", "unlockStake", []);
    console.log(`\nStake unlocked. Run this script again after ${info.unstakeDelaySec} s to withdraw it.`);
    return;
  }

  if (info.stake > 0n) {
    const now = Math.floor(Date.now() / 1000);
    if (info.withdrawTime > now) {
      console.log(`Stake still time-locked for ${info.withdrawTime - now} s — run again later.`);
      return;
    }
    await send("withdraw stake", "withdrawStake", [to]);
  }
  console.log("\nPaymaster retired ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
