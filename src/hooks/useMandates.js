import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { VAULT_FACTORY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken, TOKEN_DECIMALS } from "../config/contracts.js";
import { TIER_LABELS } from "./useVaultData.js";

const factoryAbi = VAULT_FACTORY_ABI;

/**
 * Reads the mandate board.
 *
 * Two things this deliberately does NOT do.
 *
 * It does not show a mandate's offered size. It shows quoteMandateFillable,
 * which is min(allowance, balance, offer) read live. A lender's capital stays
 * in their own wallet and an allowance can be revoked for free at any moment,
 * so a board displaying intent rather than capacity fills up with offers that
 * cannot be taken — the failure mode that hollowed out NFT bid books.
 *
 * It does not filter out expired or cancelled mandates client-side by
 * inspecting fields. isMandateLive is a contract call, and it accounts for the
 * lender's nonce — cancelAllMandates invalidates every mandate at once without
 * touching any of them individually, so a client reconstructing liveness from
 * the struct alone would show mandates that cannot be filled.
 */
export function useMandates({ lenderFilter, onlyLive = true } = {}) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const ready = !isPlaceholder(contracts.vaultFactory);

  const { data: totalRaw, refetch: refetchTotal } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "totalMandates",
    query: { enabled: ready, refetchInterval: 15000 },
  });

  const total = totalRaw != null ? Number(totalRaw) : 0;
  const ids = Array.from({ length: total }, (_, i) => i);

  // Three reads per mandate: the terms, whether it is live, and what could
  // actually be drawn right now. Batched into one multicall.
  const { data, isLoading, refetch } = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: contracts.vaultFactory, abi: factoryAbi, functionName: "mandate", args: [BigInt(id)] },
      { address: contracts.vaultFactory, abi: factoryAbi, functionName: "isMandateLive", args: [BigInt(id)] },
      { address: contracts.vaultFactory, abi: factoryAbi, functionName: "quoteMandateFillable", args: [BigInt(id)] },
    ]),
    query: { enabled: ready && total > 0, refetchInterval: 15000 },
  });

  const mandates = ids
    .map((id, i) => {
      const terms = data?.[i * 3]?.result;
      if (!terms) return null;

      // Carried on the mandate so every consumer formats and parses in the
      // asset's own units. Assuming 18 works until the first USDC mandate,
      // where it would misprice the input by six orders of magnitude.
      const symbol = symbolForToken(chainId, terms.asset);

      return {
        id,
        lender: terms.lender,
        asset: terms.asset,
        symbol,
        decimals: TOKEN_DECIMALS[symbol] ?? 18,
        minPrincipal: terms.minPrincipal,
        maxPrincipal: terms.maxPrincipal,
        minTermSeconds: Number(terms.minTermSeconds),
        maxTermSeconds: Number(terms.maxTermSeconds),
        expiry: Number(terms.expiry),
        maxTier: Number(terms.maxTier),
        maxTierLabel: TIER_LABELS[Number(terms.maxTier)] || "—",
        permittedBorrower: terms.permittedBorrower,
        isTargeted: terms.permittedBorrower !== "0x0000000000000000000000000000000000000000",

        baseAprBps: Number(terms.baseAprBps),
        termPremiumBpsPerDay: Number(terms.termPremiumBpsPerDay),
        depositCreditBpsPerPoint: Number(terms.depositCreditBpsPerPoint),
        minDepositBps: Number(terms.minDepositBps),
        minAprBps: Number(terms.minAprBps),

        isLive: data?.[i * 3 + 1]?.result === true,
        fillable: data?.[i * 3 + 2]?.result ?? 0n,
      };
    })
    .filter(Boolean)
    .filter((m) => (onlyLive ? m.isLive : true))
    .filter((m) =>
      lenderFilter ? m.lender.toLowerCase() === lenderFilter.toLowerCase() : true
    );

  return {
    mandates,
    total,
    isLoading,
    refetch: () => { refetchTotal(); refetch(); },
  };
}

/**
 * Mirrors VaultFactory.quoteMandateApr for live display as the borrower moves
 * the sliders.
 *
 * @dev Duplicating contract arithmetic in JavaScript is normally a mistake —
 *      the deposit floor is read from the chain for exactly that reason. This
 *      one is different in kind: it is three multiplications with no
 *      fixed-point square root, and it needs to update on every keystroke
 *      rather than every block. The contract remains the authority; a fill
 *      reverts if this disagrees.
 */
export function previewMandateApr(m, termSeconds, depositBps, bindingDepositBps) {
  if (!m) return null;

  let apr = m.baseAprBps + Math.floor((m.termPremiumBpsPerDay * termSeconds) / 86400);

  // Credit is measured from the BINDING deposit — the greater of the mandate's
  // own minimum and the protocol's tier floor at this term — matching
  // VaultFactory.quoteMandateApr.
  //
  // Passing only the mandate's minimum paid the borrower for deposit the
  // protocol had already compelled. Callers that cannot supply the floor fall
  // back to the mandate's minimum, which is correct wherever the mandate binds
  // and understates the rate where it does not; the contract is the authority
  // either way and a fill reverts if this disagrees.
  const binding =
    bindingDepositBps !== undefined && bindingDepositBps > m.minDepositBps
      ? bindingDepositBps
      : m.minDepositBps;

  if (depositBps > binding) {
    const credit = Math.floor((m.depositCreditBpsPerPoint * (depositBps - binding)) / 100);
    apr = credit >= apr ? 0 : apr - credit;
  }

  return Math.max(apr, m.minAprBps);
}
