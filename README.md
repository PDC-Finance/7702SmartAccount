# TrustVC EIP-7702 Smart Account

Gasless trade document operations on TrustVC via **EIP-7702** (smart account delegation) and **ERC-4337** (account abstraction). Deployed on Sepolia testnet.

## Overview

This package provides three contracts:

| Contract | Role |
| --- | --- |
| `EIP7702Implementation` | Shared smart account logic that EOAs delegate to via EIP-7702 |
| `PlatformPaymaster` | Per-platform ERC-4337 paymaster — sponsors gas for registry and title escrow operations |
| `PlatformAccountFactory` | Deploys `PlatformPaymaster` clones cheaply via EIP-1167 (`Clones.cloneDeterministic`) |

## How it works

1. **Deploy permissionless Simple7702Account** at `0xe6Cae83BdE06E4c305530e199D7217f42808555B` (CREATE2 via `scripts/deployPermissionlessSimple7702.ts`). bp-react / permissionless require this address — not the OpenZeppelin `EIP7702Implementation`.
2. **Delegate** — An EOA signs an EIP-7702 authorization pointing to that Simple7702Account. The EOA's code becomes `0xef0100 || impl_address`.
3. **Deploy paymaster** — A platform calls `PlatformAccountFactory.deployPlatformPaymaster()`. A minimal-proxy clone is initialized with the platform's owner address, daily ETH limit, and TDoc deployer.
4. **Gasless ops** — Users submit `UserOperation`s through a bundler (Alto / Pimlico). The paymaster validates and sponsors Path A (authorized TE/registry) and Path B (`deployRegistry` / `mintDocument`).

## Contracts

### EIP7702Implementation

EIP-7702 smart account using OpenZeppelin's `Account`, `SignerEIP7702`, and `ERC7821`. Deployed once; EOAs point to it via authorization.

- `entryPoint` — immutable, baked into bytecode at deploy time
- Execution via `ERC7821` batch execute
- Signature validation: signer must equal `address(this)` (the delegating EOA)

### PlatformPaymaster

Per-platform ERC-4337 paymaster cloned from a shared implementation.

#### State

| Variable | Description |
| --- | --- |
| `tdocDeployer` | TDocDeployer contract that mints registry clones |
| `authorizedRegistries` | Registries whose calls this paymaster will sponsor |
| `authorizedTitleEscrows` | Title escrows whose calls this paymaster will sponsor |
| `authorizedCallers` | Addresses (beneficiary/holder) allowed on Path A |
| `userWhitelist` | Deployment credits per user (max 3) |
| `documentsMinted` | Count of documents minted per caller |
| `dailyLimit` | Max ETH sponsored per user per day |

#### Key functions

- `initialize(owner, dailyLimit, tdocDeployer)` — called once by the factory after clone; guarded by `owner() == address(0)`
- `deployRegistry(impl, name, symbol)` — deploys a TradeTrust registry, consumes one credit, auto-authorizes it
- `mintDocument(registry, beneficiary, holder, tokenId, remark)` — mints a document, auto-authorizes beneficiary + holder + title escrow
- `setUserWhitelist / removeUserFromWhitelist` — manage deployment credits (`onlyOwner`)
- `addRegistry / removeRegistry` — manage authorized registries (`onlyOwner`)
- `addTitleEscrow / removeTitleEscrow` — manage authorized title escrows (`onlyOwner`)
- `addAuthorizedCaller / removeAuthorizedCaller` — manage Path A callers (`onlyOwner`)
- `setDailyLimit` — update daily spend cap (`onlyOwner`)
- `getUserDailySpend(user)` — returns `(spent, limit, resetsAt)`

### PlatformAccountFactory

Deploys `PlatformPaymaster` clones deterministically.

- `deployPlatformPaymaster(platformAddress, dailyLimit, salt)` — clones the implementation and calls `initialize`
- `computePaymasterAddress(salt)` — predict the clone address before deployment
- `updateTdocDeployer(addr)` — update TDoc deployer (`onlyOwner`)
- `updatePaymasterImplementation(addr)` — upgrade the implementation for future clones (`onlyOwner`)

## Deployed addresses (Sepolia)

| Contract | Address |
| --- | --- |
| EIP7702Implementation | `0xa46EC3920Ac5fc54F4bA33185A91ae250aDF59B8` |
| PlatformPaymaster (implementation) | `0xa24695178ea881ab7d4d105106e4906a8da4752b` |
| PlatformAccountFactory | `0x7e9ef6363180baa744eb32ceab367a44f52adc9f` |
| TDocDeployer | `0x64bc665056DC8bE4092e569ED13a7F273Be28cD2` |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |

## Installation

```bash
npm install @trustvc/eip7702
```

## Development

### Prerequisites

- Node.js 18+
- A Sepolia RPC URL (e.g. Infura)
- A Pimlico API key for bundler access

### Setup

```bash
npm install
cp .env.example .env   # fill in PRIVATE_KEY, SEPOLIA_RPC_URL, PIMLICO_API_KEY
```

### Build

```bash
npm run build          # compile contracts + generate ABIs + bundle JS
npm run build:sol      # compile contracts only
npm run build:abis     # generate ABI TypeScript files only
```

### Test

```bash
npm test               # runs all 45 hardhat tests
```

### Deploy (Sepolia)

Deploy in order:

```bash
# 1. Deploy the shared PlatformPaymaster implementation
npx hardhat run scripts/deployImplementation.ts --network sepolia

# 2. Deploy the factory (add PAYMASTER_IMPLEMENTATION to .env first)
npx hardhat run scripts/deployFactory.ts --network sepolia

# 3. Clone a paymaster for your platform (add FACTORY_ADDRESS to .env first)
npx hardhat run scripts/deployPlatformPaymaster.ts --network sepolia

# 4. Stake the paymaster on the EntryPoint
npx hardhat run scripts/stakePlatformPaymaster.ts --network sepolia
```

### Mint a document gaslessly

```bash
npx hardhat run scripts/mintDocumentGasless.ts --network sepolia
```

## Environment variables

| Variable | Description |
| --- | --- |
| `PRIVATE_KEY` | Deployer wallet private key |
| `SEPOLIA_RPC_URL` | Sepolia RPC endpoint |
| `PIMLICO_API_KEY` | Pimlico bundler API key |
| `TDOC_DEPLOYER_ADDRESS` | Deployed TDocDeployer address |
| `PAYMASTER_IMPLEMENTATION` | PlatformPaymaster implementation address |
| `FACTORY_ADDRESS` | PlatformAccountFactory address |
| `PAYMASTER_ADDRESS` | Deployed paymaster clone address |
| `EIP7702_IMPL_ADDRESS` | EIP7702Implementation address |

## Tech stack

- Solidity `^0.8.28` · OpenZeppelin Contracts v5 · `@account-abstraction/contracts` v0.8
- Hardhat · hardhat-toolbox-viem · Viem · Pimlico bundler
- EIP-7702 · ERC-4337 · EIP-1167 minimal proxy · Sepolia testnet
