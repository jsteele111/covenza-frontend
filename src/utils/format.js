import { formatEther, formatUnits } from "viem";

export function formatEth(value, decimals = 5) {
  if (value === undefined || value === null) return "—";
  const asNumber = Number(formatEther(value));
  return `${asNumber.toFixed(decimals)} ETH`;
}

// Token-agnostic amount formatter — v2 is multi-asset (WETH/WBTC/USDC/USDT,
// each with its own on-chain decimals), so a single ETH-flavored formatter
// no longer covers every value the UI needs to display. `tokenDecimals`
// should come from the asset's own ERC20_ABI.decimals() read, not an
// assumed constant, per the same convention already used elsewhere.
export function formatTokenAmount(value, tokenDecimals, displayDecimals = 4) {
  if (value === undefined || value === null || tokenDecimals === undefined || tokenDecimals === null) {
    return "—";
  }
  const asNumber = Number(formatUnits(value, tokenDecimals));
  return asNumber.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: displayDecimals,
  });
}

export function formatPercent(fraction, decimals = 2) {
  if (fraction === undefined || fraction === null || Number.isNaN(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

export function shortAddress(address) {
  if (!address) return "—";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatCountdown(deadlineSeconds) {
  if (!deadlineSeconds) return "—";
  const deadlineMs = Number(deadlineSeconds) * 1000;
  const diffMs = deadlineMs - Date.now();

  if (diffMs <= 0) return "Expired";

  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diffMs / (1000 * 60 * 60)) % 24);
  const minutes = Math.floor((diffMs / (1000 * 60)) % 60);

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  return `${minutes}m remaining`;
}