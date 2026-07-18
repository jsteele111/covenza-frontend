import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { VAULT_FACTORY_ABI, VAULT_ABI } from "../config/abis.js";
import { getContractsForChain } from "../config/contracts.js";

const factoryAbi = parseAbi(VAULT_FACTORY_ABI);
const vaultAbi = parseAbi(VAULT_ABI);

// Surveys every vault deployed by the CURRENT factory and flags any that
// settled with a loss (severity 1 = borrower-only, 2 = lender-impacted).
// This is the visibility layer for manual revocation review (Group C
// auto-revoke, Option C) — operators see lossy settlements here rather
// than needing to run a backend script.
//
// Note: only surveys vaults deployed by the CURRENT factory address. Any
// vault deployed via a previous factory (before a redeploy) won't appear
// here — same inherent scoping behavior as useLatestVault.js.
export function useSettledVaultsWithLoss() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  const { data: totalVaults } = useReadContract({
    address: contracts.vaultFactory,
    abi: factoryAbi,
    functionName: "totalVaults",
    query: { refetchInterval: 15000 },
  });

  const count = totalVaults ? Number(totalVaults) : 0;

  // Read every vault address from the factory's allVaults(uint256) getter.
  const { data: addressResults } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: contracts.vaultFactory,
      abi: parseAbi(["function allVaults(uint256) view returns (address)"]),
      functionName: "allVaults",
      args: [BigInt(i)],
    })),
    query: { enabled: count > 0 },
  });

  const vaultAddresses = (addressResults || [])
    .map((r) => r.result)
    .filter(Boolean);

  // For each vault, read isSettled + lossSeverity + the settled payout
  // figures + borrower, in one multicall per field across all vaults.
  const { data: stateResults, isLoading, refetch } = useReadContracts({
    contracts: vaultAddresses.flatMap((addr) => [
      { address: addr, abi: vaultAbi, functionName: "isSettled" },
      { address: addr, abi: vaultAbi, functionName: "lossSeverity" },
      { address: addr, abi: vaultAbi, functionName: "borrower" },
      { address: addr, abi: vaultAbi, functionName: "principal" },
      { address: addr, abi: vaultAbi, functionName: "settledTotalReturned" },
      { address: addr, abi: vaultAbi, functionName: "settledLenderPayout" },
      { address: addr, abi: vaultAbi, functionName: "settledBorrowerPayout" },
      { address: addr, abi: vaultAbi, functionName: "settledFee" },
    ]),
    query: { enabled: vaultAddresses.length > 0, refetchInterval: 15000 },
  });

  const lossyVaults = [];
  if (stateResults) {
    const FIELDS_PER_VAULT = 8;
    for (let i = 0; i < vaultAddresses.length; i++) {
      const base = i * FIELDS_PER_VAULT;
      const isSettled = stateResults[base]?.result;
      const severity = stateResults[base + 1]?.result;
      if (!isSettled || !severity || Number(severity) === 0) continue;

      lossyVaults.push({
        address: vaultAddresses[i],
        severity: Number(severity), // 1 = borrower-only, 2 = lender-impacted
        borrower: stateResults[base + 2]?.result,
        principal: stateResults[base + 3]?.result,
        settledTotalReturned: stateResults[base + 4]?.result,
        settledLenderPayout: stateResults[base + 5]?.result,
        settledBorrowerPayout: stateResults[base + 6]?.result,
        settledFee: stateResults[base + 7]?.result,
      });
    }
  }

  // Lender-impacted first — the more severe category worth attention first.
  lossyVaults.sort((a, b) => b.severity - a.severity);

  return { lossyVaults, isLoading, refetch };
}