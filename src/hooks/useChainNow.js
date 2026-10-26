import { useEffect, useRef, useState } from "react";
import { useBlock } from "wagmi";

/**
 * The chain's current time, in seconds — what block.timestamp will be.
 *
 * Every deadline, grace period, expiry and timelock is enforced against
 * block.timestamp, so every countdown on screen has to be measured against
 * it too. Measuring against the browser clock was wrong in five places (found
 * click-testing, 26 October 2026): on a local node fast-forwarded by two hours,
 * a mandate said "expires in 8h" with 6h left, and a vault the contract already
 * treated as expired said "1d 2h remaining". On a live chain the two clocks
 * nearly agree, which is why it went unnoticed.
 *
 * @dev The latest block's timestamp alone lags on a quiet chain: a local node
 *      mines only when something happens. So the chain time is taken as the
 *      latest block's timestamp plus the real time elapsed since that block
 *      was FIRST seen. On a chain producing blocks every second this is the
 *      block time; on an idle local node it advances with the wall clock from
 *      the last block, which is how the node itself stamps the next one.
 *
 *      Re-renders every `tickSeconds` so countdowns move without a new block.
 */
export function useChainNow(tickSeconds = 15) {
  const { data: block } = useBlock({ watch: true });
  const seen = useRef({ number: null, ts: 0, at: 0 });
  const [, setTick] = useState(0);

  if (block && block.number !== seen.current.number) {
    seen.current = { number: block.number, ts: Number(block.timestamp), at: Date.now() };
  }

  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), tickSeconds * 1000);
    return () => clearInterval(t);
  }, [tickSeconds]);

  if (seen.current.number === null) return Math.floor(Date.now() / 1000);
  return seen.current.ts + Math.floor((Date.now() - seen.current.at) / 1000);
}
