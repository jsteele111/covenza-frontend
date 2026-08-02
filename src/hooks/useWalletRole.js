import { useAccount, useChainId, useReadContract } from "wagmi";
import { getContractsForChain, isPlaceholder } from "../config/contracts.js";
import { KYC_REGISTRY_ABI, VAULT_FACTORY_ABI, ASSET_REGISTRY_ABI } from "../config/abis.js";

/**
 * Detects which role(s), if any, the connected wallet genuinely has
 * against the protocol — replacing the old model where every wallet saw
 * every tab regardless of relevance.
 *
 * A wallet may have MORE than one role (nothing stops the same address
 * from lending on one vault and borrowing on another) — this is reported
 * honestly as an array, not collapsed to a single value. The Operator
 * role is checked directly against AssetRegistry's operator address
 * (the same address governs KYCRegistry — see contract source), not
 * inferred from usage.
 *
 * @returns {{
 *   roles: string[],        // subset of ["operator","lender","borrower"], in that priority order
 *   isLoading: boolean,
 *   hasAnyRole: boolean,
 *   queryFailed: boolean,   // true if the reads themselves failed (e.g. contracts.js
 *                           // still has a PLACEHOLDER address for this network) — distinct
 *                           // from "checked successfully, wallet genuinely has no roles"
 * }}
 */
export function useWalletRole() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { assetRegistry, vaultFactory, kycRegistry } = getContractsForChain(chainId);

  // KYC is what makes someone a borrower, not owning a vault. Before
  // mandates the distinction did not matter, because a borrower could only
  // arrive at the app after a lender had already originated for them. Now
  // their first action is filling a mandate, which they must reach the
  // borrower view to do.
  const verifiedQuery = useReadContract({
    address: kycRegistry,
    abi: KYC_REGISTRY_ABI,
    functionName: "isVerified",
    args: [address],
    query: { enabled: isConnected && !!address && !isPlaceholder(kycRegistry) },
  });

  const operatorQuery = useReadContract({
    address: assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: "operator",
    query: { enabled: isConnected },
  });

  const lenderVaultsQuery = useReadContract({
    address: vaultFactory,
    abi: VAULT_FACTORY_ABI,
    functionName: "getVaultsByLender",
    args: [address],
    query: { enabled: isConnected && !!address },
  });

  const borrowerVaultsQuery = useReadContract({
    address: vaultFactory,
    abi: VAULT_FACTORY_ABI,
    functionName: "getVaultsByBorrower",
    args: [address],
    query: { enabled: isConnected && !!address },
  });

  const isLoading =
    isConnected &&
    (operatorQuery.isLoading || lenderVaultsQuery.isLoading ||
     borrowerVaultsQuery.isLoading || verifiedQuery.isLoading);

  // Distinguishes "checked, genuinely no roles" from "couldn't check at
  // all" (e.g. contracts.js still has a PLACEHOLDER address for this
  // network — true right now, pre-Group F deployment). Surfaced so the
  // UI can tell those two states apart rather than showing an identical
  // "no role" screen for both, which is misleading during testing.
  const queryFailed =
    isConnected &&
    (operatorQuery.isError || lenderVaultsQuery.isError || borrowerVaultsQuery.isError);

  if (queryFailed) {
    console.warn(
      "[useWalletRole] Role-detection reads failed — check that contracts.js has real " +
      "deployed addresses for this network, not PLACEHOLDER zero addresses.",
      { operatorError: operatorQuery.error, lenderError: lenderVaultsQuery.error, borrowerError: borrowerVaultsQuery.error }
    );
    return { roles: [], isLoading: false, hasAnyRole: false, hasEstablishedRole: false, queryFailed: true };
  }

  if (!isConnected || isLoading) {
    return { roles: [], isLoading, hasAnyRole: false, hasEstablishedRole: false, queryFailed: false };
  }

  const roles = [];
  const isOperator =
    operatorQuery.data && address &&
    operatorQuery.data.toLowerCase() === address.toLowerCase();
  if (isOperator) roles.push("operator");

  const lenderVaults = (lenderVaultsQuery.data || []).length;
  const borrowerVaults = (borrowerVaultsQuery.data || []).length;

  // Lending is permissionless — no KYC, no whitelist, no prior vault. Gating
  // the lender view on already HAVING a vault was a bootstrap trap: the only
  // way to originate one, or now to publish a mandate, is through the view
  // that owning one unlocks. Anyone connected may lend.
  roles.push("lender");

  if (borrowerVaults > 0 || verifiedQuery.data === true) roles.push("borrower");

  // Distinct from capability. Someone who has actually transacted is sent
  // straight to their view; a wallet that merely COULD lend still gets the
  // landing page, which is where the borrower onboarding path starts.
  // Collapsing these would send every first-time visitor to the lender form.
  const hasEstablishedRole = isOperator || lenderVaults > 0 || borrowerVaults > 0;

  return {
    roles,
    isLoading: false,
    hasAnyRole: roles.length > 0,
    hasEstablishedRole,
    queryFailed: false,
  };
}