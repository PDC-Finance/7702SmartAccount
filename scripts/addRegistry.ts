/**
 * Authorize a token registry on PlatformPaymaster so gasless mintDocument works.
 *
 * Gasless Path B requires authorizedRegistries[registry] == true.
 * Registries deployed via paymaster.deployRegistry are auto-authorized;
 * registries from TDocDeployer (paid) need this script.
 *
 * Run:
 *   REGISTRY_ADDRESS=0x... npx hardhat run scripts/addRegistry.ts --network xrplEvmTestnet
 *
 * Or set REGISTRY_ADDRESS_<SUFFIX> in .env (e.g. REGISTRY_ADDRESS_XRPL_EVM_TESTNET).
 */
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getEnv, getNetworkConfig } from "./lib/network";

dotenv.config();

const paymasterAbi = parseAbi([
  "function owner() view returns (address)",
  "function authorizedRegistries(address registry) view returns (bool)",
  "function addRegistry(address registry) external",
]);

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const paymasterAddress = (process.env.PAYMASTER_ADDRESS?.trim() ||
    getEnv(suffix, "PAYMASTER_ADDRESS")) as `0x${string}`;
  const registry = (process.env.REGISTRY_ADDRESS?.trim() ||
    getEnv(suffix, "REGISTRY_ADDRESS", false) ||
    "") as `0x${string}`;

  if (!registry || !registry.startsWith("0x") || registry.length !== 42) {
    throw new Error(
      "Set REGISTRY_ADDRESS=0x... (or REGISTRY_ADDRESS_<NETWORK> in .env)",
    );
  }

  const ownerAccount = privateKeyToAccount(
    process.env.PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account: ownerAccount,
    chain,
    transport,
  });

  const onchainOwner = await publicClient.readContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "owner",
  });
  const already = await publicClient.readContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "authorizedRegistries",
    args: [registry],
  });

  console.log("Network   :", hre.network.name);
  console.log("Paymaster :", paymasterAddress);
  console.log("Registry  :", registry);
  console.log("Owner     :", onchainOwner);
  console.log("Signer    :", ownerAccount.address);
  console.log("Authorized:", already);

  if (onchainOwner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    throw new Error(
      `PRIVATE_KEY is not the paymaster owner. Expected ${onchainOwner}, got ${ownerAccount.address}`,
    );
  }

  if (already) {
    console.log("\nAlready authorized ✓");
    return;
  }

  const txHash = await walletClient.writeContract({
    address: paymasterAddress,
    abi: paymasterAbi,
    functionName: "addRegistry",
    args: [registry],
  });
  console.log("addRegistry tx:", txHash);
  await publicClient.waitForTransactionReceipt({ hash: txHash });
  console.log("Registry authorized ✓");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
