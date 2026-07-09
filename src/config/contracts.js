// -----------------------------------------------------------------------
// EDIT THIS FILE after every run of deploy-infrastructure.js.
// Copy the "arbitrumSepolia" values straight out of your backend's
// deployed-addresses.json into the object below.
// -----------------------------------------------------------------------

export const CONTRACTS = {
  kycRegistry: "0xfF8f34a70E5393600430B43E55a31C411A220CB2",
  vaultFactory: "0xb999Ca894Cc7578433F4d9F67759C153E108029F",
};

// Aave addresses are fixed on Arbitrum Sepolia testnet and don't change
// between your own redeploys — no need to edit these.
export const AAVE = {
  wethAToken: "0xf5f17EbE81E516Dc7cB38D61908EC252F150CE60",
};
