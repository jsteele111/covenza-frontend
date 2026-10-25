import { useAccount, useChainId, useReadContract, useReadContracts } from "wagmi";
import { VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { symbolForToken } from "../config/contracts.js";

// Mirrors AssetRegistry.RiskTier.
export const TIER_LABELS = { 0: "Blue chip", 1: "Standard", 2: "Speculative" };

// Mirrors Vault.lossSeverity(). 3 was added with audit I-3: an in-kind close
// hands over assets the vault could not sell, so its outcome cannot be
// measured in the loan asset — reading cash alone reported a lender loss even
// when the assets made the lender whole.
export const SEVERITY_LABELS = {
  0: "No loss",
  1: "Settled with borrower-only loss",
  2: "Settled with lender-impacted loss",
  3: "Settled in kind",
};

// The fields read for every vault. Kept as a list so the destructuring below
// cannot fall out of step with the order of the reads.
const FIELDS = [
  "asset", "lender", "borrower", "principal", "deposit", "requiredDeposit",
  "aprBps", "deadline", "isSettled", "isExpired", "depositPaid", "vaultBalance",
  "heldAssetCount", "lossSeverity", "effectiveGracePeriod", "accruedFee",
  "fullTermFee", "term", "maxTier", "insurancePremium", "originatedAt",
  "settledInKind", "settledTotalReturned", "settledInsuranceDraw",
  "settledLenderPayout", "settledBorrowerPayout", "settledFee", "settledBounty",
  "settledProtocolFee", "settledReferrerFee", "IN_KIND_LENDER_PERIOD",
];

/**
 * Reads every field the UI needs for a single vault.
 *
 * Yield venues were removed from the contracts before the audit (E-1), so
 * there is no longer a second stage looking up a venue; what remains is one
 * multicall plus the asset's decimals, the in-kind window, and anything the
 * connected wallet is owed.
 *
 * "Investable" is still derived rather than read: the vault's loan-asset
 * balance may never drop below `deposit` (Vault._enforceDepositInvariant), so
 * what the borrower can move right now is simply `vaultBalance - deposit`.
 */
export function useVaultData(vaultAddress) {
  const chainId = useChainId();
  const { address: wallet } = useAccount();
  const enabled = Boolean(vaultAddress);

  const { data, isLoading, refetch } = useReadContracts({
    contracts: FIELDS.map((functionName) => ({ address: vaultAddress, abi: VAULT_ABI, functionName })),
    query: { enabled, refetchInterval: 10000 },
  });

  const get = (name) => data?.[FIELDS.indexOf(name)]?.result;
  const assetAddress = get("asset");
  const isSettled = get("isSettled");
  const isExpired = get("isExpired");

  const { data: decimals } = useReadContract({
    address: assetAddress,
    abi: ERC20_ABI,
    functionName: "decimals",
    query: { enabled: Boolean(assetAddress) },
  });

  // When in-kind settlement opens. Reads the registry's outage record, so it
  // only means anything once the deadline has passed; before then it is still
  // a correct lower bound and is shown as such.
  const { data: inKindFromRaw, refetch: refetchInKind } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "inKindFrom",
    query: { enabled: enabled && isSettled === false, refetchInterval: 15000 },
  });

  // Payouts the token refused at settlement (audit M-1) — held in the vault
  // for the recipient to claim. Read for the CONNECTED wallet, in the loan
  // asset; held-token amounts are read by useHeldClaims below.
  const { data: owedLoanAsset, refetch: refetchOwed } = useReadContract({
    address: vaultAddress,
    abi: VAULT_ABI,
    functionName: "owed",
    args: [assetAddress, wallet],
    query: { enabled: Boolean(assetAddress && wallet) && isSettled === true, refetchInterval: 15000 },
  });

  if (!enabled || !data) {
    return { vault: null, isLoading, refetch };
  }

  const vaultBalance = get("vaultBalance");
  const deposit = get("deposit");
  const requiredDeposit = get("requiredDeposit");
  const insurancePremium = get("insurancePremium") ?? 0n;
  const maxTier = get("maxTier");
  const lossSeverity = Number(get("lossSeverity") ?? 0);

  const investableRemaining =
    vaultBalance != null && deposit != null && vaultBalance > deposit ? vaultBalance - deposit : 0n;

  const inKindFrom = inKindFromRaw != null ? Number(inKindFromRaw) : undefined;
  const lenderPeriod = Number(get("IN_KIND_LENDER_PERIOD") ?? 0);

  return {
    vault: {
      address: vaultAddress,
      asset: assetAddress,
      decimals,
      symbol: symbolForToken(chainId, assetAddress),
      lender: get("lender"),
      borrower: get("borrower"),
      principal: get("principal"),
      deposit,
      requiredDeposit,
      originatedAt: get("originatedAt") != null ? Number(get("originatedAt")) : undefined,

      // --- Interest ---
      // aprBps is per ANNUM. fee is what has accrued now; fullTermFee is the
      // ceiling. The gap between them is what a borrower saves by closing early.
      aprBps: get("aprBps"),
      fee: get("accruedFee"),
      fullTermFee: get("fullTermFee"),
      term: get("term"),

      // --- Risk mandate and insurance ---
      maxTier: maxTier != null ? Number(maxTier) : undefined,
      maxTierLabel: TIER_LABELS[Number(maxTier ?? 0)] || "—",
      // payDeposit pulls deposit AND premium in one transfer, so an approval
      // has to cover both or the call reverts.
      insurancePremium,
      depositPlusPremium: requiredDeposit != null ? requiredDeposit + insurancePremium : undefined,

      deadline: get("deadline"),
      isSettled,
      isExpired,
      depositPaid: get("depositPaid"),
      vaultBalance,
      investableRemaining,
      heldAssetCount: Number(get("heldAssetCount") ?? 0),
      effectiveGracePeriod: get("effectiveGracePeriod") ?? 0n,

      // --- In-kind settlement (item 14, audit M-2 / KRAIT-005) ---
      // Opens at inKindFrom, to the lender alone for IN_KIND_LENDER_PERIOD,
      // then to anyone — and only when some held asset genuinely cannot be sold.
      inKindFrom,
      inKindOpenToAnyoneFrom: inKindFrom !== undefined ? inKindFrom + lenderPeriod : undefined,
      inKindLenderPeriod: lenderPeriod,
      settledInKind: get("settledInKind") === true,

      // --- Settlement outcome ---
      lossSeverity,
      lossSeverityLabel: SEVERITY_LABELS[lossSeverity] || "—",
      settledTotalReturned: get("settledTotalReturned"),
      settledInsuranceDraw: get("settledInsuranceDraw"),
      settledLenderPayout: get("settledLenderPayout"),
      settledBorrowerPayout: get("settledBorrowerPayout"),
      settledFee: get("settledFee"),
      settledBounty: get("settledBounty"),
      settledProtocolFee: get("settledProtocolFee"),
      settledReferrerFee: get("settledReferrerFee"),

      // What the connected wallet can claim in the loan asset.
      owedToMe: owedLoanAsset ?? 0n,
    },
    isLoading,
    refetch: () => { refetch(); refetchInKind(); refetchOwed(); },
  };
}

/**
 * Held tokens the connected wallet can claim from a settled vault.
 *
 * An in-kind close hands over assets the vault could not sell; a frozen one is
 * recorded in owed() and claimed when it can move. The vault forgets its held
 * list once it settles, so the candidates are found from the InKindAllocated
 * events rather than from heldAssets(). Passed in by the caller, which already
 * reads those logs, to keep this a plain read.
 */
export function useHeldClaims(vaultAddress, tokens, wallet) {
  const chainId = useChainId();
  const list = (tokens || []).filter(Boolean);

  const { data, refetch } = useReadContracts({
    contracts: list.flatMap((t) => [
      { address: vaultAddress, abi: VAULT_ABI, functionName: "owed", args: [t, wallet] },
      { address: t, abi: ERC20_ABI, functionName: "decimals" },
    ]),
    query: { enabled: Boolean(vaultAddress && wallet) && list.length > 0, refetchInterval: 15000 },
  });

  const claims = list
    .map((t, i) => ({
      token: t,
      symbol: symbolForToken(chainId, t),
      amount: data?.[i * 2]?.result ?? 0n,
      decimals: data?.[i * 2 + 1]?.result,
    }))
    .filter((c) => c.amount > 0n);

  return { claims, refetch };
}
