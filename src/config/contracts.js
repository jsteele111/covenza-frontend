// -----------------------------------------------------------------------
// vaultFactory was redeployed for v2.1 (protocol fee) on 2026-07-29,
// reusing the existing KYCRegistry, AssetRegistry and InsurancePool — only
// the factory and vault logic changed. The previous factory was
// 0xd2bF51C369666076F1B0d0c544B8433ec74Db4e5; vaults it deployed remain
// live and settleable on-chain but do not appear in this UI, which scopes
// lookups to the current factory.
//
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
  // -------------------------------------------------------------------
  // Robinhood Chain Testnet (46630) — the primary target.
  //
  // The first deployment running against REAL Uniswap V3 rather than mocks.
  // Uniswap is mainnet-only on Robinhood Chain, so the factory and router
  // below were deployed from @uniswap/v3-core artifacts by
  // scripts/deploy-uniswap-testnet.js — real audited bytecode, pools we
  // control. lifecycle-proof-robinhood.js has verified all three settlement
  // tiers plus an organic 11.48 loss absorbed entirely by the borrower
  // deposit against these exact addresses.
  //
  // tUSDG carries the ERC-4626 yield venue; tWETH is swap-only. Aave has no
  // deployment on this chain, so no asset uses the Aave venue.
  //
  // twapWindow is 60s here, not the production 1800: a warmed pool holds
  // only minutes of observation history and a real chain cannot be
  // fast-forwarded.
  // -------------------------------------------------------------------
  // WARNING: Robinhood testnet wipes CONTRACT STATE while preserving account
  // balances and block height. Every address below has already been lost once
  // and redeployed. Verify before any demo — a stale address returns empty
  // data rather than failing loudly, because calls to codeless addresses
  // succeed with no returndata.
  //
  // The factory and vault implementation were rotated again at Phase 4 to put
  // mandates and risk tiers in service. The registry, KYC registry and
  // insurance pool are the originals and kept their state — the pool's 2000
  // tUSDG reserve carried across. Vaults originated by the previous factory
  // still settle on-chain but no longer appear in the lender view, which
  // scopes its lookups to the current factory.
  46630: {
    // Full-stack redeploy putting two-step transfer on every admin role, plus
    // addAssetWithTier on the registry.
    //
    // The role change is why this is a redeploy rather than a config edit: the
    // previous VaultFactory had no ownership transfer at all, so it could only
    // ever belong to its deployer. Handing control to a multisig was not a
    // permissions question, it was impossible. Operator roles transferred in
    // one step, where a mistyped address was equally final.
    //
    // Nothing carried over. Verified status, the insurance reserve and vault
    // history all restart.
    kycRegistry:   "0x11F55ff9122E0d4E1De976Ce73a917e64Ed22DD3",
    assetRegistry: "0xA6588030E822bEc3c7551ef67A63D21D6c2B516D",
    insurancePool: "0x3368Ee8aa5b32061c32B938add1F4005D2Cb7007",
    vaultFactory:  "0xdF2c29a630176d6Cb431592cC87EE1931d8c08e2",
    treasury:      "0x2e6075b0B10c747357C2Bd58075af5e471f1f5F3",
    tokens: {
      tUSDG: "0xF727a9E9813d884bfFf2Be906633f4C5C963DC99",
      tWETH: "0x3981D4CC453ebc7F5eeC503fF00Da34BF5e65F5C",
      // Standard tier, 72h grace. A tokenised equity trades 24/5, so a
      // deadline falling on a Friday evening has no market to settle into
      // until Monday.
      tAAPL: "0x422307E3f960B609EFd54841DD9979b1ad987c7e",
    },

    // Vaults are EIP-1167 clones of this implementation, which is deployed once
    // and never initialised. Recorded because a clone carries no code of its
    // own — point a contract verifier at the implementation, not at a vault.
    vaultImplementation: "0x5d0d415409EdCEA0886704EcAa507D01037E68CF",
    uniswapTwapLibrary:  "0x33FAE0012f8834908850F15Be6EeFc51DA3014a9",
    // Reference only — the app reads uniswapFactory from AssetRegistry
    // on-chain rather than trusting this, so a registry repoint can't leave
    // the UI pointed at a stale factory.
    uniswap: {
      factory: "0xC509Ed62cf655AD8eFd33a1B6Ba4724E38621680",
      router:  "0x70Ce56aFf68cD3C5352c66C665B37258915b3F14",
      pool:    "0x44A3024740aCDFe744500A606a8B3552717B5B76", // tUSDG/tWETH 0.3%
    },
    yieldVenue4626: "0x3731ff6A8C64767aE24967f96B1A59cFb803dA98", // over tUSDG — a MOCK
  },

  // Arbitrum Sepolia (421614) was removed on 4 August 2026.
  //
  // Not because the deployment is gone — it is still on chain and its vaults
  // are still settleable. Because this frontend can no longer speak to it. That
  // stack predates risk tiers and mandates, so the calls this app now makes
  // (tierOf, highestTierSince, the whole mandate surface) do not exist there.
  //
  // Leaving it listed offered a wallet the chance to switch to a chain where
  // every read returns empty and every write reverts, which reads as a broken
  // app rather than an unsupported network. Settling a legacy Sepolia vault is
  // a scripting job against that stack's own ABI, not something this interface
  // can honestly present.
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

// Robinhood testnet is now the default — it matches the first chain listed in
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
export const TOKEN_DECIMALS = {
  WETH: 18, WBTC: 8, USDC: 6, USDT: 6,
  tUSDG: 18, tWETH: 18, // both 18 deliberately, so a Uniswap tick of 0 is true parity
  tAAPL: 18,
};