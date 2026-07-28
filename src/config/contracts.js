// -----------------------------------------------------------------------
// Arbitrum Sepolia filled in from the Group F v2 deployment (deploy tx
// confirmed; lifecycle-proof.js has since verified all three settlement
// tiers against these exact addresses — see Vault A/B/C in that run's
// output). Local Hardhat (31337) still needs its own local deploy run
// before it's usable — the "npx hardhat run ... --network hardhat" dry
// run errored out before writing any addresses for that network, so
// there's genuinely nothing to fill in there yet, not an oversight.
// -----------------------------------------------------------------------

const PLACEHOLDER = "0x0000000000000000000000000000000000000000"; // FILL AFTER GROUP F DEPLOY

const CONTRACTS_BY_CHAIN = {
  // Arbitrum Sepolia (chain id 421614)
  421614: {
    kycRegistry:   "0x842629E4C953De726946Db5886e50d4840F61FC4", // unchanged in v2 (contract not modified)
    assetRegistry: "0x8DB2d815caD86eABF217205523621603F712aAE5",
    insurancePool: "0x11D4f02FA69D0352fb01725d822Fb05C54AD6e41",
    vaultFactory:  "0xd2bF51C369666076F1B0d0c544B8433ec74Db4e5",
    tokens: {
      WETH: "0xd5f3F5005810369f59e987D31c58ac45C7a0F1b0",
      WBTC: "0x6166892794FBAE7fC907ceB4578572Ff7B5151A1",
      USDC: "0x31cF3D11803A94A3aE17B0cD8f2Bc89E7d93D105",
      USDT: "0xdF3B2A5E1319b03fB29E6CF5774D54E55f2E221a",
    },
  },
  // Local Hardhat node (chain id 31337) — not yet deployed, see header note.
  31337: {
    kycRegistry:   PLACEHOLDER,
    assetRegistry: PLACEHOLDER,
    insurancePool: PLACEHOLDER,
    vaultFactory:  PLACEHOLDER,
    tokens: {
      WETH: PLACEHOLDER,
      WBTC: PLACEHOLDER,
      USDC: PLACEHOLDER,
      USDT: PLACEHOLDER,
    },
  },
};

export const CONTRACTS = CONTRACTS_BY_CHAIN[421614];

export function getContractsForChain(chainId) {
  return CONTRACTS_BY_CHAIN[chainId] || CONTRACTS_BY_CHAIN[421614];
}

// True if `address` is missing or is the pre-deploy PLACEHOLDER zero
// address — i.e. "this contract hasn't been deployed/filled in yet" as
// distinct from "deployed, and this is a genuine on-chain read failure."
// Components should check this BEFORE firing reads against a v2 contract,
// so a pre-Group-F app state shows an honest "not deployed yet" message
// instead of a confusing RPC error.
export function isPlaceholder(address) {
  return !address || address.toLowerCase() === PLACEHOLDER;
}

// Reverse lookup: token address -> display symbol, per chain. Built once
// from the tokens map so components can label any asset address they read
// off-chain (vault.asset(), registry.getWhitelistedAssets(), etc).
export function symbolForToken(chainId, address) {
  const { tokens } = getContractsForChain(chainId);
  const match = Object.entries(tokens).find(
    ([, addr]) => addr.toLowerCase() === (address || "").toLowerCase()
  );
  return match ? match[0] : `${(address || "").slice(0, 6)}…`;
}

// Token display decimals — used for formatting only (on-chain math always
// uses the contract-reported decimals via ERC20_ABI.decimals()).
export const TOKEN_DECIMALS = { WETH: 18, WBTC: 8, USDC: 6, USDT: 6 };