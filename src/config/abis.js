import { parseAbi } from "viem";

// Human-readable ABI fragments — only the functions/events the front-end
// actually calls. Hand-written from the v2 Solidity source (Groups A/B,
// 76 tests passing) rather than a full artifact export.
//
// IMPORTANT: every export below is wrapped in viem's parseAbi(). Passing
// a raw array of human-readable strings directly to wagmi's hooks throws
// "Cannot use 'in' operator to search for 'name' in <string>" — traced
// and reproduced directly against viem 2.54.6 / wagmi 2.19.5 / @wagmi/core
// (confirmed even against the live KYCRegistry contract with its
// unchanged v1 ABI, so this is not specific to the v2 additions). The
// fix is to pre-parse with parseAbi() before it ever reaches a hook.
//
// v2 KEY CHANGES from v1:
//   - Everything is ERC20-native. No payable functions anywhere: principal
//     and deposit move via approve + transferFrom, ETH is wrapped to WETH
//     at the edges.
//   - deployVault takes the loan ASSET as its first argument and a
//     referrer as its last (8 args) and is non-payable — the lender must
//     approve the factory for principal + insurance skim first (see
//     quoteInsuranceSkim).
//   - payDeposit is non-payable — the borrower must approve the vault for
//     the required deposit first.
//   - New swap/swapBack actions, new settlement outcome fields
//     (settledInsuranceDraw, settledBounty), and a 9-arg Settled event.
//
// v2.1 ADDS the protocol fee: an add-on charged to the borrower at
// settlement, taken from their residual and split with an optional
// referrer. The lender's payout is unaffected by it. deployVault gained a
// trailing `referrer` argument; the vault exposes settledProtocolFee /
// settledReferrerFee alongside the other settlement outcome fields, plus
// the fee terms it snapshotted at origination.

export const KYC_REGISTRY_ABI = parseAbi([
  "function isVerified(address) view returns (bool)",
  "function statusOf(address wallet) view returns (bool verified, uint256 verifiedTs, uint256 revokedTs)",
  "function operator() view returns (address)",
  "function verify(address wallet) external",
  "function verifyWithSignature(address wallet, uint256 expiry, bytes signature) external",
  "function revoke(address wallet) external",
  "function badgeIdOf(address wallet) view returns (uint256)",
]);

export const VAULT_FACTORY_ABI = parseAbi([
  "function deployVault(address asset, address borrower, uint256 principal, uint256 feeRateBps, uint256 duration, bool useSeconds, uint256 depositAmount, address referrer) returns (address)",
  "function quoteInsuranceSkim(uint256 principal, uint256 feeRateBps) view returns (uint256)",
  "function quoteProtocolFee(uint256 principal, uint256 feeRateBps) view returns (uint256)",
  "function insuranceSkimRateBps() view returns (uint256)",
  "function protocolFeeRateBps() view returns (uint256)",
  "function referrerShareBps() view returns (uint256)",
  "function treasury() view returns (address)",
  "function getVaultsByBorrower(address borrower) view returns (address[])",
  "function getVaultsByLender(address lender) view returns (address[])",
  "function totalVaults() view returns (uint256)",
  "function allVaults(uint256 index) view returns (address)",
  "event VaultDeployed(address indexed vault, address indexed lender, address indexed borrower, address asset, uint256 principal, uint256 depositRequired, uint256 feeRateBps, uint256 insuranceSkim, uint256 deadline)",
  "event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury)",
  "event ProtocolFeeRateUpdated(uint256 previousBps, uint256 newBps)",
]);

export const VAULT_ABI = parseAbi([
  // --- Loan terms & state ---
  "function asset() view returns (address)",
  "function lender() view returns (address)",
  "function borrower() view returns (address)",
  "function principal() view returns (uint256)",
  "function deposit() view returns (uint256)",
  "function feeRateBps() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function isSettled() view returns (bool)",
  "function requiredDeposit() view returns (uint256)",
  "function depositPaid() view returns (bool)",
  "function vaultBalance() view returns (uint256)",
  "function isExpired() view returns (bool)",
  // --- Foreign asset tracking ---
  "function heldAssetCount() view returns (uint256)",
  "function heldAssets(uint256 index) view returns (address)",
  "function isHeld(address asset) view returns (bool)",
  "function swapFeeTierOf(address asset) view returns (uint24)",
  // --- Settlement outcome (readable post-settlement) ---
  "function settledTotalReturned() view returns (uint256)",
  "function settledInsuranceDraw() view returns (uint256)",
  "function settledLenderPayout() view returns (uint256)",
  "function settledBorrowerPayout() view returns (uint256)",
  "function settledFee() view returns (uint256)",
  "function settledBounty() view returns (uint256)",
  "function settledProtocolFee() view returns (uint256)",
  "function settledReferrerFee() view returns (uint256)",
  "function lossSeverity() view returns (uint8)",
  // --- Protocol fee terms, snapshotted at origination ---
  "function treasury() view returns (address)",
  "function referrer() view returns (address)",
  "function protocolFeeRateBps() view returns (uint256)",
  "function referrerShareBps() view returns (uint256)",
  // --- Actions (all non-payable in v2) ---
  "function payDeposit()",
  "function supplyToAave(uint256 amount)",
  "function withdrawFromAave(uint256 amount)",
  "function swap(address tokenOut, uint256 amountIn, uint256 minAmountOut, uint24 poolFee)",
  "function swapBack(address heldAsset, uint256 amountIn, uint256 minAmountOut)",
  "function settle()",
  // --- Events ---
  "event DepositReceived(address indexed borrower, uint256 amount)",
  "event SwapExecuted(address indexed tokenIn, address indexed tokenOut, uint256 amountIn, uint256 amountOut, bool isSwapBack)",
  "event AaveSupplied(uint256 amount, uint256 timestamp)",
  "event AaveWithdrawn(uint256 amount, uint256 timestamp)",
  "event ForcedSwapBack(address indexed heldAsset, uint256 amountIn, uint256 amountOut)",
  "event Settled(address indexed triggeredBy, bool early, uint256 totalReturned, uint256 insuranceDraw, uint256 lenderPayout, uint256 borrowerPayout, uint256 fee, uint256 bounty, uint256 timestamp)",
  "event ProtocolFeePaid(address indexed treasury, address indexed referrer, uint256 treasuryAmount, uint256 referrerAmount)",
]);

export const ASSET_REGISTRY_ABI = parseAbi([
  "function isWhitelisted(address asset) view returns (bool)",
  "function aTokenOf(address asset) view returns (address)",
  "function getWhitelistedAssets() view returns (address[])",
  "function totalAssets() view returns (uint256)",
  "function allAssets(uint256 index) view returns (address)",
  "function operator() view returns (address)",
  "function aavePool() view returns (address)",
  "function swapRouter() view returns (address)",
  "function weth() view returns (address)",
  "function twapWindow() view returns (uint32)",
  "function twapToleranceBps() view returns (uint256)",
  "function swapBackGracePeriod() view returns (uint256)",
  "function bountyRatePerHourBps() view returns (uint256)",
  "function bountyCapBps() view returns (uint256)",
  "function addAsset(address asset, address aToken) external",
  "function removeAsset(address asset) external",
  "function setSettlementConfig(uint32 twapWindow, uint256 twapToleranceBps, uint256 swapBackGracePeriod, uint256 bountyRatePerHourBps, uint256 bountyCapBps) external",
  "event AssetAdded(address indexed asset, address indexed aToken)",
  "event AssetRemoved(address indexed asset)",
]);

export const INSURANCE_POOL_ABI = parseAbi([
  "function reserveOf(address asset) view returns (uint256)",
  "function drawCapBps() view returns (uint256)",
  "function operator() view returns (address)",
  "function isRegisteredVault(address vault) view returns (bool)",
  "function fund(address asset, uint256 amount) external",
  "function adminWithdraw(address asset, address to, uint256 amount) external",
  "function setDrawCapBps(uint256 newBps) external",
  "event Funded(address indexed asset, address indexed from, uint256 amount)",
  "event Drawn(address indexed asset, address indexed vault, uint256 requested, uint256 paid)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
]);

// WETH adds wrap/unwrap on top of the standard ERC20 surface — used by the
// wrap-ETH helper so a lender holding plain ETH can fund a WETH loan.
export const WETH_ABI = [
  ...ERC20_ABI,
  ...parseAbi([
    "function deposit() payable",
    "function withdraw(uint256 amount)",
  ]),
];