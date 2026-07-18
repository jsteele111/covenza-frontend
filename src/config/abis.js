// Human-readable ABI fragments — only the functions/events the front-end
// actually calls. Kept minimal and hand-written from the deployed Solidity
// source rather than a full artifact export.

export const KYC_REGISTRY_ABI = [
  "function isVerified(address) view returns (bool)",
  "function statusOf(address wallet) view returns (bool verified, uint256 verifiedTs, uint256 revokedTs)",
  "function operator() view returns (address)",
  "function verify(address wallet) external",
  "function verifyWithSignature(address wallet, uint256 expiry, bytes signature) external",
  "function revoke(address wallet) external",
  "function badgeIdOf(address wallet) view returns (uint256)",
];

export const VAULT_FACTORY_ABI = [
  "function deployVault(address borrower, uint256 feeRateBps, uint256 duration, bool useSeconds, uint256 depositAmount) payable returns (address)",
  "function getVaultsByBorrower(address borrower) view returns (address[])",
  "function getVaultsByLender(address lender) view returns (address[])",
  "function totalVaults() view returns (uint256)",
  "event VaultDeployed(address indexed vault, address indexed lender, address indexed borrower, uint256 principal, uint256 depositRequired, uint256 feeRateBps, uint256 deadline)",
];

export const VAULT_ABI = [
  "function lender() view returns (address)",
  "function borrower() view returns (address)",
  "function principal() view returns (uint256)",
  "function deposit() view returns (uint256)",
  "function feeRateBps() view returns (uint256)",
  "function investedAmount() view returns (uint256)",
  "function deadline() view returns (uint256)",
  "function isSettled() view returns (bool)",
  "function requiredDeposit() view returns (uint256)",
  "function depositPaid() view returns (bool)",
  "function vaultBalance() view returns (uint256)",
  "function isExpired() view returns (bool)",
  "function settledTotalReturned() view returns (uint256)",
  "function settledLenderPayout() view returns (uint256)",
  "function settledBorrowerPayout() view returns (uint256)",
  "function settledFee() view returns (uint256)",
  "function lossSeverity() view returns (uint8)",
  "function payDeposit() payable",
  "function supplyToAave(uint256 amount)",
  "function settle()",
  "event DepositReceived(address indexed borrower, uint256 amount)",
  "event Settled(address indexed triggeredBy, bool early, uint256 totalReturned, uint256 lenderPayout, uint256 borrowerPayout, uint256 fee, uint256 timestamp)",
  "event WhitelistedActionExecuted(address indexed borrower, address indexed target, uint256 amount, uint256 timestamp)",
  "event AaveWithdrawn(uint256 amount, uint256 timestamp)",
];

export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
];