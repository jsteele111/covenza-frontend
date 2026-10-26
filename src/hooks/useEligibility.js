import { useChainId, useReadContracts } from "wagmi";
import { KYC_REGISTRY_ABI, VAULT_FACTORY_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, CLAIM_LABELS } from "../config/contracts.js";
import { useChainNow } from "./useChainNow.js";

/**
 * Whether a wallet may borrow or lend RIGHT NOW, and why not if it may not.
 *
 * @dev Replaces reading KYCRegistry.isVerified, which answered the wrong
 *      question once attestations started to expire and carry claims (#7,
 *      18 October 2026). isVerified means "admitted at some point and not
 *      revoked"; it stays true after an attestation lapses. The factory checks
 *      isEligible(wallet, requiredClaims) at every origination, so that is the
 *      only answer that predicts whether a transaction will go through.
 *
 *      The required claims are read from the factory rather than assumed: the
 *      owner can tighten them instantly (and loosen them after the timelock),
 *      and a hardcoded mask would silently disagree the day they change.
 *
 * @param address  wallet to check
 * @param role     "borrower" | "lender"
 */
export function useEligibility(address, role) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  // Expiry is enforced against block.timestamp, so judged against it here.
  const now = useChainNow();
  const ready =
    Boolean(address) && !isPlaceholder(contracts.kycRegistry) && !isPlaceholder(contracts.vaultFactory);

  const requiredFn = role === "lender" ? "requiredLenderClaims" : "requiredBorrowerClaims";

  const { data: base, isLoading: baseLoading, error, refetch: refetchBase } = useReadContracts({
    contracts: [
      { address: contracts.vaultFactory, abi: VAULT_FACTORY_ABI, functionName: requiredFn },
      { address: contracts.kycRegistry, abi: KYC_REGISTRY_ABI, functionName: "verificationOf", args: [address] },
      { address: contracts.kycRegistry, abi: KYC_REGISTRY_ABI, functionName: "isVerified", args: [address] },
    ],
    query: { enabled: ready, refetchInterval: 15000 },
  });

  const required = base?.[0]?.result;
  const verification = base?.[1]?.result;
  const isVerified = base?.[2]?.result === true;

  const { data: eligibleData, isLoading: eligibleLoading, refetch: refetchEligible } = useReadContracts({
    contracts: [
      {
        address: contracts.kycRegistry,
        abi: KYC_REGISTRY_ABI,
        functionName: "isEligible",
        args: [address, required ?? 0n],
      },
    ],
    query: { enabled: ready && required !== undefined, refetchInterval: 15000 },
  });

  const requiredNum = required !== undefined ? Number(required) : undefined;

  // A lender requirement of zero means lenders are not screened at all.
  const notRequired = requiredNum === 0;
  const eligible = notRequired ? true : eligibleData?.[0]?.result;

  const claims = verification ? Number(verification.claims) : 0;
  const validUntil = verification ? Number(verification.validUntil) : 0;
  const expired = isVerified && validUntil > 0 && validUntil < now;

  const missingClaims =
    requiredNum !== undefined
      ? [1, 2, 4].filter((bit) => (requiredNum & bit) && !(claims & bit)).map((bit) => CLAIM_LABELS[bit])
      : [];

  // One sentence for the UI, in order of what the person can act on.
  let reason = null;
  if (eligible === false) {
    if (!isVerified) reason = "This wallet has no attestation from a recognised provider.";
    else if (expired) reason = "This wallet's attestation has expired — get a fresh one from your provider.";
    else if (missingClaims.length) reason = `The attestation does not cover: ${missingClaims.join(", ")}.`;
    else reason = "This wallet is not eligible.";
  }

  return {
    ready,
    isLoading: ready && (baseLoading || (required !== undefined && eligibleLoading)),
    error,
    eligible,              // undefined while loading
    notRequired,
    isVerified,
    requiredClaims: requiredNum,
    claims,
    validUntil,
    expired,
    manual: verification?.manual === true,
    attester: verification?.attester,
    missingClaims,
    reason,
    refetch: () => { refetchBase(); refetchEligible(); },
  };
}
