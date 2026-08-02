import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { KYC_REGISTRY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder } from "../config/contracts.js";

/**
 * The identity providers whose attestations this deployment accepts.
 *
 * @dev Read from the chain rather than a bundled list. The registry is the
 *      authority on who can admit a borrower, and a frontend constant would
 *      go stale the moment the operator adds or drops a provider — showing
 *      someone a link to a provider we no longer recognise, or hiding one we
 *      do. Both waste a real person's afternoon.
 */
export function useAttesters() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const ready = !isPlaceholder(contracts.kycRegistry);

  const { data: keys, isError } = useReadContract({
    address: contracts.kycRegistry,
    abi: KYC_REGISTRY_ABI,
    functionName: "allAttesters",
    query: { enabled: ready, refetchInterval: 30000 },
  });

  // A registry deployed before attesters existed has no such function, so the
  // call reverts. That is not "no providers are recognised" — it is an older
  // contract — and telling a borrower that borrowing is closed would be a
  // false alarm of exactly the kind this codebase keeps producing.
  const legacy = isError;

  const list = keys || [];

  const { data, isLoading } = useReadContracts({
    contracts: list.map((key) => ({
      address: contracts.kycRegistry,
      abi: KYC_REGISTRY_ABI,
      functionName: "attesters",
      args: [key],
    })),
    query: { enabled: ready && list.length > 0 },
  });

  const attesters = list
    .map((key, i) => {
      const r = data?.[i]?.result;
      if (!r) return null;
      const [recognised, name, url, addedAt] = r;
      return { key, recognised, name, url, addedAt: Number(addedAt) };
    })
    .filter(Boolean);

  return {
    // Delisted providers are deliberately not offered: the full list is
    // history for audit, not a menu.
    live: attesters.filter((a) => a.recognised),
    all: attesters,
    legacy,
    isLoading,
  };
}
