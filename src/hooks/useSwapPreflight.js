import { useEffect, useState } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { VAULT_ABI } from "../config/abis.js";

/**
 * Dry-runs a vault swap before the borrower signs anything.
 *
 * Written after a live run where a 50 tUSDG swap against a pool with 1000
 * liquidity was refused by the entry-impact cap. The form showed no objection;
 * MetaMask reported only "network fee unavailable" and offered a Review alert.
 * Nothing on screen said the ceiling for that pool was around 10 tokens.
 *
 * @dev This simulates rather than recomputing the constraint client-side, and
 *      that choice is the point. The vault enforces FOUR separate guards on a
 *      swap — the TWAP observation window, the entry-impact cap, the risk-tier
 *      ceiling and the per-asset exposure cap — and the impact one compares
 *      execution against a TWAP whose maths is genuinely easy to get subtly
 *      wrong. Mirroring all of that in JavaScript would mean maintaining a
 *      second implementation that is wrong in different ways over time.
 *      eth_call costs nothing, runs the real bytecode, and returns the
 *      contract's own revert string — so the reason shown to the borrower is
 *      by construction the reason the transaction would fail.
 */
export function useSwapPreflight({
  vaultAddress,
  enabled,
  functionName,
  args,
}) {
  const { address } = useAccount();
  const publicClient = usePublicClient();

  const [state, setState] = useState({ status: "idle", reason: null });

  // args is a fresh array each render, so it is stringified for the dependency
  // rather than compared by identity — otherwise this refires on every
  // keystroke anywhere in the form.
  const argsKey = args ? args.map(String).join("|") : "";

  useEffect(() => {
    if (!enabled || !publicClient || !vaultAddress || !address) {
      setState({ status: "idle", reason: null });
      return;
    }

    let cancelled = false;
    setState({ status: "checking", reason: null });

    // Debounced: the borrower is typing, and every keystroke would otherwise
    // be an RPC round trip.
    const timer = setTimeout(async () => {
      try {
        await publicClient.simulateContract({
          address: vaultAddress,
          abi: VAULT_ABI,
          functionName,
          args,
          account: address,
        });
        if (!cancelled) setState({ status: "ok", reason: null });
      } catch (err) {
        if (cancelled) return;
        // viem phrases this as 'The contract function "swap" reverted with the
        // following reason: X'. The borrower needs X, not the sentence around
        // it — they did not ask which function was called.
        const raw = err?.shortMessage || err?.details || "";
        const reason =
          raw.match(/reverted with the following reason:\s*(.+)/i)?.[1]?.trim() ||
          raw.replace(/^execution reverted:?\s*/i, "").trim() ||
          "This swap would fail.";
        setState({ status: "would-revert", reason });
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, vaultAddress, address, functionName, argsKey, publicClient]);

  return state;
}
