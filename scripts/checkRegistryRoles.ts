/**
 * Check the roles on a token registry deployed through PlatformPaymaster.deployRegistry.
 *
 * Use it after the first gasless registry deploy on a network whose paymaster
 * implementation we did not build ourselves (e.g. TrustVC's on Amoy), to confirm
 * the bp-react flows will work:
 *   - gasless mint              → paymaster needs MINTER_ROLE (mintDocument calls registry.mint)
 *   - paid-fallback mint        → user needs MINTER_ROLE
 *   - reject returned (restore) → user needs RESTORER_ROLE
 *   - accept returned (burn)    → user needs ACCEPTER_ROLE
 *   - role management           → user needs DEFAULT_ADMIN_ROLE
 *
 * Read-only; costs no gas.
 *
 * Run:
 *   REGISTRY_ADDRESS=0x... npx hardhat run scripts/checkRegistryRoles.ts --network amoy
 *
 * Optional .env:
 *   REGISTRY_ADDRESS / REGISTRY_ADDRESS_<NETWORK> — registry to check
 *   USER_ADDRESS — the deployer EOA (default: OWNER_PRIVATE_KEY's address)
 *   PAYMASTER_ADDRESS_<NETWORK> (PAYMASTER_ADDRESS only if the per-network one is unset)
 */
import { createPublicClient, http, keccak256, parseAbi, toHex, getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import hre from "hardhat";
import * as dotenv from "dotenv";
import { getEnv, getNetworkConfig } from "./lib/network";

dotenv.config();

const ROLES = {
  DEFAULT_ADMIN_ROLE: `0x${"0".repeat(64)}` as `0x${string}`,
  MINTER_ROLE: keccak256(toHex("MINTER_ROLE")),
  RESTORER_ROLE: keccak256(toHex("RESTORER_ROLE")),
  ACCEPTER_ROLE: keccak256(toHex("ACCEPTER_ROLE")),
} as const;

const abi = parseAbi([
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function authorizedRegistries(address registry) view returns (bool)",
]);

function resolveUser(): `0x${string}` {
  if (process.env.USER_ADDRESS) return getAddress(process.env.USER_ADDRESS);
  if (process.env.OWNER_PRIVATE_KEY) {
    return privateKeyToAccount(process.env.OWNER_PRIVATE_KEY as `0x${string}`).address;
  }
  throw new Error("Set USER_ADDRESS or OWNER_PRIVATE_KEY");
}

async function main() {
  const { chain, rpcUrl, suffix } = getNetworkConfig(hre.network.name);
  const registry = getAddress(
    process.env.REGISTRY_ADDRESS?.trim() || getEnv(suffix, "REGISTRY_ADDRESS"),
  );
  // Per-network value first: a leftover generic PAYMASTER_ADDRESS in .env
  // must not silently point the check at another chain's paymaster.
  const paymaster = getAddress(
    getEnv(suffix, "PAYMASTER_ADDRESS", false) || process.env.PAYMASTER_ADDRESS?.trim() || "",
  );
  const user = resolveUser();
  const client = createPublicClient({ chain, transport: http(rpcUrl) });

  const has = (role: `0x${string}`, account: `0x${string}`) =>
    client.readContract({ address: registry, abi, functionName: "hasRole", args: [role, account] });

  const [authorized, userRoles, paymasterRoles] = await Promise.all([
    client.readContract({ address: paymaster, abi, functionName: "authorizedRegistries", args: [registry] }),
    Promise.all(Object.values(ROLES).map((r) => has(r, user))),
    Promise.all(Object.values(ROLES).map((r) => has(r, paymaster))),
  ]);

  console.log("Network    :", hre.network.name);
  console.log("Registry   :", registry);
  console.log("User       :", user);
  console.log("Paymaster  :", paymaster);
  console.log("Authorized on paymaster:", authorized);
  console.log("");
  console.log("Role".padEnd(20), "user".padEnd(8), "paymaster");
  Object.keys(ROLES).forEach((name, i) => {
    console.log(name.padEnd(20), String(userRoles[i]).padEnd(8), paymasterRoles[i]);
  });

  const [uAdmin, uMinter, uRestorer, uAccepter] = userRoles;
  const pMinter = paymasterRoles[1];
  const checks: [string, boolean][] = [
    ["Registry authorized on paymaster (gasless mint + Path A)", authorized],
    ["Gasless mint (paymaster MINTER_ROLE)", pMinter],
    ["Paid-fallback mint (user MINTER_ROLE)", uMinter],
    ["Reject returned / restore (user RESTORER_ROLE)", uRestorer],
    ["Accept returned / burn (user ACCEPTER_ROLE)", uAccepter],
    ["Role management (user DEFAULT_ADMIN_ROLE)", uAdmin],
  ];

  console.log("\n─────────────────────────────────────────────");
  for (const [label, ok] of checks) console.log(ok ? "  ✓" : "  ✗", label);
  console.log("─────────────────────────────────────────────");

  const failed = checks.filter(([, ok]) => !ok);
  if (failed.length) {
    console.log(
      "\nThis paymaster implementation does not set up the roles bp-react expects.\n" +
        "Deploy our own PlatformPaymaster implementation + factory on this network\n" +
        "(deployImplementation.ts → deployFactory.ts), then redeploy the clone.",
    );
    process.exitCode = 1;
  } else {
    console.log("\nAll roles in place ✓");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
