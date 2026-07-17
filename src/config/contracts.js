// -----------------------------------------------------------------------
// EDIT THIS FILE after every run of deploy-infrastructure.js.
// Copy the relevant network's values straight out of your backend's
// deployed-addresses.json into the matching entry below.
// -----------------------------------------------------------------------

const CONTRACTS_BY_CHAIN = {
  // Arbitrum Sepolia (chain id 421614)
  421614: {
    kycRegistry: "0x5B6C57cA408dD1bbE9cbdeB0cbb6e923E01a584D",
    vaultFactory: "0x10EF32020096428D8d3386718a563c4cDbc2a123",
  },
  // Local Hardhat node (chain id 31337)
  31337: {
    kycRegistry: "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    vaultFactory: "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
  },
};

// Defaults to Sepolia's addresses if called before a chain is known
// (e.g. before wallet connection) — components using a live chainId
// should prefer getContractsForChain(chainId) below instead.
export const CONTRACTS = CONTRACTS_BY_CHAIN[421614];

export function getContractsForChain(chainId) {
  return CONTRACTS_BY_CHAIN[chainId] || CONTRACTS_BY_CHAIN[421614];
}

// Aave addresses are fixed on Arbitrum Sepolia testnet and don't change
// between your own redeploys — no need to edit these. Not available on
// the local Hardhat network (no real Aave deployment there).
export const AAVE = {
  wethAToken: "0xf5f17EbE81E516Dc7cB38D61908EC252F150CE60",
};