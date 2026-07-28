import { useChainId, useReadContracts } from "wagmi";
import { VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { symbolForToken } from "../config/contracts.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const vaultAbi = VAULT_ABI;
const erc20Abi = ERC20_ABI;

/**
 * Group E5 — lists the foreign assets a vault currently holds from
 * directional swaps (Vault.sol's heldAssets array), each with its symbol,
 * decimals, and current balance, so the borrower can choose which one to
 * swap back. These are also forced back to the loan asset automatically
 * at settlement — this UI is for a borrower who wants to close a
 * directional position early, not a required step.
 *
 * Two-stage read, same pattern as useProtocolStats.js: first enumerate
 * `heldAssets(0..count)` to get addresses, then batch-read each one's
 * decimals + balance.
 */
export function useHeldAssets(vaultAddress, count) {
  const chainId = useChainId();
  const enabled = Boolean(vaultAddress) && count > 0;

  const { data: addressResults } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: vaultAddress,
      abi: vaultAbi,
      functionName: "heldAssets",
      args: [BigInt(i)],
    })),
    query: { enabled },
  });

  const addresses = (addressResults || []).map((r) => r.result).filter(Boolean);

  const { data: detailResults, isLoading, refetch } = useReadContracts({
    contracts: addresses.flatMap((addr) => [
      { address: addr, abi: erc20Abi, functionName: "decimals" },
      { address: addr, abi: erc20Abi, functionName: "balanceOf", args: [vaultAddress] },
    ]),
    query: { enabled: addresses.length > 0, refetchInterval: 10000 },
  });

  const heldAssets = addresses.map((addr, i) => ({
    address: addr,
    symbol: symbolForToken(chainId, addr),
    decimals: detailResults?.[i * 2]?.result,
    balance: detailResults?.[i * 2 + 1]?.result || 0n,
  }));

  return { heldAssets, isLoading, refetch };
}