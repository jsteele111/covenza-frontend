import { useEffect, useRef, useState } from "react";
import { useAccount, useBlock, usePublicClient } from "wagmi";
import { VAULT_ABI } from "../config/abis.js";

// How often a standing result is re-checked as new blocks arrive. A fast chain
// produces several blocks a second; re-simulating on every one would be an RPC
// call per block per open button for no benefit.
const RECHECK_MS = 4000;

/**
 * Dry-runs a vault call (swap, swapBack, settle, settleInKind) before the user
 * signs anything, and keeps re-checking while the page is open.
 *
 * Written after a live run where a 50 tUSDG swap against a pool with 1000
 * liquidity was refused by the entry-impact cap. The form showed no objection;
 * MetaMask reported only "network fee unavailable".
 *
 * @dev This simulates rather than recomputing the constraints client-side, and
 *      that choice is the point. The vault enforces several guards on a swap
 *      and settlement, and mirroring them in JavaScript would be a second
 *      implementation that drifts. eth_call runs the real bytecode and returns
 *      the contract's own revert reason.
 *
 *      Re-checked as the chain moves (26 October 2026). The first version ran
 *      only when its inputs changed, so a result went stale whenever the chain
 *      changed under an open page: with tAAPL frozen from a terminal, "Settle
 *      loan" stayed enabled on the strength of a check made before the freeze.
 *      A reload fixed it, which is how the cause was confirmed. Now the check
 *      re-runs on new blocks (at most every RECHECK_MS), keeping the previous
 *      result on screen while it does so the button does not flicker.
 *
 *      Status:
 *        "idle"         — not enabled
 *        "checking"     — first check for these inputs in flight; callers
 *                         should treat this as not-yet-allowed
 *        "ok"           — the call would succeed as of the last check
 *        "would-revert" — it would fail; `reason` says why
 */
export function useSwapPreflight({ vaultAddress, enabled, functionName, args }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  // The same watched block query the countdowns use (useChainNow), so this
  // adds no polling of its own. useBlockNumber's watcher polled far less often
  // in testing — a freeze took ~10s to be noticed.
  const { data: block } = useBlock({ watch: true });
  const blockNumber = block?.number;

  const [state, setState] = useState({ status: "idle", reason: null });
  const [epoch, setEpoch] = useState(0);
  const lastRun = useRef(0);

  // args is a fresh array each render, so it is stringified for the dependency
  // rather than compared by identity.
  const argsKey = args ? args.map(String).join("|") : "";
  const inputsKey = `${enabled}|${vaultAddress}|${address}|${functionName}|${argsKey}`;
  const lastInputs = useRef(null);

  // A new block bumps the epoch, so standing results are refreshed — throttled
  // to RECHECK_MS, and deferred rather than dropped: on a quiet local chain the
  // block that froze a token may be the last for a while.
  useEffect(() => {
    if (!enabled || blockNumber === undefined) return;
    const wait = Math.max(0, RECHECK_MS - (Date.now() - lastRun.current));
    const t = setTimeout(() => setEpoch((e) => e + 1), wait);
    return () => clearTimeout(t);
  }, [blockNumber, enabled]);

  useEffect(() => {
    if (!enabled || !publicClient || !vaultAddress || !address) {
      setState({ status: "idle", reason: null });
      lastInputs.current = inputsKey;
      return;
    }

    // New inputs: show "checking" until the first answer. Same inputs on a new
    // block: keep showing the last answer while the re-check runs.
    const inputsChanged = lastInputs.current !== inputsKey;
    lastInputs.current = inputsKey;
    if (inputsChanged) setState({ status: "checking", reason: null });

    let cancelled = false;
    const timer = setTimeout(async () => {
      lastRun.current = Date.now();
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
        const raw = err?.shortMessage || err?.details || "";
        const reason =
          raw.match(/reverted with the following reason:\s*(.+)/i)?.[1]?.trim() ||
          raw.replace(/^execution reverted:?\s*/i, "").trim() ||
          "This would fail.";
        setState({ status: "would-revert", reason });
      }
    }, inputsChanged ? 400 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputsKey, epoch, publicClient]);

  return state;
}

/**
 * The contract's and Uniswap's refusal codes, in words.
 *
 * "STF" is Uniswap's TransferHelper failing to pull a token — in practice a
 * token whose issuer has frozen it. Shown raw it means nothing to anyone.
 */
export function explainTokenRefusal(reason) {
  if (/\bSTF\b|Token is frozen|Token transfer failed|transfer amount exceeds|TRANSFER_FROM_FAILED/i.test(reason || "")) {
    return "A held asset cannot be moved right now — most likely frozen by its issuer — so the vault cannot sell it.";
  }
  return null;
}
