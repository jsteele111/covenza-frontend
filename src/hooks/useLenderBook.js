import { useMemo } from "react";
import { useChainId, useReadContracts } from "wagmi";
import { VAULT_ABI } from "../config/abis.js";
import { symbolForToken, TOKEN_DECIMALS } from "../config/contracts.js";

const READS = [
  "asset",
  "principal",
  "isSettled",
  "accruedFee",
  "settledLenderPayout",
  "settledFee",
  "settledInsuranceDraw",
];

/**
 * Aggregates a lender's originated vaults into a book.
 *
 * @dev Grouped BY ASSET rather than summed. A single "total lent" figure
 *      across tUSDG and tWETH would be the sum of two different units, which
 *      is not a number — and the temptation to print one is exactly how a
 *      dashboard starts lying.
 *
 *      The figure worth watching is `shortfall`: what the lender was owed at
 *      settlement minus what they actually received. The protocol's claim is
 *      that this stays at zero because the borrower's deposit absorbs losses
 *      first and the insurance pool second. That claim is only worth anything
 *      if it is measured, so this measures it rather than reporting the
 *      headline interest and leaving the failure mode unspoken.
 */
export function useLenderBook(vaultAddresses) {
  const chainId = useChainId();
  const addresses = vaultAddresses || [];

  const { data, isLoading, refetch } = useReadContracts({
    contracts: addresses.flatMap((address) =>
      READS.map((functionName) => ({ address, abi: VAULT_ABI, functionName }))
    ),
    query: { enabled: addresses.length > 0, refetchInterval: 20000 },
  });

  const book = useMemo(() => {
    if (!data) return null;

    const byAsset = new Map();

    addresses.forEach((_, i) => {
      const base = i * READS.length;
      const get = (n) => data[base + READS.indexOf(n)]?.result;

      const asset = get("asset");
      if (!asset) return;

      const symbol = symbolForToken(chainId, asset);
      if (!byAsset.has(symbol)) {
        byAsset.set(symbol, {
          symbol,
          decimals: TOKEN_DECIMALS[symbol] ?? 18,
          activeCount: 0,
          outstanding: 0n,
          accruing: 0n,
          settledCount: 0,
          interestEarned: 0n,
          insuranceDrawn: 0n,
          shortfall: 0n,
        });
      }
      const row = byAsset.get(symbol);

      const principal = get("principal") ?? 0n;
      const settled = get("isSettled") === true;

      if (!settled) {
        row.activeCount += 1;
        row.outstanding += principal;
        row.accruing += get("accruedFee") ?? 0n;
        return;
      }

      row.settledCount += 1;

      const payout = get("settledLenderPayout") ?? 0n;
      const fee = get("settledFee") ?? 0n;
      row.insuranceDrawn += get("settledInsuranceDraw") ?? 0n;

      // What was owed is principal plus the fee the contract itself recorded
      // at settlement — not the fee we might recompute now, which would drift
      // as terms change.
      const owed = principal + fee;
      if (payout >= owed) {
        row.interestEarned += payout - principal;
      } else {
        row.interestEarned += payout > principal ? payout - principal : 0n;
        row.shortfall += owed - payout;
      }
    });

    return Array.from(byAsset.values());
  }, [addresses.join("|"), data, chainId]);

  return { book, isLoading, refetch };
}
