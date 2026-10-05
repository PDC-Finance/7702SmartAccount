// Resolves the viem chain object, RPC URL, and network-specific env vars
// from the hardhat network name. Add a new entry here whenever a new
// network is added to hardhat.config.ts.

import { sepolia, polygon, polygonAmoy, xrplevm, xrplevmTestnet } from "viem/chains";
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
  polygon: { chain: polygon,     rpcEnvVar: "POLYGON_RPC_URL", suffix: "POLYGON", chainId: 137      },
  xrplEvmTestnet: { chain: xrplevmTestnet, rpcEnvVar: "XRPL_EVM_TESTNET_RPC_URL", suffix: "XRPL_EVM_TESTNET", chainId: 1449000 },
  xrplEvmMainnet: { chain: xrplevm, rpcEnvVar: "XRPL_EVM_MAINNET_RPC_URL", suffix: "XRPL_EVM_MAINNET", chainId: 1440000 },
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

/**
 * ERC-4337 bundler for a network. BUNDLER_URL_<SUFFIX> wins; XRPL EVM Testnet
 * defaults to the Blockpeer Alto instance; every other network uses Pimlico's
 * hosted bundler with PIMLICO_API_KEY_<SUFFIX>, falling back to PIMLICO_API_KEY.
 */
export function getBundlerUrl(suffix: string, chainId: number): string {
  const override = process.env[`BUNDLER_URL_${suffix}`]?.trim();
  if (override) return override;
  if (suffix === "XRPL_EVM_TESTNET") return "https://alto-xrpl-evm-testnet.blockpeer.finance";
  // Pimlico does not support XRPL EVM: mainnet needs our own Alto URL.
  if (suffix === "XRPL_EVM_MAINNET") throw new Error("BUNDLER_URL_XRPL_EVM_MAINNET (our Alto) is not set in .env");
  const apiKey = process.env[`PIMLICO_API_KEY_${suffix}`]?.trim() || process.env.PIMLICO_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(`PIMLICO_API_KEY_${suffix} (or PIMLICO_API_KEY, or BUNDLER_URL_${suffix}) is not set in .env`);
  }
  return `https://api.pimlico.io/v2/${chainId}/rpc?apikey=${apiKey}`;
}

/**
 * Contract the user's EOA delegates to (and the smart-account logic address
 * passed to permissionless). Must be bound to EntryPoint v0.8.
 * ACCOUNT_IMPL_ADDRESS_<SUFFIX> wins; XRPL EVM Testnet/Mainnet, Sepolia and Polygon use
 * permissionless's Simple7702Account; Amoy uses TrustVC's shared
 * EIP7702Implementation (EIP7702_IMPL_ADDRESS_AMOY). TrustVC's Sepolia
 * EIP7702Implementation is bound to EntryPoint v0.7, so it is not used.
 */
export const SIMPLE_7702_ACCOUNT = "0xe6Cae83BdE06E4c305530e199D7217f42808555B" as const;

export function getAccountImpl(suffix: string): `0x${string}` {
  const override = process.env[`ACCOUNT_IMPL_ADDRESS_${suffix}`]?.trim();
  if (override) return override as `0x${string}`;
  if (suffix === "XRPL_EVM_TESTNET" || suffix === "XRPL_EVM_MAINNET" || suffix === "SEPOLIA" || suffix === "POLYGON") {
    return SIMPLE_7702_ACCOUNT;
  }
  return getEnv(suffix, "EIP7702_IMPL_ADDRESS") as `0x${string}`;
}

/** Read a network-specific env var: <name>_SEPOLIA / <name>_AMOY etc. */
export function getEnv(suffix: string, name: string, required = true): string {
  const key = `${name}_${suffix}`;
  const val = process.env[key]?.trim();
  if (!val && required) throw new Error(`${key} is not set in .env`);
  return val ?? "";
}
