import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { VAULT_ABI, ERC20_ABI, ASSET_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const vaultAbi = VAULT_ABI;
const erc20Abi = ERC20_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;

/**
 * Reads every field the UI needs for a single vault — rewritten for v2's
 * multi-asset design (Group E4). Two changes from the v1 version this
 * replaces:
 *
 *   1. No more hardcoded AAVE.wethAToken. v2 vaults can be denominated in
 *      any whitelisted asset, so the Aave position (if any) is looked up
 *      live via AssetRegistry.aTokenOf(asset) — a vault's own `asset()`
 *      read feeds directly into the next query, so this is a two-stage
 *      dependent read, not a single flat multicall.
 *
 *   2. No more `investedAmount`. v1 tracked cumulative investment as a
 *      separate counter; v2 replaced that with a single invariant enforced
 *      on-chain (Vault.sol's _enforceDepositInvariant): the vault's
 *      loan-asset balance may never drop below `deposit`. So "how much can
 *      the borrower still move right now" is simply `vaultBalance -
 *      deposit`, computed here as `investableRemaining` rather than read
 *      from a contract field that no longer exists.
 */
export function useVaultData(vaultAddress) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const enabled = Boolean(vaultAddress);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: [
      { address: vaultAddress, abi: vaultAbi, functionName: "asset" },
      { address: vaultAddress, abi: vaultAbi, functionName: "lender" },
      { address: vaultAddress, abi: vaultAbi, functionName: "borrower" },
      { address: vaultAddress, abi: vaultAbi, functionName: "principal" },
      { address: vaultAddress, abi: vaultAbi, functionName: "deposit" },
      { address: vaultAddress, abi: vaultAbi, functionName: "requiredDeposit" },
      { address: vaultAddress, abi: vaultAbi, functionName: "feeRateBps" },
      { address: vaultAddress, abi: vaultAbi, functionName: "deadline" },
      { address: vaultAddress, abi: vaultAbi, functionName: "isSettled" },
      { address: vaultAddress, abi: vaultAbi, functionName: "isExpired" },
      { address: vaultAddress, abi: vaultAbi, functionName: "depositPaid" },
      { address: vaultAddress, abi: vaultAbi, functionName: "vaultBalance" },
      { address: vaultAddress, abi: vaultAbi, functionName: "heldAssetCount" },
      { address: vaultAddress, abi: vaultAbi, functionName: "lossSeverity" },
    ],
    query: { enabled, refetchInterval: 10000 },
  });

  const assetAddress = data?.[0]?.result;

  // Decimals for the loan asset — read live, not assumed, same convention
  // as useProtocolStats.js.
  const { data: decimals } = useReadContract({
    address: assetAddress,
    abi: erc20Abi,
    functionName: "decimals",
    query: { enabled: Boolean(assetAddress) },
  });

  // Stage 2 of the dependent read: which aToken (if any) backs this asset.
  const { data: aToken } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "aTokenOf",
    args: [assetAddress],
    query: { enabled: Boolean(assetAddress) && !isPlaceholder(contracts.assetRegistry) },
  });

  const aTokenConfigured = Boolean(aToken) && !isPlaceholder(aToken);

  const { data: aTokenBalance } = useReadContract({
    address: aToken,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [vaultAddress],
    query: { enabled: enabled && aTokenConfigured, refetchInterval: 10000 },
  });

  if (!enabled || !data) {
    return { vault: null, isLoading, refetch };
  }

  const [
    asset,
    lender,
    borrower,
    principal,
    deposit,
    requiredDeposit,
    feeRateBps,
    deadline,
    isSettled,
    isExpired,
    depositPaid,
    vaultBalance,
    heldAssetCountRaw,
    lossSeverityRaw,
  ] = data.map((d) => d.result);

  // Derived convenience value: the fixed fee owed to the lender, charged in
  // full regardless of early or on-time settlement. Not a separate on-chain
  // read — computed the same way Vault.sol computes it internally.
  const fee = principal != null && feeRateBps != null
    ? (principal * feeRateBps) / 10000n
    : undefined;

  // See file header — replaces v1's investedAmount. vaultBalance already
  // includes the deposit, so what's actually free to move is the excess
  // over it (never negative; clamps at 0 pre-deposit or immediately after
  // a swap/supply that lands exactly on the invariant).
  const investableRemaining =
    vaultBalance != null && deposit != null && vaultBalance > deposit
      ? vaultBalance - deposit
      : 0n;

  return {
    vault: {
      address: vaultAddress,
      asset,
      decimals,
      symbol: symbolForToken(chainId, asset),
      lender,
      borrower,
      principal,
      deposit,
      requiredDeposit,
      feeRateBps,
      fee,
      deadline,
      isSettled,
      isExpired,
      depositPaid,
      vaultBalance,
      investableRemaining,
      heldAssetCount: heldAssetCountRaw != null ? Number(heldAssetCountRaw) : 0,
      lossSeverity: lossSeverityRaw != null ? Number(lossSeverityRaw) : 0,
      aTokenBalance: aTokenConfigured ? (aTokenBalance || 0n) : 0n,
      // Whether THIS asset supports Aave at all (registry.aTokenOf != 0),
      // independent of whether the vault currently holds a position — E5's
      // borrower view gates the Supply-to-Aave UI on this, not on balance.
      aaveSupported: aTokenConfigured,
    },
    isLoading,
    refetch,
  };
}