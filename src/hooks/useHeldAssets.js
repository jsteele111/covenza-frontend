import { useChainId, useReadContracts } from "wagmi";
import { VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { symbolForToken } from "../config/contracts.js";

/**
 * The foreign assets a vault holds from directional swaps, each with what the
 * vault RECORDED buying and the pool it trades through.
 *
 * @dev `amount` is Vault.heldAmount, not the token balance. Since KRAIT-003
 *      the vault tracks what it bought and ignores anything sent to it
 *      directly: swapBack refuses more than heldAmount, and settlement sells
 *      only that. Offering the raw balance as "Max" would offer a figure the
 *      vault refuses whenever someone has donated tokens to it. The balance is
 *      kept alongside for display, because a token can also be clawed back by
 *      its issuer and then the balance is the lower of the two.
 *
 *      `feeTier` is the pool fixed for this asset at first entry. Every later
 *      swap in or out of it uses that pool (item 20).
 */
export function useHeldAssets(vaultAddress, count) {
  const chainId = useChainId();
  const enabled = Boolean(vaultAddress) && count > 0;

  const { data: addressResults } = useReadContracts({
    contracts: Array.from({ length: count }, (_, i) => ({
      address: vaultAddress,
      abi: VAULT_ABI,
      functionName: "heldAssets",
      args: [BigInt(i)],
    })),
    query: { enabled },
  });

  const addresses = (addressResults || []).map((r) => r.result).filter(Boolean);

  const PER = 4;
  const { data: detailResults, isLoading, refetch } = useReadContracts({
    contracts: addresses.flatMap((addr) => [
      { address: addr, abi: ERC20_ABI, functionName: "decimals" },
      { address: addr, abi: ERC20_ABI, functionName: "balanceOf", args: [vaultAddress] },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "heldAmount", args: [addr] },
      { address: vaultAddress, abi: VAULT_ABI, functionName: "swapFeeTierOf", args: [addr] },
    ]),
    query: { enabled: addresses.length > 0, refetchInterval: 10000 },
  });

  const heldAssets = addresses.map((addr, i) => {
    const balance = detailResults?.[i * PER + 1]?.result ?? 0n;
    const recorded = detailResults?.[i * PER + 2]?.result ?? 0n;
    return {
      address: addr,
      symbol: symbolForToken(chainId, addr),
      decimals: detailResults?.[i * PER]?.result,
      balance,
      recorded,
      // What can actually be swapped back: the vault's record, capped by what
      // it still holds.
      amount: balance < recorded ? balance : recorded,
      feeTier: detailResults?.[i * PER + 3]?.result != null ? Number(detailResults[i * PER + 3].result) : undefined,
    };
  });

  return { heldAssets, isLoading, refetch };
}
