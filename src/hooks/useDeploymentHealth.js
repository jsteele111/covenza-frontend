import { useEffect, useState } from "react";
import { useChainId, usePublicClient } from "wagmi";
import { getContractsForChain, isPlaceholder } from "../config/contracts.js";

/**
 * Verifies that the addresses in contracts.js still have code behind them.
 *
 * @dev This exists because of how the failure actually presents. Robinhood
 *      testnet wipes CONTRACT STATE while preserving account balances and
 *      block height, and a call to an address with no code does not revert —
 *      it succeeds and returns empty returndata. Decoders read that as zero.
 *      So a wiped deployment renders as a working app in which every figure
 *      is 0 and every list is empty: a protocol that looks calm rather than
 *      broken.
 *
 *      We lost this deployment once and spent the diagnosis arguing about
 *      whether it had happened, because nothing on screen distinguished "no
 *      vaults yet" from "no contracts at all". One getCode per core contract
 *      settles it before anything else is read.
 */
export function useDeploymentHealth() {
  const chainId = useChainId();
  const publicClient = usePublicClient();
  const contracts = getContractsForChain(chainId);

  const [state, setState] = useState({ status: "checking", missing: [] });

  const targets = [
    ["KYC registry", contracts.kycRegistry],
    ["asset registry", contracts.assetRegistry],
    ["insurance pool", contracts.insurancePool],
    ["vault factory", contracts.vaultFactory],
  ];

  const key = targets.map(([, a]) => a).join("|") + `@${chainId}`;

  useEffect(() => {
    if (!publicClient) return;

    // A chain we have not deployed to is a different condition entirely —
    // "not here yet" rather than "was here and vanished" — and the existing
    // placeholder handling already covers it.
    const real = targets.filter(([, addr]) => addr && !isPlaceholder(addr));
    if (real.length === 0) {
      setState({ status: "not-deployed", missing: [] });
      return;
    }

    let cancelled = false;
    setState({ status: "checking", missing: [] });

    (async () => {
      const missing = [];
      for (const [label, addr] of real) {
        try {
          const code = await publicClient.getBytecode({ address: addr });
          if (!code || code === "0x") missing.push({ label, address: addr });
        } catch {
          // A failed RPC is not evidence of a wipe. Staying quiet is right:
          // claiming the deployment is gone on a dropped connection would be
          // its own kind of wrong.
        }
      }
      if (cancelled) return;
      setState({ status: missing.length ? "wiped" : "ok", missing });
    })();

    return () => { cancelled = true; };
  }, [key, publicClient]);

  return state;
}
