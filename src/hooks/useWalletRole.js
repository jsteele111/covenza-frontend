import { useAccount, useChainId, useReadContract } from "wagmi";
import { getContractsForChain } from "../config/contracts.js";
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
  const { assetRegistry, vaultFactory } = getContractsForChain(chainId);

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
    (operatorQuery.isLoading || lenderVaultsQuery.isLoading || borrowerVaultsQuery.isLoading);

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
    return { roles: [], isLoading: false, hasAnyRole: false, queryFailed: true };
  }

  if (!isConnected || isLoading) {
    return { roles: [], isLoading, hasAnyRole: false, queryFailed: false };
  }

  const roles = [];
  const isOperator =
    operatorQuery.data && address &&
    operatorQuery.data.toLowerCase() === address.toLowerCase();
  if (isOperator) roles.push("operator");

  if ((lenderVaultsQuery.data || []).length > 0) roles.push("lender");
  if ((borrowerVaultsQuery.data || []).length > 0) roles.push("borrower");

  return { roles, isLoading: false, hasAnyRole: roles.length > 0, queryFailed: false };
}