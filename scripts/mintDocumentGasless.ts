// Gasless TradeTrust document mint via EIP-7702 + permissionless (EntryPoint v0.8).
//
// Flow:
//   1. EOA is delegated (type-4 tx) to permissionless impl if not already
//   2. UserOp calls: execute(PAYMASTER, 0, mintDocument(registry, beneficiary, holder, tokenId, remark))
//   3. PlatformPaymaster sponsors gas — registry must be in authorizedRegistries
//   4. Beneficiary + holder are auto-added to authorizedCallers; TitleEscrow to authorizedTitleEscrows
//
// Run: npx ts-node scripts/mintDocumentGasless.ts
//
// Required .env:
//   NETWORK                      — sepolia | amoy  (default: sepolia)
//   PIMLICO_API_KEY              — free at dashboard.pimlico.io
//   OWNER_PRIVATE_KEY            — whitelisted user's key (signs UserOps, needs no ETH)
//   PRIVATE_KEY                  — funded wallet (pays gas for delegation tx if needed)
//   SEPOLIA_RPC_URL / AMOY_RPC_URL
//   PAYMASTER_ADDRESS_<NETWORK>  — deployed PlatformPaymaster
//   REGISTRY_ADDRESS_<NETWORK>   — authorized TradeTrustToken registry
//   BENEFICIARY_ADDRESS          — document beneficiary
//   HOLDER_ADDRESS               — document holder
//   TOKEN_ID                     — document token ID (uint256)
//
// Optional .env:
//   REMARK — hex-encoded remark bytes (default: 0x)

import {
  createPublicClient,
  createWalletClient,
  http,
  encodeFunctionData,
  toHex,
  parseAbi,
  decodeEventLog,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSmartAccountClient } from "permissionless";
import { to7702SimpleSmartAccount } from "permissionless/accounts";
import { createPimlicoClient } from "permissionless/clients/pimlico";
import { entryPoint08Address } from "viem/account-abstraction";
import * as dotenv from "dotenv";
import { getNetworkConfig, getEnv } from "./lib/network";
dotenv.config();

const PERMISSIONLESS_IMPL = "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

const paymasterAbi = parseAbi([
  "function mintDocument(address registry, address beneficiary, address holder, uint256 tokenId, bytes remark) external returns (address titleEscrow)",
  "event TitleEscrowLinked(address indexed titleEscrow, address indexed registry)",
]);

async function main() {
  if (!process.env.PIMLICO_API_KEY) throw new Error("PIMLICO_API_KEY not set");
  if (!process.env.OWNER_PRIVATE_KEY) throw new Error("OWNER_PRIVATE_KEY not set");
  if (!process.env.BENEFICIARY_ADDRESS) throw new Error("BENEFICIARY_ADDRESS not set");
  if (!process.env.HOLDER_ADDRESS) throw new Error("HOLDER_ADDRESS not set");
  if (!process.env.TOKEN_ID) throw new Error("TOKEN_ID not set");

  const networkName = process.env.NETWORK ?? "sepolia";
  const { chain, rpcUrl, chainId, suffix } = getNetworkConfig(networkName);
  const PAYMASTER_ADDR = getEnv(suffix, "PAYMASTER_ADDRESS") as `0x${string}`;
  const registry = getEnv(suffix, "REGISTRY_ADDRESS") as `0x${string}`;
  // const PIMLICO_URL = `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${process.env.PIMLICO_API_KEY}`;
  const PIMLICO_URL = 'https://alto-xrpl-evm-testnet.blockpeer.finance';

  const beneficiary = process.env.BENEFICIARY_ADDRESS as `0x${string}`;
  const holder = process.env.HOLDER_ADDRESS as `0x${string}`;
  const tokenId = BigInt(process.env.TOKEN_ID);
  const rawRemark = process.env.REMARK ?? "";
  const remark: `0x${string}` = rawRemark
    ? rawRemark.startsWith("0x") ? (rawRemark as `0x${string}`) : toHex(rawRemark)
    : "0x";

  const ownerAccount = privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`);
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });

  console.log("Network                  :", networkName);
  console.log("Owner (whitelisted user) :", ownerAccount.address);
  console.log("Paymaster                :", PAYMASTER_ADDR);
  console.log("Permissionless impl      :", PERMISSIONLESS_IMPL);
  console.log("Registry                 :", registry);
  console.log("Beneficiary              :", beneficiary);
  console.log("Holder                   :", holder);
  console.log("Token ID                 :", tokenId.toString());
  console.log("Remark                   :", remark);
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

    console.log("Re-delegating EOA to permissionless impl...");
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

  const account = await to7702SimpleSmartAccount({ client: publicClient, owner: ownerAccount });

  const pimlicoClient = createPimlicoClient({
    transport: http(PIMLICO_URL),
    entryPoint: { address: entryPoint08Address, version: "0.8" },
  });

  const smartAccountClient = createSmartAccountClient({
    account,
    chain,
    bundlerTransport: http(PIMLICO_URL),
    paymaster: {
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
    },
    userOperation: {
      estimateFeesPerGas: async () => {
        const { fast } = await pimlicoClient.getUserOperationGasPrice();
        return { maxFeePerGas: fast.maxFeePerGas, maxPriorityFeePerGas: fast.maxPriorityFeePerGas };
      },
    },
  });

  const mintData = encodeFunctionData({
    abi: paymasterAbi,
    functionName: "mintDocument",
    args: [registry, beneficiary, holder, tokenId, remark],
  });

  console.log("Sending UserOp: mintDocument via PlatformPaymaster...");
  const txHash = await smartAccountClient.sendTransaction({
    to: PAYMASTER_ADDR,
    value: 0n,
    data: mintData,
  });

  const txReceipt = await publicClient.getTransactionReceipt({ hash: txHash as `0x${string}` });

  let titleEscrowAddress: string | undefined;
  for (const log of txReceipt.logs) {
    try {
      const decoded = decodeEventLog({ abi: paymasterAbi, data: log.data, topics: log.topics, eventName: "TitleEscrowLinked" });
      titleEscrowAddress = decoded.args.titleEscrow as string;
      break;
    } catch { /* not this event */ }
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("Document minted gaslessly ✓");
  console.log("  tx           :", txHash);
  console.log("  Registry     :", registry);
  console.log("  Token ID     :", tokenId.toString());
  console.log("  Beneficiary  :", beneficiary);
  console.log("  Holder       :", holder);
  console.log("  TitleEscrow  :", titleEscrowAddress ?? "(check TitleEscrowLinked event on tx)");
  console.log("─────────────────────────────────────────────");
  if (titleEscrowAddress) {
    console.log(`\nAdd to .env:  TITLE_ESCROW_ADDRESS_${suffix}=${titleEscrowAddress}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
