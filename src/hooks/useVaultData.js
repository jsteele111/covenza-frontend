import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { VAULT_ABI, ERC20_ABI, ASSET_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const vaultAbi = VAULT_ABI;
const erc20Abi = ERC20_ABI;
const assetRegistryAbi = ASSET_REGISTRY_ABI;

// Mirrors AssetRegistry.YieldVenue. The ERC-4626 label deliberately names
// the standard rather than a protocol — the vault could be MetaMorpho,
// Yearn, or anything else compliant, and the UI cannot tell which.
export const VENUE_LABELS = { 0: "None", 1: "Aave V3", 2: "ERC-4626 vault" };

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
      // Valued in the UNDERLYING by the vault itself, so an appreciating
      // ERC-4626 share price is already accounted for and the UI never has
      // to know the difference between rebasing and share-based accounting.
      { address: vaultAddress, abi: vaultAbi, functionName: "yieldPositionValue" },
      { address: vaultAddress, abi: vaultAbi, functionName: "yieldVenueKind" },
      { address: vaultAddress, abi: vaultAbi, functionName: "effectiveGracePeriod" },
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

  // Stage 2 of the dependent read: which yield venue (if any) backs this
  // asset. Replaces the old aTokenOf lookup — Aave is now one venue among
  // several, so the question is no longer "is there an aToken" but "is
  // there a venue, and of what kind".
  const { data: venueData } = useReadContract({
    address: contracts.assetRegistry,
    abi: assetRegistryAbi,
    functionName: "venueOf",
    args: [assetAddress],
    query: { enabled: Boolean(assetAddress) && !isPlaceholder(contracts.assetRegistry) },
  });

  const venueKind    = venueData ? Number(venueData[0]) : 0;   // 0 None, 1 Aave, 2 ERC4626
  const venueAddress = venueData ? venueData[1] : undefined;

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
    yieldPositionValueRaw,
    yieldVenueKindRaw,
    effectiveGracePeriodRaw,
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
      // --- Yield venue ---
      //
      // venueKind is what the REGISTRY says this asset supports, and gates
      // whether the supply UI is offered at all. vaultVenueKind is what this
      // vault actually SNAPSHOTTED at first supply — they differ only if an
      // operator repointed the asset mid-loan, in which case the vault keeps
      // settling against its own.
      venueKind,
      venueAddress,
      vaultVenueKind: yieldVenueKindRaw != null ? Number(yieldVenueKindRaw) : 0,
      venueLabel: VENUE_LABELS[venueKind] || "None",
      yieldSupported: venueKind > 0,
      yieldPositionValue: yieldPositionValueRaw ?? 0n,
      effectiveGracePeriod: effectiveGracePeriodRaw ?? 0n,

      // Deprecated aliases, kept so nothing that still reads them breaks.
      // aTokenBalance was always the position's value; under ERC-4626 the
      // vault converts shares to underlying before returning it.
      aTokenBalance: yieldPositionValueRaw ?? 0n,
      aaveSupported: venueKind > 0,
    },
    isLoading,
    refetch,
  };
}