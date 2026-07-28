import { useWriteContract, useWaitForTransactionReceipt, usePublicClient } from "wagmi";
import { VAULT_ABI } from "../config/abis.js";

// abis.js already exports pre-parsed ABIs — do not re-wrap in parseAbi().
const vaultAbi = VAULT_ABI;

// Wraps a single Vault write function (payDeposit, supplyToAave, settle)
// with pending/confirming/success state, so components don't each
// re-implement the same wagmi plumbing.
//
// Explicitly overrides gas fees with a 2x safety margin on top of the
// current base fee. Arbitrum's base fee shifts slightly between blocks,
// and the default fee estimate from wagmi/viem leaves almost no buffer —
// which causes "max fee per gas less than block base fee" reverts on a
// large fraction of attempts. The margin costs a negligible amount of
// extra (unused, refunded) gas budget but makes transactions land reliably.
export function useVaultAction() {
  const publicClient = usePublicClient();
  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();

  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash,
  });

  async function call(vaultAddress, functionName, args = [], value = undefined) {
    const fees = await publicClient.estimateFeesPerGas();

    writeContract({
      address: vaultAddress,
      abi: vaultAbi,
      functionName,
      args,
      value,
      maxFeePerGas: fees.maxFeePerGas * 2n,
      maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
    });
  }

  return { call, hash, isPending, isConfirming, isSuccess, error, reset };
}