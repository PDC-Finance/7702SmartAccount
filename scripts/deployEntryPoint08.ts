/**
 * Deploy eth-infinitism EntryPoint v0.8 at the canonical address used by
 * Alto / permissionless / Pimlico:
 *   0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108
 *
 * Uses Arachnid's CREATE2 deployer with the same salt + initcode as Sepolia /
 * Ethereum mainnet. Required before running Alto on a chain that does not
 * already have this contract (e.g. XRPL EVM mainnet).
 *
 * Run:
 *   npx hardhat run scripts/deployEntryPoint08.ts --network xrplEvmMainnet
 *   npx hardhat run scripts/deployEntryPoint08.ts --network xrplEvmTestnet
 *
 * Required .env:
 *   PRIVATE_KEY
 *   XRPL_EVM_MAINNET_RPC_URL / XRPL_EVM_TESTNET_RPC_URL (per network.ts)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  getCreate2Address,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getNetworkConfig } from "./lib/network";

dotenv.config();

const CREATE2_DEPLOYER =
  "0x4e59b44847b379578588920cA78FbF26c0B4956C" as const;
const EXPECTED_ADDRESS =
  "0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108" as const;

function loadArtifact(): { salt: Hex; initcode: Hex } {
  const dir = join(__dirname, "artifacts");
  const salt = readFileSync(join(dir, "entryPoint08.salt.hex"), "utf8").trim() as Hex;
  const initcode = readFileSync(
    join(dir, "entryPoint08.initcode.hex"),
    "utf8",
  ).trim() as Hex;
  if (!salt.startsWith("0x") || !initcode.startsWith("0x")) {
    throw new Error("Invalid EntryPoint v0.8 CREATE2 artifacts");
  }
  return { salt, initcode };
}

async function main() {
  if (!process.env.PRIVATE_KEY) throw new Error("PRIVATE_KEY not set");

  const { chain, rpcUrl } = getNetworkConfig(hre.network.name);
  const { salt, initcode } = loadArtifact();

  const computed = getCreate2Address({
    bytecode: initcode,
    from: CREATE2_DEPLOYER,
    salt,
  });
  if (computed.toLowerCase() !== EXPECTED_ADDRESS.toLowerCase()) {
    throw new Error(
      `CREATE2 address mismatch: computed ${computed}, expected ${EXPECTED_ADDRESS}`,
    );
  }

  const deployer = privateKeyToAccount(
    process.env.PRIVATE_KEY as `0x${string}`,
  );
  const transport = http(rpcUrl);
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({
    account: deployer,
    chain,
    transport,
  });

  console.log("Network          :", hre.network.name, `(${chain.id})`);
  console.log("Deployer         :", deployer.address);
  console.log("CREATE2 deployer :", CREATE2_DEPLOYER);
  console.log("Expected address :", EXPECTED_ADDRESS);
  console.log("Initcode bytes   :", (initcode.length - 2) / 2);
  console.log("Initcode hash    :", keccak256(initcode));
  console.log("");

  const balance = await publicClient.getBalance({ address: deployer.address });
  console.log("Deployer balance :", balance.toString(), "wei");

  const existing = await publicClient.getCode({ address: EXPECTED_ADDRESS });
  if (existing && existing !== "0x" && existing.length > 2) {
    console.log("Already deployed ✓");
    console.log("  code bytes:", (existing.length - 2) / 2);
    return;
  }

  const deployerCode = await publicClient.getCode({
    address: CREATE2_DEPLOYER,
  });
  if (!deployerCode || deployerCode === "0x") {
    throw new Error(
      `CREATE2 deployer ${CREATE2_DEPLOYER} has no code on this chain`,
    );
  }

  // Arachnid proxy: calldata = salt (32 bytes) || initcode
  const data = `${salt}${initcode.slice(2)}` as Hex;

  let gas = 8_000_000n;
  try {
    gas = await publicClient.estimateGas({
      account: deployer.address,
      to: CREATE2_DEPLOYER,
      data,
    });
    // 20% headroom — large CREATE2 can be underestimated on some RPCs
    gas = (gas * 120n) / 100n;
  } catch {
    // keep ceiling
  }

  const gasPrice = await publicClient.getGasPrice();
  const need = gas * gasPrice;
  if (balance < need) {
    throw new Error(
      `Insufficient native balance to deploy EntryPoint.\n` +
        `  Deployer : ${deployer.address}\n` +
        `  Balance  : ${balance} wei\n` +
        `  Need ~   : ${need} wei (gas ${gas} × ${gasPrice})\n` +
        `Fund the deployer with ~0.01 native token, then re-run.`,
    );
  }

  console.log("Deploying EntryPoint v0.8 via CREATE2...");
  console.log("  gas limit:", gas.toString());
  const txHash = await walletClient.sendTransaction({
    to: CREATE2_DEPLOYER,
    data,
    gas,
  });
  console.log("  tx:", txHash);
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: txHash,
  });
  if (receipt.status !== "success") {
    throw new Error(`CREATE2 deploy tx reverted: ${txHash}`);
  }

  const code = await publicClient.getCode({ address: EXPECTED_ADDRESS });
  if (!code || code === "0x") {
    throw new Error(
      `Deploy tx mined but ${EXPECTED_ADDRESS} still has no code`,
    );
  }

  console.log("\n─────────────────────────────────────────────");
  console.log("EntryPoint v0.8 deployed ✓");
  console.log("  Address    :", EXPECTED_ADDRESS);
  console.log("  Code bytes :", (code.length - 2) / 2);
  console.log("  Tx         :", txHash);
  console.log("─────────────────────────────────────────────");
  console.log("\nRestart Alto with:");
  console.log(`  --entryPoint ${EXPECTED_ADDRESS}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
