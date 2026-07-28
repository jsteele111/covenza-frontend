import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { VAULT_FACTORY_ABI, VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { getContractsForChain, symbolForToken } from "../config/contracts.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi()
// (parseAbi() is still used below for the one genuinely raw string signature).
const factoryAbi = VAULT_FACTORY_ABI;
const vaultAbi = VAULT_ABI;
const erc20Abi = ERC20_ABI;

// Surveys every vault deployed by the CURRENT factory and flags any that
// settled with a loss (severity 1 = borrower-only, 2 = lender-impacted).
// This is the visibility layer for manual revocation review (Group C
// auto-revoke, Option C) — operators see lossy settlements here rather
// than needing to run a backend script.
//
// Note: only surveys vaults deployed by the CURRENT factory address. Any
// vault deployed via a previous factory (before a redeploy) won't appear
// here — same inherent scoping behavior as useLatestVault.js.
//
// Group E6 update: each lossy vault now also carries its own `asset`,
// `decimals`, and `symbol` — v1 assumed every vault was ETH-denominated
// and the operator UI formatted every amount with formatEth(), which is
// simply wrong for a v2 vault settled in, say, USDC. Amounts are read and
// displayed per-vault in that vault's own asset now, not assumed.
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
  // figures + borrower + asset, in one multicall per field across all vaults.
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
      { address: addr, abi: vaultAbi, functionName: "settledInsuranceDraw" },
      { address: addr, abi: vaultAbi, functionName: "asset" },
    ]),
    query: { enabled: vaultAddresses.length > 0, refetchInterval: 15000 },
  });

  const FIELDS_PER_VAULT = 10;
  const lossyRaw = [];
  if (stateResults) {
    for (let i = 0; i < vaultAddresses.length; i++) {
      const base = i * FIELDS_PER_VAULT;
      const isSettled = stateResults[base]?.result;
      const severity = stateResults[base + 1]?.result;
      if (!isSettled || !severity || Number(severity) === 0) continue;

      lossyRaw.push({
        address: vaultAddresses[i],
        severity: Number(severity), // 1 = borrower-only, 2 = lender-impacted
        borrower: stateResults[base + 2]?.result,
        principal: stateResults[base + 3]?.result,
        settledTotalReturned: stateResults[base + 4]?.result,
        settledLenderPayout: stateResults[base + 5]?.result,
        settledBorrowerPayout: stateResults[base + 6]?.result,
        settledFee: stateResults[base + 7]?.result,
        settledInsuranceDraw: stateResults[base + 8]?.result,
        asset: stateResults[base + 9]?.result,
      });
    }
  }

  // Decimals per lossy vault's own asset — small list in practice, so a
  // flat per-vault read (rather than deduping by asset) keeps this simple.
  const { data: decimalsResults } = useReadContracts({
    contracts: lossyRaw.map((v) => ({
      address: v.asset,
      abi: erc20Abi,
      functionName: "decimals",
    })),
    query: { enabled: lossyRaw.length > 0 },
  });

  const lossyVaults = lossyRaw.map((v, i) => ({
    ...v,
    decimals: decimalsResults?.[i]?.result,
    symbol: symbolForToken(chainId, v.asset),
  }));

  // Lender-impacted first — the more severe category worth attention first.
  lossyVaults.sort((a, b) => b.severity - a.severity);

  return { lossyVaults, isLoading, refetch };
}