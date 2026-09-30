// Gasless TDoc registry deployment via EIP-7702 + permissionless (EntryPoint v0.8).
//
// Flow:
//   1. EOA is delegated (type-4 tx) to permissionless impl if not already
//   2. UserOp calls: execute(PAYMASTER, 0, deployRegistry(implementation, name, symbol))
//   3. PlatformPaymaster sponsors gas when userWhitelist[sender] > 0
//
// Run: npx ts-node scripts/deployRegistryGasless.ts
//
// Required .env:
//   NETWORK                       — sepolia | amoy  (default: sepolia)
//   PIMLICO_API_KEY               — Pimlico bundler (all networks except xrplEvmTestnet, which uses Alto)
//   OWNER_PRIVATE_KEY             — whitelisted user's key (signs UserOps, needs no ETH)
//   PRIVATE_KEY                   — funded wallet (pays gas for delegation tx)
//   SEPOLIA_RPC_URL / AMOY_RPC_URL
//   PAYMASTER_ADDRESS_<NETWORK>   — deployed PlatformPaymaster
//   TDOC_IMPLEMENTATION_<NETWORK> — TDoc implementation contract to clone
//   TOKEN_NAME                    — name of the TradeTrust token
//   TOKEN_SYMBOL                  — symbol of the TradeTrust token

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  parseAbi,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { entryPoint08Address } from "viem/account-abstraction";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv, getBundlerUrl, getAccountImpl } from "./lib/network";
dotenv.config();


const paymasterAbi = parseAbi([
  "function deployRegistry(address implementation, string name, string symbol) external returns (address deployed)",
  "event RegistryDeployed(address indexed user, address indexed deployed, uint256 creditsLeft)",
]);

async function main() {
  if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.TOKEN_NAME) throw new Error("TOKEN_NAME not set");
  if (!process.env.TOKEN_SYMBOL) throw new Error("TOKEN_SYMBOL not set");

  const networkName = process.env.NETWORK ?? "sepolia";
  const { chain, rpcUrl, chainId, suffix } = getNetworkConfig(networkName);
  const PAYMASTER_ADDR = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;
  const tdocImpl = getEnv(suffix, "TDOC_IMPLEMENTATION") as `0x${string}`;
  const PIMLICO_URL = getBundlerUrl(suffix, chainId);
  const PERMISSIONLESS_IMPL = getAccountImpl(suffix);

  const ownerAccount = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  console.log("Network                  :", networkName);
  console.log("Owner (whitelisted user) :", ownerAccount.address);
  console.log("Paymaster                :", PAYMASTER_ADDR);
  console.log("Permissionless impl      :", PERMISSIONLESS_IMPL);
  console.log("TDoc Implementation      :", tdocImpl);
  console.log("Token name               :", process.env.TOKEN_NAME);
  console.log("Token symbol             :", process.env.TOKEN_SYMBOL);
  console.log("");

  const code = await publicClient.getCode({ address: ownerAccount.address });
  const currentDelegate = code?.startsWith("0xef0100")
    ? (`0x${code.slice(8, 48)}` as `0x${string}`)
    : null;
  console.log("Current delegate :", currentDelegate ?? "none");

  if (currentDelegate?.toLowerCase() !== PERMISSIONLESS_IMPL.toLowerCase()) {
    if (!process.env.PRIVATE_KEY)
      throw new Error("PRIVATE_KEY needed for EIP-7702 delegation (pays gas)");

    const deployerAccount = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
    const ownerWallet = createWalletClient({ account: ownerAccount, chain, transport });
    const deployerWallet = createWalletClient({ account: deployerAccount, chain, transport });

    console.log("Re-delegating EOA to account implementation...");
    const ownerNonce = await publicClient.getTransactionCount({ address: ownerAccount.address });
    const authorization = await ownerWallet.signAuthorization({
      contractAddress: PERMISSIONLESS_IMPL,
      nonce: ownerNonce,
    });
    const authTx = await deployerWallet.sendTransaction({
      to: ownerAccount.address,
      data: "0x",
      authorizationList: [authorization],
    });
    await publicClient.waitForTransactionReceipt({ hash: authTx });
    console.log("  Delegated tx:", authTx, "✓");
  } else {
    console.log("  Already delegated correctly — skipping");
  }
  console.log("");

  const account = await to7702SimpleSmartAccount({
    client: publicClient,
    owner: ownerAccount,
    accountLogicAddress: PERMISSIONLESS_IMPL, // must match the delegation target
  });

  const paymaster = {
    async getPaymasterStubData() {
      return {
        paymaster: PAYMASTER_ADDR,
        paymasterData: "0x" as `0x${string}`,
        paymasterVerificationGasLimit: 200_000n,
        paymasterPostOpGasLimit: 100_000n,
        isFinal: false,
      };
    },
    async getPaymasterData() {
      return {
        paymaster: PAYMASTER_ADDR,
        paymasterData: "0x" as `0x${string}`,
        paymasterVerificationGasLimit: 200_000n,
        paymasterPostOpGasLimit: 100_000n,
      };
    },
  };

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(PIMLICO_URL),
    paymaster,
    userOperation: {
      estimateFeesPerGas: async () => {
        const { fast } = await pimlicoClient.getUserOperationGasPrice();
        return { maxFeePerGas: fast.maxFeePerGas, maxPriorityFeePerGas: fast.maxPriorityFeePerGas };
      },
    },
  });

  const deployRegistryData = encodeFunctionData({
    abi: paymasterAbi,
    functionName: "deployRegistry",
    args: [tdocImpl, process.env.TOKEN_NAME!, process.env.TOKEN_SYMBOL!],
  });

  console.log("Sending UserOp: deployRegistry via PlatformPaymaster...");
  const txHash = await smartAccountClient.sendTransaction({
    to: PAYMASTER_ADDR,
    value: 0n,
    data: deployRegistryData,
  });

  console.log("\n─────────────────────────────────────────────");
  console.log("Registry deployed gaslessly ✓");
  console.log("  tx      :", txHash);
  console.log("  Deployer:", ownerAccount.address);
  console.log("─────────────────────────────────────────────");
  console.log("\nFind the deployed registry address in the RegistryDeployed event on tx:", txHash);
  console.log(`Add to .env:  REGISTRY_ADDRESS_${suffix}=<address from event>`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
