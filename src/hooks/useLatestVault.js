import { useChainId, useReadContract } from "wagmi";
import { VAULT_FACTORY_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const factoryAbi = VAULT_FACTORY_ABI;

// role: "borrower" or "lender"
export function useLatestVault(address, role) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  const functionName =
    role === "lender" ? "getVaultsByLender" : "getVaultsByBorrower";

  const { data, isLoading, refetch } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName,
    args: [address],
    query: {
      enabled: Boolean(address),
      refetchInterval: 10000,
    },
  });

  const vaults = data || [];
  const latestVaultAddress =
    vaults.length > 0 ? vaults[vaults.length - 1] : null;

  return { latestVaultAddress, allVaults: vaults, isLoading, refetch };
}