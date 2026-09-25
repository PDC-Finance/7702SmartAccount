/**
 * Deploy eth-infinitism Simple7702Account at the canonical permissionless
 * address used by viem/permissionless:
 *   0xe6Cae83BdE06E4c305530e199D7217f42808555B
 *
 * Uses Arachnid's CREATE2 deployer (same salt + initcode as Sepolia).
 * After this, EOAs already delegated to 0xe6Cae83… start working without
 * re-signing authorization.
 *
 * Run:
 *   npx hardhat run scripts/deployPermissionlessSimple7702.ts --network xrplEvmTestnet
 *
 * Required .env:
 *   PRIVATE_KEY
 *   XRPL_EVM_TESTNET_RPC_URL (optional; hardhat network url used by default)
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
  "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

function loadArtifact(): { salt: Hex; initcode: Hex } {
  const dir = join(__dirname, "artifacts");
  const salt = readFileSync(join(dir, "simple7702Account.salt.hex"), "utf8")
    .trim() as Hex;
  const initcode = readFileSync(
    join(dir, "simple7702Account.initcode.hex"),
    "utf8",
  ).trim() as Hex;
  if (!salt.startsWith("0x") || !initcode.startsWith("0x")) {
    throw new Error("Invalid Simple7702 CREATE2 artifacts");
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

  console.log("Deploying Simple7702Account via CREATE2...");
  const data = `${salt}${initcode.slice(2)}` as Hex;
  const txHash = await walletClient.sendTransaction({
    to: CREATE2_DEPLOYER,
    data,
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
  console.log("Simple7702Account deployed ✓");
  console.log("  Address    :", EXPECTED_ADDRESS);
  console.log("  Code bytes :", (code.length - 2) / 2);
  console.log("  Tx         :", txHash);
  console.log("─────────────────────────────────────────────");
  console.log(
    "\nKeep GASLESS_7702_IMPL_ADDRESS_* / PERMISSIONLESS_7702_IMPL as",
    EXPECTED_ADDRESS,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
