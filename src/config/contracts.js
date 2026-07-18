// -----------------------------------------------------------------------
// EDIT THIS FILE after every run of deploy-infrastructure.js.
// Copy the relevant network's values straight out of your backend's
// deployed-addresses.json into the matching entry below.
// -----------------------------------------------------------------------

const CONTRACTS_BY_CHAIN = {
  // Arbitrum Sepolia (chain id 421614)
  421614: {
    kycRegistry: "0x842629E4C953De726946Db5886e50d4840F61FC4",
    vaultFactory: "0x7A5fCFcF4aE12A08dD01bB847C5992aC519446Fa",
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