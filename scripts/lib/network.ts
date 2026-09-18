// Resolves the viem chain object, RPC URL, and network-specific env vars
// from the hardhat network name. Add a new entry here whenever a new
// network is added to hardhat.config.ts.

import { sepolia, polygonAmoy, xrplevmTestnet } from "viem/chains";
import type { Chain } from "viem";

interface NetworkEntry {
  chain: Chain;
  rpcEnvVar: string;
  suffix: string;   // appended to network-specific env var names
  chainId: number;  // Pimlico bundler URL chain ID
}

const NETWORK_MAP: Record<string, NetworkEntry> = {
  sepolia: { chain: sepolia,     rpcEnvVar: "SEPOLIA_RPC_URL", suffix: "SEPOLIA", chainId: 11155111 },
  amoy:    { chain: polygonAmoy, rpcEnvVar: "AMOY_RPC_URL",    suffix: "AMOY",    chainId: 80002    },
  xrplEvmTestnet: { chain: xrplevmTestnet, rpcEnvVar: "XRPL_EVM_TESTNET_RPC_URL", suffix: "XRPL_EVM_TESTNET", chainId: 1449000 },
};

export function getNetworkConfig(networkName: string): {
  chain: Chain;
  rpcUrl: string;
  chainId: number;
  suffix: string;
} {
  const entry = NETWORK_MAP[networkName];
  if (!entry) {
    throw new Error(`Unsupported network: "${networkName}". Add it to scripts/lib/network.ts`);
  }

  const rpcUrl = process.env[entry.rpcEnvVar];
  if (!rpcUrl) throw new Error(`${entry.rpcEnvVar} is not set in .env`);

  return { chain: entry.chain, rpcUrl, chainId: entry.chainId, suffix: entry.suffix };
}

/** Read a network-specific env var: <name>_SEPOLIA / <name>_AMOY etc. */
export function getEnv(suffix: string, name: string, required = true): string {
  const key = `${name}_${suffix}`;
  const val = process.env[key]?.trim();
  if (!val && required) throw new Error(`${key} is not set in .env`);
  return val ?? "";
}
