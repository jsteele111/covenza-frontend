import { useChainId, useReadContracts } from "wagmi";
import { isAddress } from "viem";
import {
  ASSET_REGISTRY_ABI,
  ERC20_ABI,
  UNISWAP_V3_FACTORY_ABI,
  UNISWAP_V3_POOL_ABI,
} from "../config/abis.js";
import { getContractsForChain, symbolForToken } from "../config/contracts.js";

/**
 * Whitelist pre-flight.
 *
 * Vault.swap() refuses entry into any position settlement could not force an
 * exit from: it requires UniswapTwap.canQuote() for (destination -> loan
 * asset) at the borrower's chosen fee tier. That contract-level guard is what
 * actually keeps funds safe, and it holds however an asset got whitelisted —
 * including a direct owner call that bypasses this UI entirely.
 *
 * This hook runs the same check one layer earlier, purely so the operator
 * finds out at whitelist time rather than a borrower finding out at swap
 * time. It is deliberately NOT a hard gate: an asset with no quotable pair is
 * still perfectly valid as a loan denomination that nobody swaps out of, and
 * the contract will block the unsafe case regardless. The job here is to make
 * the consequence legible, not to overrule the operator.
 *
 * Note that liquidity and TWAP history are independent. A pool can hold real
 * depth — so a swap into it would fill — while having observationCardinality
 * of 1, so observe() reverts and settlement could never quote it. That is the
 * combination this exists to surface, and it is not hypothetical: AAPL/WETH
 * at 0.05% on Robinhood Chain holds 7.25e19 liquidity with cardinality 1.
 */

export const FEE_TIERS = [500, 3000, 10000];

export const FEE_TIER_LABELS = {
  500: "0.05%",
  3000: "0.3%",
  10000: "1%",
};

const ZERO = "0x0000000000000000000000000000000000000000";

export function useAssetPreflight(candidate) {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);

  const valid = Boolean(candidate) && isAddress(candidate);

  // --- Round 1: protocol config, and whether the candidate is an ERC-20 ---

  const { data: baseData, isLoading: baseLoading } = useReadContracts({
    contracts: [
      { address: contracts.assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "uniswapFactory" },
      { address: contracts.assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "twapWindow" },
      { address: contracts.assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "getWhitelistedAssets" },
      { address: candidate, abi: ERC20_ABI, functionName: "decimals" },
      { address: candidate, abi: ERC20_ABI, functionName: "symbol" },
      { address: contracts.assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "isWhitelisted", args: [candidate] },
    ],
    query: { enabled: valid },
  });

  const uniswapFactory = baseData?.[0]?.result;
  const twapWindow     = baseData?.[1]?.result;
  const whitelisted    = baseData?.[2]?.result || [];
  const decimals       = baseData?.[3]?.result;
  const symbol         = baseData?.[4]?.result;
  const alreadyListed  = baseData?.[5]?.result === true;

  // decimals() and symbol() both reverting is the clearest signal we have
  // that the address isn't a token at all — an EOA, or the wrong contract.
  const isErc20 = decimals !== undefined && decimals !== null;

  // Pair the candidate against every asset already whitelisted. Skip itself:
  // a self-pair has no pool and would only add noise.
  const counterparties = whitelisted.filter(
    (a) => a && a.toLowerCase() !== candidate?.toLowerCase()
  );

  const combos = counterparties.flatMap((other) =>
    FEE_TIERS.map((fee) => ({ other, fee }))
  );

  // --- Round 2: does a pool exist for each (pair, tier)? ---

  const poolsEnabled = valid && isErc20 && Boolean(uniswapFactory) && combos.length > 0;

  const { data: poolData, isLoading: poolLoading } = useReadContracts({
    contracts: combos.map(({ other, fee }) => ({
      address: uniswapFactory,
      abi: UNISWAP_V3_FACTORY_ABI,
      functionName: "getPool",
      args: [candidate, other, fee],
    })),
    query: { enabled: poolsEnabled },
  });

  const withPools = combos.map((combo, i) => ({
    ...combo,
    pool: poolData?.[i]?.result,
  }));

  const existing = withPools.filter((c) => c.pool && c.pool !== ZERO);

  // --- Round 3: can each existing pool actually serve the TWAP window? ---
  //
  // observe() REVERTS on a pool without enough history, which is exactly the
  // signal we want — a failed read here is a meaningful result, not an error.
  // Cardinality is read alongside it purely to explain the failure to a human.

  const observeEnabled = poolsEnabled && Boolean(twapWindow) && existing.length > 0;

  const { data: quoteData, isLoading: quoteLoading } = useReadContracts({
    contracts: existing.flatMap((c) => [
      {
        address: c.pool,
        abi: UNISWAP_V3_POOL_ABI,
        functionName: "observe",
        args: [[Number(twapWindow), 0]],
      },
      { address: c.pool, abi: UNISWAP_V3_POOL_ABI, functionName: "slot0" },
      { address: c.pool, abi: UNISWAP_V3_POOL_ABI, functionName: "liquidity" },
    ]),
    query: { enabled: observeEnabled },
  });

  const quoteByPool = new Map();
  existing.forEach((c, i) => {
    const observeResult = quoteData?.[i * 3];
    const slot0Result   = quoteData?.[i * 3 + 1];
    const liquidity     = quoteData?.[i * 3 + 2]?.result;

    quoteByPool.set(c.pool, {
      quotable: observeResult?.status === "success",
      cardinality: slot0Result?.result ? Number(slot0Result.result[3]) : undefined,
      liquidity,
    });
  });

  const pairs = withPools.map((c) => {
    const hasPool = Boolean(c.pool) && c.pool !== ZERO;
    const q = hasPool ? quoteByPool.get(c.pool) : undefined;

    let status = "no-pool";
    if (hasPool) status = q?.quotable ? "quotable" : "no-twap";

    return {
      counterparty: c.other,
      counterpartySymbol: symbolForToken(chainId, c.other),
      fee: c.fee,
      feeLabel: FEE_TIER_LABELS[c.fee] || `${c.fee}`,
      pool: hasPool ? c.pool : undefined,
      status,
      cardinality: q?.cardinality,
      liquidity: q?.liquidity,
    };
  });

  const quotablePairs = pairs.filter((p) => p.status === "quotable");

  // A pool that exists and holds liquidity but cannot be quoted is the
  // dangerous shape, and worth calling out separately from "no pool here".
  const trapPairs = pairs.filter(
    (p) => p.status === "no-twap" && p.liquidity !== undefined && p.liquidity > 0n
  );

  const isChecking = valid && (baseLoading || poolLoading || quoteLoading);

  return {
    valid,
    isChecking,
    ready: valid && !isChecking && baseData !== undefined,
    alreadyListed,
    isErc20,
    symbol,
    decimals,
    twapWindow: twapWindow !== undefined ? Number(twapWindow) : undefined,
    hasCounterparties: counterparties.length > 0,
    pairs,
    quotablePairs,
    trapPairs,
    anyQuotable: quotablePairs.length > 0,
  };
}
