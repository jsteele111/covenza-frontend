import { useState, useMemo } from "react";
import { useReadContracts } from "wagmi";
import { VAULT_ABI } from "../config/abis.js";

/**
 * Picks which of a borrower's vaults to show, and lets them change it.
 *
 * @dev Replaces "show the most recent one", which was wrong in a specific and
 *      quietly damaging way: the newest vault is often a SETTLED one, so a
 *      borrower with a live loan and a closed one could open the app and see
 *      the closed one, with the live loan's deadline nowhere on screen. The
 *      contracts have always permitted several concurrent vaults —
 *      getVaultsByBorrower returns an array — so this was a display limit
 *      masquerading as a product constraint.
 *
 *      Default is the most recent ACTIVE vault, because that is the one with a
 *      deadline attached and therefore the one that can hurt someone if
 *      missed. Settled vaults are still reachable, just never volunteered.
 *
 *      `activeOnly` (26 October 2026): closed loans now live on the History
 *      page, so the Lend and Borrow pages ask for open ones only. `loaded`
 *      says whether the settled flags have arrived — until then every vault
 *      would look open, and the page would flash closed loans.
 */
export function useVaultSelection(vaultAddresses, { activeOnly = false } = {}) {
  const [override, setOverride] = useState(null);

  const addresses = vaultAddresses || [];

  const { data, refetch } = useReadContracts({
    contracts: addresses.map((address) => ({
      address,
      abi: VAULT_ABI,
      functionName: "isSettled",
    })),
    query: { enabled: addresses.length > 0, refetchInterval: 15000 },
  });

  const vaults = useMemo(
    () =>
      addresses.map((address, i) => ({
        address,
        isSettled: data?.[i]?.result === true,
        // 1-based and in origination order, so the label matches the order
        // they were taken out rather than an array index.
        label: `Loan ${i + 1}`,
      })),
    [addresses.join("|"), data]
  );

  const loaded = addresses.length === 0 || data !== undefined;
  const activeVaults = vaults.filter((v) => !v.isSettled);
  const listed = activeOnly ? activeVaults : vaults;

  // Reverse order: most recent first, since that is what someone is most
  // likely to be looking for.
  const preferred =
    activeVaults.length > 0
      ? activeVaults[activeVaults.length - 1].address
      : vaults.length > 0
      ? vaults[vaults.length - 1].address
      : null;

  // The override is dropped if it no longer refers to a real vault — which
  // happens on a wallet switch, when the previous borrower's selection would
  // otherwise persist into someone else's list.
  const selectable = listed.map((v) => v.address);
  const selected =
    override && selectable.includes(override)
      ? override
      : activeOnly
      ? (activeVaults.length > 0 ? activeVaults[activeVaults.length - 1].address : null)
      : preferred;

  return {
    vaults: listed,
    loaded,
    activeCount: activeVaults.length,
    selected,
    select: setOverride,
    refetch,
  };
}
