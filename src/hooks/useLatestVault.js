import { useReadContract } from "wagmi";
import { parseAbi } from "viem";
import { VAULT_FACTORY_ABI } from "../config/abis.js";
import { CONTRACTS } from "../config/contracts.js";

const factoryAbi = parseAbi(VAULT_FACTORY_ABI);

// role: "borrower" or "lender"
export function useLatestVault(address, role) {
  const functionName =
    role === "lender" ? "getVaultsByLender" : "getVaultsByBorrower";

  const { data, isLoading, refetch } = useReadContract({
    address: CONTRACTS.vaultFactory,
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
