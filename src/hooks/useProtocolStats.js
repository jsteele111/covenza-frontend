import { useChainId, useReadContract, useReadContracts } from "wagmi";
import { parseAbi } from "viem";
import { ASSET_REGISTRY_ABI, INSURANCE_POOL_ABI, VAULT_FACTORY_ABI, VAULT_ABI, ERC20_ABI } from "../config/abis.js";
import { getContractsForChain, isPlaceholder, symbolForToken } from "../config/contracts.js";

/**
 * Powers the public, per-asset protocol dashboard (Group E3).
 *
 * Surveys the whole protocol rather than a single wallet's position:
 *   - every whitelisted asset (AssetRegistry.getWhitelistedAssets)
 *   - that asset's insurance reserve — the "risk buffer" that absorbs a
 *     settlement shortfall before it can ever reach a lender's principal
 *   - that asset's on-chain decimals (read live, not assumed — same
 *     convention as the rest of this codebase; contracts.js's
 *     TOKEN_DECIMALS is a display-only fallback, never used for math)
 *   - every vault ever deployed by the current factory, aggregated by
 *     asset into vault counts and principal totals (active vs. all-time)
 *   - protocol-wide settlement configuration (TWAP window/tolerance,
 *     swap-back grace period, keeper bounty rate/cap, insurance draw cap,
 *     insurance skim rate) — public, trust-relevant figures per BRD
 *     NFR-5 (auditability) and FIN-3 (plain-terms max-loss disclosure)
 *
 * Deliberately checks `isPlaceholder()` on the three v2 contract addresses
 * BEFORE firing any reads. Pre-Group-F (today), these are still zero
 * addresses on every network — this hook reports `isConfigured: false`
 * rather than letting a batch of reads fail against nothing and surfacing
 * a wall of RPC errors. Same honesty principle as useWalletRole's
 * queryFailed flag, applied here to a page that has no wallet gate at all.
 */
export function useProtocolStats() {
  const chainId = useChainId();
  const contracts = getContractsForChain(chainId);
  const { assetRegistry, insurancePool, vaultFactory } = contracts;

  const isConfigured =
    !isPlaceholder(assetRegistry) && !isPlaceholder(insurancePool) && !isPlaceholder(vaultFactory);

  // --- Whitelisted assets ---
  const { data: whitelistedAssets, isLoading: assetsLoading } = useReadContract({
    address: assetRegistry,
    abi: ASSET_REGISTRY_ABI,
    functionName: "getWhitelistedAssets",
    query: { enabled: isConfigured, refetchInterval: 30000 },
  });

  const assets = whitelistedAssets || [];

  // --- Per-asset reads: insurance reserve, decimals, risk tier ---
  //
  // The tier is what determines the deposit floor, so it has to travel with
  // the asset. The dashboard previously looked its deposit figures up in a
  // bundled JSON keyed by symbol, which listed ETH, WBTC, USDC and USDT — none
  // of them deployed — so every card read "no deposit-sizing data published".
  const { data: perAssetResults, isLoading: perAssetLoading } = useReadContracts({
    contracts: assets.flatMap((asset) => [
      { address: insurancePool, abi: INSURANCE_POOL_ABI, functionName: "reserveOf", args: [asset] },
      { address: asset, abi: ERC20_ABI, functionName: "decimals" },
      { address: assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "tierOf", args: [asset] },
    ]),
    query: { enabled: isConfigured && assets.length > 0, refetchInterval: 30000 },
  });

  // --- Protocol-wide settlement config (AssetRegistry) ---
  const { data: configResults, isLoading: configLoading } = useReadContracts({
    contracts: [
      { address: assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "twapWindow" },
      { address: assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "twapToleranceBps" },
      { address: assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "swapBackGracePeriod" },
      { address: assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "bountyRatePerHourBps" },
      { address: assetRegistry, abi: ASSET_REGISTRY_ABI, functionName: "bountyCapBps" },
      { address: insurancePool, abi: INSURANCE_POOL_ABI, functionName: "drawCapBps" },
      { address: vaultFactory, abi: VAULT_FACTORY_ABI, functionName: "insuranceSkimRateBps" },
      { address: vaultFactory, abi: VAULT_FACTORY_ABI, functionName: "totalVaults" },
    ],
    query: { enabled: isConfigured, refetchInterval: 30000 },
  });

  const totalVaultsCount = configResults?.[7]?.result ? Number(configResults[7].result) : 0;

  // --- Every vault address, then per-vault asset/principal/isSettled ---
  const { data: vaultAddressResults } = useReadContracts({
    contracts: Array.from({ length: totalVaultsCount }, (_, i) => ({
      address: vaultFactory,
      abi: parseAbi(["function allVaults(uint256) view returns (address)"]),
      functionName: "allVaults",
      args: [BigInt(i)],
    })),
    query: { enabled: isConfigured && totalVaultsCount > 0 },
  });

  const vaultAddresses = (vaultAddressResults || []).map((r) => r.result).filter(Boolean);

  const { data: vaultStateResults, isLoading: vaultsLoading } = useReadContracts({
    contracts: vaultAddresses.flatMap((addr) => [
      { address: addr, abi: VAULT_ABI, functionName: "asset" },
      { address: addr, abi: VAULT_ABI, functionName: "principal" },
      { address: addr, abi: VAULT_ABI, functionName: "isSettled" },
    ]),
    query: { enabled: vaultAddresses.length > 0, refetchInterval: 30000 },
  });

  // --- Assemble per-asset stats ---
  const assetStats = assets.map((asset, i) => {
    const reserve = perAssetResults?.[i * 3]?.result;
    const decimals = perAssetResults?.[i * 3 + 1]?.result;
    const tier = perAssetResults?.[i * 3 + 2]?.result;

    let totalVaultsForAsset = 0;
    let activeVaultsForAsset = 0;
    let totalPrincipal = 0n;
    let activePrincipal = 0n;

    if (vaultStateResults) {
      const FIELDS_PER_VAULT = 3;
      for (let v = 0; v < vaultAddresses.length; v++) {
        const base = v * FIELDS_PER_VAULT;
        const vaultAsset = vaultStateResults[base]?.result;
        if (!vaultAsset || vaultAsset.toLowerCase() !== asset.toLowerCase()) continue;

        const principal = vaultStateResults[base + 1]?.result || 0n;
        const settled = vaultStateResults[base + 2]?.result;

        totalVaultsForAsset += 1;
        totalPrincipal += principal;
        if (!settled) {
          activeVaultsForAsset += 1;
          activePrincipal += principal;
        }
      }
    }

    return {
      address: asset,
      symbol: symbolForToken(chainId, asset),
      decimals,
      reserve,
      tier: tier === undefined || tier === null ? undefined : Number(tier),
      totalVaults: totalVaultsForAsset,
      activeVaults: activeVaultsForAsset,
      totalPrincipal,
      activePrincipal,
    };
  });

  const protocolConfig = configResults
    ? {
        twapWindow: configResults[0]?.result,
        twapToleranceBps: configResults[1]?.result,
        swapBackGracePeriod: configResults[2]?.result,
        bountyRatePerHourBps: configResults[3]?.result,
        bountyCapBps: configResults[4]?.result,
        drawCapBps: configResults[5]?.result,
        insuranceSkimRateBps: configResults[6]?.result,
        totalVaults: totalVaultsCount,
      }
    : null;

  const isLoading =
    isConfigured && (assetsLoading || perAssetLoading || configLoading || vaultsLoading);

  return { isConfigured, assets: assetStats, protocolConfig, isLoading };
}