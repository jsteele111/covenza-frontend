// -----------------------------------------------------------------------
// Deployed addresses, per chain.
//
// 25 October 2026: the app was brought up to the contracts frozen for audit
// (tag audit-freeze-2026-10, fef1abc). Those contracts are not ABI-compatible
// with the August testnet stack this file used to point at — mandates gained
// total capacity, attestations carry claims and an expiry, the swap quote
// moved to VaultLens, yield venues are gone — so the old addresses are
// deliberately NOT kept here. Pointing the new interface at the old contracts
// would decode garbage rather than fail loudly.
//
// Robinhood testnet is filled in after the frozen stack is redeployed there
// (scripts/deploy-robinhood-testnet.js in lending-poc), and the local Hardhat
// node after a local deploy. Until then every address is PLACEHOLDER and the
// app says "not deployed on this network" rather than showing empty data.
// -----------------------------------------------------------------------

const PLACEHOLDER = "0x0000000000000000000000000000000000000000";

const CONTRACTS_BY_CHAIN = {
  // -------------------------------------------------------------------
  // Robinhood Chain Testnet (46630) — the primary target.
  //
  // Runs against REAL Uniswap V3. Uniswap is mainnet-only on Robinhood Chain,
  // so the factory and router are deployed from the audited @uniswap/v3-core
  // artifacts by scripts/deploy-uniswap-testnet.js — real bytecode, pools we
  // control.
  //
  // twapWindow is 60s here, not the production 1800: a warmed pool holds only
  // minutes of observation history and a real chain cannot be fast-forwarded.
  // Approved pools must keep more history slots than the window has seconds
  // (audit KRAIT-004); testnet pools are grown to 64, which clears a 60-second
  // window and would NOT clear the production one.
  //
  // WARNING: Robinhood testnet wipes CONTRACT STATE while preserving account
  // balances and block height. A stale address returns empty data rather than
  // failing loudly — useDeploymentHealth checks for code before anything else.
  // -------------------------------------------------------------------
  46630: {
    kycRegistry:   PLACEHOLDER,
    assetRegistry: PLACEHOLDER,
    insurancePool: PLACEHOLDER,
    vaultFactory:  PLACEHOLDER,
    vaultLens:     PLACEHOLDER,
    treasury:      PLACEHOLDER,
    tokens: {
      tUSDG: PLACEHOLDER,
      tWETH: PLACEHOLDER,
      // Standard tier, 72h grace. A tokenised equity trades 24/5, so a
      // deadline falling on a Friday evening has no market to settle into
      // until Monday.
      tAAPL: PLACEHOLDER,
    },

    // Vaults are EIP-1167 clones of this implementation, which is deployed once
    // and never initialised. Recorded because a clone carries no code of its
    // own — point a contract verifier at the implementation, not at a vault.
    vaultImplementation: PLACEHOLDER,
    uniswapTwapLibrary:  PLACEHOLDER,
    // Reference only — the app reads uniswapFactory and swapRouter from
    // AssetRegistry on-chain rather than trusting these.
    uniswap: {
      factory: PLACEHOLDER,
      router:  PLACEHOLDER,
    },
  },

  // Local Hardhat node (chain id 31337), for testing the interface against
  // the frozen contracts before testnet. Filled in after a local deploy.
  31337: {
    kycRegistry:   PLACEHOLDER,
    assetRegistry: PLACEHOLDER,
    insurancePool: PLACEHOLDER,
    vaultFactory:  PLACEHOLDER,
    vaultLens:     PLACEHOLDER,
    treasury:      PLACEHOLDER,
    tokens: {
      tUSDG: PLACEHOLDER,
      tWETH: PLACEHOLDER,
      tAAPL: PLACEHOLDER,
    },
  },
};

// Robinhood testnet is the default — it matches the first chain listed in
// wagmi.js, so an unrecognised chain falls back to the same network the app
// opens on rather than silently reading a different deployment's addresses.
const DEFAULT_CHAIN_ID = 46630;

export const CONTRACTS = CONTRACTS_BY_CHAIN[DEFAULT_CHAIN_ID];

export function getContractsForChain(chainId) {
  return CONTRACTS_BY_CHAIN[chainId] || CONTRACTS_BY_CHAIN[DEFAULT_CHAIN_ID];
}

// True if `address` is missing or is the pre-deploy PLACEHOLDER zero
// address — i.e. "this contract hasn't been deployed/filled in yet" as
// distinct from "deployed, and this is a genuine on-chain read failure."
export function isPlaceholder(address) {
  return !address || address.toLowerCase() === PLACEHOLDER;
}

// Reverse lookup: token address -> display symbol, per chain.
export function symbolForToken(chainId, address) {
  const { tokens } = getContractsForChain(chainId);
  const match = Object.entries(tokens).find(
    ([, addr]) => !isPlaceholder(addr) && addr.toLowerCase() === (address || "").toLowerCase()
  );
  return match ? match[0] : `${(address || "").slice(0, 6)}…`;
}

// Token display decimals — used for formatting only (on-chain math always
// uses the contract-reported decimals via ERC20_ABI.decimals()).
export const TOKEN_DECIMALS = {
  WETH: 18, WBTC: 8, USDC: 6, USDT: 6,
  tUSDG: 18, tWETH: 18, // both 18 deliberately, so a Uniswap tick of 0 is true parity
  tAAPL: 18,
};

// Mirrors IdentityClaims in contracts/interfaces/IIdentityAdapter.sol. An
// attestation carries a set of these bits; VaultFactory requires
// requiredBorrowerClaims of a borrower (all three by default) and
// requiredLenderClaims of a lender (sanctions screening by default).
export const IDENTITY_CLAIMS = {
  KYC_PASSED: 1,
  SANCTIONS_CLEAR: 2,
  JURISDICTION_ELIGIBLE: 4,
  ALL: 7,
};

export const CLAIM_LABELS = {
  1: "identity verified",
  2: "sanctions screened",
  4: "jurisdiction eligible",
};

export const ZERO_ADDRESS = PLACEHOLDER;
